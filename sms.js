// sms.js — Sinusoidal Modeling Synthesis time stretching
// Tracks individual sinusoidal partials across frames, resynthesizes at new rate.
// Each harmonic is independently controlled — no phase spreading or bin-by-bin artifacts.
//
// References:
// - Serra, X. (1989). "A System for Sound Analysis/Transformation/Synthesis
//   Based on a Deterministic plus Stochastic Decomposition." PhD thesis, Stanford.
// - McAulay, R.J. & Quatieri, T.F. (1986). "Speech analysis/synthesis based on
//   a sinusoidal representation." IEEE Trans. ASSP, 34(4).

import { fft, ifft } from 'fourier-transform'
import { hannWindow, clamp, normalize, writer, makeStreamBufs, PI2 } from './util.js'

function createNoiseState(seed = 0x12345678) {
  return { seed: seed >>> 0 }
}

function nextNoisePhase(state) {
  state.seed = (state.seed * 1664525 + 1013904223) >>> 0
  return state.seed / 0x100000000 * PI2
}

function smoothResidual(mag, half, width) {
  let out = new Float64Array(half + 1)
  for (let k = 0; k <= half; k++) {
    let sum = 0, weightSum = 0
    let start = Math.max(0, k - width), end = Math.min(half, k + width)
    for (let j = start; j <= end; j++) {
      let weight = width + 1 - Math.abs(j - k)
      sum += mag[j] * weight; weightSum += weight
    }
    out[k] = weightSum ? sum / weightSum : 0
  }
  return out
}

function residualEnvelope(mag, peaks, half, nTracks) {
  let residual = new Float64Array(half + 1)
  residual.set(mag)

  let count = Math.min(nTracks, peaks.length)
  for (let i = 0; i < count; i++) {
    let peak = peaks[i], radius = 3.5
    let start = Math.max(1, Math.floor(peak.bin - radius))
    let end = Math.min(half - 1, Math.ceil(peak.bin + radius))
    for (let k = start; k <= end; k++) {
      let weight = Math.max(0, 1 - Math.abs(k - peak.bin) / radius)
      residual[k] = Math.max(0, residual[k] - peak.mag * weight)
    }
  }

  residual[0] = 0
  if (half > 0) residual[half] *= 0.5
  return smoothResidual(residual, half, 4)
}

// Spectral peak detection with parabolic interpolation for sub-bin accuracy
function detectPeaks(mag, half, thresh) {
  let out = []
  for (let k = 2; k < half - 1; k++) {
    if (mag[k] <= mag[k - 1] || mag[k] <= mag[k + 1] || mag[k] < thresh) continue
    let a = mag[k - 1], b = mag[k], c = mag[k + 1]
    let d = a - 2 * b + c
    let p = d ? 0.5 * (a - c) / d : 0
    out.push({ bin: k + p, mag: b - 0.25 * (a - c) * p })
  }
  out.sort((a, b) => b.mag - a.mag)
  return out
}

// Cost-weighted sinusoidal tracking: sorted assignment by frequency + magnitude continuity
function trackPeaks(prev, curr, n, maxDev) {
  let out = new Array(n)
  for (let i = 0; i < n; i++) out[i] = { bin: 0, mag: 0 }

  let pairs = []
  for (let i = 0; i < n; i++) {
    if (!prev[i].bin) continue
    for (let j = 0; j < curr.length; j++) {
      let fd = Math.abs(curr[j].bin - prev[i].bin)
      if (fd >= maxDev) continue
      let mr = prev[i].mag > 1e-10 ? curr[j].mag / prev[i].mag : 1
      pairs.push({ t: i, p: j, c: fd / maxDev + 0.25 * Math.abs(Math.log(clamp(mr, 0.01, 100))) })
    }
  }
  pairs.sort((a, b) => a.c - b.c)

  let taken = new Uint8Array(curr.length), assigned = new Uint8Array(n)
  for (let { t, p } of pairs) {
    if (assigned[t] || taken[p]) continue
    out[t] = curr[p]; assigned[t] = 1; taken[p] = 1
  }

  let empty = []
  for (let i = 0; i < n; i++) if (!assigned[i]) empty.push(i)
  let e = 0
  for (let j = 0; j < curr.length && e < empty.length; j++) {
    if (!taken[j]) out[empty[e++]] = curr[j]
  }
  return out
}

function emptyTracks(n) {
  let t = new Array(n)
  for (let i = 0; i < n; i++) t[i] = { bin: 0, mag: 0 }
  return t
}

function analyzeFrame(data, pos, win, N, half, thresh, prev, nTracks, maxDev, prevResidual) {
  let buf = new Float64Array(N)
  for (let i = 0; i < N; i++) buf[i] = (data[pos + i] || 0) * win[i]
  let [re, im] = fft(buf)
  let mag = new Float64Array(half + 1)
  for (let k = 0; k <= half; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])

  let peaks = detectPeaks(mag, half, thresh)
  let tracks = trackPeaks(prev, peaks, nTracks, maxDev)

  let residual = residualEnvelope(mag, peaks, half, nTracks)
  if (prevResidual) for (let k = 0; k <= half; k++) residual[k] = 0.7 * residual[k] + 0.3 * prevResidual[k]
  return { tracks, residual }
}

// Build synthesis spectrum from interpolated tracks, IFFT to time domain
function synthFrame(t0, t1, r0, r1, alpha, nTracks, phi, half, N, hop, noiseState, residualMix) {
  let re = new Float64Array(half + 1), im = new Float64Array(half + 1)
  let dphi = PI2 * hop / N

  for (let i = 0; i < nTracks; i++) {
    let b0 = t0[i].bin, m0 = t0[i].mag, b1 = t1[i].bin, m1 = t1[i].mag
    if (!b0 && !b1) continue

    let bin, mag
    if (!b0) { bin = b1; mag = m1 * alpha }
    else if (!b1) { bin = b0; mag = m0 * (1 - alpha) }
    else { bin = b0 + (b1 - b0) * alpha; mag = m0 + (m1 - m0) * alpha }

    phi[i] += bin * dphi
    let k = Math.round(bin)
    if (k > 0 && k < half) {
      re[k] += 2 * mag * Math.cos(phi[i])
      im[k] += 2 * mag * Math.sin(phi[i])
    }
  }

  if (residualMix > 0) {
    for (let k = 1; k < half; k++) {
      let resMag = (r0[k] + (r1[k] - r0[k]) * alpha) * residualMix
      if (resMag <= 1e-8) continue
      let phase = nextNoisePhase(noiseState)
      re[k] += 2 * resMag * Math.cos(phase)
      im[k] += 2 * resMag * Math.sin(phase)
    }
  }

  return ifft(re, im)
}

export default function sms(data, opts = {}) {
  if (!(data instanceof Float32Array)) return writer(smsStream(data))

  let factor = opts.factor ?? 1
  let N = opts.frameSize ?? 2048
  let hop = opts.hopSize ?? (N >> 2)
  let half = N >> 1
  let nTracks = opts.maxTracks ?? 60
  let thresh = opts.minMag ?? 1e-4
  let maxDev = opts.freqDev ?? 3
  let residualMix = clamp(opts.residualMix ?? 1, 0, 1)
  let win = hannWindow(N)
  let noiseState = createNoiseState()

  if (factor === 1) return new Float32Array(data)

  // Analysis pass
  let nAna = Math.max(1, Math.floor((data.length - N) / hop) + 1)
  let frames = new Array(nAna)
  let prev = emptyTracks(nTracks), prevResidual = null
  for (let f = 0; f < nAna; f++) {
    let analyzed = analyzeFrame(data, f * hop, win, N, half, thresh, prev, nTracks, maxDev, prevResidual)
    frames[f] = analyzed; prev = analyzed.tracks; prevResidual = analyzed.residual
  }

  // Synthesis pass
  let outLen = Math.round(data.length * factor)
  let out = new Float32Array(outLen), nrm = new Float32Array(outLen)
  let phi = new Float64Array(nTracks)

  for (let s = 0; ; s++) {
    let sPos = s * hop
    if (sPos + N > outLen) break
    let af = Math.min(s / factor, nAna - 1)
    let f0 = Math.floor(af), f1 = Math.min(f0 + 1, nAna - 1), alpha = af - f0
    let fr = synthFrame(frames[f0].tracks, frames[f1].tracks, frames[f0].residual, frames[f1].residual, alpha, nTracks, phi, half, N, hop, noiseState, residualMix)
    for (let i = 0; i < N && sPos + i < outLen; i++) {
      let w2 = win[i] * win[i]
      out[sPos + i] += fr[i] * w2; nrm[sPos + i] += w2
    }
  }

  normalize(out, nrm)
  return out
}

function smsStream(opts = {}) {
  let factor = opts.factor ?? 1
  let N = opts.frameSize ?? 2048
  let hop = opts.hopSize ?? (N >> 2)
  let half = N >> 1
  let nTracks = opts.maxTracks ?? 60
  let thresh = opts.minMag ?? 1e-4
  let maxDev = opts.freqDev ?? 3
  let residualMix = clamp(opts.residualMix ?? 1, 0, 1)
  let win = hannWindow(N)
  let noiseState = createNoiseState()

  let st = makeStreamBufs(N)
  let prevFrame = { tracks: emptyTracks(nTracks), residual: new Float64Array(half + 1) }
  let currFrame = null
  let phi = new Float64Array(nTracks)
  let anaIdx = 0, synIdx = 0, anaPos = 0

  function emitSynth() {
    if (anaIdx < 2) return
    while (synIdx / factor < anaIdx - 1) {
      let af = synIdx / factor
      let alpha = af - (anaIdx - 2)
      st.growOut(st.pos + N)
      let ob = st.ob, nb = st.nb, base = st.pos
      let fr = synthFrame(prevFrame.tracks, currFrame.tracks, prevFrame.residual, currFrame.residual, alpha, nTracks, phi, half, N, hop, noiseState, residualMix)
      for (let i = 0; i < N && base + i < ob.length; i++) {
        let w2 = win[i] * win[i]; ob[base + i] += fr[i] * w2; nb[base + i] += w2
      }
      st.pos += hop; synIdx++
    }
  }

  function processInput() {
    while (anaPos + N <= st.il) {
      let analyzed = analyzeFrame(st.ib, anaPos, win, N, half, thresh,
        anaIdx > 0 ? (currFrame?.tracks || prevFrame.tracks) : prevFrame.tracks,
        nTracks, maxDev, currFrame?.residual || prevFrame.residual)
      prevFrame = currFrame || prevFrame; currFrame = analyzed
      anaIdx++; anaPos += hop
      emitSynth()
    }
    if (anaPos > N * 2) { let trim = anaPos - N; st.compactIn(trim); anaPos -= trim }
  }

  return {
    write(chunk) {
      st.appendIn(chunk)
      processInput()
      return st.take(Math.max(0, st.pos - N + hop))
    },
    flush() {
      if (anaIdx >= 2 && currFrame) {
        while (synIdx / factor < anaIdx - 1 + 1) {
          let af = Math.min(synIdx / factor, anaIdx - 1)
          let alpha = Math.min(af - (anaIdx - 2), 1)
          st.growOut(st.pos + N)
          let ob = st.ob, nb = st.nb, base = st.pos
          let fr = synthFrame(prevFrame.tracks, currFrame.tracks, prevFrame.residual, currFrame.residual, alpha, nTracks, phi, half, N, hop, noiseState, residualMix)
          for (let i = 0; i < N && base + i < ob.length; i++) {
            let w2 = win[i] * win[i]; ob[base + i] += fr[i] * w2; nb[base + i] += w2
          }
          st.pos += hop; synIdx++
        }
      }
      return st.take(st.pos)
    }
  }
}
