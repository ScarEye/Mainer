import { useRef, useState, type DragEvent, type ChangeEvent } from 'react'

type Props = {
  disabled?: boolean
  onFile: (file: File) => void
}

export function UploadDropzone({ disabled, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const take = (file: File | undefined | null) => {
    if (!file || disabled) return
    if (!/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(file.name) && !file.type.startsWith('audio/')) {
      alert('Please upload an audio file (MP3, WAV, etc.).')
      return
    }
    onFile(file)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    take(e.dataTransfer.files?.[0])
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    take(e.target.files?.[0])
    e.target.value = ''
  }

  return (
    <div
      className={`dropzone ${dragOver ? 'dropzone--active' : ''} ${disabled ? 'dropzone--disabled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
        hidden
        onChange={onChange}
      />
      <p className="dropzone__title">Drop a track to practice</p>
      <p className="dropzone__hint">MP3, WAV, OGG, M4A — analyzed locally in your browser</p>
    </div>
  )
}
