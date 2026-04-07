import type { PayoutLog } from '../lib/types'
import { formatPrice, formatDate, maskIban } from '../lib/utils'

interface Props {
  payoutLogs: PayoutLog[]
  payoutLogsError: string | null
  onSelectTransaction?: (transactionId: string) => void
}

export function PayoutLogTab({ payoutLogs, payoutLogsError, onSelectTransaction }: Props) {
  const totalSent = payoutLogs
    .filter((p) => p.status === 'sent')
    .reduce((sum, p) => sum + (Number(p.amountCzk) || 0), 0)
  const failedCount = payoutLogs.filter((p) => p.status === 'failed').length

  return (
    <section className="panel">
      <h2>💸 Výplaty ({payoutLogs.length})</h2>

      <div style={{ display: 'flex', gap: '16px', marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="muted" style={{ fontSize: 13 }}>
          <strong>Úspěšně odesláno:</strong> {formatPrice(totalSent)}
        </div>
        {failedCount > 0 && (
          <div style={{ fontSize: 13, color: '#dc2626' }}>
            <strong>Selhalo:</strong> {failedCount}
          </div>
        )}
      </div>

      {payoutLogsError && (
        <p className="errorText" style={{ marginBottom: 12 }}>
          Načtení výplat selhalo: {payoutLogsError}
        </p>
      )}

      {payoutLogs.length === 0 ? (
        <p className="muted">Zatím žádné výplaty.</p>
      ) : (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Čas</th>
                <th>Transakce</th>
                <th>Částka</th>
                <th>IBAN</th>
                <th>Příjemce</th>
                <th>VS</th>
                <th>Stav</th>
                <th>Spustil</th>
                <th>Chyba / FIO</th>
              </tr>
            </thead>
            <tbody>
              {payoutLogs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDate(log.createdAt)}</td>
                  <td>
                    {onSelectTransaction ? (
                      <button
                        type="button"
                        className="btn btnLink"
                        style={{
                          padding: 0,
                          background: 'none',
                          border: 'none',
                          color: '#2563eb',
                          textDecoration: 'underline',
                          cursor: 'pointer',
                        }}
                        onClick={() => onSelectTransaction(log.transactionId)}
                      >
                        {log.transactionCode}
                      </button>
                    ) : (
                      log.transactionCode
                    )}
                  </td>
                  <td>
                    <strong>{formatPrice(Number(log.amountCzk))}</strong>
                  </td>
                  <td title={log.iban}>{maskIban(log.iban)}</td>
                  <td>{log.accountName || '-'}</td>
                  <td>{log.variableSymbol || '-'}</td>
                  <td>
                    {log.status === 'sent' ? (
                      <span style={{ color: '#16a34a' }}>✅ Odesláno</span>
                    ) : (
                      <span style={{ color: '#dc2626' }}>❌ Selhalo</span>
                    )}
                  </td>
                  <td>{log.triggeredBy || '-'}</td>
                  <td style={{ maxWidth: 300, fontSize: 12 }}>
                    {log.errorMessage ? (
                      <span style={{ color: '#dc2626' }}>{log.errorMessage}</span>
                    ) : log.fioResponse ? (
                      <span className="muted">{log.fioResponse.substring(0, 100)}…</span>
                    ) : (
                      '-'
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
}
