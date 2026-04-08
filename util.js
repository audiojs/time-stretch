import { hann } from 'window-function'

const PI2 = Math.PI * 2

let _hannCache = new Map()
export function hannWindow(N) {
  if (_hannCache.has(N)) return _hannCache.get(N)
  let w = new Float64Array(N)
  for (let i = 0; i < N; i++) w[i] = hann(i, N)
  _hannCache.set(N, w)
  return w
}

export function normalize(out, norm) {
  for (let i = 0; i < out.length; i++) {
    if (norm[i] > 1e-8) out[i] /= norm[i]
  }
}

export function wrapPhase(p) {
  return p - Math.round(p / PI2) * PI2
}

export function findPeaks(mag, half) {
  let peaks = new Uint8Array(half + 1)
  if (mag[0] >= mag[1]) peaks[0] = 1
  if (mag[half] >= mag[half - 1]) peaks[half] = 1
  for (let k = 1; k < half; k++) {
    if (mag[k] >= mag[k - 1] && mag[k] >= mag[k + 1]) peaks[k] = 1
  }
  return peaks
}

export function resample(data, outLen) {
  let out = new Float32Array(outLen)
  let ratio = (data.length - 1) / (outLen - 1 || 1)
  for (let i = 0; i < outLen; i++) {
    let pos = i * ratio
    let idx = pos | 0
    let frac = pos - idx
    out[i] = data[idx] * (1 - frac) + (data[idx + 1] || 0) * frac
  }
  return out
}

export { PI2 }
