import { spawn } from 'node:child_process'
import process from 'node:process'

const children = []

function start(command, args, name) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
    // Avoid shell:true — Windows can still run node/npx via PATHEXT.
  })
  child.on('error', (err) => {
    console.error(`[${name}] failed to start:`, err)
    process.exit(1)
  })
  child.on('exit', (code, signal) => {
    if (signal) console.log(`[${name}] killed (${signal})`)
    else console.log(`[${name}] exited (${code ?? 'null'})`)
    for (const c of children) {
      if (c !== child && !c.killed) c.kill()
    }
    process.exit(code ?? 1)
  })
  children.push(child)
}

start(process.execPath, ['server/fetch-youtube.mjs'], 'api')
start(process.execPath, ['./node_modules/vite/bin/vite.js', '--host'], 'web')

function shutdown() {
  for (const c of children) {
    if (!c.killed) c.kill()
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
