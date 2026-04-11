import transient from './transient.js'
import psola from './psola.js'
import sms from './sms.js'
import formantShift from './formant-shift.js'
import { resample } from './util.js'

/**
 * Pitch shifting via time-stretch + resample.
 * With formant: true, uses spectral envelope to preserve formants.
 *
 * @param {Float32Array} data - mono audio samples
 * @param {{semitones?: number, ratio?: number, formant?: boolean, method?: Function, frameSize?: number, hopSize?: number, onDecision?: Function}} opts
 * @returns {Float32Array} pitch-shifted audio (same length as input)
 */
export default function pitchShift(data, opts) {
  if (opts?.formant) return formantShift(data, opts)

  let semitones = opts?.semitones ?? 0
  if (!Number.isFinite(semitones)) {
    throw new TypeError('pitchShift: `semitones` must be a finite number')
  }

  let ratio = opts?.ratio ?? (semitones ? Math.pow(2, semitones / 12) : 1)
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new TypeError('pitchShift: `ratio` must be a finite number greater than 0')
  }

  if (ratio === 1) return new Float32Array(data)

  let decision = opts?.method
    ? { method: opts.method, reason: 'explicit-method' }
    : defaultMethod(opts)

  if (typeof opts?.onDecision === 'function') {
    opts.onDecision({
      method: decision.method.name || 'anonymous',
      reason: decision.reason,
      ratio,
      semitones,
      content: opts?.content,
      formant: !!opts?.formant
    })
  }

  // time-stretch by pitch ratio, then resample to original length
  // raising pitch (ratio>1) → stretch longer → resample shorter = pitch up
  let stretched = decision.method(data, { ...opts, factor: ratio })

  // resample back to original length
  return resample(stretched, data.length)
}

function defaultMethod(opts) {
  switch (opts?.content) {
    case 'voice':
    case 'speech':
      return { method: psola, reason: `content:${opts.content}` }
    case 'tonal':
      return { method: sms, reason: 'content:tonal' }
    default:
      return { method: transient, reason: 'fallback:transient' }
  }
}
