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
  status: 'queued' | 'running' | 'done' | 'error'
  message: string
  error?: string
  stems?: StemId[]
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

async function pollJob(jobId: string, onProgress?: (message: string) => void): Promise<void> {
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
    onProgress?.(data.message || data.status)

    if (data.status === 'done') return
    if (data.status === 'error') {
      throw new Error(data.error || data.message || 'Stem separation failed.')
    }

    await sleep(1500)
  }
}

export async function separateStems(
  wav: ArrayBuffer,
  options: SeparateOptions,
  onProgress?: (message: string) => void,
): Promise<SeparatedStems> {
  onProgress?.('Uploading audio…')
  const params = new URLSearchParams({
    model: options.model,
    quality: options.quality,
    device: options.device,
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

  onProgress?.(payload.message || 'Separation started…')
  await pollJob(payload.jobId, onProgress)

  onProgress?.('Downloading stem files…')
  const out: SeparatedStems = {}
  await Promise.all(
    options.stems.map(async (id) => {
      const stemRes = await fetch(`/api/stems/${payload.jobId}/${id}`)
      if (!stemRes.ok) throw new Error(`Missing stem: ${id}`)
      out[id] = await stemRes.arrayBuffer()
    }),
  )
  onProgress?.('Stems ready')
  return out
}
