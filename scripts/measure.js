// Measure WSOLA quality + perf on chord/voice/sine. Run before/after a change to compare.
import { wsola, vocoder, lsd, chordRetention, chordBalance, modulationDepth } from '../index.js'

let fs = 44100

function chordSig(dur, freqs = [261.6, 329.6, 392.0]) {
  let n = Math.round(dur * fs), d = new Float32Array(n)
  let a = 0.72 / freqs.length
  for (let i = 0; i < n; i++) for (let f of freqs) d[i] += Math.sin(2 * Math.PI * f * i / fs) * a
  return d
}

function vowelSig(freq, dur) {
  let n = Math.round(dur * fs), d = new Float32Array(n)
  let formants = [700, 1200, 2500], bw = [80, 120, 160]
  for (let h = 1; h <= 30; h++) {
    let hf = freq * h
    if (hf > fs / 2) break
    let amp = 0
    for (let fi = 0; fi < 3; fi++) {
      let df = hf - formants[fi]
      amp += Math.exp(-0.5 * (df / bw[fi]) ** 2)
    }
    amp = amp * 0.3 / h
    for (let i = 0; i < n; i++) d[i] += Math.sin(2 * Math.PI * hf * i / fs) * amp
  }
  return d
}

function sineSig(freq, dur) {
  let n = Math.round(dur * fs), d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * i / fs) * 0.8
  return d
}

let chordFreqs = [261.6, 329.6, 392.0]
let vowelHarmonics = [150, 300, 450, 600, 750, 900, 1050, 1200]

function bench(name, fn, src, opts, runs = 5) {
  fn(src, opts) // warmup
  let times = []
  for (let i = 0; i < runs; i++) {
    let t = process.hrtime.bigint()
    fn(src, opts)
    times.push(Number(process.hrtime.bigint() - t) / 1e6)
  }
  times.sort((a, b) => a - b)
  return times[Math.floor(runs / 2)]
}

function measure(label, fn, src, opts, freqs, refFn) {
  let out = fn(src, opts)
  let ref = refFn(opts.factor)
  let l = lsd(out, ref)
  let bal = freqs ? chordBalance(out, freqs, fs) : null
  let ret = freqs ? chordRetention(out, ref, freqs, fs) : null
  let mod = freqs ? modulationDepth(out, freqs, fs) : null
  let ms = bench(label, fn, src, opts)
  return { label, lsd: l, balance: bal, retention: ret, modulation: mod, ms }
}

let cases = [
  // [label, fn, opts, src factory(dur), freqs]
  ['wsola chord 2.0×   ', wsola,   { factor: 2.0 }, chordSig, chordFreqs],
  ['wsola chord 1.5×   ', wsola,   { factor: 1.5 }, chordSig, chordFreqs],
  ['wsola chord 0.5×   ', wsola,   { factor: 0.5 }, chordSig, chordFreqs],
  ['wsola vowel 2.0×   ', wsola,   { factor: 2.0 }, d => vowelSig(150, d), vowelHarmonics],
  ['wsola sine  2.0×   ', wsola,   { factor: 2.0 }, d => sineSig(440, d), [440]],
  ['vocoder chord 2.0×', vocoder, { factor: 2.0, lock: true }, chordSig, chordFreqs],
  ['vocoder vowel 2.0×', vocoder, { factor: 2.0, lock: true }, d => vowelSig(150, d), vowelHarmonics],
]

let dur = 1.0
console.log('label                | LSD dB | balance | retention | modDepth |  ms')
console.log('---------------------|--------|---------|-----------|----------|------')
for (let [label, fn, opts, gen, freqs] of cases) {
  let src = gen(dur)
  let r = measure(label, fn, src, opts, freqs, f => gen(dur * f))
  console.log(
    `${label} | ${r.lsd.toFixed(2).padStart(6)} | ${(r.balance ?? 0).toFixed(3).padStart(7)} | ${(r.retention ?? 0).toFixed(3).padStart(9)} | ${(r.modulation ?? 0).toFixed(3).padStart(8)} | ${r.ms.toFixed(2).padStart(5)}`
  )
}
