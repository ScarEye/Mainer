import type { VisualMode } from '../types/chart'
import { VISUAL_MODES } from '../types/chart'

type Props = {
  mode: VisualMode
  onChange: (mode: VisualMode) => void
}

export function VisualModePicker({ mode, onChange }: Props) {
  return (
    <div className="visual-picker" role="tablist" aria-label="Practice visual">
      {VISUAL_MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={mode === m.id}
          className={`visual-picker__btn ${mode === m.id ? 'is-active' : ''}`}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
