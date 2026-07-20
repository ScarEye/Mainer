import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

type Props = {
  buffer: AudioBuffer | null
  currentTime: number
  duration: number
  loopStart: number | null
  loopEnd: number | null
  onSeek: (t: number) => void
  onSetLoopPoint: (which: 'start' | 'end', t: number) => void
}

export function WaveformScrub({
  buffer,
  currentTime,
  duration,
  loopStart,
  loopEnd,
  onSeek,
  onSetLoopPoint,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)

  useEffect(() => {
    if (!buffer) {
      setPeaks(null)
      return
    }
    const data = buffer.getChannelData(0)
    const bars = 240
    const block = Math.floor(data.length / bars)
    const next = new Float32Array(bars)
    for (let i = 0; i < bars; i++) {
      let max = 0
      const start = i * block
      for (let j = 0; j < block; j++) {
        const v = Math.abs(data[start + j] ?? 0)
        if (v > max) max = v
      }
      next[i] = max
    }
    setPeaks(next)
  }, [buffer])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const dpr = window.devicePixelRatio || 1
    const w = parent.clientWidth
    const h = 72
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = '#14161d'
    ctx.fillRect(0, 0, w, h)

    if (peaks && duration > 0) {
      const barW = w / peaks.length
      for (let i = 0; i < peaks.length; i++) {
        const amp = peaks[i]!
        const bh = Math.max(2, amp * (h - 8))
        const t = (i / peaks.length) * duration
        const inLoop =
          loopStart != null &&
          loopEnd != null &&
          t >= Math.min(loopStart, loopEnd) &&
          t <= Math.max(loopStart, loopEnd)
        ctx.fillStyle = inLoop ? 'rgba(240, 113, 58, 0.55)' : 'rgba(232, 220, 200, 0.28)'
        ctx.fillRect(i * barW, (h - bh) / 2, Math.max(1, barW - 1), bh)
      }
    }

    if (duration > 0) {
      const x = (currentTime / duration) * w
      ctx.fillStyle = '#e8c547'
      ctx.fillRect(x - 1, 0, 2, h)
    }

    if (loopStart != null && duration > 0) {
      const x = (loopStart / duration) * w
      ctx.fillStyle = '#5ec8c0'
      ctx.fillRect(x - 1, 0, 2, h)
    }
    if (loopEnd != null && duration > 0) {
      const x = (loopEnd / duration) * w
      ctx.fillStyle = '#5ec8c0'
      ctx.fillRect(x - 1, 0, 2, h)
    }
  }, [peaks, currentTime, duration, loopStart, loopEnd])

  const timeFromEvent = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    return ratio * duration
  }

  return (
    <div className="waveform">
      <canvas
        ref={canvasRef}
        className="waveform__canvas"
        onClick={(e) => onSeek(timeFromEvent(e))}
        onContextMenu={(e) => {
          e.preventDefault()
          const t = timeFromEvent(e)
          if (loopStart == null || (loopEnd != null && loopStart != null)) {
            onSetLoopPoint('start', t)
          } else {
            onSetLoopPoint('end', t)
          }
        }}
      />
      <p className="waveform__hint">Click to seek · Right-click to set A/B loop points</p>
    </div>
  )
}
