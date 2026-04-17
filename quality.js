// Quality metrics for time-stretch/pitch-shift algorithms.
// Compare an algorithm's output against a reference signal via spectral
// distance — time-domain alignment is not required, only spectral content.

import { fft } from 'fourier-transform'
import { hannWindow } from './util.js'

// Frame-averaged log-spectral distance in dB. Lower is better.
// ~1 dB: transparent. 2–4 dB: audible colouration. >5 dB: degraded.
// Silent frames (below energy floor) are skipped so trailing zeros don't bias.
export function lsd(a, b, opts = {}) {
  let N = opts.frameSize || 1024
  let hop = opts.hopSize || (N >> 1)
  let trim = opts.trim ?? 0.1
  let floor = opts.floor ?? 1e-5

  let [x, y] = align(a, b, trim)
  let win = hannWindow(N)
  let half = N >> 1
  let mx = new Float64Array(half + 1), my = new Float64Array(half + 1)
  let sum = 0, frames = 0

  for (let pos = 0; pos + N <= x.length; pos += hop) {
    let ex = magFrame(x, pos, win, N, half, mx)
    let ey = magFrame(y, pos, win, N, half, my)
    if (ex < floor && ey < floor) continue

    // Per-frame peak-relative magnitude floor: prevents log amplification of
    // near-silent bins (critical for pure tones where one bin holds all energy).
    let peak = 0
    for (let k = 0; k <= half; k++) {
      if (mx[k] > peak) peak = mx[k]
      if (my[k] > peak) peak = my[k]
    }
    let mfloor = peak * 1e-3 + 1e-12

    let acc = 0
    for (let k = 0; k <= half; k++) {
      let d = 20 * Math.log10((mx[k] + mfloor) / (my[k] + mfloor))
      acc += d * d
    }
    sum += Math.sqrt(acc / (half + 1))
    frames++
  }
  return frames ? sum / frames : 0
}

// Frame-averaged cosine similarity of magnitude spectra. 1 = identical, 0 = orthogonal.
export function spectralSim(a, b, opts = {}) {
  let N = opts.frameSize || 1024
  let hop = opts.hopSize || (N >> 1)
  let trim = opts.trim ?? 0.1
  let floor = opts.floor ?? 1e-5

  let [x, y] = align(a, b, trim)
  let win = hannWindow(N)
  let half = N >> 1
  let mx = new Float64Array(half + 1), my = new Float64Array(half + 1)
  let sum = 0, frames = 0

  for (let pos = 0; pos + N <= x.length; pos += hop) {
    let ex = magFrame(x, pos, win, N, half, mx)
    let ey = magFrame(y, pos, win, N, half, my)
    if (ex < floor || ey < floor) continue

    let dot = 0, nx = 0, ny = 0
    for (let k = 0; k <= half; k++) {
      dot += mx[k] * my[k]
      nx += mx[k] * mx[k]
      ny += my[k] * my[k]
    }
    let denom = Math.sqrt(nx * ny)
    if (denom > 0) { sum += dot / denom; frames++ }
  }
  return frames ? sum / frames : 0
}

// fft() returns zero-copy views into a per-size cache — copy magnitudes out immediately.
let _scratch = new Map()
function magFrame(data, pos, win, N, half, magOut) {
  let f = _scratch.get(N)
  if (!f) { f = new Float64Array(N); _scratch.set(N, f) }
  let e = 0
  for (let i = 0; i < N; i++) {
    let v = (data[pos + i] || 0) * win[i]
    f[i] = v
    e += v * v
  }
  let [re, im] = fft(f)
  for (let k = 0; k <= half; k++) magOut[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
  return e
}

// Trim edges (algorithm startup/tail artifacts) and crop to common length.
function align(a, b, trim) {
  let n = Math.min(a.length, b.length)
  let cut = Math.floor(n * trim)
  let len = n - 2 * cut
  return [a.subarray(cut, cut + len), b.subarray(cut, cut + len)]
}

// Goertzel energy at a single frequency. Trims 20% edges to avoid artifacts.
export function goertzelEnergy(data, freq, sr) {
  let w = 2 * Math.PI * freq / sr, c = 2 * Math.cos(w), s1 = 0, s2 = 0
  let start = Math.floor(data.length * 0.2), end = Math.floor(data.length * 0.8)
  for (let i = start; i < end; i++) { let s = data[i] + c * s1 - s2; s2 = s1; s1 = s }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / (end - start)
}

// Ratio of min/max partial energies. 1.0 = perfectly balanced, 0 = one partial destroyed.
export function chordBalance(data, freqs, sr) {
  let energies = freqs.map(f => goertzelEnergy(data, f, sr))
  let mn = Math.min(...energies), mx = Math.max(...energies)
  return mx > 1e-10 ? mn / mx : 0
}

// Total chord energy preserved relative to reference. 1.0 = no loss.
export function chordRetention(data, ref, freqs, sr) {
  let refE = freqs.reduce((s, f) => s + goertzelEnergy(ref, f, sr), 0)
  let outE = freqs.reduce((s, f) => s + goertzelEnergy(data, f, sr), 0)
  return refE > 1e-10 ? outE / refE : 0
}

// Per-partial amplitude-modulation depth — captures hop-rate beating ("crumble")
// that LSD misses. Slides a Hann-windowed complex demodulator (rotate to baseband,
// integrate) at each frequency to extract a phase-stable envelope, then returns AC
// RMS / DC mean. The Hann taper is essential: a bare integrator ripples at the bin-
// straddle frequency for any non-integer-cycle window, masquerading as modulation.
// 0 = stable, ~0.05 = transparent, ~0.1 = perceptible roughness, ~0.3+ = obvious
// tremolo. Returns the worst (max) depth across the supplied freqs.
export function modulationDepth(data, freqs, sr, opts = {}) {
  let win = opts.envWindow || 2048
  let hop = opts.envHop || 256
  let trim = opts.trim ?? 0.1
  let cut = Math.floor(data.length * trim)
  let len = data.length - 2 * cut
  if (len < win * 2) return 0
  let frames = Math.floor((len - win) / hop) + 1
  if (frames < 8) return 0

  let hann = new Float64Array(win)
  let hannSum = 0
  for (let i = 0; i < win; i++) { hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (win - 1))); hannSum += hann[i] }

  // Two-pass: first measure each partial's mean amplitude, then only score those
  // above 5% of the loudest partial. Otherwise weak/absent partials (e.g. high
  // harmonics suppressed by formant filtering) score huge spurious modulation
  // from spectral-leakage noise.
  let envs = freqs.map(() => new Float64Array(frames))
  let means = new Float64Array(freqs.length)
  for (let fi = 0; fi < freqs.length; fi++) {
    let f = freqs[fi]
    let w = 2 * Math.PI * f / sr
    let env = envs[fi]
    let mean = 0
    for (let k = 0; k < frames; k++) {
      let re = 0, im = 0, base = cut + k * hop
      for (let i = 0; i < win; i++) {
        let s = data[base + i] * hann[i]
        let phase = w * i
        re += s * Math.cos(phase)
        im -= s * Math.sin(phase)
      }
      let mag = Math.sqrt(re * re + im * im) / hannSum
      env[k] = mag
      mean += mag
    }
    means[fi] = mean / frames
  }

  let maxMean = 0
  for (let i = 0; i < means.length; i++) if (means[i] > maxMean) maxMean = means[i]
  let floor = maxMean * 0.05

  let worst = 0
  for (let i = 0; i < freqs.length; i++) {
    if (means[i] < floor) continue
    let env = envs[i], mean = means[i]
    let acVar = 0
    for (let k = 0; k < frames; k++) { let d = env[k] - mean; acVar += d * d }
    let depth = Math.sqrt(acVar / frames) / mean
    if (depth > worst) worst = depth
  }
  return worst
}
