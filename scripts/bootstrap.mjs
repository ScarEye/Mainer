import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STAMP = 'mainer-py-2'
const venvDir = path.join(root, '.venv')
const stampPath = path.join(venvDir, '.mainer-ready')

function venvPython() {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      windowsHide: true,
      ...opts,
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${path.basename(cmd)} exited with ${code}`))
    })
  })
}

function capture(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true })
    let out = ''
    child.stdout?.on('data', (d) => {
      out += d.toString()
    })
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      if (code !== 0) resolve(null)
      else resolve(out.trim().split(/\r?\n/).filter(Boolean).pop() || null)
    })
  })
}

function hasNvidia() {
  return new Promise((resolve) => {
    const child = spawn('nvidia-smi', ['-L'], { windowsHide: true, stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

async function findBasePython() {
  const candidates =
    process.platform === 'win32'
      ? [
          ['py', ['-3']],
          ['python', []],
        ]
      : [
          ['python3', []],
          ['python', []],
        ]

  for (const [cmd, prefix] of candidates) {
    const line = await capture(cmd, [
      ...prefix,
      '-c',
      'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}|{sys.executable}")',
    ])
    if (!line || !line.includes('|')) continue
    const [version, exe] = line.split('|')
    const [major, minor] = version.split('.').map(Number)
    if (!exe || major < 3 || minor < 10) continue
    if (exe.toLowerCase().includes('windowsapps')) continue
    return exe
  }
  return null
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

async function installBundledPython() {
  if (process.platform !== 'win32') return null
  const destDir = path.join(root, '.tools', 'python')
  const exe = path.join(destDir, 'python.exe')
  if (existsSync(exe)) return exe

  mkdirSync(path.join(root, '.tools'), { recursive: true })
  const installer = path.join(root, '.tools', 'python-3.12.10-amd64.exe')
  console.log('Python 3.10+ was not found. Downloading Python 3.12…')
  await download('https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe', installer)
  console.log('Installing Python into .tools (this does not change system PATH)…')
  await run(installer, [
    '/quiet',
    'InstallAllUsers=0',
    'PrependPath=0',
    'Include_test=0',
    'Include_doc=0',
    'Include_launcher=0',
    'Shortcuts=0',
    `TargetDir=${destDir}`,
  ])
  if (!existsSync(exe)) throw new Error('Python setup finished without python.exe.')
  return exe
}

async function pip(py, args) {
  await run(py, ['-m', 'pip', 'install', '--disable-pip-version-check', ...args], {
    env: { ...process.env, PYTHONUNBUFFERED: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1' },
  })
}

async function installTorch(py, gpu, force = false) {
  const indexes = gpu
    ? [
        'https://download.pytorch.org/whl/cu130',
        'https://download.pytorch.org/whl/cu128',
        'https://download.pytorch.org/whl/cu126',
      ]
    : ['https://download.pytorch.org/whl/cpu']
  let lastError = null
  for (const index of indexes) {
    try {
      console.log(`Installing PyTorch from ${index}…`)
      const args = ['torch', 'torchaudio', '--index-url', index, '--timeout', '180', '--retries', '8']
      if (force) args.unshift('--force-reinstall')
      await pip(py, args)
      return
    } catch (err) {
      lastError = err
      console.log(err instanceof Error ? err.message : err)
    }
  }
  throw lastError || new Error('PyTorch install failed.')
}

export async function bootstrap() {
  const gpu = await hasNvidia()
  let flavor = gpu ? 'cuda' : 'cpu'
  if (existsSync(stampPath) && existsSync(venvPython())) {
    const stamp = readFileSync(stampPath, 'utf8').trim()
    if (stamp === `${STAMP}|${flavor}`) {
      console.log(gpu ? 'Local audio tools ready (NVIDIA GPU).' : 'Local audio tools ready (CPU).')
      return
    }
  }

  console.log('Preparing local audio tools. The first run downloads PyTorch and can take a while.')
  const base = (await findBasePython()) || (await installBundledPython())
  if (!base) {
    throw new Error(
      'Python 3.10+ is required. Install it from https://www.python.org/downloads/ and run Mainer again.',
    )
  }

  if (!existsSync(venvPython())) {
    console.log('Creating a local Python environment…')
    await run(base, ['-m', 'venv', venvDir])
  }
  const py = venvPython()

  try {
    await installTorch(py, gpu)
  } catch (err) {
    if (!gpu) throw err
    console.log('CUDA PyTorch did not install. Continuing with the CPU build.')
    console.log(err instanceof Error ? err.message : err)
    flavor = 'cpu'
    await installTorch(py, false)
  }

  await pip(py, ['demucs', 'yt-dlp', 'imageio-ffmpeg', 'numpy'])

  if (flavor === 'cuda') {
    const cuda = await capture(py, ['-c', 'import torch; print("yes" if torch.cuda.is_available() else "no")'])
    if (cuda !== 'yes') {
      console.log('PyTorch is not using the GPU. Reinstalling the CUDA build…')
      await installTorch(py, true, true)
      const again = await capture(py, ['-c', 'import torch; print("yes" if torch.cuda.is_available() else "no")'])
      if (again !== 'yes') {
        console.log('GPU build still unavailable. Splits can run on CPU.')
        flavor = 'cpu'
      }
    }
  }

  writeFileSync(stampPath, `${STAMP}|${flavor}\n`)
  console.log(flavor === 'cuda' ? 'Audio tools installed with GPU support.' : 'Audio tools installed for CPU.')
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirect) {
  bootstrap().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
