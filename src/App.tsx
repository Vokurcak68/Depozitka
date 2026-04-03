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

type Theme = 'light' | 'dark'
type QuickFilter = 'all' | 'resolve' | 'processing' | 'closed'

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

interface PendingAction {
  tx: Transaction
  targetStatus: EscrowStatus
  note: string
}

const quickFilterLabel: Record<QuickFilter, string> = {
  all: 'Vše',
  resolve: 'K řešení',
  processing: 'V procesu',
  closed: 'Ukončeno',
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

function getEmailTargetsForStatus(tx: Transaction, adminEmail: string): { templateKey: string; toEmail: string }[] {
  const admin = adminEmail.trim().toLowerCase()

  switch (tx.status) {
    case 'created':
    case 'partial_paid':
      return [
        { templateKey: 'tx_created_buyer', toEmail: tx.buyerEmail },
        { templateKey: 'tx_created_seller', toEmail: tx.sellerEmail },
        ...(admin ? [{ templateKey: 'tx_created_admin', toEmail: admin }] : []),
      ]

    case 'paid':
      return [
        { templateKey: 'payment_received_buyer', toEmail: tx.buyerEmail },
        { templateKey: 'payment_received_seller', toEmail: tx.sellerEmail },
      ]

    case 'shipped':
      return [{ templateKey: 'shipped_buyer', toEmail: tx.buyerEmail }]

    case 'delivered':
      return [
        { templateKey: 'delivered_buyer', toEmail: tx.buyerEmail },
        { templateKey: 'delivered_seller', toEmail: tx.sellerEmail },
      ]

    case 'completed':
    case 'auto_completed':
      return [
        { templateKey: 'completed_buyer', toEmail: tx.buyerEmail },
        { templateKey: 'completed_seller', toEmail: tx.sellerEmail },
      ]

    case 'disputed':
      return [
        { templateKey: 'dispute_opened_buyer', toEmail: tx.buyerEmail },
        { templateKey: 'dispute_opened_seller', toEmail: tx.sellerEmail },
        ...(admin ? [{ templateKey: 'dispute_opened_admin', toEmail: admin }] : []),
      ]

    case 'hold':
      return [
        { templateKey: 'hold_set_buyer', toEmail: tx.buyerEmail },
        { templateKey: 'hold_set_seller', toEmail: tx.sellerEmail },
      ]

    case 'refunded':
      return [
        { templateKey: 'refunded_buyer', toEmail: tx.buyerEmail },
        { templateKey: 'refunded_seller', toEmail: tx.sellerEmail },
      ]

    case 'payout_sent':
    case 'payout_confirmed':
      return [
        { templateKey: 'payout_seller', toEmail: tx.sellerEmail },
        ...(admin ? [{ templateKey: 'payout_admin', toEmail: admin }] : []),
      ]

    case 'cancelled':
    default:
      return []
  }
}

function formatPrice(value: number): string {
  return `${new Intl.NumberFormat('cs-CZ').format(value)} Kč`
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('cs-CZ')
}

function isCriticalTransition(target: EscrowStatus): boolean {
  return ['refunded', 'cancelled', 'payout_sent'].includes(target)
}

function resolveInitialTheme(): Theme {
  const saved = localStorage.getItem('depozitka-theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function App() {
  const [tab, setTab] = useState<'dashboard' | 'emails'>('dashboard')
  const [sessionEmail, setSessionEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isAuthed, setIsAuthed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme)

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [events, setEvents] = useState<TxEvent[]>([])
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([])

  const [externalOrderId, setExternalOrderId] = useState(`ORD-${new Date().getFullYear()}-1001`)
  const [buyerName, setBuyerName] = useState('Testující kupující')
  const [buyerEmail, setBuyerEmail] = useState('buyer@test.cz')
  const [sellerName, setSellerName] = useState('LokoTom')
  const [sellerEmail, setSellerEmail] = useState('seller@test.cz')
  const [amount, setAmount] = useState(1490)
  const [showCreateForm, setShowCreateForm] = useState(false)

  const [statusChange, setStatusChange] = useState<Record<string, EscrowStatus | ''>>({})
  const [statusNote, setStatusNote] = useState<Record<string, string>>({})
  const [manualEmailBusy, setManualEmailBusy] = useState<Record<string, boolean>>({})
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null)

  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | EscrowStatus>('all')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')

  useEffect(() => {
    localStorage.setItem('depozitka-theme', theme)
    document.body.style.background = theme === 'dark' ? '#020617' : '#f8fafc'
  }, [theme])

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 3200)
    return () => window.clearTimeout(timer)
  }, [flash])

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

  function notify(type: 'success' | 'error', text: string): void {
    setFlash({ type, text })
  }

  async function signIn(): Promise<void> {
    if (!sessionEmail || !password) {
      notify('error', 'Vyplň email a heslo.')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: sessionEmail,
      password,
    })
    setBusy(false)
    if (error) {
      notify('error', `Login chyba: ${error.message}`)
      return
    }
    notify('success', 'Přihlášení proběhlo v pořádku.')
    await reloadAll()
  }

  async function signOut(): Promise<void> {
    await supabase.auth.signOut()
    setTransactions([])
    setEvents([])
    setEmailLogs([])
    setSelectedTx(null)
    setFlash(null)
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
      notify('error', `Načtení transakcí selhalo: ${txRes.error.message}`)
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
      notify('error', 'Buyer/seller jméno + email jsou povinné.')
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
      notify('error', `Create transaction selhalo: ${error.message}`)
      return
    }

    notify('success', 'Transakce byla založena.')
    setShowCreateForm(false)
    await reloadAll()
  }

  async function executeStatusChange(tx: Transaction, targetStatus: EscrowStatus, note: string): Promise<void> {
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
      notify('error', `Změna stavu selhala: ${error.message}`)
      return
    }

    setStatusChange((prev) => ({ ...prev, [tx.id]: '' }))
    setStatusNote((prev) => ({ ...prev, [tx.id]: '' }))
    notify('success', `Stav změněn na: ${statusLabel[targetStatus]}`)
    await reloadAll()
  }

  async function requestStatusChange(tx: Transaction): Promise<void> {
    const targetStatus = statusChange[tx.id]
    if (!targetStatus) return

    const note = (statusNote[tx.id] || '').trim()

    if ((targetStatus === 'hold' || targetStatus === 'disputed') && !note) {
      notify('error', 'Pro HOLD/SPOR zadej důvod.')
      return
    }

    if (isCriticalTransition(targetStatus)) {
      setPendingAction({ tx, targetStatus, note })
      return
    }

    await executeStatusChange(tx, targetStatus, note)
  }

  async function sendManualEmailForTx(tx: Transaction): Promise<void> {
    const targets = getEmailTargetsForStatus(tx, sessionEmail)

    if (!targets.length) {
      notify('error', 'Pro stav „' + statusLabel[tx.status] + '“ není dostupná email šablona.')
      return
    }

    setManualEmailBusy((prev) => ({ ...prev, [tx.id]: true }))

    for (const target of targets) {
      const { error } = await supabase.rpc('dpt_queue_email', {
        p_transaction_id: tx.id,
        p_template_key: target.templateKey,
        p_to_email: target.toEmail,
        p_note: 'Manual resend from UI · status=' + tx.status,
      })

      if (error) {
        setManualEmailBusy((prev) => ({ ...prev, [tx.id]: false }))
        notify('error', 'Queue email selhalo: ' + error.message)
        return
      }
    }

    setManualEmailBusy((prev) => ({ ...prev, [tx.id]: false }))
    notify('success', 'Emaily pro stav „' + statusLabel[tx.status] + '“ zařazeny do fronty (' + targets.length + '×).')
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

      const quickOk =
        quickFilter === 'all' ||
        (quickFilter === 'resolve' && ['disputed', 'hold'].includes(tx.status)) ||
        (quickFilter === 'processing' && ['created', 'partial_paid', 'paid', 'shipped', 'delivered'].includes(tx.status)) ||
        (quickFilter === 'closed' && ['completed', 'auto_completed', 'refunded', 'cancelled', 'payout_sent', 'payout_confirmed'].includes(tx.status))

      if (!quickOk) return false

      if (!q) return true

      const haystack = `${tx.transactionCode} ${tx.externalOrderId} ${tx.buyerName} ${tx.buyerEmail} ${tx.sellerName} ${tx.sellerEmail}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [transactions, searchText, statusFilter, quickFilter])

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

  const selectedTxEvents = useMemo(() => {
    if (!selectedTx) return []
    return events.filter((event) => event.transactionCode === selectedTx.transactionCode)
  }, [events, selectedTx])

  return (
    <div className={`app theme-${theme}`}>
      <header className="hero">
        <div>
          <span className="brandBadge">🛡️ Depozitka · Trust Clean</span>
          <h1>Depozitka Core</h1>
          <p>Bezpečná escrow administrativa s důrazem na jasný stav, audit a rychlé rozhodování.</p>
        </div>
        <div className="heroActions">
          <button className="btn btnGhost" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? '🌙 Dark mode' : '☀️ Light mode'}
          </button>
          {isAuthed && (
            <>
              <button className="btn btnGhost" onClick={() => void reloadAll()} disabled={busy}>
                Obnovit data
              </button>
              <button className="btn btnGhost" onClick={() => void signOut()} disabled={busy}>
                Odhlásit
              </button>
            </>
          )}
        </div>
      </header>

      <section className="trustStrip">
        <div>
          <strong>🔒 Důvěra:</strong> kritické akce mají důvod + audit stopu
        </div>
        <div>
          <strong>⚡ Rychlost:</strong> pipeline K řešení / V procesu / Ukončeno
        </div>
        <div>
          <strong>📬 Transparentnost:</strong> email logy a eventy na jednom místě
        </div>
      </section>

      {!isAuthed && (
        <LandingSection
          onLoginClick={() => {
            const element = document.getElementById('login-panel')
            element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        />
      )}

      {flash && <div className={`flash ${flash.type}`}>{flash.text}</div>}

      {!isAuthed ? (
        <section className="panel authPanel" id="login-panel">
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
          <button className="btn btnPrimary" disabled={busy} onClick={() => void signIn()}>
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
                <StatCard
                  label="Všechny transakce"
                  value={summary.total.toString()}
                  tone="neutral"
                  active={quickFilter === 'all'}
                  onClick={() => {
                    setQuickFilter('all')
                    setStatusFilter('all')
                  }}
                />
                <StatCard
                  label="K řešení"
                  value={summary.resolve.toString()}
                  tone="danger"
                  active={quickFilter === 'resolve'}
                  onClick={() => setQuickFilter('resolve')}
                />
                <StatCard
                  label="V procesu"
                  value={summary.processing.toString()}
                  tone="info"
                  active={quickFilter === 'processing'}
                  onClick={() => setQuickFilter('processing')}
                />
                <StatCard
                  label="Ukončeno"
                  value={summary.closed.toString()}
                  tone="success"
                  active={quickFilter === 'closed'}
                  onClick={() => setQuickFilter('closed')}
                />
                <StatCard label="Objem transakcí" value={formatPrice(summary.totalVolume)} tone="neutral" />
              </section>

              <section className="panel createPanel">
                <div className="createPanelHead">
                  <h2>Nová transakce</h2>
                  <button
                    type="button"
                    className="btn btnSecondary"
                    onClick={() => setShowCreateForm((prev) => !prev)}
                  >
                    {showCreateForm ? 'Skrýt formulář' : 'Vytvořit novou transakci'}
                  </button>
                </div>

                {showCreateForm && (
                  <div className="createPanelBody">
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
                    <button className="btn btnPrimary" onClick={() => void createTransaction()} disabled={busy}>
                      {busy ? 'Vytvářím…' : 'Vytvořit transakci'}
                    </button>
                  </div>
                )}
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
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value as 'all' | EscrowStatus)
                      setQuickFilter('all')
                    }}
                  >
                    <option value="all">Všechny stavy</option>
                    {Object.keys(statusLabel).map((status) => (
                      <option key={status} value={status}>
                        {statusLabel[status as EscrowStatus]}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="hint filtersHint">
                  Zobrazeno {filteredTransactions.length} / {transactions.length} · Aktivní rychlý filtr: {quickFilterLabel[quickFilter]}
                </p>

                <div className="groupWrap">
                  <div className="group">
                    <h3>K řešení ({grouped.resolve.length})</h3>
                    {grouped.resolve.length === 0 && <EmptyGroup text="Momentálně nic k řešení." />}
                    {grouped.resolve.map((tx) => (
                      <TxCard
                        key={tx.id}
                        tx={tx}
                        note={statusNote[tx.id] || ''}
                        change={statusChange[tx.id] || ''}
                        emailBusy={Boolean(manualEmailBusy[tx.id])}
                        onNote={(value) => setStatusNote((prev) => ({ ...prev, [tx.id]: value }))}
                        onChange={(value) => setStatusChange((prev) => ({ ...prev, [tx.id]: value }))}
                        onApply={() => void requestStatusChange(tx)}
                        onOpenDetail={() => setSelectedTx(tx)}
                        onSendManualEmail={() => void sendManualEmailForTx(tx)}
                      />
                    ))}
                  </div>

                  <div className="group">
                    <h3>V procesu ({grouped.processing.length})</h3>
                    {grouped.processing.length === 0 && <EmptyGroup text="Žádná rozpracovaná transakce." />}
                    {grouped.processing.map((tx) => (
                      <TxCard
                        key={tx.id}
                        tx={tx}
                        note={statusNote[tx.id] || ''}
                        change={statusChange[tx.id] || ''}
                        emailBusy={Boolean(manualEmailBusy[tx.id])}
                        onNote={(value) => setStatusNote((prev) => ({ ...prev, [tx.id]: value }))}
                        onChange={(value) => setStatusChange((prev) => ({ ...prev, [tx.id]: value }))}
                        onApply={() => void requestStatusChange(tx)}
                        onOpenDetail={() => setSelectedTx(tx)}
                        onSendManualEmail={() => void sendManualEmailForTx(tx)}
                      />
                    ))}
                  </div>

                  <div className="group">
                    <h3>Ukončeno ({grouped.closed.length})</h3>
                    {grouped.closed.length === 0 && <EmptyGroup text="Zatím bez ukončených transakcí." />}
                    {grouped.closed.map((tx) => (
                      <TxCard
                        key={tx.id}
                        tx={tx}
                        note={statusNote[tx.id] || ''}
                        change={statusChange[tx.id] || ''}
                        emailBusy={Boolean(manualEmailBusy[tx.id])}
                        onNote={(value) => setStatusNote((prev) => ({ ...prev, [tx.id]: value }))}
                        onChange={(value) => setStatusChange((prev) => ({ ...prev, [tx.id]: value }))}
                        onApply={() => void requestStatusChange(tx)}
                        onOpenDetail={() => setSelectedTx(tx)}
                        onSendManualEmail={() => void sendManualEmailForTx(tx)}
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

      {selectedTx && (
        <TxDrawer
          tx={selectedTx}
          events={selectedTxEvents}
          change={statusChange[selectedTx.id] || ''}
          note={statusNote[selectedTx.id] || ''}
          emailBusy={Boolean(manualEmailBusy[selectedTx.id])}
          onClose={() => setSelectedTx(null)}
          onChange={(value) => setStatusChange((prev) => ({ ...prev, [selectedTx.id]: value }))}
          onNote={(value) => setStatusNote((prev) => ({ ...prev, [selectedTx.id]: value }))}
          onApply={() => void requestStatusChange(selectedTx)}
          onSendManualEmail={() => void sendManualEmailForTx(selectedTx)}
        />
      )}

      {pendingAction && (
        <ConfirmModal
          title="Potvrzení kritické akce"
          message={`Opravdu chceš změnit stav ${pendingAction.tx.transactionCode} na „${statusLabel[pendingAction.targetStatus]}“?`}
          subText="Tato akce je auditovaná a může ovlivnit vyplacení peněz."
          confirmLabel="Ano, potvrdit"
          onCancel={() => setPendingAction(null)}
          onConfirm={async () => {
            const current = pendingAction
            setPendingAction(null)
            await executeStatusChange(current.tx, current.targetStatus, current.note)
          }}
        />
      )}
    </div>
  )
}

function LandingSection({ onLoginClick }: { onLoginClick: () => void }) {
  return (
    <section className="landing panel">
      <div className="landingHero">
        <div>
          <h2>Escrow, které je srozumitelné i pro běžné uživatele</h2>
          <p>
            Depozitka oddělí peníze od marketplace, vede jasný průběh transakce a chrání kupujícího i prodávajícího.
          </p>
          <div className="landingActions">
            <button className="btn btnPrimary" onClick={onLoginClick}>
              Vstoupit do adminu
            </button>
            <a className="btn btnSecondary linkButton" href="#">
              Dokumentace API (coming soon)
            </a>
          </div>
        </div>
        <div className="landingCard">
          <h3>Flow v kostce</h3>
          <ol>
            <li>Marketplace založí transakci</li>
            <li>Kupující zaplatí do úschovy</li>
            <li>Prodávající odešle zásilku</li>
            <li>Po potvrzení doručení jde výplata prodejci</li>
          </ol>
        </div>
      </div>

      <div className="landingFeatures">
        <article>
          <h3>🔌 Integrace pro marketplace</h3>
          <p>Jednotný escrow engine pro více tržišť, pilotně napojený Test Bazar.</p>
        </article>
        <article>
          <h3>🧾 Audit a dohledatelnost</h3>
          <p>Každá změna stavu i notifikace mají stopu pro interní i právní potřeby.</p>
        </article>
        <article>
          <h3>⚖️ Sporové řízení</h3>
          <p>Spory, hold a refund workflow jsou řízené a vynucují odůvodnění kritických kroků.</p>
        </article>
      </div>
    </section>
  )
}

function EmptyGroup({ text }: { text: string }) {
  return <p className="emptyGroup">{text}</p>
}

function StatCard({
  label,
  value,
  tone,
  active = false,
  onClick,
}: {
  label: string
  value: string
  tone: 'neutral' | 'danger' | 'info' | 'success'
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className={`statCard ${tone} ${active ? 'active' : ''} ${onClick ? '' : 'nonInteractive'}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  )
}

function TxCard({
  tx,
  change,
  note,
  emailBusy = false,
  onChange,
  onNote,
  onApply,
  onOpenDetail,
  onSendManualEmail,
}: {
  tx: Transaction
  change: EscrowStatus | ''
  note: string
  emailBusy?: boolean
  onChange: (value: EscrowStatus | '') => void
  onNote: (value: string) => void
  onApply: () => void
  onOpenDetail: () => void
  onSendManualEmail: () => void
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
        <div className="txButtons">
          <button className="btn btnSecondary" onClick={onOpenDetail}>
            Detail
          </button>
          <button className="btn btnSecondary" disabled={emailBusy} onClick={onSendManualEmail}>
            {emailBusy ? 'Odesílám…' : 'Odeslat email'}
          </button>
          <button className="btn btnPrimary" disabled={!change} onClick={onApply}>
            Potvrdit změnu
          </button>
        </div>
      </div>
    </article>
  )
}

function TxDrawer({
  tx,
  events,
  change,
  note,
  emailBusy = false,
  onClose,
  onChange,
  onNote,
  onApply,
  onSendManualEmail,
}: {
  tx: Transaction
  events: TxEvent[]
  change: EscrowStatus | ''
  note: string
  emailBusy?: boolean
  onClose: () => void
  onChange: (value: EscrowStatus | '') => void
  onNote: (value: string) => void
  onApply: () => void
  onSendManualEmail: () => void
}) {
  const nextOptions = allowedTransitions[tx.status]

  return (
    <div className="drawerOverlay" role="presentation" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="drawerHead">
          <h3>{tx.transactionCode}</h3>
          <button className="btn btnSecondary" onClick={onClose}>
            Zavřít
          </button>
        </div>

        <div className="drawerSection">
          <p>
            <strong>Order:</strong> {tx.externalOrderId}
          </p>
          <p>
            <strong>Stav:</strong> {statusLabel[tx.status]}
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
        </div>

        <div className="drawerSection">
          <h4>Rychlá akce</h4>
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
            <div className="txButtons">
              <button className="btn btnSecondary" disabled={emailBusy} onClick={onSendManualEmail}>
                {emailBusy ? 'Odesílám…' : 'Odeslat email dle stavu'}
              </button>
              <button className="btn btnPrimary" disabled={!change} onClick={onApply}>
                Potvrdit změnu
              </button>
            </div>
          </div>
        </div>

        <div className="drawerSection">
          <h4>Timeline ({events.length})</h4>
          {events.length === 0 ? (
            <p className="hint">Zatím bez eventů.</p>
          ) : (
            <ul className="timeline">
              {events.map((event) => (
                <li key={event.id}>
                  <div>
                    <strong>{event.eventType}</strong>
                    <p>
                      {event.oldStatus || '-'} → {event.newStatus || '-'}
                    </p>
                    {event.note && <p>{event.note}</p>}
                  </div>
                  <span>{formatDate(event.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  )
}

function ConfirmModal({
  title,
  message,
  subText,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  subText: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="modalOverlay" role="presentation" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <p className="hint">{subText}</p>
        <div className="modalActions">
          <button className="btn btnSecondary" onClick={onCancel}>
            Zrušit
          </button>
          <button className="btn btnDanger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
