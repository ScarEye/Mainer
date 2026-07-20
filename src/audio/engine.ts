import type { StemId, StemLevels } from '../types/chart'
import { STEM_IDS, defaultStemLevels } from '../types/chart'

export type EngineState = {
  currentTime: number
  duration: number
  playing: boolean
  rate: number
}

type Listener = (state: EngineState) => void

type StemNode = {
  source: AudioBufferSourceNode
  gain: GainNode
}

/**
 * Web Audio playback with optional multi-stem mixing (volume + mute).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null
  private mixBuffer: AudioBuffer | null = null
  private stemBuffers: Partial<Record<StemId, AudioBuffer>> | null = null
  private mixSource: AudioBufferSourceNode | null = null
  private mixGain: GainNode | null = null
  private stemNodes: Partial<Record<StemId, StemNode>> = {}
  private master: GainNode | null = null
  private levels: StemLevels = defaultStemLevels()
  private startedAt = 0
  private offset = 0
  private playing = false
  private rate = 1
  private loop: { start: number; end: number } | null = null
  private raf = 0
  private listeners = new Set<Listener>()

  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) this.ctx = new AudioContext()
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    return this.ctx
  }

  get hasStems() {
    return Boolean(this.stemBuffers && STEM_IDS.every((id) => this.stemBuffers?.[id]))
  }

  async loadBuffer(buffer: AudioBuffer): Promise<void> {
    await this.stop()
    this.mixBuffer = buffer
    this.stemBuffers = null
    this.levels = defaultStemLevels()
    this.offset = 0
    this.emit()
  }

  async loadStems(stems: Record<StemId, AudioBuffer>): Promise<void> {
    const wasPlaying = this.playing
    const t = this.currentTime
    await this.stopSourceOnly()
    this.stemBuffers = stems
    // Prefer drums duration, else mix
    this.mixBuffer = stems.drums ?? this.mixBuffer
    this.playing = false
    this.offset = t
    this.emit()
    if (wasPlaying) await this.play()
  }

  get duration(): number {
    if (this.hasStems && this.stemBuffers?.drums) return this.stemBuffers.drums.duration
    return this.mixBuffer?.duration ?? 0
  }

  get currentTime(): number {
    if (!this.ctx || !this.playing) return this.offset
    const t = this.offset + (this.ctx.currentTime - this.startedAt) * this.rate
    if (this.loop && t >= this.loop.end) return this.loop.start
    return Math.min(t, this.duration)
  }

  getStemLevels(): StemLevels {
    return structuredClone(this.levels)
  }

  setStemLevel(id: StemId, patch: Partial<{ volume: number; muted: boolean }>) {
    this.levels[id] = { ...this.levels[id], ...patch }
    this.applyStemGains()
    this.emit()
  }

  setAllStemLevels(levels: StemLevels) {
    this.levels = structuredClone(levels)
    this.applyStemGains()
    this.emit()
  }

  private effectiveGain(id: StemId): number {
    const lvl = this.levels[id]
    if (lvl.muted) return 0
    return Math.max(0, Math.min(1.5, lvl.volume))
  }

  private applyStemGains() {
    if (this.hasStems) {
      for (const id of STEM_IDS) {
        const node = this.stemNodes[id]
        if (node) node.gain.gain.value = this.effectiveGain(id)
      }
      if (this.mixGain) this.mixGain.gain.value = 0
    } else if (this.mixGain) {
      this.mixGain.gain.value = 1
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.snapshot())
    return () => this.listeners.delete(fn)
  }

  private snapshot(): EngineState {
    return {
      currentTime: this.currentTime,
      duration: this.duration,
      playing: this.playing,
      rate: this.rate,
    }
  }

  private emit() {
    const snap = this.snapshot()
    for (const fn of this.listeners) fn(snap)
  }

  private tick = () => {
    if (!this.playing || !this.ctx) return

    let t = this.offset + (this.ctx.currentTime - this.startedAt) * this.rate

    if (this.loop && t >= this.loop.end) {
      void this.seek(this.loop.start)
      void this.play()
      return
    }

    if (t >= this.duration) {
      this.offset = this.duration
      this.playing = false
      void this.stopSourceOnly()
      this.emit()
      return
    }

    this.emit()
    this.raf = requestAnimationFrame(this.tick)
  }

  async setRate(rate: number): Promise<void> {
    const wasPlaying = this.playing
    const t = this.currentTime
    this.rate = Math.min(1.5, Math.max(0.5, rate))
    if (wasPlaying) {
      await this.seek(t)
      await this.play()
    } else {
      this.emit()
    }
  }

  setLoop(start: number | null, end: number | null) {
    if (start == null || end == null || end - start < 0.25) {
      this.loop = null
    } else {
      this.loop = { start: Math.min(start, end), end: Math.max(start, end) }
    }
    this.emit()
  }

  getLoop() {
    return this.loop
  }

  async play(): Promise<void> {
    const bufferReady = this.hasStems || this.mixBuffer
    if (!bufferReady) return
    const ctx = await this.ensureContext()
    await this.stopSourceOnly()

    this.master = ctx.createGain()
    this.master.gain.value = 1
    this.master.connect(ctx.destination)

    const startOffset = Math.min(this.offset, Math.max(0, this.duration - 0.01))

    if (this.hasStems && this.stemBuffers) {
      for (const id of STEM_IDS) {
        const buf = this.stemBuffers[id]
        if (!buf) continue
        const source = ctx.createBufferSource()
        const gain = ctx.createGain()
        source.buffer = buf
        source.playbackRate.value = this.rate
        gain.gain.value = this.effectiveGain(id)
        source.connect(gain)
        gain.connect(this.master)
        source.start(0, startOffset)
        this.stemNodes[id] = { source, gain }
      }
    } else if (this.mixBuffer) {
      const source = ctx.createBufferSource()
      const gain = ctx.createGain()
      source.buffer = this.mixBuffer
      source.playbackRate.value = this.rate
      gain.gain.value = 1
      source.connect(gain)
      gain.connect(this.master)
      source.start(0, startOffset)
      this.mixSource = source
      this.mixGain = gain
    }

    this.startedAt = ctx.currentTime
    this.offset = startOffset
    this.playing = true
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.tick)
    this.emit()
  }

  async pause(): Promise<void> {
    if (!this.playing) return
    this.offset = this.currentTime
    await this.stopSourceOnly()
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.emit()
  }

  async stop(): Promise<void> {
    await this.stopSourceOnly()
    this.playing = false
    this.offset = 0
    cancelAnimationFrame(this.raf)
    this.emit()
  }

  async seek(time: number): Promise<void> {
    const wasPlaying = this.playing
    const clamped = Math.max(0, Math.min(time, this.duration))
    await this.stopSourceOnly()
    this.offset = clamped
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.emit()
    if (wasPlaying) await this.play()
  }

  private async stopSourceOnly() {
    for (const id of STEM_IDS) {
      const node = this.stemNodes[id]
      if (!node) continue
      try {
        node.source.stop()
      } catch {
        /* already stopped */
      }
      node.source.disconnect()
      node.gain.disconnect()
      delete this.stemNodes[id]
    }
    if (this.mixSource) {
      try {
        this.mixSource.stop()
      } catch {
        /* already stopped */
      }
      this.mixSource.disconnect()
      this.mixSource = null
    }
    if (this.mixGain) {
      this.mixGain.disconnect()
      this.mixGain = null
    }
    if (this.master) {
      this.master.disconnect()
      this.master = null
    }
  }

  async dispose() {
    await this.stop()
    await this.ctx?.close()
    this.ctx = null
    this.mixBuffer = null
    this.stemBuffers = null
  }
}
