import { hannWindow, writer, makeStreamBufs } from './util.js'

function overlapLength(frameSize, synHop, pos, limit) {
  // Cap correlation window: for large frames (≥2048) the full frameSize-synHop overlap
  // wastes cycles on low-energy Hann-tapered samples. frameSize/2 retains the high-energy
  // portion of the overlap while cutting the search cost by ~33%. For small frames the
  // full overlap is cheap enough and matters more for quality.
  let maxOvl = frameSize >= 2048 ? frameSize >> 1 : frameSize - synHop
  return Math.max(0, Math.min(maxOvl, pos, limit - pos))
}

export default function wsola(data, opts) {
  if (!(data instanceof Float32Array)) return writer(wsolaStream(data))

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
      // Subsample the correlation by 2: halves the inner loop cost with negligible
      // quality impact — the correlation peak is broad (spans multiple samples) so
      // skipping odd indices doesn't shift the winner.
      let step = overlapLen > 768 ? 2 : 1
      let bestCorr = -Infinity, bestS = searchStart

      for (let s = searchStart; s <= searchEnd; s++) {
        let corr = 0
        for (let i = 0; i < overlapLen; i += step) corr += data[s + i] * out[synPos + i]
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

  for (let i = 0; i < outLen; i++) if (norm[i] > 1e-8) out[i] /= norm[i]
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

  let st = makeStreamBufs(frameSize)
  let aPos = 0

  function run() {
    while (Math.round(aPos) + frameSize <= st.il) {
      let nomPos = Math.round(aPos)
      let readPos = nomPos

      if (st.pos > 0 && delta > 0) {
        let searchS = Math.max(0, nomPos - delta)
        let searchE = Math.min(st.il - frameSize, nomPos + delta)
        if (searchE < searchS) break
        let overlap = overlapLength(frameSize, synHop, st.pos, st.ob.length)
        let step = overlap > 768 ? 2 : 1
        let bestCorr = -Infinity, bestS = searchS
        let ib = st.ib, ob = st.ob, corBase = st.pos
        for (let s = searchS; s <= searchE; s++) {
          let corr = 0
          for (let i = 0; i < overlap; i += step) corr += ib[s + i] * ob[corBase + i]
          if (corr > bestCorr) { bestCorr = corr; bestS = s }
        }
        readPos = bestS
      }

      if (readPos + frameSize > st.il) break

      st.growOut(st.pos + frameSize)
      let ob = st.ob, nb = st.nb, base = st.pos, ib = st.ib
      for (let i = 0; i < frameSize; i++) {
        ob[base + i] += ib[readPos + i] * win[i]
        nb[base + i] += win[i]
      }
      aPos += anaHop
      st.pos += synHop
    }
    let used = Math.floor(aPos)
    if (used > frameSize * 2 + delta) {
      let trim = used - frameSize - delta
      st.compactIn(trim)
      aPos -= trim
    }
  }

  return {
    write(chunk) {
      st.appendIn(chunk)
      run()
      return st.take(Math.max(0, st.pos - frameSize + synHop))
    },
    flush() {
      run()
      return st.take(st.pos)
    }
  }
}
