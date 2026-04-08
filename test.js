import test, { almost, ok, is } from 'tst'
import { ola, wsola, vocoder, phaseLock, transient, paulstretch, pitchShift } from './index.js'

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
testStretch('ola', ola, { freqTol: 0.3, rmsTol: 0.3 })

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

// --- Streaming ---
function testStream(name, fn, streamOpts = {}) {
  let factor = streamOpts.factor ?? 2
  let chunkSize = streamOpts.chunkSize ?? 4096
  let lenTol = streamOpts.lenTol ?? 0.15

  test(`${name}.stream — matches batch output`, () => {
    let data = sine(440, 16384, fs)
    let batch = fn(data, { factor })
    let batchRms = rms(batch)

    let stream = fn.stream({ factor })
    let chunks = []
    for (let i = 0; i < data.length; i += chunkSize) {
      let chunk = data.subarray(i, Math.min(i + chunkSize, data.length))
      let out = stream.write(chunk)
      if (out.length) chunks.push(out)
    }
    let tail = stream.flush()
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
    almost(streamRms, batchRms, batchRms * 0.3, 'similar energy')
  })

  test(`${name}.stream — handles small chunks`, () => {
    let data = sine(440, 8192, fs)
    let stream = fn.stream({ factor })
    let chunks = []
    // feed in very small chunks (512 samples)
    for (let i = 0; i < data.length; i += 512) {
      let out = stream.write(data.subarray(i, Math.min(i + 512, data.length)))
      if (out.length) chunks.push(out)
    }
    let tail = stream.flush()
    if (tail.length) chunks.push(tail)
    let total = chunks.reduce((s, c) => s + c.length, 0)
    ok(total > 0, 'produces output from small chunks')
  })

  test(`${name}.stream — silence stays silent`, () => {
    let data = new Float32Array(8192)
    let stream = fn.stream({ factor })
    let chunks = []
    for (let i = 0; i < data.length; i += chunkSize) {
      let out = stream.write(data.subarray(i, i + chunkSize))
      if (out.length) chunks.push(out)
    }
    let tail = stream.flush()
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
testStream('paulstretch', paulstretch, { factor: 8, lenTol: 0.25 })
