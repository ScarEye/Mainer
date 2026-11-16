import { useEffect, useRef } from 'react'
import type { MelodicInstrument, PitchNote } from '../types/chart'
import { isSharp, midiToName, pitchColor, staffStep } from '../audio/music'

type Props = {
  instrument: MelodicInstrument
  notes: PitchNote[]
  currentTime: number
  lookAheadSec?: number
}

function yForStep(top: number, lineGap: number, step: number) {
  return top + 4 * lineGap - step * (lineGap / 2)
}

function drawStaff(ctx: CanvasRenderingContext2D, left: number, right: number, top: number, lineGap: number) {
  ctx.strokeStyle = 'rgba(232,220,200,0.35)'
  ctx.lineWidth = 1.5
  for (let i = 0; i < 5; i++) {
    const y = top + i * lineGap
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
    ctx.stroke()
  }
}

function drawLedgers(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  lineGap: number,
  step: number,
) {
  ctx.strokeStyle = 'rgba(232,220,200,0.45)'
  ctx.lineWidth = 1.25
  const half = Math.max(10, lineGap * 0.85)
  if (step > 8) {
    for (let s = 10; s <= step; s += 2) {
      const y = yForStep(top, lineGap, s)
      ctx.beginPath()
      ctx.moveTo(x - half, y)
      ctx.lineTo(x + half, y)
      ctx.stroke()
    }
  } else if (step < 0) {
    for (let s = -2; s >= step; s -= 2) {
      const y = yForStep(top, lineGap, s)
      ctx.beginPath()
      ctx.moveTo(x - half, y)
      ctx.lineTo(x + half, y)
      ctx.stroke()
    }
  }
}

export function PitchNotation({ instrument, notes, currentTime, lookAheadSec = 3.4 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const drawRef = useRef({ notes, currentTime, lookAheadSec, instrument })
  drawRef.current = { notes, currentTime, lookAheadSec, instrument }

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = wrapRef.current
    if (!canvas || !parent) return

    const draw = () => {
      const { notes: n, currentTime: t, lookAheadSec: ahead, instrument: inst } = drawRef.current
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

      const marginL = 78
      const marginR = 24
      const grand = inst === 'piano'
      const lineGap = Math.max(16, Math.min(28, h * (grand ? 0.032 : 0.042)))
      const staffBlock = lineGap * 4
      const gapBetween = lineGap * 2.4
      const blockH = grand ? staffBlock * 2 + gapBetween : staffBlock
      const staffTop = Math.max(36, (h - blockH) * 0.42)
      const bassTop = staffTop + staffBlock + gapBetween
      const playheadX = marginL + 36
      const pxPerSec = (w - playheadX - marginR) / ahead

      drawStaff(ctx, marginL, w - marginR, staffTop, lineGap)
      if (grand) drawStaff(ctx, marginL, w - marginR, bassTop, lineGap)

      ctx.fillStyle = 'rgba(232,220,200,0.75)'
      ctx.font = `700 ${Math.round(lineGap * 1.15)}px "Orbitron", sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(grand ? 'grand' : inst === 'bass' ? 'bass' : 'treble', marginL / 2, staffTop + lineGap * 2.1)
      ctx.font = '600 11px "Share Tech Mono", monospace'
      ctx.fillText('clef', marginL / 2, staffTop + lineGap * 3.15)

      const clefOf = (midi: number): 'treble' | 'bass' => {
        if (inst === 'bass') return 'bass'
        if (inst === 'piano' && midi < 60) return 'bass'
        return 'treble'
      }
      const topOf = (clef: 'treble' | 'bass') => (clef === 'bass' && grand ? bassTop : staffTop)

      ctx.strokeStyle = 'rgba(0, 240, 255, 0.9)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(playheadX, staffTop - lineGap * 0.8)
      ctx.lineTo(playheadX, (grand ? bassTop : staffTop) + staffBlock + lineGap * 0.4)
      ctx.stroke()
      ctx.fillStyle = 'rgba(0, 240, 255, 0.7)'
      ctx.font = '500 11px "Share Tech Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText('NOW', playheadX, staffTop - lineGap * 0.8 - 6)

      const t0 = t - 0.15
      const t1 = t + ahead
      for (const note of n) {
        if (note.t < t0 || note.t > t1) continue
        const clef = clefOf(note.midi)
        const step = staffStep(note.midi, clef)
        const top = topOf(clef)
        const x = playheadX + (note.t - t) * pxPerSec
        const y = yForStep(top, lineGap, step)
        const color = pitchColor(note.midi)
        ctx.globalAlpha = note.t < t ? Math.max(0.25, 1 - (t - note.t) / 0.2) : 1
        drawLedgers(ctx, x, top, lineGap, step)
        ctx.fillStyle = color
        ctx.strokeStyle = color
        if (isSharp(note.midi)) {
          ctx.font = `700 ${Math.round(lineGap * 0.95)}px "Share Tech Mono", monospace`
          ctx.textAlign = 'center'
          ctx.fillText('#', x - lineGap * 0.85, y + 4)
        }
        ctx.beginPath()
        ctx.ellipse(x, y, Math.max(7, lineGap * 0.42), Math.max(5.5, lineGap * 0.32), -0.4, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      }

      ctx.fillStyle = 'rgba(154,144,132,0.9)'
      ctx.font = '500 11px "Share Tech Mono", monospace'
      ctx.textAlign = 'left'
      const sample = n.find((note) => note.t >= t) ?? n[0]
      ctx.fillText(
        sample
          ? `${inst} staff · next ${midiToName(sample.midi)} · notes approach from the right`
          : `${inst} staff · notes approach from the right`,
        marginL,
        h - 16,
      )
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
  }, [notes, instrument])

  return (
    <div className="highway notation-view" ref={wrapRef}>
      <canvas ref={canvasRef} className="highway__canvas" />
    </div>
  )
}
