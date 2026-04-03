import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { supabase } from './lib/supabase'

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
  transactionCode: string
  externalOrderId: string
  buyerName: string
  buyerEmail: string
  sellerName: string
  sellerEmail: string
  amountCzk: number
  feeAmountCzk: number
  payoutAmountCzk: number
  status: EscrowStatus
  updatedAt: string
}

interface TxEvent {
  id: string
  transactionCode: string
  eventType: string
  oldStatus?: string
  newStatus?: string
  note?: string
  createdAt: string
}

interface EmailLog {
  id: string
  transactionCode: string
  templateKey: string
  toEmail: string
  subject: string
  status: string
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

function formatPrice(value: number): string {
  return `${new Intl.NumberFormat('cs-CZ').format(value)} Kč`
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('cs-CZ')
}

function App() {
  const [tab, setTab] = useState<'dashboard' | 'emails'>('dashboard')
  const [sessionEmail, setSessionEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isAuthed, setIsAuthed] = useState(false)
  const [busy, setBusy] = useState(false)

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [events, setEvents] = useState<TxEvent[]>([])
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([])

  const [externalOrderId, setExternalOrderId] = useState(`ORD-${new Date().getFullYear()}-1001`)
  const [buyerName, setBuyerName] = useState('Testující kupující')
  const [buyerEmail, setBuyerEmail] = useState('buyer@test.cz')
  const [sellerName, setSellerName] = useState('LokoTom')
  const [sellerEmail, setSellerEmail] = useState('seller@test.cz')
  const [amount, setAmount] = useState(1490)

  const [statusChange, setStatusChange] = useState<Record<string, EscrowStatus | ''>>({})
  const [statusNote, setStatusNote] = useState<Record<string, string>>({})

  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | EscrowStatus>('all')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const email = data.session?.user?.email || ''
      setSessionEmail(email)
      setIsAuthed(Boolean(data.session))
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user?.email || '')
      setIsAuthed(Boolean(session))
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!isAuthed) return
    void reloadAll()
  }, [isAuthed])

  async function signIn(): Promise<void> {
    if (!sessionEmail || !password) {
      alert('Vyplň email a heslo')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: sessionEmail,
      password,
    })
    setBusy(false)
    if (error) {
      alert(`Login chyba: ${error.message}`)
      return
    }
    await reloadAll()
  }

  async function signOut(): Promise<void> {
    await supabase.auth.signOut()
    setTransactions([])
    setEvents([])
    setEmailLogs([])
  }

  async function reloadAll(): Promise<void> {
    setBusy(true)

    const txRes = await supabase
      .from('dpt_transactions')
      .select(
        'id, transaction_code, external_order_id, buyer_name, buyer_email, seller_name, seller_email, amount_czk, fee_amount_czk, payout_amount_czk, status, updated_at',
      )
      .order('created_at', { ascending: false })
      .limit(300)

    if (txRes.error) {
      setBusy(false)
      alert(`Načtení transakcí selhalo: ${txRes.error.message}`)
      return
    }

    const txMap = new Map<string, string>()
    const txRows: Transaction[] = (txRes.data || []).map((row) => {
      txMap.set(row.id, row.transaction_code)
      return {
        id: row.id,
        transactionCode: row.transaction_code,
        externalOrderId: row.external_order_id,
        buyerName: row.buyer_name,
        buyerEmail: row.buyer_email,
        sellerName: row.seller_name,
        sellerEmail: row.seller_email,
        amountCzk: Number(row.amount_czk),
        feeAmountCzk: Number(row.fee_amount_czk),
        payoutAmountCzk: Number(row.payout_amount_czk),
        status: row.status,
        updatedAt: row.updated_at,
      }
    })
    setTransactions(txRows)

    const evRes = await supabase
      .from('dpt_transaction_events')
      .select('id, transaction_id, event_type, old_status, new_status, note, created_at')
      .order('created_at', { ascending: false })
      .limit(250)

    if (!evRes.error) {
      setEvents(
        (evRes.data || []).map((row) => ({
          id: row.id,
          transactionCode: txMap.get(row.transaction_id) || row.transaction_id,
          eventType: row.event_type,
          oldStatus: row.old_status,
          newStatus: row.new_status,
          note: row.note,
          createdAt: row.created_at,
        })),
      )
    }

    const mailRes = await supabase
      .from('dpt_email_logs')
      .select('id, transaction_id, template_key, to_email, subject, status, created_at')
      .order('created_at', { ascending: false })
      .limit(250)

    if (!mailRes.error) {
      setEmailLogs(
        (mailRes.data || []).map((row) => ({
          id: row.id,
          transactionCode: txMap.get(row.transaction_id || '') || row.transaction_id || '-',
          templateKey: row.template_key,
          toEmail: row.to_email,
          subject: row.subject,
          status: row.status,
          createdAt: row.created_at,
        })),
      )
    }

    setBusy(false)
  }

  async function createTransaction(): Promise<void> {
    if (!buyerName.trim() || !buyerEmail.trim() || !sellerName.trim() || !sellerEmail.trim()) {
      alert('Buyer/seller jméno + email jsou povinné')
      return
    }

    setBusy(true)
    const { error } = await supabase.rpc('dpt_create_transaction', {
      p_marketplace_code: 'depozitka-test-bazar',
      p_external_order_id: externalOrderId,
      p_listing_id: null,
      p_listing_title: 'Sandbox objednávka',
      p_buyer_name: buyerName,
      p_buyer_email: buyerEmail,
      p_seller_name: sellerName,
      p_seller_email: sellerEmail,
      p_amount_czk: amount,
      p_payment_method: 'escrow',
      p_metadata: { source: 'depozitka-core-ui' },
    })
    setBusy(false)

    if (error) {
      alert(`Create transaction selhalo: ${error.message}`)
      return
    }

    await reloadAll()
  }

  async function changeStatus(tx: Transaction): Promise<void> {
    const targetStatus = statusChange[tx.id]
    if (!targetStatus) return

    const note = (statusNote[tx.id] || '').trim()

    if ((targetStatus === 'hold' || targetStatus === 'disputed') && !note) {
      alert('Pro HOLD/SPOR zadej důvod')
      return
    }

    setBusy(true)
    const { error } = await supabase.rpc('dpt_change_status', {
      p_transaction_code: tx.transactionCode,
      p_new_status: targetStatus,
      p_actor_role: 'admin',
      p_actor_email: sessionEmail || null,
      p_note: note || null,
    })
    setBusy(false)

    if (error) {
      alert(`Změna stavu selhala: ${error.message}`)
      return
    }

    setStatusChange((prev) => ({ ...prev, [tx.id]: '' }))
    setStatusNote((prev) => ({ ...prev, [tx.id]: '' }))
    await reloadAll()
  }

  const summary = useMemo(() => {
    const resolve = transactions.filter((t) => ['disputed', 'hold'].includes(t.status)).length
    const processing = transactions.filter((t) => ['created', 'partial_paid', 'paid', 'shipped', 'delivered'].includes(t.status)).length
    const closed = transactions.filter((t) => ['completed', 'auto_completed', 'refunded', 'cancelled', 'payout_sent', 'payout_confirmed'].includes(t.status)).length
    const totalVolume = transactions.reduce((acc, tx) => acc + tx.amountCzk, 0)

    return {
      total: transactions.length,
      resolve,
      processing,
      closed,
      totalVolume,
    }
  }, [transactions])

  const filteredTransactions = useMemo(() => {
    const q = searchText.trim().toLowerCase()

    return transactions.filter((tx) => {
      const statusOk = statusFilter === 'all' || tx.status === statusFilter
      if (!statusOk) return false

      if (!q) return true

      const haystack = `${tx.transactionCode} ${tx.externalOrderId} ${tx.buyerName} ${tx.buyerEmail} ${tx.sellerName} ${tx.sellerEmail}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [transactions, searchText, statusFilter])

  const grouped = useMemo(
    () => ({
      resolve: filteredTransactions.filter((t) => ['disputed', 'hold'].includes(t.status)),
      processing: filteredTransactions.filter((t) => ['created', 'partial_paid', 'paid', 'shipped', 'delivered'].includes(t.status)),
      closed: filteredTransactions.filter((t) =>
        ['completed', 'auto_completed', 'refunded', 'cancelled', 'payout_sent', 'payout_confirmed'].includes(t.status),
      ),
    }),
    [filteredTransactions],
  )

  return (
    <div className="app">
      <header className="hero">
        <div>
          <h1>Depozitka Core</h1>
          <p>Uživatelsky přívětivý admin panel pro escrow transakce, spory, výplaty a audit.</p>
        </div>
        {isAuthed && (
          <div className="heroActions">
            <button className="ghost" onClick={() => void reloadAll()} disabled={busy}>
              Obnovit data
            </button>
            <button className="ghost" onClick={() => void signOut()} disabled={busy}>
              Odhlásit
            </button>
          </div>
        )}
      </header>

      {!isAuthed ? (
        <section className="panel authPanel">
          <h2>Přihlášení do adminu</h2>
          <p className="hint">Přihlas se účtem, který má roli admin/support v `dpt_profiles`.</p>
          <div className="formGrid">
            <label>
              Email
              <input type="email" value={sessionEmail} onChange={(e) => setSessionEmail(e.target.value)} />
            </label>
            <label>
              Heslo
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </div>
          <button className="primary" disabled={busy} onClick={() => void signIn()}>
            {busy ? 'Přihlašuji…' : 'Přihlásit'}
          </button>
        </section>
      ) : (
        <>
          <nav className="tabs">
            <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>
              Dashboard
            </button>
            <button className={tab === 'emails' ? 'active' : ''} onClick={() => setTab('emails')}>
              Email + audit
            </button>
          </nav>

          {tab === 'dashboard' && (
            <>
              <section className="statsGrid">
                <StatCard label="Všechny transakce" value={summary.total.toString()} tone="neutral" />
                <StatCard label="K řešení" value={summary.resolve.toString()} tone="danger" />
                <StatCard label="V procesu" value={summary.processing.toString()} tone="info" />
                <StatCard label="Ukončeno" value={summary.closed.toString()} tone="success" />
                <StatCard label="Objem transakcí" value={formatPrice(summary.totalVolume)} tone="neutral" />
              </section>

              <section className="panel">
                <h2>Vytvořit novou transakci</h2>
                <div className="formGrid">
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
                <button className="primary" onClick={() => void createTransaction()} disabled={busy}>
                  {busy ? 'Vytvářím…' : 'Vytvořit transakci'}
                </button>
              </section>

              <section className="panel">
                <h2>Escrow pipeline</h2>
                <div className="filtersRow">
                  <input
                    className="searchInput"
                    placeholder="Hledat podle tx, order ID, kupujícího nebo prodejce…"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                  />
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | EscrowStatus)}>
                    <option value="all">Všechny stavy</option>
                    {Object.keys(statusLabel).map((status) => (
                      <option key={status} value={status}>
                        {statusLabel[status as EscrowStatus]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="groupWrap">
                  <div className="group">
                    <h3>K řešení ({grouped.resolve.length})</h3>
                    {grouped.resolve.map((tx) => (
                      <TxCard
                        key={tx.id}
                        tx={tx}
                        note={statusNote[tx.id] || ''}
                        change={statusChange[tx.id] || ''}
                        onNote={(value) => setStatusNote((prev) => ({ ...prev, [tx.id]: value }))}
                        onChange={(value) => setStatusChange((prev) => ({ ...prev, [tx.id]: value }))}
                        onApply={() => void changeStatus(tx)}
                      />
                    ))}
                  </div>

                  <div className="group">
                    <h3>V procesu ({grouped.processing.length})</h3>
                    {grouped.processing.map((tx) => (
                      <TxCard
                        key={tx.id}
                        tx={tx}
                        note={statusNote[tx.id] || ''}
                        change={statusChange[tx.id] || ''}
                        onNote={(value) => setStatusNote((prev) => ({ ...prev, [tx.id]: value }))}
                        onChange={(value) => setStatusChange((prev) => ({ ...prev, [tx.id]: value }))}
                        onApply={() => void changeStatus(tx)}
                      />
                    ))}
                  </div>

                  <div className="group">
                    <h3>Ukončeno ({grouped.closed.length})</h3>
                    {grouped.closed.map((tx) => (
                      <TxCard
                        key={tx.id}
                        tx={tx}
                        note={statusNote[tx.id] || ''}
                        change={statusChange[tx.id] || ''}
                        onNote={(value) => setStatusNote((prev) => ({ ...prev, [tx.id]: value }))}
                        onChange={(value) => setStatusChange((prev) => ({ ...prev, [tx.id]: value }))}
                        onApply={() => void changeStatus(tx)}
                      />
                    ))}
                  </div>
                </div>
              </section>
            </>
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
                        <td>{formatDate(log.createdAt)}</td>
                        <td>{log.transactionCode}</td>
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
                      <th>Typ</th>
                      <th>Přechod</th>
                      <th>Poznámka</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={event.id}>
                        <td>{formatDate(event.createdAt)}</td>
                        <td>{event.transactionCode}</td>
                        <td>{event.eventType}</td>
                        <td>
                          {event.oldStatus || '-'} → {event.newStatus || '-'}
                        </td>
                        <td>{event.note || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'neutral' | 'danger' | 'info' | 'success'
}) {
  return (
    <article className={`statCard ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
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
        <strong>{tx.transactionCode}</strong>
        <span className={`status ${tx.status}`}>{statusLabel[tx.status]}</span>
      </div>

      <p>
        <strong>Order:</strong> {tx.externalOrderId}
      </p>
      <p>
        <strong>Kupující:</strong> {tx.buyerName} ({tx.buyerEmail})
      </p>
      <p>
        <strong>Prodávající:</strong> {tx.sellerName} ({tx.sellerEmail})
      </p>
      <p>
        <strong>Částka:</strong> {formatPrice(tx.amountCzk)} · <strong>Provize:</strong> {formatPrice(tx.feeAmountCzk)} ·{' '}
        <strong>Výplata:</strong> {formatPrice(tx.payoutAmountCzk)}
      </p>
      <p>
        <strong>Update:</strong> {formatDate(tx.updatedAt)}
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
        <input value={note} onChange={(e) => onNote(e.target.value)} placeholder="Důvod/poznámka (povinné pro hold/spor)" />
        <button className="primary" disabled={!change} onClick={onApply}>
          Potvrdit změnu
        </button>
      </div>
    </article>
  )
}

export default App
