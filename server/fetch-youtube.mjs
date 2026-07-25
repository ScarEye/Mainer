import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.MAINER_API_PORT || 8787)
const MAX_DURATION_SEC = 12 * 60
const STEM_NAMES = ['drums', 'bass', 'vocals', 'other']

/** @type {Map<string, {
 *   created: number,
 *   status: 'queued' | 'running' | 'done' | 'error',
 *   message: string,
 *   error?: string,
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

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      ...opts,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr?.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(stderr.trim() || stdout.trim() || `${cmd} exited with ${code}`))
    })
  })
}

async function resolveYtDlp() {
  // Prefer python -m on Windows (pip installs yt-dlp.cmd which spawn can't run without shell)
  if (process.platform === 'win32') {
    try {
      await run('python', ['-m', 'yt_dlp', '--version'])
      return ['python', '-m', 'yt_dlp']
    } catch {
      /* fall through */
    }
  }
  try {
    await run('yt-dlp', ['--version'], process.platform === 'win32' ? { shell: true } : {})
    return process.platform === 'win32' ? ['yt-dlp'] : ['yt-dlp']
  } catch {
    await run('python', ['-m', 'yt_dlp', '--version'])
    return ['python', '-m', 'yt_dlp']
  }
}

async function demucsAvailable() {
  try {
    await run('python', ['-c', 'import demucs; print("ok")'])
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
  const dir = await mkdtemp(path.join(tmpdir(), 'mainer-yt-'))

  try {
    const metaArgs = [
      ...yt.slice(1),
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
    if (typeof meta.duration === 'number' && meta.duration > MAX_DURATION_SEC) {
      throw new Error(`Video is too long (max ${MAX_DURATION_SEC / 60} minutes).`)
    }

    const outTemplate = path.join(dir, '%(id)s.%(ext)s')
    const dlArgs = [
      ...yt.slice(1),
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
      for (const name of STEM_NAMES) {
        if (base === `${name}.wav` || base === `${name}.mp3`) found[name] = full
      }
    }
  }
  await walk(rootDir)
  return found
}

/** @type {null | { device: string, cuda: boolean, gpuName?: string, vramMb: number, segment: number, overlap: number, shifts: number }} */
let demucsConfigCache = null

async function getDemucsConfig() {
  if (demucsConfigCache) return demucsConfigCache
  try {
    const { stdout } = await run('python', [path.join(__dirname, 'demucs_device.py')])
    demucsConfigCache = JSON.parse(stdout.trim())
    return demucsConfigCache
  } catch {
    demucsConfigCache = {
      device: 'cpu',
      cuda: false,
      vramMb: 0,
      segment: 10,
      overlap: 0.1,
      shifts: 0,
    }
    return demucsConfigCache
  }
}

function runDemucs(inputPath, outDir, config, onLog) {
  const args = [
    '-m',
    'demucs',
    '-n',
    'htdemucs',
    '-d',
    config.device,
    '--shifts',
    String(config.shifts),
    '--overlap',
    String(config.overlap),
    '--segment',
    String(config.segment),
    '--out',
    outDir,
    inputPath,
  ]

  return new Promise((resolve, reject) => {
    const child = spawn('python', args, {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES ?? '0',
      },
    })

    let stderr = ''
    const handleChunk = (d) => {
      const text = d.toString()
      stderr += text
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      if (lines.length) onLog?.(lines[lines.length - 1])
    }
    child.stdout?.on('data', handleChunk)
    child.stderr?.on('data', handleChunk)
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stderr })
      else reject(new Error(stderr.trim() || `demucs exited with ${code}`))
    })
  })
}

/**
 * Start separation in the background and return a job id immediately.
 */
function startSeparateJob(wavBuffer) {
  const jobId = randomUUID()
  /** @type {{ created: number, status: string, message: string, error?: string, stems?: Record<string, Buffer> }} */
  const job = {
    created: Date.now(),
    status: 'queued',
    message: 'Queued for stem separation…',
  }
  stemJobs.set(jobId, job)

  ;(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mainer-sep-'))
    const inputPath = path.join(dir, 'input.wav')
    const outDir = path.join(dir, 'out')
    try {
      if (!(await demucsAvailable())) {
        throw new Error(
          'Demucs is not installed. Run: pip install demucs torch (CUDA torch for GPU).',
        )
      }

      const config = await getDemucsConfig()
      const deviceLabel = config.cuda
        ? `GPU (${config.gpuName || 'CUDA'})`
        : 'CPU'

      job.status = 'running'
      job.message = 'Saving audio for Demucs…'
      await writeFile(inputPath, wavBuffer)

      job.message = `Running Demucs on ${deviceLabel}…`
      console.log(`[demucs ${jobId.slice(0, 8)}] device=${config.device} segment=${config.segment}`)
      await runDemucs(inputPath, outDir, config, (line) => {
        // Keep messages short for the UI
        const clipped = line.length > 140 ? `${line.slice(0, 140)}…` : line
        job.message = clipped
        console.log(`[demucs ${jobId.slice(0, 8)}] ${line}`)
      })

      job.message = 'Collecting stem files…'
      const files = await findStemFiles(outDir)
      /** @type {Record<string, Buffer>} */
      const stems = {}
      for (const name of STEM_NAMES) {
        const fp = files[name]
        if (!fp) throw new Error(`Demucs did not produce ${name}.wav`)
        stems[name] = await readFile(fp)
      }

      job.stems = stems
      job.status = 'done'
      job.message = 'Stems ready'
      console.log(`[demucs ${jobId.slice(0, 8)}] done`)
    } catch (e) {
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

// Cleanup finished jobs every 10 minutes (never delete in-flight jobs)
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000
  for (const [id, job] of stemJobs) {
    if ((job.status === 'done' || job.status === 'error') && job.created < cutoff) {
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
        demucsDevice: demucsConfig?.device,
        gpuName: demucsConfig?.gpuName,
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
      device: config?.device,
      gpuName: config?.gpuName,
      vramMb: config?.vramMb,
      error: demucs ? undefined : 'Demucs not installed yet',
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
      if (wav.length > 80 * 1024 * 1024) {
        sendJson(res, 413, { error: 'Audio too large (max ~80MB WAV).' })
        return
      }
      console.log(`Starting stem job (${(wav.length / 1024 / 1024).toFixed(1)} MB)…`)
      const jobId = startSeparateJob(wav)
      sendJson(res, 202, {
        jobId,
        stems: STEM_NAMES,
        message: 'Separation started. Poll /api/separate/:jobId for status.',
      })
    } catch (e) {
      console.error(e)
      sendJson(res, 500, {
        error: e instanceof Error ? e.message : 'Stem separation failed.',
      })
    }
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
      error: job.error,
      stems: job.status === 'done' ? STEM_NAMES : undefined,
    })
    return
  }

  const stemMatch = url.pathname.match(/^\/api\/stems\/([^/]+)\/([^/]+)$/)
  if (req.method === 'GET' && stemMatch) {
    const jobId = stemMatch[1]
    const name = stemMatch[2]
    const job = stemJobs.get(jobId)
    if (!job || job.status !== 'done' || !STEM_NAMES.includes(name) || !job.stems?.[name]) {
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
