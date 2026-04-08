import { stftBatch, stftStream } from './stft.js'
import { wrapPhase, findPeaks } from './util.js'

function lock(mag, phase, state, ctx) {
  let { half, anaHop, synHop, freqPerBin } = ctx
  if (!state.prev) {
    state.prev = new Float64Array(half + 1)
    state.synPrev = new Float64Array(half + 1)
    state.first = true
  }
  let p = new Float64Array(half + 1)
  if (state.first) {
    p.set(phase)
    state.first = false
  } else {
    for (let k = 0; k <= half; k++) {
      let dp = wrapPhase(phase[k] - state.prev[k] - k * freqPerBin * anaHop)
      p[k] = state.synPrev[k] + (k * freqPerBin + dp / anaHop) * synHop
    }
    let peaks = findPeaks(mag, half)
    for (let k = 0; k <= half; k++) {
      if (peaks[k]) continue
      let lo = k, hi = k
      while (lo > 0 && !peaks[lo]) lo--
      while (hi <= half && !peaks[hi]) hi++
      let pk = (k - lo <= hi - k || hi > half) ? lo : hi
      if (!peaks[pk]) continue
      p[k] = phase[k] + (p[pk] - phase[pk])
    }
  }
  state.prev.set(phase)
  state.synPrev.set(p)
  return { mag, phase: p }
}

export default function phaseLock(data, opts) {
  if ((opts?.factor ?? 1) === 1) return new Float32Array(data)
  return stftBatch(data, lock, opts)
}

phaseLock.stream = function (opts) {
  return stftStream(lock, opts)
}
