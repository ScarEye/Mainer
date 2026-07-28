type Props = {
  label: string
  detail: string
  percent: number
  compact?: boolean
}

export function ProgressCard({ label, detail, percent, compact = false }: Props) {
  const value = Math.max(0, Math.min(100, Math.round(percent)))

  return (
    <div className={`progress-card ${compact ? 'progress-card--compact' : ''}`}>
      <div className="progress-card__head">
        <strong>{label}</strong>
        <span>{value}%</span>
      </div>
      <div
        className="progress-card__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-label={label}
      >
        <span className="progress-card__fill" style={{ width: `${value}%` }} />
      </div>
      <p className="progress-card__detail">{detail}</p>
    </div>
  )
}
