import { useEffect, useRef } from 'react'
import type { ChartNote, DrumLane } from '../types/chart'
import { LANE_SHORT, LANE_COLORS, LANES } from '../types/chart'

type Props = {
  notes: ChartNote[]
  currentTime: number
  hitFlash: Partial<Record<DrumLane, number>>
  lookAheadSec?: number
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

      const padX = 12
      const laneW = (w - padX * 2) / LANES.length
      const hitY = h * 0.82
      const pxPerSec = hitY / ahead

      LANES.forEach((lane, i) => {
        const x = padX + i * laneW
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.045)'
        ctx.fillRect(x, 0, laneW, h)

        ctx.fillStyle = 'rgba(232,220,200,0.4)'
        ctx.font = `600 ${laneW < 70 ? 9 : 11}px "Share Tech Mono", monospace`
        ctx.textAlign = 'center'
        ctx.fillText(LANE_SHORT[lane], x + laneW / 2, 18)

        const f = flash[lane] ?? 0
        if (f > 0) {
          ctx.fillStyle = `rgba(255, 200, 120, ${0.18 * f})`
          ctx.fillRect(x, hitY - 40, laneW, 80)
        }
      })

      ctx.strokeStyle = 'rgba(0, 240, 255, 0.9)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(padX, hitY)
      ctx.lineTo(w - padX, hitY)
      ctx.stroke()

      ctx.fillStyle = 'rgba(0, 240, 255, 0.65)'
      ctx.font = '500 11px "Share Tech Mono", monospace'
      ctx.textAlign = 'left'
      ctx.fillText('HIT', padX, hitY - 8)

      const t1 = t + ahead
      for (const note of n) {
        if (note.t < t - 0.15 || note.t > t1) continue
        const laneIndex = LANES.indexOf(note.lane)
        if (laneIndex < 0) continue
        const x = padX + laneIndex * laneW + laneW / 2
        const y = hitY - (note.t - t) * pxPerSec
        const age = t - note.t
        const alpha = age > 0 ? Math.max(0, 1 - age / 0.15) : 1
        const r = Math.min(14, laneW * 0.32)

        ctx.globalAlpha = alpha
        ctx.fillStyle = LANE_COLORS[note.lane]
        ctx.shadowColor = LANE_COLORS[note.lane]
        ctx.shadowBlur = 10
        ctx.fillRect(x - r, y - r * 0.5, r * 2, r)
        ctx.shadowBlur = 0
        ctx.globalAlpha = 1
      }
    }

    draw()
    const ro = new ResizeObserver(() => draw())
    ro.observe(parent)
    return () => ro.disconnect()
  }, [notes, currentTime, hitFlash, lookAheadSec])

  return (
    <div className="highway" ref={wrapRef}>
      <canvas ref={canvasRef} className="highway__canvas" />
    </div>
  )
}
