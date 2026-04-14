import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

import type {
  EscrowStatus,
  Theme,
  QuickFilter,
  UserRole,
  BankFilter,
  Transaction,
  TxEvent,
  EmailLog,
  PayoutLog,
  PendingAction,
  Marketplace,
  MarketplaceForm,
  SellerPayoutForm,
  ApiKey,
  ApiKeyCreateForm,
  BankTransaction,
} from './lib/types'
import {
  statusLabel,
  quickFilterLabel,
  emptyMpForm,
  emptySpForm,
  emptyApiKeyForm,
  transitionRequiresNote,
} from './lib/constants'
import {
  normalizeIban,
  roleLabel,
  canUseAdminTabs,
  resolveUserRole,
  formatPrice,
  isCriticalTransition,
  resolveInitialTheme,
} from './lib/utils'
import { getEmailTargetsForStatus, sendEmailDirect } from './lib/email-logic'

import { StatCard } from './components/StatCard'
import { LandingSection, EmptyGroup } from './components/LandingSection'
import { TxCard } from './components/TxCard'
import { TxDrawer } from './components/TxDrawer'
import { ConfirmModal } from './components/ConfirmModal'
import { EmailLogTab } from './components/EmailLogTab'
import { PayoutLogTab } from './components/PayoutLogTab'
import { CronTab } from './components/CronTab'
import { MarketplaceTab } from './components/MarketplaceTab'
import { OperatorTab } from './components/OperatorTab'
import { AlertingTab } from './components/AlertingTab'
import { SupportTicketsTab } from './components/SupportTicketsTab'
import { SellerFallbackTab } from './components/SellerFallbackTab'
import { BankTab } from './components/BankTab'

function App() {
  const [tab, setTab] = useState<'dashboard' | 'emails' | 'payouts' | 'cron' | 'marketplaces' | 'operator' | 'alerting' | 'support' | 'seller-fallback' | 'bank'>('dashboard')
  const [sessionEmail, setSessionEmail] = useState('')
  const [userRole, setUserRole] = useState<UserRole>('unknown')
  const [password, setPassword] = useState('')
  const [isAuthed, setIsAuthed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [emailLogsError, setEmailLogsError] = useState<string | null>(null)
  const [payoutLogsError, setPayoutLogsError] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme)

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [events, setEvents] = useState<TxEvent[]>([])
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([])
  const [payoutLogs, setPayoutLogs] = useState<PayoutLog[]>([])

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
  const [bankSyncBusy, setBankSyncBusy] = useState(false)
  const [bankSyncResult, setBankSyncResult] = useState<string | null>(null)
  const [trackingNumber, setTrackingNumber] = useState<Record<string, string>>({})

  const [statusChange, setStatusChange] = useState<Record<string, EscrowStatus | ''>>({})
  const [statusNote, setStatusNote] = useState<Record<string, string>>({})
  const [manualPaidAmount, setManualPaidAmount] = useState<Record<string, string>>({})
  const [manualEmailBusy, setManualEmailBusy] = useState<Record<string, boolean>>({})
  const [payoutBusy, setPayoutBusy] = useState<Record<string, boolean>>({})
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null)

  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | EscrowStatus>('all')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')

  // ── Effects ──────────────────────────────────────────────

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

  // ── Helpers ──────────────────────────────────────────────

  function notify(type: 'success' | 'error', text: string): void {
    setFlash({ type, text })
  }

  // ── Data loading ─────────────────────────────────────────

  async function reloadAll(): Promise<void> {
    setBusy(true)

    try {
      const txRes = await supabase
        .from('dpt_transactions')
        .select(
          'id, transaction_code, marketplace_id, external_order_id, buyer_name, buyer_email, seller_name, seller_email, seller_payout_iban, seller_payout_account_name, seller_payout_bic, seller_payout_source, seller_payout_locked_at, amount_czk, fee_amount_czk, payout_amount_czk, paid_amount, payment_reference, source, deal_id, metadata, status, updated_at, shipping_carrier, shipping_tracking_number, shieldtrack_shipment_id, st_score, st_status, dpt_marketplaces(code, name)',
        )
        .order('created_at', { ascending: false })
        .limit(300)

      if (txRes.error) {
        setBusy(false)
        notify('error', `Načtení transakcí selhalo: ${txRes.error.message}`)
        return
      }

      const txData = txRes.data || []
      const directDealIds = Array.from(
        new Set(
          txData
            .map((row) => {
              if (typeof row.metadata !== 'object' || row.metadata === null) return null
              const metadata = row.metadata as Record<string, unknown>
              const directDealId = metadata.direct_deal_id
              return typeof directDealId === 'string' && directDealId.length > 0 ? directDealId : null
            })
            .filter((id): id is string => !!id),
        ),
      )

      const directDealTokenById = new Map<string, string>()
      if (directDealIds.length > 0) {
        const directDealRes = await supabase
          .from('dpt_direct_deals')
          .select('id, public_token')
          .in('id', directDealIds)

        if (!directDealRes.error) {
          ;(directDealRes.data || []).forEach((deal) => {
            if (deal?.id && deal?.public_token) {
              directDealTokenById.set(deal.id, deal.public_token)
            }
          })
        }
      }

      const txMap = new Map<string, string>()
      const txRows: Transaction[] = txData.map((row) => {
        txMap.set(row.id, row.transaction_code)
        const marketplace = Array.isArray(row.dpt_marketplaces) ? row.dpt_marketplaces[0] : row.dpt_marketplaces

        const metadata =
          typeof row.metadata === 'object' && row.metadata !== null
            ? (row.metadata as Record<string, unknown>)
            : null
        const metadataDirectDealId =
          metadata && typeof metadata.direct_deal_id === 'string' ? metadata.direct_deal_id : null
        const directDealToken = metadataDirectDealId ? directDealTokenById.get(metadataDirectDealId) : null

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
          source: row.source || 'marketplace',
          dealId: row.deal_id || null,
          directDealUrl: directDealToken ? `https://depozitka.eu/bezpecna-platba/deal/${directDealToken}` : null,
          status: row.status,
          updatedAt: row.updated_at,
          shippingCarrier: row.shipping_carrier || '',
          shippingTrackingNumber: row.shipping_tracking_number || '',
          shieldtrackShipmentId: row.shieldtrack_shipment_id || '',
          stScore: row.st_score ?? null,
          stStatus: row.st_status ?? null,
        }
      })
      setTransactions(txRows)

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

      const payoutRes = await supabase
        .from('dpt_payout_log')
        .select('id, transaction_id, transaction_code, amount_czk, iban, account_name, variable_symbol, fio_response, status, error_message, triggered_by, created_at')
        .order('created_at', { ascending: false })
        .limit(250)

      if (!payoutRes.error) {
        setPayoutLogsError(null)
        setPayoutLogs(
          (payoutRes.data || []).map((row) => ({
            id: row.id,
            transactionId: row.transaction_id,
            transactionCode: row.transaction_code,
            amountCzk: Number(row.amount_czk),
            iban: row.iban,
            accountName: row.account_name,
            variableSymbol: row.variable_symbol,
            fioResponse: row.fio_response,
            status: row.status,
            errorMessage: row.error_message,
            triggeredBy: row.triggered_by,
            createdAt: row.created_at,
          })),
        )
      } else {
        setPayoutLogs([])
        setPayoutLogsError(payoutRes.error.message)
      }

      const mpRes = await supabase
        .from('dpt_marketplaces')
        .select('id, code, name, active, fee_share_percent, settlement_account_name, settlement_iban, settlement_bic, notes, logo_url, accent_color, company_name, company_address, company_id, support_email, website_url')
        .order('name', { ascending: true })

      if (!mpRes.error) {
        setMarketplaces(
          (mpRes.data || []).map((r: any) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            active: Boolean(r.active),
            feeSharePercent: Number(r.fee_share_percent || 0),
            settlementAccountName: r.settlement_account_name || '',
            settlementIban: r.settlement_iban || '',
            settlementBic: r.settlement_bic || '',
            notes: r.notes || '',
            logoUrl: r.logo_url || '',
            accentColor: r.accent_color || '#2563eb',
            companyName: r.company_name || '',
            companyAddress: r.company_address || '',
            companyId: r.company_id || '',
            supportEmail: r.support_email || '',
            websiteUrl: r.website_url || '',
          })),
        )
      }

      try {
        const akRes = await supabase
          .from('dpt_api_keys')
          .select('id, marketplace_id, key_prefix, scopes, active, label, last_used_at, expires_at, revoked_at, revoked_reason, created_at')
          .order('created_at', { ascending: false })
          .limit(100)

        if (!akRes.error) {
          setApiKeys(
            (akRes.data || []).map((r: any) => ({
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
            })),
          )
        }
      } catch (_) {}

      try {
        const bankRes = await supabase
          .from('dpt_bank_transactions')
          .select('id, bank_tx_id, amount, variable_symbol, date, counter_account, message, matched, matched_transaction_id, ignored, ignored_reason, overpaid')
          .order('date', { ascending: false })
          .limit(500)

        if (!bankRes.error) {
          setBankTxs(
            (bankRes.data || []).map((r: any) => ({
              id: r.id,
              bankTxId: r.bank_tx_id,
              amount: Number(r.amount),
              variableSymbol: r.variable_symbol || null,
              date: r.date || '',
              counterAccount: r.counter_account || null,
              message: r.message || null,
              matched: Boolean(r.matched),
              matchedTransactionId: r.matched_transaction_id || null,
              matchedTransactionCode: r.matched_transaction_id
                ? txRows.find((t) => t.id === r.matched_transaction_id)?.transactionCode || r.matched_transaction_id
                : null,
              ignored: Boolean(r.ignored),
              ignoredReason: r.ignored_reason || null,
              overpaid: Boolean(r.overpaid),
            })),
          )
        }
      } catch (_) {}

      setBusy(false)
    } catch (_) {
      setBusy(false)
    }
  }

  // ── Auth ─────────────────────────────────────────────────

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
    setPayoutLogs([])
    setSelectedTx(null)
    setFlash(null)
    setUserRole('unknown')
  }

  // ── Bank operations ──────────────────────────────────────

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

  async function triggerBankSync(): Promise<void> {
    const base = (import.meta.env.VITE_ENGINE_URL || '').trim()
    const token = (import.meta.env.VITE_ENGINE_MANUAL_TRIGGER_TOKEN || '').trim()

    if (!base || !token) {
      notify('error', 'VITE_ENGINE_URL nebo VITE_ENGINE_MANUAL_TRIGGER_TOKEN není nastaven.')
      return
    }

    setBankSyncBusy(true)
    setBankSyncResult(null)

    try {
      const url = `${base.replace(/\/$/, '')}/api/cron/fio-sync?token=${encodeURIComponent(token)}`
      const res = await fetch(url)
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))

      if (!res.ok) {
        notify('error', `Sync selhal: ${data.error || res.status}`)
        setBankSyncResult(`❌ ${data.error || res.status}`)
      } else {
        const msg = `Synchronizováno ${data.synced || 0} pohybů, spárováno ${data.matched || 0}`
        notify('success', msg)
        setBankSyncResult(`✅ ${msg}`)
        await reloadAll()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      notify('error', `Sync selhal: ${msg}`)
      setBankSyncResult(`❌ ${msg}`)
    } finally {
      setBankSyncBusy(false)
    }
  }

  // ── API keys ─────────────────────────────────────────────

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
    if (!mp) {
      notify('error', 'Marketplace nenalezen.')
      return
    }

    const label = apiKeyForm.label.trim() || `Key for ${mp.name}`
    const scopes = apiKeyForm.scopes.split(',').map((s) => s.trim()).filter(Boolean)
    if (scopes.length === 0) {
      notify('error', 'Zadej alespoň jeden scope.')
      return
    }

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

  // ── Marketplace ──────────────────────────────────────────

  function onMarketplacePick(code: string): void {
    setMarketplaceCode(code)
    const m = marketplaces.find((x) => x.code === code)
    if (m) {
      setMarketplaceForm({
        code: m.code,
        name: m.name,
        feeSharePercent: String(m.feeSharePercent),
        settlementAccountName: m.settlementAccountName,
        settlementIban: m.settlementIban,
        settlementBic: m.settlementBic,
        notes: m.notes,
        logoUrl: m.logoUrl,
        accentColor: m.accentColor,
        companyName: m.companyName,
        companyAddress: m.companyAddress,
        companyId: m.companyId,
        supportEmail: m.supportEmail,
        websiteUrl: m.websiteUrl,
      })
    } else {
      setMarketplaceForm({ ...emptyMpForm })
    }
  }

  async function saveMarketplace(): Promise<void> {
    const code = (marketplaceForm.code || marketplaceForm.name).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    if (!code || !marketplaceForm.name.trim()) {
      notify('error', 'Code a Name jsou povinné.')
      return
    }
    setMarketplaceBusy(true)
    const { error } = await supabase.from('dpt_marketplaces').upsert(
      {
        code,
        name: marketplaceForm.name.trim(),
        active: true,
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
      },
      { onConflict: 'code' },
    )
    setMarketplaceBusy(false)
    if (error) {
      notify('error', `Save marketplace: ${error.message}`)
      return
    }
    notify('success', `Marketplace "${code}" uložen.`)
    setMarketplaceCode(code)
    await reloadAll()
  }

  // ── Seller fallback ──────────────────────────────────────

  async function saveSellerFallback(): Promise<void> {
    const txCode = sellerFallbackForm.transactionCode.trim()
    const iban = normalizeIban(sellerFallbackForm.iban)
    if (!txCode || !iban) {
      notify('error', 'Transaction code a IBAN jsou povinné.')
      return
    }
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
    if (error) {
      notify('error', `Seller fallback: ${error.message}`)
      return
    }
    notify('success', `Payout účet pro ${txCode} uložen.`)
    await reloadAll()
  }

  // ── Transaction create ───────────────────────────────────

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

    setShowCreateForm(false)
    await reloadAll()
    // Email se odešle automaticky přes DB trigger (pg_net) po RPC insertu eventu
    notify('success', 'Transakce založena. Email odeslán automaticky.')
  }

  // ── Status change ────────────────────────────────────────

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

    if (targetStatus === 'shipped') {
      const tn = (trackingNumber[tx.id] || '').trim()
      if (tn) {
        const { error: trackErr } = await supabase
          .from('dpt_transactions')
          .update({ shipping_tracking_number: tn })
          .eq('id', tx.id)

        if (trackErr) {
          setBusy(false)
          notify('error', 'Uložení tracking čísla selhalo: ' + trackErr.message)
          return
        }
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
      // Hezčí české hlášky pro známé chyby
      let msg = error.message
      if (/note.*required|reason.*required/i.test(msg)) {
        msg = 'Pro tuto změnu je vyžadována poznámka/důvod.'
      } else if (/not allowed for role/i.test(msg)) {
        msg = `Tento přechod (${tx.status} → ${targetStatus}) není povolený pro tvou roli.`
      }
      notify('error', `Změna stavu selhala: ${msg}`)
      return
    }

    setStatusChange((prev) => ({ ...prev, [tx.id]: '' }))
    setStatusNote((prev) => ({ ...prev, [tx.id]: '' }))
    setManualPaidAmount((prev) => ({ ...prev, [tx.id]: '' }))
    setTrackingNumber((prev) => ({ ...prev, [tx.id]: '' }))
    await reloadAll()
    // Email se odešle automaticky přes DB trigger (pg_net) po insertu eventu
  }

  async function requestStatusChange(tx: Transaction): Promise<void> {
    const targetStatus = statusChange[tx.id]
    if (!targetStatus) return

    const note = (statusNote[tx.id] || '').trim()

    // Vyžadovaná poznámka — buď ji vyžaduje DB (forward i rollback), nebo to jsou kritická akce
    if (transitionRequiresNote(tx.status, targetStatus) && !note) {
      const isRollback = ['paid', 'shipped', 'delivered', 'created', 'partial_paid'].includes(targetStatus)
      const reason = isRollback
        ? 'Vracíš stav zpět — zadej důvod do pole "Poznámka".'
        : 'Pro tuto změnu zadej důvod do pole "Poznámka".'
      notify('error', reason)
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
      notify('error', `Pro stav "${statusLabel[tx.status]}" není dostupná email šablona.`)
      return
    }

    setManualEmailBusy((prev) => ({ ...prev, [tx.id]: true }))

    let sent = 0
    let failed = 0
    for (const target of targets) {
      const result = await sendEmailDirect(tx.id, target.templateKey, target.toEmail)
      if (result.ok) sent++
      else {
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

  async function handlePayout(tx: Transaction): Promise<void> {
    if (!confirm(`Opravdu odeslat výplatu ${tx.payoutAmountCzk} Kč na ${tx.sellerPayoutIban}?\n\nTransakce: ${tx.transactionCode}`)) return

    const base = (import.meta.env.VITE_ENGINE_URL || '').trim()
    const token = (import.meta.env.VITE_ENGINE_MANUAL_TRIGGER_TOKEN || '').trim()
    if (!base || !token) {
      notify('error', 'VITE_ENGINE_URL nebo VITE_ENGINE_MANUAL_TRIGGER_TOKEN není nastaven.')
      return
    }

    setPayoutBusy((prev) => ({ ...prev, [tx.id]: true }))
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/api/payout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ transaction_id: tx.id }),
      })
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))

      if (!res.ok) {
        notify('error', `Výplata selhala: ${data.error || res.status}`)
      } else {
        notify('success', `💸 Výplata ${data.amount} Kč odeslána na ${data.iban}`)
        await reloadAll()
      }
    } catch (err) {
      notify('error', `Výplata selhala: ${err instanceof Error ? err.message : 'Neznámá chyba'}`)
    } finally {
      setPayoutBusy((prev) => ({ ...prev, [tx.id]: false }))
    }
  }

  // ── Computed ─────────────────────────────────────────────

  const summary = useMemo(() => {
    const resolve = transactions.filter((t) => ['disputed', 'hold'].includes(t.status)).length
    const processing = transactions.filter((t) => ['created', 'partial_paid', 'paid', 'shipped', 'delivered'].includes(t.status)).length
    const closed = transactions.filter((t) => ['completed', 'auto_completed', 'refunded', 'cancelled', 'payout_sent', 'payout_confirmed'].includes(t.status)).length
    const totalVolume = transactions.reduce((acc, tx) => acc + tx.amountCzk, 0)
    return { total: transactions.length, resolve, processing, closed, totalVolume }
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
      closed: filteredTransactions.filter((t) => ['completed', 'auto_completed', 'refunded', 'cancelled', 'payout_sent', 'payout_confirmed'].includes(t.status)),
    }),
    [filteredTransactions],
  )

  const selectedTxEvents = useMemo(() => {
    if (!selectedTx) return []
    return events.filter((event) => event.transactionCode === selectedTx.transactionCode)
  }, [events, selectedTx])

  // ── Render helpers ───────────────────────────────────────

  function renderTxGroup(label: string, txList: Transaction[], emptyText: string) {
    return (
      <div className="group">
        <h3>{label} ({txList.length})</h3>
        {txList.length === 0 && <EmptyGroup text={emptyText} />}
        {txList.map((tx) => (
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
            trackingNum={trackingNumber[tx.id] || ''}
            onTrackingNumber={(value) => setTrackingNumber((prev) => ({ ...prev, [tx.id]: value }))}
            onSendManualEmail={() => void sendManualEmailForTx(tx)}
          />
        ))}
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────

  return (
    <div className={`app theme-${theme}`}>
      <header className="hero">
        <div>
          <span className="brandBadge">🛡️ Depozitka · Trust Clean</span>
          <h1>Depozitka Core</h1>
          <p>Bezpečná escrow administrativa s důrazem na jasný stav, audit a rychlé rozhodování.</p>
          {isAuthed && (
            <p className="hint">
              Přihlášený: {sessionEmail || '-'} · Role: <strong>{roleLabel(userRole)}</strong>
            </p>
          )}
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
          <button className="btn btnGhost" style={{ marginLeft: 8, padding: '2px 8px' }} onClick={() => setFlash(null)}>
            Zavřít
          </button>
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
                <button className={tab === 'payouts' ? 'active' : ''} onClick={() => setTab('payouts')}>
                  💸 Výplaty
                </button>
              )}
              {canUseAdminTabs(userRole) && (
                <button className={tab === 'cron' ? 'active' : ''} onClick={() => setTab('cron')}>
                  🔧 Cron
                </button>
              )}
              {canUseAdminTabs(userRole) && (
                <>
                  <button className={tab === 'marketplaces' ? 'active' : ''} onClick={() => setTab('marketplaces')}>
                    Marketplaces
                  </button>
                  <button className={tab === 'operator' ? 'active' : ''} onClick={() => setTab('operator')}>
                    Provozovatel
                  </button>
                  <button className={tab === 'alerting' ? 'active' : ''} onClick={() => setTab('alerting')}>
                    📣 Alerty
                  </button>
                  <button className={tab === 'support' ? 'active' : ''} onClick={() => setTab('support')}>
                    🎫 Support
                  </button>
                  <button className={tab === 'seller-fallback' ? 'active' : ''} onClick={() => setTab('seller-fallback')}>
                    Seller payout
                  </button>
                  <button className={tab === 'bank' ? 'active' : ''} onClick={() => setTab('bank')}>
                    Banka
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
                <StatCard label="Všechny transakce" value={summary.total.toString()} tone="neutral" active={quickFilter === 'all'} onClick={() => { setQuickFilter('all'); setStatusFilter('all') }} />
                <StatCard label="K řešení" value={summary.resolve.toString()} tone="danger" active={quickFilter === 'resolve'} onClick={() => setQuickFilter('resolve')} />
                <StatCard label="V procesu" value={summary.processing.toString()} tone="info" active={quickFilter === 'processing'} onClick={() => setQuickFilter('processing')} />
                <StatCard label="Ukončeno" value={summary.closed.toString()} tone="success" active={quickFilter === 'closed'} onClick={() => setQuickFilter('closed')} />
                <StatCard label="Objem transakcí" value={formatPrice(summary.totalVolume)} tone="neutral" />
              </section>

              {showCreateForm && (
                <section className="panel createPanel">
                  <div className="createPanelBody">
                    <div className="formGrid">
                      <label>External order ID<input value={externalOrderId} onChange={(e) => setExternalOrderId(e.target.value)} /></label>
                      <label>Buyer name<input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} /></label>
                      <label>Buyer email<input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} /></label>
                      <label>Seller name<input value={sellerName} onChange={(e) => setSellerName(e.target.value)} /></label>
                      <label>Seller email<input type="email" value={sellerEmail} onChange={(e) => setSellerEmail(e.target.value)} /></label>
                      <label>Amount (Kč)<input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} /></label>
                      <label>Seller payout IBAN <span className="muted">(volitelné)</span><input value={sellerPayoutIban} onChange={(e) => setSellerPayoutIban(e.target.value)} placeholder="CZ6508000000192000145399" /></label>
                      <label>Seller payout jméno účtu <span className="muted">(volitelné)</span><input value={sellerPayoutAccountName} onChange={(e) => setSellerPayoutAccountName(e.target.value)} /></label>
                      <label>Seller payout BIC <span className="muted">(volitelné)</span><input value={sellerPayoutBic} onChange={(e) => setSellerPayoutBic(e.target.value)} placeholder="GIBACZPX" /></label>
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
                  <input className="searchInput" placeholder="Hledat podle tx, order ID, kupujícího nebo prodejce..." value={searchText} onChange={(e) => setSearchText(e.target.value)} />
                  <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as 'all' | EscrowStatus); setQuickFilter('all') }}>
                    <option value="all">Všechny stavy</option>
                    {Object.keys(statusLabel).map((status) => (
                      <option key={status} value={status}>{statusLabel[status as EscrowStatus]}</option>
                    ))}
                  </select>
                </div>
                <p className="hint filtersHint">
                  Zobrazeno {filteredTransactions.length} / {transactions.length} · Aktivní rychlý filtr: {quickFilterLabel[quickFilter]}
                </p>

                <div className="groupWrap">
                  {renderTxGroup('K řešení', grouped.resolve, 'Momentálně nic k řešení.')}
                  {renderTxGroup('V procesu', grouped.processing, 'Žádná rozpracovaná transakce.')}
                  {renderTxGroup('Ukončeno', grouped.closed, 'Zatím bez ukončených transakcí.')}
                </div>
              </section>
            </>
          )}

          {tab === 'emails' && (
            <EmailLogTab emailLogs={emailLogs} emailLogsError={emailLogsError} events={events} />
          )}

          {canUseAdminTabs(userRole) && tab === 'payouts' && (
            <PayoutLogTab
              payoutLogs={payoutLogs}
              payoutLogsError={payoutLogsError}
              onSelectTransaction={(txId) => {
                const tx = transactions.find((t) => t.id === txId)
                if (tx) {
                  setSelectedTx(tx)
                  setTab('dashboard')
                }
              }}
            />
          )}

          {canUseAdminTabs(userRole) && tab === 'cron' && (
            <CronTab notify={notify} />
          )}

          {canUseAdminTabs(userRole) && tab === 'marketplaces' && (
            <MarketplaceTab
              marketplaces={marketplaces}
              marketplaceCode={marketplaceCode}
              marketplaceForm={marketplaceForm}
              marketplaceBusy={marketplaceBusy}
              apiKeys={apiKeys}
              apiKeyForm={apiKeyForm}
              apiKeyBusy={apiKeyBusy}
              generatedKey={generatedKey}
              onMarketplacePick={onMarketplacePick}
              onMarketplaceFormChange={setMarketplaceForm}
              onMarketplaceCodeChange={setMarketplaceCode}
              onSaveMarketplace={() => void saveMarketplace()}
              onApiKeyFormChange={setApiKeyForm}
              onCreateApiKey={() => void createApiKey()}
              onRevokeApiKey={(id, reason) => void revokeApiKey(id, reason)}
              onGeneratedKeyChange={setGeneratedKey}
              notify={notify}
            />
          )}

          {canUseAdminTabs(userRole) && tab === 'operator' && (
            <OperatorTab notify={notify} />
          )}

          {canUseAdminTabs(userRole) && tab === 'alerting' && (
            <AlertingTab notify={notify} />
          )}

          {canUseAdminTabs(userRole) && tab === 'support' && (
            <SupportTicketsTab notify={notify} />
          )}

          {canUseAdminTabs(userRole) && tab === 'seller-fallback' && (
            <SellerFallbackTab
              transactions={transactions}
              form={sellerFallbackForm}
              busy={sellerFallbackBusy}
              onFormChange={setSellerFallbackForm}
              onSave={() => void saveSellerFallback()}
            />
          )}

          {canUseAdminTabs(userRole) && tab === 'bank' && (
            <BankTab
              bankTxs={bankTxs}
              bankFilter={bankFilter}
              bankBusy={bankBusy}
              bankMatchTxId={bankMatchTxId}
              bankIgnoreReason={bankIgnoreReason}
              bankSyncBusy={bankSyncBusy}
              bankSyncResult={bankSyncResult}
              transactions={transactions}
              onBankFilterChange={setBankFilter}
              onBankMatchTxIdChange={(bankTxId, txId) => setBankMatchTxId((prev) => ({ ...prev, [bankTxId]: txId }))}
              onBankIgnoreReasonChange={(bankTxId, reason) => setBankIgnoreReason((prev) => ({ ...prev, [bankTxId]: reason }))}
              onManualMatch={(bankTxId, txId) => void manualMatchPayment(bankTxId, txId)}
              onIgnore={(bankTxId, reason) => void ignoreBankPayment(bankTxId, reason)}
              onTriggerSync={() => void triggerBankSync()}
            />
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
          payoutBusy={Boolean(payoutBusy[selectedTx.id])}
          engineUrl={(import.meta.env.VITE_ENGINE_URL || '').trim()}
          cronToken={(import.meta.env.VITE_ENGINE_MANUAL_TRIGGER_TOKEN || '').trim()}
          adminEmail={sessionEmail}
          onClose={() => setSelectedTx(null)}
          onChange={(value) => setStatusChange((prev) => ({ ...prev, [selectedTx.id]: value }))}
          onNote={(value) => setStatusNote((prev) => ({ ...prev, [selectedTx.id]: value }))}
          paidAmount={manualPaidAmount[selectedTx.id] || ''}
          onPaidAmount={(value) => setManualPaidAmount((prev) => ({ ...prev, [selectedTx.id]: value }))}
          onApply={() => void requestStatusChange(selectedTx)}
          trackingNum={trackingNumber[selectedTx.id] || ''}
          onTrackingNumber={(value) => setTrackingNumber((prev) => ({ ...prev, [selectedTx.id]: value }))}
          onSendManualEmail={() => void sendManualEmailForTx(selectedTx)}
          onPayout={() => void handlePayout(selectedTx)}
          onRefresh={() => void reloadAll()}
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

export default App
