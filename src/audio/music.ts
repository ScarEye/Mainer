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

/** Guitar is written an octave above the sounding pitch. */
export function writtenMidi(midi: number, instrument: MelodicInstrument): number {
  return instrument === 'guitar' ? midi + 12 : midi
}

/**
 * Octaves to add so as many notes as possible sit on the five-line staff.
 * Positive writes the part higher than the pitches passed in.
 * One octave is seven staff positions, so notes stay on lines and spaces.
 */
export function staffOctaveShift(midis: number[], clef: 'treble' | 'bass'): number {
  if (!midis.length) return 0
  const steps = midis.map((midi) => staffStep(midi, clef))
  let best = 0
  let bestScore = -Infinity
  for (let shift = -2; shift <= 2; shift++) {
    let onStaff = 0
    let distance = 0
    for (const step of steps) {
      const placed = step + shift * 7
      if (placed >= -2 && placed <= 10) onStaff += 1
      distance += Math.abs(placed - 4)
    }
    const score = onStaff * 100 - distance
    if (score > bestScore) {
      bestScore = score
      best = shift
    }
  }
  return best
}

/** Octaves the written note sits above the sounding pitch. Guitar starts at +1. */
export function writtenOctavesAbove(instrument: MelodicInstrument, shift: number): number {
  return (instrument === 'guitar' ? 1 : 0) + shift
}

export function octaveMark(octavesAbove: number): string | null {
  if (octavesAbove === 1) return '8vb'
  if (octavesAbove >= 2) return '15mb'
  if (octavesAbove === -1) return '8va'
  if (octavesAbove <= -2) return '15ma'
  return null
}

export function octaveWords(octavesAbove: number): string | null {
  if (octavesAbove === 1) return 'one octave lower'
  if (octavesAbove >= 2) return 'two octaves lower'
  if (octavesAbove === -1) return 'one octave higher'
  if (octavesAbove <= -2) return 'two octaves higher'
  return null
}
