import type { StemId, StemLevels } from '../types/chart'
import { STEM_IDS, STEM_LABELS } from '../types/chart'

type Props = {
  levels: StemLevels
  ready: boolean
  splitting: boolean
  splitMessage?: string | null
  onChange: (id: StemId, patch: Partial<{ volume: number; muted: boolean }>) => void
  onSolo: (id: StemId) => void
  onSplit: () => void
  onResetMix: () => void
}

export function StemMixer({
  levels,
  ready,
  splitting,
  splitMessage,
  onChange,
  onSolo,
  onSplit,
  onResetMix,
}: Props) {
  return (
    <div className="mixer">
      <div className="mixer__head">
        <h3>Instrument mix</h3>
        {!ready ? (
          <button type="button" className="btn btn--accent" disabled={splitting} onClick={onSplit}>
            {splitting ? 'Splitting…' : 'Split stems'}
          </button>
        ) : (
          <button type="button" className="btn btn--ghost" onClick={onResetMix}>
            Unmute all
          </button>
        )}
      </div>

      {!ready && (
        <p className="mixer__hint">
          Split into Drums / Bass / Vocals / Other (guitar &amp; keys). CPU split often takes several minutes —
          first run also downloads the Demucs model.
        </p>
      )}

      {splitting && splitMessage && <p className="mixer__progress">{splitMessage}</p>}

      <ul className={`mixer__list ${ready ? '' : 'is-disabled'}`}>
        {STEM_IDS.map((id) => {
          const lvl = levels[id]
          return (
            <li key={id} className="mixer__row">
              <div className="mixer__label">
                <span>{STEM_LABELS[id]}</span>
                <div className="mixer__actions">
                  <button
                    type="button"
                    className={`btn btn--tiny ${lvl.muted ? 'btn--danger' : 'btn--ghost'}`}
                    disabled={!ready}
                    onClick={() => onChange(id, { muted: !lvl.muted })}
                  >
                    {lvl.muted ? 'Muted' : 'Mute'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--tiny btn--ghost"
                    disabled={!ready}
                    onClick={() => onSolo(id)}
                  >
                    Solo
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={150}
                value={Math.round(lvl.volume * 100)}
                disabled={!ready || lvl.muted}
                onChange={(e) => onChange(id, { volume: Number(e.target.value) / 100 })}
              />
              <span className="mixer__vol">{Math.round(lvl.volume * 100)}%</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
