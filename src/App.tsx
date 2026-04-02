import { useMemo, useState } from 'react'
import './App.css'

type Role = 'buyer' | 'seller' | 'admin'
type EscrowStatus =
  | 'created'
  | 'partial_paid'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'auto_completed'
  | 'disputed'
  | 'hold'
  | 'refunded'
  | 'cancelled'
  | 'payout_sent'
  | 'payout_confirmed'

interface Transaction {
  id: string
  externalOrderId: string
  sourceMarketplace: string
  buyerName: string
  buyerEmail: string
  sellerName: string
  sellerEmail: string
  amount: number
  feePercent: number
  feeAmount: number
  payoutAmount: number
  status: EscrowStatus
  holdReason?: string
  disputeReason?: string
  createdAt: string
  updatedAt: string
}

interface EscrowEvent {
  id: string
  transactionId: string
  actorRole: Role
  actorEmail: string
  action: string
  oldStatus: EscrowStatus | '-'
  newStatus: EscrowStatus
  note?: string
  createdAt: string
}

interface EmailLog {
  id: string
  transactionId: string
  templateKey: string
  toEmail: string
  subject: string
  status: 'queued' | 'sent'
  createdAt: string
}

const statusLabel: Record<EscrowStatus, string> = {
  created: 'Vytvořeno',
  partial_paid: 'Částečně zaplaceno',
  paid: 'Zaplaceno',
  shipped: 'Odesláno',
  delivered: 'Doručeno',
  completed: 'Dokončeno',
  auto_completed: 'Auto dokončeno',
  disputed: 'Spor',
  hold: 'Hold',
  refunded: 'Refundováno',
  cancelled: 'Zrušeno',
  payout_sent: 'Výplata odeslána',
  payout_confirmed: 'Výplata potvrzena',
}

const allowedTransitions: Record<EscrowStatus, EscrowStatus[]> = {
  created: ['partial_paid', 'paid', 'cancelled'],
  partial_paid: ['paid', 'cancelled'],
  paid: ['shipped', 'disputed', 'hold', 'refunded'],
  shipped: ['delivered', 'disputed', 'hold'],
  delivered: ['completed', 'auto_completed', 'disputed', 'hold'],
  disputed: ['hold', 'refunded', 'payout_sent', 'cancelled'],
  hold: ['disputed', 'refunded', 'payout_sent', 'cancelled'],
  payout_sent: ['payout_confirmed'],
  completed: [],
  auto_completed: [],
  refunded: [],
  cancelled: [],
  payout_confirmed: [],
}

function now() {
  return new Date().toLocaleString('cs-CZ')
}

function formatPrice(value: number) {
  return `${new Intl.NumberFormat('cs-CZ').format(value)} Kč`
}

function App() {
  const [tab, setTab] = useState<'api' | 'admin' | 'emails'>('api')
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [events, setEvents] = useState<EscrowEvent[]>([])
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([])

  const [sourceMarketplace, setSourceMarketplace] = useState('depozitka-test-bazar')
  const [externalOrderId, setExternalOrderId] = useState('ORD-2026-1001')
  const [buyerName, setBuyerName] = useState('Testující kupující')
  const [buyerEmail, setBuyerEmail] = useState('buyer@test.cz')
  const [sellerName, setSellerName] = useState('LokoTom')
  const [sellerEmail, setSellerEmail] = useState('seller@test.cz')
  const [amount, setAmount] = useState(1490)

  const [statusChange, setStatusChange] = useState<Record<string, EscrowStatus | ''>>({})
  const [statusNote, setStatusNote] = useState<Record<string, string>>({})

  function addEmailLog(transactionId: string, templateKey: string, toEmail: string, subject: string) {
    const log: EmailLog = {
      id: `mail-${crypto.randomUUID().slice(0, 8)}`,
      transactionId,
      templateKey,
      toEmail,
      subject,
      status: 'sent',
      createdAt: now(),
    }
    setEmailLogs((prev) => [log, ...prev])
  }

  function addEvent(
    transactionId: string,
    actorRole: Role,
    actorEmail: string,
    action: string,
    oldStatus: EscrowStatus | '-',
    newStatus: EscrowStatus,
    note?: string,
  ) {
    const event: EscrowEvent = {
      id: `ev-${crypto.randomUUID().slice(0, 8)}`,
      transactionId,
      actorRole,
      actorEmail,
      action,
      oldStatus,
      newStatus,
      note,
      createdAt: now(),
    }
    setEvents((prev) => [event, ...prev])
  }

  function apiCreateTransaction() {
    if (!buyerName.trim() || !buyerEmail.trim() || !sellerName.trim() || !sellerEmail.trim()) {
      alert('Buyer/seller jméno + email jsou povinné')
      return
    }

    const feePercent = 5
    const feeAmount = Math.max(15, Math.round(amount * (feePercent / 100)))

    const tx: Transaction = {
      id: `DPT-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
      externalOrderId: externalOrderId.trim() || `ORD-${Date.now()}`,
      sourceMarketplace: sourceMarketplace.trim() || 'unknown',
      buyerName: buyerName.trim(),
      buyerEmail: buyerEmail.trim(),
      sellerName: sellerName.trim(),
      sellerEmail: sellerEmail.trim(),
      amount,
      feePercent,
      feeAmount,
      payoutAmount: amount - feeAmount,
      status: 'created',
      createdAt: now(),
      updatedAt: now(),
    }

    setTransactions((prev) => [tx, ...prev])
    addEvent(tx.id, 'buyer', tx.buyerEmail, 'api_transaction_created', '-', 'created')
    addEmailLog(tx.id, 'tx_created_buyer', tx.buyerEmail, `[${tx.id}] Depozitka transakce vytvořena`)
    addEmailLog(tx.id, 'tx_created_seller', tx.sellerEmail, `[${tx.id}] Nová Depozitka transakce`)
    addEmailLog(tx.id, 'tx_created_admin', 'admin@depozitka.cz', `[${tx.id}] Nová transakce`)
  }

  function seedAllStatuses() {
    const statuses: EscrowStatus[] = [
      'created',
      'partial_paid',
      'paid',
      'shipped',
      'delivered',
      'completed',
      'auto_completed',
      'disputed',
      'hold',
      'refunded',
      'cancelled',
      'payout_sent',
      'payout_confirmed',
    ]

    const seeded = statuses.map((status, index) => {
      const localAmount = 1000 + index * 100
      const feeAmount = Math.max(15, Math.round(localAmount * 0.05))
      return {
        id: `DPT-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
        externalOrderId: `ORD-${new Date().getFullYear()}-${1000 + index}`,
        sourceMarketplace: 'depozitka-test-bazar',
        buyerName: `Test buyer ${index + 1}`,
        buyerEmail: `buyer${index + 1}@test.cz`,
        sellerName: `Test seller ${index + 1}`,
        sellerEmail: `seller${index + 1}@test.cz`,
        amount: localAmount,
        feePercent: 5,
        feeAmount,
        payoutAmount: localAmount - feeAmount,
        status,
        disputeReason: status === 'disputed' ? 'Testovací spor' : undefined,
        holdReason: status === 'hold' ? 'Testovací hold' : undefined,
        createdAt: now(),
        updatedAt: now(),
      } satisfies Transaction
    })

    setTransactions((prev) => [...seeded, ...prev])
  }

  function clearAllData() {
    if (!confirm('Smazat všechny transakce, eventy a email logy?')) return
    setTransactions([])
    setEvents([])
    setEmailLogs([])
    setStatusChange({})
    setStatusNote({})
  }

  function applyStatusChange(transactionId: string) {
    const targetStatus = statusChange[transactionId]
    if (!targetStatus) return

    setTransactions((prev) =>
      prev.map((tx) => {
        if (tx.id !== transactionId) return tx

        if (!allowedTransitions[tx.status].includes(targetStatus)) {
          alert(`Přechod ${tx.status} -> ${targetStatus} není povolený`)
          return tx
        }

        const note = (statusNote[transactionId] || '').trim()

        if (targetStatus === 'hold' && !note) {
          alert('Pro HOLD zadej důvod')
          return tx
        }

        if (targetStatus === 'disputed' && !note) {
          alert('Pro SPOR zadej důvod')
          return tx
        }

        const updated: Transaction = {
          ...tx,
          status: targetStatus,
          holdReason: targetStatus === 'hold' ? note : tx.holdReason,
          disputeReason: targetStatus === 'disputed' ? note : tx.disputeReason,
          updatedAt: now(),
        }

        addEvent(transactionId, 'admin', 'admin@depozitka.cz', 'status_changed', tx.status, targetStatus, note)

        if (targetStatus === 'paid') {
          addEmailLog(tx.id, 'payment_received_buyer', tx.buyerEmail, `[${tx.id}] Platba přijata`)
          addEmailLog(tx.id, 'payment_received_seller', tx.sellerEmail, `[${tx.id}] Kupující zaplatil`)
        }
        if (targetStatus === 'shipped') {
          addEmailLog(tx.id, 'shipped_buyer', tx.buyerEmail, `[${tx.id}] Prodávající odeslal zásilku`)
        }
        if (targetStatus === 'delivered') {
          addEmailLog(tx.id, 'delivered_buyer', tx.buyerEmail, `[${tx.id}] Zásilka doručena`)
          addEmailLog(tx.id, 'delivered_seller', tx.sellerEmail, `[${tx.id}] Zásilka doručena`)
        }
        if (targetStatus === 'completed' || targetStatus === 'auto_completed') {
          addEmailLog(tx.id, 'completed_buyer', tx.buyerEmail, `[${tx.id}] Transakce dokončena`)
          addEmailLog(tx.id, 'completed_seller', tx.sellerEmail, `[${tx.id}] Transakce dokončena`)
        }
        if (targetStatus === 'disputed') {
          addEmailLog(tx.id, 'dispute_opened_buyer', tx.buyerEmail, `[${tx.id}] Otevřen spor`)
          addEmailLog(tx.id, 'dispute_opened_seller', tx.sellerEmail, `[${tx.id}] Otevřen spor`)
          addEmailLog(tx.id, 'dispute_opened_admin', 'admin@depozitka.cz', `[${tx.id}] Nový spor`)
        }
        if (targetStatus === 'hold') {
          addEmailLog(tx.id, 'hold_set_buyer', tx.buyerEmail, `[${tx.id}] Transakce na hold`)
          addEmailLog(tx.id, 'hold_set_seller', tx.sellerEmail, `[${tx.id}] Transakce na hold`)
        }
        if (targetStatus === 'refunded') {
          addEmailLog(tx.id, 'refunded_buyer', tx.buyerEmail, `[${tx.id}] Vrácení platby`)
          addEmailLog(tx.id, 'refunded_seller', tx.sellerEmail, `[${tx.id}] Refund kupujícímu`)
        }
        if (targetStatus === 'payout_sent' || targetStatus === 'payout_confirmed') {
          addEmailLog(tx.id, 'payout_seller', tx.sellerEmail, `[${tx.id}] Výplata prodávajícímu`)
          addEmailLog(tx.id, 'payout_admin', 'admin@depozitka.cz', `[${tx.id}] Výplata zpracována`)
        }

        return updated
      }),
    )

    setStatusChange((prev) => ({ ...prev, [transactionId]: '' }))
    setStatusNote((prev) => ({ ...prev, [transactionId]: '' }))
  }

  const groups = useMemo(
    () => ({
      resolve: transactions.filter((t) => ['disputed', 'hold'].includes(t.status)),
      processing: transactions.filter((t) => ['created', 'partial_paid', 'paid', 'shipped', 'delivered'].includes(t.status)),
      closed: transactions.filter((t) =>
        ['completed', 'auto_completed', 'refunded', 'cancelled', 'payout_sent', 'payout_confirmed'].includes(t.status),
      ),
    }),
    [transactions],
  )

  return (
    <div className="app">
      <header className="topbar">
        <h1>Depozitka Core (samostatný projekt)</h1>
        <p>Admin panel + escrow status engine + email logy. Nezávislé na bazaru.</p>
      </header>

      <nav className="tabs">
        <button className={tab === 'api' ? 'active' : ''} onClick={() => setTab('api')}>
          API simulace
        </button>
        <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>
          Admin escrow
        </button>
        <button className={tab === 'emails' ? 'active' : ''} onClick={() => setTab('emails')}>
          Email + audit
        </button>
      </nav>

      {tab === 'api' && (
        <section className="panel">
          <h2>Create transaction (simulace endpointu)</h2>
          <div className="formGrid">
            <label>
              Source marketplace
              <input value={sourceMarketplace} onChange={(e) => setSourceMarketplace(e.target.value)} />
            </label>
            <label>
              External order ID
              <input value={externalOrderId} onChange={(e) => setExternalOrderId(e.target.value)} />
            </label>
            <label>
              Buyer name
              <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
            </label>
            <label>
              Buyer email
              <input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} />
            </label>
            <label>
              Seller name
              <input value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
            </label>
            <label>
              Seller email
              <input type="email" value={sellerEmail} onChange={(e) => setSellerEmail(e.target.value)} />
            </label>
            <label>
              Amount (Kč)
              <input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
            </label>
          </div>

          <button className="primary" onClick={apiCreateTransaction}>
            POST /depozitka/transactions
          </button>

          <p className="hint">Aktivní transakce: {transactions.length}</p>
        </section>
      )}

      {tab === 'admin' && (
        <section className="panel">
          <div className="adminTopActions">
            <button className="primary" onClick={seedAllStatuses}>Seed všech stavů</button>
            <button className="ghost" onClick={clearAllData}>Reset test dat</button>
          </div>

          <h2>Všechny transakce ({transactions.length})</h2>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Depozitka ID</th>
                  <th>Marketplace/Order</th>
                  <th>Stav</th>
                  <th>Kupující</th>
                  <th>Prodávající</th>
                  <th>Částka</th>
                  <th>Aktualizace</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>{tx.id}</td>
                    <td>
                      {tx.sourceMarketplace}
                      <br />
                      <small>{tx.externalOrderId}</small>
                    </td>
                    <td>
                      <span className={`status ${tx.status}`}>{statusLabel[tx.status]}</span>
                    </td>
                    <td>{tx.buyerEmail}</td>
                    <td>{tx.sellerEmail}</td>
                    <td>{formatPrice(tx.amount)}</td>
                    <td>{tx.updatedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="groupWrap">
            <div className="group">
              <h3>K řešení ({groups.resolve.length})</h3>
              {groups.resolve.map((tx) => (
                <TxCard
                  key={tx.id}
                  tx={tx}
                  note={statusNote[tx.id] || ''}
                  change={statusChange[tx.id] || ''}
                  onNote={(v) => setStatusNote((p) => ({ ...p, [tx.id]: v }))}
                  onChange={(v) => setStatusChange((p) => ({ ...p, [tx.id]: v }))}
                  onApply={() => applyStatusChange(tx.id)}
                />
              ))}
            </div>

            <div className="group">
              <h3>V procesu ({groups.processing.length})</h3>
              {groups.processing.map((tx) => (
                <TxCard
                  key={tx.id}
                  tx={tx}
                  note={statusNote[tx.id] || ''}
                  change={statusChange[tx.id] || ''}
                  onNote={(v) => setStatusNote((p) => ({ ...p, [tx.id]: v }))}
                  onChange={(v) => setStatusChange((p) => ({ ...p, [tx.id]: v }))}
                  onApply={() => applyStatusChange(tx.id)}
                />
              ))}
            </div>

            <div className="group">
              <h3>Ukončeno ({groups.closed.length})</h3>
              {groups.closed.map((tx) => (
                <TxCard
                  key={tx.id}
                  tx={tx}
                  note={statusNote[tx.id] || ''}
                  change={statusChange[tx.id] || ''}
                  onNote={(v) => setStatusNote((p) => ({ ...p, [tx.id]: v }))}
                  onChange={(v) => setStatusChange((p) => ({ ...p, [tx.id]: v }))}
                  onApply={() => applyStatusChange(tx.id)}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === 'emails' && (
        <section className="panel">
          <h2>Email logy ({emailLogs.length})</h2>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Čas</th>
                  <th>Tx</th>
                  <th>Template</th>
                  <th>Komu</th>
                  <th>Předmět</th>
                  <th>Stav</th>
                </tr>
              </thead>
              <tbody>
                {emailLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{log.createdAt}</td>
                    <td>{log.transactionId}</td>
                    <td>{log.templateKey}</td>
                    <td>{log.toEmail}</td>
                    <td>{log.subject}</td>
                    <td>{log.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Audit eventy ({events.length})</h3>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Čas</th>
                  <th>Tx</th>
                  <th>Role</th>
                  <th>Email</th>
                  <th>Akce</th>
                  <th>Přechod</th>
                  <th>Poznámka</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{event.createdAt}</td>
                    <td>{event.transactionId}</td>
                    <td>{event.actorRole}</td>
                    <td>{event.actorEmail}</td>
                    <td>{event.action}</td>
                    <td>
                      {event.oldStatus} → {event.newStatus}
                    </td>
                    <td>{event.note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function TxCard({
  tx,
  change,
  note,
  onChange,
  onNote,
  onApply,
}: {
  tx: Transaction
  change: EscrowStatus | ''
  note: string
  onChange: (value: EscrowStatus | '') => void
  onNote: (value: string) => void
  onApply: () => void
}) {
  const nextOptions = allowedTransitions[tx.status]

  return (
    <article className="txCard">
      <div className="txHead">
        <strong>{tx.id}</strong>
        <span className={`status ${tx.status}`}>{statusLabel[tx.status]}</span>
      </div>

      <p>
        <strong>Order:</strong> {tx.sourceMarketplace} / {tx.externalOrderId}
      </p>
      <p>
        <strong>Kupující:</strong> {tx.buyerName} ({tx.buyerEmail})
      </p>
      <p>
        <strong>Prodávající:</strong> {tx.sellerName} ({tx.sellerEmail})
      </p>
      <p>
        <strong>Částka:</strong> {formatPrice(tx.amount)} · <strong>Provize:</strong> {formatPrice(tx.feeAmount)} ·{' '}
        <strong>Výplata:</strong> {formatPrice(tx.payoutAmount)}
      </p>

      <div className="txActions">
        <select value={change} onChange={(e) => onChange((e.target.value as EscrowStatus) || '')}>
          <option value="">Zvol nový stav</option>
          {nextOptions.map((status) => (
            <option key={status} value={status}>
              {statusLabel[status]}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder="Důvod/poznámka (povinné pro hold/spor)"
        />
        <button className="primary" disabled={!change} onClick={onApply}>
          Potvrdit změnu
        </button>
      </div>
    </article>
  )
}

export default App
