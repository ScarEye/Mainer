import type { ChartNote, DrumLane } from '../types/chart'
import { LANES, LANE_LABELS, createNoteId } from '../types/chart'

type Props = {
  notes: ChartNote[]
  currentTime: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (notes: ChartNote[]) => void
}

export function ChartEditor({ notes, currentTime, selectedId, onSelect, onChange }: Props) {
  const selected = notes.find((n) => n.id === selectedId) ?? null

  const nudge = (delta: number) => {
    if (!selected) return
    onChange(
      notes
        .map((n) => (n.id === selected.id ? { ...n, t: Math.max(0, n.t + delta) } : n))
        .sort((a, b) => a.t - b.t),
    )
  }

  const setLane = (lane: DrumLane) => {
    if (!selected) return
    onChange(notes.map((n) => (n.id === selected.id ? { ...n, lane } : n)))
  }

  const remove = () => {
    if (!selected) return
    onChange(notes.filter((n) => n.id !== selected.id))
    onSelect(null)
  }

  const addAtPlayhead = (lane: DrumLane) => {
    const note: ChartNote = { id: createNoteId(), t: currentTime, lane }
    onChange([...notes, note].sort((a, b) => a.t - b.t))
    onSelect(note.id)
  }

  const nearby = notes
    .map((n) => ({ n, d: Math.abs(n.t - currentTime) }))
    .filter((x) => x.d < 4)
    .sort((a, b) => a.d - b.d)
    .slice(0, 36)

  return (
    <div className="editor">
      <div className="editor__head">
        <h3>Drums chart</h3>
        <span>{notes.length} notes</span>
      </div>

      <div className="editor__scroll">
        <div className="editor__add">
          {LANES.map((lane) => (
            <button key={lane} type="button" className="btn btn--ghost btn--tiny" onClick={() => addAtPlayhead(lane)}>
              + {LANE_LABELS[lane]}
            </button>
          ))}
        </div>

        {selected ? (
          <div className="editor__selected">
            <p>
              {LANE_LABELS[selected.lane]} @ {selected.t.toFixed(3)}s
            </p>
            <div className="editor__row">
              <button type="button" className="btn btn--ghost btn--tiny" onClick={() => nudge(-0.05)}>
                −50ms
              </button>
              <button type="button" className="btn btn--ghost btn--tiny" onClick={() => nudge(-0.01)}>
                −10ms
              </button>
              <button type="button" className="btn btn--ghost btn--tiny" onClick={() => nudge(0.01)}>
                +10ms
              </button>
              <button type="button" className="btn btn--ghost btn--tiny" onClick={() => nudge(0.05)}>
                +50ms
              </button>
            </div>
            <div className="editor__row">
              {LANES.map((lane) => (
                <button
                  key={lane}
                  type="button"
                  className={`btn btn--tiny ${selected.lane === lane ? 'btn--accent' : 'btn--ghost'}`}
                  onClick={() => setLane(lane)}
                >
                  {LANE_LABELS[lane]}
                </button>
              ))}
              <button type="button" className="btn btn--tiny btn--danger" onClick={remove}>
                Delete
              </button>
            </div>
          </div>
        ) : (
          <p className="editor__empty">Select a nearby note or add one at the playhead.</p>
        )}

        <ul className="editor__list">
          {nearby.map(({ n, d }) => (
            <li key={n.id}>
              <button
                type="button"
                className={`editor__item ${selectedId === n.id ? 'is-active' : ''}`}
                onClick={() => onSelect(n.id)}
              >
                <span className={`dot dot--${n.lane}`} />
                {LANE_LABELS[n.lane]}
                <span>{n.t.toFixed(2)}s</span>
                <span className="muted">{d < 0.05 ? 'now' : `${d.toFixed(2)}s away`}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
