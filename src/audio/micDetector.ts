export type MicHit = {
  time: number
  energy: number
}

type HitListener = (hit: MicHit) => void

/**
 * Detect transient hits from the microphone for drum timing practice.
 */
export class MicDetector {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private raf = 0
  private running = false
  private lastHitAt = 0
  private listeners = new Set<HitListener>()
  private getSongTime: () => number = () => 0

  setSongTimeProvider(fn: () => number) {
    this.getSongTime = fn
  }

  subscribe(fn: HitListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  get active() {
    return this.running
  }

  async start(): Promise<void> {
    if (this.running) return
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      },
    })
    this.ctx = new AudioContext()
    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.source.connect(this.analyser)
    this.running = true
    this.lastHitAt = 0
    this.tick()
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.source?.disconnect()
    this.analyser?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close()
    this.source = null
    this.analyser = null
    this.stream = null
    this.ctx = null
  }

  private tick = () => {
    if (!this.running || !this.analyser) return
    const data = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(data)

    let sum = 0
    let peak = 0
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]!)
      sum += v
      if (v > peak) peak = v
    }
    const avg = sum / data.length
    const now = performance.now()

    // Transient: high peak relative to average, with debounce.
    if (peak > 0.12 && peak > avg * 6 && now - this.lastHitAt > 90) {
      this.lastHitAt = now
      const hit: MicHit = { time: this.getSongTime(), energy: peak }
      for (const fn of this.listeners) fn(hit)
    }

    this.raf = requestAnimationFrame(this.tick)
  }
}
