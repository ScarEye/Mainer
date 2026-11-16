import catalog from './catalog.json' with { type: 'json' }
import type { StemId } from '../types/chart'

export type QualityId = 'fast' | 'balanced' | 'best'
export type DeviceChoice = 'cpu' | 'cuda'
export type SplitRange = 'full' | 'loop'

export type QualityOption = {
  id: QualityId
  label: string
  time: string
  shifts: number
  overlap: number
  bump: number
}

export type SeparateModel = {
  id: string
  label: string
  detail: string
  stems: StemId[]
  sdr: Partial<Record<StemId, number>>
}

export const QUALITIES = catalog.qualities as QualityOption[]
export const SEPARATE_MODELS = catalog.models as SeparateModel[]

const WEIGHT: Record<StemId, number> = {
  drums: 0.35,
  vocals: 0.2,
  bass: 0.15,
  guitar: 0.12,
  piano: 0.08,
  other: 0.1,
}

export function modelById(id: string): SeparateModel {
  return SEPARATE_MODELS.find((model) => model.id === id) ?? SEPARATE_MODELS[0]!
}

export function qualityById(id: string): QualityOption {
  return QUALITIES.find((quality) => quality.id === id) ?? QUALITIES[1]!
}

export function modelBasePct(model: SeparateModel): number {
  let weight = 0
  let sdr = 0
  for (const stem of model.stems) {
    const value = model.sdr[stem]
    if (value == null) continue
    const w = WEIGHT[stem]
    weight += w
    sdr += w * value
  }
  if (!weight) return 70
  const mixed = sdr / weight
  return Math.round(Math.min(93, Math.max(40, 50 + (mixed - 5) * 8)))
}
