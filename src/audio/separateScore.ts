import type { StemId } from '../types/chart'
import { modelBasePct, qualityById, type SeparateModel } from '../separate/models'

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function mixdown(buffer: AudioBuffer): Float32Array {
  const frames = buffer.length
  const out = new Float32Array(frames)
  const channels = buffer.numberOfChannels
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < frames; i++) out[i]! += data[i]! / channels
  }
  return out
}

export function songPenalty(buffer: AudioBuffer, startSec = 0, endSec = buffer.duration): number {
  const left = buffer.getChannelData(0)
  const from = Math.max(0, Math.floor(startSec * buffer.sampleRate))
  const to = Math.min(left.length, Math.floor(endSec * buffer.sampleRate))
  const span = to - from
  if (span < buffer.sampleRate * 0.2) return 0

  const step = Math.max(1, Math.floor(span / 120000))
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null
  let count = 0
  let clip = 0
  for (let i = from; i < to; i += step) {
    const l = left[i] ?? 0
    const r = right ? (right[i] ?? l) : l
    count++
    if (Math.abs(l) > 0.985 || Math.abs(r) > 0.985) clip++
  }
  if (!count) return 0
  const clipRatio = clip / count
  if (clipRatio <= 0.02) return 0
  return Math.min(6, Math.round(clipRatio * 120))
}

export function estimateSplitAccuracy(
  buffer: AudioBuffer,
  model: SeparateModel,
  qualityId: string,
  region: { start: number; end: number } | null,
): number {
  const quality = qualityById(qualityId)
  const start = region?.start ?? 0
  const end = region?.end ?? buffer.duration
  const penalty = songPenalty(buffer, start, end)
  return clamp(Math.round(modelBasePct(model) + quality.bump - penalty), 40, 98)
}

function shaped(data: Float32Array, sampleRate: number, lo: number, hi: number): Float32Array {
  const step = Math.max(1, Math.floor(data.length / 160000))
  const rate = sampleRate / step
  const coef = (hz: number) => 1 - Math.exp((-2 * Math.PI * hz) / rate)
  const aLo = lo > 0 ? coef(lo) : 0
  const aHi = coef(hi)
  let low = 0
  let high = 0
  const out = new Float32Array(Math.ceil(data.length / step))
  let j = 0
  for (let i = 0; i < data.length; i += step) {
    const s = data[i] ?? 0
    if (aLo) low += aLo * (s - low)
    high += aHi * (s - high)
    out[j++] = aLo ? high - low : high
  }
  return out
}

/** 0 when the two stems share no signal in this band. Snare energy is not vocal bleed. */
function bleed(a: AudioBuffer, b: AudioBuffer, lo: number, hi: number): number | null {
  if (a.length < a.sampleRate * 0.2 || b.length < b.sampleRate * 0.2) return null
  const left = shaped(mixdown(a), a.sampleRate, lo, hi)
  const right = shaped(mixdown(b), b.sampleRate, lo, hi)
  const n = Math.min(left.length, right.length)
  if (n < 32) return null
  let meanL = 0
  let meanR = 0
  for (let i = 0; i < n; i++) {
    meanL += left[i]!
    meanR += right[i]!
  }
  meanL /= n
  meanR /= n
  let num = 0
  let denL = 0
  let denR = 0
  for (let i = 0; i < n; i++) {
    const xl = left[i]! - meanL
    const xr = right[i]! - meanR
    num += xl * xr
    denL += xl * xl
    denR += xr * xr
  }
  if (denL < 1e-10 || denR < 1e-10) return null
  return Math.max(0, num / Math.sqrt(denL * denR))
}

const PAIRS: [StemId, StemId, number, number][] = [
  ['drums', 'vocals', 250, 3400],
  ['drums', 'bass', 0, 140],
  ['drums', 'guitar', 150, 2500],
  ['drums', 'other', 5000, 12000],
  ['bass', 'guitar', 0, 160],
  ['bass', 'other', 0, 140],
  ['guitar', 'vocals', 200, 3000],
  ['guitar', 'other', 150, 4000],
  ['piano', 'vocals', 200, 3000],
  ['piano', 'guitar', 200, 2500],
  ['piano', 'other', 200, 4000],
]

export function measureSplitAccuracy(
  mix: AudioBuffer,
  stems: Partial<Record<StemId, AudioBuffer>>,
  region: { start: number; end: number } | null,
): number {
  const heard = region ? Math.abs(region.end - region.start) : mix.duration
  if (!Number.isFinite(heard) || heard < 0.2) return 90
  const scores: number[] = []
  for (const [a, b, lo, hi] of PAIRS) {
    const left = stems[a]
    const right = stems[b]
    if (!left || !right) continue
    const shared = bleed(left, right, lo, hi)
    if (shared == null) continue
    scores.push(100 * (1 - shared))
  }
  if (!scores.length) return 90
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length
  return clamp(Math.round(mean), 18, 99)
}
