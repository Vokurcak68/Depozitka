import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { czechAccountToIban, isValidCzechIban, formatIban, CZECH_BANKS } from '../lib/iban'

export function PayoutAccountEditor({
  transactionId,
  currentIban,
  currentName,
  locked,
  onSaved,
}: {
  transactionId: string
  currentIban: string | null | undefined
  currentName: string | null | undefined
  locked: boolean
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [accountNumber, setAccountNumber] = useState('')
  const [bankCode, setBankCode] = useState('')
  const [accountName, setAccountName] = useState(currentName || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!accountNumber.trim() || !bankCode) {
      setError('Vyplňte číslo účtu a vyberte banku.')
      return
    }

    const iban = czechAccountToIban(accountNumber.trim(), bankCode)
    if (!iban || !isValidCzechIban(iban)) {
      setError('Neplatné číslo účtu nebo kód banky.')
      return
    }

    setBusy(true)
    setError(null)

    try {
      const { error: updErr } = await supabase
        .from('dpt_transactions')
        .update({
          seller_payout_iban: iban,
          seller_payout_account_name: accountName.trim() || null,
          seller_payout_source: 'admin_manual',
        })
        .eq('id', transactionId)

      if (updErr) {
        setError(updErr.message)
        return
      }

      setEditing(false)
      setAccountNumber('')
      setBankCode('')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba')
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <div className="drawerSection">
        <h4>🏦 Účet pro výplatu</h4>
        {currentIban ? (
          <p style={{ fontSize: '13px', marginBottom: '8px' }}>
            <strong>IBAN:</strong> {formatIban(currentIban)}
            {currentName && <><br /><strong>Jméno:</strong> {currentName}</>}
            {locked && (
              <>
                <br />
                <span style={{ color: 'var(--muted)', fontSize: '12px' }}>
                  🔒 Zamčeno (admin override stále možný)
                </span>
              </>
            )}
          </p>
        ) : (
          <p style={{ fontSize: '13px', color: '#f59e0b', marginBottom: '8px' }}>
            ⚠️ Číslo účtu není zadané — bez něj nelze poslat výplatu.
          </p>
        )}
        <button
          className="btn btnSecondary"
          onClick={() => setEditing(true)}
          style={{ fontSize: '13px' }}
        >
          {currentIban ? '✏️ Změnit účet' : '➕ Zadat účet'}
        </button>
      </div>
    )
  }

  return (
    <div className="drawerSection">
      <h4>🏦 Zadat účet pro výplatu</h4>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {error && (
          <div style={{
            padding: '8px 12px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '6px',
            color: '#ef4444',
            fontSize: '13px',
          }}>
            ❌ {error}
          </div>
        )}

        <div>
          <label style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
            Číslo účtu (s předčíslím nebo bez)
          </label>
          <input
            type="text"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="123456789 nebo 19-123456789"
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
            Banka
          </label>
          <select
            value={bankCode}
            onChange={(e) => setBankCode(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="">Vyberte banku…</option>
            {CZECH_BANKS.map((b) => (
              <option key={b.code} value={b.code}>
                {b.code} — {b.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
            Jméno majitele účtu (volitelné)
          </label>
          <input
            type="text"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="např. Jan Novák"
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="submit"
            className="btn btnPrimary"
            disabled={busy}
            style={{ flex: 1 }}
          >
            {busy ? 'Ukládám…' : '💾 Uložit'}
          </button>
          <button
            type="button"
            className="btn btnSecondary"
            onClick={() => { setEditing(false); setError(null) }}
          >
            Zrušit
          </button>
        </div>
      </form>
    </div>
  )
}
