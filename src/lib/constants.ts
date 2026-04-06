import type { EscrowStatus, QuickFilter, MarketplaceForm, SellerPayoutForm, ApiKeyCreateForm } from './types'

export const statusLabel: Record<EscrowStatus, string> = {
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

export const quickFilterLabel: Record<QuickFilter, string> = {
  all: 'Vše',
  resolve: 'K řešení',
  processing: 'V procesu',
  closed: 'Ukončeno',
}

export const allowedTransitions: Record<EscrowStatus, EscrowStatus[]> = {
  created: ['partial_paid', 'paid', 'cancelled'],
  partial_paid: ['paid', 'cancelled'],
  paid: ['shipped', 'disputed', 'hold', 'refunded'],
  shipped: ['delivered', 'disputed', 'hold'],
  delivered: ['completed', 'auto_completed', 'disputed', 'hold'],
  disputed: ['hold', 'refunded', 'payout_sent', 'cancelled'],
  hold: ['disputed', 'refunded', 'payout_sent', 'cancelled'],
  payout_sent: ['payout_confirmed'],
  completed: ['payout_sent'],
  auto_completed: ['payout_sent'],
  refunded: [],
  cancelled: [],
  payout_confirmed: [],
}

export const CHECK_NAME_CS: Record<string, string> = {
  tracking_exists: 'Tracking číslo existuje',
  tracking_active: 'Zásilka je aktivní',
  recipient_name_match: 'Shoda jména příjemce',
  city_match: 'Shoda města doručení',
  zip_match: 'Shoda PSČ',
  timeline_valid: 'Platná časová osa',
  delivery_confirmed: 'Potvrzení doručení',
}

export const CHECK_ICON: Record<string, string> = {
  passed: '✅',
  warning: '⚠️',
  failed: '❌',
  pending: '⏳',
}

export const emptyMpForm: MarketplaceForm = {
  code: '',
  name: '',
  feeSharePercent: '0',
  settlementAccountName: '',
  settlementIban: '',
  settlementBic: '',
  notes: '',
  logoUrl: '',
  accentColor: '#2563eb',
  companyName: '',
  companyAddress: '',
  companyId: '',
  supportEmail: '',
  websiteUrl: '',
}

export const emptySpForm: SellerPayoutForm = {
  transactionCode: '',
  iban: '',
  accountName: '',
  bic: '',
}

export const emptyApiKeyForm: ApiKeyCreateForm = {
  label: '',
  scopes: 'transactions:create,transactions:read',
  expiresInDays: '',
}
