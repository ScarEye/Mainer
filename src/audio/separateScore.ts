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

type Bands = { low: number; vocal: number; high: number }

function bandEnergy(data: Float32Array, sampleRate: number, startSec: number, endSec: number): Bands {
  const from = Math.max(0, Math.floor(startSec * sampleRate))
  const to = Math.min(data.length, Math.floor(endSec * sampleRate))
  const span = Math.max(1, to - from)
  const step = Math.max(1, Math.floor(span / 90000))
  const rate = sampleRate / step
  const coef = (hz: number) => 1 - Math.exp((-2 * Math.PI * hz) / rate)
  const aLow = coef(120)
  const aVoice = coef(300)
  const aTop = coef(3400)
  const aHigh = coef(6000)
  let lowState = 0
  let voiceState = 0
  let topState = 0
  let highState = 0
  let low = 0
  let vocal = 0
  let high = 0
  let count = 0
  for (let i = from; i < to; i += step) {
    const s = data[i] ?? 0
    lowState += aLow * (s - lowState)
    voiceState += aVoice * (s - voiceState)
    topState += aTop * (s - topState)
    highState += aHigh * (s - highState)
    const voice = topState - voiceState
    const air = s - highState
    low += lowState * lowState
    vocal += voice * voice
    high += air * air
    count++
  }
  const n = Math.max(1, count)
  return { low: low / n, vocal: vocal / n, high: high / n }
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
  let peak = 0
  let sumSq = 0
  let sumLR = 0
  let sumL2 = 0
  let sumR2 = 0
  for (let i = from; i < to; i += step) {
    const l = left[i] ?? 0
    const r = right ? (right[i] ?? l) : l
    count++
    peak = Math.max(peak, Math.abs(l), Math.abs(r))
    sumSq += l * l
    sumLR += l * r
    sumL2 += l * l
    sumR2 += r * r
    if (Math.abs(l) > 0.985 || Math.abs(r) > 0.985) clip++
  }
  if (!count) return 0

  const rms = Math.sqrt(sumSq / count)
  const crest = peak / (rms + 1e-8)
  const corr = sumLR / Math.sqrt(Math.max(1e-12, sumL2 * sumR2))
  let penalty = 0
  const clipRatio = clip / count
  if (clipRatio > 0.006) penalty += Math.min(8, Math.round(clipRatio * 350))
  if (right && corr > 0.97) penalty += 6
  if (rms > 0.08 && crest < 3) penalty += 6
  else if (rms > 0.12 && crest < 4) penalty += 3
  return Math.min(18, penalty)
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
  return clamp(modelBasePct(model) + quality.bump - penalty, 28, 96)
}

function leak(part: number, whole: number) {
  return part / (whole + part + 1e-9)
}

export function measureSplitAccuracy(
  mix: AudioBuffer,
  stems: Partial<Record<StemId, AudioBuffer>>,
  region: { start: number; end: number } | null,
): number {
  const drums = stems.drums
  if (!drums) return 50
  const mixStart = region?.start ?? 0
  const mixEnd = region?.end ?? mix.duration
  const mixBands = bandEnergy(mixdown(mix), mix.sampleRate, mixStart, mixEnd)
  const drumBands = bandEnergy(mixdown(drums), drums.sampleRate, 0, drums.duration)

  const bandsOf = (id: StemId) => {
    const stem = stems[id]
    if (!stem) return null
    return bandEnergy(mixdown(stem), stem.sampleRate, 0, stem.duration)
  }

  const vocals = bandsOf('vocals')
  const bass = bandsOf('bass')
  const other = bandsOf('other')
  const guitar = bandsOf('guitar')

  let penalty = 0
  if (vocals) penalty += leak(drumBands.vocal, vocals.vocal) * 55
  else penalty += leak(drumBands.vocal, mixBands.vocal) * 28
  if (bass) penalty += leak(drumBands.low, bass.low) * 35
  if (other) penalty += leak(other.high, drumBands.high + other.high) * 30
  if (guitar) penalty += leak(guitar.vocal, drumBands.vocal + guitar.vocal) * 18

  return clamp(Math.round(94 - penalty), 18, 97)
}
