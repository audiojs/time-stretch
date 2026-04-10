import test, { almost, ok, is } from 'tst'
import { ola, wsola, vocoder, phaseLock, transient, paulstretch, psola, pitchShift, formantShift, sms } from './index.js'

let fs = 44100

function sine(freq, n, sampleRate) {
  let d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * i / sampleRate)
  return d
}

function rms(data) {
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / data.length)
}

function peakFreq(data, sampleRate) {
  // simple zero-crossing frequency estimation
  let crossings = 0
  for (let i = 1; i < data.length; i++) {
    if (data[i - 1] <= 0 && data[i] > 0) crossings++
  }
  return crossings * sampleRate / data.length
}

// helper: test a stretch algorithm
function testStretch(name, fn, tolerances = {}) {
  let lenTol = tolerances.lenTol ?? 0.05
  let rmsTol = tolerances.rmsTol ?? 0.05
  let freqTol = tolerances.freqTol ?? 0.1

  test(`${name} — factor 1 returns copy`, () => {
    let data = sine(440, 8192, fs)
    let out = fn(data, { factor: 1 })
    is(out.length, data.length)
    almost(rms(out), rms(data), 0.01)
  })

  test(`${name} — factor 2 doubles length`, () => {
    let data = sine(440, 8192, fs)
    let out = fn(data, { factor: 2 })
    almost(out.length, data.length * 2, data.length * lenTol)
    ok(rms(out) > 0.1, 'has signal')
  })

  test(`${name} — factor 0.5 halves length`, () => {
    let data = sine(440, 16384, fs)
    let out = fn(data, { factor: 0.5 })
    almost(out.length, data.length * 0.5, data.length * lenTol)
    ok(rms(out) > 0.1, 'has signal')
  })

  test(`${name} — preserves pitch (440Hz sine)`, () => {
    let data = sine(440, 16384, fs)
    let out = fn(data, { factor: 1.5 })
    let freq = peakFreq(out, fs)
    almost(freq, 440, 440 * freqTol, 'pitch preserved')
  })

  test(`${name} — energy conservation`, () => {
    let data = sine(440, 8192, fs)
    let inRms = rms(data)
    let out = fn(data, { factor: 1.5 })
    let outRms = rms(out)
    almost(outRms, inRms, inRms * rmsTol, 'energy preserved')
  })

  test(`${name} — handles silence`, () => {
    let data = new Float32Array(4096)
    let out = fn(data, { factor: 2 })
    almost(rms(out), 0, 0.001, 'silence preserved')
  })

  test(`${name} — extreme slow-down (3x)`, () => {
    let data = sine(440, 8192, fs)
    let out = fn(data, { factor: 3 })
    almost(out.length, data.length * 3, data.length * lenTol)
    ok(rms(out) > 0.05, 'has signal')
  })

  test(`${name} — extreme speed-up (0.25x)`, () => {
    let data = sine(440, 16384, fs)
    let out = fn(data, { factor: 0.25 })
    almost(out.length, data.length * 0.25, data.length * lenTol)
    ok(rms(out) > 0.05, 'has signal')
  })
}

// --- OLA ---
testStretch('ola', ola, { freqTol: 0.3, rmsTol: 0.55 })

// --- WSOLA ---
testStretch('wsola', wsola)

// --- Phase vocoder ---
testStretch('vocoder', vocoder, { rmsTol: 0.15 })

// --- Phase-locked vocoder ---
testStretch('phaseLock', phaseLock, { rmsTol: 0.15 })

// --- Transient-aware vocoder ---
testStretch('transient', transient, { rmsTol: 0.15 })

// --- PaulStretch ---
test('paulstretch — extreme stretch (8x)', () => {
  let data = sine(440, 4096, fs)
  let out = paulstretch(data, { factor: 8 })
  almost(out.length, data.length * 8, data.length * 0.1)
  ok(rms(out) > 0.05, 'has signal')
})

test('paulstretch — factor 1 returns copy', () => {
  let data = sine(440, 4096, fs)
  let out = paulstretch(data, { factor: 1 })
  is(out.length, data.length)
})

test('paulstretch — very extreme (32x)', () => {
  let data = sine(440, 4096, fs)
  let out = paulstretch(data, { factor: 32 })
  almost(out.length, data.length * 32, data.length * 0.2)
  ok(rms(out) > 0.01, 'has signal')
})

// --- PSOLA ---
test('psola — factor 1 returns copy', () => {
  let data = sine(440, 8192, fs)
  let out = psola(data, { factor: 1 })
  is(out.length, data.length)
})

test('psola — factor 2 doubles length', () => {
  let data = sine(440, 8192, fs)
  let out = psola(data, { factor: 2 })
  almost(out.length, data.length * 2, data.length * 0.15)
  ok(rms(out) > 0.05, 'has signal')
})

test('psola — factor 0.5 halves length', () => {
  let data = sine(440, 8192, fs)
  let out = psola(data, { factor: 0.5 })
  almost(out.length, data.length * 0.5, data.length * 0.15)
  ok(rms(out) > 0.05, 'has signal')
})

test('psola — preserves pitch (440Hz sine)', () => {
  let data = sine(440, 16384, fs)
  let out = psola(data, { factor: 2 })
  let freq = peakFreq(out, fs)
  almost(freq, 440, 440 * 0.1, 'pitch preserved')
})

test('psola — energy conservation', () => {
  let data = sine(440, 8192, fs)
  let out = psola(data, { factor: 2 })
  almost(rms(out), rms(data), rms(data) * 0.3, 'energy preserved')
})

// --- Pitch shift ---
test('pitchShift — 0 semitones returns copy', () => {
  let data = sine(440, 8192, fs)
  let out = pitchShift(data, { semitones: 0 })
  is(out.length, data.length)
})

test('pitchShift — preserves length', () => {
  let data = sine(440, 8192, fs)
  let out = pitchShift(data, { semitones: 5 })
  is(out.length, data.length)
  ok(rms(out) > 0.1, 'has signal')
})

test('pitchShift — negative semitones', () => {
  let data = sine(440, 8192, fs)
  let out = pitchShift(data, { semitones: -3 })
  is(out.length, data.length)
  ok(rms(out) > 0.1, 'has signal')
})

test('pitchShift — +12 semitones doubles frequency', () => {
  let data = sine(220, 16384, fs)
  let out = pitchShift(data, { semitones: 12 })
  let freq = peakFreq(out, fs)
  almost(freq, 440, 440 * 0.15, 'octave up')
})

test('pitchShift — -12 semitones halves frequency', () => {
  let data = sine(440, 16384, fs)
  let out = pitchShift(data, { semitones: -12 })
  let freq = peakFreq(out, fs)
  almost(freq, 220, 220 * 0.15, 'octave down')
})

test('pitchShift — ratio parameter', () => {
  let data = sine(440, 8192, fs)
  let out = pitchShift(data, { ratio: 1.5 })
  is(out.length, data.length)
  ok(rms(out) > 0.1, 'has signal')
})

test('pitchShift — wsola method', () => {
  let data = sine(440, 8192, fs)
  let out = pitchShift(data, { semitones: 5, method: wsola })
  is(out.length, data.length)
  ok(rms(out) > 0.1, 'has signal')
})

test('pitchShift — voice content uses PSOLA path', () => {
  let data = sine(220, 8192, fs)
  let out = pitchShift(data, { semitones: 4, content: 'voice', sampleRate: fs, minFreq: 80, maxFreq: 320 })
  is(out.length, data.length)
  ok(rms(out) > 0.1, 'has signal')
})

test('pitchShift — tonal content uses SMS path', () => {
  let data = sine(330, 8192, fs)
  let out = pitchShift(data, { semitones: 3, content: 'tonal' })
  is(out.length, data.length)
  ok(rms(out) > 0.05, 'has signal')
})

// --- Streaming ---
function testStream(name, fn, streamOpts = {}) {
  let factor = streamOpts.factor ?? 2
  let chunkSize = streamOpts.chunkSize ?? 4096
  let lenTol = streamOpts.lenTol ?? 0.15
  let energyTol = streamOpts.energyTol ?? 0.3

  test(`${name} writer — matches batch output`, () => {
    let data = sine(440, 16384, fs)
    let batch = fn(data, { factor })
    let batchRms = rms(batch)

    let write = fn({ factor })
    let chunks = []
    for (let i = 0; i < data.length; i += chunkSize) {
      let chunk = data.subarray(i, Math.min(i + chunkSize, data.length))
      let out = write(chunk)
      if (out.length) chunks.push(out)
    }
    let tail = write()
    if (tail.length) chunks.push(tail)

    let total = chunks.reduce((s, c) => s + c.length, 0)
    ok(total > 0, 'produces output')
    // length should be in the ballpark of batch
    almost(total, batch.length, batch.length * lenTol, 'similar length')

    // assemble and compare RMS
    let assembled = new Float32Array(total)
    let off = 0
    for (let c of chunks) { assembled.set(c, off); off += c.length }
    let streamRms = rms(assembled)
    ok(streamRms > 0.05, 'has signal')
    almost(streamRms, batchRms, batchRms * energyTol, 'similar energy')
  })

  test(`${name} writer — handles small chunks`, () => {
    let data = sine(440, 8192, fs)
    let write = fn({ factor })
    let chunks = []
    // feed in very small chunks (512 samples)
    for (let i = 0; i < data.length; i += 512) {
      let out = write(data.subarray(i, Math.min(i + 512, data.length)))
      if (out.length) chunks.push(out)
    }
    let tail = write()
    if (tail.length) chunks.push(tail)
    let total = chunks.reduce((s, c) => s + c.length, 0)
    ok(total > 0, 'produces output from small chunks')
  })

  test(`${name} writer — silence stays silent`, () => {
    let data = new Float32Array(8192)
    let write = fn({ factor })
    let chunks = []
    for (let i = 0; i < data.length; i += chunkSize) {
      let out = write(data.subarray(i, i + chunkSize))
      if (out.length) chunks.push(out)
    }
    let tail = write()
    if (tail.length) chunks.push(tail)
    let total = chunks.reduce((s, c) => s + c.length, 0)
    if (total > 0) {
      let assembled = new Float32Array(total)
      let off = 0
      for (let c of chunks) { assembled.set(c, off); off += c.length }
      almost(rms(assembled), 0, 0.001, 'silence preserved')
    }
  })
}

testStream('ola', ola)
testStream('wsola', wsola)
testStream('vocoder', vocoder)
testStream('phaseLock', phaseLock)
testStream('transient', transient)
testStream('paulstretch', paulstretch, { factor: 8, lenTol: 0.25, energyTol: 2 })
testStream('psola', psola, { lenTol: 0.25, energyTol: 0.5 })

// --- Extreme ratios ---
function testExtreme(name, fn, factor, minLen) {
  test(`${name} — extreme ratio ${factor}x`, () => {
    let data = sine(440, 16384, fs)
    let out = fn(data, { factor })
    ok(out.length >= minLen, `output length ${out.length} >= ${minLen}`)
    ok(isFinite(rms(out)), 'no NaN/Infinity')
  })
}

testExtreme('ola', ola, 0.1, 100)
testExtreme('ola', ola, 10, 100000)
testExtreme('wsola', wsola, 0.1, 100)
testExtreme('wsola', wsola, 10, 100000)
testExtreme('vocoder', vocoder, 0.1, 100)
testExtreme('vocoder', vocoder, 10, 100000)
testExtreme('phaseLock', phaseLock, 0.1, 100)
testExtreme('phaseLock', phaseLock, 10, 100000)
testExtreme('transient', transient, 0.1, 100)
testExtreme('transient', transient, 10, 100000)
testExtreme('psola', psola, 0.1, 100)
testExtreme('psola', psola, 10, 100000)
testExtreme('paulstretch', paulstretch, 100, 1000000)

// --- Formant pitch shift ---
test('formantShift — 0 semitones returns copy', () => {
  let data = sine(440, 8192, fs)
  let out = formantShift(data, { semitones: 0 })
  is(out.length, data.length)
  almost(rms(out), rms(data), 0.01)
})

test('formantShift — preserves length', () => {
  let data = sine(440, 8192, fs)
  let out = formantShift(data, { semitones: 5 })
  is(out.length, data.length)
  ok(rms(out) > 0.1, 'has signal')
})

test('formantShift — +12 semitones doubles frequency', () => {
  let data = sine(220, 16384, fs)
  let out = formantShift(data, { semitones: 12 })
  let freq = peakFreq(out, fs)
  almost(freq, 440, 440 * 0.15, 'octave up')
})

test('formantShift — -12 semitones halves frequency', () => {
  let data = sine(440, 16384, fs)
  let out = formantShift(data, { semitones: -12 })
  let freq = peakFreq(out, fs)
  almost(freq, 220, 220 * 0.15, 'octave down')
})

test('formantShift — negative semitones', () => {
  let data = sine(440, 8192, fs)
  let out = formantShift(data, { semitones: -3 })
  is(out.length, data.length)
  ok(rms(out) > 0.1, 'has signal')
})

test('formantShift — ratio parameter', () => {
  let data = sine(440, 8192, fs)
  let out = formantShift(data, { ratio: 1.5 })
  is(out.length, data.length)
  ok(rms(out) > 0.1, 'has signal')
})

test('pitchShift — formant: true delegates', () => {
  let data = sine(440, 8192, fs)
  let out = pitchShift(data, { semitones: 5, formant: true })
  is(out.length, data.length)
  ok(rms(out) > 0.1, 'has signal')
})

// --- Formant shift streaming ---
test('formantShift writer — matches batch output', () => {
  let data = sine(440, 16384, fs)
  let batch = formantShift(data, { semitones: 5 })
  let batchRms = rms(batch)

  let write = formantShift({ semitones: 5 })
  let chunks = []
  for (let i = 0; i < data.length; i += 4096) {
    let chunk = data.subarray(i, Math.min(i + 4096, data.length))
    let out = write(chunk)
    if (out.length) chunks.push(out)
  }
  let tail = write()
  if (tail.length) chunks.push(tail)

  let total = chunks.reduce((s, c) => s + c.length, 0)
  ok(total > 0, 'produces output')
  almost(total, batch.length, batch.length * 0.15, 'similar length')

  let assembled = new Float32Array(total)
  let off = 0
  for (let c of chunks) { assembled.set(c, off); off += c.length }
  let streamRms = rms(assembled)
  ok(streamRms > 0.05, 'has signal')
  almost(streamRms, batchRms, batchRms * 0.5, 'similar energy')
})

test('formantShift writer — handles small chunks', () => {
  let data = sine(440, 8192, fs)
  let write = formantShift({ semitones: 5 })
  let chunks = []
  for (let i = 0; i < data.length; i += 512) {
    let out = write(data.subarray(i, Math.min(i + 512, data.length)))
    if (out.length) chunks.push(out)
  }
  let tail = write()
  if (tail.length) chunks.push(tail)
  let total = chunks.reduce((s, c) => s + c.length, 0)
  ok(total > 0, 'produces output from small chunks')
})

test('formantShift writer — silence stays silent', () => {
  let data = new Float32Array(8192)
  let write = formantShift({ semitones: 5 })
  let chunks = []
  for (let i = 0; i < data.length; i += 4096) {
    let out = write(data.subarray(i, i + 4096))
    if (out.length) chunks.push(out)
  }
  let tail = write()
  if (tail.length) chunks.push(tail)
  let total = chunks.reduce((s, c) => s + c.length, 0)
  if (total > 0) {
    let assembled = new Float32Array(total)
    let off = 0
    for (let c of chunks) { assembled.set(c, off); off += c.length }
    almost(rms(assembled), 0, 0.001, 'silence preserved')
  }
})

// --- Multi-channel (stereo) ---
// All algorithms process mono Float32Array. Stereo is handled by splitting channels.
// These tests verify the split→process→recombine pattern works correctly.

function stereoTest(name, fn, opts) {
  test(`${name} — stereo split/process/recombine`, () => {
    // Two different sine waves per channel
    let n = 8192
    let L = sine(440, n, fs)
    let R = sine(660, n, fs)

    let outL = fn(L, opts)
    let outR = fn(R, opts)

    ok(outL.length > 0, 'left channel has output')
    ok(outR.length > 0, 'right channel has output')
    is(outL.length, outR.length, 'channels same length')
    ok(rms(outL) > 0.05, 'left has signal')
    ok(rms(outR) > 0.05, 'right has signal')

    // Channels should differ (different input frequencies)
    let diff = 0
    let len = Math.min(outL.length, outR.length)
    for (let i = 0; i < len; i++) diff += Math.abs(outL[i] - outR[i])
    ok(diff / len > 0.01, 'channels are different')
  })

  test(`${name} writer — stereo split/process/recombine`, () => {
    let n = 16384
    let L = sine(440, n, fs)
    let R = sine(660, n, fs)

    let wL = fn(opts)
    let wR = fn(opts)
    let chunksL = [], chunksR = []

    for (let i = 0; i < n; i += 4096) {
      let cL = wL(L.subarray(i, Math.min(i + 4096, n)))
      let cR = wR(R.subarray(i, Math.min(i + 4096, n)))
      if (cL.length) chunksL.push(cL)
      if (cR.length) chunksR.push(cR)
    }
    let tL = wL(), tR = wR()
    if (tL.length) chunksL.push(tL)
    if (tR.length) chunksR.push(tR)

    let totalL = chunksL.reduce((s, c) => s + c.length, 0)
    let totalR = chunksR.reduce((s, c) => s + c.length, 0)

    ok(totalL > 0, 'left stream has output')
    ok(totalR > 0, 'right stream has output')
    almost(totalL, totalR, totalL * 0.05, 'stream channels similar length')
  })
}

stereoTest('ola', ola, { factor: 1.5 })
stereoTest('wsola', wsola, { factor: 1.5 })
stereoTest('vocoder', vocoder, { factor: 1.5 })
stereoTest('phaseLock', phaseLock, { factor: 1.5 })
stereoTest('transient', transient, { factor: 1.5 })
stereoTest('paulstretch', paulstretch, { factor: 4 })
stereoTest('psola', psola, { factor: 1.5 })

// --- SMS (Sinusoidal Modeling Synthesis) ---
testStretch('sms', sms, { rmsTol: 0.2, freqTol: 0.1 })
testStream('sms', sms, { energyTol: 0.5 })
testExtreme('sms', sms, 0.1, 100)
testExtreme('sms', sms, 10, 100000)
stereoTest('sms', sms, { factor: 1.5 })

// --- Quality metrics ---
test('transient — preserves attack sharpness', () => {
  let n = 16384
  let data = new Float32Array(n)
  for (let i = 0; i < n; i += 2048) {
    for (let j = 0; j < 64 && i + j < n; j++) data[i + j] = Math.sin(2 * Math.PI * 440 * j / fs) * (1 - j / 64)
  }
  let out = transient(data, { factor: 2 })
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  ok(peak > 0.3, `transient peaks preserved (peak=${peak.toFixed(3)})`)
})

test('sms — noise residual energy preservation', () => {
  let n = 8192, seed = 0x12345
  let data = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    data[i] = (seed / 0x100000000 - 0.5) * 0.6
  }
  let out = sms(data, { factor: 2, residualMix: 1 })
  ok(rms(out) > rms(data) * 0.3, 'noise energy preserved via residual')
})

test('phaseLock — spectral purity on sine', () => {
  let data = sine(440, 16384, fs)
  let out = phaseLock(data, { factor: 1.5 })
  let freq = peakFreq(out, fs)
  almost(freq, 440, 22, 'frequency drift < 5%')
})
