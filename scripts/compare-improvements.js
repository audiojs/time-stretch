/**
 * Compare before/after for 3 quality improvements:
 * 1. SMS tracking: greedy vs cost-weighted vs Hungarian
 * 2. SMS residual: with/without temporal smoothing
 * 3. PSOLA streaming: WSOLA fallback vs true segment-based PSOLA
 */
import { fft, ifft } from 'fourier-transform'
import { hannWindow, clamp, normalize, PI2 } from '../util.js'
import psola from '../psola.js'
import wsola from '../wsola.js'

let fs = 44100

// ═══════════════════════════════════════════════
// Signal generators
// ═══════════════════════════════════════════════
function sine(freq, dur) {
  let n = Math.round(dur * fs)
  let d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = Math.sin(PI2 * freq * i / fs) * 0.8
  return d
}

function chord(freqs, dur) {
  let n = Math.round(dur * fs)
  let d = new Float32Array(n)
  let amp = 0.72 / freqs.length
  for (let i = 0; i < n; i++) for (let f of freqs) d[i] += Math.sin(PI2 * f * i / fs) * amp
  return d
}

function crossingSines(f1, f2, dur) {
  // Two sines that cross in frequency — worst case for tracking
  let n = Math.round(dur * fs)
  let d = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let t = i / fs
    let freq1 = f1 + (f2 - f1) * t / dur
    let freq2 = f2 + (f1 - f2) * t / dur
    d[i] = 0.5 * Math.sin(PI2 * freq1 * t) + 0.5 * Math.sin(PI2 * freq2 * t)
  }
  return d
}

function vowel(freq, dur) {
  let n = Math.round(dur * fs)
  let data = new Float32Array(n)
  let formants = [700, 1200, 2500]
  let bw = [80, 120, 160]
  for (let h = 1; h <= 30; h++) {
    let hf = freq * h
    if (hf > fs / 2) break
    let amp = 0
    for (let i = 0; i < formants.length; i++) amp += Math.exp(-0.5 * ((hf - formants[i]) / bw[i]) ** 2)
    amp = amp * 0.3 / h
    for (let s = 0; s < n; s++) data[s] += Math.sin(PI2 * hf * s / fs) * amp
  }
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[i]))
  if (peak > 0) for (let i = 0; i < n; i++) data[i] *= 0.8 / peak
  return data
}

function noise(dur) {
  let n = Math.round(dur * fs), seed = 0x1234
  let d = new Float32Array(n)
  for (let i = 0; i < n; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = (seed / 0x100000000 - 0.5) * 0.6 }
  return d
}

// ═══════════════════════════════════════════════
// SMS core — duplicated here to swap tracking
// ═══════════════════════════════════════════════
function createNoiseState(seed = 0x12345678) { return { seed: seed >>> 0 } }
function nextNoisePhase(s) { s.seed = (s.seed * 1664525 + 1013904223) >>> 0; return s.seed / 0x100000000 * PI2 }

function smoothResidual(mag, half, width) {
  let out = new Float64Array(half + 1)
  for (let k = 0; k <= half; k++) {
    let sum = 0, ws = 0, lo = Math.max(0, k - width), hi = Math.min(half, k + width)
    for (let j = lo; j <= hi; j++) { let w = width + 1 - Math.abs(j - k); sum += mag[j] * w; ws += w }
    out[k] = ws ? sum / ws : 0
  }
  return out
}

function residualEnvelope(mag, peaks, half, nTracks) {
  let r = new Float64Array(half + 1)
  r.set(mag)
  let count = Math.min(nTracks, peaks.length)
  for (let i = 0; i < count; i++) {
    let peak = peaks[i], radius = 3.5
    let lo = Math.max(1, Math.floor(peak.bin - radius)), hi = Math.min(half - 1, Math.ceil(peak.bin + radius))
    for (let k = lo; k <= hi; k++) { let w = Math.max(0, 1 - Math.abs(k - peak.bin) / radius); r[k] = Math.max(0, r[k] - peak.mag * w) }
  }
  r[0] = 0; if (half > 0) r[half] *= 0.5
  return smoothResidual(r, half, 4)
}

function detectPeaks(mag, half, thresh) {
  let out = []
  for (let k = 2; k < half - 1; k++) {
    if (mag[k] <= mag[k - 1] || mag[k] <= mag[k + 1] || mag[k] < thresh) continue
    let a = mag[k - 1], b = mag[k], c = mag[k + 1], d = a - 2 * b + c
    let p = d ? 0.5 * (a - c) / d : 0
    out.push({ bin: k + p, mag: b - 0.25 * (a - c) * p })
  }
  out.sort((a, b) => b.mag - a.mag)
  return out
}

function emptyTracks(n) { let t = new Array(n); for (let i = 0; i < n; i++) t[i] = { bin: 0, mag: 0 }; return t }

// ═══════════════════════════════════════════════
// 3 tracking strategies
// ═══════════════════════════════════════════════
function trackGreedy(prev, curr, n, maxDev) {
  let out = new Array(n)
  for (let i = 0; i < n; i++) out[i] = { bin: 0, mag: 0 }
  let taken = new Set()
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
  let empty = [], e = 0
  for (let i = 0; i < n; i++) if (!out[i].bin) empty.push(i)
  for (let i = 0; i < curr.length && e < empty.length; i++) if (!taken.has(i)) out[empty[e++]] = curr[i]
  return out
}

function trackCostWeighted(prev, curr, n, maxDev) {
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
  for (let { t, p } of pairs) { if (assigned[t] || taken[p]) continue; out[t] = curr[p]; assigned[t] = 1; taken[p] = 1 }
  let empty = [], e = 0
  for (let i = 0; i < n; i++) if (!assigned[i]) empty.push(i)
  for (let j = 0; j < curr.length && e < empty.length; j++) if (!taken[j]) out[empty[e++]] = curr[j]
  return out
}

// Kuhn-Munkres (Hungarian) for optimal assignment
function trackHungarian(prev, curr, n, maxDev) {
  let out = new Array(n)
  for (let i = 0; i < n; i++) out[i] = { bin: 0, mag: 0 }

  // active tracks with valid prev bins
  let activeT = []
  for (let i = 0; i < n; i++) if (prev[i].bin) activeT.push(i)
  if (!activeT.length || !curr.length) {
    let e = 0
    for (let i = 0; i < n && e < curr.length; i++) out[i] = curr[e++]
    return out
  }

  let m = activeT.length, k = curr.length
  let BIG = 1e9

  // cost matrix: rows = active tracks, cols = candidate peaks
  let cost = new Array(m)
  for (let r = 0; r < m; r++) {
    cost[r] = new Float64Array(k)
    let ti = activeT[r]
    for (let c = 0; c < k; c++) {
      let fd = Math.abs(curr[c].bin - prev[ti].bin)
      if (fd >= maxDev) { cost[r][c] = BIG; continue }
      let mr = prev[ti].mag > 1e-10 ? curr[c].mag / prev[ti].mag : 1
      cost[r][c] = fd / maxDev + 0.25 * Math.abs(Math.log(clamp(mr, 0.01, 100)))
    }
  }

  // Pad to square matrix
  let sz = Math.max(m, k)
  let C = new Array(sz)
  for (let r = 0; r < sz; r++) {
    C[r] = new Float64Array(sz)
    if (r < m) {
      C[r].set(cost[r])
      for (let c = k; c < sz; c++) C[r][c] = BIG
    } else {
      C[r].fill(BIG)
    }
  }

  // Hungarian algorithm (Kuhn-Munkres)
  let u = new Float64Array(sz + 1)
  let v = new Float64Array(sz + 1)
  let p = new Int32Array(sz + 1)  // column assignment
  let way = new Int32Array(sz + 1)

  for (let i = 1; i <= sz; i++) {
    p[0] = i
    let j0 = 0
    let minv = new Float64Array(sz + 1).fill(Infinity)
    let used = new Uint8Array(sz + 1)

    do {
      used[j0] = 1
      let i0 = p[j0], delta = Infinity, j1 = 0
      for (let j = 1; j <= sz; j++) {
        if (used[j]) continue
        let cur = C[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0 }
        if (minv[j] < delta) { delta = minv[j]; j1 = j }
      }
      for (let j = 0; j <= sz; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta }
        else minv[j] -= delta
      }
      j0 = j1
    } while (p[j0])

    do { let j1 = way[j0]; p[j0] = p[j1]; j0 = j1 } while (j0)
  }

  // Extract assignment
  let taken = new Uint8Array(k)
  let assigned = new Uint8Array(n)
  for (let j = 1; j <= sz; j++) {
    if (!p[j] || p[j] - 1 >= m) continue
    let ti = activeT[p[j] - 1]
    let ci = j - 1
    if (ci >= k) continue
    if (C[p[j] - 1][ci] >= BIG * 0.5) continue // no valid match
    out[ti] = curr[ci]
    assigned[ti] = 1
    taken[ci] = 1
  }

  // Birth
  let empty = [], e = 0
  for (let i = 0; i < n; i++) if (!assigned[i]) empty.push(i)
  for (let j = 0; j < k && e < empty.length; j++) if (!taken[j]) out[empty[e++]] = curr[j]
  return out
}

// ═══════════════════════════════════════════════
// SMS engine parameterized by tracking fn + residual smoothing
// ═══════════════════════════════════════════════
function smsWithOptions(data, factor, trackFn, temporalSmooth) {
  let N = 2048, hop = N >> 2, half = N >> 1
  let nTracks = 60, thresh = 1e-4, maxDev = 3
  let win = hannWindow(N)
  let noiseState = createNoiseState()

  let nAna = Math.max(1, Math.floor((data.length - N) / hop) + 1)
  let frames = new Array(nAna)
  let prev = emptyTracks(nTracks)
  let prevResidual = null
  for (let f = 0; f < nAna; f++) {
    let buf = new Float64Array(N)
    for (let i = 0; i < N; i++) buf[i] = (data[f * hop + i] || 0) * win[i]
    let [re, im] = fft(buf)
    let mag = new Float64Array(half + 1)
    for (let k = 0; k <= half; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
    let peaks = detectPeaks(mag, half, thresh)
    let tracks = trackFn(prev, peaks, nTracks, maxDev)
    let residual = residualEnvelope(mag, peaks, half, nTracks)
    if (temporalSmooth && prevResidual) for (let k = 0; k <= half; k++) residual[k] = 0.7 * residual[k] + 0.3 * prevResidual[k]
    frames[f] = { tracks, residual }
    prev = tracks
    prevResidual = residual
  }

  let outLen = Math.round(data.length * factor)
  let out = new Float32Array(outLen), nrm = new Float32Array(outLen)
  let phi = new Float64Array(nTracks)

  for (let s = 0; ; s++) {
    let sPos = s * hop
    if (sPos + N > outLen) break
    let af = Math.min(s / factor, nAna - 1), f0 = Math.floor(af), f1 = Math.min(f0 + 1, nAna - 1), alpha = af - f0

    let re = new Float64Array(half + 1), im2 = new Float64Array(half + 1)
    let dphi = PI2 * hop / N
    for (let i = 0; i < nTracks; i++) {
      let b0 = frames[f0].tracks[i].bin, m0 = frames[f0].tracks[i].mag
      let b1 = frames[f1].tracks[i].bin, m1 = frames[f1].tracks[i].mag
      if (!b0 && !b1) continue
      let bin, mag
      if (!b0) { bin = b1; mag = m1 * alpha }
      else if (!b1) { bin = b0; mag = m0 * (1 - alpha) }
      else { bin = b0 + (b1 - b0) * alpha; mag = m0 + (m1 - m0) * alpha }
      phi[i] += bin * dphi
      let k = Math.round(bin)
      if (k > 0 && k < half) { re[k] += 2 * mag * Math.cos(phi[i]); im2[k] += 2 * mag * Math.sin(phi[i]) }
    }
    for (let k = 1; k < half; k++) {
      let resMag = (frames[f0].residual[k] + (frames[f1].residual[k] - frames[f0].residual[k]) * alpha)
      if (resMag <= 1e-8) continue
      let ph = nextNoisePhase(noiseState)
      re[k] += 2 * resMag * Math.cos(ph); im2[k] += 2 * resMag * Math.sin(ph)
    }
    let frame = ifft(re, im2)
    for (let i = 0; i < N && sPos + i < outLen; i++) { let w2 = win[i] * win[i]; out[sPos + i] += frame[i] * w2; nrm[sPos + i] += w2 }
  }

  normalize(out, nrm)
  return out
}

// ═══════════════════════════════════════════════
// Metric functions
// ═══════════════════════════════════════════════
function rms(data) { let s = 0; for (let i = 0; i < data.length; i++) s += data[i] * data[i]; return Math.sqrt(s / Math.max(1, data.length)) }

function peakFreq(data) {
  let crossings = 0
  for (let i = 1; i < data.length; i++) if (data[i - 1] <= 0 && data[i] > 0) crossings++
  return crossings * fs / data.length
}

function spectralCentroid(data, N = 2048) {
  let half = N >> 1, win = hannWindow(N)
  let frames = 0, sumCentroid = 0
  for (let pos = 0; pos + N <= data.length; pos += (N >> 2)) {
    let buf = new Float64Array(N)
    for (let i = 0; i < N; i++) buf[i] = data[pos + i] * win[i]
    let [re, im] = fft(buf)
    let totalE = 0, weightedE = 0
    for (let k = 1; k <= half; k++) {
      let e = re[k] * re[k] + im[k] * im[k]
      totalE += e
      weightedE += e * k
    }
    if (totalE > 1e-10) { sumCentroid += weightedE / totalE; frames++ }
  }
  return frames ? sumCentroid / frames * fs / N : 0
}

// Track stability: count births + deaths across all frames
function trackStability(data, trackFn) {
  let N = 2048, hop = N >> 2, half = N >> 1
  let nTracks = 60, thresh = 1e-4, maxDev = 3, win = hannWindow(N)
  let nAna = Math.max(1, Math.floor((data.length - N) / hop) + 1)
  let prev = emptyTracks(nTracks), births = 0, deaths = 0

  for (let f = 0; f < nAna; f++) {
    let buf = new Float64Array(N)
    for (let i = 0; i < N; i++) buf[i] = (data[f * hop + i] || 0) * win[i]
    let [re, im] = fft(buf)
    let mag = new Float64Array(half + 1)
    for (let k = 0; k <= half; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
    let peaks = detectPeaks(mag, half, thresh)
    let tracks = trackFn(prev, peaks, nTracks, maxDev)
    if (f > 0) {
      for (let i = 0; i < nTracks; i++) {
        if (prev[i].bin && !tracks[i].bin) deaths++
        if (!prev[i].bin && tracks[i].bin) births++
      }
    }
    prev = tracks
  }
  return { births, deaths, total: births + deaths, frames: nAna }
}

// Residual energy variance across frames
function residualVariance(data, temporalSmooth) {
  let N = 2048, hop = N >> 2, half = N >> 1
  let nTracks = 60, thresh = 1e-4, maxDev = 3, win = hannWindow(N)
  let nAna = Math.max(1, Math.floor((data.length - N) / hop) + 1)
  let prev = emptyTracks(nTracks), prevResidual = null
  let energies = []

  for (let f = 0; f < nAna; f++) {
    let buf = new Float64Array(N)
    for (let i = 0; i < N; i++) buf[i] = (data[f * hop + i] || 0) * win[i]
    let [re, im] = fft(buf)
    let mag = new Float64Array(half + 1)
    for (let k = 0; k <= half; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
    let peaks = detectPeaks(mag, half, thresh)
    let tracks = trackCostWeighted(prev, peaks, nTracks, maxDev)
    let residual = residualEnvelope(mag, peaks, half, nTracks)
    if (temporalSmooth && prevResidual) for (let k = 0; k <= half; k++) residual[k] = 0.7 * residual[k] + 0.3 * prevResidual[k]
    let e = 0; for (let k = 0; k <= half; k++) e += residual[k] * residual[k]
    energies.push(e)
    prev = tracks; prevResidual = residual
  }

  let mean = energies.reduce((a, b) => a + b, 0) / Math.max(1, energies.length)
  let vari = 0; for (let e of energies) vari += (e - mean) ** 2
  return { mean, variance: vari / Math.max(1, energies.length), stddev: Math.sqrt(vari / Math.max(1, energies.length)) }
}

// ═══════════════════════════════════════════════
// Comparison tests
// ═══════════════════════════════════════════════
console.log('════════════════════════════════════════════════════════')
console.log('  Before/After Quality Comparison')
console.log('════════════════════════════════════════════════════════\n')

let signals = [
  ['sine 440Hz', sine(440, 1)],
  ['chord C-E-G', chord([261.6, 329.6, 392], 1)],
  ['crossing sines 300↔600Hz', crossingSines(300, 600, 1)],
  ['vowel "ah" 150Hz', vowel(150, 1)],
  ['noise', noise(1)],
]

// ─── 1. SMS TRACKING ─────────────────────────────
console.log('┌─────────────────────────────────────────────────────┐')
console.log('│  1. SMS TRACKING: greedy → cost-weighted → Hungarian │')
console.log('└─────────────────────────────────────────────────────┘\n')

let trackMethods = [
  ['greedy     ', trackGreedy],
  ['cost-weight', trackCostWeighted],
  ['hungarian  ', trackHungarian],
]

console.log('Track stability (births + deaths per frame):')
console.log('signal                      greedy   cost-wt  hung.    (lower = more stable)')
console.log('─'.repeat(78))

for (let [name, sig] of signals) {
  let cols = []
  for (let [, fn] of trackMethods) {
    let s = trackStability(sig, fn)
    cols.push((s.total / s.frames).toFixed(2).padStart(6))
  }
  console.log(`${name.padEnd(28)}${cols.join('   ')}`)
}

console.log('\nOutput quality (2x stretch, RMS + spectral centroid):')
console.log('signal                      method       RMS     centroid(Hz)  time(ms)')
console.log('─'.repeat(78))

for (let [name, sig] of signals) {
  for (let [mname, fn] of trackMethods) {
    let t0 = performance.now()
    let out = smsWithOptions(sig, 2, fn, true)
    let ms = (performance.now() - t0).toFixed(1)
    console.log(`${name.padEnd(28)}${mname}  ${rms(out).toFixed(4).padStart(7)}  ${spectralCentroid(out).toFixed(0).padStart(12)}  ${ms.padStart(8)}`)
  }
  console.log()
}

// ─── 2. RESIDUAL SMOOTHING ──────────────────────
console.log('┌─────────────────────────────────────────────────────┐')
console.log('│  2. SMS RESIDUAL: no smoothing → temporal smoothing  │')
console.log('└─────────────────────────────────────────────────────┘\n')

console.log('Residual energy frame-to-frame variance (lower = smoother):')
console.log('signal                      no-smooth     smoothed     reduction')
console.log('─'.repeat(78))

for (let [name, sig] of signals) {
  let raw = residualVariance(sig, false)
  let sm = residualVariance(sig, true)
  let reduction = raw.stddev > 1e-10 ? ((1 - sm.stddev / raw.stddev) * 100).toFixed(1) + '%' : 'n/a'
  console.log(`${name.padEnd(28)}${raw.stddev.toExponential(2).padStart(12)}  ${sm.stddev.toExponential(2).padStart(12)}  ${reduction.padStart(10)}`)
}

console.log('\nOutput quality — noise signal 2x stretch:')
for (let smooth of [false, true]) {
  let out = smsWithOptions(noise(1), 2, trackCostWeighted, smooth)
  console.log(`  smooth=${String(smooth).padEnd(6)} RMS=${rms(out).toFixed(4)}  centroid=${spectralCentroid(out).toFixed(0)}Hz`)
}

// ─── 3. PSOLA STREAMING ────────────────────────
console.log('\n┌─────────────────────────────────────────────────────┐')
console.log('│  3. PSOLA STREAMING: WSOLA fallback → true PSOLA     │')
console.log('└─────────────────────────────────────────────────────┘\n')

let psolaSignals = [
  ['sine 220Hz', sine(220, 1)],
  ['vowel "ah" 150Hz', vowel(150, 1)],
]

for (let [name, sig] of psolaSignals) {
  console.log(`${name}:`)

  // Batch (reference)
  let batch = psola(sig, { factor: 2, sampleRate: fs })
  let batchRms = rms(batch)

  // True PSOLA streaming (current)
  let write = psola({ factor: 2, sampleRate: fs })
  let chunks = []
  for (let i = 0; i < sig.length; i += 4096) {
    let c = write(sig.subarray(i, Math.min(i + 4096, sig.length)))
    if (c.length) chunks.push(c)
  }
  let tail = write()
  if (tail.length) chunks.push(tail)
  let streamLen = chunks.reduce((s, c) => s + c.length, 0)
  let stream = new Float32Array(streamLen)
  let off = 0; for (let c of chunks) { stream.set(c, off); off += c.length }

  // WSOLA streaming (old fallback)
  let wsolaWrite = wsola({ factor: 2 })
  let wchunks = []
  for (let i = 0; i < sig.length; i += 4096) {
    let c = wsolaWrite(sig.subarray(i, Math.min(i + 4096, sig.length)))
    if (c.length) wchunks.push(c)
  }
  let wtail = wsolaWrite()
  if (wtail.length) wchunks.push(wtail)
  let wLen = wchunks.reduce((s, c) => s + c.length, 0)
  let wstream = new Float32Array(wLen)
  off = 0; for (let c of wchunks) { wstream.set(c, off); off += c.length }

  let batchFreq = peakFreq(batch)
  let streamFreq = peakFreq(stream)
  let wsolaFreq = peakFreq(wstream)

  console.log(`  batch (ref)         RMS=${batchRms.toFixed(4)}  freq=${batchFreq.toFixed(0)}Hz  len=${batch.length}`)
  console.log(`  PSOLA stream (new)  RMS=${rms(stream).toFixed(4)}  freq=${streamFreq.toFixed(0)}Hz  len=${streamLen}  Δfreq=${Math.abs(streamFreq - batchFreq).toFixed(1)}Hz`)
  console.log(`  WSOLA stream (old)  RMS=${rms(wstream).toFixed(4)}  freq=${wsolaFreq.toFixed(0)}Hz  len=${wLen}  Δfreq=${Math.abs(wsolaFreq - batchFreq).toFixed(1)}Hz`)
  console.log()
}

console.log('════════════════════════════════════════════════════════')
console.log('  Done')
console.log('════════════════════════════════════════════════════════')
