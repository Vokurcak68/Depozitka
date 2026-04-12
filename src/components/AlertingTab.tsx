import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

interface MonitorSettings {
  alertEmails?: string[]
  reminderMinutes?: number
  pushoverEnabled?: boolean
  pushoverUserKeys?: string[]
  pushoverPriority?: number
  pushoverSound?: string
}

interface Props {
  notify: (type: 'success' | 'error', text: string) => void
}

const DEFAULT_REMINDER_MINUTES = 60

function parseLines(input: string, lower = false): string[] {
  const normalized = input
    .split(/[\n,;]+/g)
    .map((v) => (lower ? v.trim().toLowerCase() : v.trim()))
    .filter((v) => v.length > 0)

  return Array.from(new Set(normalized))
}

function parseEmails(input: string): string[] {
  return parseLines(input, true)
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isValidPushoverUserKey(value: string): boolean {
  return /^[A-Za-z0-9]{20,}$/.test(value)
}

export function AlertingTab({ notify }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [emailsInput, setEmailsInput] = useState('')
  const [reminderMinutes, setReminderMinutes] = useState<number>(DEFAULT_REMINDER_MINUTES)
  const [pushoverEnabled, setPushoverEnabled] = useState(false)
  const [pushoverUsersInput, setPushoverUsersInput] = useState('')
  const [pushoverPriority, setPushoverPriority] = useState<number>(1)
  const [pushoverSound, setPushoverSound] = useState<string>('')

  useEffect(() => {
    void load()
  }, [])

  async function load(): Promise<void> {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('dpt_settings')
        .select('value')
        .eq('key', 'monitoring')
        .maybeSingle()

      if (error) throw error

      const value = (data?.value || {}) as MonitorSettings
      const currentEmails = Array.isArray(value.alertEmails) ? value.alertEmails : []

      setEmailsInput(currentEmails.join('\n'))
      setReminderMinutes(
        Number.isFinite(Number(value.reminderMinutes)) && Number(value.reminderMinutes) > 0
          ? Number(value.reminderMinutes)
          : DEFAULT_REMINDER_MINUTES,
      )
      setPushoverEnabled(value.pushoverEnabled === true)
      setPushoverUsersInput(Array.isArray(value.pushoverUserKeys) ? value.pushoverUserKeys.join('\n') : '')
      setPushoverPriority(Number.isFinite(Number(value.pushoverPriority)) ? Number(value.pushoverPriority) : 1)
      setPushoverSound(typeof value.pushoverSound === 'string' ? value.pushoverSound : '')
    } catch (err) {
      notify('error', `Načtení monitor alertů selhalo: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const parsedEmails = useMemo(() => parseEmails(emailsInput), [emailsInput])
  const invalidEmails = useMemo(() => parsedEmails.filter((e) => !isValidEmail(e)), [parsedEmails])
  const parsedPushoverUsers = useMemo(() => parseLines(pushoverUsersInput), [pushoverUsersInput])
  const invalidPushoverUsers = useMemo(
    () => parsedPushoverUsers.filter((e) => !isValidPushoverUserKey(e)),
    [parsedPushoverUsers],
  )

  async function save(): Promise<void> {
    if (invalidEmails.length > 0) {
      notify('error', `Neplatné emaily: ${invalidEmails.join(', ')}`)
      return
    }

    if (!Number.isFinite(reminderMinutes) || reminderMinutes < 5 || reminderMinutes > 1440) {
      notify('error', 'Reminder interval musí být mezi 5 a 1440 minutami.')
      return
    }

    if (pushoverEnabled && invalidPushoverUsers.length > 0) {
      notify('error', `Neplatné Pushover User Key: ${invalidPushoverUsers.join(', ')}`)
      return
    }

    if (!Number.isFinite(pushoverPriority) || pushoverPriority < -2 || pushoverPriority > 2) {
      notify('error', 'Pushover priority musí být mezi -2 a 2.')
      return
    }

    setSaving(true)
    try {
      const payload: MonitorSettings = {
        alertEmails: parsedEmails,
        reminderMinutes: Math.round(reminderMinutes),
        pushoverEnabled,
        pushoverUserKeys: parsedPushoverUsers,
        pushoverPriority: Math.round(pushoverPriority),
        pushoverSound: pushoverSound.trim() || undefined,
      }

      const { error } = await supabase
        .from('dpt_settings')
        .upsert(
          {
            key: 'monitoring',
            value: payload,
            description: 'Nastavení monitoringu (alert emaily + interval reminderu otevřených incidentů)',
          },
          { onConflict: 'key' },
        )

      if (error) throw error
      notify('success', 'Monitoring alerty uloženy ✅')
      await load()
    } catch (err) {
      notify('error', `Uložení monitor alertů selhalo: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <section className="panel">
        <h2>📣 Monitoring alerty</h2>
        <p className="muted">Načítám…</p>
      </section>
    )
  }

  return (
    <section className="panel">
      <h2>📣 Monitoring alerty</h2>
      <p className="muted" style={{ marginTop: 4 }}>
        Nastavení pro upozornění z monitoringu (email + volitelně Pushover push na iPhone).
      </p>

      <div className="formGrid" style={{ marginTop: 16 }}>
        <label style={{ gridColumn: '1 / -1' }}>
          Alert emaily
          <textarea
            value={emailsInput}
            onChange={(e) => setEmailsInput(e.target.value)}
            rows={6}
            placeholder={'admin@depozitka.eu\noncall@depozitka.eu'}
            style={{ width: '100%', resize: 'vertical' }}
          />
          <small className="muted">Jeden email na řádek (nebo oddělené čárkou/středníkem).</small>
        </label>

        <label>
          Reminder interval (minuty)
          <input
            type="number"
            min={5}
            max={1440}
            value={reminderMinutes}
            onChange={(e) => setReminderMinutes(Number(e.target.value) || DEFAULT_REMINDER_MINUTES)}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={pushoverEnabled} onChange={(e) => setPushoverEnabled(e.target.checked)} />
          Zapnout Pushover push alerty
        </label>

        <label>
          Pushover priority (-2 až 2)
          <input
            type="number"
            min={-2}
            max={2}
            value={pushoverPriority}
            onChange={(e) => setPushoverPriority(Number(e.target.value) || 0)}
          />
        </label>

        <label>
          Pushover sound <span className="muted">(volitelné)</span>
          <input
            value={pushoverSound}
            onChange={(e) => setPushoverSound(e.target.value)}
            placeholder="např. pushover, bugle, siren"
          />
        </label>

        <label style={{ gridColumn: '1 / -1' }}>
          Pushover User Key(s)
          <textarea
            value={pushoverUsersInput}
            onChange={(e) => setPushoverUsersInput(e.target.value)}
            rows={4}
            placeholder={'uQiRzpo4DXghDmr9QzzfQu27cmVRsG'}
            style={{ width: '100%', resize: 'vertical' }}
          />
          <small className="muted">Jeden klíč na řádek (nebo oddělené čárkou/středníkem).</small>
        </label>
      </div>

      {invalidEmails.length > 0 && (
        <div style={{ marginTop: 12, color: '#dc2626', fontSize: 14 }}>
          Neplatné emaily: {invalidEmails.join(', ')}
        </div>
      )}

      {invalidPushoverUsers.length > 0 && (
        <div style={{ marginTop: 12, color: '#dc2626', fontSize: 14 }}>
          Neplatné Pushover User Key: {invalidPushoverUsers.join(', ')}
        </div>
      )}

      <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
        <button type="button" className="btn btnPrimary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Ukládám…' : 'Uložit nastavení'}
        </button>
        <button type="button" className="btn" onClick={() => void load()} disabled={saving}>
          Načíst znovu
        </button>
      </div>

      <p className="muted" style={{ marginTop: 12 }}>
        Pozn.: email fallback je `ADMIN_EMAIL / SMTP_USER`. Pro Pushover musí být na engine nastavený env `PUSHOVER_APP_TOKEN`.
      </p>
    </section>
  )
}
