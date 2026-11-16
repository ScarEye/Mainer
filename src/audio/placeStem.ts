export function sliceBuffer(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
): AudioBuffer {
  const rate = buffer.sampleRate
  const from = Math.max(0, Math.floor(startSec * rate))
  const to = Math.min(buffer.length, Math.floor(endSec * rate))
  const frames = Math.max(1, to - from)
  const out = ctx.createBuffer(buffer.numberOfChannels, frames, rate)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.getChannelData(c).set(buffer.getChannelData(c).subarray(from, to))
  }
  return out
}

export function placeStem(
  ctx: BaseAudioContext,
  stem: AudioBuffer,
  fullFrames: number,
  fullRate: number,
  offsetSec: number,
): AudioBuffer {
  const channels = Math.min(2, Math.max(1, stem.numberOfChannels))
  const out = ctx.createBuffer(channels, fullFrames, fullRate)
  const offset = Math.max(0, Math.round(offsetSec * fullRate))
  const ratio = stem.sampleRate / fullRate
  for (let c = 0; c < channels; c++) {
    const src = stem.getChannelData(Math.min(c, stem.numberOfChannels - 1))
    const dst = out.getChannelData(c)
    const room = fullFrames - offset
    for (let i = 0; i < room; i++) {
      const pos = i * ratio
      const i0 = Math.floor(pos)
      if (i0 >= src.length) break
      const i1 = Math.min(src.length - 1, i0 + 1)
      const frac = pos - i0
      dst[offset + i] = src[i0]! * (1 - frac) + src[i1]! * frac
    }
  }
  return out
}
