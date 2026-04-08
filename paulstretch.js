import { stftBatch, stftStream } from './stft.js'

function randomize(mag, phase, state, ctx) {
  let p = new Float64Array(ctx.half + 1)
  for (let k = 0; k <= ctx.half; k++) p[k] = Math.random() * Math.PI * 2
  return { mag, phase: p }
}

export default function paulstretch(data, opts) {
  let factor = opts?.factor ?? 8
  if (factor <= 1) return new Float32Array(data)
  let frameSize = opts?.frameSize || 4096
  let synHop = frameSize >> 1
  return stftBatch(data, randomize, {
    factor, frameSize, synHop,
    anaHop: synHop / factor
  })
}

paulstretch.stream = function (opts) {
  let factor = opts?.factor ?? 8
  let frameSize = opts?.frameSize || 4096
  let synHop = frameSize >> 1
  return stftStream(randomize, {
    factor, frameSize, synHop,
    anaHop: synHop / factor
  })
}
