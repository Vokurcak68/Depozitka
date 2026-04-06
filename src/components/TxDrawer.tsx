import type { EscrowStatus, Transaction, TxEvent } from '../lib/types'
import { statusLabel, allowedTransitions } from '../lib/constants'
import { formatPrice, formatDate, maskIban, payoutSourceLabel } from '../lib/utils'
import { ShieldTrackPanel } from './ShieldTrackPanel'

export function TxDrawer({
  tx,
  events,
  change,
  note,
  paidAmount = '',
  trackingNum = '',
  emailBusy = false,
  onClose,
  onChange,
  onNote,
  onPaidAmount,
  onTrackingNumber,
  onApply,
  onSendManualEmail,
}: {
  tx: Transaction
  events: TxEvent[]
  change: EscrowStatus | ''
  note: string
  paidAmount?: string
  trackingNum?: string
  emailBusy?: boolean
  onClose: () => void
  onChange: (value: EscrowStatus | '') => void
  onNote: (value: string) => void
  onPaidAmount?: (value: string) => void
  onTrackingNumber?: (value: string) => void
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
            <strong>Bazar:</strong> {tx.marketplaceName}{' '}
            <span className="muted">({tx.marketplaceCode})</span>
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
          <p>
            <strong>Payout IBAN:</strong> {maskIban(tx.sellerPayoutIban)}
          </p>
          <p>
            <strong>Payout jméno:</strong> {tx.sellerPayoutAccountName || '-'}
          </p>
          <p>
            <strong>Payout BIC:</strong> {tx.sellerPayoutBic || '-'}
          </p>
          <p>
            <strong>Payout source:</strong> {payoutSourceLabel(tx.sellerPayoutSource)}
          </p>
          <p>
            <strong>Payout lock:</strong>{' '}
            {tx.sellerPayoutLockedAt ? `🔒 ${formatDate(tx.sellerPayoutLockedAt)}` : 'Odemčeno'}
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
        </div>

        {tx.shippingCarrier && (
          <div className="drawerSection">
            <h4>📦 Zásilka</h4>
            <p>
              <strong>Dopravce:</strong> {tx.shippingCarrier}
            </p>
            {tx.shippingTrackingNumber && (
              <p>
                <strong>Tracking:</strong> {tx.shippingTrackingNumber}
              </p>
            )}
          </div>
        )}

        {tx.shieldtrackShipmentId && (
          <ShieldTrackPanel
            transactionId={tx.id}
            cachedScore={tx.stScore}
            cachedStatus={tx.stStatus}
          />
        )}

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
