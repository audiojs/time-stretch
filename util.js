import { hann } from 'window-function'

const PI2 = Math.PI * 2

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

// Wrap { write, flush } stream into single callable: write(chunk) → process, write() → flush
export function writer(s) {
  return (chunk) => chunk ? s.write(chunk) : s.flush()
}

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
  if (half <= 1) {
    peaks[0] = 1
    if (half === 1) peaks[1] = 1
    return peaks
  }

  let maxMag = 0
  for (let k = 0; k <= half; k++) if (mag[k] > maxMag) maxMag = mag[k]

  let minMag = Math.max(1e-8, maxMag * 0.015)
  let minProm = Math.max(1e-9, maxMag * 0.003)
  let lastPeak = -2
  let lastPeakMag = 0

  for (let k = 1; k < half; k++) {
    let value = mag[k]
    if (value < minMag || value < mag[k - 1] || value < mag[k + 1]) continue

    let shoulder = Math.max(
      mag[k - 1],
      mag[k + 1],
      k > 1 ? mag[k - 2] : 0,
      k + 2 <= half ? mag[k + 2] : 0,
    )
    let prominent = value - shoulder >= minProm || value >= maxMag * 0.1
    if (!prominent) continue

    if (k - lastPeak <= 1) {
      if (value > lastPeakMag) {
        peaks[lastPeak] = 0
        peaks[k] = 1
        lastPeak = k
        lastPeakMag = value
      }
      continue
    }

    peaks[k] = 1
    lastPeak = k
    lastPeakMag = value
  }

  let found = false
  for (let k = 0; k <= half; k++) {
    if (peaks[k]) {
      found = true
      break
    }
  }

  if (!found) {
    let best = 0
    for (let k = 1; k <= half; k++) if (mag[k] > mag[best]) best = k
    peaks[best] = 1
  }

  return peaks
}

export function lockPhase(phase, propPhase, mag, half) {
  let peaks = findPeaks(mag, half)
  let peakBins = []
  for (let k = 0; k <= half; k++) if (peaks[k]) peakBins.push(k)
  if (!peakBins.length) return

  for (let i = 0; i < peakBins.length; i++) {
    let pk = peakBins[i]
    let start = i === 0 ? 0 : Math.floor((peakBins[i - 1] + pk) * 0.5) + 1
    let end = i === peakBins.length - 1 ? half : Math.floor((pk + peakBins[i + 1]) * 0.5)
    let delta = propPhase[pk] - phase[pk]
    let lockFloor = Math.max(1e-10, mag[pk] * 0.03)

    for (let k = start; k <= end; k++) {
      if (k === pk || mag[k] < lockFloor) continue
      propPhase[k] = phase[k] + delta
    }
  }
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
