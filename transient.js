import { stftBatch, stftStream } from './stft.js'
import { wrapPhase, lockPhase } from './util.js'

function detect(threshold) {
  return function (mag, phase, state, ctx) {
    let { half, anaHop, synHop, freqPerBin } = ctx
    if (!state.prev) {
      state.prev = new Float64Array(half + 1)
      state.synPrev = new Float64Array(half + 1)
      state.prevMag = new Float64Array(half + 1)
      state.first = true
    }

    let isTransient = false
    if (!state.first) {
      let flux = 0, energy = 0
      for (let k = 0; k <= half; k++) {
        let d = mag[k] - state.prevMag[k]
        if (d > 0) flux += d
        energy += mag[k]
      }
      if (energy > 1e-10) isTransient = (flux / energy) > threshold
    }

    let p = new Float64Array(half + 1)
    if (state.first || isTransient) {
      p.set(phase)
      state.first = false
    } else {
      for (let k = 0; k <= half; k++) {
        let dp = wrapPhase(phase[k] - state.prev[k] - k * freqPerBin * anaHop)
        p[k] = state.synPrev[k] + (k * freqPerBin + dp / anaHop) * synHop
      }
      lockPhase(phase, p, mag, half)
    }
    state.prev.set(phase)
    state.synPrev.set(p)
    state.prevMag.set(mag)
    return { mag, phase: p }
  }
}

export default function transient(data, opts) {
  if ((opts?.factor ?? 1) === 1) return new Float32Array(data)
  return stftBatch(data, detect(opts?.transientThreshold ?? 1.5), opts)
}

transient.stream = function (opts) {
  return stftStream(detect(opts?.transientThreshold ?? 1.5), opts)
}
