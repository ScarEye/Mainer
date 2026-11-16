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

function shiftCount(options) {
  const shifts = Number(options.quality.shifts) || 0
  // The fine-tune is already a bag of four models. Extra shifts stack on top of that.
  if (options.model.id === 'htdemucs_ft') return Math.min(shifts, 2)
  return shifts
}

function mapDemucsPercent(percent, lo, hi) {
  const t = Math.max(0, Math.min(1, (percent - 18) / 70))
  return Math.round(lo + t * (hi - lo))
}

function parseWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Stem file is not a wav.')
  }
  let offset = 12
  let audioFormat = 0
  let channels = 0
  let sampleRate = 0
  let bits = 0
  let dataOffset = 0
  let dataSize = 0
  let floatSamples = false
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (id === 'fmt ') {
      audioFormat = view.getUint16(start, true)
      channels = view.getUint16(start + 2, true)
      sampleRate = view.getUint32(start + 4, true)
      bits = view.getUint16(start + 14, true)
      floatSamples = audioFormat === 3
      if (audioFormat === 65534 && start + 28 <= buffer.length) {
        const subtype = view.getUint16(start + 24, true)
        floatSamples = subtype === 3
      }
    } else if (id === 'data') {
      dataOffset = start
      dataSize = size
      break
    }
    offset = start + size + (size % 2)
  }
  if (!dataOffset || !channels || !sampleRate) throw new Error('Stem wav is missing audio data.')
  const bytesPer = bits / 8
  const frames = Math.floor(dataSize / (bytesPer * channels))
  const out = Array.from({ length: channels }, () => new Float32Array(frames))
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const p = dataOffset + (i * channels + c) * bytesPer
      let sample = 0
      if (floatSamples && bits === 32) sample = view.getFloat32(p, true)
      else if (bits === 16) sample = view.getInt16(p, true) / 32768
      else if (bits === 32) sample = view.getInt32(p, true) / 2147483648
      else if (bits === 24) {
        const b0 = buffer[p] ?? 0
        const b1 = buffer[p + 1] ?? 0
        const b2 = buffer[p + 2] ?? 0
        let value = b0 | (b1 << 8) | (b2 << 16)
        if (value & 0x800000) value |= ~0xffffff
        sample = value / 8388608
      } else throw new Error(`Unsupported stem wav (${bits}-bit).`)
      out[c][i] = sample
    }
  }
  return { sampleRate, channels: out }
}

function encodeWav(sampleRate, channels) {
  const ch = channels.length
  const frames = channels[0]?.length ?? 0
  const block = ch * 2
  const dataSize = frames * block
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(ch, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * block, 28)
  buf.writeUInt16LE(block, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const raw = channels[c][i] ?? 0
      const clipped = Math.max(-1, Math.min(1, raw))
      const int = clipped < 0 ? Math.round(clipped * 32768) : Math.round(clipped * 32767)
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, int)), 44 + (i * ch + c) * 2)
    }
  }
  return buf
}

function channelAt(wav, index) {
  return wav.channels[Math.min(index, wav.channels.length - 1)]
}

/** Copy guitar and piano onto a 4-stem result and take them back out of Other. */
async function mergeLeadStems(primaryPaths, leadPaths, qualityId) {
  const anchor = primaryPaths.drums || primaryPaths.other || primaryPaths.vocals
  if (!anchor) return
  const dir = path.dirname(anchor)
  const blend = qualityId === 'fast' ? 0 : 0.35
  for (const name of ['guitar', 'piano']) {
    if (!leadPaths[name]) continue
    const lead = parseWav(await readFile(leadPaths[name]))
    await writeFile(path.join(dir, `${name}.wav`), encodeWav(lead.sampleRate, lead.channels))
    leadPaths[name] = path.join(dir, `${name}.wav`)
  }
  if (primaryPaths.other && (leadPaths.guitar || leadPaths.piano)) {
    const other = parseWav(await readFile(primaryPaths.other))
    const guitar = leadPaths.guitar ? parseWav(await readFile(leadPaths.guitar)) : null
    const piano = leadPaths.piano ? parseWav(await readFile(leadPaths.piano)) : null
    const six = blend && leadPaths.other ? parseWav(await readFile(leadPaths.other)) : null
    const mixed = other.channels.map((ch, index) => {
      const g = guitar ? channelAt(guitar, index) : null
      const p = piano ? channelAt(piano, index) : null
      const extra = six ? channelAt(six, index) : null
      const out = new Float32Array(ch.length)
      for (let i = 0; i < ch.length; i++) {
        const pulled = ch[i] - (g && i < g.length ? g[i] : 0) - (p && i < p.length ? p[i] : 0)
        const alt = extra && i < extra.length ? extra[i] : pulled
        out[i] = pulled * (1 - blend) + alt * blend
      }
      return out
    })
    await writeFile(primaryPaths.other, encodeWav(other.sampleRate, mixed))
  }
  if (!blend) return
  for (const name of ['drums', 'bass', 'vocals']) {
    if (!primaryPaths[name] || !leadPaths[name]) continue
    const primary = parseWav(await readFile(primaryPaths[name]))
    const lead = parseWav(await readFile(leadPaths[name]))
    if (primary.sampleRate !== lead.sampleRate) continue
    const mixed = primary.channels.map((ch, index) => {
      const src = channelAt(lead, index)
      const out = new Float32Array(ch.length)
      const n = Math.min(ch.length, src.length)
      for (let i = 0; i < ch.length; i++) {
        const other = i < n ? src[i] : ch[i]
        out[i] = ch[i] * (1 - blend) + other * blend
      }
      return out
    })
    await writeFile(primaryPaths[name], encodeWav(primary.sampleRate, mixed))
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
    String(shiftCount(options)),
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

  const needsLead = options.stems.some(
    (stem) => (stem === 'guitar' || stem === 'piano') && !options.model.stems.includes(stem),
  )
  const leadModel = needsLead ? modelById('htdemucs_6s') : null
  const progress = createDemucsProgress(shiftCount(options), options.model.id)

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
      const primaryStems = leadModel ? options.model.stems : options.stems
      console.log(
        `[demucs ${jobId.slice(0, 8)}] model=${options.model.id} device=${options.device} shifts=${shiftCount(options)} stems=${options.stems.join(',')}`,
      )
      const demucsOpts = {
        ...options,
        stems: primaryStems,
        vramMb: config.vramMb,
        onChild: (child) => {
          job.child = child
        },
        cancelled: () => job.cancelled,
      }
      await runDemucs(inputPath, outDir, demucsOpts, (text) => {
        if (job.cancelled) return
        const update = progress.push(text)
        const percent = leadModel ? mapDemucsPercent(update.percent, 18, 56) : update.percent
        if (percent >= job.percent) job.percent = percent
        job.message = update.message
      })
      if (job.cancelled) return

      let files = await findStemFiles(outDir)
      if (leadModel) {
        job.percent = Math.max(job.percent, 58)
        job.message = 'Splitting guitar and piano…'
        const leadDir = path.join(dir, 'lead')
        const leadProgress = createDemucsProgress(shiftCount({ ...options, model: leadModel }), leadModel.id)
        console.log(`[demucs ${jobId.slice(0, 8)}] lead=${leadModel.id}`)
        await runDemucs(
          inputPath,
          leadDir,
          { ...demucsOpts, model: leadModel, stems: leadModel.stems },
          (text) => {
            if (job.cancelled) return
            const update = leadProgress.push(text)
            const percent = mapDemucsPercent(update.percent, 58, 86)
            if (percent >= job.percent) job.percent = percent
            job.message = 'Splitting guitar and piano…'
          },
        )
        if (job.cancelled) return
        await mergeLeadStems(files, await findStemFiles(leadDir), options.quality.id)
        files = await findStemFiles(outDir)
      }

      job.percent = 90
      job.message = 'Sharpening the split…'
      const trackDir = files.drums ? path.dirname(files.drums) : outDir
      try {
        await run(pythonPath(), [path.join(__dirname, 'refine_stems.py'), trackDir])
      } catch (err) {
        console.error(`[demucs ${jobId.slice(0, 8)}] sharpen skipped`, err)
      }
      if (job.cancelled) return
      files = await findStemFiles(outDir)

      job.percent = 93
      job.message = 'Collecting stems…'
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
        .filter((stem) => ALL_STEMS.includes(stem))
      const stems = ALL_STEMS.filter((stem) => stem === 'drums' || requested.includes(stem))
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
