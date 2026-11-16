import type { MelodicInstrument, PitchNote } from '../types/chart'
import { STEM_LABELS, createNoteId } from '../types/chart'
import { MELODIC_RANGE, midiToName, pitchColor } from '../audio/music'

type Props = {
  instrument: MelodicInstrument
  notes: PitchNote[] | null
  currentTime: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (notes: PitchNote[]) => void
}

export function PitchEditor({ instrument, notes, currentTime, selectedId, onSelect, onChange }: Props) {
  const range = MELODIC_RANGE[instrument]
  const selected = notes?.find((note) => note.id === selectedId) ?? null

  const nudgeTime = (delta: number) => {
    if (!notes || !selected) return
    onChange(
      notes
        .map((note) => (note.id === selected.id ? { ...note, t: Math.max(0, note.t + delta) } : note))
        .sort((a, b) => a.t - b.t || a.midi - b.midi),
    )
  }

  const nudgePitch = (delta: number) => {
    if (!notes || !selected) return
    const midi = Math.max(range.min, Math.min(range.max, selected.midi + delta))
    onChange(notes.map((note) => (note.id === selected.id ? { ...note, midi } : note)))
  }

  const remove = () => {
    if (!notes || !selected) return
    onChange(notes.filter((note) => note.id !== selected.id))
    onSelect(null)
  }

  const addAtPlayhead = () => {
    const note: PitchNote = {
      id: createNoteId(),
      t: currentTime,
      midi: selected?.midi ?? range.add,
      dur: 0.2,
      vel: 1,
    }
    onChange([...(notes ?? []), note].sort((a, b) => a.t - b.t || a.midi - b.midi))
    onSelect(note.id)
  }

  const nearby = (notes ?? [])
    .map((note) => ({ note, d: Math.abs(note.t - currentTime) }))
    .filter((item) => item.d < 4)
    .sort((a, b) => a.d - b.d)
    .slice(0, 36)

  return (
    <div className="editor">
      <div className="editor__head">
        <h3>{STEM_LABELS[instrument]} chart</h3>
        <span>{notes ? `${notes.length} notes` : 'not charted'}</span>
      </div>
      <div className="editor__scroll">
        {notes == null ? (
          <p className="editor__empty">Split stems to chart {STEM_LABELS[instrument].toLowerCase()}.</p>
        ) : (
          <>
            <div className="editor__add">
              <button type="button" className="btn btn--ghost btn--tiny" onClick={addAtPlayhead}>
                + Note at playhead
              </button>
            </div>
            {selected ? (
              <div className="editor__selected">
                <p>
                  {midiToName(selected.midi)} @ {selected.t.toFixed(3)}s
                </p>
                <div className="editor__row">
                  <button type="button" className="btn btn--ghost btn--tiny" onClick={() => nudgeTime(-0.05)}>
                    −50ms
                  </button>
                  <button type="button" className="btn btn--ghost btn--tiny" onClick={() => nudgeTime(-0.01)}>
                    −10ms
                  </button>
                  <button type="button" className="btn btn--ghost btn--tiny" onClick={() => nudgeTime(0.01)}>
                    +10ms
                  </button>
                  <button type="button" className="btn btn--ghost btn--tiny" onClick={() => nudgeTime(0.05)}>
                    +50ms
                  </button>
                </div>
                <div className="editor__row">
                  <button type="button" className="btn btn--ghost btn--tiny" onClick={() => nudgePitch(-1)}>
                    −1 st
                  </button>
                  <button type="button" className="btn btn--ghost btn--tiny" onClick={() => nudgePitch(1)}>
                    +1 st
                  </button>
                  <button type="button" className="btn btn--tiny btn--danger" onClick={remove}>
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <p className="editor__empty">Select a nearby note or add one at the playhead.</p>
            )}
            <ul className="editor__list">
              {nearby.map(({ note, d }) => (
                <li key={note.id}>
                  <button
                    type="button"
                    className={`editor__item ${selectedId === note.id ? 'is-active' : ''}`}
                    onClick={() => onSelect(note.id)}
                  >
                    <span className="dot" style={{ background: pitchColor(note.midi) }} />
                    {midiToName(note.midi)}
                    <span>{note.t.toFixed(2)}s</span>
                    <span className="muted">{d < 0.05 ? 'now' : `${d.toFixed(2)}s away`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
