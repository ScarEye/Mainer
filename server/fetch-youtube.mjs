import http from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ffmpegExe, pythonPath, run } from './runtime.mjs'
import { createDemucsProgress } from './separate-progress.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const catalog = JSON.parse(readFileSync(path.join(__dirname, '../src/separate/catalog.json'), 'utf8'))

const PORT = Number(process.env.MAINER_API_PORT || 8787)
const ALL_STEMS = ['drums', 'bass', 'vocals', 'guitar', 'piano', 'other']

/** @type {Map<string, {
 *   created: number,
 *   status: 'queued' | 'running' | 'done' | 'error',
 *   message: string,
 *   error?: string,
 *   stemNames?: string[],
 *   stems?: Record<string, Buffer>
 * }>} */
const stemJobs = new Map()

function sendJson(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(data)
}

function cors(res, extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    ...extra,
  }
}

async function resolveYtDlp() {
  const py = pythonPath()
  try {
    await run(py, ['-m', 'yt_dlp', '--version'])
    return [py, '-m', 'yt_dlp']
  } catch {
    /* system yt-dlp, if the local env is not ready yet */
  }
  await run('yt-dlp', ['--version'], process.platform === 'win32' ? { shell: true } : {})
  return ['yt-dlp']
}

function modelById(id) {
  return catalog.models.find((model) => model.id === id) || null
}

function qualityById(id) {
  return catalog.qualities.find((quality) => quality.id === id) || null
}

async function demucsAvailable() {
  try {
    await run(pythonPath(), ['-c', 'import demucs; print("ok")'])
    return true
  } catch {
    return false
  }
}

function normalizeYoutubeUrl(raw) {
  const trimmed = String(raw || '').trim()
  try {
    const u = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0]
      if (!id) return null
      return `https://www.youtube.com/watch?v=${id}`
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const shorts = u.pathname.match(/^\/shorts\/([\w-]+)/)
      if (shorts) return `https://www.youtube.com/watch?v=${shorts[1]}`
      const embed = u.pathname.match(/^\/embed\/([\w-]+)/)
      if (embed) return `https://www.youtube.com/watch?v=${embed[1]}`
      const live = u.pathname.match(/^\/live\/([\w-]+)/)
      if (live) return `https://www.youtube.com/watch?v=${live[1]}`
      const v = u.searchParams.get('v')
      if (v) return `https://www.youtube.com/watch?v=${v}`
    }
    return null
  } catch {
    return null
  }
}

function isAllowedUrl(url) {
  return Boolean(normalizeYoutubeUrl(url))
}

async function fetchYoutubeAudio(rawUrl) {
  const url = normalizeYoutubeUrl(rawUrl)
  if (!url) throw new Error('Only YouTube URLs are supported.')

  const yt = await resolveYtDlp()
  const ffmpeg = await ffmpegExe()
  const ffArgs = ffmpeg ? ['--ffmpeg-location', ffmpeg] : []
  const dir = await mkdtemp(path.join(tmpdir(), 'mainer-yt-'))

  try {
    const metaArgs = [
      ...yt.slice(1),
      ...ffArgs,
      '--no-update',
      '--no-playlist',
      '--dump-single-json',
      '--skip-download',
      url,
    ]
    const metaProc = await run(yt[0], metaArgs)
    const metaLine = metaProc.stdout.trim()
    if (!metaLine) throw new Error('Could not read video metadata.')
    const meta = JSON.parse(metaLine)

    const outTemplate = path.join(dir, '%(id)s.%(ext)s')
    const dlArgs = [
      ...yt.slice(1),
      ...ffArgs,
      '--no-update',
      '--no-playlist',
      '-f',
      'bestaudio/best',
      '-x',
      '--audio-format',
      'wav',
      '--audio-quality',
      '0',
      '-o',
      outTemplate,
      '--print',
      'after_move:filepath',
      url,
    ]
    const dl = await run(yt[0], dlArgs)
    let filePath = dl.stdout.trim().split(/\r?\n/).filter(Boolean).pop()

    // Fallback: scan temp dir if print path is missing
    if (!filePath) {
      const entries = await readdir(dir)
      const wav = entries.find((f) => f.toLowerCase().endsWith('.wav'))
      if (wav) filePath = path.join(dir, wav)
    }
    if (!filePath) throw new Error('Download finished but no audio file was found.')

    const audio = await readFile(filePath)
    return {
      title: String(meta.title || 'YouTube track'),
      id: String(meta.id || 'unknown'),
      audio,
      contentType: 'audio/wav',
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function findStemFiles(rootDir) {
  /** @type {Record<string, string>} */
  const found = {}
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const base = entry.name.toLowerCase()
      for (const name of ALL_STEMS) {
        if (base === `${name}.wav` || base === `${name}.mp3`) found[name] = full
      }
    }
  }
  await walk(rootDir)
  return found
}

/** @type {null | { cuda: boolean, gpuName: string | null, vramMb: number }} */
let demucsConfigCache = null

async function getDemucsConfig() {
  if (demucsConfigCache) return demucsConfigCache
  try {
    const { stdout } = await run(pythonPath(), [path.join(__dirname, 'demucs_device.py')])
    demucsConfigCache = JSON.parse(stdout.trim())
    return demucsConfigCache
  } catch {
    demucsConfigCache = { cuda: false, gpuName: null, vramMb: 0 }
    return demucsConfigCache
  }
}

function killProcessTree(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    return
  }
  try {
    child.kill('SIGTERM')
  } catch {
    /* already gone */
  }
}

function runDemucs(inputPath, outDir, options, onLog) {
  const args = [
    path.join(__dirname, 'run_demucs.py'),
    '-n',
    options.model.id,
    '-d',
    options.device,
    '--shifts',
    String(options.quality.shifts),
    '--overlap',
    String(options.quality.overlap),
  ]
  // The model default chunk keeps bass and guitar from smearing across cuts.
  // Only shrink it when the GPU is too small to hold that chunk.
  if (options.device === 'cuda' && options.vramMb > 0 && options.vramMb < 5000) {
    args.push('--segment', '6')
  }
  if (options.stems.length === 1) {
    args.push('--two-stems', options.stems[0])
  }
  args.push('--out', outDir, inputPath)

  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath(), args, {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES ?? '0',
        HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
      },
    })
    options.onChild?.(child)

    let stderr = ''
    const handleChunk = (d) => {
      const text = d.toString()
      stderr += text
      onLog?.(text)
    }
    child.stdout?.on('data', handleChunk)
    child.stderr?.on('data', handleChunk)
    child.on('error', reject)
    child.on('close', (code) => {
      if (options.cancelled?.()) {
        reject(new Error('Stopped'))
        return
      }
      if (code === 0) resolve({ stderr })
      else reject(new Error(stderr.trim() || `demucs exited with ${code}`))
    })
  })
}

/**
 * Start separation in the background and return a job id immediately.
 */
function startSeparateJob(wavBuffer, options) {
  const jobId = randomUUID()
  /** @type {{ created: number, status: string, message: string, percent: number, error?: string, stemNames?: string[], stems?: Record<string, Buffer>, child?: import('node:child_process').ChildProcess, cancelled?: boolean }} */
  const job = {
    created: Date.now(),
    status: 'queued',
    message: 'Getting the audio ready…',
    percent: 8,
    stemNames: options.stems,
    cancelled: false,
  }
  stemJobs.set(jobId, job)

  const progress = createDemucsProgress(options.quality.shifts, options.model.id)

  ;(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mainer-sep-'))
    const inputPath = path.join(dir, 'input.wav')
    const outDir = path.join(dir, 'out')
    try {
      if (!(await demucsAvailable())) {
        throw new Error('Stem tools are not ready yet. Start Mainer once with start.bat and wait for setup to finish.')
      }
      if (job.cancelled) return

      const config = await getDemucsConfig()
      if (options.device === 'cuda' && !config.cuda) {
        throw new Error('GPU was selected, but this PyTorch install cannot see an NVIDIA GPU.')
      }
      if (job.cancelled) return

      job.status = 'running'
      job.percent = 14
      job.message = 'Saving audio…'
      await writeFile(inputPath, wavBuffer)
      if (job.cancelled) return

      job.percent = 18
      job.message = 'Separating audio'
      console.log(
        `[demucs ${jobId.slice(0, 8)}] model=${options.model.id} device=${options.device} shifts=${options.quality.shifts} stems=${options.stems.join(',')}`,
      )
      await runDemucs(
        inputPath,
        outDir,
        {
          ...options,
          vramMb: config.vramMb,
          onChild: (child) => {
            job.child = child
          },
          cancelled: () => job.cancelled,
        },
        (text) => {
          if (job.cancelled) return
          const update = progress.push(text)
          if (update.percent >= job.percent) job.percent = update.percent
          job.message = update.message
        },
      )
      if (job.cancelled) return

      job.percent = 90
      job.message = 'Collecting stems…'
      const files = await findStemFiles(outDir)
      /** @type {Record<string, Buffer>} */
      const stems = {}
      for (const name of options.stems) {
        const fp = files[name]
        if (!fp) throw new Error(`Separation did not produce ${name}.wav`)
        stems[name] = await readFile(fp)
      }
      if (job.cancelled) return

      job.stems = stems
      job.percent = 96
      job.status = 'done'
      job.message = 'Stems ready'
      console.log(`[demucs ${jobId.slice(0, 8)}] done`)
    } catch (e) {
      if (job.cancelled) {
        job.status = 'cancelled'
        job.message = 'Stopped'
        job.error = undefined
        return
      }
      job.status = 'error'
      job.error = e instanceof Error ? e.message : 'Stem separation failed.'
      job.message = job.error
      console.error(`[demucs ${jobId.slice(0, 8)}]`, e)
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })()

  return jobId
}

function cancelSeparateJob(jobId) {
  const job = stemJobs.get(jobId)
  if (!job || job.status === 'done' || job.status === 'cancelled') return job
  job.cancelled = true
  job.status = 'cancelled'
  job.message = 'Stopped'
  job.error = undefined
  killProcessTree(job.child)
  return job
}

// Cleanup finished jobs every 10 minutes (never delete in-flight jobs)
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000
  for (const [id, job] of stemJobs) {
    if ((job.status === 'done' || job.status === 'error' || job.status === 'cancelled') && job.created < cutoff) {
      stemJobs.delete(id)
    }
  }
}, 10 * 60 * 1000).unref?.()

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...cors(),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    try {
      const yt = await resolveYtDlp()
      const demucs = await demucsAvailable()
      const demucsConfig = demucs ? await getDemucsConfig() : null
      sendJson(res, 200, {
        ok: true,
        ytDlp: yt.join(' '),
        demucs,
        cuda: Boolean(demucsConfig?.cuda),
        gpuName: demucsConfig?.gpuName ?? null,
      })
    } catch (e) {
      sendJson(res, 500, {
        ok: false,
        error: e instanceof Error ? e.message : 'yt-dlp not found',
      })
    }
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/separate/health') {
    const demucs = await demucsAvailable()
    const config = demucs ? await getDemucsConfig() : null
    sendJson(res, demucs ? 200 : 503, {
      ok: demucs,
      demucs,
      cuda: Boolean(config?.cuda),
      gpuName: config?.gpuName ?? null,
      vramMb: config?.vramMb ?? 0,
      models: catalog.models.map((model) => ({
        id: model.id,
        label: model.label,
        detail: model.detail,
        stems: model.stems,
      })),
      qualities: catalog.qualities.map((quality) => ({
        id: quality.id,
        label: quality.label,
        time: quality.time,
      })),
      error: demucs ? undefined : 'Stem tools are not ready yet. Leave Mainer running through first-time setup.',
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/youtube') {
    let body = ''
    for await (const chunk of req) body += chunk
    let ytUrl = ''
    try {
      ytUrl = String(JSON.parse(body).url || '').trim()
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body. Expected { "url": "..." }.' })
      return
    }

    if (!isAllowedUrl(ytUrl)) {
      sendJson(res, 400, {
        error: 'Only YouTube links work (youtube.com / youtu.be / music.youtube.com).',
      })
      return
    }

    try {
      const result = await fetchYoutubeAudio(ytUrl)
      res.writeHead(200, {
        'Content-Type': result.contentType,
        ...cors({
          'Access-Control-Expose-Headers': 'X-Track-Title, X-Track-Id',
          'X-Track-Title': encodeURIComponent(result.title),
          'X-Track-Id': result.id,
          'Cache-Control': 'no-store',
        }),
      })
      res.end(result.audio)
    } catch (e) {
      console.error(e)
      sendJson(res, 500, {
        error: e instanceof Error ? e.message : 'Failed to fetch YouTube audio.',
      })
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/separate') {
    try {
      const wav = await readBody(req)
      if (!wav.length) {
        sendJson(res, 400, { error: 'Empty audio body.' })
        return
      }
      const model = modelById(url.searchParams.get('model') || '')
      const quality = qualityById(url.searchParams.get('quality') || '')
      const device = url.searchParams.get('device')
      if (!model || !quality) {
        sendJson(res, 400, { error: 'Pick a model and a quality level.' })
        return
      }
      if (device !== 'cpu' && device !== 'cuda') {
        sendJson(res, 400, { error: 'Pick CPU or GPU before splitting.' })
        return
      }
      const requested = String(url.searchParams.get('stems') || '')
        .split(',')
        .map((stem) => stem.trim())
        .filter((stem) => model.stems.includes(stem))
      const stems = model.stems.filter((stem) => stem === 'drums' || requested.includes(stem))
      console.log(
        `Starting stem job ${model.id}/${quality.id}/${device} [${stems.join(',')}] (${(wav.length / 1024 / 1024).toFixed(1)} MB)…`,
      )
      const jobId = startSeparateJob(wav, { model, quality, device, stems })
      sendJson(res, 202, {
        jobId,
        stems,
        message: 'Separation started.',
      })
    } catch (e) {
      console.error(e)
      sendJson(res, 500, {
        error: e instanceof Error ? e.message : 'Stem separation failed.',
      })
    }
    return
  }

  const cancelMatch = url.pathname.match(/^\/api\/separate\/([^/]+)\/cancel$/)
  if (req.method === 'POST' && cancelMatch) {
    const job = cancelSeparateJob(cancelMatch[1])
    if (!job) {
      sendJson(res, 404, { error: 'Job not found (expired or invalid).' })
      return
    }
    sendJson(res, 200, { jobId: cancelMatch[1], status: job.status, message: job.message })
    return
  }

  const statusMatch = url.pathname.match(/^\/api\/separate\/([^/]+)$/)
  if (req.method === 'GET' && statusMatch) {
    const job = stemJobs.get(statusMatch[1])
    if (!job) {
      sendJson(res, 404, { error: 'Job not found (expired or invalid).' })
      return
    }
    sendJson(res, 200, {
      jobId: statusMatch[1],
      status: job.status,
      message: job.message,
      percent: job.percent ?? 0,
      error: job.error,
      stems: job.status === 'done' ? job.stemNames : undefined,
    })
    return
  }

  const stemMatch = url.pathname.match(/^\/api\/stems\/([^/]+)\/([^/]+)$/)
  if (req.method === 'GET' && stemMatch) {
    const jobId = stemMatch[1]
    const name = stemMatch[2]
    const job = stemJobs.get(jobId)
    if (!job || job.status !== 'done' || !job.stemNames?.includes(name) || !job.stems?.[name]) {
      sendJson(res, 404, { error: 'Stem not found (still processing, expired, or invalid).' })
      return
    }
    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      ...cors({ 'Cache-Control': 'no-store' }),
    })
    res.end(job.stems[name])
    return
  }

  sendJson(res, 404, { error: 'Not found' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mainer helper listening on http://127.0.0.1:${PORT}`)
})
