import { stftBatch, stftStream } from './stft.js'
import { wrapPhase, writer } from './util.js'

// Spectral envelope via moving average of magnitude
// Simpler and more numerically stable than cepstral method
function smoothEnv(mag, half, width) {
  let env = new Float64Array(half + 1)
  for (let k = 0; k <= half; k++) {
    let sum = 0, lo = Math.max(0, k - width), hi = Math.min(half, k + width)
    for (let j = lo; j <= hi; j++) sum += mag[j]
    env[k] = sum / (hi - lo + 1)
  }
  return env
}

function makeShift(ratio, envWidth) {
  return function (mag, phase, state, ctx) {
    let { half, anaHop, synHop, freqPerBin } = ctx
    if (!state.prev) {
      state.prev = new Float64Array(half + 1)
      state.synPrev = new Float64Array(half + 1)
      state.first = true
    }

    let env = smoothEnv(mag, half, envWidth)
    let outMag = new Float64Array(half + 1)
    let outPhase = new Float64Array(half + 1)

    for (let k = 0; k <= half; k++) {
      let src = k / ratio
      let lo = Math.floor(src), frac = src - lo, hi = lo + 1
      if (lo < 0 || lo > half) continue

      // interpolate source magnitude and envelope
      let srcMag = mag[lo] * (1 - frac) + (hi <= half ? mag[hi] * frac : 0)
      let srcEnv = env[lo] * (1 - frac) + (hi <= half ? env[hi] * frac : 0)

      // fine structure at source, applied with original envelope at target
      outMag[k] = srcEnv > 1e-10 ? env[k] * srcMag / srcEnv : 0

      // phase: propagate instantaneous frequency scaled by ratio
      if (state.first) {
        outPhase[k] = phase[lo]
      } else {
        let dp = wrapPhase(phase[lo] - state.prev[lo] - lo * freqPerBin * anaHop)
        outPhase[k] = state.synPrev[k] + (lo * freqPerBin + dp / anaHop) * ratio * synHop
      }
    }

    if (state.first) state.first = false
    state.prev.set(phase)
    state.synPrev.set(outPhase)
    return { mag: outMag, phase: outPhase }
  }
}

export default function formantShift(data, opts) {
  if (!(data instanceof Float32Array)) {
    opts = data
    let semitones = opts?.semitones ?? 0
    let ratio = opts?.ratio ?? (semitones ? Math.pow(2, semitones / 12) : 1)
    let N = opts?.frameSize || 2048
    let width = opts?.envelopeWidth || Math.round(N / 64)
    return writer(stftStream(makeShift(ratio, width), { ...opts, factor: 1 }))
  }
  let semitones = opts?.semitones ?? 0
  let ratio = opts?.ratio ?? (semitones ? Math.pow(2, semitones / 12) : 1)
  if (ratio === 1) return new Float32Array(data)
  let N = opts?.frameSize || 2048
  let width = opts?.envelopeWidth || Math.round(N / 64)
  return stftBatch(data, makeShift(ratio, width), { ...opts, factor: 1 })
}
