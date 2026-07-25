import { spawn } from 'node:child_process'
import process from 'node:process'

const children = []
let shuttingDown = false

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

start(process.execPath, ['server/fetch-youtube.mjs'], 'api')
start(process.execPath, ['./node_modules/vite/bin/vite.js', '--host'], 'web')

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) killTree(c)
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
