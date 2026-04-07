import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/utils'

interface CronRun {
  id: string
  job_name: string
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  status: string
  result: unknown
  error_message: string | null
  triggered_by: string | null
}

interface Notify {
  (type: 'success' | 'error', text: string): void
}

interface Props {
  notify: Notify
}

const CONFIGURED = [
  {
    name: 'daily-jobs',
    schedule: '0 8 * * * (každý den 8:00 UTC)',
    description: 'Master orchestrator: spustí fio-sync + process-emails. Vercel Hobby plán umožňuje jen 1 cron, takže všechno běží v rámci tohoto.',
    subJobs: ['fio-sync', 'process-emails'],
  },
]

export function CronTab({ notify }: Props) {
  const [runs, setRuns] = useState<CronRun[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  async function loadRuns(): Promise<void> {
    setLoading(true)
    const { data, error } = await supabase
      .from('dpt_cron_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(100)

    if (error) {
      notify('error', `Načtení historie cronů: ${error.message}`)
      setRuns([])
    } else {
      setRuns(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadRuns()
  }, [])

  async function triggerNow(): Promise<void> {
    if (!confirm('Opravdu spustit daily-jobs teď?')) return
    setBusy(true)
    try {
      const base = (import.meta.env.VITE_ENGINE_URL || '').trim()
      const token = (import.meta.env.VITE_ENGINE_MANUAL_TRIGGER_TOKEN || '').trim()
      if (!base || !token) {
        notify('error', 'VITE_ENGINE_URL nebo VITE_ENGINE_MANUAL_TRIGGER_TOKEN není nastaven.')
        return
      }
      const res = await fetch(`${base.replace(/\/$/, '')}/api/cron/daily-jobs`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        notify('error', `Cron selhal: ${data.error || res.status}`)
      } else {
        notify('success', `Cron doběhl: ${data.jobs_run} jobs, ${data.errors} chyb`)
        await loadRuns()
      }
    } catch (err) {
      notify('error', `Cron selhal: ${err instanceof Error ? err.message : 'Neznámá chyba'}`)
    } finally {
      setBusy(false)
    }
  }

  const lastByJob = new Map<string, CronRun>()
  for (const r of runs) {
    if (!lastByJob.has(r.job_name)) {
      lastByJob.set(r.job_name, r)
    }
  }

  return (
    <section className="panel">
      <h2>🔧 Cron jobs</h2>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <button className="btn btnPrimary" onClick={() => void triggerNow()} disabled={busy}>
          {busy ? 'Spouštím...' : '▶️ Spustit daily-jobs teď'}
        </button>
        <button className="btn btnSecondary" onClick={() => void loadRuns()}>
          🔄 Reload historie
        </button>
      </div>

      <h3>Konfigurované cron jobs</h3>
      <div style={{ marginBottom: 24 }}>
        {CONFIGURED.map((cfg) => {
          const last = lastByJob.get(cfg.name)
          return (
            <div
              key={cfg.name}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <div>
                  <strong>{cfg.name}</strong>
                  <p className="muted" style={{ margin: '4px 0', fontSize: 13 }}>
                    {cfg.schedule}
                  </p>
                  <p style={{ margin: '4px 0', fontSize: 13 }}>{cfg.description}</p>
                  <p className="muted" style={{ margin: '4px 0', fontSize: 12 }}>
                    Sub-jobs: {cfg.subJobs.join(', ')}
                  </p>
                </div>
                <div style={{ textAlign: 'right', fontSize: 13 }}>
                  {last ? (
                    <>
                      <div>
                        Naposled:{' '}
                        <strong>{formatDate(last.started_at)}</strong>
                      </div>
                      <div>
                        Stav:{' '}
                        {last.status === 'success' ? (
                          <span style={{ color: '#16a34a' }}>✅ {last.status}</span>
                        ) : last.status === 'error' ? (
                          <span style={{ color: '#dc2626' }}>❌ {last.status}</span>
                        ) : (
                          <span style={{ color: '#f59e0b' }}>⏳ {last.status}</span>
                        )}
                      </div>
                      {last.duration_ms !== null && (
                        <div className="muted">{(last.duration_ms / 1000).toFixed(1)}s</div>
                      )}
                    </>
                  ) : (
                    <span className="muted">Ještě neběželo</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <h3>Historie běhů ({runs.length})</h3>
      {loading ? (
        <p className="muted">Načítám…</p>
      ) : runs.length === 0 ? (
        <p className="muted">Žádné běhy v historii.</p>
      ) : (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Začátek</th>
                <th>Job</th>
                <th>Stav</th>
                <th>Trvání</th>
                <th>Spustil</th>
                <th>Chyba / výsledek</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.started_at)}</td>
                  <td>
                    <strong>{r.job_name}</strong>
                  </td>
                  <td>
                    {r.status === 'success' ? (
                      <span style={{ color: '#16a34a' }}>✅</span>
                    ) : r.status === 'error' ? (
                      <span style={{ color: '#dc2626' }}>❌</span>
                    ) : (
                      <span style={{ color: '#f59e0b' }}>⏳</span>
                    )}{' '}
                    {r.status}
                  </td>
                  <td>{r.duration_ms !== null ? `${(r.duration_ms / 1000).toFixed(1)}s` : '-'}</td>
                  <td>{r.triggered_by || '-'}</td>
                  <td style={{ maxWidth: 320, fontSize: 12 }}>
                    {r.error_message ? (
                      <span style={{ color: '#dc2626' }}>{r.error_message}</span>
                    ) : r.result ? (
                      <span className="muted">{JSON.stringify(r.result).substring(0, 200)}</span>
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
