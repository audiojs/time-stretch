// Phase vocoder with optional phase locking (lock: true) and
// transient-aware resetting (transients: true, implies lock).
import { stftBatch, stftStream, wrapPhase } from './stft.js'
import { writer } from './util.js'

function findPeaks(mag, half) {
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
  let lastPeak = -2, lastPeakMag = 0

  for (let k = 1; k < half; k++) {
    let value = mag[k]
    if (value < minMag || value < mag[k - 1] || value < mag[k + 1]) continue

    let shoulder = Math.max(mag[k - 1], mag[k + 1], k > 1 ? mag[k - 2] : 0, k + 2 <= half ? mag[k + 2] : 0)
    if (value - shoulder < minProm && value < maxMag * 0.1) continue

    if (k - lastPeak <= 1) {
      if (value > lastPeakMag) { peaks[lastPeak] = 0; peaks[k] = 1; lastPeak = k; lastPeakMag = value }
      continue
    }
    peaks[k] = 1; lastPeak = k; lastPeakMag = value
  }

  let found = false
  for (let k = 0; k <= half; k++) if (peaks[k]) { found = true; break }
  if (!found) {
    let best = 0
    for (let k = 1; k <= half; k++) if (mag[k] > mag[best]) best = k
    peaks[best] = 1
  }
  return peaks
}

function lockPhase(phase, propPhase, mag, half) {
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

function updateFluxStats(state, value, alpha) {
  if (state.fluxMean == null) { state.fluxMean = value; state.fluxVar = 0; return }
  let delta = value - state.fluxMean
  state.fluxMean += alpha * delta
  state.fluxVar = (1 - alpha) * (state.fluxVar + alpha * delta * delta)
}

function makeProcess(lock, transients, threshold) {
  let doLock = lock || transients

  return function (mag, phase, state, ctx) {
    let { half, anaHop, synHop, freqPerBin } = ctx

    if (!state.prev) {
      state.prev = new Float64Array(half + 1)
      state.first = true
      if (doLock) state.synPrev = new Float64Array(half + 1)
      else state.sum = new Float64Array(half + 1)
      if (transients) {
        state.prevMag = new Float64Array(half + 1)
        state.frames = 0
        state.cooldown = 0
      }
    }

    let isTransient = false
    if (transients && !state.first) {
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
      isTransient = state.frames > 4 && state.cooldown === 0 &&
        normFlux > mean + threshold * Math.max(0.02, std) && normFlux > mean * 1.35
      updateFluxStats(state, normFlux, isTransient ? 0.3 : 0.12)
      state.cooldown = isTransient ? 1 : Math.max(0, state.cooldown - 1)
    }

    let p = new Float64Array(half + 1)
    if (state.first || isTransient) {
      p.set(phase)
      if (!doLock) state.sum.set(phase)
      state.first = false
    } else {
      for (let k = 0; k <= half; k++) {
        let dp = wrapPhase(phase[k] - state.prev[k] - k * freqPerBin * anaHop)
        let adv = (k * freqPerBin + dp / anaHop) * synHop
        if (doLock) p[k] = state.synPrev[k] + adv
        else { state.sum[k] += adv; p[k] = state.sum[k] }
      }
      if (doLock) lockPhase(phase, p, mag, half)
    }

    state.prev.set(phase)
    if (doLock) state.synPrev.set(p)
    if (transients) { state.prevMag.set(mag); state.frames++ }
    return { mag, phase: p }
  }
}

export default function vocoder(data, opts) {
  let lock = opts?.lock ?? false
  let transients = opts?.transients ?? false
  let threshold = opts?.transientThreshold ?? data?.transientThreshold ?? 1.5
  let fn = makeProcess(lock, transients, threshold)
  if (!(data instanceof Float32Array)) return writer(stftStream(fn, data))
  if ((opts?.factor ?? 1) === 1) return new Float32Array(data)
  return stftBatch(data, fn, opts)
}
