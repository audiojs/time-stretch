import phaseLock from './phase-lock.js'
import wsola from './wsola.js'
import formantShift from './formant-shift.js'
import { resample } from './util.js'

/**
 * Pitch shifting via time-stretch + resample.
 * With formant: true, uses cepstral envelope to preserve formants.
 *
 * @param {Float32Array} data - mono audio samples
 * @param {{semitones?: number, ratio?: number, formant?: boolean, method?: Function, frameSize?: number, hopSize?: number}} opts
 * @returns {Float32Array} pitch-shifted audio (same length as input)
 */
export default function pitchShift(data, opts) {
  if (opts?.formant) return formantShift(data, opts)

  let semitones = opts?.semitones ?? 0
  let ratio = opts?.ratio ?? (semitones ? Math.pow(2, semitones / 12) : 1)
  if (ratio === 1) return new Float32Array(data)

  let method = opts?.method || phaseLock

  // time-stretch by pitch ratio, then resample to original length
  // raising pitch (ratio>1) → stretch longer → resample shorter = pitch up
  let stretched = method(data, { ...opts, factor: ratio })

  // resample back to original length
  return resample(stretched, data.length)
}
