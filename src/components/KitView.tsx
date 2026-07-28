import { useMemo } from 'react'
import type { ChartNote, DrumLane } from '../types/chart'
import { LANE_COLORS, LANE_LABELS, LANES } from '../types/chart'

type Props = {
  notes: ChartNote[]
  currentTime: number
  hitFlash: Partial<Record<DrumLane, number>>
  lookAheadSec?: number
  hitWindow?: number
}

/** Layout positions for a front-facing kit (viewBox 0 0 1000 620). */
const KIT_LAYOUT: Record<
  DrumLane,
  { cx: number; cy: number; rx: number; ry: number; shape: 'oval' | 'circle' | 'cymbal' }
> = {
  kick: { cx: 500, cy: 430, rx: 120, ry: 90, shape: 'oval' },
  snare: { cx: 340, cy: 340, rx: 70, ry: 48, shape: 'oval' },
  tom: { cx: 500, cy: 250, rx: 78, ry: 52, shape: 'oval' },
  hat: { cx: 220, cy: 250, rx: 62, ry: 18, shape: 'cymbal' },
  crash: { cx: 320, cy: 130, rx: 78, ry: 22, shape: 'cymbal' },
  ride: { cx: 700, cy: 160, rx: 90, ry: 24, shape: 'cymbal' },
}

function intensityForLane(
  notes: ChartNote[],
  lane: DrumLane,
  currentTime: number,
  lookAheadSec: number,
  hitWindow: number,
): number {
  let best = 0
  for (const note of notes) {
    if (note.lane !== lane) continue
    const dt = note.t - currentTime
    if (dt < -hitWindow || dt > lookAheadSec) continue
    // Peak at hit time, ramp up as note approaches
    if (dt <= 0) {
      best = Math.max(best, 1 - Math.abs(dt) / hitWindow)
    } else {
      const approach = 1 - dt / lookAheadSec
      best = Math.max(best, approach * 0.85)
    }
  }
  return best
}

export function KitView({
  notes,
  currentTime,
  hitFlash,
  lookAheadSec = 2.4,
  hitWindow = 0.12,
}: Props) {
  const intensities = useMemo(() => {
    const map = {} as Record<DrumLane, number>
    for (const lane of LANES) {
      const flash = hitFlash[lane] ?? 0
      map[lane] = Math.max(flash, intensityForLane(notes, lane, currentTime, lookAheadSec, hitWindow))
    }
    return map
  }, [notes, currentTime, hitFlash, lookAheadSec, hitWindow])

  const nextNote = useMemo(() => {
    let best: ChartNote | null = null
    for (const note of notes) {
      if (note.t < currentTime - 0.05) continue
      if (note.t > currentTime + lookAheadSec) continue
      if (!best || note.t < best.t) best = note
    }
    return best
  }, [notes, currentTime, lookAheadSec])

  return (
    <div className="kit-view">
      <svg className="kit-view__svg" viewBox="0 0 1000 620" role="img" aria-label="Drum kit">
        <defs>
          <radialGradient id="kitFloor" cx="50%" cy="70%" r="55%">
            <stop offset="0%" stopColor="#12121a" />
            <stop offset="100%" stopColor="#0a0a0f" />
          </radialGradient>
        </defs>
        <rect width="1000" height="620" fill="url(#kitFloor)" />

        {/* Stand lines */}
        <g stroke="rgba(0, 240, 255, 0.12)" strokeWidth="4" fill="none">
          <line x1="220" y1="250" x2="220" y2="480" />
          <line x1="320" y1="130" x2="380" y2="420" />
          <line x1="700" y1="160" x2="640" y2="430" />
          <line x1="500" y1="250" x2="500" y2="340" />
        </g>

        {LANES.map((lane) => {
          const layout = KIT_LAYOUT[lane]
          const intensity = intensities[lane]
          const color = LANE_COLORS[lane]
          const glow = intensity > 0.15
          const isNext = nextNote?.lane === lane && nextNote.t - currentTime < 0.8

          return (
            <g key={lane} className={glow ? 'kit-piece is-active' : 'kit-piece'}>
              {glow && (
                <ellipse
                  cx={layout.cx}
                  cy={layout.cy}
                  rx={layout.rx + 18}
                  ry={layout.ry + 18}
                  fill={color}
                  opacity={0.12 + intensity * 0.35}
                />
              )}
              <ellipse
                cx={layout.cx}
                cy={layout.cy}
                rx={layout.rx}
                ry={layout.ry}
                fill={layout.shape === 'cymbal' ? '#1e1e30' : '#1a1a2e'}
                stroke={glow ? color : 'rgba(0, 240, 255, 0.28)'}
                strokeWidth={glow ? 5 : 2.5}
                opacity={0.75 + intensity * 0.25}
              />
              {layout.shape !== 'cymbal' && (
                <ellipse
                  cx={layout.cx}
                  cy={layout.cy - layout.ry * 0.15}
                  rx={layout.rx * 0.72}
                  ry={layout.ry * 0.55}
                  fill="rgba(255,255,255,0.06)"
                />
              )}
              <text
                x={layout.cx}
                y={layout.cy + (layout.shape === 'cymbal' ? 42 : 8)}
                textAnchor="middle"
                fill={glow || isNext ? color : 'rgba(224, 224, 224, 0.55)'}
                fontFamily="Orbitron, sans-serif"
                fontSize="22"
                fontWeight="700"
              >
                {LANE_LABELS[lane].toUpperCase()}
              </text>
            </g>
          )
        })}
      </svg>

      <div className="kit-view__cue">
        {nextNote ? (
          <>
            <span className="kit-view__cue-lane" style={{ color: LANE_COLORS[nextNote.lane] }}>
              {LANE_LABELS[nextNote.lane]}
            </span>
            <span className="kit-view__cue-time">
              {nextNote.t - currentTime <= 0.05
                ? 'NOW'
                : `in ${(nextNote.t - currentTime).toFixed(2)}s`}
            </span>
          </>
        ) : (
          <span className="muted">No upcoming hits</span>
        )}
      </div>
    </div>
  )
}
