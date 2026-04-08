import { stftBatch, stftStream } from './stft.js'
import { wrapPhase } from './util.js'

function advance(mag, phase, state, ctx) {
  let { half, anaHop, synHop, freqPerBin } = ctx
  if (!state.prev) {
    state.prev = new Float64Array(half + 1)
    state.sum = new Float64Array(half + 1)
    state.first = true
  }
  let p = new Float64Array(half + 1)
  if (state.first) {
    p.set(phase)
    state.sum.set(phase)
    state.first = false
  } else {
    for (let k = 0; k <= half; k++) {
      let dp = wrapPhase(phase[k] - state.prev[k] - k * freqPerBin * anaHop)
      state.sum[k] += (k * freqPerBin + dp / anaHop) * synHop
      p[k] = state.sum[k]
    }
  }
  state.prev.set(phase)
  return { mag, phase: p }
}

export default function vocoder(data, opts) {
  if ((opts?.factor ?? 1) === 1) return new Float32Array(data)
  return stftBatch(data, advance, opts)
}

vocoder.stream = function (opts) {
  return stftStream(advance, opts)
}
