/**
 * Pitch-Synchronous Overlap-Add — time-domain stretch for speech/monophonic signals.
 * Detects pitch via autocorrelation, uses pitch-synchronous grains for artifact-free stretching.
 *
 * @param {Float32Array} data - mono audio samples
 * @param {{factor?: number, sampleRate?: number, minFreq?: number, maxFreq?: number}} opts
 * @returns {Float32Array} time-stretched audio
 */

const PI2 = Math.PI * 2

function detectPeriod(data, pos, minP, maxP, end) {
  if (pos + maxP * 2 > end) return 0
  let best = 0, bestVal = -Infinity
  for (let lag = minP; lag <= maxP; lag++) {
    let sum = 0, e1 = 0, e2 = 0
    let n = maxP * 2 - lag
    for (let i = 0; i < n; i++) {
      let a = data[pos + i], b = data[pos + i + lag]
      sum += a * b
      e1 += a * a
      e2 += b * b
    }
    let d = Math.sqrt(e1 * e2)
    let c = d > 1e-10 ? sum / d : 0
    if (c > bestVal) { bestVal = c; best = lag }
  }
  return bestVal > 0.3 ? best : 0
}

function grain(data, aPos, period, out, norm, sPos, outLen) {
  let winLen = period * 2
  let sStart = sPos - period
  for (let i = 0; i < winLen; i++) {
    let si = sStart + i
    if (si < 0 || si >= outLen) continue
    let ai = aPos - period + i
    let w = 0.5 * (1 - Math.cos(PI2 * i / (winLen - 1 || 1)))
    out[si] += (ai >= 0 && ai < data.length ? data[ai] : 0) * w
    norm[si] += w
  }
}

export default function psola(data, opts) {
  let factor = opts?.factor ?? 1
  if (factor === 1) return new Float32Array(data)

  let sr = opts?.sampleRate || 44100
  let minP = Math.floor(sr / (opts?.maxFreq || 500))
  let maxP = Math.ceil(sr / (opts?.minFreq || 80))
  let defP = Math.round((minP + maxP) / 2)

  let n = data.length
  let outLen = Math.round(n * factor)
  let out = new Float32Array(outLen)
  let norm = new Float32Array(outLen)

  let aPos = maxP, synPos = maxP * factor
  while (aPos + maxP < n) {
    let period = detectPeriod(data, aPos - maxP, minP, maxP, n) || defP
    grain(data, aPos, period, out, norm, Math.round(synPos), outLen)
    aPos += period
    synPos += period * factor
  }

  for (let i = 0; i < outLen; i++) if (norm[i] > 1e-8) out[i] /= norm[i]
  return out
}

psola.stream = function (opts) {
  let factor = opts?.factor ?? 1
  let sr = opts?.sampleRate || 44100
  let minP = Math.floor(sr / (opts?.maxFreq || 500))
  let maxP = Math.ceil(sr / (opts?.minFreq || 80))
  let defP = Math.round((minP + maxP) / 2)

  let inBuf = new Float32Array(maxP * 16)
  let inLen = 0
  let outBuf = new Float32Array(maxP * 32)
  let normBuf = new Float32Array(maxP * 32)
  let aPos = maxP, sPos = maxP * factor, oRead = 0

  function appendIn(chunk) {
    let need = inLen + chunk.length
    if (need > inBuf.length) {
      let nb = new Float32Array(Math.max(need * 2, inBuf.length * 2))
      nb.set(inBuf.subarray(0, inLen))
      inBuf = nb
    }
    inBuf.set(chunk, inLen)
    inLen += chunk.length
  }

  function run() {
    while (aPos + maxP < inLen) {
      let period = detectPeriod(inBuf, aPos - maxP, minP, maxP, inLen) || defP
      let sSt = Math.round(sPos)
      let need = sSt + period + 1
      if (need > outBuf.length) {
        let len = Math.max(need * 2, outBuf.length * 2)
        let ob = new Float32Array(len), nb = new Float32Array(len)
        ob.set(outBuf); nb.set(normBuf)
        outBuf = ob; normBuf = nb
      }
      grain(inBuf, aPos, period, outBuf, normBuf, sSt, outBuf.length)
      aPos += period
      sPos += period * factor
    }
    // trim consumed input
    let safe = Math.floor(aPos) - maxP * 2
    if (safe > maxP * 4) {
      let trim = safe
      inBuf.copyWithin(0, trim, inLen)
      inLen -= trim
      aPos -= trim
    }
  }

  function take(upTo) {
    upTo = Math.min(upTo, Math.round(sPos) - maxP)
    if (upTo <= oRead) return new Float32Array(0)
    let len = Math.floor(upTo - oRead)
    let out = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      let j = oRead + i
      out[i] = normBuf[j] > 1e-8 ? outBuf[j] / normBuf[j] : 0
    }
    oRead += len
    if (oRead > maxP * 16) {
      let shift = oRead
      outBuf.copyWithin(0, shift)
      normBuf.copyWithin(0, shift)
      sPos -= shift
      oRead = 0
      outBuf.fill(0, Math.ceil(sPos))
      normBuf.fill(0, Math.ceil(sPos))
    }
    return out
  }

  return {
    write(chunk) {
      appendIn(chunk)
      run()
      return take(Math.round(sPos) - maxP)
    },
    flush() {
      return take(Math.round(sPos))
    }
  }
}
