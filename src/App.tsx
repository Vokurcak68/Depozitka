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
type UserRole = 'admin' | 'support' | 'buyer' | 'seller' | 'service' | 'unknown'


interface Transaction {
  id: string
  transactionCode: string
  marketplaceCode: string
  marketplaceName: string
  externalOrderId: string
  buyerName: string
  buyerEmail: string
  sellerName: string
  sellerEmail: string
  sellerPayoutIban: string
  sellerPayoutAccountName: string
  sellerPayoutBic: string
  sellerPayoutSource: string
  sellerPayoutLockedAt: string
  amountCzk: number
  feeAmountCzk: number
  payoutAmountCzk: number
  paidAmountCzk: number
  paymentReference: string
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
  sentAt?: string | null
  provider?: string | null
  providerMessageId?: string | null
  errorMessage?: string | null
}

interface PendingAction {
  tx: Transaction
  targetStatus: EscrowStatus
  note: string
}

interface Marketplace {
  id: string; code: string; name: string; active: boolean; feeSharePercent: number
  settlementAccountName: string; settlementIban: string; settlementBic: string; notes: string
  logoUrl: string; accentColor: string; companyName: string; companyAddress: string; companyId: string; supportEmail: string; websiteUrl: string
}

interface MarketplaceForm {
  code: string; name: string; feeSharePercent: string
  settlementAccountName: string; settlementIban: string; settlementBic: string; notes: string
  logoUrl: string; accentColor: string; companyName: string; companyAddress: string; companyId: string; supportEmail: string; websiteUrl: string
}

interface SellerPayoutForm {
  transactionCode: string; iban: string; accountName: string; bic: string
}

interface ApiKey {
  id: string
  marketplaceId: string
  keyPrefix: string
  scopes: string[]
  active: boolean
  label: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  revokedReason: string | null
  createdAt: string
}

interface ApiKeyCreateForm {
  label: string
  scopes: string
  expiresInDays: string
}

type BankFilter = 'all' | 'unmatched' | 'matched' | 'ignored' | 'overpaid'

interface BankTransaction {
  id: string
  bankTxId: string
  amount: number
  variableSymbol: string | null
  date: string
  counterAccount: string | null
  message: string | null
  matched: boolean
  matchedTransactionId: string | null
  matchedTransactionCode: string | null
  ignored: boolean
  ignoredReason: string | null
  overpaid: boolean
}

const emptyMpForm: MarketplaceForm = { code: '', name: '', feeSharePercent: '0', settlementAccountName: '', settlementIban: '', settlementBic: '', notes: '', logoUrl: '', accentColor: '#2563eb', companyName: '', companyAddress: '', companyId: '', supportEmail: '', websiteUrl: '' }
const emptySpForm: SellerPayoutForm = { transactionCode: '', iban: '', accountName: '', bic: '' }
const emptyApiKeyForm: ApiKeyCreateForm = { label: '', scopes: 'transactions:create,transactions:read', expiresInDays: '' }

function normalizeIban(v: string): string { return v.replace(/\s+/g, '').toUpperCase() }
function maskIban(v: string): string { const s = normalizeIban(v); if (!s) return '-'; return s.length <= 8 ? s : `${s.slice(0,4)}****${s.slice(-4)}` }
function payoutSourceLabel(v: string): string { return ({ marketplace_api: 'Marketplace API', seller_portal: 'Seller portal', admin_override: 'Admin override' } as Record<string,string>)[v] || v || '-' }
function roleLabel(role: UserRole): string { return ({ admin: 'Admin', support: 'Support', buyer: 'Kupující', seller: 'Prodejce', service: 'Service', unknown: 'Neznámá role' } as Record<UserRole, string>)[role] }
function canUseAdminTabs(role: UserRole): boolean { return role === 'admin' || role === 'support' }
function resolveUserRole(value: string | null | undefined): UserRole {
  const v = (value || '').trim().toLowerCase()
  if (v === 'admin' || v === 'support' || v === 'buyer' || v === 'seller' || v === 'service') return v
  return 'unknown'
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
      return [
        { templateKey: 'tx_created_buyer', toEmail: tx.buyerEmail },
        { templateKey: 'tx_created_seller', toEmail: tx.sellerEmail },
        ...(admin ? [{ templateKey: 'tx_created_admin', toEmail: admin }] : []),
      ]

    case 'partial_paid':
      return [
        { templateKey: 'partial_paid_buyer', toEmail: tx.buyerEmail },
        { templateKey: 'partial_paid_seller', toEmail: tx.sellerEmail },
        ...(admin ? [{ templateKey: 'partial_paid_admin', toEmail: admin }] : []),
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
  const [tab, setTab] = useState<'dashboard' | 'emails' | 'marketplaces' | 'seller-fallback' | 'bank'>('dashboard')
  const [sessionEmail, setSessionEmail] = useState('')
  const [userRole, setUserRole] = useState<UserRole>('unknown')
  const [password, setPassword] = useState('')
  const [isAuthed, setIsAuthed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [emailLogsError, setEmailLogsError] = useState<string | null>(null)
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
  const [sellerPayoutIban, setSellerPayoutIban] = useState('')
  const [sellerPayoutAccountName, setSellerPayoutAccountName] = useState('')
  const [sellerPayoutBic, setSellerPayoutBic] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)

  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([])
  const [marketplaceCode, setMarketplaceCode] = useState('')
  const [marketplaceForm, setMarketplaceForm] = useState<MarketplaceForm>(emptyMpForm)
  const [marketplaceBusy, setMarketplaceBusy] = useState(false)
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [apiKeyForm, setApiKeyForm] = useState<ApiKeyCreateForm>({ ...emptyApiKeyForm })
  const [apiKeyBusy, setApiKeyBusy] = useState(false)
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [sellerFallbackForm, setSellerFallbackForm] = useState<SellerPayoutForm>(emptySpForm)
  const [sellerFallbackBusy, setSellerFallbackBusy] = useState(false)

  const [bankTxs, setBankTxs] = useState<BankTransaction[]>([])
  const [bankFilter, setBankFilter] = useState<BankFilter>('all')
  const [bankBusy, setBankBusy] = useState(false)
  const [bankMatchTxId, setBankMatchTxId] = useState<Record<string, string>>({})
  const [bankIgnoreReason, setBankIgnoreReason] = useState<Record<string, string>>({})


  const [statusChange, setStatusChange] = useState<Record<string, EscrowStatus | ''>>({})
  const [statusNote, setStatusNote] = useState<Record<string, string>>({})
  const [manualPaidAmount, setManualPaidAmount] = useState<Record<string, string>>({})
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
    if (flash.type === 'error') return
    const timer = window.setTimeout(() => setFlash(null), 3200)
    return () => window.clearTimeout(timer)
  }, [flash])

  useEffect(() => {
    const applySessionState = async (
      session: { user: { id: string; email?: string | null } } | null,
    ) => {
      setSessionEmail(session?.user?.email || '')
      setIsAuthed(Boolean(session))

      if (!session) {
        setUserRole('unknown')
        return
      }

      const { data: roleData } = await supabase.rpc('dpt_current_role')
      setUserRole(resolveUserRole(roleData))
    }

    // Bootstrap stavu po F5 - nespoléhat jen na event callback.
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) return
      void applySessionState(data.session as any)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySessionState(session as any)
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

  /**
   * Send a single email immediately via engine /api/send-email (no queue).
   */
  async function sendEmailDirect(transactionId: string, templateKey: string, toEmail: string): Promise<{ ok: boolean; error?: string }> {
    const base = (import.meta.env.VITE_ENGINE_URL || '').trim()
    const token = (import.meta.env.VITE_ENGINE_MANUAL_TRIGGER_TOKEN || '').trim()

    if (!base || !token) {
      return { ok: false, error: 'VITE_ENGINE_URL nebo VITE_ENGINE_MANUAL_TRIGGER_TOKEN není nastaven.' }
    }

    const url = `${base.replace(/\/$/, '')}/api/send-email`

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: transactionId, template_key: templateKey, to_email: toEmail, token }),
      })

      const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))

      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error || `HTTP ${res.status}` }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
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
    const { data: roleData } = await supabase.rpc('dpt_current_role')
    setUserRole(resolveUserRole(roleData))
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
    setUserRole('unknown')
  }

  async function reloadAll(): Promise<void> {
    setBusy(true)

    try {
    const txRes = await supabase
      .from('dpt_transactions')
      .select(
        'id, transaction_code, marketplace_id, external_order_id, buyer_name, buyer_email, seller_name, seller_email, seller_payout_iban, seller_payout_account_name, seller_payout_bic, seller_payout_source, seller_payout_locked_at, amount_czk, fee_amount_czk, payout_amount_czk, paid_amount, payment_reference, status, updated_at, dpt_marketplaces(code, name)',
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
      const marketplace = Array.isArray(row.dpt_marketplaces) ? row.dpt_marketplaces[0] : row.dpt_marketplaces
      return {
        id: row.id,
        transactionCode: row.transaction_code,
        marketplaceCode: marketplace?.code || '-',
        marketplaceName: marketplace?.name || 'Neznámý bazar',
        externalOrderId: row.external_order_id,
        buyerName: row.buyer_name,
        buyerEmail: row.buyer_email,
        sellerName: row.seller_name,
        sellerEmail: row.seller_email,
        sellerPayoutIban: row.seller_payout_iban || '',
        sellerPayoutAccountName: row.seller_payout_account_name || '',
        sellerPayoutBic: row.seller_payout_bic || '',
        sellerPayoutSource: row.seller_payout_source || '',
        sellerPayoutLockedAt: row.seller_payout_locked_at || '',
        amountCzk: Number(row.amount_czk),
        feeAmountCzk: Number(row.fee_amount_czk),
        payoutAmountCzk: Number(row.payout_amount_czk),
        paidAmountCzk: Number(row.paid_amount || 0),
        paymentReference: row.payment_reference || '',
        status: row.status,
        updatedAt: row.updated_at,
      }
    })
    setTransactions(txRows)

    // Keep drawer in sync after reload
    setSelectedTx((prev) => {
      if (!prev) return null
      return txRows.find((t) => t.id === prev.id) || null
    })

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
      .select('id, transaction_id, template_key, to_email, subject, status, created_at, sent_at, provider, provider_message_id, error_message')
      .order('created_at', { ascending: false })
      .limit(250)

    if (!mailRes.error) {
      setEmailLogsError(null)
      setEmailLogs(
        (mailRes.data || []).map((row) => ({
          id: row.id,
          transactionCode: txMap.get(row.transaction_id || '') || row.transaction_id || '-',
          templateKey: row.template_key,
          toEmail: row.to_email,
          subject: row.subject,
          status: row.status,
          createdAt: row.created_at,
          sentAt: row.sent_at,
          provider: row.provider,
          providerMessageId: row.provider_message_id,
          errorMessage: row.error_message,
        })),
      )
    } else {
      setEmailLogs([])
      setEmailLogsError(mailRes.error.message)
    }

    // load marketplaces
    const mpRes = await supabase
      .from('dpt_marketplaces')
      .select('id, code, name, active, fee_share_percent, settlement_account_name, settlement_iban, settlement_bic, notes, logo_url, accent_color, company_name, company_address, company_id, support_email, website_url')
      .order('name', { ascending: true })

    if (!mpRes.error) {
      setMarketplaces((mpRes.data || []).map((r: any) => ({
        id: r.id, code: r.code, name: r.name, active: Boolean(r.active),
        feeSharePercent: Number(r.fee_share_percent || 0),
        settlementAccountName: r.settlement_account_name || '',
        settlementIban: r.settlement_iban || '',
        settlementBic: r.settlement_bic || '',
        notes: r.notes || '',
        logoUrl: r.logo_url || '', accentColor: r.accent_color || '#2563eb',
        companyName: r.company_name || '', companyAddress: r.company_address || '',
        companyId: r.company_id || '', supportEmail: r.support_email || '',
        websiteUrl: r.website_url || '',
      })))
    }

    // load api keys (non-critical - table may not exist yet)
    try {
      const akRes = await supabase
        .from('dpt_api_keys')
        .select('id, marketplace_id, key_prefix, scopes, active, label, last_used_at, expires_at, revoked_at, revoked_reason, created_at')
        .order('created_at', { ascending: false })
        .limit(100)

      if (!akRes.error) {
        setApiKeys((akRes.data || []).map((r: any) => ({
          id: r.id,
          marketplaceId: r.marketplace_id,
          keyPrefix: r.key_prefix,
          scopes: r.scopes || [],
          active: Boolean(r.active),
          label: r.label || '',
          lastUsedAt: r.last_used_at || null,
          expiresAt: r.expires_at || null,
          revokedAt: r.revoked_at || null,
          revokedReason: r.revoked_reason || null,
          createdAt: r.created_at,
        })))
      } else {
      }
    } catch (e) {
    }

    // load bank transactions (non-critical)
    try {
      const bankRes = await supabase
        .from('dpt_bank_transactions')
        .select('id, bank_tx_id, amount, variable_symbol, date, counter_account, message, matched, matched_transaction_id, ignored, ignored_reason, overpaid')
        .order('date', { ascending: false })
        .limit(500)

      if (!bankRes.error) {
        setBankTxs((bankRes.data || []).map((r: any) => ({
          id: r.id,
          bankTxId: r.bank_tx_id,
          amount: Number(r.amount),
          variableSymbol: r.variable_symbol || null,
          date: r.date || '',
          counterAccount: r.counter_account || null,
          message: r.message || null,
          matched: Boolean(r.matched),
          matchedTransactionId: r.matched_transaction_id || null,
          matchedTransactionCode: r.matched_transaction_id ? (txRows.find((t) => t.id === r.matched_transaction_id)?.transactionCode || r.matched_transaction_id) : null,
          ignored: Boolean(r.ignored),
          ignoredReason: r.ignored_reason || null,
          overpaid: Boolean(r.overpaid),
        })))
      }
    } catch (e) {
    }

    setBusy(false)
    } catch (err) {
      setBusy(false)
    }
  }

  async function manualMatchPayment(bankTxId: string, transactionId: string): Promise<void> {
    setBankBusy(true)
    const { data, error } = await supabase.rpc('dpt_manual_match_payment', {
      p_bank_tx_id: bankTxId,
      p_transaction_id: transactionId,
    })
    setBankBusy(false)

    if (error) {
      notify('error', `Párování selhalo: ${error.message}`)
      return
    }

    const result = data as { ok: boolean; error?: string; transaction_code?: string; new_status?: string; overpaid?: boolean }
    if (!result?.ok) {
      notify('error', `Párování selhalo: ${result?.error || 'Neznámá chyba'}`)
      return
    }

    notify('success', `Spárováno s ${result.transaction_code} → ${result.new_status}${result.overpaid ? ' ⚠️ PŘEPLATEK' : ''}`)
    setBankMatchTxId((prev) => ({ ...prev, [bankTxId]: '' }))
    await reloadAll()
  }

  async function ignoreBankPayment(bankTxId: string, reason: string): Promise<void> {
    setBankBusy(true)
    const { data, error } = await supabase.rpc('dpt_ignore_bank_payment', {
      p_bank_tx_id: bankTxId,
      p_reason: reason || null,
    })
    setBankBusy(false)

    if (error) {
      notify('error', `Ignorování selhalo: ${error.message}`)
      return
    }

    const result = data as { ok: boolean; error?: string }
    if (!result?.ok) {
      notify('error', `Ignorování selhalo: ${result?.error || 'Neznámá chyba'}`)
      return
    }

    notify('success', 'Platba označena jako ignorovaná')
    setBankIgnoreReason((prev) => ({ ...prev, [bankTxId]: '' }))
    await reloadAll()
  }

  function generateRandomKey(prefix: string): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = prefix
    for (let i = 0; i < 40; i++) result += chars.charAt(Math.floor(Math.random() * chars.length))
    return result
  }

  async function createApiKey(): Promise<void> {
    if (!marketplaceCode) {
      notify('error', 'Nejdřív vyber marketplace.')
      return
    }
    const mp = marketplaces.find((m) => m.code === marketplaceCode)
    if (!mp) { notify('error', 'Marketplace nenalezen.'); return }

    const label = apiKeyForm.label.trim() || `Key for ${mp.name}`
    const scopes = apiKeyForm.scopes.split(',').map((s) => s.trim()).filter(Boolean)
    if (scopes.length === 0) { notify('error', 'Zadej alespoň jeden scope.'); return }

    const expiresInDays = apiKeyForm.expiresInDays.trim() ? parseInt(apiKeyForm.expiresInDays, 10) : null
    if (expiresInDays !== null && (!Number.isFinite(expiresInDays) || expiresInDays < 1)) {
      notify('error', 'Expirace musí být kladné celé číslo (dny).')
      return
    }

    const prefix = `dpt_live_${mp.code.slice(0, 8)}_`
    const rawKey = generateRandomKey(prefix)

    setApiKeyBusy(true)
    try {
      const { error } = await supabase.rpc('dpt_generate_api_key', {
        p_marketplace_id: mp.id,
        p_key_prefix: prefix,
        p_raw_key: rawKey,
        p_scopes: scopes,
        p_label: label,
        p_expires_in_days: expiresInDays,
      })

      if (error) {
        notify('error', `Generování klíče: ${error.message}`)
        return
      }

      setGeneratedKey(rawKey)
      setApiKeyForm({ ...emptyApiKeyForm })
      notify('success', 'API klíč vygenerován. Zkopíruj ho - nebude znovu zobrazen!')
      await reloadAll()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      notify('error', `Generování klíče: ${message}`)
    } finally {
      setApiKeyBusy(false)
    }
  }

  async function revokeApiKey(keyId: string, reason: string): Promise<void> {
    const { error } = await supabase
      .from('dpt_api_keys')
      .update({ active: false, revoked_at: new Date().toISOString(), revoked_reason: reason || 'Revoked by admin' })
      .eq('id', keyId)

    if (error) {
      notify('error', `Revoke: ${error.message}`)
      return
    }

    notify('success', 'API klíč zrušen.')
    await reloadAll()
  }

    function onMarketplacePick(code: string): void {
    setMarketplaceCode(code)
    const m = marketplaces.find((x) => x.code === code)
    if (m) {
      setMarketplaceForm({ code: m.code, name: m.name, feeSharePercent: String(m.feeSharePercent), settlementAccountName: m.settlementAccountName, settlementIban: m.settlementIban, settlementBic: m.settlementBic, notes: m.notes, logoUrl: m.logoUrl, accentColor: m.accentColor, companyName: m.companyName, companyAddress: m.companyAddress, companyId: m.companyId, supportEmail: m.supportEmail, websiteUrl: m.websiteUrl })
    } else {
      setMarketplaceForm({ ...emptyMpForm })
    }
  }

  async function saveMarketplace(): Promise<void> {
    const code = (marketplaceForm.code || marketplaceForm.name).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    if (!code || !marketplaceForm.name.trim()) { notify('error', 'Code a Name jsou povinné.'); return }
    setMarketplaceBusy(true)
    const { error } = await supabase.from('dpt_marketplaces').upsert({
      code, name: marketplaceForm.name.trim(), active: true,
      fee_share_percent: parseFloat(marketplaceForm.feeSharePercent) || 0,
      settlement_account_name: marketplaceForm.settlementAccountName.trim() || null,
      settlement_iban: normalizeIban(marketplaceForm.settlementIban) || null,
      settlement_bic: marketplaceForm.settlementBic.trim().toUpperCase() || null,
      notes: marketplaceForm.notes.trim() || null,
      logo_url: marketplaceForm.logoUrl.trim() || null,
      accent_color: marketplaceForm.accentColor.trim() || '#2563eb',
      company_name: marketplaceForm.companyName.trim() || null,
      company_address: marketplaceForm.companyAddress.trim() || null,
      company_id: marketplaceForm.companyId.trim() || null,
      support_email: marketplaceForm.supportEmail.trim() || null,
      website_url: marketplaceForm.websiteUrl.trim() || null,
    }, { onConflict: 'code' })
    setMarketplaceBusy(false)
    if (error) { notify('error', `Save marketplace: ${error.message}`); return }
    notify('success', `Marketplace "${code}" uložen.`)
    setMarketplaceCode(code)
    await reloadAll()
  }

  async function saveSellerFallback(): Promise<void> {
    const txCode = sellerFallbackForm.transactionCode.trim()
    const iban = normalizeIban(sellerFallbackForm.iban)
    if (!txCode || !iban) { notify('error', 'Transaction code a IBAN jsou povinné.'); return }
    setSellerFallbackBusy(true)
    const { error } = await supabase.rpc('dpt_set_seller_payout_account', {
      p_transaction_code: txCode,
      p_iban: iban,
      p_account_name: sellerFallbackForm.accountName.trim() || null,
      p_bic: sellerFallbackForm.bic.trim().toUpperCase() || null,
      p_source: 'admin_override',
      p_note: 'Admin override from UI',
    })
    setSellerFallbackBusy(false)
    if (error) { notify('error', `Seller fallback: ${error.message}`); return }
    notify('success', `Payout účet pro ${txCode} uložen.`)
    await reloadAll()
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
      p_metadata: (() => {
        const md: Record<string, string> = { source: 'depozitka-core-ui' }
        const iban = normalizeIban(sellerPayoutIban)
        if (iban) md.seller_payout_iban = iban
        if (sellerPayoutAccountName.trim()) md.seller_payout_account_name = sellerPayoutAccountName.trim()
        if (sellerPayoutBic.trim()) md.seller_payout_bic = sellerPayoutBic.trim().toUpperCase()
        return md
      })(),
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

  function parseManualAmount(raw: string): number | null {
    const normalized = (raw || '').replace(/\s+/g, '').replace(',', '.').trim()
    if (!normalized) return null
    const num = Number(normalized)
    if (!Number.isFinite(num) || num < 0) return null
    return Math.round(num * 100) / 100
  }

  async function executeStatusChange(tx: Transaction, targetStatus: EscrowStatus, note: string): Promise<void> {
    const manualRaw = manualPaidAmount[tx.id] || ''
    const manualAmount = parseManualAmount(manualRaw)

    if (targetStatus === 'partial_paid') {
      if (manualAmount === null) {
        notify('error', 'Pro stav Částečně zaplaceno zadej ručně částku, která už přišla.')
        return
      }
      if (manualAmount <= 0 || manualAmount >= tx.amountCzk) {
        notify('error', 'Částečná úhrada musí být > 0 a zároveň menší než celková částka.')
        return
      }
    }

    setBusy(true)

    if (targetStatus === 'partial_paid' || targetStatus === 'paid') {
      const paidAmount = targetStatus === 'paid' ? (manualAmount ?? tx.amountCzk) : (manualAmount as number)
      const { error: paidErr } = await supabase
        .from('dpt_transactions')
        .update({ paid_amount: paidAmount })
        .eq('id', tx.id)

      if (paidErr) {
        setBusy(false)
        notify('error', 'Uložení ruční úhrady selhalo: ' + paidErr.message)
        return
      }
    }

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
    setManualPaidAmount((prev) => ({ ...prev, [tx.id]: '' }))
    notify('success', `Stav změněn na: ${statusLabel[targetStatus]}`)
    await reloadAll()

    // Send emails immediately for the new status (no queue)
    const updatedTx: Transaction = {
      ...tx,
      status: targetStatus,
      paidAmountCzk: targetStatus === 'paid' ? (manualAmount ?? tx.amountCzk) : targetStatus === 'partial_paid' ? (manualAmount ?? tx.paidAmountCzk) : tx.paidAmountCzk,
    }
    const targets = getEmailTargetsForStatus(updatedTx, sessionEmail)

    if (targets.length > 0) {
      let sent = 0
      let failed = 0
      for (const target of targets) {
        const result = await sendEmailDirect(tx.id, target.templateKey, target.toEmail)
        if (result.ok) sent++
        else {
          failed++
          console.warn(`[Depozitka] Email send failed (${target.templateKey} → ${target.toEmail}):`, result.error)
        }
      }

      if (failed > 0) {
        notify('error', `Odesláno ${sent}/${targets.length} emailů. ${failed} selhalo.`)
      } else if (sent > 0) {
        notify('success', `Stav změněn + ${sent} email${sent > 1 ? 'ů' : ''} odesláno.`)
      }
    }
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
      notify('error', 'Pro stav "' + statusLabel[tx.status] + '" není dostupná email šablona.')
      return
    }

    setManualEmailBusy((prev) => ({ ...prev, [tx.id]: true }))

    let sent = 0
    let failed = 0
    for (const target of targets) {
      const result = await sendEmailDirect(tx.id, target.templateKey, target.toEmail)
      if (result.ok) {
        sent++
      } else {
        failed++
        console.warn(`[Depozitka] Direct email failed (${target.templateKey} → ${target.toEmail}):`, result.error)
      }
    }

    setManualEmailBusy((prev) => ({ ...prev, [tx.id]: false }))

    if (failed > 0 && sent === 0) {
      notify('error', `Odeslání emailů selhalo (${failed}×). Zkontroluj engine konfiguraci.`)
    } else if (failed > 0) {
      notify('error', `Odesláno ${sent}/${targets.length} emailů. ${failed} selhalo.`)
    } else {
      notify('success', `${sent} email${sent > 1 ? 'ů' : ''} pro stav "${statusLabel[tx.status]}" odesláno ihned.`)
    }

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
          {isAuthed && <p className="hint">Přihlášený: {sessionEmail || '-'} · Role: <strong>{roleLabel(userRole)}</strong></p>}
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

      {flash && (
        <div className={`flash ${flash.type}`} role="alert">
          <span>{flash.text}</span>
          <button className="btn btnGhost" style={{ marginLeft: 8, padding: '2px 8px' }} onClick={() => setFlash(null)}>Zavřít</button>
        </div>
      )}

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
            {busy ? 'Přihlašuji...' : 'Přihlásit'}
          </button>
        </section>
      ) : (
        <>
          <div className="tabsRow">
            <nav className="tabs">
              <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>
                Dashboard
              </button>
              <button className={tab === 'emails' ? 'active' : ''} onClick={() => setTab('emails')}>
                Email + audit
              </button>
              {canUseAdminTabs(userRole) && (
                <>
                  <button className={tab === 'marketplaces' ? 'active' : ''} onClick={() => setTab('marketplaces')}>
                    Marketplaces
                  </button>
                  <button className={tab === 'seller-fallback' ? 'active' : ''} onClick={() => setTab('seller-fallback')}>
                    Seller payout
                  </button>
                  <button className={tab === 'bank' ? 'active' : ''} onClick={() => setTab('bank')}>
                    💰 Banka
                  </button>
                </>
              )}
            </nav>
            <button type="button" className="btn btnPrimary tabsCreateBtn" onClick={() => setShowCreateForm((prev) => !prev)}>
              {showCreateForm ? 'Skrýt formulář' : 'Vytvořit novou transakci'}
            </button>
          </div>

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

              {showCreateForm && (
                <section className="panel createPanel">
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
                      <label>
                        Seller payout IBAN <span className="muted">(volitelné)</span>
                        <input value={sellerPayoutIban} onChange={(e) => setSellerPayoutIban(e.target.value)} placeholder="CZ6508000000192000145399" />
                      </label>
                      <label>
                        Seller payout jméno účtu <span className="muted">(volitelné)</span>
                        <input value={sellerPayoutAccountName} onChange={(e) => setSellerPayoutAccountName(e.target.value)} />
                      </label>
                      <label>
                        Seller payout BIC <span className="muted">(volitelné)</span>
                        <input value={sellerPayoutBic} onChange={(e) => setSellerPayoutBic(e.target.value)} placeholder="GIBACZPX" />
                      </label>
                    </div>
                    <button className="btn btnPrimary" onClick={() => void createTransaction()} disabled={busy}>
                      {busy ? 'Vytvářím...' : 'Vytvořit transakci'}
                    </button>
                  </div>
                </section>
              )}

              <section className="panel">
                <h2>Escrow pipeline</h2>
                <div className="filtersRow">
                  <input
                    className="searchInput"
                    placeholder="Hledat podle tx, order ID, kupujícího nebo prodejce..."
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
                        paidAmount={manualPaidAmount[tx.id] || ''}
                        onPaidAmount={(value) => setManualPaidAmount((prev) => ({ ...prev, [tx.id]: value }))}
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
                        paidAmount={manualPaidAmount[tx.id] || ''}
                        onPaidAmount={(value) => setManualPaidAmount((prev) => ({ ...prev, [tx.id]: value }))}
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
                        paidAmount={manualPaidAmount[tx.id] || ''}
                        onPaidAmount={(value) => setManualPaidAmount((prev) => ({ ...prev, [tx.id]: value }))}
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
              {emailLogsError && (
                <p className="errorText" style={{ marginBottom: 12 }}>
                  Načtení email logů selhalo: {emailLogsError}
                </p>
              )}
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
                      <th>Odesláno</th>
                      <th>Provider ID</th>
                      <th>Chyba</th>
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
                        <td>{log.sentAt ? formatDate(log.sentAt) : '-'}</td>
                        <td>{log.providerMessageId || '-'}</td>
                        <td>{log.errorMessage || '-'}</td>
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

          {canUseAdminTabs(userRole) && tab === 'marketplaces' && (
            <section className="panel">
              <h2>Evidence marketplace</h2>
              <p className="muted">Správa napojených bazarů, settlement účtů a revshare.</p>

              <div className="gridTwo">
                <div>
                  <h3>Seznam</h3>
                  <div className="marketplaceList">
                    {marketplaces.map((m) => (
                      <button key={m.id} className={marketplaceCode === m.code ? 'active' : ''} onClick={() => onMarketplacePick(m.code)}>
                        <strong>{m.name}</strong>
                        <span className="muted">{m.code} · {m.feeSharePercent}%</span>
                      </button>
                    ))}
                    {marketplaces.length === 0 && <p className="hint">Žádné marketplace.</p>}
                  </div>
                </div>

                <div>
                  <h3>{marketplaceCode ? 'Editovat' : 'Nový marketplace'}</h3>
                  <div className="formGrid">
                    <label>Code<input value={marketplaceForm.code} onChange={(e) => setMarketplaceForm((p) => ({ ...p, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} /></label>
                    <label>Name<input value={marketplaceForm.name} onChange={(e) => setMarketplaceForm((p) => ({ ...p, name: e.target.value }))} /></label>
                    <h4 style={{ marginBottom: '4px', color: '#6b7280', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', gridColumn: '1 / -1' }}>⚙️ Provozní údaje</h4>
                    <label>Fee share %<input type="number" min={0} max={100} step={0.1} value={marketplaceForm.feeSharePercent} onChange={(e) => setMarketplaceForm((p) => ({ ...p, feeSharePercent: e.target.value }))} /></label>
                    <label>Settlement account name<input value={marketplaceForm.settlementAccountName} onChange={(e) => setMarketplaceForm((p) => ({ ...p, settlementAccountName: e.target.value }))} /></label>
                    <label>Settlement IBAN<input value={marketplaceForm.settlementIban} onChange={(e) => setMarketplaceForm((p) => ({ ...p, settlementIban: e.target.value }))} /></label>
                    <label>Settlement BIC<input value={marketplaceForm.settlementBic} onChange={(e) => setMarketplaceForm((p) => ({ ...p, settlementBic: e.target.value }))} /></label>
                  </div>
                  <h4 style={{ marginTop: '20px', marginBottom: '8px', borderTop: '1px solid #e5e7eb', paddingTop: '16px', color: '#6b7280', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>📧 E-mail branding</h4>
                  <div className="formGrid">
                    <label>Logo URL<input value={marketplaceForm.logoUrl} onChange={(e) => setMarketplaceForm((p) => ({ ...p, logoUrl: e.target.value }))} placeholder="https://..." /></label>
                    <label>Accent barva<input type="color" value={marketplaceForm.accentColor} onChange={(e) => setMarketplaceForm((p) => ({ ...p, accentColor: e.target.value }))} style={{ height: '38px' }} /></label>
                    <label>Název firmy<input value={marketplaceForm.companyName} onChange={(e) => setMarketplaceForm((p) => ({ ...p, companyName: e.target.value }))} placeholder="Firma s.r.o." /></label>
                    <label>Adresa firmy<input value={marketplaceForm.companyAddress} onChange={(e) => setMarketplaceForm((p) => ({ ...p, companyAddress: e.target.value }))} placeholder="Ulice 123, 110 00 Praha" /></label>
                    <label>IČO / DIČ<input value={marketplaceForm.companyId} onChange={(e) => setMarketplaceForm((p) => ({ ...p, companyId: e.target.value }))} placeholder="12345678" /></label>
                    <label>Kontaktní email<input type="email" value={marketplaceForm.supportEmail} onChange={(e) => setMarketplaceForm((p) => ({ ...p, supportEmail: e.target.value }))} placeholder="info@example.cz" /></label>
                    <label>Web<input type="url" value={marketplaceForm.websiteUrl} onChange={(e) => setMarketplaceForm((p) => ({ ...p, websiteUrl: e.target.value }))} placeholder="https://example.cz" /></label>
                  </div>
                  <label>Notes<textarea value={marketplaceForm.notes} onChange={(e) => setMarketplaceForm((p) => ({ ...p, notes: e.target.value }))} rows={3} /></label>
                  <div className="rowActions">
                    <button className="btn btnPrimary" onClick={() => void saveMarketplace()} disabled={marketplaceBusy}>
                      {marketplaceBusy ? 'Ukládám...' : 'Uložit marketplace'}
                    </button>
                    <button className="btn btnSecondary" onClick={() => { setMarketplaceCode(''); setMarketplaceForm({ ...emptyMpForm }) }}>
                      Nový záznam
                    </button>
                  </div>
                </div>
              </div>

              <hr className="sectionDivider" />

              <h2>API klíče {marketplaceCode ? `- ${marketplaceCode}` : ''}</h2>
              {!marketplaceCode && <p className="hint">Vyber marketplace vlevo pro správu klíčů.</p>}

              {marketplaceCode && (
                <>
                  <div className="apiKeysTable">
                    <table>
                      <thead>
                        <tr>
                          <th>Prefix</th>
                          <th>Label</th>
                          <th>Scopes</th>
                          <th>Stav</th>
                          <th>Poslední použití</th>
                          <th>Expirace</th>
                          <th>Akce</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apiKeys
                          .filter((k) => {
                            const mp = marketplaces.find((m) => m.code === marketplaceCode)
                            return mp && k.marketplaceId === mp.id
                          })
                          .map((k) => (
                            <tr key={k.id} className={k.revokedAt ? 'revoked' : ''}>
                              <td><code>{k.keyPrefix}***</code></td>
                              <td>{k.label || '-'}</td>
                              <td className="scopesList">{k.scopes.join(', ')}</td>
                              <td>{k.revokedAt ? '🔴 Zrušen' : k.active ? '🟢 Aktivní' : '⚪ Neaktivní'}</td>
                              <td>{k.lastUsedAt ? formatDate(k.lastUsedAt) : 'Nikdy'}</td>
                              <td>{k.expiresAt ? formatDate(k.expiresAt) : 'Bez expirace'}</td>
                              <td>
                                {!k.revokedAt && (
                                  <button
                                    className="btn btnDanger btnSm"
                                    onClick={() => {
                                      const reason = prompt('Důvod zrušení klíče:')
                                      if (reason !== null) void revokeApiKey(k.id, reason)
                                    }}
                                  >
                                    Revoke
                                  </button>
                                )}
                                {k.revokedAt && <span className="muted">{k.revokedReason || '-'}</span>}
                              </td>
                            </tr>
                          ))}
                        {apiKeys.filter((k) => {
                          const mp = marketplaces.find((m) => m.code === marketplaceCode)
                          return mp && k.marketplaceId === mp.id
                        }).length === 0 && (
                          <tr><td colSpan={7} className="hint">Žádné API klíče pro tento marketplace.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <h3>Vygenerovat nový klíč</h3>
                  <div className="formGrid">
                    <label>Label<input value={apiKeyForm.label} onChange={(e) => setApiKeyForm((p) => ({ ...p, label: e.target.value }))} placeholder="Production key" /></label>
                    <label>Scopes (čárkou)<input value={apiKeyForm.scopes} onChange={(e) => setApiKeyForm((p) => ({ ...p, scopes: e.target.value }))} /></label>
                    <label>Expirace (dny, prázdné = bez)<input type="number" min={1} value={apiKeyForm.expiresInDays} onChange={(e) => setApiKeyForm((p) => ({ ...p, expiresInDays: e.target.value }))} /></label>
                  </div>
                  <div className="rowActions">
                    <button className="btn btnPrimary" onClick={() => void createApiKey()} disabled={apiKeyBusy}>
                      {apiKeyBusy ? 'Generuji...' : '🔑 Vygenerovat API klíč'}
                    </button>
                  </div>

                  {generatedKey && (
                    <div className="generatedKeyBox">
                      <p><strong>⚠️ Nový klíč - zkopíruj ho teď, nebude znovu zobrazen!</strong></p>
                      <code className="generatedKeyValue">{generatedKey}</code>
                      <button className="btn btnSecondary btnSm" onClick={() => { void navigator.clipboard.writeText(generatedKey); notify('success', 'Zkopírováno!') }}>
                        📋 Kopírovat
                      </button>
                      <button className="btn btnGhost btnSm" onClick={() => setGeneratedKey(null)}>Zavřít</button>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {canUseAdminTabs(userRole) && tab === 'seller-fallback' && (
            <section className="panel">
              <h2>Seller payout fallback</h2>
              <p className="muted">Použij, když marketplace neposlal payout účet při create transaction. Po stavu "paid" je účet zamčený.</p>

              <div className="formGrid">
                <label>
                  Transakce
                  <select value={sellerFallbackForm.transactionCode} onChange={(e) => {
                    const code = e.target.value
                    const tx = transactions.find((t) => t.transactionCode === code)
                    setSellerFallbackForm(tx ? { transactionCode: tx.transactionCode, iban: tx.sellerPayoutIban, accountName: tx.sellerPayoutAccountName, bic: tx.sellerPayoutBic } : { ...emptySpForm, transactionCode: code })
                  }}>
                    <option value="">Vyber transakci</option>
                    {transactions.map((tx) => (
                      <option key={tx.id} value={tx.transactionCode}>
                        {tx.transactionCode} · {tx.sellerName} · {statusLabel[tx.status]} {tx.sellerPayoutLockedAt ? '🔒' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>IBAN<input value={sellerFallbackForm.iban} onChange={(e) => setSellerFallbackForm((p) => ({ ...p, iban: e.target.value }))} /></label>
                <label>Account name<input value={sellerFallbackForm.accountName} onChange={(e) => setSellerFallbackForm((p) => ({ ...p, accountName: e.target.value }))} /></label>
                <label>BIC<input value={sellerFallbackForm.bic} onChange={(e) => setSellerFallbackForm((p) => ({ ...p, bic: e.target.value }))} /></label>
              </div>

              <div className="rowActions">
                <button className="btn btnPrimary" onClick={() => void saveSellerFallback()} disabled={sellerFallbackBusy || !sellerFallbackForm.transactionCode || !sellerFallbackForm.iban}>
                  {sellerFallbackBusy ? 'Ukládám...' : 'Uložit payout účet'}
                </button>
              </div>
            </section>
          )}

          {canUseAdminTabs(userRole) && tab === 'bank' && (() => {
            const filtered = bankTxs.filter((b) => {
              if (bankFilter === 'unmatched') return !b.matched && !b.ignored
              if (bankFilter === 'matched') return b.matched
              if (bankFilter === 'ignored') return b.ignored
              if (bankFilter === 'overpaid') return b.overpaid
              return true
            })
            const counts = {
              total: bankTxs.length,
              unmatched: bankTxs.filter((b) => !b.matched && !b.ignored).length,
              matched: bankTxs.filter((b) => b.matched).length,
              ignored: bankTxs.filter((b) => b.ignored).length,
              overpaid: bankTxs.filter((b) => b.overpaid).length,
            }
            const payableTxs = transactions.filter((t) => t.status === 'created' || t.status === 'partial_paid')

            return (
              <section className="panel">
                <h2>💰 Bankovní pohyby</h2>
                <p className="muted">Příchozí platby z FIO banky. Nespárované platby přiřaď ručně k transakci nebo označ jako ignorované.</p>

                <section className="statsGrid">
                  <StatCard label="Celkem" value={String(counts.total)} tone="neutral" />
                  <StatCard label="Nespárované" value={String(counts.unmatched)} tone={counts.unmatched > 0 ? 'danger' : 'neutral'} />
                  <StatCard label="Spárované" value={String(counts.matched)} tone="success" />
                  <StatCard label="Ignorované" value={String(counts.ignored)} tone="neutral" />
                  <StatCard label="Přeplatky" value={String(counts.overpaid)} tone={counts.overpaid > 0 ? 'danger' : 'neutral'} />
                </section>

                <div className="filterRow" style={{ marginBottom: 12 }}>
                  {(['all', 'unmatched', 'matched', 'ignored', 'overpaid'] as BankFilter[]).map((f) => (
                    <button key={f} className={bankFilter === f ? 'btn btnPrimary' : 'btn btnSecondary'} onClick={() => setBankFilter(f)}>
                      {{ all: 'Vše', unmatched: 'Nespárované', matched: 'Spárované', ignored: 'Ignorované', overpaid: 'Přeplatky' }[f]}
                    </button>
                  ))}
                </div>

                {filtered.length === 0 ? (
                  <p className="muted">Žádné pohyby v tomto filtru.</p>
                ) : (
                  <div className="tableWrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Datum</th>
                          <th>Částka</th>
                          <th>VS</th>
                          <th>Protiúčet</th>
                          <th>Zpráva</th>
                          <th>Stav</th>
                          <th>Transakce</th>
                          <th>Akce</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((b) => (
                          <tr key={b.id}>
                            <td>{b.date ? formatDate(b.date) : '-'}</td>
                            <td style={{ fontWeight: 600 }}>{formatPrice(b.amount)}</td>
                            <td><code>{b.variableSymbol || '-'}</code></td>
                            <td style={{ fontSize: '0.85em' }}>{b.counterAccount || '-'}</td>
                            <td style={{ fontSize: '0.85em', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.message || '-'}</td>
                            <td>
                              {b.ignored && <span className="badge" style={{ background: '#6b7280' }}>Ignorováno</span>}
                              {b.matched && !b.overpaid && <span className="badge" style={{ background: '#22c55e' }}>Spárováno</span>}
                              {b.overpaid && <span className="badge" style={{ background: '#ef4444' }}>⚠️ Přeplatek</span>}
                              {!b.matched && !b.ignored && <span className="badge" style={{ background: '#f59e0b' }}>Nespárováno</span>}
                            </td>
                            <td>
                              {b.matchedTransactionCode ? <code>{b.matchedTransactionCode}</code> : '-'}
                              {b.ignored && b.ignoredReason ? <small style={{ display: 'block', color: '#9ca3af' }}>{b.ignoredReason}</small> : null}
                            </td>
                            <td>
                              {!b.matched && !b.ignored && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 180 }}>
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    <select
                                      value={bankMatchTxId[b.bankTxId] || ''}
                                      onChange={(e) => setBankMatchTxId((prev) => ({ ...prev, [b.bankTxId]: e.target.value }))}
                                      style={{ flex: 1, fontSize: '0.85em' }}
                                    >
                                      <option value="">Přiřadit k…</option>
                                      {payableTxs.map((tx) => (
                                        <option key={tx.id} value={tx.id}>
                                          {tx.transactionCode} · {formatPrice(tx.amountCzk)} · {tx.buyerName}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      className="btn btnPrimary"
                                      style={{ fontSize: '0.8em', padding: '2px 8px' }}
                                      disabled={bankBusy || !bankMatchTxId[b.bankTxId]}
                                      onClick={() => void manualMatchPayment(b.bankTxId, bankMatchTxId[b.bankTxId])}
                                    >
                                      ✓
                                    </button>
                                  </div>
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    <input
                                      value={bankIgnoreReason[b.bankTxId] || ''}
                                      onChange={(e) => setBankIgnoreReason((prev) => ({ ...prev, [b.bankTxId]: e.target.value }))}
                                      placeholder="Důvod ignorování…"
                                      style={{ flex: 1, fontSize: '0.85em' }}
                                    />
                                    <button
                                      className="btn btnSecondary"
                                      style={{ fontSize: '0.8em', padding: '2px 8px' }}
                                      disabled={bankBusy}
                                      onClick={() => void ignoreBankPayment(b.bankTxId, bankIgnoreReason[b.bankTxId] || '')}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )
          })()}
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
          paidAmount={manualPaidAmount[selectedTx.id] || ''}
          onPaidAmount={(value) => setManualPaidAmount((prev) => ({ ...prev, [selectedTx.id]: value }))}
          onApply={() => void requestStatusChange(selectedTx)}
          onSendManualEmail={() => void sendManualEmailForTx(selectedTx)}
        />
      )}

      {pendingAction && (
        <ConfirmModal
          title="Potvrzení kritické akce"
          message={`Opravdu chceš změnit stav ${pendingAction.tx.transactionCode} na "${statusLabel[pendingAction.targetStatus]}"?`}
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
  paidAmount = '',
  emailBusy = false,
  onChange,
  onNote,
  onPaidAmount,
  onApply,
  onOpenDetail,
  onSendManualEmail,
}: {
  tx: Transaction
  change: EscrowStatus | ''
  note: string
  paidAmount?: string
  emailBusy?: boolean
  onChange: (value: EscrowStatus | '') => void
  onNote: (value: string) => void
  onPaidAmount?: (value: string) => void
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
        <strong>Bazar:</strong> {tx.marketplaceName} <span className="muted">({tx.marketplaceCode})</span>
      </p>
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
        <strong>Payout:</strong> {maskIban(tx.sellerPayoutIban)} · {payoutSourceLabel(tx.sellerPayoutSource)}
        {tx.sellerPayoutLockedAt ? ' 🔒' : ''}
      </p>
      <p>
        <strong>Částka:</strong> {formatPrice(tx.amountCzk)} · <strong>Provize:</strong> {formatPrice(tx.feeAmountCzk)} ·{' '}
        <strong>Výplata:</strong> {formatPrice(tx.payoutAmountCzk)}
      </p>
      {tx.paidAmountCzk > 0 && (
        <p>
          <strong>Uhrazeno:</strong> {formatPrice(tx.paidAmountCzk)} · <strong>Zbývá:</strong> {formatPrice(tx.amountCzk - tx.paidAmountCzk)}
        </p>
      )}
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
        {change === 'partial_paid' && (
          <input
            type="number"
            min={0}
            max={tx.amountCzk}
            step={0.01}
            value={paidAmount}
            onChange={(e) => onPaidAmount?.(e.target.value)}
            placeholder="Již uhrazeno (Kč)"
            style={{ borderColor: '#f59e0b' }}
          />
        )}
        <div className="txButtons">
          <button className="btn btnSecondary" onClick={onOpenDetail}>
            Detail
          </button>
          <button className="btn btnSecondary" disabled={emailBusy} onClick={onSendManualEmail}>
            {emailBusy ? 'Odesílám...' : 'Odeslat email'}
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
  paidAmount = '',
  emailBusy = false,
  onClose,
  onChange,
  onNote,
  onPaidAmount,
  onApply,
  onSendManualEmail,
}: {
  tx: Transaction
  events: TxEvent[]
  change: EscrowStatus | ''
  note: string
  paidAmount?: string
  emailBusy?: boolean
  onClose: () => void
  onChange: (value: EscrowStatus | '') => void
  onNote: (value: string) => void
  onPaidAmount?: (value: string) => void
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
            <strong>Bazar:</strong> {tx.marketplaceName} <span className="muted">({tx.marketplaceCode})</span>
          </p>
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
          <p><strong>Payout IBAN:</strong> {maskIban(tx.sellerPayoutIban)}</p>
          <p><strong>Payout jméno:</strong> {tx.sellerPayoutAccountName || '-'}</p>
          <p><strong>Payout BIC:</strong> {tx.sellerPayoutBic || '-'}</p>
          <p><strong>Payout source:</strong> {payoutSourceLabel(tx.sellerPayoutSource)}</p>
          <p><strong>Payout lock:</strong> {tx.sellerPayoutLockedAt ? `🔒 ${formatDate(tx.sellerPayoutLockedAt)}` : 'Odemčeno'}</p>
          <p>
            <strong>Částka:</strong> {formatPrice(tx.amountCzk)} · <strong>Provize:</strong> {formatPrice(tx.feeAmountCzk)} ·{' '}
            <strong>Výplata:</strong> {formatPrice(tx.payoutAmountCzk)}
          </p>
          {tx.paidAmountCzk > 0 && (
            <p>
              <strong>Uhrazeno:</strong> {formatPrice(tx.paidAmountCzk)} · <strong>Zbývá:</strong> {formatPrice(tx.amountCzk - tx.paidAmountCzk)}
            </p>
          )}
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
            {change === 'partial_paid' && (
              <input
                type="number"
                min={0}
                max={tx.amountCzk}
                step={0.01}
                value={paidAmount}
                onChange={(e) => onPaidAmount?.(e.target.value)}
                placeholder="Již uhrazeno (Kč)"
                style={{ borderColor: '#f59e0b' }}
              />
            )}
            <div className="txButtons">
              <button className="btn btnSecondary" disabled={emailBusy} onClick={onSendManualEmail}>
                {emailBusy ? 'Odesílám...' : 'Odeslat email dle stavu'}
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
