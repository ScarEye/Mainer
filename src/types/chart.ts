export type DrumLane = 'kick' | 'snare' | 'tom' | 'hat' | 'crash' | 'ride'

export interface ChartNote {
  id: string
  t: number
  lane: DrumLane
}

export interface DrumChart {
  title: string
  bpm: number
  offsetMs: number
  instrument: 'drums'
  notes: ChartNote[]
}

export const LANES: DrumLane[] = ['kick', 'snare', 'tom', 'hat', 'crash', 'ride']

export const LANE_LABELS: Record<DrumLane, string> = {
  kick: 'Kick',
  snare: 'Snare',
  tom: 'Tom',
  hat: 'Hi-Hat',
  crash: 'Crash',
  ride: 'Ride',
}

export const LANE_SHORT: Record<DrumLane, string> = {
  kick: 'KICK',
  snare: 'SNR',
  tom: 'TOM',
  hat: 'HAT',
  crash: 'CRSH',
  ride: 'RIDE',
}

export function createNoteId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export type StemId = 'drums' | 'bass' | 'vocals' | 'other'

export const STEM_IDS: StemId[] = ['drums', 'bass', 'vocals', 'other']

export const STEM_LABELS: Record<StemId, string> = {
  drums: 'Drums',
  bass: 'Bass',
  vocals: 'Vocals',
  other: 'Other / Guitar',
}

export type StemLevels = Record<StemId, { volume: number; muted: boolean }>

export function defaultStemLevels(): StemLevels {
  return {
    drums: { volume: 1, muted: false },
    bass: { volume: 1, muted: false },
    vocals: { volume: 1, muted: false },
    other: { volume: 1, muted: false },
  }
}
