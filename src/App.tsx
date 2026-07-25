import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { separateStems } from './api/separate'
import { fetchYoutubeTrack } from './api/youtube'
import { analyzeDrumChart } from './audio/analyze'
import { AudioEngine } from './audio/engine'
import { MicDetector } from './audio/micDetector'
import { encodeWav } from './audio/wav'
import { ChartEditor } from './components/ChartEditor'
import { PracticeVisual } from './components/PracticeVisual'
import { StemMixer } from './components/StemMixer'
import { UploadDropzone } from './components/UploadDropzone'
import { VisualModePicker } from './components/VisualModePicker'
import { WaveformScrub } from './components/WaveformScrub'
import { YoutubeImport } from './components/YoutubeImport'
import type { ChartNote, DrumChart, DrumLane, StemId, StemLevels, VisualMode } from './types/chart'
import { STEM_IDS, defaultStemLevels } from './types/chart'
import './App.css'

type Score = {
  hits: number
  misses: number
  combo: number
  bestCombo: number
}

const HIT_WINDOW = 0.12

function formatTime(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function App() {
  const engineRef = useRef(new AudioEngine())
  const micRef = useRef(new MicDetector())
  const judgedRef = useRef(new Set<string>())
  const sessionGenRef = useRef(0)
  const prevTimeRef = useRef(0)
  const flashTimersRef = useRef<Partial<Record<DrumLane, number>>>({})

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [chart, setChart] = useState<DrumChart | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [loadingMsg, setLoadingMsg] = useState('Analyzing track… building drum chart')
  const [error, setError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [loopStart, setLoopStart] = useState<number | null>(null)
  const [loopEnd, setLoopEnd] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [micOn, setMicOn] = useState(false)
  const [hitFlash, setHitFlash] = useState<Partial<Record<DrumLane, number>>>({})
  const [score, setScore] = useState<Score>({ hits: 0, misses: 0, combo: 0, bestCombo: 0 })
  const [lastJudgement, setLastJudgement] = useState<string | null>(null)
  const [stemLevels, setStemLevels] = useState<StemLevels>(defaultStemLevels())
  const [stemsReady, setStemsReady] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [splitMessage, setSplitMessage] = useState<string | null>(null)
  const [visualMode, setVisualMode] = useState<VisualMode>(() => {
    const saved = localStorage.getItem('mainer.visualMode')
    return saved === 'notation' || saved === 'kit' || saved === 'digital' ? saved : 'digital'
  })

  const changeVisualMode = (mode: VisualMode) => {
    setVisualMode(mode)
    localStorage.setItem('mainer.visualMode', mode)
  }

  /** Seed judged set so past notes are not re-counted as misses after a reset. */
  const seedJudgedBefore = useCallback((notes: ChartNote[] | undefined, beforeTime: number) => {
    const judged = new Set<string>()
    if (notes) {
      for (const note of notes) {
        if (note.t < beforeTime - HIT_WINDOW) judged.add(note.id)
      }
    }
    judgedRef.current = judged
  }, [])

  const resetScore = useCallback(
    (notes?: ChartNote[], fromTime?: number) => {
      const t = fromTime ?? engineRef.current.currentTime
      seedJudgedBefore(notes ?? chart?.notes, t)
      setScore({ hits: 0, misses: 0, combo: 0, bestCombo: 0 })
      setLastJudgement(null)
    },
    [chart, seedJudgedBefore],
  )

  const clearLoopJudgements = useCallback((start: number, end: number, notes: ChartNote[]) => {
    for (const note of notes) {
      if (note.t >= start - HIT_WINDOW && note.t <= end + HIT_WINDOW) {
        judgedRef.current.delete(note.id)
      }
    }
  }, [])

  const chartRef = useRef(chart)
  chartRef.current = chart

  useEffect(() => {
    const engine = engineRef.current
    const mic = micRef.current
    const unsub = engine.subscribe((s) => {
      if (
        s.playing &&
        prevTimeRef.current - s.currentTime > 0.25 &&
        s.currentTime < prevTimeRef.current
      ) {
        const loop = engine.getLoop()
        const notes = chartRef.current?.notes
        if (loop && notes) clearLoopJudgements(loop.start, loop.end, notes)
      }
      prevTimeRef.current = s.currentTime
      setCurrentTime(s.currentTime)
      setDuration(s.duration)
      setPlaying(s.playing)
      setRate(s.rate)
    })
    mic.setSongTimeProvider(() => engine.currentTime)
    return () => {
      unsub()
      mic.stop()
      void engine.dispose()
    }
  }, [clearLoopJudgements])

  useEffect(() => {
    if (!chart || !playing) return
    for (const note of chart.notes) {
      if (judgedRef.current.has(note.id)) continue
      if (currentTime - note.t > HIT_WINDOW) {
        judgedRef.current.add(note.id)
        setScore((s) => ({ ...s, misses: s.misses + 1, combo: 0 }))
      }
    }
  }, [chart, currentTime, playing])

  const flashLane = useCallback((lane: DrumLane) => {
    const prev = flashTimersRef.current[lane]
    if (prev) window.clearTimeout(prev)
    setHitFlash((f) => ({ ...f, [lane]: 1 }))
    flashTimersRef.current[lane] = window.setTimeout(() => {
      setHitFlash((f) => ({ ...f, [lane]: 0 }))
      delete flashTimersRef.current[lane]
    }, 120)
  }, [])

  const judgeHit = useCallback(
    (hitTime: number) => {
      if (!chart) return
      let best: ChartNote | null = null
      let bestDist = HIT_WINDOW
      for (const note of chart.notes) {
        if (judgedRef.current.has(note.id)) continue
        const d = Math.abs(note.t - hitTime)
        if (d <= bestDist) {
          bestDist = d
          best = note
        }
      }
      if (!best) {
        setLastJudgement('—')
        return
      }
      judgedRef.current.add(best.id)
      flashLane(best.lane)
      const label = bestDist < 0.04 ? 'PERFECT' : bestDist < 0.08 ? 'GOOD' : 'OK'
      setLastJudgement(label)
      setScore((s) => {
        const combo = s.combo + 1
        return {
          hits: s.hits + 1,
          misses: s.misses,
          combo,
          bestCombo: Math.max(s.bestCombo, combo),
        }
      })
    },
    [chart, flashLane],
  )

  useEffect(() => {
    const mic = micRef.current
    return mic.subscribe((hit) => judgeHit(hit.time))
  }, [judgeHit])

  const resetSessionUi = () => {
    setChart(null)
    setBuffer(null)
    setStemsReady(false)
    setStemLevels(defaultStemLevels())
    setScore({ hits: 0, misses: 0, combo: 0, bestCombo: 0 })
    judgedRef.current = new Set()
    setLoopStart(null)
    setLoopEnd(null)
    setSelectedId(null)
    setLastJudgement(null)
    setSplitMessage(null)
    setError(null)
    engineRef.current.setLoop(null, null)
  }

  const loadFromArrayBuffer = async (arr: ArrayBuffer, title: string) => {
    const gen = ++sessionGenRef.current
    setStatus('loading')
    resetSessionUi()

    try {
      const ctx = await engineRef.current.ensureContext()
      const decoded = await ctx.decodeAudioData(arr.slice(0))
      if (gen !== sessionGenRef.current) return
      setLoadingMsg('Building drum chart…')
      const nextChart = await analyzeDrumChart(decoded, title)
      if (gen !== sessionGenRef.current) return
      await engineRef.current.loadBuffer(decoded)
      setBuffer(decoded)
      setChart(nextChart)
      setStatus('ready')
    } catch (e) {
      if (gen !== sessionGenRef.current) return
      console.error(e)
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Could not load that audio.')
    }
  }

  const onFile = async (file: File) => {
    setLoadingMsg('Decoding audio…')
    const title = file.name.replace(/\.[^.]+$/, '')
    const arr = await file.arrayBuffer()
    await loadFromArrayBuffer(arr, title)
  }

  const onYoutubeUrl = async (url: string) => {
    setLoadingMsg('Fetching from YouTube via local helper…')
    setStatus('loading')
    setError(null)
    const gen = sessionGenRef.current
    try {
      const { arrayBuffer, title } = await fetchYoutubeTrack(url)
      if (gen !== sessionGenRef.current) return
      setLoadingMsg('Decoding audio…')
      await loadFromArrayBuffer(arrayBuffer, title)
    } catch (e) {
      if (gen !== sessionGenRef.current) return
      console.error(e)
      setStatus('error')
      setError(e instanceof Error ? e.message : 'YouTube fetch failed.')
    }
  }

  const onSplitStems = async () => {
    if (!buffer || splitting) return
    const gen = sessionGenRef.current
    const title = chart?.title
    setSplitting(true)
    setError(null)
    setSplitMessage('Preparing audio…')
    try {
      const wav = encodeWav(buffer)
      const raw = await separateStems(wav, (msg) => {
        if (gen === sessionGenRef.current) setSplitMessage(msg)
      })
      if (gen !== sessionGenRef.current) return
      setSplitMessage('Decoding stems…')
      const ctx = await engineRef.current.ensureContext()
      const decoded = {} as Record<StemId, AudioBuffer>
      for (const id of STEM_IDS) {
        decoded[id] = await ctx.decodeAudioData(raw[id].slice(0))
      }
      if (gen !== sessionGenRef.current) return
      await engineRef.current.loadStems(decoded)
      setBuffer(decoded.drums)
      setStemsReady(true)
      setStemLevels(engineRef.current.getStemLevels())

      if (title) {
        const drumChart = await analyzeDrumChart(decoded.drums, title)
        if (gen !== sessionGenRef.current) return
        setChart(drumChart)
        seedJudgedBefore(drumChart.notes, engineRef.current.currentTime)
        setScore({ hits: 0, misses: 0, combo: 0, bestCombo: 0 })
        setLastJudgement(null)
      }
      const soloDrums = defaultStemLevels()
      for (const id of STEM_IDS) {
        soloDrums[id] = { volume: 1, muted: id !== 'drums' }
      }
      engineRef.current.setAllStemLevels(soloDrums)
      setStemLevels(soloDrums)
      setSplitMessage(null)
    } catch (e) {
      if (gen !== sessionGenRef.current) return
      console.error(e)
      setError(e instanceof Error ? e.message : 'Stem split failed.')
      setSplitMessage(null)
    } finally {
      if (gen === sessionGenRef.current) setSplitting(false)
    }
  }

  const onStemChange = (id: StemId, patch: Partial<{ volume: number; muted: boolean }>) => {
    engineRef.current.setStemLevel(id, patch)
    setStemLevels(engineRef.current.getStemLevels())
  }

  const onSolo = (id: StemId) => {
    const next = defaultStemLevels()
    for (const stem of STEM_IDS) {
      next[stem] = { volume: stemLevels[stem].volume, muted: stem !== id }
    }
    engineRef.current.setAllStemLevels(next)
    setStemLevels(next)
  }

  const onResetMix = () => {
    const next = defaultStemLevels()
    engineRef.current.setAllStemLevels(next)
    setStemLevels(next)
  }

  const accuracy = useMemo(() => {
    const total = score.hits + score.misses
    if (!total) return 100
    return Math.round((score.hits / total) * 100)
  }, [score])

  const togglePlay = async () => {
    const engine = engineRef.current
    if (playing) await engine.pause()
    else {
      if (engine.currentTime >= engine.duration - 0.05) {
        seedJudgedBefore(chart?.notes, 0)
        setScore({ hits: 0, misses: 0, combo: 0, bestCombo: 0 })
        setLastJudgement(null)
        await engine.seek(0)
      }
      await engine.play()
    }
  }

  const restartTrack = async () => {
    seedJudgedBefore(chart?.notes, 0)
    setScore({ hits: 0, misses: 0, combo: 0, bestCombo: 0 })
    setLastJudgement(null)
    await engineRef.current.seek(0)
  }

  const toggleMic = async () => {
    if (micOn) {
      micRef.current.stop()
      setMicOn(false)
      return
    }
    try {
      await micRef.current.start()
      setMicOn(true)
    } catch {
      setError('Microphone permission denied. Allow mic access to score hits.')
    }
  }

  const updateNotes = (notes: ChartNote[]) => {
    if (!chart) return
    setChart({ ...chart, notes })
    seedJudgedBefore(notes, engineRef.current.currentTime)
    setScore({ hits: 0, misses: 0, combo: 0, bestCombo: 0 })
    setLastJudgement(null)
  }

  const onSetLoopPoint = (which: 'start' | 'end', t: number) => {
    if (which === 'start') {
      setLoopStart(t)
      setLoopEnd(null)
      engineRef.current.setLoop(null, null)
    } else {
      setLoopEnd(t)
      if (loopStart != null) engineRef.current.setLoop(loopStart, t)
    }
  }

  const clearLoop = () => {
    setLoopStart(null)
    setLoopEnd(null)
    engineRef.current.setLoop(null, null)
  }

  const newTrack = () => {
    sessionGenRef.current += 1
    if (micOn) {
      micRef.current.stop()
      setMicOn(false)
    }
    void engineRef.current.stop()
    setSplitting(false)
    resetSessionUi()
    setStatus('idle')
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand__mark">Mainer</span>
          <span className="brand__tag">Upload a track or paste a YouTube link.</span>
        </div>
        {chart && (
          <div className="hud">
            <div className="hud__stat">
              <span>Accuracy</span>
              <strong>{accuracy}%</strong>
            </div>
            <div className="hud__stat">
              <span>Combo</span>
              <strong>{score.combo}</strong>
            </div>
            <div className="hud__stat">
              <span>Best</span>
              <strong>{score.bestCombo}</strong>
            </div>
            <div className="hud__judge">{lastJudgement ?? '—'}</div>
          </div>
        )}
      </header>

      {status !== 'ready' && (
        <main className="landing">
          <UploadDropzone disabled={status === 'loading'} onFile={onFile} />
          <div className="landing__or">or</div>
          <YoutubeImport disabled={status === 'loading'} onSubmitUrl={(url) => void onYoutubeUrl(url)} />
          {status === 'loading' && <p className="status">{loadingMsg}</p>}
          {status === 'error' && error && <p className="status status--error">{error}</p>}
        </main>
      )}

      {status === 'ready' && chart && (
        <main className="studio">
          <section className="studio__stage">
            <div className="track-meta">
              <div className="track-meta__row">
                <div>
                  <h1>{chart.title}</h1>
                  <p>
                    ~{chart.bpm} BPM · {chart.notes.length} notes · 6 drum lanes · {formatTime(duration)}
                    {stemsReady ? ' · stems ready' : ''}
                  </p>
                </div>
                <VisualModePicker mode={visualMode} onChange={changeVisualMode} />
              </div>
            </div>
            <PracticeVisual
              mode={visualMode}
              notes={chart.notes}
              currentTime={currentTime}
              hitFlash={hitFlash}
            />
            <p className="tip tip--visual">
              {visualMode === 'digital' && 'Digital: notes fall down lanes to the HIT line.'}
              {visualMode === 'notation' && 'Notation: drum staff — notes approach the NOW playhead from the right.'}
              {visualMode === 'kit' && 'Kit: watch which drum lights up, then hit that piece.'}
            </p>            <WaveformScrub
              buffer={buffer}
              currentTime={currentTime}
              duration={duration}
              loopStart={loopStart}
              loopEnd={loopEnd}
              onSeek={(t) => void engineRef.current.seek(t)}
              onSetLoopPoint={onSetLoopPoint}
            />
            <div className="transport">
              <button type="button" className="btn btn--primary" onClick={() => void togglePlay()}>
                {playing ? 'Pause' : 'Play'}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => void restartTrack()}>
                Restart
              </button>
              <label className="rate">
                Speed
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={Math.round(rate * 100)}
                  onChange={(e) => void engineRef.current.setRate(Number(e.target.value) / 100)}
                />
                <span>{Math.round(rate * 100)}%</span>
              </label>
              <button
                type="button"
                className={`btn ${micOn ? 'btn--accent' : 'btn--ghost'}`}
                onClick={() => void toggleMic()}
              >
                {micOn ? 'Mic on' : 'Enable mic'}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => resetScore()}>
                Reset score
              </button>
              {(loopStart != null || loopEnd != null) && (
                <button type="button" className="btn btn--ghost" onClick={clearLoop}>
                  Clear loop
                </button>
              )}
              <button type="button" className="btn btn--ghost" onClick={newTrack}>
                New track
              </button>
              <span className="time">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
            {error && <p className="status status--error">{error}</p>}
          </section>

          <aside className="studio__side">
            <StemMixer
              levels={stemLevels}
              ready={stemsReady}
              splitting={splitting}
              splitMessage={splitMessage}
              onChange={onStemChange}
              onSolo={onSolo}
              onSplit={() => void onSplitStems()}
              onResetMix={onResetMix}
            />
            <ChartEditor
              notes={chart.notes}
              currentTime={currentTime}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={updateNotes}
            />
          </aside>
        </main>
      )}
    </div>
  )
}
