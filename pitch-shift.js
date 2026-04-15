import vocoder from './vocoder.js'
import { resample } from './util.js'

// Pitch shift via time-stretch + resample.
// For content-aware algorithm selection (voice, tonal, etc.), call psola/sms directly.
export default function pitchShift(data, opts) {
  let ratio = opts?.ratio ?? Math.pow(2, (opts?.semitones ?? 0) / 12)
  if (!Number.isFinite(ratio) || ratio <= 0) throw new TypeError('pitchShift: ratio must be a positive finite number')
  if (ratio === 1) return new Float32Array(data)
  return resample(vocoder(data, { ...opts, factor: ratio, transients: true }), data.length)
}
