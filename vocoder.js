import fft from 'fourier-transform'
import { hann } from 'window-function'

/**
 * Phase vocoder time-stretching.
 * STFT → phase advance by stretch factor → ISTFT.
 *
 * @param {Float32Array} data - mono audio samples
 * @param {{factor: number, fs?: number, frameSize?: number, hopSize?: number}} params
 * @returns {Float32Array} stretched audio (new buffer)
 */
export default function vocoder(data, params) {
  let factor = params?.factor ?? 1
  if (factor === 1) return new Float32Array(data)

  let frameSize = params?.frameSize || 2048
  let hopSize = params?.hopSize || 512
  let half = frameSize >> 1

  let inLen = data.length
  let outLen = Math.round(inLen * factor)
  let out = new Float32Array(outLen)
  let norm = new Float32Array(outLen)

  // analysis/synthesis windows
  let win = new Float64Array(frameSize)
  for (let i = 0; i < frameSize; i++) win[i] = hann(i, frameSize)

  let anaHop = hopSize / factor
  let synHop = hopSize

  // phase tracking
  let prevPhase = new Float64Array(half + 1)
  let sumPhase = new Float64Array(half + 1)
  let freq = 2 * Math.PI / frameSize

  let anaPos = 0
  let synPos = 0

  while (synPos + frameSize < outLen && Math.round(anaPos) + frameSize <= inLen) {
    let readPos = Math.round(anaPos)

    // windowed analysis frame
    let frame = new Float64Array(frameSize)
    for (let i = 0; i < frameSize; i++) frame[i] = (data[readPos + i] || 0) * win[i]

    // FFT — extract magnitude and phase
    let re = new Float64Array(frameSize)
    let im = new Float64Array(frameSize)
    for (let i = 0; i < frameSize; i++) re[i] = frame[i]
    dft(re, im)

    let mag = new Float64Array(half + 1)
    let phase = new Float64Array(half + 1)
    for (let k = 0; k <= half; k++) {
      mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
      phase[k] = Math.atan2(im[k], re[k])
    }

    // phase advance
    for (let k = 0; k <= half; k++) {
      let expected = k * freq * anaHop
      let dp = phase[k] - prevPhase[k] - expected
      // wrap to [-pi, pi]
      dp = dp - Math.round(dp / (2 * Math.PI)) * 2 * Math.PI
      let trueFreq = k * freq + dp / anaHop
      sumPhase[k] += trueFreq * synHop
    }

    prevPhase.set(phase)

    // ISTFT: reconstruct from modified phase
    let re2 = new Float64Array(frameSize)
    let im2 = new Float64Array(frameSize)
    for (let k = 0; k <= half; k++) {
      re2[k] = mag[k] * Math.cos(sumPhase[k])
      im2[k] = mag[k] * Math.sin(sumPhase[k])
      if (k > 0 && k < half) {
        re2[frameSize - k] = re2[k]
        im2[frameSize - k] = -im2[k]
      }
    }
    idft(re2, im2)

    // overlap-add with window
    for (let i = 0; i < frameSize && synPos + i < outLen; i++) {
      out[synPos + i] += re2[i] * win[i]
      norm[synPos + i] += win[i] * win[i]
    }

    anaPos += anaHop
    synPos += synHop
  }

  // normalize
  for (let i = 0; i < outLen; i++) {
    if (norm[i] > 1e-8) out[i] /= norm[i]
  }

  return out
}

// minimal DFT/IDFT (replace with FFT for performance)
function dft(re, im) {
  let n = re.length
  let tre = new Float64Array(n), tim = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      let angle = -2 * Math.PI * k * j / n
      tre[k] += re[j] * Math.cos(angle) - im[j] * Math.sin(angle)
      tim[k] += re[j] * Math.sin(angle) + im[j] * Math.cos(angle)
    }
  }
  re.set(tre); im.set(tim)
}

function idft(re, im) {
  let n = re.length
  let tre = new Float64Array(n), tim = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      let angle = 2 * Math.PI * k * j / n
      tre[k] += re[j] * Math.cos(angle) - im[j] * Math.sin(angle)
      tim[k] += re[j] * Math.sin(angle) + im[j] * Math.cos(angle)
    }
  }
  for (let i = 0; i < n; i++) { re[i] = tre[i] / n; im[i] = tim[i] / n }
}
