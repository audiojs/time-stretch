import { hannWindow, normalize } from './util.js'

export default function ola(data, opts) {
  if (!(data instanceof Float32Array)) {
    let s = olaStream(data)
    return (chunk) => chunk ? s.write(chunk) : s.flush()
  }

  let factor = opts?.factor ?? 1
  if (factor === 1) return new Float32Array(data)

  let frameSize = opts?.frameSize || 2048
  let hopSize = opts?.hopSize || (frameSize >> 2)

  let inLen = data.length
  let outLen = Math.round(inLen * factor)
  let out = new Float32Array(outLen)
  let norm = new Float32Array(outLen)

  // Hybrid hop strategy:
  // Stretching (factor>1): fixed analysis hop, variable synthesis hop → fewer output overlaps → better pitch
  // Compression (factor<1): fixed synthesis hop, variable analysis hop → limits output overlap → avoids resampling
  let anaHop = factor >= 1 ? hopSize : Math.round(hopSize / factor)
  let synHop = factor >= 1 ? Math.round(hopSize * factor) : hopSize
  let win = hannWindow(frameSize)

  let anaPos = 0, synPos = 0

  while (anaPos + frameSize <= inLen && synPos + frameSize <= outLen) {
    for (let i = 0; i < frameSize && synPos + i < outLen; i++) {
      out[synPos + i] += data[anaPos + i] * win[i]
      norm[synPos + i] += win[i]
    }

    anaPos += anaHop
    synPos += synHop
  }

  normalize(out, norm)
  return out
}

function olaStream(opts) {
  let factor = opts?.factor ?? 1
  let frameSize = opts?.frameSize || 2048
  let hopSize = opts?.hopSize || (frameSize >> 2)
  let win = hannWindow(frameSize)
  let anaHop = factor >= 1 ? hopSize : Math.round(hopSize / factor)
  let synHop = factor >= 1 ? Math.round(hopSize * factor) : hopSize

  let inBuf = new Float32Array(frameSize * 4)
  let inLen = 0
  let outBuf = new Float32Array(frameSize * 8)
  let normBuf = new Float32Array(frameSize * 8)
  let aPos = 0, sPos = 0, oRead = 0

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
    while (aPos + frameSize <= inLen) {
      let need = sPos + frameSize
      if (need > outBuf.length) {
        let len = need * 2
        let ob = new Float32Array(len), nb = new Float32Array(len)
        ob.set(outBuf); nb.set(normBuf)
        outBuf = ob; normBuf = nb
      }
      for (let i = 0; i < frameSize; i++) {
        outBuf[sPos + i] += inBuf[aPos + i] * win[i]
        normBuf[sPos + i] += win[i]
      }
      aPos += anaHop
      sPos += synHop
    }
    let used = aPos
    if (used > frameSize * 2) {
      let trim = used - frameSize
      inBuf.copyWithin(0, trim, inLen)
      inLen -= trim
      aPos -= trim
    }
  }

  function take(upTo) {
    upTo = Math.min(upTo, sPos)
    if (upTo <= oRead) return new Float32Array(0)
    let len = Math.floor(upTo - oRead)
    let out = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      let j = oRead + i
      out[i] = normBuf[j] > 1e-8 ? outBuf[j] / normBuf[j] : 0
    }
    oRead += len
    if (oRead > frameSize * 8) {
      outBuf.copyWithin(0, oRead)
      normBuf.copyWithin(0, oRead)
      sPos -= oRead
      oRead = 0
      outBuf.fill(0, sPos)
      normBuf.fill(0, sPos)
    }
    return out
  }

  return {
    write(chunk) {
      appendIn(chunk)
      run()
      return take(Math.max(0, sPos - frameSize + synHop))
    },
    flush() {
      run()
      return take(sPos)
    }
  }
}
