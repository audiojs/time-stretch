import wsola from './wsola.js'

/**
 * Pitch shifting via time-stretch + resample.
 * Stretch by 2^(semitones/12), then resample back to original length.
 *
 * @param {Float32Array} data - mono audio samples
 * @param {{semitones: number, fs?: number, frameSize?: number, hopSize?: number}} params
 * @returns {Float32Array} pitch-shifted audio (same length as input)
 */
export default function pitchShift(data, params) {
  let semitones = params?.semitones ?? 0
  if (semitones === 0) return new Float32Array(data)

  let factor = Math.pow(2, semitones / 12)

  // time-stretch: make it longer/shorter
  let stretched = wsola(data, { ...params, factor })

  // resample back to original length (linear interpolation)
  let outLen = data.length
  let out = new Float32Array(outLen)
  let ratio = stretched.length / outLen

  for (let i = 0; i < outLen; i++) {
    let pos = i * ratio
    let idx = Math.floor(pos)
    let frac = pos - idx
    let a = stretched[idx] || 0
    let b = stretched[idx + 1] || 0
    out[i] = a + (b - a) * frac
  }

  return out
}
