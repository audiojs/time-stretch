import test, { almost, ok, is } from 'tst'
import { wsola, vocoder, pitchShift } from './index.js'

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

// --- WSOLA ---

test('wsola — factor 1 returns copy', () => {
  let data = sine(440, 4096, fs)
  let out = wsola(data, { factor: 1 })
  is(out.length, data.length)
  almost(rms(out), rms(data), 0.01)
})

test('wsola — factor 2 doubles length', () => {
  let data = sine(440, 4096, fs)
  let out = wsola(data, { factor: 2, fs })
  almost(out.length, data.length * 2, data.length * 0.1)
  ok(rms(out) > 0.1, 'has signal')
})

test('wsola — factor 0.5 halves length', () => {
  let data = sine(440, 8192, fs)
  let out = wsola(data, { factor: 0.5, fs })
  almost(out.length, data.length * 0.5, data.length * 0.1)
  ok(rms(out) > 0.1, 'has signal')
})

// --- Phase vocoder ---

test('vocoder — factor 1 returns copy', () => {
  let data = sine(440, 4096, fs)
  let out = vocoder(data, { factor: 1 })
  is(out.length, data.length)
})

test('vocoder — factor 2 doubles length', () => {
  let data = sine(440, 4096, fs)
  let out = vocoder(data, { factor: 2, fs })
  almost(out.length, data.length * 2, data.length * 0.1)
  ok(rms(out) > 0.1, 'has signal')
})

// --- Pitch shift ---

test('pitchShift — 0 semitones returns copy', () => {
  let data = sine(440, 4096, fs)
  let out = pitchShift(data, { semitones: 0 })
  is(out.length, data.length)
})

test('pitchShift — preserves length', () => {
  let data = sine(440, 4096, fs)
  let out = pitchShift(data, { semitones: 5, fs })
  is(out.length, data.length)
  ok(rms(out) > 0.1, 'has signal')
})

test('pitchShift — negative semitones', () => {
  let data = sine(440, 4096, fs)
  let out = pitchShift(data, { semitones: -3, fs })
  is(out.length, data.length)
  ok(rms(out) > 0.1, 'has signal')
})
