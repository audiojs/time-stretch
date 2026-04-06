/**
 * WSOLA time-stretching (Verhelst & Roelands, 1993).
 * Waveform Similarity Overlap-Add: cross-correlation search for best frame alignment.
 * Time-domain only, no FFT needed.
 *
 * @param {Float32Array} data - mono audio samples
 * @param {{factor: number, fs?: number, frameSize?: number, hopSize?: number, delta?: number}} params
 * @returns {Float32Array} stretched audio (new buffer)
 */
export default function wsola(data, params) {
  let factor = params?.factor ?? 1
  if (factor === 1) return new Float32Array(data)

  let frameSize = params?.frameSize || 1024
  let hopSize = params?.hopSize || 256
  let delta = params?.delta || (frameSize >> 2)

  let inLen = data.length
  let outLen = Math.round(inLen * factor)
  let out = new Float32Array(outLen)
  let norm = new Float32Array(outLen) // normalization envelope

  // synthesis hop = hopSize, analysis hop = hopSize / factor
  let synHop = hopSize
  let anaHop = hopSize / factor

  // window (Hann)
  let win = new Float32Array(frameSize)
  for (let i = 0; i < frameSize; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)))

  let anaPos = 0
  let synPos = 0

  while (synPos + frameSize < outLen && anaPos + frameSize + delta < inLen) {
    // search for best alignment within [anaPos - delta, anaPos + delta]
    let bestOffset = 0
    if (synPos > 0) {
      let bestCorr = -Infinity
      let searchStart = Math.max(0, Math.round(anaPos) - delta)
      let searchEnd = Math.min(inLen - frameSize, Math.round(anaPos) + delta)

      for (let s = searchStart; s <= searchEnd; s++) {
        let corr = 0
        // cross-correlate with previous output tail
        let overlapLen = Math.min(frameSize, outLen - synPos, inLen - s)
        for (let i = 0; i < overlapLen; i++) {
          corr += data[s + i] * (norm[synPos + i] > 0 ? out[synPos + i] / norm[synPos + i] : 0)
        }
        if (corr > bestCorr) {
          bestCorr = corr
          bestOffset = s - Math.round(anaPos)
        }
      }
    }

    let readPos = Math.round(anaPos) + bestOffset

    // overlap-add with window
    for (let i = 0; i < frameSize && readPos + i < inLen && synPos + i < outLen; i++) {
      out[synPos + i] += data[readPos + i] * win[i]
      norm[synPos + i] += win[i]
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
