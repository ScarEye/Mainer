import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const PORTS = [5173, 8787]

function pidsListeningOnPort(port) {
  const pids = new Set()
  if (process.platform === 'win32') {
    let out = ''
    try {
      out = execSync('netstat -ano', { encoding: 'utf8', windowsHide: true })
    } catch {
      return pids
    }
    const re = new RegExp(`:${port}\\s`)
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue
      if (!re.test(line)) continue
      const parts = line.trim().split(/\s+/)
      const pid = parts[parts.length - 1]
      if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid)
    }
  } else {
    try {
      const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8' })
      for (const pid of out.split(/\s+/)) {
        if (/^\d+$/.test(pid)) pids.add(pid)
      }
    } catch {
      /* nothing listening */
    }
  }
  return pids
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true })
    } else {
      execSync(`kill -9 ${pid}`, { stdio: 'ignore' })
    }
    return true
  } catch {
    return false
  }
}

/** Kill whatever is LISTENING on Mainer ports so a fresh start never hits EADDRINUSE. */
export function killMainerPorts(ports = PORTS) {
  const killed = []
  for (const port of ports) {
    for (const pid of pidsListeningOnPort(port)) {
      if (killPid(pid)) killed.push({ port, pid })
    }
  }
  return killed
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (isMain) {
  const killed = killMainerPorts()
  if (killed.length === 0) {
    console.log(`No listeners on ports ${PORTS.join(', ')}`)
  } else {
    for (const k of killed) console.log(`Stopped PID ${k.pid} (port ${k.port})`)
  }
}
