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

function pitchSpan(notes: PitchNote[]): [number, number] {
  if (!notes.length) return [48, 72]
  let lo = 127
  let hi = 0
  for (const note of notes) {
    lo = Math.min(lo, note.midi)
    hi = Math.max(hi, note.midi)
  }
  lo = Math.max(21, lo - (lo % 12))
  const hiPc = hi % 12
  hi = Math.min(108, hi + (hiPc === 0 ? 0 : 12 - hiPc))
  if (hi - lo < 12) hi = lo + 12
  if (hi - lo > 48) {
    const mid = Math.round((lo + hi) / 2)
    lo = Math.max(21, mid - 18)
    hi = Math.min(108, lo + 36)
  }
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

      const padX = 16
      const hitY = h * 0.82
      const pxPerSec = hitY / ahead
      const strings = inst === 'guitar' ? GUITAR_TUNING : inst === 'bass' ? BASS_TUNING : null
      const stringNames = inst === 'guitar' ? GUITAR_STRINGS : inst === 'bass' ? BASS_STRINGS : null

      const drawHit = () => {
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
      }

      if (strings && stringNames) {
        const laneW = (w - padX * 2) / strings.length
        stringNames.forEach((name, i) => {
          const x = padX + i * laneW
          ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.045)'
          ctx.fillRect(x, 0, laneW, h)
          ctx.fillStyle = 'rgba(232,220,200,0.55)'
          ctx.font = `600 ${laneW < 64 ? 11 : 13}px "Share Tech Mono", monospace`
          ctx.textAlign = 'center'
          ctx.fillText(name, x + laneW / 2, 22)
        })
        drawHit()
        const t1 = t + ahead
        for (const note of n) {
          if (note.t + note.dur < t - 0.05 || note.t > t1) continue
          const placed = fretsFor(note.midi, strings)
          if (!placed) continue
          const x = padX + placed.stringIndex * laneW + laneW / 2
          const y1 = hitY - (note.t + note.dur - t) * pxPerSec
          const y2 = hitY - (note.t - t) * pxPerSec
          const top = Math.min(y1, y2)
          const height = Math.max(16, Math.abs(y2 - y1))
          const color = STRING_COLORS[placed.stringIndex] ?? pitchColor(note.midi)
          ctx.globalAlpha = note.t < t ? Math.max(0.25, 1 - (t - note.t) / 0.35) : 1
          ctx.fillStyle = color
          ctx.shadowColor = color
          ctx.shadowBlur = 12
          const bw = Math.min(laneW * 0.62, 54)
          ctx.fillRect(x - bw / 2, top, bw, height)
          ctx.shadowBlur = 0
          ctx.globalAlpha = 1
          ctx.fillStyle = '#0a0a0f'
          ctx.font = '700 13px "Share Tech Mono", monospace'
          ctx.textAlign = 'center'
          ctx.fillText(String(placed.fret), x, top + Math.min(height, 18) - 4 + 12)
        }
        return
      }

      const [lo, hi] = pitchSpan(n)
      const span = hi - lo + 1
      const keyW = (w - padX * 2) / span
      for (let midi = lo; midi <= hi; midi++) {
        const x = padX + (midi - lo) * keyW
        ctx.fillStyle = isBlackKey(midi) ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.035)'
        ctx.fillRect(x, 0, keyW, h)
        if (!isBlackKey(midi) && midi % 12 === 0) {
          ctx.fillStyle = 'rgba(232,220,200,0.45)'
          ctx.font = '600 10px "Share Tech Mono", monospace'
          ctx.textAlign = 'center'
          ctx.fillText(midiToName(midi), x + keyW / 2, 18)
        }
      }
      drawHit()
      const t1 = t + ahead
      for (const note of n) {
        if (note.midi < lo || note.midi > hi) continue
        if (note.t + note.dur < t - 0.05 || note.t > t1) continue
        const x = padX + (note.midi - lo) * keyW + keyW / 2
        const y1 = hitY - (note.t + note.dur - t) * pxPerSec
        const y2 = hitY - (note.t - t) * pxPerSec
        const top = Math.min(y1, y2)
        const height = Math.max(14, Math.abs(y2 - y1))
        const color = pitchColor(note.midi)
        ctx.globalAlpha = note.t < t ? Math.max(0.25, 1 - (t - note.t) / 0.35) : 1
        ctx.fillStyle = color
        ctx.shadowColor = color
        ctx.shadowBlur = 10
        const bw = Math.max(8, keyW * 0.78)
        ctx.fillRect(x - bw / 2, top, bw, height)
        ctx.shadowBlur = 0
        ctx.globalAlpha = 1
        if (keyW > 22 && height > 16) {
          ctx.fillStyle = '#0a0a0f'
          ctx.font = '700 10px "Share Tech Mono", monospace'
          ctx.textAlign = 'center'
          ctx.fillText(midiToName(note.midi), x, top + 13)
        }
      }
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
