import { useEffect, useRef } from 'react'
import type { ChartNote, DrumLane } from '../types/chart'
import { LANE_COLORS } from '../types/chart'

type Props = {
  notes: ChartNote[]
  currentTime: number
  hitFlash: Partial<Record<DrumLane, number>>
  lookAheadSec?: number
}

/** Diatonic steps up from the bottom line. Top line is 8. */
const DRUM_STEP: Record<DrumLane, number> = {
  kick: 1,
  snare: 5,
  tom: 7,
  hat: 9,
  ride: 11,
  crash: 13,
}

function yForStep(staffTop: number, lineGap: number, step: number) {
  return staffTop + 4 * lineGap - step * (lineGap / 2)
}

function drawPercussionClef(ctx: CanvasRenderingContext2D, x: number, staffTop: number, lineGap: number) {
  const top = staffTop
  const height = lineGap * 4
  ctx.fillStyle = 'rgba(232,220,200,0.88)'
  ctx.fillRect(x, top, lineGap * 0.16, height)
  ctx.fillRect(x + lineGap * 0.34, top, lineGap * 0.16, height)
}

function drawLedgers(ctx: CanvasRenderingContext2D, x: number, staffTop: number, lineGap: number, step: number) {
  if (step < 10) return
  ctx.strokeStyle = 'rgba(232,220,200,0.5)'
  ctx.lineWidth = 1.4
  const half = Math.max(12, lineGap * 0.9)
  for (let s = 10; s <= step; s += 2) {
    const y = yForStep(staffTop, lineGap, s)
    ctx.beginPath()
    ctx.moveTo(x - half, y)
    ctx.lineTo(x + half, y)
    ctx.stroke()
  }
}

function noteHead(ctx: CanvasRenderingContext2D, x: number, y: number, lane: DrumLane, r: number) {
  ctx.beginPath()
  if (lane === 'hat' || lane === 'crash' || lane === 'ride') {
    ctx.moveTo(x - r, y - r)
    ctx.lineTo(x + r, y + r)
    ctx.moveTo(x + r, y - r)
    ctx.lineTo(x - r, y + r)
    ctx.lineWidth = 2.4
    ctx.stroke()
    return
  }
  ctx.ellipse(x, y, r * 1.15, r * 0.78, -0.45, 0, Math.PI * 2)
  ctx.fill()
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

      const marginL = 92
      const marginR = 28
      const lineGap = Math.max(22, Math.min(34, (h - 120) / 12))
      const staffH = lineGap * 4
      const staffTop = Math.max(lineGap * 3.4, (h - staffH) / 2 - lineGap)
      const playheadX = marginL + lineGap * 2.6
      const pxPerSec = (w - playheadX - marginR) / ahead
      const headR = Math.max(7, lineGap * 0.34)

      ctx.strokeStyle = 'rgba(232,220,200,0.4)'
      ctx.lineWidth = 1.5
      for (let i = 0; i < 5; i++) {
        const y = staffTop + i * lineGap
        ctx.beginPath()
        ctx.moveTo(marginL, y)
        ctx.lineTo(w - marginR, y)
        ctx.stroke()
      }
      drawPercussionClef(ctx, marginL + lineGap * 0.35, staffTop, lineGap)

      ctx.strokeStyle = 'rgba(0, 240, 255, 0.9)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(playheadX, staffTop - lineGap * 2.6)
      ctx.lineTo(playheadX, staffTop + staffH + lineGap * 0.8)
      ctx.stroke()
      ctx.fillStyle = 'rgba(0, 240, 255, 0.75)'
      ctx.font = '500 11px "Share Tech Mono", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText('NOW', playheadX, staffTop - lineGap * 2.6 - 4)

      const t0 = t - 0.2
      const t1 = t + ahead
      const visible = n.filter((note) => note.t >= t0 && note.t <= t1).sort((a, b) => a.t - b.t)
      for (const note of visible) {
        const step = DRUM_STEP[note.lane]
        const x = playheadX + (note.t - t) * pxPerSec
        const y = yForStep(staffTop, lineGap, step)
        const age = t - note.t
        const flashing = (flash[note.lane] ?? 0) > 0 && Math.abs(note.t - t) < 0.12
        ctx.globalAlpha = age > 0 ? Math.max(0.2, 1 - age / 0.2) : 1
        ctx.fillStyle = LANE_COLORS[note.lane]
        ctx.strokeStyle = LANE_COLORS[note.lane]
        if (flashing) {
          ctx.shadowColor = LANE_COLORS[note.lane]
          ctx.shadowBlur = 14
        }
        drawLedgers(ctx, x, staffTop, lineGap, step)
        const stemDown = step >= 4
        const stemX = x + (stemDown ? -headR * 0.85 : headR * 0.85)
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(stemX, y)
        ctx.lineTo(stemX, y + (stemDown ? 1 : -1) * lineGap * 3)
        ctx.stroke()
        noteHead(ctx, x, y, note.lane, headR)
        ctx.shadowBlur = 0
        ctx.globalAlpha = 1
      }

      ctx.fillStyle = 'rgba(154,144,132,0.9)'
      ctx.font = '500 12px "Share Tech Mono", monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText('Kick in the bottom space · snare in the middle · cymbals above the staff', marginL, h - 18)
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
    <div className="highway notation-view" ref={wrapRef}>
      <canvas ref={canvasRef} className="highway__canvas" />
    </div>
  )
}
