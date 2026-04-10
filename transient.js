import { stftBatch, stftStream } from './stft.js'
import { wrapPhase, lockPhase, writer } from './util.js'

function updateFluxStats(state, value, alpha) {
  if (state.fluxMean == null) {
    state.fluxMean = value
    state.fluxVar = 0
    return
  }

  let delta = value - state.fluxMean
  state.fluxMean += alpha * delta
  state.fluxVar = (1 - alpha) * (state.fluxVar + alpha * delta * delta)
}

function detect(threshold) {
  return function (mag, phase, state, ctx) {
    let { half, anaHop, synHop, freqPerBin } = ctx
    if (!state.prev) {
      state.prev = new Float64Array(half + 1)
      state.synPrev = new Float64Array(half + 1)
      state.prevMag = new Float64Array(half + 1)
      state.first = true
      state.frames = 0
      state.cooldown = 0
    }

    let isTransient = false
    if (!state.first) {
      let flux = 0, energy = 0
      for (let k = 0; k <= half; k++) {
        let weight = 0.5 + 0.5 * k / Math.max(1, half)
        let d = Math.log1p(mag[k]) - Math.log1p(state.prevMag[k])
        if (d > 0) flux += d
        energy += weight * Math.log1p(mag[k])
      }

      let normFlux = energy > 1e-10 ? flux / energy : 0
      let mean = state.fluxMean ?? normFlux
      let std = Math.sqrt(state.fluxVar ?? 0)
      let adaptive = state.frames > 4 && state.cooldown === 0 && normFlux > mean + threshold * Math.max(0.02, std) && normFlux > mean * 1.35

      isTransient = adaptive
      updateFluxStats(state, normFlux, adaptive ? 0.3 : 0.12)
      state.cooldown = adaptive ? 1 : Math.max(0, state.cooldown - 1)
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
    state.frames++
    return { mag, phase: p }
  }
}

export default function transient(data, opts) {
  let fn = detect(opts?.transientThreshold ?? data?.transientThreshold ?? 1.5)
  if (!(data instanceof Float32Array)) return writer(stftStream(fn, data))
  if ((opts?.factor ?? 1) === 1) return new Float32Array(data)
  return stftBatch(data, fn, opts)
}
