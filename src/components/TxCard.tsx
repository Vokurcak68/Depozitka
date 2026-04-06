import type { EscrowStatus, Transaction } from '../lib/types'
import { statusLabel, allowedTransitions } from '../lib/constants'
import { formatPrice, formatDate, maskIban, payoutSourceLabel, getScoreColor } from '../lib/utils'

export function TxCard({
  tx,
  change,
  note,
  paidAmount = '',
  trackingNum = '',
  emailBusy = false,
  onChange,
  onNote,
  onPaidAmount,
  onTrackingNumber,
  onApply,
  onOpenDetail,
  onSendManualEmail,
}: {
  tx: Transaction
  change: EscrowStatus | ''
  note: string
  paidAmount?: string
  trackingNum?: string
  emailBusy?: boolean
  onChange: (value: EscrowStatus | '') => void
  onNote: (value: string) => void
  onPaidAmount?: (value: string) => void
  onTrackingNumber?: (value: string) => void
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
        <strong>Bazar:</strong> {tx.marketplaceName}{' '}
        <span className="muted">({tx.marketplaceCode})</span>
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
        <strong>Payout:</strong> {maskIban(tx.sellerPayoutIban)} ·{' '}
        {payoutSourceLabel(tx.sellerPayoutSource)}
        {tx.sellerPayoutLockedAt ? ' 🔒' : ''}
      </p>
      <p>
        <strong>Částka:</strong> {formatPrice(tx.amountCzk)} · <strong>Provize:</strong>{' '}
        {formatPrice(tx.feeAmountCzk)} · <strong>Výplata:</strong>{' '}
        {formatPrice(tx.payoutAmountCzk)}
      </p>
      {tx.paidAmountCzk > 0 && (
        <p>
          <strong>Uhrazeno:</strong> {formatPrice(tx.paidAmountCzk)} · <strong>Zbývá:</strong>{' '}
          {formatPrice(tx.amountCzk - tx.paidAmountCzk)}
        </p>
      )}
      <p>
        <strong>Update:</strong> {formatDate(tx.updatedAt)}
      </p>
      {tx.shippingCarrier && (
        <p>
          <strong>📦 Zásilka:</strong> {tx.shippingCarrier}
          {tx.shippingTrackingNumber && <> · {tx.shippingTrackingNumber}</>}
          {tx.stScore != null && (
            <span style={{ marginLeft: '8px', fontWeight: 700, color: getScoreColor(tx.stScore) }}>
              🛡️ {tx.stScore}/100
            </span>
          )}
        </p>
      )}

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
        {change === 'shipped' && (
          <input
            value={trackingNum}
            onChange={(e) => onTrackingNumber?.(e.target.value)}
            placeholder="Tracking číslo zásilky"
            style={{ borderColor: '#3b82f6' }}
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
