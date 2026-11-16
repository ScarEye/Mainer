import { useEffect, useRef } from 'react'
import type { ChartNote, DrumLane } from '../types/chart'
import { LANE_COLORS, LANE_SHORT, LANES } from '../types/chart'

type Props = {
  notes: ChartNote[]
  currentTime: number
  hitFlash: Partial<Record<DrumLane, number>>
  lookAheadSec?: number
}

const STAFF_Y: Record<DrumLane, number> = {
  crash: 0,
  ride: 1,
  hat: 2,
  tom: 3.5,
  snare: 5,
  kick: 8,
}

function noteHead(ctx: CanvasRenderingContext2D, x: number, y: number, lane: DrumLane, r: number) {
  ctx.beginPath()
  if (lane === 'kick') {
    ctx.moveTo(x - r, y - r)
    ctx.lineTo(x + r, y + r)
    ctx.moveTo(x + r, y - r)
    ctx.lineTo(x - r, y + r)
    ctx.lineWidth = 2.5
    ctx.stroke()
  } else if (lane === 'hat' || lane === 'crash' || lane === 'ride') {
    ctx.moveTo(x, y - r)
    ctx.lineTo(x + r, y)
    ctx.lineTo(x, y + r)
    ctx.lineTo(x - r, y)
    ctx.closePath()
    ctx.lineWidth = 2
    ctx.stroke()
    if (lane === 'crash' || lane === 'ride') {
      ctx.beginPath()
      ctx.arc(x, y, r * 0.35, 0, Math.PI * 2)
      ctx.fill()
    }
  } else {
    ctx.ellipse(x, y, r * 1.15, r * 0.85, -0.4, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function NotationView({ notes, currentTime, hitFlash, lookAheadSec = 3.2 }: Props) {
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

      ctx.fillStyle = '#0f1117'
      ctx.fillRect(0, 0, w, h)

      const marginL = 72
      const marginR = 24
      const lineGap = Math.max(20, Math.min(32, h * 0.046))
      const staffTop = Math.max(28, (h - lineGap * 4.6) * 0.38)
      const playheadX = marginL + 48
      const pxPerSec = (w - playheadX - marginR) / ahead

      ctx.strokeStyle = 'rgba(232,220,200,0.35)'
      ctx.lineWidth = 1.5
      for (let i = 0; i < 5; i++) {
        const y = staffTop + i * lineGap
        ctx.beginPath()
        ctx.moveTo(marginL, y)
        ctx.lineTo(w - marginR, y)
        ctx.stroke()
      }

      ctx.fillStyle = 'rgba(232,220,200,0.7)'
      ctx.font = `700 ${Math.round(lineGap * 1.6)}px "Orbitron", sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText('percussion', marginL / 2, staffTop + lineGap * 2.2)
      ctx.font = `600 11px "Share Tech Mono", monospace`
      ctx.fillText('clef', marginL / 2, staffTop + lineGap * 3.2)

      ctx.textAlign = 'right'
      ctx.font = '600 10px "Share Tech Mono", monospace'
      for (const lane of LANES) {
        const y = staffTop + STAFF_Y[lane] * (lineGap / 2)
        ctx.fillStyle = LANE_COLORS[lane]
        ctx.fillText(LANE_SHORT[lane], marginL - 8, y + 3)
      }

      ctx.strokeStyle = 'rgba(0, 240, 255, 0.9)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(playheadX, staffTop - lineGap)
      ctx.lineTo(playheadX, staffTop + 4.5 * lineGap)
      ctx.stroke()
      ctx.fillStyle = 'rgba(0, 240, 255, 0.7)'
      ctx.font = '500 11px "Share Tech Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText('NOW', playheadX, staffTop - lineGap - 6)

      const t0 = t - 0.2
      const t1 = t + ahead
      for (const note of n) {
        if (note.t < t0 || note.t > t1) continue
        const x = playheadX + (note.t - t) * pxPerSec
        const y = staffTop + STAFF_Y[note.lane] * (lineGap / 2)
        const age = t - note.t
        const f = flash[note.lane] ?? 0
        const alpha = age > 0 ? Math.max(0.2, 1 - age / 0.2) : 1

        ctx.globalAlpha = alpha
        ctx.fillStyle = LANE_COLORS[note.lane]
        ctx.strokeStyle = LANE_COLORS[note.lane]
        if (f > 0 && Math.abs(note.t - t) < 0.12) {
          ctx.shadowColor = LANE_COLORS[note.lane]
          ctx.shadowBlur = 14
        }
        noteHead(ctx, x, y, note.lane, Math.max(8, lineGap * 0.42))
        ctx.shadowBlur = 0
        ctx.globalAlpha = 1
      }

      ctx.fillStyle = 'rgba(154,144,132,0.9)'
      ctx.font = '500 11px "Share Tech Mono", monospace'
      ctx.textAlign = 'left'
      ctx.fillText(
        'X = kick · ○ = drums · ◇ = cymbals  ·  notes approach from the right',
        marginL,
        h - 16,
      )
    }

    draw()
    const ro = new ResizeObserver(() => draw())
    ro.observe(parent)
    return () => ro.disconnect()
  }, [notes, currentTime, hitFlash, lookAheadSec])

  return (
    <div className="highway notation-view" ref={wrapRef}>
      <canvas ref={canvasRef} className="highway__canvas" />
    </div>
  )
}
