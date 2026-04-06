export function StatCard({
  label,
  value,
  tone,
  active = false,
  onClick,
}: {
  label: string
  value: string
  tone: 'neutral' | 'danger' | 'info' | 'success'
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className={`statCard ${tone} ${active ? 'active' : ''} ${onClick ? '' : 'nonInteractive'}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  )
}
