import { hannWindow, normalize } from './util.js'

function overlapLength(frameSize, synHop, pos, limit) {
  return Math.max(0, Math.min(frameSize - synHop, pos, limit - pos))
}

export default function wsola(data, opts) {
  if (!(data instanceof Float32Array)) {
    let s = wsolaStream(data)
    return (chunk) => chunk ? s.write(chunk) : s.flush()
  }

  let factor = opts?.factor ?? 1
  if (factor === 1) return new Float32Array(data)

  let frameSize = opts?.frameSize ?? 1024
  let hopSize = opts?.hopSize ?? (frameSize >> 2)
  let delta = opts?.delta ?? (frameSize >> 2)

  let inLen = data.length
  let outLen = Math.round(inLen * factor)
  let out = new Float32Array(outLen)
  let norm = new Float32Array(outLen)

  let synHop = hopSize
  let anaHop = hopSize / factor
  let win = hannWindow(frameSize)

  let anaPos = 0, synPos = 0

  while (synPos + frameSize <= outLen) {
    let nomPos = Math.round(anaPos)
    let readPos = nomPos

    if (synPos > 0 && delta > 0) {
      let searchStart = Math.max(0, nomPos - delta)
      let searchEnd = Math.min(inLen - frameSize, nomPos + delta)
      if (searchEnd < searchStart) break

      let overlapLen = overlapLength(frameSize, synHop, synPos, outLen)
      let bestCorr = -Infinity, bestS = searchStart

      for (let s = searchStart; s <= searchEnd; s++) {
        let corr = 0
        for (let i = 0; i < overlapLen; i++) corr += data[s + i] * out[synPos + i]
        if (corr > bestCorr) { bestCorr = corr; bestS = s }
      }
      readPos = bestS
    }

    if (readPos + frameSize > inLen) break

    for (let i = 0; i < frameSize && synPos + i < outLen; i++) {
      out[synPos + i] += data[readPos + i] * win[i]
      norm[synPos + i] += win[i]
    }

    anaPos += anaHop
    synPos += synHop
  }

  normalize(out, norm)
  return out
}

function wsolaStream(opts) {
  let factor = opts?.factor ?? 1
  let frameSize = opts?.frameSize ?? 1024
  let hopSize = opts?.hopSize ?? (frameSize >> 2)
  let delta = opts?.delta ?? (frameSize >> 2)
  let win = hannWindow(frameSize)
  let synHop = hopSize
  let anaHop = hopSize / factor

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
    while (Math.round(aPos) + frameSize <= inLen) {
      let nomPos = Math.round(aPos)
      let readPos = nomPos

      if (sPos > 0 && delta > 0) {
        let searchS = Math.max(0, nomPos - delta)
        let searchE = Math.min(inLen - frameSize, nomPos + delta)
        if (searchE < searchS) break
        let overlap = overlapLength(frameSize, synHop, sPos, outBuf.length)
        let bestCorr = -Infinity, bestS = searchS
        for (let s = searchS; s <= searchE; s++) {
          let corr = 0
          for (let i = 0; i < overlap; i++) corr += inBuf[s + i] * outBuf[sPos + i]
          if (corr > bestCorr) { bestCorr = corr; bestS = s }
        }
        readPos = bestS
      }

      if (readPos + frameSize > inLen) break

      let need = sPos + frameSize
      if (need > outBuf.length) {
        let len = need * 2
        let ob = new Float32Array(len), nb = new Float32Array(len)
        ob.set(outBuf); nb.set(normBuf)
        outBuf = ob; normBuf = nb
      }

      for (let i = 0; i < frameSize; i++) {
        outBuf[sPos + i] += inBuf[readPos + i] * win[i]
        normBuf[sPos + i] += win[i]
      }

      aPos += anaHop
      sPos += synHop
    }

    let used = Math.floor(aPos)
    if (used > frameSize * 2 + delta) {
      let trim = used - frameSize - delta
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
