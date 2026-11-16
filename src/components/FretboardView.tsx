import { useMemo } from 'react'
import type { PitchNote } from '../types/chart'
import {
  BASS_STRINGS,
  BASS_TUNING,
  GUITAR_STRINGS,
  GUITAR_TUNING,
  fretsFor,
  pitchColor,
} from '../audio/music'

type Props = {
  instrument: 'bass' | 'guitar'
  notes: PitchNote[]
  currentTime: number
  lookAheadSec?: number
  hitWindow?: number
}

const FRETS = 12

function intensity(note: PitchNote, currentTime: number, lookAheadSec: number, hitWindow: number) {
  const dt = note.t - currentTime
  if (dt < -hitWindow || dt > lookAheadSec) return 0
  if (dt <= 0) return 1 - Math.abs(dt) / hitWindow
  return (1 - dt / lookAheadSec) * 0.85
}

export function FretboardView({
  instrument,
  notes,
  currentTime,
  lookAheadSec = 2.2,
  hitWindow = 0.12,
}: Props) {
  const tuning = instrument === 'guitar' ? GUITAR_TUNING : BASS_TUNING
  const names = instrument === 'guitar' ? GUITAR_STRINGS : BASS_STRINGS
  const rows = useMemo(() => [...tuning].map((open, index) => ({ open, index, name: names[index]! })).reverse(), [tuning, names])

  const lit = useMemo(() => {
    const map = new Map<string, { fret: number; stringIndex: number; amount: number; midi: number }>()
    for (const note of notes) {
      const amount = intensity(note, currentTime, lookAheadSec, hitWindow)
      if (amount <= 0.04) continue
      const placed = fretsFor(note.midi, tuning, FRETS)
      if (!placed) continue
      const key = `${placed.stringIndex}:${placed.fret}`
      const prev = map.get(key)
      if (!prev || prev.amount < amount) map.set(key, { ...placed, amount, midi: note.midi })
    }
    return [...map.values()]
  }, [notes, currentTime, lookAheadSec, hitWindow, tuning])

  const next = useMemo(() => {
    let best: PitchNote | null = null
    for (const note of notes) {
      if (note.t < currentTime - 0.05) continue
      if (!best || note.t < best.t) best = note
    }
    return best
  }, [notes, currentTime])

  const nutX = 108
  const boardRight = 960
  const top = 78
  const bottom = instrument === 'bass' ? 400 : 430
  const fretW = (boardRight - nutX) / FRETS
  const gap = rows.length > 1 ? (bottom - top) / (rows.length - 1) : 0

  const yOf = (displayIndex: number) => top + displayIndex * gap
  const xOf = (fret: number) => (fret <= 0 ? nutX - 28 : nutX + (fret - 0.5) * fretW)

  return (
    <div className="kit-view">
      <svg className="kit-view__svg" viewBox="0 40 1000 520" role="img" aria-label={`${instrument} fretboard`}>
        <rect width="1000" height="620" fill="#0a0a0f" />
        <rect x={nutX} y={top - 28} width={boardRight - nutX} height={bottom - top + 56} rx="8" fill="#12121a" stroke="rgba(0,240,255,0.18)" />
        <rect x={nutX - 8} y={top - 28} width="8" height={bottom - top + 56} fill="#e0e0e0" />
        {Array.from({ length: FRETS }, (_, fret) => {
          const x = nutX + (fret + 1) * fretW
          return <line key={fret} x1={x} y1={top - 22} x2={x} y2={bottom + 22} stroke="rgba(224,224,224,0.28)" strokeWidth="2" />
        })}
        {[3, 5, 7, 9].map((fret) => (
          <circle key={fret} cx={nutX + (fret - 0.5) * fretW} cy={(top + bottom) / 2} r="7" fill="rgba(0,240,255,0.18)" />
        ))}
        <circle cx={nutX + (12 - 0.5) * fretW} cy={(top + bottom) / 2 - 28} r="6" fill="rgba(0,240,255,0.18)" />
        <circle cx={nutX + (12 - 0.5) * fretW} cy={(top + bottom) / 2 + 28} r="6" fill="rgba(0,240,255,0.18)" />
        {rows.map((row, display) => {
          const y = yOf(display)
          const thick = 2 + (rows.length - display) * 0.7
          return (
            <g key={row.index}>
              <line x1={nutX} y1={y} x2={boardRight} y2={y} stroke="rgba(232,220,200,0.75)" strokeWidth={thick} />
              <text x="48" y={y + 6} fill="rgba(232,220,200,0.8)" fontFamily="Orbitron, sans-serif" fontSize="20" fontWeight="700">
                {row.name}
              </text>
            </g>
          )
        })}
        {Array.from({ length: FRETS }, (_, i) => (
          <text
            key={i}
            x={nutX + (i + 0.5) * fretW}
            y={bottom + 52}
            textAnchor="middle"
            fill="rgba(136,136,136,0.9)"
            fontFamily="Share Tech Mono, monospace"
            fontSize="16"
          >
            {i + 1}
          </text>
        ))}
        {lit.map((mark) => {
          const display = rows.findIndex((row) => row.index === mark.stringIndex)
          if (display < 0) return null
          const color = pitchColor(mark.midi)
          return (
            <g key={`${mark.stringIndex}-${mark.fret}`}>
              <circle cx={xOf(mark.fret)} cy={yOf(display)} r={16 + mark.amount * 8} fill={color} opacity={0.18 + mark.amount * 0.35} />
              <circle cx={xOf(mark.fret)} cy={yOf(display)} r="13" fill={color} stroke="#0a0a0f" strokeWidth="2" />
              <text
                x={xOf(mark.fret)}
                y={yOf(display) + 4}
                textAnchor="middle"
                fill="#0a0a0f"
                fontFamily="Share Tech Mono, monospace"
                fontSize="12"
                fontWeight="700"
              >
                {mark.fret}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="kit-view__cue">
        {next ? (
          <>
            <span className="kit-view__cue-lane" style={{ color: pitchColor(next.midi) }}>
              {(() => {
                const placed = fretsFor(next.midi, tuning, FRETS)
                return placed ? `${names[placed.stringIndex]} fret ${placed.fret}` : 'next note'
              })()}
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
