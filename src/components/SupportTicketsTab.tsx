import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

type TicketStatus = 'open' | 'closed' | 'spam' | 'draft'

type SupportTicket = {
  id: string
  ticket_no: number
  status: TicketStatus
  email: string | null
  name: string | null
  category: string | null
  subject: string | null
  message: string | null
  page_url: string | null
  transaction_ref: string | null
  submitted_at: string | null
  created_at: string
}

type SupportAttachment = {
  id: string
  ticket_id: string
  storage_path: string
  file_name: string
  content_type: string | null
  file_size: number | null
  created_at: string
}

interface Props {
  notify: (type: 'success' | 'error', text: string) => void
}

const statusLabel: Record<TicketStatus, string> = {
  open: 'Otevřený',
  closed: 'Uzavřený',
  spam: 'Spam',
  draft: 'Draft',
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    return d.toLocaleString('cs-CZ', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatBytes(bytes: number | null | undefined): string {
  const b = Number(bytes || 0)
  if (!Number.isFinite(b) || b <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = b
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function SupportTicketsTab({ notify }: Props) {
  const [loading, setLoading] = useState(true)
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [attachments, setAttachments] = useState<Record<string, SupportAttachment[]>>({})
  const [selected, setSelected] = useState<SupportTicket | null>(null)

  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void load()
  }, [])

  async function load(): Promise<void> {
    setLoading(true)
    try {
      const q = supabase
        .from('dpt_support_tickets')
        .select('id,ticket_no,status,email,name,category,subject,message,page_url,transaction_ref,submitted_at,created_at')
        .order('created_at', { ascending: false })
        .limit(200)

      const { data, error } = filter === 'open' ? await q.eq('status', 'open') : await q
      if (error) throw error

      const rows = (data || []) as any as SupportTicket[]
      setTickets(rows)

      // preload attachments for visible tickets
      const ids = rows.map((t) => t.id)
      if (ids.length > 0) {
        const { data: att, error: attErr } = await supabase
          .from('dpt_support_attachments')
          .select('id,ticket_id,storage_path,file_name,content_type,file_size,created_at')
          .in('ticket_id', ids)
          .order('created_at', { ascending: true })

        if (attErr) throw attErr

        const by: Record<string, SupportAttachment[]> = {}
        for (const a of (att || []) as any as SupportAttachment[]) {
          by[a.ticket_id] = by[a.ticket_id] || []
          by[a.ticket_id].push(a)
        }
        setAttachments(by)
      } else {
        setAttachments({})
      }

      if (selected) {
        const still = rows.find((t) => t.id === selected.id) || null
        setSelected(still)
      }
    } catch (err) {
      notify('error', `Načtení ticketů selhalo: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return tickets
    return tickets.filter((t) => {
      const hay = [
        `dpt-${t.ticket_no}`,
        t.email || '',
        t.name || '',
        t.subject || '',
        t.message || '',
        t.transaction_ref || '',
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(s)
    })
  }, [tickets, search])

  async function setStatus(ticket: SupportTicket, status: TicketStatus): Promise<void> {
    setBusy(true)
    try {
      const { error } = await supabase.from('dpt_support_tickets').update({ status }).eq('id', ticket.id)
      if (error) throw error
      notify('success', `Ticket DPT-${ticket.ticket_no} → ${statusLabel[status]} ✅`)
      await load()
    } catch (err) {
      notify('error', `Změna statusu selhala: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function openAttachment(a: SupportAttachment): Promise<void> {
    // iOS Safari (and some mobile browsers) will block window.open() if it happens
    // after an await. So we pre-open a blank tab synchronously, then redirect it.
    let popup: Window | null = null
    try {
      popup = window.open('about:blank', '_blank')
      if (popup) {
        try {
          // best-effort harden
          ;(popup as any).opener = null
        } catch {
          // ignore
        }
      }

      const { data, error } = await supabase.storage
        .from('dpt-support-attachments')
        .createSignedUrl(a.storage_path, 60 * 10)

      if (error || !data?.signedUrl) throw error || new Error('Signed URL failed')

      if (popup && !popup.closed) {
        popup.location.href = data.signedUrl
      } else {
        // Fallback: open in same tab
        window.location.href = data.signedUrl
      }
    } catch (err) {
      // If we opened a blank tab and then failed, close it to avoid junk tabs
      try {
        popup?.close()
      } catch {
        // ignore
      }
      notify('error', `Otevření přílohy selhalo: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <section className="panel">
      <h2>🎫 Support tickety</h2>
      <p className="muted" style={{ marginTop: 4 }}>
        Veřejné tickety z webu (Turnstile + přílohy ve Storage). Zobrazení vyžaduje správné RLS pro admin/support.
      </p>

      <div className="filtersRow" style={{ marginTop: 12 }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)}>
          <option value="open">Jen otevřené</option>
          <option value="all">Vše</option>
        </select>
        <input
          className="searchInput"
          placeholder="Hledat (ticket ID, email, subject, reference…)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn" onClick={() => void load()} disabled={busy || loading}>
          {loading ? 'Načítám…' : 'Reload'}
        </button>
      </div>

      {loading ? (
        <p className="muted" style={{ marginTop: 12 }}>
          Načítám…
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <div style={{ border: '1px solid rgba(148,163,184,.35)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: 10, borderBottom: '1px solid rgba(148,163,184,.25)', fontSize: 13 }} className="muted">
              Zobrazeno {filtered.length} / {tickets.length}
            </div>
            <div style={{ maxHeight: 520, overflow: 'auto' }}>
              {filtered.length === 0 ? (
                <div style={{ padding: 12 }} className="muted">
                  Nic.
                </div>
              ) : (
                filtered.map((t) => {
                  const active = selected?.id === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={active ? 'row active' : 'row'}
                      onClick={() => setSelected(t)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: 12,
                        border: 'none',
                        background: active ? 'rgba(234,179,8,.15)' : 'transparent',
                        borderBottom: '1px solid rgba(148,163,184,.15)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ fontWeight: 700 }}>DPT-{t.ticket_no}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {statusLabel[t.status]}
                        </div>
                      </div>
                      <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                        {t.subject || '(bez předmětu)'}
                      </div>
                      <div className="muted" style={{ marginTop: 2, fontSize: 12 }}>
                        {formatDate(t.submitted_at || t.created_at)} · {t.email || '-'}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <div style={{ border: '1px solid rgba(148,163,184,.35)', borderRadius: 12, padding: 14 }}>
            {!selected ? (
              <p className="muted">Vyber ticket vlevo.</p>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 18 }}>DPT-{selected.ticket_no}</div>
                    <div className="muted" style={{ marginTop: 2 }}>
                      {formatDate(selected.submitted_at || selected.created_at)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn" disabled={busy} onClick={() => void setStatus(selected, 'open')}>
                      Otevřít
                    </button>
                    <button className="btn" disabled={busy} onClick={() => void setStatus(selected, 'closed')}>
                      Uzavřít
                    </button>
                    <button className="btn" disabled={busy} onClick={() => void setStatus(selected, 'spam')}>
                      Spam
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Email
                    </div>
                    <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{selected.email || '-'}</div>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Kategorie
                    </div>
                    <div>{selected.category || '-'}</div>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Jméno
                    </div>
                    <div>{selected.name || '-'}</div>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Reference
                    </div>
                    <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{selected.transaction_ref || '-'}</div>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    URL
                  </div>
                  {selected.page_url ? (
                    <a href={selected.page_url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                      {selected.page_url}
                    </a>
                  ) : (
                    <div className="muted">-</div>
                  )}
                </div>

                <div style={{ marginTop: 12 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Zpráva
                  </div>
                  <pre
                    style={{
                      marginTop: 6,
                      padding: 12,
                      borderRadius: 12,
                      border: '1px solid rgba(148,163,184,.25)',
                      background: 'rgba(15,23,42,.04)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 12,
                    }}
                  >
                    {selected.message || ''}
                  </pre>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Přílohy
                  </div>
                  {(attachments[selected.id] || []).length === 0 ? (
                    <div className="muted" style={{ marginTop: 6 }}>
                      Žádné
                    </div>
                  ) : (
                    <ul style={{ marginTop: 6, display: 'grid', gap: 8 }}>
                      {(attachments[selected.id] || []).map((a) => (
                        <li key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {a.file_name}
                            </div>
                            <div className="muted" style={{ fontSize: 12 }}>
                              {a.content_type || '-'} · {formatBytes(a.file_size)}
                            </div>
                          </div>
                          <button className="btn" type="button" onClick={() => void openAttachment(a)}>
                            Otevřít
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <style>{`
        .row:hover { background: rgba(148,163,184,.08); }
      `}</style>
    </section>
  )
}
