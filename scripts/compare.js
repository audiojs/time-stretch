/**
 * Generate comparative quality samples for internal algorithms and external references.
 * Outputs compare.html with embedded audio + waveform visualization.
 *
 * Usage: node compare.js
 */
import { ola, wsola, vocoder, phaseLock, transient, paulstretch, psola, sms } from '../index.js'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import wav from 'audio-lena/wav'

let fs = 44100

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function createRandom(seed) {
  let value = (seed >>> 0) || 1
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

function decodeWav(buffer) {
  let u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  let pos = 12
  while (pos < u8.length - 8) {
    let id = String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3])
    let size = dv.getUint32(pos + 4, true)
    if (id === 'data') {
      let pcm = new Int16Array(u8.buffer.slice(u8.byteOffset + pos + 8, u8.byteOffset + pos + 8 + size))
      let data = new Float32Array(pcm.length)
      for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 32768
      return data
    }
    pos += 8 + size + (size % 2)
  }
  throw new Error('WAV data chunk not found')
}

function decodeLena() {
  return decodeWav(new Uint8Array(wav))
}

function clip(data, startSec, durSec) {
  let start = clamp(Math.round(startSec * fs), 0, data.length - 1)
  let end = clamp(start + Math.round(durSec * fs), start + 1, data.length)
  return new Float32Array(data.slice(start, end))
}

function normalizePeak(data, peak = 0.82) {
  let out = new Float32Array(data)
  let max = 0
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]))
  if (max > 1e-8) {
    let gain = peak / max
    for (let i = 0; i < out.length; i++) out[i] *= gain
  }
  return out
}

function sine(freq, dur) {
  let n = Math.round(dur * fs)
  let d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * i / fs) * 0.8
  return d
}

function chord(freqs, dur) {
  let n = Math.round(dur * fs)
  let d = new Float32Array(n)
  let amp = 0.72 / freqs.length
  for (let i = 0; i < n; i++) {
    for (let f of freqs) d[i] += Math.sin(2 * Math.PI * f * i / fs) * amp
  }
  return d
}

function sweep(f0, f1, dur) {
  let n = Math.round(dur * fs)
  let d = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let t = i / fs
    let f = f0 + (f1 - f0) * t / dur
    d[i] = Math.sin(2 * Math.PI * f * t) * 0.72
  }
  return d
}

function impulse(dur, interval) {
  let n = Math.round(dur * fs)
  let d = new Float32Array(n)
  let gap = Math.max(1, Math.round(interval * fs))
  for (let i = 0; i < n; i += gap) {
    for (let j = 0; j < 72 && i + j < n; j++) d[i + j] = (1 - j / 72) * (j % 2 ? -0.92 : 0.92)
  }
  return d
}

function vowel(freq, dur) {
  let n = Math.round(dur * fs)
  let d = new Float32Array(n)
  let formants = [700, 1200, 2500]
  let bw = [80, 120, 160]
  for (let h = 1; h <= 30; h++) {
    let hf = freq * h
    if (hf > fs / 2) break
    let amp = 0
    for (let fi = 0; fi < formants.length; fi++) {
      let df = hf - formants[fi]
      amp += Math.exp(-0.5 * (df / bw[fi]) ** 2)
    }
    amp = amp * 0.3 / h
    for (let i = 0; i < n; i++) d[i] += Math.sin(2 * Math.PI * hf * i / fs) * amp
  }
  return normalizePeak(d, 0.8)
}

function addNoiseBurst(data, start, dur, amp, rand, hp = 0.78) {
  let begin = Math.max(0, Math.round(start * fs))
  let len = Math.max(4, Math.round(dur * fs))
  let prev = 0
  for (let i = 0; i < len && begin + i < data.length; i++) {
    let env = Math.exp(-6 * i / len)
    let white = rand() * 2 - 1
    let colored = white - prev * hp
    prev = white
    data[begin + i] += colored * amp * env
  }
}

function addToneBurst(data, start, dur, partials) {
  let begin = Math.max(0, Math.round(start * fs))
  let len = Math.max(8, Math.round(dur * fs))
  for (let i = 0; i < len && begin + i < data.length; i++) {
    let t = i / fs
    let env = Math.exp(-5.5 * i / len)
    let sample = 0
    for (let [freq, amp] of partials) sample += Math.sin(2 * Math.PI * freq * t) * amp
    data[begin + i] += sample * env
  }
}

function latinPercussion(dur, bpm = 104) {
  let n = Math.round(dur * fs)
  let out = new Float32Array(n)
  let rand = createRandom(0x5a17c0de)
  let beat = 60 / bpm
  let step = beat / 4
  let steps = Math.ceil(dur / step)

  for (let index = 0; index < steps; index++) {
    let t = index * step
    if (t >= dur) break

    if ([0, 3, 6, 10, 12, 15].includes(index % 16)) {
      addToneBurst(out, t, 0.11, [[180, 0.55], [360, 0.18], [540, 0.08]])
      addNoiseBurst(out, t, 0.03, 0.08, rand, 0.5)
    }
    if ([2, 7, 11, 14].includes(index % 16)) {
      addToneBurst(out, t, 0.05, [[1400, 0.25], [2600, 0.14]])
      addNoiseBurst(out, t, 0.014, 0.2, rand, 0.1)
    }
    if (index % 2 === 1) addNoiseBurst(out, t, 0.028, 0.065, rand, 0.15)
    if ([0, 8].includes(index % 16)) addToneBurst(out, t, 0.14, [[95, 0.55], [190, 0.12]])
  }

  return normalizePeak(out, 0.84)
}

function toWav(data, sr) {
  let n = data.length
  let buf = new ArrayBuffer(44 + n * 2)
  let v = new DataView(buf)
  let u8 = new Uint8Array(buf)

  function str(off, s) {
    for (let i = 0; i < s.length; i++) u8[off + i] = s.charCodeAt(i)
  }

  str(0, 'RIFF')
  v.setUint32(4, 36 + n * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sr, true)
  v.setUint32(28, sr * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    let sample = Math.max(-1, Math.min(1, data[i]))
    v.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
  }
  return Buffer.from(buf)
}

let audioStore = {}
let audioIndex = new Map()

function storeAudio(data) {
  let b64 = toWav(data, fs).toString('base64')
  let key = audioIndex.get(b64)
  if (key) return key
  key = `a${audioIndex.size}`
  audioIndex.set(b64, key)
  audioStore[key] = b64
  return key
}

function pythonBin() {
  let python = process.env.PYTHON || resolve(process.cwd(), '.venv/bin/python')
  return existsSync(python) ? python : 'python3'
}

function externalBin(name, candidates) {
  for (let candidate of candidates) {
    if (candidate.includes('/') && existsSync(candidate)) return candidate
  }
  return name
}

function runExternalReference(kind, data, factor, opts = {}) {
  let dir = mkdtempSync(join(tmpdir(), 'stretch-ref-'))
  let inFile = join(dir, 'input.wav')
  let outFile = join(dir, 'output.wav')
  writeFileSync(inFile, toWav(data, fs))
  try {
    if (kind === 'rubberband') {
      let cmd = externalBin('rubberband', ['/opt/homebrew/bin/rubberband', '/usr/local/bin/rubberband'])
      let t0 = performance.now()
      let result = spawnSync(cmd, ['-q', '-3', '--time', String(factor), inFile, outFile], { cwd: process.cwd(), encoding: 'utf8' })
      if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Rubber Band failed').trim())
      return { data: decodeWav(readFileSync(outFile)), ms: Math.round(performance.now() - t0), note: 'Rubber Band 4.0.0 R3 fine, CLI wall time' }
    }

    if (kind === 'soundtouch') {
      let cmd = externalBin('soundstretch', ['/opt/homebrew/bin/soundstretch', '/usr/local/bin/soundstretch'])
      let tempo = (1 / factor - 1) * 100
      let args = [inFile, outFile, `-tempo=${tempo}`]
      let speechMode = opts.kind === 'voice' || opts.kind === 'voice-like'
      if (speechMode) args.push('-speech')
      let t0 = performance.now()
      let result = spawnSync(cmd, args, { cwd: process.cwd(), encoding: 'utf8' })
      if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'SoundTouch failed').trim())
      return { data: decodeWav(readFileSync(outFile)), ms: Math.round(performance.now() - t0), note: `SoundTouch 2.4.1${speechMode ? ' speech mode' : ''}, CLI wall time` }
    }

    let python = pythonBin()
    let script = [
      'import json, sys, time',
      'import soundfile as sf',
      'mode = sys.argv[3]',
      'factor = float(sys.argv[4])',
      'audio, sr = sf.read(sys.argv[1], dtype="float32")',
      'if getattr(audio, "ndim", 1) > 1: audio = audio.mean(axis=1)',
      't0 = time.perf_counter()',
      'if mode == "tdpsola":',
      '    import psola',
      '    out = psola.vocode(audio, sr, constant_stretch=1.0 / factor, fmin=float(sys.argv[5]), fmax=float(sys.argv[6]))',
      'elif mode in ("ola", "wsola", "phasevocoder"):',
      '    import audiotsm',
      '    from audiotsm.io.array import ArrayReader, ArrayWriter',
      '    arr = audio.astype("float32")[None, :]',
      '    speed = 1.0 / factor',
      '    if mode == "ola": tsm = audiotsm.ola(1, speed=speed)',
      '    elif mode == "wsola": tsm = audiotsm.wsola(1, speed=speed)',
      '    else: tsm = audiotsm.phasevocoder(1, speed=speed)',
      '    writer = ArrayWriter(1)',
      '    tsm.run(ArrayReader(arr), writer)',
      '    out = writer.data[0]',
      'else:',
      '    raise RuntimeError(f"unknown external mode: {mode}")',
      'elapsed = (time.perf_counter() - t0) * 1000.0',
      'sf.write(sys.argv[2], out, sr, subtype="PCM_16")',
      'print(json.dumps({"ms": elapsed, "samples": int(len(out))}))'
    ].join('\n')

    let args = ['-c', script, inFile, outFile, kind, String(factor)]
    if (kind === 'tdpsola') args.push(String(opts.minFreq ?? 80), String(opts.maxFreq ?? 320))

    let result = spawnSync(python, args, { cwd: process.cwd(), encoding: 'utf8' })
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'external reference failed').trim())
    let lines = (result.stdout || '').trim().split('\n').filter(Boolean)
    let meta = lines.length ? JSON.parse(lines[lines.length - 1]) : { ms: NaN }
    return { data: decodeWav(readFileSync(outFile)), ms: Math.round(meta.ms) }
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

let lena = decodeLena()
let signals = [
  { name: 'Interview excerpt (Lena speech)', kind: 'voice', data: clip(lena, 0.18, 1.05), minFreq: 80, maxFreq: 320, external: ['ola', 'wsola', 'phasevocoder', 'tdpsola', 'rubberband', 'soundtouch'] },
  { name: 'Latin percussion groove', kind: 'percussion', data: latinPercussion(1.0), external: ['ola', 'wsola', 'phasevocoder', 'rubberband', 'soundtouch'] },
  { name: 'Sine 440Hz', kind: 'tonal', data: sine(440, 0.42), external: ['ola', 'wsola', 'phasevocoder', 'rubberband', 'soundtouch'] },
  { name: 'Chord (C maj)', kind: 'polyphonic', data: chord([261.6, 329.6, 392.0], 0.42), external: ['ola', 'wsola', 'phasevocoder', 'rubberband', 'soundtouch'] },
  { name: 'Sweep 200–2kHz', kind: 'sweep', data: sweep(200, 2000, 0.42), external: ['ola', 'wsola', 'phasevocoder', 'rubberband', 'soundtouch'] },
  { name: 'Impulse train', kind: 'transient', data: impulse(0.42, 0.14), external: ['ola', 'wsola', 'phasevocoder', 'rubberband', 'soundtouch'] },
  { name: 'Vowel "ah" 150Hz', kind: 'voice-like', data: vowel(150, 0.5), minFreq: 80, maxFreq: 320, external: ['ola', 'wsola', 'phasevocoder', 'tdpsola', 'rubberband', 'soundtouch'] },
]

let internalRows = [
  { name: 'ola', fn: ola },
  { name: 'wsola', fn: wsola },
  { name: 'vocoder', fn: vocoder },
  { name: 'phaseLock', fn: phaseLock },
  { name: 'transient', fn: transient },
  { name: 'psola', fn: psola },
  { name: 'sms', fn: sms },
]

let externalRows = {
  ola: { name: 'ref ola', note: 'audiotsm external reference' },
  wsola: { name: 'ref wsola', note: 'audiotsm external reference' },
  phasevocoder: { name: 'ref phase vocoder', note: 'audiotsm external reference' },
  tdpsola: { name: 'ref TD-PSOLA', note: 'Praat / python-psola reference' },
  rubberband: { name: 'ref Rubber Band', note: 'Rubber Band 4.0.0 R3 fine, CLI wall time' },
  soundtouch: { name: 'ref SoundTouch', note: 'SoundTouch 2.4.1, CLI wall time' },
}

let pairRefs = {
  ola: 'ola',
  wsola: 'wsola',
  vocoder: 'phasevocoder',
  psola: 'tdpsola',
}

let factors = [0.5, 1.5, 2]
let standaloneRefs = ['rubberband', 'soundtouch']

function rowForAudio(name, data, ms, note, source) {
  return { name, key: storeAudio(data), ms: Number.isFinite(ms) ? Math.round(ms) : null, len: data.length, note, source }
}

function renderRow(row, originalLen) {
  if (row.error) return `<div class="algo-row error-row"><span class="name">${row.name}</span><span class="badge ${row.source}">${row.source}</span><span class="error">${row.error}</span></div>`
  let ratio = (row.len / originalLen).toFixed(2)
  return `<div class="algo-row ${row.source}"><span class="name">${row.name}</span><span class="badge ${row.source}">${row.source}</span><button class="play" data-key="${row.key}">▶</button><canvas class="wave" data-key="${row.key}"></canvas><span class="meta">${row.ms}ms</span><span class="meta">${ratio}× len</span>${row.note ? `<span class="note">${row.note}</span>` : ''}</div>`
}

console.log('Generating comparison samples...')
let results = []

for (let signal of signals) {
  let original = rowForAudio('original', signal.data, 0, signal.kind, 'original')

  for (let factor of factors) {
    let rows = [original]

    for (let algo of internalRows) {
      try {
        let opts = { factor }
        if (signal.minFreq) Object.assign(opts, { sampleRate: fs, minFreq: signal.minFreq, maxFreq: signal.maxFreq })
        let t0 = performance.now()
        let out = algo.fn(signal.data, opts)
        let note = algo.name === 'psola' && !signal.external.includes('tdpsola') ? 'speech-oriented local path' : ''
        rows.push(rowForAudio(algo.name, out, performance.now() - t0, note, 'internal'))
      }
      catch (error) {
        rows.push({ name: algo.name, error: error.message, source: 'internal' })
      }

      let refKind = pairRefs[algo.name]
      if (!refKind || !signal.external.includes(refKind)) continue

      try {
        let ref = runExternalReference(refKind, signal.data, factor, signal)
        rows.push(rowForAudio(externalRows[refKind].name, ref.data, ref.ms, ref.note || externalRows[refKind].note, 'external'))
      }
      catch (error) {
        rows.push({ name: externalRows[refKind].name, error: error.message, source: 'external' })
      }
    }

    for (let refKind of standaloneRefs) {
      if (!signal.external.includes(refKind)) continue
      try {
        let ref = runExternalReference(refKind, signal.data, factor, signal)
        rows.push(rowForAudio(externalRows[refKind].name, ref.data, ref.ms, ref.note || externalRows[refKind].note, 'external'))
      }
      catch (error) {
        rows.push({ name: externalRows[refKind].name, error: error.message, source: 'external' })
      }
    }

    if (factor >= 2) {
      try {
        let t0 = performance.now()
        let out = paulstretch(signal.data, { factor: factor * 2 })
        rows.push(rowForAudio('paulstretch', out, performance.now() - t0, `local only, rendered at ${factor * 2}×`, 'internal'))
      }
      catch (error) {
        rows.push({ name: 'paulstretch', error: error.message, source: 'internal' })
      }
    }

    results.push({ signal: signal.name, kind: signal.kind, factor, original, rows })
    console.log(`  ${signal.name} × ${factor}`)
  }
}

let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>time-stretch — Internal vs External Comparison</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg: #12110f;
  --panel: #1a1815;
  --panel-2: #24211c;
  --line: #353027;
  --text: #efe7d5;
  --muted: #baae94;
  --internal: #dd8d54;
  --external: #79a6c7;
  --original: #8dbb73;
  --error: #d67d7d;
  --wave: #c9b27f;
}
body {
  font: 14px/1.5 Georgia, 'Iowan Old Style', 'Palatino Linotype', serif;
  background:
    radial-gradient(circle at top left, rgba(210, 147, 89, 0.08), transparent 28%),
    radial-gradient(circle at top right, rgba(121, 166, 199, 0.08), transparent 24%),
    linear-gradient(180deg, #171512 0%, var(--bg) 100%);
  color: var(--text);
  padding: 28px;
  max-width: 1500px;
  margin: 0 auto;
}
h1 { font-size: 28px; letter-spacing: 0.02em; margin-bottom: 6px; }
h1 small { font-size: 14px; color: var(--muted); font-weight: 400; }
.intro { color: var(--muted); margin-bottom: 22px; max-width: 980px; }
.legend { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; }
.chip { border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; font-size: 12px; color: var(--muted); background: rgba(255, 255, 255, 0.02); }
.signal-group { margin-bottom: 28px; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0)); }
.signal-header { padding: 14px 16px; background: var(--panel-2); border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.signal-header h2 { font-size: 16px; }
.signal-meta { display: flex; gap: 10px; align-items: center; color: var(--muted); font-size: 12px; }
.algo-row { padding: 8px 16px; display: grid; grid-template-columns: 118px 72px 44px minmax(180px, 1fr) 70px 76px minmax(160px, 220px); gap: 12px; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
.algo-row:last-child { border-bottom: 0; }
.algo-row.internal { background: rgba(221, 141, 84, 0.035); }
.algo-row.external { background: rgba(121, 166, 199, 0.045); }
.algo-row.original { background: rgba(141, 187, 115, 0.04); }
.algo-row:hover { background-color: rgba(255,255,255,0.045); }
.name { font-weight: 600; }
.badge { justify-self: start; border-radius: 999px; padding: 3px 8px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; border: 1px solid transparent; }
.badge.internal { color: var(--internal); border-color: rgba(221, 141, 84, 0.35); }
.badge.external { color: var(--external); border-color: rgba(121, 166, 199, 0.35); }
.badge.original { color: var(--original); border-color: rgba(141, 187, 115, 0.35); }
button.play { background: none; border: 1px solid var(--line); color: var(--text); border-radius: 6px; padding: 4px 0; font-size: 12px; cursor: pointer; }
button.play:hover, button.play.playing { border-color: var(--wave); color: var(--wave); }
canvas.wave { height: 30px; width: 100%; background: rgba(0, 0, 0, 0.18); border-radius: 4px; }
.meta, .note { font-size: 11px; color: var(--muted); }
.error-row { grid-template-columns: 118px 72px 1fr; }
.error { color: var(--error); font-size: 12px; }
@media (max-width: 980px) {
  body { padding: 16px; }
  .algo-row { grid-template-columns: 1fr; gap: 8px; }
  .signal-header { flex-direction: column; align-items: flex-start; }
}
</style>
</head>
<body>
<h1>time-stretch <small>internal vs external references</small></h1>
<p class="intro">Each block shows the same source signal stretched by the local implementation and, where available, an external reference implementation. Internal timings are direct JavaScript call times. Python-backed references show in-library processing time. Rubber Band and SoundTouch rows show CLI wall time because those tools are invoked as external binaries. TD-PSOLA references apply only to speech-like material.</p>
<div class="legend">
  <span class="chip">new sources: interview speech excerpt + Latin percussion groove</span>
  <span class="chip">external refs: audiotsm OLA / WSOLA / phase vocoder</span>
  <span class="chip">external refs: Praat TD-PSOLA via python-psola</span>
  <span class="chip">external refs: Rubber Band R3 + SoundTouch</span>
</div>
`

for (let row of results) {
  html += `<div class="signal-group">\n<div class="signal-header"><h2>${row.signal}</h2><div class="signal-meta"><span>${row.kind}</span><span>${row.factor}× stretch</span></div></div>\n`
  for (let item of row.rows) html += `${renderRow(item, row.original.len)}\n`
  html += `</div>\n`
}

html += `
<script>
const AUDIO = ${JSON.stringify(audioStore)}
let actx, decodeCtx, playing

function getDecodeContext() {
  if (!decodeCtx) {
    let Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext
    decodeCtx = Offline ? new Offline(1, 1, 44100) : new (window.AudioContext || window.webkitAudioContext)()
  }
  return decodeCtx
}

function b64toAb(b64) {
  let bin = atob(b64)
  let n = bin.length
  let u8 = new Uint8Array(n)
  for (let i = 0; i < n; i++) u8[i] = bin.charCodeAt(i)
  return u8.buffer
}

async function decodeAudioByKey(key) {
  let ctx = getDecodeContext()
  return ctx.decodeAudioData(b64toAb(AUDIO[key]).slice(0))
}

document.addEventListener('click', async event => {
  let btn = event.target.closest('button.play')
  if (!btn) return
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)()
    if (actx.state === 'suspended') await actx.resume()

    if (playing) {
      playing.src.stop()
      playing.btn.classList.remove('playing')
      if (playing.btn === btn) {
        playing = null
        return
      }
    }

    let buf = await decodeAudioByKey(btn.dataset.key)
    let src = actx.createBufferSource()
    src.buffer = buf
    src.connect(actx.destination)
    src.start()
    btn.classList.add('playing')
    playing = { src, btn }
    src.onended = () => {
      btn.classList.remove('playing')
      if (playing && playing.btn === btn) playing = null
    }
  } catch (error) {
    console.error('Playback failed', error)
  }
})

async function drawWaves() {
  for (let canvas of document.querySelectorAll('canvas.wave')) {
    try {
      let buf = await decodeAudioByKey(canvas.dataset.key)
      let data = buf.getChannelData(0)
      let ctx = canvas.getContext('2d')
      let w = canvas.width = canvas.offsetWidth * 2
      let h = canvas.height = 60
      ctx.fillStyle = 'rgba(0,0,0,0.18)'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = '#c9b27f'
      ctx.lineWidth = 1
      ctx.beginPath()
      let step = Math.max(1, Math.floor(data.length / w))
      for (let x = 0; x < w; x++) {
        let idx = Math.floor(x * data.length / w)
        let min = Infinity
        let max = -Infinity
        for (let j = 0; j < step; j++) {
          let value = data[idx + j] || 0
          if (value < min) min = value
          if (value > max) max = value
        }
        let y1 = (1 - max) * h / 2
        let y2 = (1 - min) * h / 2
        ctx.moveTo(x, y1)
        ctx.lineTo(x, y2)
      }
      ctx.stroke()
    } catch (error) {
      console.error('Waveform decode failed', error)
    }
  }
}

requestAnimationFrame(drawWaves)
</script>
</body>
</html>`

writeFileSync('compare.html', html)
console.log(`\nWrote compare.html (${(html.length / 1024).toFixed(0)} KB)`)
console.log(`${results.length} comparisons × variable internal/external rows`)
