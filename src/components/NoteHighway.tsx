import { useEffect, useRef } from 'react'
import type { ChartNote, DrumLane } from '../types/chart'
import { LANE_COLORS, LANE_LABELS, LANES } from '../types/chart'

type Props = {
  notes: ChartNote[]
  currentTime: number
  hitFlash: Partial<Record<DrumLane, number>>
  lookAheadSec?: number
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

export function NoteHighway({ notes, currentTime, hitFlash, lookAheadSec = 2.4 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const drawRef = useRef({ notes, currentTime, hitFlash, lookAheadSec })
  drawRef.current = { notes, currentTime, hitFlash, lookAheadSec }

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = wrapRef.current
    if (!canvas || !parent) return

    const draw = () => {
      const { notes: n, currentTime: t, hitFlash: flash, lookAheadSec: ahead } = drawRef.current
      const dpr = window.devicePixelRatio || 1
      const w = parent.clientWidth
      const h = parent.clientHeight
      if (w < 1 || h < 1) return
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const grad = ctx.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, '#12141a')
      grad.addColorStop(1, '#0a0b0f')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)

      const headerH = 64
      const padX = 16
      const laneW = (w - padX * 2) / LANES.length
      const hitY = h * 0.78
      const pxPerSec = (hitY - headerH - 24) / ahead
      const headW = Math.min(laneW * 0.72, 92)
      const headH = 40

      LANES.forEach((lane, i) => {
        const x = padX + i * laneW
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)'
        ctx.fillRect(x, headerH, laneW, h - headerH)
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x + laneW / 2, headerH)
        ctx.lineTo(x + laneW / 2, hitY)
        ctx.stroke()

        const cx = x + laneW / 2
        ctx.strokeStyle = LANE_COLORS[lane]
        ctx.globalAlpha = 0.85
        ctx.lineWidth = 2
        roundRect(ctx, cx - headW / 2, hitY - headH / 2, headW, headH, 8)
        ctx.stroke()
        ctx.globalAlpha = 1

        const f = flash[lane] ?? 0
        if (f > 0) {
          ctx.fillStyle = LANE_COLORS[lane]
          ctx.globalAlpha = 0.18 * f
          roundRect(ctx, cx - headW / 2, hitY - headH / 2, headW, headH, 8)
          ctx.fill()
          ctx.globalAlpha = 1
        }
      })

      ctx.save()
      ctx.beginPath()
      ctx.rect(0, headerH, w, h - headerH)
      ctx.clip()
      const t1 = t + ahead
      for (const note of n) {
        if (note.t < t - 0.2 || note.t > t1) continue
        const laneIndex = LANES.indexOf(note.lane)
        if (laneIndex < 0) continue
        const x = padX + laneIndex * laneW + laneW / 2
        const y = hitY - (note.t - t) * pxPerSec
        const age = t - note.t
        ctx.globalAlpha = age > 0 ? Math.max(0, 1 - age / 0.18) : 1
        ctx.fillStyle = LANE_COLORS[note.lane]
        ctx.shadowColor = LANE_COLORS[note.lane]
        ctx.shadowBlur = 12
        roundRect(ctx, x - headW / 2, y - headH / 2, headW, headH, 8)
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.fillStyle = '#0a0a0f'
        ctx.font = `700 ${headW < 64 ? 11 : 13}px "Share Tech Mono", monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(LANE_LABELS[note.lane], x, y)
        ctx.globalAlpha = 1
      }
      ctx.restore()

      ctx.fillStyle = '#12141c'
      ctx.fillRect(0, 0, w, headerH)
      ctx.strokeStyle = 'rgba(232,220,200,0.12)'
      ctx.beginPath()
      ctx.moveTo(0, headerH)
      ctx.lineTo(w, headerH)
      ctx.stroke()
      LANES.forEach((lane, i) => {
        const x = padX + i * laneW + laneW / 2
        ctx.fillStyle = LANE_COLORS[lane]
        ctx.fillRect(x - 14, 10, 28, 4)
        ctx.font = `700 ${laneW < 90 ? 12 : 15}px "Share Tech Mono", monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(LANE_LABELS[lane], x, 38)
      })

      ctx.strokeStyle = 'rgba(0, 240, 255, 0.95)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(padX, hitY)
      ctx.lineTo(w - padX, hitY)
      ctx.stroke()
      ctx.fillStyle = 'rgba(0, 240, 255, 0.9)'
      ctx.font = '700 12px "Share Tech Mono", monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText('PLAY', padX, hitY - headH / 2 - 6)
    }

    let raf = 0
    const loop = () => {
      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    const ro = new ResizeObserver(() => draw())
    ro.observe(parent)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [notes])

  return (
    <div className="highway" ref={wrapRef}>
      <canvas ref={canvasRef} className="highway__canvas" />
    </div>
  )
}
