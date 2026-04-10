import { stftBatch, stftStream } from './stft.js'
import { writer } from './util.js'

function createRandom(seed) {
  let value = (seed >>> 0) || 1
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

function randomize(mag, phase, state, ctx) {
  let rand = state.rand || (state.rand = createRandom(state.seed ?? 0x1f123bb5))
  let p = new Float64Array(ctx.half + 1)
  for (let k = 0; k <= ctx.half; k++) p[k] = rand() * Math.PI * 2
  return { mag, phase: p }
}

export default function paulstretch(data, opts) {
  if (!(data instanceof Float32Array)) {
    opts = data
    let factor = opts?.factor ?? 8
    let frameSize = opts?.frameSize || 4096
    let synHop = frameSize >> 1
    let seed = opts?.seed ?? 0x1f123bb5
    return writer(stftStream((mag, phase, state, ctx) => {
      state.seed ??= seed
      return randomize(mag, phase, state, ctx)
    }, { factor, frameSize, synHop, anaHop: synHop / factor }))
  }
  let factor = opts?.factor ?? 8
  if (factor <= 1) return new Float32Array(data)
  let frameSize = opts?.frameSize || 4096
  let synHop = frameSize >> 1
  let seed = opts?.seed ?? 0x1f123bb5
  return stftBatch(data, (mag, phase, state, ctx) => {
    state.seed ??= seed
    return randomize(mag, phase, state, ctx)
  }, {
    factor, frameSize, synHop,
    anaHop: synHop / factor
  })
}
