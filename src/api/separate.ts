import type { StemId } from '../types/chart'
import { STEM_IDS } from '../types/chart'

export type SeparatedStems = Record<StemId, ArrayBuffer>

export type SeparateStatus = {
  jobId: string
  status: 'queued' | 'running' | 'done' | 'error'
  message: string
  error?: string
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function checkSeparateReady(): Promise<{ ok: boolean; demucs?: boolean; error?: string }> {
  try {
    const res = await fetch('/api/separate/health')
    return (await res.json()) as { ok: boolean; demucs?: boolean; error?: string }
  } catch {
    return { ok: false, error: 'Helper offline' }
  }
}

async function pollJob(
  jobId: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  const started = Date.now()
  const maxMs = 45 * 60 * 1000

  while (Date.now() - started < maxMs) {
    const res = await fetch(`/api/separate/${jobId}`)
    if (!res.ok) {
      let message = `Status check failed (${res.status})`
      try {
        const data = (await res.json()) as { error?: string }
        if (data.error) message = data.error
      } catch {
        /* ignore */
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

  throw new Error('Stem split timed out after 45 minutes.')
}

export async function separateStems(
  wav: ArrayBuffer,
  onProgress?: (message: string) => void,
): Promise<SeparatedStems> {
  onProgress?.('Uploading audio to local helper…')
  const res = await fetch('/api/separate', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: wav,
  })

  if (!res.ok && res.status !== 202) {
    let message = `YouTube fetch failed (${res.status})`.replace('YouTube fetch', 'Stem split')
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }

  const payload = (await res.json()) as { jobId: string; message?: string }
  if (!payload.jobId) throw new Error('Helper did not return a job id. Restart npm run dev.')

  onProgress?.(payload.message || 'Separation started…')
  await pollJob(payload.jobId, onProgress)

  onProgress?.('Downloading stem files…')
  const out = {} as SeparatedStems
  await Promise.all(
    STEM_IDS.map(async (id) => {
      const r = await fetch(`/api/stems/${payload.jobId}/${id}`)
      if (!r.ok) throw new Error(`Missing stem: ${id}`)
      out[id] = await r.arrayBuffer()
    }),
  )
  onProgress?.('Stems ready')
  return out
}
