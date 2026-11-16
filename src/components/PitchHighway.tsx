import { useEffect, useRef } from 'react'
import type { MelodicInstrument, PitchNote } from '../types/chart'
import {
  BASS_STRINGS,
  BASS_TUNING,
  GUITAR_STRINGS,
  GUITAR_TUNING,
  fretsFor,
  isBlackKey,
  midiToName,
  pitchColor,
} from '../audio/music'

type Props = {
  instrument: MelodicInstrument
  notes: PitchNote[]
  currentTime: number
  lookAheadSec?: number
}

const STRING_COLORS = ['#00f0ff', '#ff2d75', '#a855f7', '#7dd3fc', '#f0abfc', '#67e8f9']

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

function alignDownC(midi: number) {
  const pc = ((midi % 12) + 12) % 12
  return midi - pc
}

function alignUpC(midi: number) {
  const pc = ((midi % 12) + 12) % 12
  return pc === 0 ? midi : midi + (12 - pc)
}

/** Keys covering the notes about to arrive, snapped to C. Wider phrases stay on screen up to three octaves. */
function pianoWindow(notes: PitchNote[], now: number, ahead: number): [number, number] {
  const soon = notes.filter((note) => note.t >= now - 0.05 && note.t <= now + ahead)
  const pool = soon.length ? soon : notes.slice(0, 12)
  if (!pool.length) return [48, 72]
  let loMidi = 127
  let hiMidi = 0
  for (const note of pool) {
    loMidi = Math.min(loMidi, note.midi)
    hiMidi = Math.max(hiMidi, note.midi)
  }
  let lo = alignDownC(Math.max(21, loMidi))
  let hi = alignUpC(Math.min(108, hiMidi))
  if (hi - lo < 12) {
    const center = Math.round((loMidi + hiMidi) / 2)
    lo = alignDownC(Math.max(21, center - 6))
    hi = Math.min(108, lo + 24)
  }
  if (hi - lo > 36) {
    const next = pool.reduce((a, b) => (a.t <= b.t ? a : b))
    lo = alignDownC(Math.max(21, next.midi - 12))
    hi = Math.min(108, lo + 36)
  }
  if (hi <= lo) hi = Math.min(108, lo + 12)
  return [lo, hi]
}

export function PitchHighway({ instrument, notes, currentTime, lookAheadSec = 2.6 }: Props) {
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

      const grad = ctx.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, '#12141a')
      grad.addColorStop(1, '#0a0b0f')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)

      const strings = inst === 'guitar' ? GUITAR_TUNING : inst === 'bass' ? BASS_TUNING : null
      const stringNames = inst === 'guitar' ? GUITAR_STRINGS : inst === 'bass' ? BASS_STRINGS : null
      if (strings && stringNames) {
        drawStrings(ctx, w, h, t, ahead, n, strings, stringNames)
        return
      }
      drawPiano(ctx, w, h, t, ahead, n)
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
    <div className="highway" ref={wrapRef}>
      <canvas ref={canvasRef} className="highway__canvas" />
    </div>
  )
}

function drawStrings(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  ahead: number,
  notes: PitchNote[],
  tuning: number[],
  names: string[],
) {
  const headerH = 78
  const padX = 16
  const columns = tuning
    .map((open, index) => ({
      open,
      index,
      name: names[index]!,
      role: index === tuning.length - 1 ? 'high' : index === 0 ? 'low' : '',
    }))
    .reverse()
  const laneW = (w - padX * 2) / columns.length
  const hitY = h * 0.78
  const pxPerSec = (hitY - headerH - 28) / ahead
  const headW = Math.min(laneW * 0.78, 88)
  const headH = 48

  columns.forEach((col, i) => {
    const x = padX + i * laneW
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.045)'
    ctx.fillRect(x, headerH, laneW, h - headerH)
    const color = STRING_COLORS[col.index] ?? '#7dd3fc'
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.35
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x + laneW / 2, headerH)
    ctx.lineTo(x + laneW / 2, hitY)
    ctx.stroke()
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 2
    roundRect(ctx, x + laneW / 2 - headW / 2, hitY - headH / 2, headW, headH, 8)
    ctx.stroke()
    ctx.globalAlpha = 1
  })

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, headerH, w, h - headerH)
  ctx.clip()
  const t1 = t + ahead + 0.2
  for (const note of notes) {
    if (note.t + note.dur < t - 0.12 || note.t > t1) continue
    const placed = fretsFor(note.midi, tuning, 24)
    if (!placed) continue
    const colIndex = columns.findIndex((col) => col.index === placed.stringIndex)
    if (colIndex < 0) continue
    const x = padX + colIndex * laneW + laneW / 2
    const y = hitY - (note.t - t) * pxPerSec
    const yRelease = hitY - (note.t + note.dur - t) * pxPerSec
    const color = STRING_COLORS[placed.stringIndex] ?? pitchColor(note.midi)
    const age = t - note.t
    ctx.globalAlpha = age > 0 ? Math.max(0.2, 1 - age / 0.35) : 1
    if (note.dur > 0.12) {
      ctx.fillStyle = color
      ctx.globalAlpha *= 0.35
      const top = Math.min(y, yRelease)
      ctx.fillRect(x - 3, top, 6, Math.max(4, Math.abs(y - yRelease)))
      ctx.globalAlpha = age > 0 ? Math.max(0.2, 1 - age / 0.35) : 1
    }
    ctx.fillStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = 12
    roundRect(ctx, x - headW / 2, y - headH / 2, headW, headH, 8)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#0a0a0f'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 ${headW < 60 ? 16 : 18}px "Share Tech Mono", monospace`
    ctx.fillText(placed.fret === 0 ? 'open' : String(placed.fret), x, y - 8)
    ctx.font = `600 ${headW < 60 ? 10 : 11}px "Share Tech Mono", monospace`
    ctx.fillText(midiToName(note.midi), x, y + 12)
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
  columns.forEach((col, i) => {
    const x = padX + i * laneW + laneW / 2
    const color = STRING_COLORS[col.index] ?? '#7dd3fc'
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 ${laneW < 70 ? 16 : 20}px "Share Tech Mono", monospace`
    ctx.fillText(col.name, x, 24)
    ctx.font = '600 11px "Share Tech Mono", monospace'
    ctx.fillStyle = 'rgba(232,220,200,0.72)'
    const detail = col.role ? `${midiToName(col.open)} · ${col.role}` : midiToName(col.open)
    ctx.fillText(detail, x, 50)
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

function drawPiano(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  ahead: number,
  notes: PitchNote[],
) {
  const headerH = 86
  const padX = 18
  const [lo, hi] = pianoWindow(notes, t, ahead)
  const whites: number[] = []
  for (let midi = lo; midi <= hi; midi++) if (!isBlackKey(midi)) whites.push(midi)
  const whiteW = whites.length ? (w - padX * 2) / whites.length : 40
  const xWhite = (midi: number) => padX + whites.indexOf(midi) * whiteW + whiteW / 2
  const xOf = (midi: number) => {
    if (!isBlackKey(midi)) return xWhite(midi)
    const left = [...whites].reverse().find((key) => key < midi)
    if (left == null) return padX
    return padX + (whites.indexOf(left) + 1) * whiteW
  }
  const hitY = h * 0.78
  const pxPerSec = (hitY - headerH - 24) / ahead

  whites.forEach((_midi, i) => {
    const x = padX + i * whiteW
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.055)'
    ctx.fillRect(x, headerH, whiteW, h - headerH)
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.strokeRect(x, headerH, whiteW, h - headerH)
  })

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, headerH, w, h - headerH)
  ctx.clip()
  const t1 = t + ahead + 0.2
  let below: PitchNote | null = null
  let above: PitchNote | null = null
  for (const note of notes) {
    if (note.t + note.dur < t - 0.12 || note.t > t1) continue
    if (note.midi < lo) {
      if (!below || note.t < below.t) below = note
      continue
    }
    if (note.midi > hi) {
      if (!above || note.t < above.t) above = note
      continue
    }
    const x = xOf(note.midi)
    const y = hitY - (note.t - t) * pxPerSec
    const yRelease = hitY - (note.t + note.dur - t) * pxPerSec
    const black = isBlackKey(note.midi)
    const bw = black ? whiteW * 0.62 : whiteW * 0.72
    const headH = 36
    const color = pitchColor(note.midi)
    const age = t - note.t
    ctx.globalAlpha = age > 0 ? Math.max(0.2, 1 - age / 0.35) : 1
    if (note.dur > 0.12) {
      ctx.fillStyle = color
      ctx.globalAlpha *= 0.32
      const top = Math.min(y, yRelease)
      ctx.fillRect(x - 3, top, 6, Math.max(4, Math.abs(y - yRelease)))
      ctx.globalAlpha = age > 0 ? Math.max(0.2, 1 - age / 0.35) : 1
    }
    ctx.fillStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = 10
    roundRect(ctx, x - bw / 2, y - headH / 2, Math.max(18, bw), headH, 7)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#0a0a0f'
    ctx.font = `700 ${bw < 28 ? 9 : 11}px "Share Tech Mono", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(midiToName(note.midi), x, y)
    ctx.globalAlpha = 1
  }
  const edge = (note: PitchNote, x: number, dir: string) => {
    const y = hitY - (note.t - t) * pxPerSec
    ctx.fillStyle = pitchColor(note.midi)
    roundRect(ctx, x - 28, y - 16, 56, 32, 7)
    ctx.fill()
    ctx.fillStyle = '#0a0a0f'
    ctx.font = '700 11px "Share Tech Mono", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${midiToName(note.midi)} ${dir}`, x, y)
  }
  if (below) edge(below, padX + 36, '↓')
  if (above) edge(above, w - padX - 36, '↑')
  ctx.restore()

  ctx.fillStyle = '#16181f'
  ctx.fillRect(0, 0, w, headerH)
  whites.forEach((midi, i) => {
    const x = padX + i * whiteW
    ctx.fillStyle = '#e7e2d8'
    ctx.fillRect(x + 1, 8, whiteW - 2, headerH - 16)
    ctx.fillStyle = '#2a241c'
    ctx.font = `600 ${whiteW < 28 ? 9 : 11}px "Share Tech Mono", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    if (midi % 12 === 0) ctx.fillText(midiToName(midi), x + whiteW / 2, headerH - 18)
  })
  for (let midi = lo; midi <= hi; midi++) {
    if (!isBlackKey(midi)) continue
    const x = xOf(midi)
    const bw = whiteW * 0.62
    ctx.fillStyle = '#141418'
    ctx.fillRect(x - bw / 2, 8, bw, headerH * 0.58)
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.strokeRect(x - bw / 2, 8, bw, headerH * 0.58)
  }
  ctx.strokeStyle = 'rgba(232,220,200,0.12)'
  ctx.beginPath()
  ctx.moveTo(0, headerH)
  ctx.lineTo(w, headerH)
  ctx.stroke()

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
  ctx.fillText('PLAY', padX, hitY - 24)
}
