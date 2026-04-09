/**
 * Generate comparative quality samples for all algorithms.
 * Outputs compare.html with embedded audio + waveform visualization.
 *
 * Usage: node compare.js
 */
import { ola, wsola, vocoder, phaseLock, transient, paulstretch, psola, pitchShift, formantShift, sms } from '../index.js'
import { writeFileSync } from 'fs'
import wav from 'audio-lena/wav'

let fs = 44100

// decode audio-lena WAV → Float32Array (mono 44.1kHz PCM16)
function decodeLena() {
  let u8 = new Uint8Array(wav), dv = new DataView(wav), pos = 12
  while (pos < u8.length - 8) {
    let id = String.fromCharCode(u8[pos], u8[pos+1], u8[pos+2], u8[pos+3])
    let size = dv.getUint32(pos + 4, true)
    if (id === 'data') {
      let pcm = new Int16Array(wav.slice(pos + 8, pos + 8 + size))
      let d = new Float32Array(pcm.length)
      for (let i = 0; i < pcm.length; i++) d[i] = pcm[i] / 32768
      return d
    }
    pos += 8 + size + (size % 2)
  }
}

// --- Test signals ---
function sine(freq, dur) {
  let n = Math.round(dur * fs)
  let d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * i / fs) * 0.8
  return d
}

function chord(freqs, dur) {
  let n = Math.round(dur * fs)
  let d = new Float32Array(n)
  let amp = 0.7 / freqs.length
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
    let f = f0 + (f1 - f0) * t / (dur)
    d[i] = Math.sin(2 * Math.PI * f * t) * 0.7
  }
  return d
}

function impulse(dur, interval) {
  let n = Math.round(dur * fs)
  let d = new Float32Array(n)
  let gap = Math.round(interval * fs)
  for (let i = 0; i < n; i += gap) {
    for (let j = 0; j < 80 && i + j < n; j++) {
      d[i + j] = (1 - j / 80) * (j % 2 ? -0.9 : 0.9)
    }
  }
  return d
}

function vowel(freq, dur) {
  // simple vocal-like signal: fundamental + harmonics shaped by formants
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
  // normalize peak
  let peak = 0
  for (let i = 0; i < n; i++) if (Math.abs(d[i]) > peak) peak = Math.abs(d[i])
  if (peak > 0) for (let i = 0; i < n; i++) d[i] = d[i] / peak * 0.8
  return d
}

let signals = {
  'Lena (speech)': decodeLena(),
  'Sine 440Hz': sine(440, 0.5),
  'Chord (C maj)': chord([261.6, 329.6, 392.0], 0.5),
  'Sweep 200–2kHz': sweep(200, 2000, 0.5),
  'Impulse train': impulse(0.5, 0.15),
  'Vowel "ah" 150Hz': vowel(150, 0.5),
}

let stretchAlgos = [
  ['ola', ola],
  ['wsola', wsola],
  ['vocoder', vocoder],
  ['phaseLock', phaseLock],
  ['transient', transient],
  ['psola', psola],
  ['sms', sms],
]

let factors = [0.5, 1.5, 2]

// --- WAV encoding ---
function toWav(data, sr) {
  let n = data.length
  let buf = new ArrayBuffer(44 + n * 2)
  let v = new DataView(buf)
  let u8 = new Uint8Array(buf)

  function str(off, s) { for (let i = 0; i < s.length; i++) u8[off + i] = s.charCodeAt(i) }
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
    let s = Math.max(-1, Math.min(1, data[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
  }
  return buf
}

function toBase64(ab) {
  let u8 = new Uint8Array(ab)
  let s = ''
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
  return btoa(s)
}

// --- Generate all results ---
console.log('Generating comparison samples...')
let results = []

for (let [sigName, sigData] of Object.entries(signals)) {
  let original = { name: 'original', factor: 1, audio: toBase64(toWav(sigData, fs)), len: sigData.length }

  for (let factor of factors) {
    let row = { signal: sigName, factor, algos: [] }

    // add original
    row.original = original.audio

    for (let [algoName, algoFn] of stretchAlgos) {
      // skip paulstretch for small factors — it requires factor > 1
      // psola note: works best on pitched signals
      try {
        let t0 = performance.now()
        let out = algoFn(sigData, { factor })
        let ms = performance.now() - t0
        row.algos.push({
          name: algoName,
          audio: toBase64(toWav(out, fs)),
          ms: Math.round(ms),
          len: out.length,
        })
      } catch (e) {
        row.algos.push({ name: algoName, error: e.message })
      }
    }

    // paulstretch only for large factors
    if (factor >= 2) {
      try {
        let t0 = performance.now()
        let out = paulstretch(sigData, { factor: factor * 2 })
        let ms = performance.now() - t0
        row.algos.push({ name: 'paulstretch', audio: toBase64(toWav(out, fs)), ms: Math.round(ms), len: out.length, note: `factor ${factor * 2}×` })
      } catch (e) {
        row.algos.push({ name: 'paulstretch', error: e.message })
      }
    }

    results.push(row)
    console.log(`  ${sigName} × ${factor}`)
  }
}

// --- Build HTML ---
let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>time-stretch — Algorithm Comparison</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font: 14px/1.5 -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; max-width: 1400px; margin: 0 auto; }
h1 { font-size: 20px; font-weight: 500; margin-bottom: 4px; color: #fff; }
h1 small { font-weight: 400; color: #888; font-size: 14px; }
.intro { color: #999; margin-bottom: 24px; font-size: 13px; line-height: 1.6; max-width: 800px; }
.signal-group { margin-bottom: 32px; border: 1px solid #222; border-radius: 8px; overflow: hidden; }
.signal-header { padding: 12px 16px; background: #151515; border-bottom: 1px solid #222; display: flex; justify-content: space-between; align-items: center; }
.signal-header h2 { font-size: 15px; font-weight: 500; }
.signal-header .factor { font-size: 13px; color: #888; }
.original { padding: 8px 16px; background: #111; border-bottom: 1px solid #1a1a1a; display: flex; align-items: center; gap: 12px; }
.original label { font-size: 12px; color: #666; min-width: 70px; }
.algo-row { padding: 6px 16px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #1a1a1a; }
.algo-row:hover { background: #151515; }
.algo-row .name { font-size: 13px; min-width: 90px; font-weight: 500; color: #ccc; }
.algo-row .meta { font-size: 11px; color: #666; min-width: 80px; }
.algo-row .note { font-size: 11px; color: #555; }
button.play { background: none; border: 1px solid #333; color: #aaa; border-radius: 4px; padding: 3px 10px; font-size: 12px; cursor: pointer; min-width: 40px; }
button.play:hover { border-color: #666; color: #fff; }
button.play.playing { border-color: #4a9eff; color: #4a9eff; }
canvas.wave { height: 32px; flex: 1; background: #0d0d0d; border-radius: 3px; }
.error { color: #844; font-size: 12px; }
</style>
</head>
<body>
<h1>time-stretch <small>— algorithm comparison</small></h1>
<p class="intro">
Each row is the same source signal processed by a different algorithm at the same stretch factor.
Click ▶ to listen. Waveforms drawn from actual output. Compare artifacts, phase coherence, transient preservation.
</p>
`

let audioCtx = null

for (let row of results) {
  html += `<div class="signal-group">
<div class="signal-header"><h2>${row.signal}</h2><span class="factor">${row.factor}×</span></div>
<div class="original"><label>original</label><button class="play" data-audio="${row.original}">▶</button><canvas class="wave" data-audio="${row.original}"></canvas></div>
`
  for (let algo of row.algos) {
    if (algo.error) {
      html += `<div class="algo-row"><span class="name">${algo.name}</span><span class="error">${algo.error}</span></div>\n`
    } else {
      html += `<div class="algo-row"><span class="name">${algo.name}</span><button class="play" data-audio="${algo.audio}">▶</button><canvas class="wave" data-audio="${algo.audio}"></canvas><span class="meta">${algo.ms}ms</span>${algo.note ? `<span class="note">${algo.note}</span>` : ''}</div>\n`
    }
  }
  html += `</div>\n`
}

html += `
<script>
let actx, playing

function b64toAb(b64) {
  let bin = atob(b64), n = bin.length, u8 = new Uint8Array(n)
  for (let i = 0; i < n; i++) u8[i] = bin.charCodeAt(i)
  return u8.buffer
}

document.addEventListener('click', async e => {
  let btn = e.target.closest('button.play')
  if (!btn) return
  if (!actx) actx = new AudioContext()

  if (playing) { playing.src.stop(); playing.btn.classList.remove('playing'); if (playing.btn === btn) { playing = null; return } }

  let ab = b64toAb(btn.dataset.audio)
  let buf = await actx.decodeAudioData(ab.slice(0))
  let src = actx.createBufferSource()
  src.buffer = buf
  src.connect(actx.destination)
  src.start()
  btn.classList.add('playing')
  playing = { src, btn }
  src.onended = () => { btn.classList.remove('playing'); if (playing?.btn === btn) playing = null }
})

// draw waveforms
async function drawWaves() {
  let actx2 = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100)
  for (let c of document.querySelectorAll('canvas.wave')) {
    let ab = b64toAb(c.dataset.audio)
    try {
      let buf = await new AudioContext().decodeAudioData(ab)
      let data = buf.getChannelData(0)
      let ctx = c.getContext('2d')
      let w = c.width = c.offsetWidth * 2, h = c.height = 64
      ctx.fillStyle = '#0d0d0d'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = '#3a6'
      ctx.lineWidth = 1
      ctx.beginPath()
      let step = Math.max(1, Math.floor(data.length / w))
      for (let x = 0; x < w; x++) {
        let idx = Math.floor(x * data.length / w)
        let min = Infinity, max = -Infinity
        for (let j = 0; j < step; j++) {
          let v = data[idx + j] || 0
          if (v < min) min = v; if (v > max) max = v
        }
        let y1 = (1 - max) * h / 2, y2 = (1 - min) * h / 2
        ctx.moveTo(x, y1); ctx.lineTo(x, y2)
      }
      ctx.stroke()
    } catch(e) {}
  }
}
requestAnimationFrame(drawWaves)
</script>
</body>
</html>`

writeFileSync('compare.html', html)
console.log(`\nWrote compare.html (${(html.length / 1024).toFixed(0)} KB)`)
console.log(`${results.length} comparisons × ${stretchAlgos.length + 1} algorithms`)
