import { stftBatch, stftStream, writer } from './stft.js'

function randomize(mag, phase, state, ctx) {
  let p = new Float64Array(ctx.half + 1)
  for (let k = 0; k <= ctx.half; k++) p[k] = Math.random() * Math.PI * 2
  return { mag, phase: p }
}

export default function paulstretch(data, opts) {
  if (!(data instanceof Float32Array)) {
    opts = data
    let factor = opts?.factor ?? 8
    let frameSize = opts?.frameSize || 4096
    let synHop = frameSize >> 1
    return writer(stftStream(randomize, { factor, frameSize, synHop, anaHop: synHop / factor }))
  }
  let factor = opts?.factor ?? 8
  if (factor <= 1) return new Float32Array(data)
  let frameSize = opts?.frameSize || 4096
  let synHop = frameSize >> 1
  return stftBatch(data, randomize, {
    factor, frameSize, synHop,
    anaHop: synHop / factor
  })
}
