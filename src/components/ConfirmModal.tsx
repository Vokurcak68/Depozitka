export function ConfirmModal({
  title,
  message,
  subText,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  subText: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="modalOverlay" role="presentation" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <p className="hint">{subText}</p>
        <div className="modalActions">
          <button className="btn btnSecondary" onClick={onCancel}>
            Zrušit
          </button>
          <button className="btn btnDanger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
