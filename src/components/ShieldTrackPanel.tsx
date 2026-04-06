import { useCallback, useState } from 'react'
import type { STVerification } from '../lib/types'
import { getScoreColor } from '../lib/utils'
import { CHECK_NAME_CS, CHECK_ICON } from '../lib/constants'

export function ShieldTrackPanel({
  transactionId,
  cachedScore,
  cachedStatus,
}: {
  transactionId: string
  cachedScore: number | null
  cachedStatus: string | null
}) {
  const [verification, setVerification] = useState<STVerification | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')

  const engineUrl = import.meta.env.VITE_ENGINE_URL || ''

  const fetchVerification = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${engineUrl}/api/verification?transaction_id=${transactionId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.available && data.verification) {
        setVerification(data.verification)
      } else {
        setError('Verifikace není dostupná')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba')
    } finally {
      setLoading(false)
    }
  }, [transactionId, engineUrl])

  const score = verification?.score ?? cachedScore
  const status = verification?.status ?? cachedStatus
  const scoreColor = score != null ? getScoreColor(score) : '#6b7280'

  const statusLabels: Record<string, string> = {
    verified: '✅ Ověřeno',
    partial: '⚠️ Částečně',
    failed: '❌ Selhalo',
    pending: '⏳ Čeká',
  }

  return (
    <div className="drawerSection">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>🛡️ ShieldTrack</h4>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {score != null && (
            <span style={{ fontWeight: 700, color: scoreColor, fontSize: '1.1em' }}>
              {score}/100
            </span>
          )}
          {status && (
            <span style={{ fontSize: '0.85em' }}>
              {statusLabels[status] || status}
            </span>
          )}
          <button
            className="btn btnSecondary"
            style={{ padding: '4px 10px', fontSize: '0.8em' }}
            onClick={() => {
              if (!expanded) fetchVerification()
              setExpanded(!expanded)
            }}
          >
            {expanded ? 'Skrýt' : 'Detail'}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: '12px' }}>
          {loading && <p className="hint">⏳ Načítám verifikaci...</p>}
          {error && <p className="hint" style={{ color: '#ef4444' }}>❌ {error}</p>}
          {verification && (
            <>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ height: '6px', borderRadius: '3px', background: '#334155', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${verification.score}%`,
                      background: getScoreColor(verification.score),
                      borderRadius: '3px',
                      transition: 'width 0.4s',
                    }}
                  />
                </div>
              </div>

              {verification.checks.map((check, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'flex-start',
                    padding: '4px 0',
                    fontSize: '0.85em',
                  }}
                >
                  <span>{CHECK_ICON[check.status] || '⏳'}</span>
                  <div>
                    <strong>{CHECK_NAME_CS[check.name] || check.name}</strong>
                    {check.detail && (
                      <div style={{ color: '#94a3b8', fontSize: '0.9em' }}>{check.detail}</div>
                    )}
                  </div>
                </div>
              ))}

              {verification.verified_at && (
                <p
                  style={{
                    fontSize: '0.75em',
                    color: '#64748b',
                    marginTop: '8px',
                    textAlign: 'right',
                  }}
                >
                  Ověřeno: {new Date(verification.verified_at).toLocaleString('cs-CZ')}
                </p>
              )}

              <button
                className="btn btnSecondary"
                style={{ marginTop: '8px', padding: '4px 10px', fontSize: '0.8em' }}
                onClick={fetchVerification}
                disabled={loading}
              >
                🔄 Obnovit
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
