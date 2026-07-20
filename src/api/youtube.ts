export async function fetchYoutubeTrack(url: string): Promise<{ arrayBuffer: ArrayBuffer; title: string }> {
  let res: Response
  try {
    res = await fetch('/api/youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
  } catch {
    throw new Error(
      'Could not reach the local helper. Make sure Vite and the API are running (npm run dev), then refresh.',
    )
  }

  if (!res.ok) {
    let message = `YouTube fetch failed (${res.status})`
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      /* ignore */
    }
    if (res.status === 404 || res.status === 502) {
      message += ' — restart with npm run dev so the YouTube helper is up.'
    }
    throw new Error(message)
  }

  const titleHeader = res.headers.get('X-Track-Title')
  const title = titleHeader ? decodeURIComponent(titleHeader) : 'YouTube track'
  const arrayBuffer = await res.arrayBuffer()
  if (!arrayBuffer.byteLength) {
    throw new Error('YouTube helper returned empty audio.')
  }
  return { arrayBuffer, title }
}
