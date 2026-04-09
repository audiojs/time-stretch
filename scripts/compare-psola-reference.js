import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import wav from 'audio-lena/wav'
import { psola, wsola, phaseLock } from '../index.js'

let fs = 44100

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

function vowel(freq, dur) {
  let n = Math.round(dur * fs)
  let data = new Float32Array(n)
  let formants = [700, 1200, 2500]
  let bw = [80, 120, 160]
  for (let harmonic = 1; harmonic <= 30; harmonic++) {
    let harmonicFreq = freq * harmonic
    if (harmonicFreq > fs / 2) break
    let amp = 0
    for (let i = 0; i < formants.length; i++) {
      let delta = harmonicFreq - formants[i]
      amp += Math.exp(-0.5 * (delta / bw[i]) ** 2)
    }
    amp = amp * 0.3 / harmonic
    for (let sample = 0; sample < n; sample++) data[sample] += Math.sin(2 * Math.PI * harmonicFreq * sample / fs) * amp
  }
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[i]))
  if (peak > 0) for (let i = 0; i < n; i++) data[i] = data[i] / peak * 0.8
  return data
}

function toWav(data, sampleRate) {
  let n = data.length
  let buf = new ArrayBuffer(44 + n * 2)
  let dv = new DataView(buf)
  let u8 = new Uint8Array(buf)

  function str(off, s) {
    for (let i = 0; i < s.length; i++) u8[off + i] = s.charCodeAt(i)
  }

  str(0, 'RIFF')
  dv.setUint32(4, 36 + n * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, 1, true)
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  str(36, 'data')
  dv.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    let sample = Math.max(-1, Math.min(1, data[i]))
    dv.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
  }
  return Buffer.from(buf)
}

function toBase64(data) {
  return Buffer.from(toWav(data, fs)).toString('base64')
}

function rms(data) {
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / Math.max(1, data.length))
}

function estimatePitchTrack(data, sampleRate, minFreq, maxFreq) {
  let minP = Math.floor(sampleRate / maxFreq)
  let maxP = Math.ceil(sampleRate / minFreq)
  let frameSize = Math.max(maxP * 3, Math.round(sampleRate * 0.03))
  let hop = Math.max(1, Math.round(sampleRate * 0.01))
  let track = []

  for (let start = 0; start + frameSize + maxP < data.length; start += hop) {
    let bestLag = 0
    let bestScore = 0
    for (let lag = minP; lag <= maxP; lag++) {
      let sum = 0
      let e1 = 0
      let e2 = 0
      let count = frameSize - lag
      for (let i = 0; i < count; i++) {
        let a = data[start + i]
        let b = data[start + i + lag]
        sum += a * b
        e1 += a * a
        e2 += b * b
      }
      let denom = Math.sqrt(e1 * e2)
      let score = denom > 1e-9 ? sum / denom : 0
      if (score > bestScore) {
        bestScore = score
        bestLag = lag
      }
    }
    track.push(bestScore >= 0.35 && bestLag ? sampleRate / bestLag : 0)
  }

  return track
}

function resampleTrack(track, len) {
  if (!track.length || len <= 0) return new Float32Array(0)
  if (track.length === len) return Float32Array.from(track)
  let out = new Float32Array(len)
  let ratio = (track.length - 1) / Math.max(1, len - 1)
  for (let i = 0; i < len; i++) {
    let pos = i * ratio
    let idx = Math.floor(pos)
    let frac = pos - idx
    let a = track[idx]
    let b = track[Math.min(track.length - 1, idx + 1)]
    out[i] = a * (1 - frac) + b * frac
  }
  return out
}

function pitchRmse(a, b) {
  let len = Math.max(a.length, b.length)
  if (!len) return null
  let aa = resampleTrack(a, len)
  let bb = resampleTrack(b, len)
  let sum = 0
  let count = 0
  for (let i = 0; i < len; i++) {
    if (!aa[i] || !bb[i]) continue
    let delta = aa[i] - bb[i]
    sum += delta * delta
    count++
  }
  return count ? Math.sqrt(sum / count) : null
}

function runReference(data, factor, minFreq, maxFreq) {
  let python = process.env.PYTHON || resolve(process.cwd(), '.venv/bin/python')
  if (!existsSync(python)) python = 'python3'

  let dir = mkdtempSync(join(tmpdir(), 'psola-ref-'))
  let inFile = join(dir, 'input.wav')
  let outFile = join(dir, 'output.wav')
  writeFileSync(inFile, toWav(data, fs))

  let script = [
    'import sys',
    'import soundfile as sf',
    'import psola',
    'audio, sr = sf.read(sys.argv[1], dtype="float32")',
    'if getattr(audio, "ndim", 1) > 1: audio = audio.mean(axis=1)',
    'out = psola.vocode(audio, sr, constant_stretch=float(sys.argv[3]), fmin=float(sys.argv[4]), fmax=float(sys.argv[5]))',
    'sf.write(sys.argv[2], out, sr, subtype="PCM_16")'
  ].join('\n')

  let result = spawnSync(python, ['-c', script, inFile, outFile, String(factor), String(minFreq), String(maxFreq)], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })

  try {
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'reference call failed').trim())
    return decodeWav(readFileSync(outFile))
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function renderRow(signalName, factor, rows) {
  let lines = [`<section class="group"><div class="head"><h2>${signalName}</h2><span>${factor}x</span></div>`]
  for (let row of rows) {
    if (row.error) {
      lines.push(`<div class="row"><div class="name">${row.name}</div><div class="error">${row.error}</div></div>`)
      continue
    }
    let pitch = row.pitchRmse == null ? 'n/a' : `${row.pitchRmse.toFixed(1)} Hz vs ref`
    lines.push(`<div class="row"><div class="name">${row.name}</div><audio controls preload="none" src="data:audio/wav;base64,${row.audio}"></audio><div class="meta">${row.ms} ms</div><div class="meta">${pitch}</div><div class="meta">rms ${row.rms.toFixed(3)}</div></div>`)
  }
  lines.push('</section>')
  return lines.join('\n')
}

let cases = [
  { name: 'Lena (speech)', data: decodeLena(), minFreq: 80, maxFreq: 320 },
  { name: 'Vowel ah 150Hz', data: vowel(150, 1.0), minFreq: 80, maxFreq: 320 },
]

let factors = [0.5, 1.5, 2]
let sections = []
let summary = []

for (let item of cases) {
  for (let factor of factors) {
    let tRef = performance.now()
    let ref = null
    let refError = null
    try {
      ref = runReference(item.data, factor, item.minFreq, item.maxFreq)
    }
    catch (error) {
      refError = error.message
    }
    let refMs = performance.now() - tRef
    let refPitch = ref ? estimatePitchTrack(ref, fs, item.minFreq, item.maxFreq) : []

    let rows = []
    rows.push({ name: 'original', audio: toBase64(item.data), ms: 0, rms: rms(item.data), pitchRmse: null })
    if (ref) rows.push({ name: 'reference TD-PSOLA', audio: toBase64(ref), ms: Math.round(refMs), rms: rms(ref), pitchRmse: 0 })
    else rows.push({ name: 'reference TD-PSOLA', error: refError || 'reference run failed' })

    for (let [name, fn] of [['psola', psola], ['wsola', wsola], ['phaseLock', phaseLock]]) {
      try {
        let t0 = performance.now()
        let out = fn(item.data, { factor, sampleRate: fs, minFreq: item.minFreq, maxFreq: item.maxFreq })
        let pitch = estimatePitchTrack(out, fs, item.minFreq, item.maxFreq)
        let rmse = ref ? pitchRmse(pitch, refPitch) : null
        rows.push({
          name,
          audio: toBase64(out),
          ms: Math.round(performance.now() - t0),
          rms: rms(out),
          pitchRmse: rmse,
        })
        summary.push(`${item.name} × ${factor}: ${name} pitch-RMSE ${rmse == null ? 'n/a' : rmse.toFixed(1)} Hz vs reference`)
      }
      catch (error) {
        rows.push({ name, error: error.message })
      }
    }

    sections.push(renderRow(item.name, factor, rows))
  }
}

let html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>PSOLA Reference Comparison</title>
<style>
body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, sans-serif; background: #0f1115; color: #e8edf2; margin: 0; padding: 24px; }
h1 { margin: 0 0 8px; font-size: 22px; }
p { margin: 0 0 20px; color: #a7b1bc; max-width: 900px; }
.group { border: 1px solid #222934; border-radius: 10px; margin: 0 0 18px; overflow: hidden; }
.head { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #171b22; }
.head h2 { margin: 0; font-size: 15px; }
.row { display: grid; grid-template-columns: 160px minmax(280px, 1fr) 100px 140px 110px; gap: 12px; align-items: center; padding: 10px 14px; border-top: 1px solid #1d2430; }
.name { font-weight: 600; }
.meta { color: #93a0ad; font-size: 12px; }
.error { color: #ff9b9b; }
audio { width: 100%; height: 36px; }
</style>
</head>
<body>
<h1>PSOLA Reference Comparison</h1>
<p>Compares this repo's PSOLA against Praat TD-PSOLA via the Python psola package, plus WSOLA and phase-lock baselines, on speech-oriented material. Pitch-RMSE is a rough autocorrelation-based diagnostic, not a perceptual score.</p>
${sections.join('\n')}
</body>
</html>`

writeFileSync('compare-psola-reference.html', html)

console.log('Wrote compare-psola-reference.html')
for (let line of summary) console.log(line)
