import { useState, type FormEvent } from 'react'

type Props = {
  disabled?: boolean
  onSubmitUrl: (url: string) => void
}

export function YoutubeImport({ disabled, onSubmitUrl }: Props) {
  const [url, setUrl] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed || disabled) return
    onSubmitUrl(trimmed)
  }

  return (
    <form className="yt-import" onSubmit={submit}>
      <label className="yt-import__label" htmlFor="yt-url">
        Or paste a YouTube link
      </label>
      <div className="yt-import__row">
        <input
          id="yt-url"
          className="yt-import__input"
          type="url"
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          disabled={disabled}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={disabled || !url.trim()}>
          Fetch
        </button>
      </div>
      <p className="yt-import__hint">Uses a local yt-dlp helper on your machine (personal use).</p>
    </form>
  )
}
