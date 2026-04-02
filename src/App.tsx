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

function formatPrice(value: number) {
  return `${new Intl.NumberFormat('cs-CZ').format(value)} Kč`
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('cs-CZ')
}

function App() {
  const [tab, setTab] = useState<'api' | 'admin' | 'emails'>('api')
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

  async function signIn() {
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

  async function signOut() {
    await supabase.auth.signOut()
    setTransactions([])
    setEvents([])
    setEmailLogs([])
  }

  async function reloadAll() {
    setBusy(true)

    const txRes = await supabase
      .from('dpt_transactions')
      .select(
        'id, transaction_code, external_order_id, buyer_name, buyer_email, seller_name, seller_email, amount_czk, fee_amount_czk, payout_amount_czk, status, updated_at',
      )
      .order('created_at', { ascending: false })
      .limit(200)

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
      .limit(200)

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
      .limit(200)

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

  async function createTransaction() {
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

  async function changeStatus(tx: Transaction) {
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

  const groups = useMemo(
    () => ({
      resolve: transactions.filter((t) => ['disputed', 'hold'].includes(t.status)),
      processing: transactions.filter((t) =>
        ['created', 'partial_paid', 'paid', 'shipped', 'delivered'].includes(t.status),
      ),
      closed: transactions.filter((t) =>
        ['completed', 'auto_completed', 'refunded', 'cancelled', 'payout_sent', 'payout_confirmed'].includes(t.status),
      ),
    }),
    [transactions],
  )

  return (
    <div className="app">
      <header className="topbar">
        <h1>Depozitka Core (Supabase live)</h1>
        <p>Napojené na Supabase tabulky `dpt_*` přes RPC + RLS.</p>
      </header>

      {!isAuthed ? (
        <section className="panel">
          <h2>Přihlášení</h2>
          <p className="hint">Přihlas se účtem, který má admin/support roli v `dpt_profiles`.</p>
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
          <button className="primary" disabled={busy} onClick={signIn}>
            {busy ? 'Přihlašuji…' : 'Přihlásit'}
          </button>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="adminTopActions">
              <strong>Přihlášen: {sessionEmail}</strong>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="ghost" onClick={() => void reloadAll()} disabled={busy}>
                  Obnovit data
                </button>
                <button className="ghost" onClick={() => void signOut()} disabled={busy}>
                  Odhlásit
                </button>
              </div>
            </div>
          </section>

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
              <h2>Create transaction</h2>
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
                {busy ? 'Vytvářím…' : 'POST dpt_create_transaction()'}
              </button>
            </section>
          )}

          {tab === 'admin' && (
            <section className="panel">
              <h2>Admin transakce ({transactions.length})</h2>

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
                      onApply={() => void changeStatus(tx)}
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
                      onApply={() => void changeStatus(tx)}
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
                      onApply={() => void changeStatus(tx)}
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
