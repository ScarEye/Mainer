import { spawn } from 'node:child_process'
import process from 'node:process'
import { killMainerPorts } from './kill-ports.mjs'

const children = []
let shuttingDown = false

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function killTree(child) {
  if (!child || child.killed) return
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  } else {
    try {
      child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
  }
}

function start(command, args, name) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
  })
  child.on('error', (err) => {
    console.error(`[${name}] failed to start:`, err)
    if (!shuttingDown) process.exit(1)
  })
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    if (signal) console.log(`[${name}] killed (${signal})`)
    else console.log(`[${name}] exited (${code ?? 'null'})`)
    shuttingDown = true
    for (const c of children) {
      if (c !== child) killTree(c)
    }
    process.exit(code ?? 1)
  })
  children.push(child)
}

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) killTree(c)
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

console.log('Clearing ports 5173 (web) and 8787 (API)…')
const killed = killMainerPorts()
if (killed.length) {
  for (const k of killed) console.log(`  stopped PID ${k.pid} on :${k.port}`)
  await sleep(800)
} else {
  console.log('  ports were free')
}

console.log('Starting API + Vite…')
start(process.execPath, ['server/fetch-youtube.mjs'], 'api')
start(process.execPath, ['./node_modules/vite/bin/vite.js', '--host'], 'web')
console.log('Open http://localhost:5173/')
