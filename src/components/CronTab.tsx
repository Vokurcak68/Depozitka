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

interface CronSettings {
  dailyJobsTimesUtc: string[]
}

const DEFAULT_CRON_SETTINGS: CronSettings = {
  dailyJobsTimesUtc: ['08:00'],
}

const CONFIGURED = [
  {
    name: 'daily-jobs',
    description: 'Master orchestrator: spustí fio-sync + process-emails. Na Hobby běží jen 1x denně, na placeném Vercelu můžeš přidat další časy.',
    subJobs: ['fio-sync', 'process-emails'],
  },
]

function isValidUtcTime(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value)
}

function normalizeTimes(values: string[]): string[] {
  const out = values
    .map((v) => v.trim())
    .filter((v) => isValidUtcTime(v))
    .sort((a, b) => a.localeCompare(b))

  return Array.from(new Set(out))
}

function toCronExpr(timeUtc: string): string {
  const [h, m] = timeUtc.split(':')
  return `${m} ${h} * * *`
}

export function CronTab({ notify }: Props) {
  const [runs, setRuns] = useState<CronRun[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [txCode, setTxCode] = useState('')
  const [txDiagBusy, setTxDiagBusy] = useState(false)
  const [txDiagResult, setTxDiagResult] = useState<unknown>(null)
  const [cronSettings, setCronSettings] = useState<CronSettings>(DEFAULT_CRON_SETTINGS)
  const [settingsBusy, setSettingsBusy] = useState(false)

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
    void loadCronSettings()
  }, [])

  async function loadCronSettings(): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('dpt_settings')
        .select('value')
        .eq('key', 'cron')
        .maybeSingle()

      if (error) {
        notify('error', `Načtení cron nastavení: ${error.message}`)
        return
      }

      const incoming = (data?.value || {}) as Partial<CronSettings>
      const normalized = normalizeTimes(incoming.dailyJobsTimesUtc || DEFAULT_CRON_SETTINGS.dailyJobsTimesUtc)
      setCronSettings({
        dailyJobsTimesUtc: normalized.length > 0 ? normalized : DEFAULT_CRON_SETTINGS.dailyJobsTimesUtc,
      })
    } catch (err) {
      notify('error', `Načtení cron nastavení: ${err instanceof Error ? err.message : 'Neznámá chyba'}`)
    }
  }

  async function saveCronSettings(): Promise<void> {
    const normalized = normalizeTimes(cronSettings.dailyJobsTimesUtc)

    if (normalized.length === 0) {
      notify('error', 'Zadej aspoň jeden validní čas ve formátu HH:MM (UTC).')
      return
    }

    setSettingsBusy(true)
    try {
      const payload: CronSettings = { dailyJobsTimesUtc: normalized }
      const { error } = await supabase
        .from('dpt_settings')
        .upsert(
          {
            key: 'cron',
            value: payload,
            description: 'Konfigurace plánovaných časů cronu daily-jobs (UTC) pro Vercel cron schedule.',
          },
          { onConflict: 'key' },
        )

      if (error) {
        notify('error', `Uložení cron nastavení: ${error.message}`)
        return
      }

      setCronSettings(payload)
      notify('success', 'Cron časy uloženy ✅')
    } catch (err) {
      notify('error', `Uložení cron nastavení: ${err instanceof Error ? err.message : 'Neznámá chyba'}`)
    } finally {
      setSettingsBusy(false)
    }
  }

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

  async function runTxEmailDiag(): Promise<void> {
    const code = txCode.trim()
    if (!code) {
      notify('error', 'Zadej kód transakce (např. DPT-2026-762149).')
      return
    }

    setTxDiagBusy(true)
    setTxDiagResult(null)

    try {
      const base = (import.meta.env.VITE_ENGINE_URL || '').trim()
      const token = (import.meta.env.VITE_ENGINE_MANUAL_TRIGGER_TOKEN || '').trim()
      if (!base || !token) {
        notify('error', 'VITE_ENGINE_URL nebo VITE_ENGINE_MANUAL_TRIGGER_TOKEN není nastaven.')
        return
      }

      const url = `${base.replace(/\/$/, '')}/api/diag/tx-email?code=${encodeURIComponent(code)}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        notify('error', `Diagnostika selhala: ${data.error || res.status}`)
        setTxDiagResult(data)
      } else {
        notify('success', `Diagnostika hotová pro ${code}`)
        setTxDiagResult(data)
      }
    } catch (err) {
      notify('error', `Diagnostika selhala: ${err instanceof Error ? err.message : 'Neznámá chyba'}`)
    } finally {
      setTxDiagBusy(false)
    }
  }

  const lastByJob = new Map<string, CronRun>()
  const scheduledTimes = normalizeTimes(cronSettings.dailyJobsTimesUtc)
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

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Diagnostika konkrétní transakce (emaily)</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Zadej kód transakce a Core samo zavolá engine endpoint <code>/api/diag/tx-email</code> s tokenem z env.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <input
            value={txCode}
            onChange={(e) => setTxCode(e.target.value)}
            placeholder="DPT-2026-762149"
            style={{ minWidth: 260 }}
          />
          <button className="btn btnSecondary" onClick={() => void runTxEmailDiag()} disabled={txDiagBusy}>
            {txDiagBusy ? 'Načítám…' : '🔎 Načíst diagnostiku'}
          </button>
        </div>

        {txDiagResult ? (
          <pre
            style={{
              margin: 0,
              padding: 10,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              maxHeight: 320,
              overflow: 'auto',
              fontSize: 12,
            }}
          >
            {JSON.stringify(txDiagResult, null, 2)}
          </pre>
        ) : (
          <p className="muted" style={{ marginBottom: 0 }}>Výsledek se zobrazí tady jako JSON.</p>
        )}
      </div>

      <h3>Plánování cronu (UTC)</h3>
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <p style={{ marginTop: 0, fontSize: 13 }}>
          Tady si nadefinuješ víc časů pro stejný cron <code>daily-jobs</code>. Na Vercel Hobby typicky běží jen 1x,
          na placeném tarifu můžeš přidat další. Časy jsou v <strong>UTC</strong>.
        </p>

        <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
          {cronSettings.dailyJobsTimesUtc.map((time, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={time}
                onChange={(e) => {
                  const next = [...cronSettings.dailyJobsTimesUtc]
                  next[idx] = e.target.value
                  setCronSettings({ ...cronSettings, dailyJobsTimesUtc: next })
                }}
                placeholder="08:00"
                style={{ width: 120 }}
              />
              <span className="muted" style={{ fontSize: 12 }}>
                cron: {isValidUtcTime(time) ? toCronExpr(time) : 'invalid'}
              </span>
              {cronSettings.dailyJobsTimesUtc.length > 1 && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    const next = cronSettings.dailyJobsTimesUtc.filter((_, i) => i !== idx)
                    setCronSettings({
                      ...cronSettings,
                      dailyJobsTimesUtc: next.length ? next : ['08:00'],
                    })
                  }}
                >
                  Smazat
                </button>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btnSecondary"
            onClick={() => setCronSettings({ ...cronSettings, dailyJobsTimesUtc: [...cronSettings.dailyJobsTimesUtc, ''] })}
          >
            ➕ Přidat čas
          </button>
          <button type="button" className="btn btnPrimary" onClick={() => void saveCronSettings()} disabled={settingsBusy}>
            {settingsBusy ? 'Ukládám…' : '💾 Uložit časy'}
          </button>
          <button type="button" className="btn" onClick={() => void loadCronSettings()} disabled={settingsBusy}>
            Načíst z DB
          </button>
        </div>

        <div style={{ marginTop: 12, fontSize: 12 }}>
          <div className="muted">Plánované časy: {scheduledTimes.join(', ') || '-'}</div>
          <div className="muted">Cron výrazy: {scheduledTimes.map(toCronExpr).join(' | ') || '-'}</div>
        </div>
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
                    {scheduledTimes.length
                      ? `${scheduledTimes.join(', ')} UTC (${scheduledTimes.map(toCronExpr).join(' | ')})`
                      : 'Bez naplánovaných časů'}
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
