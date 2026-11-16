/**
 * Turn Demucs console output into one forward-moving percent.
 * Demucs prints a fresh bar for every pass, so a raw line jumps back to 0%.
 */
function stripAnsi(text) {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 27) {
      out += text[i]
      continue
    }
    if (text[i + 1] === '[') {
      i += 2
      while (i < text.length && text.charCodeAt(i) < 64) i++
    }
  }
  return out
}

export function createDemucsProgress(shifts, modelId) {
  const shiftPasses = Math.max(1, Number(shifts) || 0)
  const state = {
    shiftPasses,
    passTotal: (modelId === 'htdemucs_ft' ? 4 : 1) * shiftPasses,
    passesDone: 0,
    lastRatio: 0,
    percent: 18,
    message: 'Separating audio',
  }
  let carry = ''

  function ingest(line) {
    const bag = line.match(/bag of (\d+) models/i)
    if (bag) {
      state.passTotal = Math.max(1, Number(bag[1])) * state.shiftPasses
      return true
    }
    if (/download/i.test(line) && !line.includes('%|')) {
      state.message = 'Downloading the model…'
      return true
    }
    if (/separating track/i.test(line)) {
      state.message = state.passTotal > 1 ? `Separating audio, pass 1 of ${state.passTotal}` : 'Separating audio'
      return true
    }

    const bar = line.match(/^\s*(\d+(?:\.\d+)?)%\|/)
    const frac = line.match(/([\d.]+)\/([\d.]+)\s*\[/)
    if (!bar && !frac) return false

    let ratio = bar ? Number(bar[1]) / 100 : Number(frac[1]) / Number(frac[2])
    if (!Number.isFinite(ratio)) return false
    ratio = Math.max(0, Math.min(1, ratio))
    if (ratio < 0.12 && state.lastRatio > 0.72) {
      state.passesDone = Math.min(state.passTotal - 1, state.passesDone + 1)
    }
    state.lastRatio = ratio
    const overall = (state.passesDone + ratio) / state.passTotal
    const percent = Math.round(18 + overall * 70)
    state.percent = Math.max(state.percent, Math.min(88, percent))
    state.message =
      state.passTotal > 1
        ? `Separating audio, pass ${state.passesDone + 1} of ${state.passTotal}`
        : 'Separating audio'
    return true
  }

  function take(text) {
    carry += stripAnsi(String(text))
    const parts = carry.split(/\r|\n/)
    const tail = parts.pop() ?? ''
    carry = ''
    for (const part of parts) {
      const line = part.trim()
      if (line) ingest(line)
    }
    const live = tail.trim()
    if (!live) return
    if (live.includes('%|') || /bag of|separating track|download/i.test(live)) ingest(live)
    else carry = tail
  }

  return {
    push(text) {
      take(text)
      return { message: state.message, percent: state.percent }
    },
  }
}
