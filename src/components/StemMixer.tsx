import type { StemId, StemLevels, VisualInstrument } from '../types/chart'
import { STEM_IDS, STEM_LABELS, isVisualInstrument } from '../types/chart'
import type { DeviceChoice, QualityId, SeparateModel, SplitRange } from '../separate/models'
import { QUALITIES } from '../separate/models'
import { ProgressCard } from './ProgressCard'

type Props = {
  levels: StemLevels
  activeStems: StemId[]
  ready: boolean
  splitting: boolean
  splitProgress?: { label: string; detail: string; percent: number } | null
  models: SeparateModel[]
  modelId: string
  quality: QualityId
  device: DeviceChoice | null
  cuda: boolean
  gpuName: string | null
  range: SplitRange
  loopReady: boolean
  accuracy: number | null
  accuracyKind: 'estimate' | 'result'
  settingsDiffer: boolean
  onModel: (id: string) => void
  onQuality: (id: QualityId) => void
  onDevice: (device: DeviceChoice) => void
  onRange: (range: SplitRange) => void
  pickedStems: StemId[]
  onToggleStem: (id: StemId) => void
  onChange: (id: StemId, patch: Partial<{ volume: number; muted: boolean }>) => void
  onSolo: (id: StemId) => void
  onSplit: () => void
  onStop: () => void
  onResetMix: () => void
  showInstrument: VisualInstrument
  onShowInstrument: (id: VisualInstrument) => void
}

export function StemMixer({
  levels,
  activeStems,
  ready,
  splitting,
  splitProgress,
  models,
  modelId,
  quality,
  device,
  cuda,
  gpuName,
  range,
  loopReady,
  accuracy,
  accuracyKind,
  settingsDiffer,
  onModel,
  onQuality,
  onDevice,
  onRange,
  pickedStems,
  onToggleStem,
  onChange,
  onSolo,
  onSplit,
  onStop,
  onResetMix,
  showInstrument,
  onShowInstrument,
}: Props) {
  const selected = models.find((model) => model.id === modelId) ?? models[0]
  const locked = splitting

  return (
    <div className="mixer">
      <div className="mixer__head">
        <h3>Instrument mix</h3>
        {ready ? (
          <button type="button" className="btn btn--ghost" onClick={onResetMix} disabled={locked}>
            Unmute all
          </button>
        ) : null}
      </div>

      <label className="mixer__field">
        <span>Model</span>
        <select
          className="mixer__select"
          value={modelId}
          disabled={locked}
          onChange={(e) => onModel(e.target.value)}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
        {selected ? <p className="mixer__hint">{selected.detail}</p> : null}
      </label>

      <div className="mixer__field">
        <span>Instruments</span>
        <div className="mixer__stems">
          {STEM_IDS.map((id) => {
            const on = id === 'drums' || pickedStems.includes(id)
            const supported = selected?.stems.includes(id) ?? false
            return (
              <button
                key={id}
                type="button"
                className={`mixer__stem ${on ? 'is-on' : ''}`}
                aria-pressed={on}
                disabled={locked || id === 'drums'}
                title={
                  id === 'drums'
                    ? 'Drums stay on so the chart can be rebuilt'
                    : supported
                      ? STEM_LABELS[id]
                      : 'Uses the 6-stem model'
                }
                onClick={() => onToggleStem(id)}
              >
                {STEM_LABELS[id]}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mixer__field">
        <span>Quality</span>
        <div className="mixer__seg" role="radiogroup" aria-label="Quality">
          {QUALITIES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={quality === item.id}
              className={`mixer__choice ${quality === item.id ? 'is-on' : ''}`}
              disabled={locked}
              onClick={() => onQuality(item.id)}
            >
              <strong>{item.label}</strong>
              <small>{item.time}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="mixer__pair">
        <div className="mixer__field">
          <span>Device</span>
          <div className="mixer__seg" role="radiogroup" aria-label="Device">
            <button
              type="button"
              role="radio"
              aria-checked={device === 'cpu'}
              className={`mixer__choice ${device === 'cpu' ? 'is-on' : ''}`}
              disabled={locked}
              onClick={() => onDevice('cpu')}
            >
              <strong>CPU</strong>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={device === 'cuda'}
              className={`mixer__choice ${device === 'cuda' ? 'is-on' : ''}`}
              disabled={locked || !cuda}
              title={cuda ? gpuName || 'NVIDIA GPU' : 'No NVIDIA GPU in this install'}
              onClick={() => onDevice('cuda')}
            >
              <strong>GPU</strong>
            </button>
          </div>
        </div>

        <div className="mixer__field">
          <span>Range</span>
          <div className="mixer__seg" role="radiogroup" aria-label="Range">
            <button
              type="button"
              role="radio"
              aria-checked={range === 'full'}
              className={`mixer__choice ${range === 'full' ? 'is-on' : ''}`}
              disabled={locked}
              onClick={() => onRange('full')}
            >
              <strong>Full</strong>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={range === 'loop'}
              className={`mixer__choice ${range === 'loop' ? 'is-on' : ''}`}
              disabled={locked || !loopReady}
              title={loopReady ? 'Split the A/B loop only' : 'Set a loop on the waveform first'}
              onClick={() => onRange('loop')}
            >
              <strong>Loop</strong>
            </button>
          </div>
        </div>
      </div>

      {accuracy != null && (
        <div
          className={`mixer__accuracy ${accuracyKind === 'result' ? 'is-result' : ''}`}
          aria-label={
            accuracyKind === 'result'
              ? `Split accuracy ${accuracy} percent`
              : `Estimated split accuracy ${accuracy} percent`
          }
        >
          <span>{accuracyKind === 'result' ? 'Split accuracy' : 'Est. accuracy'}</span>
          <strong>{accuracy}%</strong>
        </div>
      )}

      {settingsDiffer && !splitting && (
        <p className="mixer__hint">Last split used another setting. Split again to apply this one.</p>
      )}

      {splitting && splitProgress && (
        <ProgressCard
          label={splitProgress.label}
          detail={splitProgress.detail}
          percent={splitProgress.percent}
          compact
        />
      )}

      {splitting ? (
        <button type="button" className="btn btn--danger mixer__split" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--accent mixer__split"
          disabled={device == null}
          onClick={onSplit}
        >
          {device == null ? 'Pick CPU or GPU' : 'Split stems'}
        </button>
      )}

      <ul className={`mixer__list ${ready ? '' : 'is-disabled'}`}>
        {activeStems.map((id) => {
          const lvl = levels[id]
          return (
            <li key={id} className="mixer__row">
              <div className="mixer__label">
                {isVisualInstrument(id) ? (
                  <button
                    type="button"
                    className={`mixer__pick ${showInstrument === id ? 'is-shown' : ''}`}
                    aria-pressed={showInstrument === id}
                    disabled={id !== 'drums' && !ready}
                    title={
                      id !== 'drums' && !ready
                        ? `Split stems to show ${STEM_LABELS[id]} notes`
                        : `Show ${STEM_LABELS[id]} notes`
                    }
                    onClick={() => onShowInstrument(id)}
                  >
                    {STEM_LABELS[id]}
                  </button>
                ) : (
                  <span className="mixer__name">{STEM_LABELS[id]}</span>
                )}
                <span className="mixer__vol">{Math.round(lvl.volume * 100)}%</span>
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
            </li>
          )
        })}
      </ul>
    </div>
  )
}
