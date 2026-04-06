import type { Transaction } from './types'

export function getEmailTargetsForStatus(
  tx: Transaction,
  adminEmail: string,
): { templateKey: string; toEmail: string }[] {
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

export async function sendEmailDirect(
  transactionId: string,
  templateKey: string,
  toEmail: string,
): Promise<{ ok: boolean; error?: string }> {
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
      body: JSON.stringify({
        transaction_id: transactionId,
        template_key: templateKey,
        to_email: toEmail,
        token,
      }),
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
