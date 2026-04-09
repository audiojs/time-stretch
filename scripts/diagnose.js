/**
 * Diagnostic: compare OLA/PSOLA against rubberband reference + detect specific defects.
 * Usage: node diagnose.js
 */
import { ola, wsola, psola, phaseLock } from '../index.js'
import { hannWindow } from '../util.js'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs'

let fs = 44100

function sine(freq, n) {
  let d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * i / fs)
  return d
}

function rms(data) {
  let s = 0; for (let i = 0; i < data.length; i++) s += data[i] * data[i]
  return Math.sqrt(s / data.length)
}

// WAV I/O
function writeWav(path, data, sr) {
  let n = data.length, buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8); buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28)
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, data[i]))
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7FFF), 44 + i * 2)
  }
  writeFileSync(path, buf)
}

function readWav(path) {
  let buf = readFileSync(path)
  let dataOff = buf.indexOf('data') + 8
  let n = (buf.length - dataOff) / 2
  let out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let v = buf.readInt16LE(dataOff + i * 2)
    out[i] = v / (v < 0 ? 0x8000 : 0x7FFF)
  }
  return out
}

function cleanup(...files) { for (let f of files) try { unlinkSync(f) } catch {} }

// --- 1. OLA COLA condition check ---
console.log('=== OLA: COLA condition ===')
{
  let frameSize = 1024, hopSize = 256
  let win = hannWindow(frameSize)
  let n = 8192
  let normSum = new Float64Array(n)
  for (let pos = 0; pos + frameSize <= n; pos += hopSize) {
    for (let i = 0; i < frameSize; i++) normSum[pos + i] += win[i]
  }
  // COLA means normSum should be constant in the overlap region
  let mid = normSum.slice(frameSize, n - frameSize)
  let min = Infinity, max = -Infinity
  for (let v of mid) { if (v < min) min = v; if (v > max) max = v }
  console.log(`  Hann window (${frameSize}, hop ${hopSize}): norm range [${min.toFixed(4)}, ${max.toFixed(4)}]`)
  if (Math.abs(max - min) > 0.01) console.log('  ⚠ NOT constant — Hann with 75% overlap should sum to constant')
  else console.log('  ✓ Constant (COLA satisfied)')

  // OLA divides by this norm — but Hann with 25% hop *does* satisfy COLA, sum = 1.5
  // The issue: OLA uses win[i] as norm, but COLA for Hann at R=N/4 gives sum ≠ 1
  // For factor=1, OLA should be identity. Let's check:
  let data = sine(440, 8192)
  let out = ola(data, { factor: 1.001, frameSize: 1024, hopSize: 256 }) // near-identity
  let err = 0
  let minLen = Math.min(data.length, out.length)
  for (let i = 1024; i < minLen - 1024; i++) err += (out[i] - data[i]) ** 2
  let nearIdentityErr = Math.sqrt(err / (minLen - 2048))
  console.log(`  Near-identity (1.001×) interior RMSE: ${nearIdentityErr.toFixed(6)}`)
  if (nearIdentityErr > 0.01) console.log('  ⚠ High error — OLA normalization may be wrong')
  else console.log('  ✓ Near-identity OK')
}

// --- 2. OLA vs rubberband ---
console.log('\n=== OLA vs rubberband reference ===')
{
  let data = sine(440, fs) // 1s
  writeWav('/tmp/_diag_in.wav', data, fs)

  for (let factor of [0.5, 1.5, 2.0]) {
    let out = ola(data, { factor })
    writeWav('/tmp/_diag_ola.wav', out, fs)

    // rubberband stretch
    execSync(`rubberband -T ${factor} /tmp/_diag_in.wav /tmp/_diag_ref.wav 2>/dev/null`)
    let ref = readWav('/tmp/_diag_ref.wav')

    console.log(`  factor ${factor}: ola len=${out.length} ref len=${ref.length}`)
    console.log(`    ola RMS: ${rms(out).toFixed(4)}  ref RMS: ${rms(ref).toFixed(4)}  input RMS: ${rms(data).toFixed(4)}`)

    // Check for discontinuities (clicks)
    let maxJump = 0, jumpPos = 0
    for (let i = 1; i < out.length; i++) {
      let d = Math.abs(out[i] - out[i - 1])
      if (d > maxJump) { maxJump = d; jumpPos = i }
    }
    console.log(`    ola max sample-to-sample jump: ${maxJump.toFixed(4)} at sample ${jumpPos}`)
    if (maxJump > 0.3) console.log('    ⚠ Potential click/discontinuity')

    // Check for silence gaps
    let silentRuns = 0, runLen = 0
    for (let i = 0; i < out.length; i++) {
      if (Math.abs(out[i]) < 1e-6) { runLen++; if (runLen === 100) silentRuns++ }
      else runLen = 0
    }
    if (silentRuns > 0) console.log(`    ⚠ ${silentRuns} silent runs (>100 samples) detected`)
  }
  cleanup('/tmp/_diag_in.wav', '/tmp/_diag_ola.wav', '/tmp/_diag_ref.wav')
}

// --- 3. OLA waveform continuity analysis ---
console.log('\n=== OLA waveform detail ===')
{
  let data = sine(440, 8192)
  for (let factor of [0.5, 1.5, 2.0]) {
    let out = ola(data, { factor })
    // Check norm array behavior by looking at output amplitude envelope
    let blockSize = 256
    let amps = []
    for (let i = 0; i + blockSize < out.length; i += blockSize) {
      let s = 0
      for (let j = 0; j < blockSize; j++) s += out[i + j] ** 2
      amps.push(Math.sqrt(s / blockSize))
    }
    let ampMin = Math.min(...amps.slice(4, -4))
    let ampMax = Math.max(...amps.slice(4, -4))
    let ratio = ampMax > 0 ? ampMin / ampMax : 0
    console.log(`  factor ${factor}: amp range [${ampMin.toFixed(4)}, ${ampMax.toFixed(4)}] ratio ${ratio.toFixed(3)}`)
    if (ratio < 0.8) console.log(`    ⚠ Amplitude modulation detected — normalization issue`)
    else console.log(`    ✓ Smooth envelope`)
  }
}

// --- 4. PSOLA pitch detection check ---
console.log('\n=== PSOLA: pitch detection accuracy ===')
{
  for (let freq of [100, 200, 440]) {
    let period = fs / freq
    let data = sine(freq, fs)
    // Run detectPeriod manually
    let minP = Math.floor(fs / 500), maxP = Math.ceil(fs / 80)

    // Check at a few positions
    let detections = []
    for (let pos = maxP; pos + maxP * 2 < data.length; pos += Math.round(period * 5)) {
      // inline detectPeriod (first-peak, matching psola.js)
      let corr = new Float64Array(maxP + 1)
      for (let lag = minP; lag <= maxP; lag++) {
        let sum = 0, e1 = 0, e2 = 0
        let nn = maxP * 2 - lag
        for (let i = 0; i < nn; i++) {
          let a = data[pos + i], b = data[pos + i + lag]
          sum += a * b; e1 += a * a; e2 += b * b
        }
        let d = Math.sqrt(e1 * e2)
        corr[lag] = d > 1e-10 ? sum / d : 0
      }
      let best = 0, bestVal = -Infinity
      // First peak above threshold
      for (let lag = minP + 1; lag < maxP; lag++) {
        if (corr[lag] > 0.5 && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
          best = lag; bestVal = corr[lag]; break
        }
      }
      // Fallback: global max
      if (!best) {
        for (let lag = minP; lag <= maxP; lag++) {
          if (corr[lag] > bestVal) { bestVal = corr[lag]; best = lag }
        }
      }
      detections.push({ pos, detected: best, expected: Math.round(period), corr: bestVal.toFixed(3) })
    }
    let correct = detections.filter(d => Math.abs(d.detected - d.expected) <= 2).length
    console.log(`  ${freq}Hz (period=${Math.round(period)}): ${correct}/${detections.length} correct detections`)
    if (correct < detections.length * 0.8) {
      console.log(`    ⚠ Poor detection. Samples:`, detections.slice(0, 3).map(d => `det=${d.detected} exp=${d.expected} corr=${d.corr}`))
    }
  }
}

// --- 5. PSOLA click detection ---
console.log('\n=== PSOLA: click/discontinuity detection ===')
{
  let data = sine(200, fs) // 1s, clear pitch
  for (let factor of [0.5, 1.5, 2.0]) {
    let out = psola(data, { factor })

    // Detect clicks: sample-to-sample jumps much larger than expected for a sine
    let jumps = []
    for (let i = 1; i < out.length; i++) {
      let d = Math.abs(out[i] - out[i - 1])
      if (d > 0.15) jumps.push({ pos: i, val: d.toFixed(3), ctx: [out[i-2]?.toFixed(3), out[i-1]?.toFixed(3), out[i]?.toFixed(3), out[i+1]?.toFixed(3)] })
    }
    console.log(`  factor ${factor}: ${jumps.length} potential clicks (jump > 0.15)`)
    if (jumps.length > 0) {
      console.log(`    First 5:`, jumps.slice(0, 5).map(j => `pos=${j.pos} Δ=${j.val} ctx=[${j.ctx}]`))
    }

    // Check for zero-norm gaps (where norm[i] < threshold → out[i] = 0)
    let zeroRuns = [], runStart = -1
    for (let i = 0; i < out.length; i++) {
      if (Math.abs(out[i]) < 1e-8) {
        if (runStart < 0) runStart = i
      } else {
        if (runStart >= 0 && i - runStart > 10) {
          zeroRuns.push({ start: runStart, len: i - runStart })
        }
        runStart = -1
      }
    }
    if (zeroRuns.length > 0) {
      console.log(`    ⚠ ${zeroRuns.length} zero-gaps found:`, zeroRuns.slice(0, 5).map(z => `[${z.start}..+${z.len}]`))
    }
  }
}

// --- 6. PSOLA vs rubberband ---
console.log('\n=== PSOLA vs rubberband reference ===')
{
  let data = sine(200, fs)
  writeWav('/tmp/_diag_in.wav', data, fs)

  for (let factor of [1.5, 2.0]) {
    let out = psola(data, { factor })
    execSync(`rubberband -T ${factor} /tmp/_diag_in.wav /tmp/_diag_ref.wav 2>/dev/null`)
    let ref = readWav('/tmp/_diag_ref.wav')

    console.log(`  factor ${factor}: psola len=${out.length} ref len=${ref.length}`)
    console.log(`    psola RMS: ${rms(out).toFixed(4)}  ref RMS: ${rms(ref).toFixed(4)}`)

    // Compare spectral purity: for a pure sine input, output should still be mostly sine
    // Count zero crossings as rough pitch indicator
    let crossOla = 0, crossRef = 0
    for (let i = 1; i < Math.min(out.length, ref.length); i++) {
      if (out[i] * out[i-1] < 0) crossOla++
      if (ref[i] * ref[i-1] < 0) crossRef++
    }
    let n = Math.min(out.length, ref.length)
    console.log(`    zero crossings: psola=${crossOla} (${(crossOla*fs/n/2).toFixed(1)}Hz) ref=${crossRef} (${(crossRef*fs/n/2).toFixed(1)}Hz) expected=200Hz`)
  }
  cleanup('/tmp/_diag_in.wav', '/tmp/_diag_ref.wav')
}

// --- 7. WSOLA for comparison (known-good baseline) ---
console.log('\n=== WSOLA baseline (for comparison) ===')
{
  let data = sine(440, fs)
  for (let factor of [0.5, 1.5, 2.0]) {
    let out = wsola(data, { factor })
    let maxJump = 0
    for (let i = 1; i < out.length; i++) {
      let d = Math.abs(out[i] - out[i - 1])
      if (d > maxJump) maxJump = d
    }
    console.log(`  factor ${factor}: len=${out.length} RMS=${rms(out).toFixed(4)} maxJump=${maxJump.toFixed(4)}`)
  }
}

console.log('\n=== Done ===')
