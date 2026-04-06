import type { TxEvent, EmailLog } from '../lib/types'
import { formatDate } from '../lib/utils'

interface Props {
  emailLogs: EmailLog[]
  emailLogsError: string | null
  events: TxEvent[]
}

export function EmailLogTab({ emailLogs, emailLogsError, events }: Props) {
  return (
    <section className="panel">
      <h2>Email logy ({emailLogs.length})</h2>
      {emailLogsError && (
        <p className="errorText" style={{ marginBottom: 12 }}>
          Načtení email logů selhalo: {emailLogsError}
        </p>
      )}
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Čas</th><th>Tx</th><th>Template</th><th>Komu</th><th>Předmět</th><th>Stav</th><th>Odesláno</th><th>Provider ID</th><th>Chyba</th>
            </tr>
          </thead>
          <tbody>
            {emailLogs.map((log) => (
              <tr key={log.id}>
                <td>{formatDate(log.createdAt)}</td>
                <td>{log.transactionCode}</td>
                <td>{log.templateKey}</td>
                <td>{log.toEmail}</td>
                <td>{log.subject}</td>
                <td>{log.status}</td>
                <td>{log.sentAt ? formatDate(log.sentAt) : '-'}</td>
                <td>{log.providerMessageId || '-'}</td>
                <td>{log.errorMessage || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Audit eventy ({events.length})</h3>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Čas</th><th>Tx</th><th>Typ</th><th>Přechod</th><th>Poznámka</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{formatDate(event.createdAt)}</td>
                <td>{event.transactionCode}</td>
                <td>{event.eventType}</td>
                <td>{event.oldStatus || '-'} → {event.newStatus || '-'}</td>
                <td>{event.note || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
