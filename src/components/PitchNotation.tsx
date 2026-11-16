import { useEffect, useRef } from 'react'
import type { MelodicInstrument, PitchNote } from '../types/chart'
import {
  isSharp,
  midiToName,
  octaveWords,
  pitchColor,
  staffOctaveShift,
  staffStep,
  writtenMidi,
  writtenOctavesAbove,
} from '../audio/music'

type Props = {
  instrument: MelodicInstrument
  notes: PitchNote[]
  currentTime: number
  lookAheadSec?: number
}

type ClefName = 'treble' | 'bass'

function yForStep(top: number, lineGap: number, step: number) {
  return top + 4 * lineGap - step * (lineGap / 2)
}

function drawStaff(ctx: CanvasRenderingContext2D, left: number, right: number, top: number, lineGap: number) {
  ctx.strokeStyle = 'rgba(232,220,200,0.82)'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(left, top)
  ctx.lineTo(left, top + lineGap * 4)
  ctx.stroke()
  for (let i = 0; i < 5; i++) {
    const y = top + i * lineGap
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
    ctx.stroke()
  }
}

function drawTrebleClef(ctx: CanvasRenderingContext2D, x: number, staffTop: number, gap: number) {
  const gY = staffTop + 3 * gap
  const fontSize = gap * 6.6
  // Segoe UI Symbol's G clef curl sits about 0.18em above the baseline.
  const baseline = gY + fontSize * 0.183
  ctx.save()
  ctx.fillStyle = 'rgba(232,220,200,0.95)'
  ctx.font = `${fontSize}px "Segoe UI Symbol", "Cambria Math", serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('\u{1D11E}', x, baseline)
  ctx.restore()
}

function drawBassClef(ctx: CanvasRenderingContext2D, x: number, staffTop: number, gap: number) {
  const f = staffTop + gap
  ctx.save()
  ctx.strokeStyle = 'rgba(232,220,200,0.95)'
  ctx.fillStyle = 'rgba(232,220,200,0.95)'
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(1.8, gap * 0.15)
  ctx.beginPath()
  ctx.arc(x, f, gap * 1.05, Math.PI * 0.28, Math.PI * 1.72, false)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x + gap * 1.22, f - gap * 0.5, gap * 0.12, 0, Math.PI * 2)
  ctx.arc(x + gap * 1.22, f + gap * 0.5, gap * 0.12, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawLedgers(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  lineGap: number,
  step: number,
) {
  if (step <= 8 && step >= 0) return
  ctx.strokeStyle = 'rgba(232,220,200,0.72)'
  ctx.lineWidth = 1.35
  const half = Math.max(11, lineGap * 0.95)
  if (step > 8) {
    for (let s = 10; s <= step; s += 2) {
      const y = yForStep(top, lineGap, s)
      ctx.beginPath()
      ctx.moveTo(x - half, y)
      ctx.lineTo(x + half, y)
      ctx.stroke()
    }
  } else {
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

      const grand = inst === 'piano'
      const marginL = grand ? 36 : 28
      const marginR = 28
      const lineGap = Math.max(16, Math.min(grand ? 28 : 42, (h - (grand ? 96 : 56)) / (grand ? 14 : 9)))
      const staffBlock = lineGap * 4
      const gapBetween = lineGap * 2.6
      const blockH = grand ? staffBlock * 2 + gapBetween : staffBlock
      const staffTop = grand
        ? Math.max(lineGap * 2.2, (h - blockH) / 2 - lineGap * 0.15)
        : lineGap * 1.85
      const bassTop = staffTop + staffBlock + gapBetween
      const playheadX = marginL + lineGap * 5.5
      const pxPerSec = (w - playheadX - marginR) / ahead

      const clefOf = (midi: number): ClefName => {
        if (inst === 'bass') return 'bass'
        if (inst === 'piano' && midi < 60) return 'bass'
        return 'treble'
      }
      const written = n.map((note) => writtenMidi(note.midi, inst))
      const trebleShift = grand ? 0 : staffOctaveShift(written.filter((_, i) => clefOf(n[i]!.midi) === 'treble'), 'treble')
      const bassShift = grand ? 0 : staffOctaveShift(written.filter((_, i) => clefOf(n[i]!.midi) === 'bass'), 'bass')
      const topOf = (clef: ClefName) => (clef === 'bass' && grand ? bassTop : staffTop)
      const shiftOf = (clef: ClefName) => (clef === 'bass' ? bassShift : trebleShift)

      drawStaff(ctx, marginL, w - marginR, staffTop, lineGap)
      if (grand) {
        drawStaff(ctx, marginL, w - marginR, bassTop, lineGap)
        const braceTop = staffTop
        const braceBot = bassTop + staffBlock
        ctx.fillStyle = 'rgba(232,220,200,0.85)'
        ctx.fillRect(marginL - 14, braceTop, 3.5, braceBot - braceTop)
        ctx.fillRect(marginL - 8, braceTop, 1.5, braceBot - braceTop)
        drawTrebleClef(ctx, marginL + lineGap * 1.15, staffTop, lineGap)
        drawBassClef(ctx, marginL + lineGap * 1.15, bassTop, lineGap)
      } else if (inst === 'bass') {
        drawBassClef(ctx, marginL + lineGap * 1.15, staffTop, lineGap)
      } else {
        drawTrebleClef(ctx, marginL + lineGap * 1.15, staffTop, lineGap)
      }

      ctx.strokeStyle = 'rgba(0, 240, 255, 0.9)'
      ctx.lineWidth = 2
      const barTop = staffTop - lineGap * 1.3
      const barBot = (grand ? bassTop : staffTop) + staffBlock + lineGap * 0.9
      ctx.beginPath()
      ctx.moveTo(playheadX, barTop)
      ctx.lineTo(playheadX, barBot)
      ctx.stroke()
      ctx.fillStyle = 'rgba(0, 240, 255, 0.75)'
      ctx.font = '500 11px "Share Tech Mono", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText('NOW', playheadX, barTop - 4)

      const t0 = t - 0.15
      const t1 = t + ahead
      const visible = n.filter((note) => note.t >= t0 && note.t <= t1).sort((a, b) => a.t - b.t || a.midi - b.midi)
      const placed = visible.map((note) => {
        const clef = clefOf(note.midi)
        const midi = writtenMidi(note.midi, inst) + shiftOf(clef) * 12
        return { note, clef, midi, step: staffStep(midi, clef) }
      })
      for (let i = 0; i < placed.length; i++) {
        const item = placed[i]!
        let column = 0
        for (let j = 0; j < i; j++) {
          const other = placed[j]!
          if (other.clef !== item.clef) continue
          if (Math.abs(other.note.t - item.note.t) > 0.04) continue
          if (Math.abs(other.step - item.step) <= 1) column = Math.min(2, column + 1)
        }
        const top = topOf(item.clef)
        const x = playheadX + (item.note.t - t) * pxPerSec + column * lineGap * 1.15
        const y = yForStep(top, lineGap, item.step)
        const color = pitchColor(item.note.midi)
        const headRx = Math.max(7, lineGap * 0.62)
        const headRy = Math.max(5, lineGap * 0.46)
        ctx.globalAlpha = item.note.t < t ? Math.max(0.25, 1 - (t - item.note.t) / 0.2) : 1
        drawLedgers(ctx, x, top, lineGap, item.step)
        ctx.strokeStyle = color
        ctx.fillStyle = color
        ctx.lineWidth = 1.7
        const stemDown = item.step >= 4
        const stemX = x + (stemDown ? -headRx * 0.78 : headRx * 0.78)
        ctx.beginPath()
        ctx.moveTo(stemX, y)
        ctx.lineTo(stemX, y + (stemDown ? 1 : -1) * lineGap * 3.1)
        ctx.stroke()
        if (isSharp(item.midi)) {
          ctx.font = `700 ${Math.round(lineGap * 0.9)}px "Share Tech Mono", monospace`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('#', x - headRx - lineGap * 0.45, y)
        }
        ctx.beginPath()
        ctx.ellipse(x, y, headRx, headRy, -0.4, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      }

      const upcoming = n.find((note) => note.t >= t - 0.02)
      ctx.fillStyle = 'rgba(154,144,132,0.95)'
      ctx.font = '500 12px "Share Tech Mono", monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      const guitarWords = inst === 'guitar' ? octaveWords(writtenOctavesAbove('guitar', trebleShift)) : null
      const bassWords = inst === 'bass' ? octaveWords(bassShift) : null
      const markNote = guitarWords ? ` · sounds ${guitarWords}` : bassWords ? ` · sounds ${bassWords}` : ''
      ctx.fillText(
        upcoming
          ? `${inst} · next ${midiToName(upcoming.midi)}${markNote}`
          : `${inst} staff${markNote}`,
        marginL,
        h - 18,
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
