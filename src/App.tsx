import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchSeparateHealth, separateStems } from './api/separate'
import { fetchYoutubeTrack } from './api/youtube'
import { analyzeDrumChart } from './audio/analyze'
import { AudioEngine } from './audio/engine'
import { MicDetector } from './audio/micDetector'
import { placeStem, sliceBuffer } from './audio/placeStem'
import { estimateSplitAccuracy, measureSplitAccuracy } from './audio/separateScore'
import { encodeWav } from './audio/wav'
import { ChartEditor } from './components/ChartEditor'
import { PracticeVisual } from './components/PracticeVisual'
import { ProgressCard } from './components/ProgressCard'
import { StemMixer } from './components/StemMixer'
import { UploadDropzone } from './components/UploadDropzone'
import { VisualModePicker } from './components/VisualModePicker'
import { WaveformScrub } from './components/WaveformScrub'
import { YoutubeImport } from './components/YoutubeImport'
import { modelById, type DeviceChoice, type QualityId, type SplitRange } from './separate/models'
import { SEPARATE_MODELS } from './separate/models'
import type { ChartNote, DrumChart, DrumLane, StemId, StemLevels, VisualMode } from './types/chart'
import { STEM_IDS, defaultStemLevels } from './types/chart'
import './App.css'

type Score = {
  hits: number
  misses: number
  combo: number
  bestCombo: number
}

type ProgressState = {
  label: string
  detail: string
  percent: number
}

const HIT_WINDOW = 0.12

type SplitRun = {
  model: string
  quality: QualityId
  range: SplitRange
  loopStart: number | null
  loopEnd: number | null
  accuracy: number
  stems: StemId[]
}

function runMatches(
  run: SplitRun | null,
  model: string,
  quality: QualityId,
  range: SplitRange,
  loopStart: number | null,
  loopEnd: number | null,
) {
  if (!run || run.model !== model || run.quality !== quality || run.range !== range) return false
  if (range === 'loop') return run.loopStart === loopStart && run.loopEnd === loopEnd
  return true
}

function formatTime(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function progress(label: string, detail: string, percent: number): ProgressState {
  return { label, detail, percent: Math.max(0, Math.min(100, Math.round(percent))) }
}

function mergeProgress(prev: ProgressState | null, next: ProgressState): ProgressState {
  return prev && prev.label === next.label
    ? { ...next, percent: Math.max(prev.percent, next.percent) }
    : next
}

function youtubePercent(detail: string) {
  const text = detail.toLowerCase()
  if (text.includes('contacting')) return 10
  if (text.includes('downloading audio')) return 26
  if (text.includes('audio downloaded')) return 38
  if (text.includes('decoding')) return 52
  if (text.includes('building drum chart')) return 84
  return 14
}

function splitPercent(detail: string) {
  const text = detail.toLowerCase()
  if (text.includes('preparing audio')) return 8
  if (text.includes('uploading audio')) return 16
  if (text.includes('separation started')) return 22
  if (text.includes('queued')) return 26
  if (text.includes('saving audio')) return 32
  if (text.includes('running demucs')) return 56
  if (text.includes('collecting stem files')) return 78
  if (text.includes('downloading stem files')) return 86
  if (text.includes('decoding stems')) return 92
  if (text.includes('rebuilding drum chart')) return 96
  if (text.includes('stems ready')) return 100
  return 60
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
  const [loadingProgress, setLoadingProgress] = useState<ProgressState | null>(null)
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
  const [sourceBuffer, setSourceBuffer] = useState<AudioBuffer | null>(null)
  const [stemLevels, setStemLevels] = useState<StemLevels>(defaultStemLevels())
  const [stemsReady, setStemsReady] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [splitProgress, setSplitProgress] = useState<ProgressState | null>(null)
  const [modelId, setModelId] = useState('htdemucs_6s')
  const [qualityId, setQualityId] = useState<QualityId>('balanced')
  const [device, setDevice] = useState<DeviceChoice | null>(null)
  const [splitRange, setSplitRange] = useState<SplitRange>('full')
  const [cuda, setCuda] = useState(false)
  const [gpuName, setGpuName] = useState<string | null>(null)
  const [splitRun, setSplitRun] = useState<SplitRun | null>(null)
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
    let cancel = false
    void fetchSeparateHealth().then((health) => {
      if (cancel) return
      setCuda(Boolean(health.cuda))
      setGpuName(health.gpuName ?? null)
    })
    return () => {
      cancel = true
    }
  }, [status])

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
    setSourceBuffer(null)
    setStemsReady(false)
    setStemLevels(defaultStemLevels())
    setSplitRun(null)
    setDevice(null)
    setSplitRange('full')
    setScore({ hits: 0, misses: 0, combo: 0, bestCombo: 0 })
    judgedRef.current = new Set()
    setLoopStart(null)
    setLoopEnd(null)
    setSelectedId(null)
    setLastJudgement(null)
    setSplitProgress(null)
    setError(null)
    engineRef.current.setLoop(null, null)
  }

  const loadFromArrayBuffer = async (arr: ArrayBuffer, title: string) => {
    const gen = ++sessionGenRef.current
    setStatus('loading')
    setLoadingProgress(progress('Loading track', 'Decoding audio…', 52))
    resetSessionUi()

    try {
      const ctx = await engineRef.current.ensureContext()
      const decoded = await ctx.decodeAudioData(arr.slice(0))
      if (gen !== sessionGenRef.current) return
      setLoadingProgress((prev) => mergeProgress(prev, progress('Loading track', 'Building drum chart…', 84)))
      const nextChart = await analyzeDrumChart(decoded, title)
      if (gen !== sessionGenRef.current) return
      await engineRef.current.loadBuffer(decoded)
      setSourceBuffer(decoded)
      setBuffer(decoded)
      setChart(nextChart)
      setLoadingProgress((prev) => mergeProgress(prev, progress('Loading track', 'Track ready.', 100)))
      setStatus('ready')
      setLoadingProgress(null)
    } catch (e) {
      if (gen !== sessionGenRef.current) return
      console.error(e)
      setStatus('error')
      setLoadingProgress(null)
      setError(e instanceof Error ? e.message : 'Could not load that audio.')
    }
  }

  const onFile = async (file: File) => {
    setLoadingProgress(progress('Loading track', 'Reading local audio file…', 18))
    const title = file.name.replace(/\.[^.]+$/, '')
    const arr = await file.arrayBuffer()
    await loadFromArrayBuffer(arr, title)
  }

  const onYoutubeUrl = async (url: string) => {
    setStatus('loading')
    setLoadingProgress(progress('Fetching track', 'Contacting local helper…', 10))
    setError(null)
    const gen = sessionGenRef.current
    try {
      const { arrayBuffer, title } = await fetchYoutubeTrack(url, (detail) => {
        if (gen !== sessionGenRef.current) return
        setLoadingProgress((prev) =>
          mergeProgress(prev, progress('Fetching track', detail, youtubePercent(detail))),
        )
      })
      if (gen !== sessionGenRef.current) return
      setLoadingProgress((prev) =>
        mergeProgress(prev, progress('Loading track', 'Decoding audio…', 52)),
      )
      await loadFromArrayBuffer(arrayBuffer, title)
    } catch (e) {
      if (gen !== sessionGenRef.current) return
      console.error(e)
      setStatus('error')
      setLoadingProgress(null)
      setError(e instanceof Error ? e.message : 'YouTube fetch failed.')
    }
  }

  const onSplitStems = async () => {
    const source = sourceBuffer
    if (!source || splitting || !device) return
    const model = modelById(modelId)
    const loopOk =
      loopStart != null && loopEnd != null && Math.abs(loopEnd - loopStart) >= 0.25
    if (splitRange === 'loop' && !loopOk) {
      setError('Set a loop on the waveform before splitting that range.')
      return
    }
    const useLoop = splitRange === 'loop' && loopOk
    const start = useLoop ? Math.min(loopStart ?? 0, loopEnd ?? 0) : 0
    const end = useLoop ? Math.max(loopStart ?? 0, loopEnd ?? 0) : source.duration
    const gen = sessionGenRef.current
    const title = chart?.title
    const previous = chart
    setSplitting(true)
    setError(null)
    setSplitProgress(progress('Splitting stems', 'Preparing audio…', 8))
    try {
      const ctx = await engineRef.current.ensureContext()
      const piece = useLoop ? sliceBuffer(ctx, source, start, end) : source
      const wav = encodeWav(piece)
      const raw = await separateStems(
        wav,
        { model: model.id, quality: qualityId, device, stems: model.stems },
        (msg) => {
          if (gen !== sessionGenRef.current) return
          setSplitProgress((prev) => mergeProgress(prev, progress('Splitting stems', msg, splitPercent(msg))))
        },
      )
      if (gen !== sessionGenRef.current) return
      setSplitProgress((prev) => mergeProgress(prev, progress('Splitting stems', 'Decoding stems…', 92)))
      const decoded = {} as Partial<Record<StemId, AudioBuffer>>
      for (const id of model.stems) {
        const bytes = raw[id]
        if (!bytes) throw new Error(`Missing stem: ${id}`)
        decoded[id] = await ctx.decodeAudioData(bytes.slice(0))
      }
      const drumSlice = decoded.drums
      if (!drumSlice) throw new Error('Missing drum stem.')
      const placed = {} as Partial<Record<StemId, AudioBuffer>>
      for (const id of model.stems) {
        const stem = decoded[id]
        if (!stem) continue
        placed[id] = placeStem(ctx, stem, source.length, source.sampleRate, start)
      }
      if (gen !== sessionGenRef.current) return
      const measured = measureSplitAccuracy(source, decoded, useLoop ? { start, end } : null)
      await engineRef.current.loadStems(placed)
      setBuffer(placed.drums ?? source)
      setStemsReady(true)
      setSplitRun({
        model: model.id,
        quality: qualityId,
        range: useLoop ? 'loop' : 'full',
        loopStart: useLoop ? start : null,
        loopEnd: useLoop ? end : null,
        accuracy: measured,
        stems: model.stems,
      })

      if (title) {
        setSplitProgress((prev) =>
          mergeProgress(prev, progress('Splitting stems', 'Rebuilding drum chart from the drum stem…', 96)),
        )
        const drumChart = await analyzeDrumChart(drumSlice, title)
        if (gen !== sessionGenRef.current) return
        const nextChart =
          useLoop && previous
            ? {
                ...previous,
                bpm: drumChart.bpm || previous.bpm,
                notes: [
                  ...previous.notes.filter((note) => note.t < start - 0.03 || note.t > end + 0.03),
                  ...drumChart.notes.map((note) => ({ ...note, t: note.t + start })),
                ].sort((a, b) => a.t - b.t || a.lane.localeCompare(b.lane)),
              }
            : drumChart
        setChart(nextChart)
        seedJudgedBefore(nextChart.notes, engineRef.current.currentTime)
        setScore({ hits: 0, misses: 0, combo: 0, bestCombo: 0 })
        setLastJudgement(null)
      }
      const soloDrums = defaultStemLevels()
      for (const id of STEM_IDS) {
        soloDrums[id] = { volume: 1, muted: id !== 'drums' }
      }
      engineRef.current.setAllStemLevels(soloDrums)
      setStemLevels(soloDrums)
      setSplitProgress(progress('Splitting stems', 'Stems ready.', 100))
      window.setTimeout(() => {
        if (sessionGenRef.current === gen) setSplitProgress(null)
      }, 900)
    } catch (e) {
      if (gen !== sessionGenRef.current) return
      console.error(e)
      setError(e instanceof Error ? e.message : 'Stem split failed.')
      setSplitProgress(null)
    } finally {
      if (gen === sessionGenRef.current) setSplitting(false)
    }
  }

  const onStemChange = (id: StemId, patch: Partial<{ volume: number; muted: boolean }>) => {
    engineRef.current.setStemLevel(id, patch)
    setStemLevels(engineRef.current.getStemLevels())
  }

  const activeStems = stemsReady && splitRun ? splitRun.stems : modelById(modelId).stems
  const matched = runMatches(splitRun, modelId, qualityId, splitRange, loopStart, loopEnd)
  const estimate = useMemo(() => {
    if (!sourceBuffer) return null
    if (splitRange === 'loop') {
      if (loopStart == null || loopEnd == null || Math.abs(loopEnd - loopStart) < 0.25) return null
      return estimateSplitAccuracy(sourceBuffer, modelById(modelId), qualityId, {
        start: Math.min(loopStart, loopEnd),
        end: Math.max(loopStart, loopEnd),
      })
    }
    return estimateSplitAccuracy(sourceBuffer, modelById(modelId), qualityId, null)
  }, [sourceBuffer, modelId, qualityId, splitRange, loopStart, loopEnd])

  const onSolo = (id: StemId) => {
    const next = defaultStemLevels()
    for (const stem of STEM_IDS) {
      next[stem] = {
        volume: stemLevels[stem].volume,
        muted: !activeStems.includes(stem) || stem !== id,
      }
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
    setLoadingProgress(null)
    setSplitProgress(null)
    resetSessionUi()
    setStatus('idle')
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand__mark">
            MAINER<span>.DEV</span>
          </span>
          <span className="brand__tag">// upload a track · practice drums_</span>
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
          {status === 'loading' && loadingProgress && (
            <ProgressCard
              label={loadingProgress.label}
              detail={loadingProgress.detail}
              percent={loadingProgress.percent}
            />
          )}
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
            </p>
            <WaveformScrub
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
              activeStems={activeStems}
              ready={stemsReady}
              splitting={splitting}
              splitProgress={splitProgress}
              models={SEPARATE_MODELS}
              modelId={modelId}
              quality={qualityId}
              device={device}
              cuda={cuda}
              gpuName={gpuName}
              range={splitRange}
              loopReady={loopStart != null && loopEnd != null && Math.abs(loopEnd - loopStart) >= 0.25}
              accuracy={matched && splitRun ? splitRun.accuracy : estimate}
              accuracyKind={matched ? 'result' : 'estimate'}
              settingsDiffer={Boolean(stemsReady && splitRun && !matched)}
              onModel={setModelId}
              onQuality={setQualityId}
              onDevice={setDevice}
              onRange={setSplitRange}
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
