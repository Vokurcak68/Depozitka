import { useState, useMemo, useEffect } from 'react'
import type { Transaction } from '../lib/types'
import { formatPrice } from '../lib/utils'
import { supabase } from '../lib/supabase'

type RecipientType = 'buyer' | 'seller' | 'platform_fee'

interface PayoutItemDraft {
  id: string // local UUID
  recipient_type: RecipientType
  recipient_name: string
  recipient_account: string // CZ formát "1234567890/0100" nebo IBAN
  amount_czk: string
  variable_symbol: string
  note: string
}

interface Props {
  tx: Transaction
  engineUrl: string
  cronToken: string
  adminEmail: string
  onSuccess: () => void
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function emptyItem(
  type: RecipientType,
  tx: Transaction,
  buyerAccount: string = '',
): PayoutItemDraft {
  return {
    id: uid(),
    recipient_type: type,
    recipient_name:
      type === 'buyer'
        ? tx.buyerName || ''
        : type === 'seller'
          ? tx.sellerName || ''
          : 'Lokopolis (provize)',
    recipient_account:
      type === 'seller'
        ? tx.sellerPayoutIban || ''
        : type === 'buyer'
          ? buyerAccount
          : '',
    amount_czk: '',
    variable_symbol: '',
    note: '',
  }
}

export function DisputeResolutionPanel({
  tx,
  engineUrl,
  cronToken,
  adminEmail,
  onSuccess,
}: Props) {
  const [buyerAccount, setBuyerAccount] = useState<string>('')
  const [items, setItems] = useState<PayoutItemDraft[]>([emptyItem('buyer', tx)])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  // Při mountu najdi protiúčet kupujícího z dpt_bank_transactions (poslední matching platba)
  useEffect(() => {
    let cancelled = false
    async function loadBuyerAccount() {
      const { data, error: err } = await supabase
        .from('dpt_bank_transactions')
        .select('counter_account, date')
        .eq('matched_transaction_id', tx.id)
        .eq('matched', true)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (cancelled) return
      if (err) {
        console.error('[DisputeResolutionPanel] buyer account lookup:', err)
        return
      }
      const account = data?.counter_account || ''
      if (account) {
        setBuyerAccount(account)
        // Pokud má první item typ 'buyer' a prázdný účet → předvyplň
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === 0 && it.recipient_type === 'buyer' && !it.recipient_account
              ? { ...it, recipient_account: account }
              : it,
          ),
        )
      }
    }
    void loadBuyerAccount()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.id])

  const totalDeposit = Number(tx.amountCzk) || 0

  const sumItems = useMemo(() => {
    return items.reduce((acc, it) => {
      const n = parseFloat(it.amount_czk.replace(',', '.')) || 0
      return acc + n
    }, 0)
  }, [items])

  const sumRounded = Math.round(sumItems * 100) / 100
  const depositRounded = Math.round(totalDeposit * 100) / 100
  const sumOK = sumRounded === depositRounded
  const remaining = depositRounded - sumRounded

  function updateItem(id: string, patch: Partial<PayoutItemDraft>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  function addItem(type: RecipientType) {
    setItems((prev) => [...prev, emptyItem(type, tx, buyerAccount)])
  }

  // Presety
  function presetFullRefundBuyer() {
    setItems([
      {
        ...emptyItem('buyer', tx, buyerAccount),
        amount_czk: depositRounded.toFixed(2),
        note: 'Plný refund kupujícímu',
      },
    ])
  }

  function presetRefundWithFee() {
    const fee = Math.round(depositRounded * 0.05 * 100) / 100
    const refund = depositRounded - fee
    setItems([
      {
        ...emptyItem('buyer', tx, buyerAccount),
        amount_czk: refund.toFixed(2),
        note: 'Refund mínus 5 % provize',
      },
      {
        ...emptyItem('platform_fee', tx, buyerAccount),
        amount_czk: fee.toFixed(2),
        note: 'Provize za vyřízení sporu',
      },
    ])
  }

  function presetSplit5050() {
    const half = Math.round((depositRounded / 2) * 100) / 100
    const other = depositRounded - half
    setItems([
      {
        ...emptyItem('buyer', tx, buyerAccount),
        amount_czk: half.toFixed(2),
        note: 'Split 50%',
      },
      {
        ...emptyItem('seller', tx, buyerAccount),
        amount_czk: other.toFixed(2),
        note: 'Split 50%',
      },
    ])
  }

  function presetCustom() {
    setItems([emptyItem('buyer', tx, buyerAccount), emptyItem('seller', tx, buyerAccount)])
  }

  async function handleSubmit() {
    setError(null)
    setResult(null)

    if (!sumOK) {
      setError(
        `Kontrolní součet nesedí: items=${sumRounded.toFixed(2)} Kč, depozit=${depositRounded.toFixed(2)} Kč`,
      )
      return
    }

    // Validace: každá item s buyer/seller musí mít IBAN
    for (const it of items) {
      const amt = parseFloat(it.amount_czk.replace(',', '.')) || 0
      if (amt <= 0) {
        setError(`Item "${it.recipient_type}" má nulovou nebo neplatnou částku.`)
        return
      }
      if (it.recipient_type !== 'platform_fee' && !it.recipient_account.trim()) {
        setError(`Item "${it.recipient_type}" musí mít číslo účtu.`)
        return
      }
      if (
        it.recipient_type !== 'platform_fee' &&
        !/^(\d[\d-]*\/\d{4}|CZ\d{22}|CZ\d{2}\s?(\d{4}\s?){5})$/.test(
          it.recipient_account.trim().replace(/\s/g, ''),
        )
      ) {
        setError(
          `Item "${it.recipient_type}": neplatný formát účtu. Použij "1234567890/0100" nebo IBAN (CZ...).`,
        )
        return
      }
    }

    if (
      !window.confirm(
        `Opravdu odeslat ${items.length} výplat za celkem ${depositRounded.toFixed(2)} Kč?\n\n` +
          'Tato akce je finální a zapíše se do auditu.',
      )
    ) {
      return
    }

    setBusy(true)
    try {
      const payload = {
        transaction_id: tx.id,
        created_by: adminEmail,
        items: items.map((it) => ({
          recipient_type: it.recipient_type,
          recipient_name: it.recipient_name || null,
          recipient_account: it.recipient_account.trim() || null,
          amount_czk: parseFloat(it.amount_czk.replace(',', '.')),
          variable_symbol: it.variable_symbol || null,
          note: it.note || null,
        })),
      }

      const url = `${engineUrl.replace(/\/$/, '')}/api/dispute-payouts`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cronToken}`,
        },
        body: JSON.stringify(payload),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(`Engine chyba ${res.status}: ${data.error || 'unknown'}`)
        return
      }

      setResult(
        `✅ Odesláno: ${data.sent}/${data.total_items}` +
          (data.failed > 0 ? ` · ❌ Selhalo: ${data.failed}` : ''),
      )
      onSuccess()
    } catch (e) {
      setError(`Síťová chyba: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="drawerSection">
      <h4>⚖️ Vypořádání sporu</h4>
      <p className="hint" style={{ marginBottom: 8 }}>
        Rozepiš výplaty mezi kupujícího, prodávajícího a platformu. Součet musí přesně sedět na
        depozit ({formatPrice(totalDeposit)}).
      </p>
      {buyerAccount && (
        <p
          className="hint"
          style={{
            marginBottom: 8,
            color: '#22c55e',
            fontSize: 12,
          }}
        >
          ℹ️ Účet kupujícího předvyplněn z platby: <strong>{buyerAccount}</strong>
        </p>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="btn btnSecondary" onClick={presetFullRefundBuyer} disabled={busy}>
          💸 Plný refund
        </button>
        <button className="btn btnSecondary" onClick={presetRefundWithFee} disabled={busy}>
          📉 Refund − 5 %
        </button>
        <button className="btn btnSecondary" onClick={presetSplit5050} disabled={busy}>
          ⚖️ Split 50/50
        </button>
        <button className="btn btnSecondary" onClick={presetCustom} disabled={busy}>
          ✍️ Custom
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it) => (
          <div
            key={it.id}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={it.recipient_type}
                onChange={(e) =>
                  updateItem(it.id, { recipient_type: e.target.value as RecipientType })
                }
                disabled={busy}
                style={{ flex: 1 }}
              >
                <option value="buyer">👤 Kupující</option>
                <option value="seller">🏪 Prodávající</option>
                <option value="platform_fee">💼 Platforma (provize, jen log)</option>
              </select>
              <button
                className="btn btnSecondary"
                onClick={() => removeItem(it.id)}
                disabled={busy || items.length === 1}
                title="Odebrat řádek"
              >
                ✕
              </button>
            </div>
            <input
              value={it.recipient_name}
              onChange={(e) => updateItem(it.id, { recipient_name: e.target.value })}
              placeholder="Jméno příjemce"
              disabled={busy}
            />
            {it.recipient_type !== 'platform_fee' && (
              <input
                value={it.recipient_account}
                onChange={(e) => updateItem(it.id, { recipient_account: e.target.value })}
                placeholder="Číslo účtu (např. 1234567890/0100)"
                disabled={busy}
              />
            )}
            <input
              type="number"
              min={0}
              step={0.01}
              value={it.amount_czk}
              onChange={(e) => updateItem(it.id, { amount_czk: e.target.value })}
              placeholder="Částka (Kč)"
              disabled={busy}
            />
            <input
              value={it.variable_symbol}
              onChange={(e) => updateItem(it.id, { variable_symbol: e.target.value })}
              placeholder="VS (volitelné, default = transakce)"
              disabled={busy}
            />
            <input
              value={it.note}
              onChange={(e) => updateItem(it.id, { note: e.target.value })}
              placeholder="Poznámka (interní)"
              disabled={busy}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button className="btn btnSecondary" onClick={() => addItem('buyer')} disabled={busy}>
          + Kupující
        </button>
        <button className="btn btnSecondary" onClick={() => addItem('seller')} disabled={busy}>
          + Prodávající
        </button>
        <button className="btn btnSecondary" onClick={() => addItem('platform_fee')} disabled={busy}>
          + Provize
        </button>
      </div>

      <div
        style={{
          marginTop: 12,
          padding: 10,
          borderRadius: 8,
          background: sumOK ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${sumOK ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
        }}
      >
        <p style={{ margin: '0 0 4px', fontSize: 13 }}>
          <strong>Součet items:</strong> {sumRounded.toFixed(2)} Kč
        </p>
        <p style={{ margin: '0 0 4px', fontSize: 13 }}>
          <strong>Depozit:</strong> {depositRounded.toFixed(2)} Kč
        </p>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
          {sumOK ? '✅ Sedí na korunu' : `❌ Rozdíl: ${remaining.toFixed(2)} Kč`}
        </p>
      </div>

      {error && (
        <p className="errorText" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
      {result && (
        <p style={{ marginTop: 10, color: '#22c55e', fontWeight: 600 }}>{result}</p>
      )}

      <button
        className="btn btnPrimary"
        onClick={handleSubmit}
        disabled={busy || !sumOK}
        style={{
          width: '100%',
          marginTop: 12,
          background: '#dc2626',
          borderColor: '#dc2626',
        }}
      >
        {busy ? '⏳ Odesílám...' : '⚖️ Schválit a odeslat výplaty'}
      </button>
    </div>
  )
}
