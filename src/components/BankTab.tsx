import type { BankFilter, BankTransaction, Transaction } from '../lib/types'
import { formatPrice, formatDate } from '../lib/utils'
import { StatCard } from './StatCard'

interface Props {
  bankTxs: BankTransaction[]
  bankFilter: BankFilter
  bankBusy: boolean
  bankMatchTxId: Record<string, string>
  bankIgnoreReason: Record<string, string>
  bankSyncBusy: boolean
  bankSyncResult: string | null
  transactions: Transaction[]
  onBankFilterChange: (filter: BankFilter) => void
  onBankMatchTxIdChange: (bankTxId: string, txId: string) => void
  onBankIgnoreReasonChange: (bankTxId: string, reason: string) => void
  onManualMatch: (bankTxId: string, txId: string) => void
  onIgnore: (bankTxId: string, reason: string) => void
  onTriggerSync: () => void
}

export function BankTab({
  bankTxs,
  bankFilter,
  bankBusy,
  bankMatchTxId,
  bankIgnoreReason,
  bankSyncBusy,
  bankSyncResult,
  transactions,
  onBankFilterChange,
  onBankMatchTxIdChange,
  onBankIgnoreReasonChange,
  onManualMatch,
  onIgnore,
  onTriggerSync,
}: Props) {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Bankovní pohyby</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {bankSyncResult && <span style={{ fontSize: '0.82rem' }}>{bankSyncResult}</span>}
          <button className="btn btnPrimary" disabled={bankSyncBusy} onClick={onTriggerSync}>
            {bankSyncBusy ? '⏳ Načítám…' : '🔄 Načíst z banky'}
          </button>
        </div>
      </div>
      <p className="muted">Příchozí platby z FIO banky od 1. 4. 2026. Nespárované přiřaď ručně nebo označ jako ignorované.</p>

      <section className="statsGrid">
        <StatCard label="Celkem" value={String(counts.total)} tone="neutral" active={bankFilter === 'all'} onClick={() => onBankFilterChange('all')} />
        <StatCard label="Nespárované" value={String(counts.unmatched)} tone={counts.unmatched > 0 ? 'danger' : 'neutral'} active={bankFilter === 'unmatched'} onClick={() => onBankFilterChange('unmatched')} />
        <StatCard label="Spárované" value={String(counts.matched)} tone="success" active={bankFilter === 'matched'} onClick={() => onBankFilterChange('matched')} />
        <StatCard label="Ignorované" value={String(counts.ignored)} tone="neutral" active={bankFilter === 'ignored'} onClick={() => onBankFilterChange('ignored')} />
        <StatCard label="Přeplatky" value={String(counts.overpaid)} tone={counts.overpaid > 0 ? 'danger' : 'neutral'} active={bankFilter === 'overpaid'} onClick={() => onBankFilterChange('overpaid')} />
      </section>

      {filtered.length === 0 ? (
        <p className="muted">Žádné pohyby v tomto filtru.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="bankDesktop">
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Datum</th><th>Částka</th><th>VS</th><th>Protiúčet</th><th>Zpráva</th><th>Stav</th><th>Transakce</th><th>Akce</th>
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
                              <select value={bankMatchTxId[b.bankTxId] || ''} onChange={(e) => onBankMatchTxIdChange(b.bankTxId, e.target.value)} style={{ flex: 1, fontSize: '0.85em' }}>
                                <option value="">Přiřadit k…</option>
                                {payableTxs.map((tx) => (
                                  <option key={tx.id} value={tx.id}>{tx.transactionCode} · {formatPrice(tx.amountCzk)} · {tx.buyerName}</option>
                                ))}
                              </select>
                              <button className="btn btnPrimary" style={{ fontSize: '0.8em', padding: '2px 8px' }} disabled={bankBusy || !bankMatchTxId[b.bankTxId]} onClick={() => onManualMatch(b.bankTxId, bankMatchTxId[b.bankTxId])}>✓</button>
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <input value={bankIgnoreReason[b.bankTxId] || ''} onChange={(e) => onBankIgnoreReasonChange(b.bankTxId, e.target.value)} placeholder="Důvod ignorování…" style={{ flex: 1, fontSize: '0.85em' }} />
                              <button className="btn btnSecondary" style={{ fontSize: '0.8em', padding: '2px 8px' }} disabled={bankBusy} onClick={() => onIgnore(b.bankTxId, bankIgnoreReason[b.bankTxId] || '')}>✕</button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="bankMobile">
            {filtered.map((b) => (
              <div key={b.id} className="bankCard">
                <div className="bankCardHeader">
                  <span className="bankCardAmount">{formatPrice(b.amount)}</span>
                  {b.ignored && <span className="badge" style={{ background: '#6b7280' }}>Ignorováno</span>}
                  {b.matched && !b.overpaid && <span className="badge" style={{ background: '#22c55e' }}>Spárováno</span>}
                  {b.overpaid && <span className="badge" style={{ background: '#ef4444' }}>⚠️ Přeplatek</span>}
                  {!b.matched && !b.ignored && <span className="badge" style={{ background: '#f59e0b' }}>Nespárováno</span>}
                </div>
                <div className="bankCardMeta">
                  <span>{b.date ? formatDate(b.date) : '-'}</span>
                  <span>VS: <code>{b.variableSymbol || '-'}</code></span>
                </div>
                {b.counterAccount && <div className="bankCardDetail">Protiúčet: {b.counterAccount}</div>}
                {b.message && <div className="bankCardDetail">{b.message}</div>}
                {b.matchedTransactionCode && <div className="bankCardDetail">Transakce: <code>{b.matchedTransactionCode}</code></div>}
                {b.ignored && b.ignoredReason && <div className="bankCardDetail" style={{ color: '#9ca3af' }}>Důvod: {b.ignoredReason}</div>}

                {!b.matched && !b.ignored && (
                  <div className="bankCardActions">
                    <select value={bankMatchTxId[b.bankTxId] || ''} onChange={(e) => onBankMatchTxIdChange(b.bankTxId, e.target.value)}>
                      <option value="">Přiřadit k transakci…</option>
                      {payableTxs.map((tx) => (
                        <option key={tx.id} value={tx.id}>{tx.transactionCode} · {formatPrice(tx.amountCzk)}</option>
                      ))}
                    </select>
                    <button className="btn btnPrimary" disabled={bankBusy || !bankMatchTxId[b.bankTxId]} onClick={() => onManualMatch(b.bankTxId, bankMatchTxId[b.bankTxId])}>Přiřadit</button>
                    <div className="bankCardIgnore">
                      <input value={bankIgnoreReason[b.bankTxId] || ''} onChange={(e) => onBankIgnoreReasonChange(b.bankTxId, e.target.value)} placeholder="Důvod…" />
                      <button className="btn btnSecondary" disabled={bankBusy} onClick={() => onIgnore(b.bankTxId, bankIgnoreReason[b.bankTxId] || '')}>Ignorovat</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
