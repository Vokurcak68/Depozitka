import type { EscrowStatus, UserRole, Theme } from './types'

export function normalizeIban(v: string): string {
  return v.replace(/\s+/g, '').toUpperCase()
}

export function maskIban(v: string): string {
  const s = normalizeIban(v)
  if (!s) return '-'
  return s.length <= 8 ? s : `${s.slice(0, 4)}****${s.slice(-4)}`
}

export function payoutSourceLabel(v: string): string {
  return (
    ({
      marketplace_api: 'Marketplace API',
      seller_portal: 'Seller portal',
      admin_override: 'Admin override',
    } as Record<string, string>)[v] || v || '-'
  )
}

export function roleLabel(role: UserRole): string {
  return ({
    admin: 'Admin',
    support: 'Support',
    buyer: 'Kupující',
    seller: 'Prodejce',
    service: 'Service',
    unknown: 'Neznámá role',
  } as Record<UserRole, string>)[role]
}

export function canUseAdminTabs(role: UserRole): boolean {
  return role === 'admin' || role === 'support'
}

export function resolveUserRole(value: string | null | undefined): UserRole {
  const v = (value || '').trim().toLowerCase()
  if (v === 'admin' || v === 'support' || v === 'buyer' || v === 'seller' || v === 'service') return v
  return 'unknown'
}

export function formatPrice(value: number): string {
  return `${new Intl.NumberFormat('cs-CZ').format(value)} Kč`
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString('cs-CZ')
}

export function isCriticalTransition(target: EscrowStatus): boolean {
  return ['refunded', 'cancelled', 'payout_sent'].includes(target)
}

export function resolveInitialTheme(): Theme {
  const saved = localStorage.getItem('depozitka-theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function getScoreColor(score: number): string {
  if (score >= 80) return '#22c55e'
  if (score >= 40) return '#f59e0b'
  return '#ef4444'
}
