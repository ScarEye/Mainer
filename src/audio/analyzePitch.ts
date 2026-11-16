import type { MelodicInstrument, PitchNote } from '../types/chart'
import { createNoteId } from '../types/chart'
import { MELODIC_RANGE } from './music'

const PROFILE: Record<MelodicInstrument, { rate: number; minHz: number; maxHz: number; poly: number; frame: number; hopMs: number }> = {
  bass: { rate: 8000, minHz: 34, maxHz: 450, poly: 1, frame: 1024, hopMs: 22 },
  guitar: { rate: 11025, minHz: 75, maxHz: 1400, poly: 4, frame: 2048, hopMs: 30 },
  piano: { rate: 11025, minHz: 50, maxHz: 2200, poly: 5, frame: 4096, hopMs: 36 },
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

function downsample(channel: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate <= toRate * 1.05) return channel
  const ratio = fromRate / toRate
  const n = Math.floor(channel.length / ratio)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio)
    const b = Math.min(channel.length, Math.floor((i + 1) * ratio))
    let s = 0
    for (let j = a; j < b; j++) s += channel[j]!
    out[i] = s / Math.max(1, b - a)
  }
  return out
}

function nextPow2(n: number) {
  let p = 1
  while (p < n) p <<= 1
  return p
}

function fft(re: Float32Array, im: Float32Array, invert: boolean) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]!
      re[i] = re[j]!
      re[j] = tr
      const ti = im[i]!
      im[i] = im[j]!
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((invert ? -2 : 2) * Math.PI) / len
    const wlenRe = Math.cos(ang)
    const wlenIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let wRe = 1
      let wIm = 0
      const half = len >> 1
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j]!
        const uIm = im[i + j]!
        const vRe = re[i + j + half]! * wRe - im[i + j + half]! * wIm
        const vIm = re[i + j + half]! * wIm + im[i + j + half]! * wRe
        re[i + j] = uRe + vRe
        im[i + j] = uIm + vIm
        re[i + j + half] = uRe - vRe
        im[i + j + half] = uIm - vIm
        const nextRe = wRe * wlenRe - wIm * wlenIm
        wIm = wRe * wlenIm + wIm * wlenRe
        wRe = nextRe
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] = re[i]! / n
      im[i] = im[i]! / n
    }
  }
}

function frameRms(data: Float32Array, start: number, len: number) {
  const end = Math.min(data.length, start + len)
  let s = 0
  let n = 0
  for (let i = start; i < end; i++) {
    const v = data[i]!
    s += v * v
    n++
  }
  return n ? Math.sqrt(s / n) : 0
}

function windowed(data: Float32Array, start: number, frame: number, nfft: number) {
  const re = new Float32Array(nfft)
  const im = new Float32Array(nfft)
  const len = Math.min(frame, data.length - start)
  for (let i = 0; i < len; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, len - 1))
    re[i] = data[start + i]! * w
  }
  return { re, im }
}

function freqToMidi(freq: number) {
  return Math.round(69 + 12 * Math.log2(freq / 440))
}

function estimateF0(reIn: Float32Array, imIn: Float32Array, sampleRate: number, minHz: number, maxHz: number): number | null {
  const re = reIn.slice()
  const im = imIn.slice()
  fft(re, im, false)
  for (let i = 0; i < re.length; i++) {
    re[i] = re[i]! * re[i]! + im[i]! * im[i]!
    im[i] = 0
  }
  fft(re, im, true)
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz))
  const maxLag = Math.min((re.length >> 1) - 2, Math.floor(sampleRate / minHz))
  if (maxLag <= minLag) return null
  let bestLag = -1
  let best = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    const v = re[lag]!
    if (v > best && v >= re[lag - 1]! && v >= re[lag + 1]!) {
      best = v
      bestLag = lag
    }
  }
  const norm = re[0] || 1
  if (best / norm < 0.28) return null
  // First strong peak is the fundamental. A later, taller peak is usually a harmonic.
  let lag = -1
  for (let i = minLag + 1; i < maxLag; i++) {
    if (re[i]! >= re[i - 1]! && re[i]! >= re[i + 1]! && re[i]! > norm * 0.38) {
      lag = i
      break
    }
  }
  if (lag < 0) lag = bestLag
  if (lag < 0) return null
  const y0 = re[lag - 1]!
  const y1 = re[lag]!
  const y2 = re[lag + 1]!
  const denom = y0 - 2 * y1 + y2
  const shift = Math.abs(denom) < 1e-9 ? 0 : (0.5 * (y0 - y2)) / denom
  const period = lag + Math.max(-0.5, Math.min(0.5, shift))
  if (period < 2) return null
  return sampleRate / period
}

function pickPeaks(
  mags: Float32Array,
  sampleRate: number,
  nfft: number,
  minHz: number,
  maxHz: number,
  maxNotes: number,
): number[] {
  const minBin = Math.max(2, Math.floor((minHz * nfft) / sampleRate))
  const maxBin = Math.min(mags.length - 2, Math.ceil((maxHz * nfft) / sampleRate))
  let peak = 0
  for (let i = minBin; i <= maxBin; i++) peak = Math.max(peak, mags[i]!)
  if (peak < 1e-8) return []
  const found: { hz: number; mag: number }[] = []
  for (let i = minBin; i <= maxBin; i++) {
    const m = mags[i]!
    if (m < peak * 0.1) continue
    if (m < mags[i - 1]! || m < mags[i + 1]!) continue
    const denom = mags[i - 1]! - 2 * m + mags[i + 1]!
    const shift = Math.abs(denom) < 1e-12 ? 0 : (0.5 * (mags[i - 1]! - mags[i + 1]!)) / denom
    found.push({ hz: ((i + shift) * sampleRate) / nfft, mag: m })
  }
  found.sort((a, b) => a.hz - b.hz || b.mag - a.mag)
  const chosen: number[] = []
  for (const p of found) {
    const harmonic = chosen.some((f) => {
      const ratio = p.hz / f
      const nearest = Math.round(ratio)
      return nearest >= 2 && nearest <= 6 && Math.abs(ratio - nearest) < 0.04
    })
    if (harmonic) continue
    const midi = freqToMidi(p.hz)
    if (chosen.some((f) => Math.abs(freqToMidi(f) - midi) === 0)) continue
    chosen.push(p.hz)
  }
  chosen.sort((a, b) => {
    const mag = (hz: number) => {
      const bin = Math.round((hz * nfft) / sampleRate)
      return mags[bin] ?? 0
    }
    return mag(b) - mag(a)
  })
  return chosen.slice(0, maxNotes)
}

type OpenNote = { t: number; last: number; midi: number; vel: number }

export async function analyzePitchChart(buffer: AudioBuffer, instrument: MelodicInstrument): Promise<PitchNote[]> {
  const profile = PROFILE[instrument]
  const range = MELODIC_RANGE[instrument]
  const mixed = downsample(mixdown(buffer), buffer.sampleRate, profile.rate)
  const rate = Math.min(buffer.sampleRate, profile.rate)
  const hop = Math.max(1, Math.floor((rate * profile.hopMs) / 1000))
  const frame = Math.min(profile.frame, Math.max(256, mixed.length))
  const nfft = nextPow2(Math.max(frame * 2, instrument === 'bass' ? 2048 : frame))
  let peak = 1e-6
  for (let start = 0; start + 64 < mixed.length; start += hop * 4) {
    peak = Math.max(peak, frameRms(mixed, start, frame))
  }
  const gate = Math.max(0.0035, peak * 0.07)

  const open = new Map<number, OpenNote>()
  const finished: PitchNote[] = []
  const close = (note: OpenNote) => {
    const dur = note.last - note.t
    if (dur < 0.045) return
    finished.push({
      id: createNoteId(),
      t: note.t,
      midi: note.midi,
      dur: Math.min(Math.max(dur, 0.06), 2.2),
      vel: note.vel,
    })
  }

  let frameIndex = 0
  for (let start = 0; start + 64 < mixed.length; start += hop) {
    const t = start / rate
    const rms = frameRms(mixed, start, frame)
    const seen = new Set<number>()
    if (rms >= gate) {
      const { re, im } = windowed(mixed, start, frame, nfft)
      let freqs: number[] = []
      if (profile.poly === 1) {
        const f0 = estimateF0(re, im, rate, profile.minHz, profile.maxHz)
        if (f0) freqs = [f0]
      } else {
        fft(re, im, false)
        const mags = new Float32Array(nfft >> 1)
        for (let i = 0; i < mags.length; i++) mags[i] = Math.hypot(re[i]!, im[i]!)
        freqs = pickPeaks(mags, rate, nfft, profile.minHz, profile.maxHz, profile.poly)
      }
      for (const freq of freqs) {
        const midi = freqToMidi(freq)
        if (midi < range.min || midi > range.max) continue
        seen.add(midi)
        const cur = open.get(midi)
        if (cur && t - cur.last < 0.14) {
          cur.last = t
          cur.vel = Math.max(cur.vel, rms)
        } else {
          if (cur) close(cur)
          open.set(midi, { t, last: t, midi, vel: rms })
        }
      }
    }
    for (const [midi, cur] of open) {
      if (!seen.has(midi) && t - cur.last > 0.12) {
        close(cur)
        open.delete(midi)
      }
    }
    frameIndex++
    if (frameIndex % 500 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  for (const cur of open.values()) close(cur)

  const maxNotes = Math.max(48, Math.floor(buffer.duration * (instrument === 'piano' ? 8 : 6)))
  const kept = finished.length > maxNotes ? finished.sort((a, b) => b.vel - a.vel).slice(0, maxNotes) : finished
  kept.sort((a, b) => a.t - b.t || a.midi - b.midi)
  return kept
}

export function shiftPitchNotes(notes: PitchNote[], offset: number): PitchNote[] {
  if (!offset) return notes
  return notes.map((note) => ({ ...note, t: note.t + offset }))
}

export function mergePitchNotes(
  previous: PitchNote[] | undefined,
  added: PitchNote[],
  start: number,
  end: number,
): PitchNote[] {
  const kept = (previous ?? []).filter((note) => note.t < start - 0.03 || note.t > end + 0.03)
  return [...kept, ...added].sort((a, b) => a.t - b.t || a.midi - b.midi)
}
