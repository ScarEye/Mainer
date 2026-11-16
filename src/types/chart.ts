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

export const LANE_COLORS: Record<DrumLane, string> = {
  kick: '#00f0ff',
  snare: '#ff2d75',
  tom: '#a855f7',
  hat: '#7dd3fc',
  crash: '#f0abfc',
  ride: '#67e8f9',
}

/** Practice stage visual style. */
export type VisualMode = 'digital' | 'notation' | 'kit'

export const VISUAL_MODES: { id: VisualMode; label: string }[] = [
  { id: 'digital', label: 'Digital' },
  { id: 'notation', label: 'Notation' },
  { id: 'kit', label: 'Kit' },
]

export function createNoteId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export type StemId = 'drums' | 'bass' | 'vocals' | 'guitar' | 'piano' | 'other'

export const STEM_IDS: StemId[] = ['drums', 'bass', 'vocals', 'guitar', 'piano', 'other']

export const STEM_LABELS: Record<StemId, string> = {
  drums: 'Drums',
  bass: 'Bass',
  vocals: 'Vocals',
  guitar: 'Guitar',
  piano: 'Piano',
  other: 'Other',
}

export type StemLevels = Record<StemId, { volume: number; muted: boolean }>

export function defaultStemLevels(): StemLevels {
  return {
    drums: { volume: 1, muted: false },
    bass: { volume: 1, muted: false },
    vocals: { volume: 1, muted: false },
    guitar: { volume: 1, muted: false },
    piano: { volume: 1, muted: false },
    other: { volume: 1, muted: false },
  }
}
