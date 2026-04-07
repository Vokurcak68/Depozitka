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

// Forward (normální flow) + rollback (admin korekce)
// Rollback přechody jsou v DB (migrace 037) reason_required=true.
export const allowedTransitions: Record<EscrowStatus, EscrowStatus[]> = {
  created: ['partial_paid', 'paid', 'cancelled'],
  partial_paid: ['paid', 'cancelled', 'created'],
  paid: ['shipped', 'disputed', 'hold', 'refunded', 'partial_paid', 'created'],
  shipped: ['delivered', 'disputed', 'hold', 'paid'],
  delivered: ['completed', 'auto_completed', 'disputed', 'hold', 'shipped', 'paid'],
  disputed: ['hold', 'refunded', 'payout_sent', 'cancelled', 'paid', 'shipped', 'delivered'],
  hold: ['disputed', 'refunded', 'payout_sent', 'cancelled', 'paid', 'shipped', 'delivered'],
  payout_sent: ['payout_confirmed', 'completed', 'auto_completed', 'disputed', 'hold'],
  completed: ['payout_sent', 'delivered', 'shipped', 'paid', 'disputed'],
  auto_completed: ['payout_sent', 'delivered', 'shipped', 'disputed'],
  refunded: [],
  cancelled: [],
  payout_confirmed: [],
}

// Přechody vyžadující poznámku/důvod (frontend validace, musí sedět s DB reason_required=true)
// Forward: hold, disputed, refunded, cancelled
// Rollback (admin korekce): vše z migrace 037
export const transitionsRequiringNote: Record<EscrowStatus, EscrowStatus[]> = {
  created: ['cancelled'],
  partial_paid: ['cancelled', 'created'],
  paid: ['disputed', 'hold', 'refunded', 'partial_paid', 'created'],
  shipped: ['disputed', 'hold', 'paid'],
  delivered: ['disputed', 'hold', 'shipped', 'paid'],
  disputed: ['hold', 'refunded', 'cancelled', 'paid', 'shipped', 'delivered'],
  hold: ['disputed', 'refunded', 'cancelled', 'paid', 'shipped', 'delivered'],
  payout_sent: ['completed', 'auto_completed', 'disputed', 'hold'],
  completed: ['delivered', 'shipped', 'paid', 'disputed'],
  auto_completed: ['delivered', 'shipped', 'disputed'],
  refunded: [],
  cancelled: [],
  payout_confirmed: [],
}

export function transitionRequiresNote(from: EscrowStatus, to: EscrowStatus): boolean {
  return transitionsRequiringNote[from]?.includes(to) ?? false
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
