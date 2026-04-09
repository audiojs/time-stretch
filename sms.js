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
import { hannWindow, PI2 } from './util.js'

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

// Greedy sinusoidal tracking: match current peaks to previous tracks by frequency proximity
function trackPeaks(prev, curr, n, maxDev) {
  let out = new Array(n)
  for (let i = 0; i < n; i++) out[i] = { bin: 0, mag: 0 }
  let taken = new Set()

  // Continue existing tracks (match by proximity)
  for (let i = 0; i < n; i++) {
    if (!prev[i].bin) continue
    let best = -1, bestD = Infinity
    for (let j = 0; j < curr.length; j++) {
      if (taken.has(j)) continue
      let d = Math.abs(curr[j].bin - prev[i].bin)
      if (d < maxDev && d < bestD) { bestD = d; best = j }
    }
    if (best >= 0) { out[i] = curr[best]; taken.add(best) }
  }

  // Birth: assign remaining peaks to empty slots
  let empty = []
  for (let i = 0; i < n; i++) if (!out[i].bin) empty.push(i)
  let e = 0
  for (let i = 0; i < curr.length && e < empty.length; i++) {
    if (!taken.has(i)) out[empty[e++]] = curr[i]
  }
  return out
}

function emptyTracks(n) {
  let t = new Array(n)
  for (let i = 0; i < n; i++) t[i] = { bin: 0, mag: 0 }
  return t
}

function analyzeFrame(data, pos, win, N, half, thresh, prev, nTracks, maxDev) {
  let buf = new Float64Array(N)
  for (let i = 0; i < N; i++) buf[i] = (data[pos + i] || 0) * win[i]
  let [re, im] = fft(buf)
  let mag = new Float64Array(half + 1)
  for (let k = 0; k <= half; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
  return trackPeaks(prev, detectPeaks(mag, half, thresh), nTracks, maxDev)
}

// Build synthesis spectrum from interpolated tracks, IFFT to time domain
function synthFrame(t0, t1, alpha, nTracks, phi, half, N, hop) {
  let re = new Float64Array(half + 1)
  let im = new Float64Array(half + 1)
  let dphi = PI2 * hop / N

  for (let i = 0; i < nTracks; i++) {
    let b0 = t0[i].bin, m0 = t0[i].mag
    let b1 = t1[i].bin, m1 = t1[i].mag
    if (!b0 && !b1) continue

    let bin, mag
    if (!b0) { bin = b1; mag = m1 * alpha }             // birth: fade in
    else if (!b1) { bin = b0; mag = m0 * (1 - alpha) }  // death: fade out
    else { bin = b0 + (b1 - b0) * alpha; mag = m0 + (m1 - m0) * alpha }

    phi[i] += bin * dphi
    let k = Math.round(bin)
    if (k > 0 && k < half) {
      re[k] += 2 * mag * Math.cos(phi[i])
      im[k] += 2 * mag * Math.sin(phi[i])
    }
  }
  return ifft(re, im)
}

export default function sms(data, opts = {}) {
  if (!(data instanceof Float32Array)) {
    let s = smsStream(data)
    return (chunk) => chunk ? s.write(chunk) : s.flush()
  }

  let factor = opts.factor ?? 1
  let N = opts.frameSize ?? 2048
  let hop = opts.hopSize ?? (N >> 2)
  let half = N >> 1
  let nTracks = opts.maxTracks ?? 60
  let thresh = opts.minMag ?? 1e-4
  let maxDev = opts.freqDev ?? 3
  let win = hannWindow(N)

  if (factor === 1) return new Float32Array(data)

  // Analysis pass: detect and track sinusoidal partials
  let nAna = Math.max(1, Math.floor((data.length - N) / hop) + 1)
  let frames = new Array(nAna)
  let prev = emptyTracks(nTracks)
  for (let f = 0; f < nAna; f++) {
    frames[f] = prev = analyzeFrame(data, f * hop, win, N, half, thresh, prev, nTracks, maxDev)
  }

  // Synthesis pass: resynthesize at new time rate
  let outLen = Math.round(data.length * factor)
  let out = new Float32Array(outLen)
  let nrm = new Float32Array(outLen)
  let phi = new Float64Array(nTracks)

  for (let s = 0; ; s++) {
    let sPos = s * hop
    if (sPos + N > outLen) break

    let af = Math.min(s / factor, nAna - 1)
    let f0 = Math.floor(af)
    let f1 = Math.min(f0 + 1, nAna - 1)
    let alpha = af - f0

    let frame = synthFrame(frames[f0], frames[f1], alpha, nTracks, phi, half, N, hop)
    for (let i = 0; i < N && sPos + i < outLen; i++) {
      let w2 = win[i] * win[i]
      out[sPos + i] += frame[i] * w2
      nrm[sPos + i] += w2
    }
  }

  for (let i = 0; i < outLen; i++) if (nrm[i] > 1e-8) out[i] /= nrm[i]
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
  let win = hannWindow(N)

  let inBuf = new Float32Array(N * 4)
  let inLen = 0
  let outBuf = new Float32Array(N * 8)
  let nrmBuf = new Float32Array(N * 8)
  let sPos = 0, oRead = 0

  let prevTracks = emptyTracks(nTracks)
  let currTracks = null
  let phi = new Float64Array(nTracks)
  let anaIdx = 0, synIdx = 0
  let anaPos = 0 // samples consumed from inBuf

  function growOut(need) {
    if (need <= outBuf.length) return
    let len = Math.max(need * 2, outBuf.length * 2)
    let ob = new Float32Array(len), nb = new Float32Array(len)
    ob.set(outBuf); nb.set(nrmBuf)
    outBuf = ob; nrmBuf = nb
  }

  function emitSynth() {
    if (anaIdx < 2) return // need at least 2 analysis frames

    while (synIdx / factor < anaIdx - 1) {
      let af = synIdx / factor
      let alpha = af - (anaIdx - 2)
      growOut(sPos + N)

      let frame = synthFrame(prevTracks, currTracks, alpha, nTracks, phi, half, N, hop)
      for (let i = 0; i < N && sPos + i < outBuf.length; i++) {
        let w2 = win[i] * win[i]
        outBuf[sPos + i] += frame[i] * w2
        nrmBuf[sPos + i] += w2
      }
      sPos += hop
      synIdx++
    }
  }

  function processInput() {
    while (anaPos + N <= inLen) {
      let tracks = analyzeFrame(inBuf, anaPos, win, N, half, thresh,
        anaIdx > 0 ? currTracks || prevTracks : prevTracks, nTracks, maxDev)

      prevTracks = currTracks || emptyTracks(nTracks)
      currTracks = tracks
      anaIdx++
      anaPos += hop

      emitSynth()
    }

    // Compact input buffer
    if (anaPos > N * 2) {
      let trim = anaPos - N
      inBuf.copyWithin(0, trim, inLen)
      inLen -= trim
      anaPos -= trim
    }
  }

  function take(upTo) {
    upTo = Math.min(upTo, sPos)
    if (upTo <= oRead) return new Float32Array(0)
    let len = Math.floor(upTo - oRead)
    let out = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      let j = oRead + i
      out[i] = nrmBuf[j] > 1e-8 ? outBuf[j] / nrmBuf[j] : 0
    }
    oRead += len
    if (oRead > N * 8) {
      let shift = oRead
      outBuf.copyWithin(0, shift)
      nrmBuf.copyWithin(0, shift)
      sPos -= shift
      oRead = 0
      outBuf.fill(0, sPos)
      nrmBuf.fill(0, sPos)
    }
    return out
  }

  return {
    write(chunk) {
      let need = inLen + chunk.length
      if (need > inBuf.length) {
        let nb = new Float32Array(Math.max(need * 2, inBuf.length * 2))
        nb.set(inBuf.subarray(0, inLen))
        inBuf = nb
      }
      inBuf.set(chunk, inLen)
      inLen += chunk.length
      processInput()
      return take(Math.max(0, sPos - N + hop))
    },
    flush() {
      // Emit remaining synthesis frames for the last analysis pair
      if (anaIdx >= 2) {
        while (synIdx / factor < anaIdx - 1 + 1) {
          let af = Math.min(synIdx / factor, anaIdx - 1)
          let alpha = Math.min(af - (anaIdx - 2), 1)
          growOut(sPos + N)
          let frame = synthFrame(prevTracks, currTracks, alpha, nTracks, phi, half, N, hop)
          for (let i = 0; i < N && sPos + i < outBuf.length; i++) {
            let w2 = win[i] * win[i]
            outBuf[sPos + i] += frame[i] * w2
            nrmBuf[sPos + i] += w2
          }
          sPos += hop
          synIdx++
        }
      }
      return take(sPos)
    }
  }
}
