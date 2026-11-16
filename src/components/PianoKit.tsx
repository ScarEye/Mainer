import { useMemo } from 'react'
import type { PitchNote } from '../types/chart'
import { isBlackKey, midiToName, pitchColor } from '../audio/music'

type Props = {
  notes: PitchNote[]
  currentTime: number
  lookAheadSec?: number
  hitWindow?: number
}

function intensity(note: PitchNote, currentTime: number, lookAheadSec: number, hitWindow: number) {
  const dt = note.t - currentTime
  if (dt < -hitWindow || dt > lookAheadSec) return 0
  if (dt <= 0) return 1 - Math.abs(dt) / hitWindow
  return (1 - dt / lookAheadSec) * 0.85
}

function alignC(midi: number, dir: -1 | 1) {
  const pc = ((midi % 12) + 12) % 12
  if (dir < 0) return midi - pc
  return pc === 0 ? midi : midi + (12 - pc)
}

export function PianoKit({ notes, currentTime, lookAheadSec = 2.2, hitWindow = 0.12 }: Props) {
  const range = useMemo(() => {
    if (!notes.length) return [48, 72] as const
    let lo = 127
    let hi = 0
    for (const note of notes) {
      lo = Math.min(lo, note.midi)
      hi = Math.max(hi, note.midi)
    }
    let start = alignC(Math.max(21, lo - 1), -1)
    let end = alignC(Math.min(108, hi + 1), 1)
    if (end - start > 48) {
      const upcoming = notes.find((note) => note.t >= currentTime - 0.05) ?? notes[0]!
      start = alignC(Math.max(21, upcoming.midi - 12), -1)
      end = Math.min(108, start + 36)
    }
    if (end <= start) end = start + 12
    return [start, end] as const
  }, [notes, currentTime])

  const [lo, hi] = range
  const whites = useMemo(() => {
    const keys: number[] = []
    for (let midi = lo; midi <= hi; midi++) if (!isBlackKey(midi)) keys.push(midi)
    return keys
  }, [lo, hi])

  const lit = useMemo(() => {
    const map = new Map<number, number>()
    for (const note of notes) {
      if (note.midi < lo || note.midi > hi) continue
      const amount = intensity(note, currentTime, lookAheadSec, hitWindow)
      if (amount <= 0.04) continue
      map.set(note.midi, Math.max(map.get(note.midi) ?? 0, amount))
    }
    return map
  }, [notes, currentTime, lookAheadSec, hitWindow, lo, hi])

  const next = useMemo(() => {
    let best: PitchNote | null = null
    for (const note of notes) {
      if (note.t < currentTime - 0.05) continue
      if (!best || note.t < best.t) best = note
    }
    return best
  }, [notes, currentTime])

  const whiteW = whites.length ? 920 / whites.length : 40
  const xWhite = (midi: number) => {
    const index = whites.indexOf(midi)
    return 40 + index * whiteW
  }
  const xBlack = (midi: number) => {
    const prevWhite = whites.filter((key) => key < midi).pop()
    if (prevWhite == null) return 40
    return xWhite(prevWhite) + whiteW - whiteW * 0.32
  }

  return (
    <div className="kit-view">
      <svg className="kit-view__svg" viewBox="0 30 1000 470" role="img" aria-label="Piano keyboard">
        <rect width="1000" height="560" fill="#0a0a0f" />
        {whites.map((midi) => {
          const amount = lit.get(midi) ?? 0
          const x = xWhite(midi)
          return (
            <g key={midi}>
              <rect
                x={x + 1}
                y="70"
                width={Math.max(8, whiteW - 2)}
                height="280"
                rx="4"
                fill={amount > 0.08 ? pitchColor(midi) : '#e8e4dc'}
                opacity={amount > 0.08 ? 0.45 + amount * 0.55 : 0.92}
                stroke="#1a1a2e"
              />
              {midi % 12 === 0 && (
                <text x={x + whiteW / 2} y="330" textAnchor="middle" fill="#1a1a2e" fontFamily="Share Tech Mono, monospace" fontSize="14">
                  {midiToName(midi)}
                </text>
              )}
            </g>
          )
        })}
        {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
          .filter((midi) => isBlackKey(midi))
          .map((midi) => {
            const amount = lit.get(midi) ?? 0
            return (
              <rect
                key={midi}
                x={xBlack(midi)}
                y="70"
                width={Math.max(8, whiteW * 0.62)}
                height="170"
                rx="3"
                fill={amount > 0.08 ? pitchColor(midi) : '#16161f'}
                stroke={amount > 0.08 ? pitchColor(midi) : '#0a0a0f'}
                strokeWidth={amount > 0.2 ? 3 : 1}
              />
            )
          })}
      </svg>
      <div className="kit-view__cue">
        {next ? (
          <>
            <span className="kit-view__cue-lane" style={{ color: pitchColor(next.midi) }}>
              {midiToName(next.midi)}
            </span>
            <span className="kit-view__cue-time">
              {next.t - currentTime <= 0.05 ? 'NOW' : `in ${(next.t - currentTime).toFixed(2)}s`}
            </span>
          </>
        ) : (
          <span className="muted">No upcoming notes</span>
        )}
      </div>
    </div>
  )
}
