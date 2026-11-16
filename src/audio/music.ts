import type { MelodicInstrument } from '../types/chart'

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

const PITCH_HUES = [190, 205, 230, 255, 275, 300, 325, 345, 15, 40, 70, 145]

/** Open string MIDI notes, low string first. */
export const GUITAR_TUNING = [40, 45, 50, 55, 59, 64]
export const BASS_TUNING = [28, 33, 38, 43]
export const GUITAR_STRINGS = ['E', 'A', 'D', 'G', 'B', 'e']
export const BASS_STRINGS = ['E', 'A', 'D', 'G']

export const MELODIC_RANGE: Record<MelodicInstrument, { min: number; max: number; add: number }> = {
  bass: { min: 28, max: 67, add: 40 },
  guitar: { min: 40, max: 88, add: 52 },
  piano: { min: 21, max: 108, add: 60 },
}

export function midiToName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[pc]}${octave}`
}

export function pitchColor(midi: number): string {
  const pc = ((midi % 12) + 12) % 12
  return `hsl(${PITCH_HUES[pc]}, 82%, 62%)`
}

export function isBlackKey(midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10
}

export function fretsFor(
  midi: number,
  tuning: number[],
  maxFret = 20,
): { stringIndex: number; fret: number } | null {
  let bestString = -1
  let bestFret = 0
  let bestScore = Infinity
  tuning.forEach((open, stringIndex) => {
    const fret = midi - open
    if (fret < 0 || fret > maxFret) return
    const score = fret <= 12 ? fret : fret + 3
    if (score < bestScore) {
      bestScore = score
      bestString = stringIndex
      bestFret = fret
    }
  })
  return bestString < 0 ? null : { stringIndex: bestString, fret: bestFret }
}

/** Diatonic staff step. Treble bottom line E4 is 0. Bass bottom line G2 is 0. */
export function staffStep(midi: number, clef: 'treble' | 'bass'): number {
  const pc = ((midi % 12) + 12) % 12
  const letter = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][pc]!
  const octave = Math.floor(midi / 12) - 1
  const diatonic = letter + octave * 7
  return diatonic - (clef === 'treble' ? 30 : 18)
}

export function isSharp(midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10
}
