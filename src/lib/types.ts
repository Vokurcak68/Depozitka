export type EscrowStatus =
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

export type Theme = 'light' | 'dark'
export type QuickFilter = 'all' | 'resolve' | 'processing' | 'closed'
export type UserRole = 'admin' | 'support' | 'buyer' | 'seller' | 'service' | 'unknown'
export type BankFilter = 'all' | 'unmatched' | 'matched' | 'ignored' | 'overpaid'

export interface Transaction {
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
  source: string
  dealId: string | null
  directDealUrl: string | null
  status: EscrowStatus
  updatedAt: string
  shippingCarrier: string
  shippingTrackingNumber: string
  shieldtrackShipmentId: string
  stScore: number | null
  stStatus: string | null
}

export interface TxEvent {
  id: string
  transactionCode: string
  eventType: string
  oldStatus?: string
  newStatus?: string
  note?: string
  createdAt: string
}

export interface EmailLog {
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

export interface PendingAction {
  tx: Transaction
  targetStatus: EscrowStatus
  note: string
}

export interface PayoutLog {
  id: string
  transactionId: string
  transactionCode: string
  amountCzk: number
  iban: string
  accountName?: string | null
  variableSymbol?: string | null
  fioResponse?: string | null
  status: 'sent' | 'failed' | string
  errorMessage?: string | null
  triggeredBy?: string | null
  createdAt: string
}

export interface Marketplace {
  id: string
  code: string
  name: string
  active: boolean
  feeSharePercent: number
  settlementAccountName: string
  settlementIban: string
  settlementBic: string
  notes: string
  logoUrl: string
  accentColor: string
  companyName: string
  companyAddress: string
  companyId: string
  supportEmail: string
  websiteUrl: string
}

export interface MarketplaceForm {
  code: string
  name: string
  feeSharePercent: string
  settlementAccountName: string
  settlementIban: string
  settlementBic: string
  notes: string
  logoUrl: string
  accentColor: string
  companyName: string
  companyAddress: string
  companyId: string
  supportEmail: string
  websiteUrl: string
}

export interface SellerPayoutForm {
  transactionCode: string
  iban: string
  accountName: string
  bic: string
}

export interface ApiKey {
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

export interface ApiKeyCreateForm {
  label: string
  scopes: string
  expiresInDays: string
}

export interface BankTransaction {
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

export interface STCheck {
  name: string
  status: string
  detail: string | null
}

export interface STVerification {
  score: number
  status: string
  checks: STCheck[]
  address_match: { city: boolean; zip: boolean } | null
  verified_at: string | null
}
