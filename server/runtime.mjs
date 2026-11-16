import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const rootDir = path.resolve(__dirname, '..')

export function pythonPath() {
  const win = path.join(rootDir, '.venv', 'Scripts', 'python.exe')
  const nix = path.join(rootDir, '.venv', 'bin', 'python')
  if (existsSync(win)) return win
  if (existsSync(nix)) return nix
  return process.platform === 'win32' ? 'python' : 'python3'
}

export function run(cmd, args, opts = {}) {
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
      else reject(new Error(stderr.trim() || stdout.trim() || `${path.basename(cmd)} exited with ${code}`))
    })
  })
}

let ffmpegPromise = null

export function ffmpegExe() {
  if (!ffmpegPromise) {
    ffmpegPromise = run(pythonPath(), [
      '-c',
      'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())',
    ])
      .then(({ stdout }) => stdout.trim().split(/\r?\n/).pop() || null)
      .catch(() => null)
  }
  return ffmpegPromise
}
