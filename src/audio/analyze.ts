import type { ChartNote, DrumChart, DrumLane } from '../types/chart'
import { createNoteId } from '../types/chart'

function mean(values: Float32Array | number[]): number {
  let sum = 0
  for (let i = 0; i < values.length; i++) sum += values[i]!
  return sum / values.length
}

function stdDev(values: Float32Array, avg: number): number {
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    const d = values[i]! - avg
    sum += d * d
  }
  return Math.sqrt(sum / values.length)
}

type FrameData = {
  times: Float32Array
  energy: Float32Array
  low: Float32Array
  mid: Float32Array
  high: Float32Array
  centroid: Float32Array
}

/** Frame-wise energy + rough spectral centroid proxies. */
function frameFeatures(channel: Float32Array, sampleRate: number, hopMs = 10): FrameData {
  const hop = Math.max(1, Math.floor((sampleRate * hopMs) / 1000))
  const frameSize = hop * 4
  const count = Math.max(1, Math.floor((channel.length - frameSize) / hop))
  const times = new Float32Array(count)
  const energy = new Float32Array(count)
  const low = new Float32Array(count)
  const mid = new Float32Array(count)
  const high = new Float32Array(count)
  const centroid = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const start = i * hop
    times[i] = start / sampleRate
    let e = 0
    let l = 0
    let m = 0
    let h = 0
    let weighted = 0
    let magSum = 0
    let prev = 0
    let prev2 = 0
    for (let j = 0; j < frameSize; j++) {
      const s = channel[start + j] ?? 0
      const a = Math.abs(s)
      e += s * s
      const hp = s - prev
      const bp = hp - (prev - prev2)
      l += a
      m += Math.abs(hp)
      h += Math.abs(bp)
      // crude brightness proxy from sample index in frame + hp energy
      weighted += a * (j / frameSize) + Math.abs(hp) * 1.2
      magSum += a + Math.abs(hp)
      prev2 = prev
      prev = s
    }
    energy[i] = e / frameSize
    low[i] = l / frameSize
    mid[i] = m / frameSize
    high[i] = h / frameSize
    centroid[i] = magSum > 1e-8 ? weighted / magSum : 0.5
  }

  return { times, energy, low, mid, high, centroid }
}

function detectOnsets(
  band: Float32Array,
  times: Float32Array,
  minGapSec: number,
  sensitivity = 1.6,
): number[] {
  const avg = mean(band)
  const sd = Math.max(stdDev(band, avg), 1e-8)
  const threshold = avg + sensitivity * sd
  const onsets: number[] = []
  let last = -Infinity

  for (let i = 1; i < band.length - 1; i++) {
    const v = band[i]!
    if (v > threshold && v >= band[i - 1]! && v >= band[i + 1]!) {
      const t = times[i]!
      if (t - last >= minGapSec) {
        onsets.push(t)
        last = t
      }
    }
  }
  return onsets
}

function estimateBpm(onsetTimes: number[]): number {
  if (onsetTimes.length < 8) return 120

  const intervals: number[] = []
  for (let i = 1; i < onsetTimes.length; i++) {
    const d = onsetTimes[i]! - onsetTimes[i - 1]!
    if (d > 0.2 && d < 1.5) intervals.push(d)
  }
  if (intervals.length < 4) return 120

  const bins = new Map<number, number>()
  for (const d of intervals) {
    let bpm = 60 / d
    while (bpm < 70) bpm *= 2
    while (bpm > 180) bpm /= 2
    const key = Math.round(bpm)
    bins.set(key, (bins.get(key) ?? 0) + 1)
  }

  let best = 120
  let bestCount = 0
  for (const [bpm, count] of bins) {
    if (count > bestCount) {
      best = bpm
      bestCount = count
    }
  }
  return best
}

function nearestIndex(times: Float32Array, t: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(times[i]! - t)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

function classifyLane(
  t: number,
  frames: FrameData,
): DrumLane {
  const i = nearestIndex(frames.times, t)
  const l = frames.low[i]!
  const m = frames.mid[i]!
  const h = frames.high[i]!
  const c = frames.centroid[i]!
  const e = frames.energy[i]!
  const total = l + m + h + 1e-8
  const lowR = l / total
  const midR = m / total
  const highR = h / total

  // Kick: boom, low dominant
  if (lowR > 0.48 && c < 0.42) return 'kick'
  // Snare: mid crack
  if (midR > 0.38 && c > 0.35 && c < 0.62) return 'snare'
  // Tom: low-mid body, not as bright as snare
  if (lowR > 0.34 && midR > 0.28 && c < 0.5 && e > mean(frames.energy) * 0.8) return 'tom'
  // Crash: bright + loud broadband
  if (highR > 0.4 && c > 0.68 && e > mean(frames.energy) * 1.4) return 'crash'
  // Ride: bright but less explosive than crash
  if (highR > 0.36 && c > 0.58) return 'ride'
  // Default closed hat / metal tick
  return 'hat'
}

/**
 * Analyze an AudioBuffer into a multi-lane drum practice chart.
 * Prefer feeding a drums-only stem when available.
 */
export async function analyzeDrumChart(
  buffer: AudioBuffer,
  title = 'Uploaded track',
): Promise<DrumChart> {
  const channel = buffer.getChannelData(0)
  const frames = frameFeatures(channel, buffer.sampleRate)

  // Seed band-specific picks, then classify leftover broadband hits.
  const kickSeeds = detectOnsets(frames.low, frames.times, 0.16, 1.85)
  const snareSeeds = detectOnsets(frames.mid, frames.times, 0.12, 1.7)
  const metalSeeds = detectOnsets(frames.high, frames.times, 0.07, 1.55)
  const broad = detectOnsets(frames.energy, frames.times, 0.09, 1.45)

  const notes: ChartNote[] = []
  const usedTimes: number[] = []

  const taken = (t: number, window = 0.045) => usedTimes.some((x) => Math.abs(x - t) < window)

  const push = (t: number, lane: DrumLane) => {
    if (taken(t)) return
    usedTimes.push(t)
    notes.push({ id: createNoteId(), t, lane })
  }

  for (const t of kickSeeds) push(t, 'kick')
  for (const t of snareSeeds) {
    if (taken(t, 0.03)) continue
    push(t, 'snare')
  }
  for (const t of metalSeeds) {
    if (taken(t, 0.035)) continue
    push(t, classifyLane(t, frames))
  }
  for (const t of broad) {
    if (taken(t, 0.05)) continue
    push(t, classifyLane(t, frames))
  }

  notes.sort((a, b) => a.t - b.t || a.lane.localeCompare(b.lane))

  const maxNotes = Math.max(80, Math.floor(buffer.duration * 7))
  const trimmed =
    notes.length > maxNotes
      ? notes.filter((_, i) => i % Math.ceil(notes.length / maxNotes) === 0)
      : notes

  return {
    title,
    bpm: estimateBpm(trimmed.map((n) => n.t)),
    offsetMs: 0,
    instrument: 'drums',
    notes: trimmed,
  }
}
