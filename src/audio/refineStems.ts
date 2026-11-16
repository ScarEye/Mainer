import type { StemId } from '../types/chart'

type Coeffs = { b0: number; b1: number; b2: number; a1: number; a2: number }

/**
 * Bass often lands in guitar and Other because the 6-stem model is weak there.
 * Move the low band of those stems back onto bass. The samples moved are the
 * same samples removed, so the mix sum does not change.
 */
const TAKE: Partial<Record<StemId, number>> = {
  guitar: 95,
  other: 130,
  vocals: 85,
  piano: 55,
}

function lowpassCoeffs(sampleRate: number, freq: number): Coeffs {
  const w0 = (2 * Math.PI * freq) / sampleRate
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const alpha = sin / (2 * 0.707)
  const a0 = 1 + alpha
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  }
}

function biquad(input: Float32Array, c: Coeffs): Float32Array {
  const out = new Float32Array(input.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < input.length; i++) {
    const x = input[i]!
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    out[i] = y
  }
  return out
}

function reverse(data: Float32Array) {
  for (let i = 0, j = data.length - 1; i < j; i++, j--) {
    const tmp = data[i]!
    data[i] = data[j]!
    data[j] = tmp
  }
}

/** Zero-phase lowpass so the moved band lines up with the stem it came from. */
function lowpassZeroPhase(input: Float32Array, sampleRate: number, freq: number): Float32Array {
  const c = lowpassCoeffs(sampleRate, freq)
  const pad = Math.min(6000, Math.max(256, Math.floor((sampleRate / freq) * 4)))
  const n = input.length
  const padded = new Float32Array(n + pad * 2)
  for (let i = 0; i < pad; i++) padded[pad - 1 - i] = input[Math.min(n - 1, i + 1)] ?? 0
  padded.set(input, pad)
  for (let i = 0; i < pad; i++) padded[pad + n + i] = input[Math.max(0, n - 2 - i)] ?? 0

  let band = biquad(biquad(padded, c), c)
  reverse(band)
  band = biquad(biquad(band, c), c)
  reverse(band)

  const out = new Float32Array(n)
  out.set(band.subarray(pad, pad + n))
  return out
}

function moveLow(stem: Float32Array, bass: Float32Array, sampleRate: number, hz: number): Float32Array | null {
  const n = Math.min(stem.length, bass.length)
  if (n < 32) return null
  const low = lowpassZeroPhase(stem.subarray(0, n), sampleRate, hz)
  let energy = 0
  for (let i = 0; i < n; i++) energy += low[i]! * low[i]!
  if (energy / n < 1e-8) return null
  for (let i = 0; i < n; i++) {
    const v = low[i]!
    stem[i] = stem[i]! - v
    bass[i] = bass[i]! + v
  }
  return low
}

export async function reclaimBass(stems: Partial<Record<StemId, AudioBuffer>>) {
  const bass = stems.bass
  if (!bass) return
  const rate = bass.sampleRate
  for (const id of Object.keys(TAKE) as StemId[]) {
    const hz = TAKE[id]
    const stem = stems[id]
    if (!hz || !stem || stem.sampleRate !== rate) continue
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (let c = 0; c < stem.numberOfChannels; c++) {
      const stemCh = stem.getChannelData(c)
      const bassCh = bass.getChannelData(Math.min(c, bass.numberOfChannels - 1))
      const low = moveLow(stemCh, bassCh, rate, hz)
      if (!low || c !== stem.numberOfChannels - 1) continue
      for (let b = c + 1; b < bass.numberOfChannels; b++) {
        const extra = bass.getChannelData(b)
        const n = Math.min(low.length, extra.length)
        for (let i = 0; i < n; i++) extra[i] = extra[i]! + low[i]!
      }
    }
  }
}
