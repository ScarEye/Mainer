import type { StemId } from '../types/chart'
import type { DeviceChoice, QualityId } from '../separate/models'

export type SeparatedStems = Partial<Record<StemId, ArrayBuffer>>

export type SeparateHealth = {
  ok: boolean
  demucs?: boolean
  cuda?: boolean
  gpuName?: string | null
  error?: string
}

export type SeparateStatus = {
  jobId: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  message: string
  percent?: number
  error?: string
  stems?: StemId[]
}

export type SeparateUpdate = {
  message: string
  percent: number
}

export class SplitCancelled extends Error {
  constructor() {
    super('Stopped')
    this.name = 'SplitCancelled'
  }
}

export type SeparateOptions = {
  model: string
  quality: QualityId
  device: DeviceChoice
  stems: StemId[]
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function fetchSeparateHealth(): Promise<SeparateHealth> {
  try {
    const res = await fetch('/api/separate/health')
    return (await res.json()) as SeparateHealth
  } catch {
    return { ok: false, cuda: false, error: 'Helper offline' }
  }
}

function stripAnsi(text: string) {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 27) {
      out += text[i]
      continue
    }
    if (text[i + 1] === '[') {
      i += 2
      while (i < text.length && text.charCodeAt(i) < 64) i++
    }
  }
  return out
}

function cleanMessage(message: string) {
  const text = stripAnsi(message).trim()
  if (!text || text.includes('%|') || text.includes('#')) return 'Separating audio'
  return text.length > 90 ? `${text.slice(0, 90)}…` : text
}

export async function cancelSeparate(jobId: string) {
  await fetch(`/api/separate/${jobId}/cancel`, { method: 'POST' })
}

async function pollJob(jobId: string, onProgress?: (update: SeparateUpdate) => void): Promise<void> {
  while (true) {
    const res = await fetch(`/api/separate/${jobId}`)
    if (!res.ok) {
      let message = `Status check failed (${res.status})`
      try {
        const data = (await res.json()) as { error?: string }
        if (data.error) message = data.error
      } catch {
        /* ignore malformed body */
      }
      throw new Error(message)
    }

    const data = (await res.json()) as SeparateStatus
    onProgress?.({
      message: cleanMessage(data.message || data.status),
      percent: typeof data.percent === 'number' ? data.percent : 20,
    })

    if (data.status === 'done') return
    if (data.status === 'cancelled') throw new SplitCancelled()
    if (data.status === 'error') {
      throw new Error(data.error || data.message || 'Stem separation failed.')
    }

    await sleep(700)
  }
}

export async function separateStems(
  wav: ArrayBuffer,
  options: SeparateOptions,
  onProgress?: (update: SeparateUpdate) => void,
  onJob?: (jobId: string) => void,
): Promise<SeparatedStems> {
  onProgress?.({ message: 'Uploading audio…', percent: 6 })
  const params = new URLSearchParams({
    model: options.model,
    quality: options.quality,
    device: options.device,
    stems: options.stems.join(','),
  })
  const res = await fetch(`/api/separate?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: wav,
  })

  if (!res.ok && res.status !== 202) {
    let message = `Stem split failed (${res.status})`
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      /* ignore malformed body */
    }
    throw new Error(message)
  }

  const payload = (await res.json()) as { jobId: string; message?: string }
  if (!payload.jobId) throw new Error('Helper did not return a job id. Restart Mainer.')
  onJob?.(payload.jobId)

  onProgress?.({ message: 'Separating audio', percent: 12 })
  await pollJob(payload.jobId, onProgress)

  onProgress?.({ message: 'Downloading stems…', percent: 92 })
  const out: SeparatedStems = {}
  await Promise.all(
    options.stems.map(async (id) => {
      const stemRes = await fetch(`/api/stems/${payload.jobId}/${id}`)
      if (!stemRes.ok) throw new Error(`Missing stem: ${id}`)
      out[id] = await stemRes.arrayBuffer()
    }),
  )
  onProgress?.({ message: 'Stems ready', percent: 96 })
  return out
}
