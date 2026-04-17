import { hannWindow, writer, makeStreamBufs } from './util.js'

// Canonical Verhelst-Roelands WSOLA: each grain's read position is chosen to maximize
// cross-correlation with the *natural progression* of the previous grain through the
// input — i.e. data[prevRead + synHop : ...]. Correlating against the synthesis output
// (a sum of previous compromise grains) lets phase errors compound across grains and
// causes hop-rate amplitude modulation ("crumble") on polyphonic content. The input
// target is clean and gives the same result for monophonic signals at no extra cost.
function corrLength(frameSize, synHop) {
  // Overlap region. For large frames (≥2048) cap at frameSize/2 — the Hann taper
  // makes outer samples low-energy so they barely shift the correlation peak,
  // and halving the loop cuts search cost by ~33%.
  return frameSize >= 2048 ? frameSize >> 1 : frameSize - synHop
}

export default function wsola(data, opts) {
  if (!(data instanceof Float32Array)) return writer(wsolaStream(data))

  let factor = opts?.factor ?? 1
  if (factor === 1) return new Float32Array(data)

  let frameSize = opts?.frameSize ?? 2048
  let hopSize = opts?.hopSize ?? (frameSize >> 2)
  let delta = opts?.delta ?? (frameSize >> 2)

  let inLen = data.length
  let outLen = Math.round(inLen * factor)
  let out = new Float32Array(outLen)
  let norm = new Float32Array(outLen)

  let synHop = hopSize
  let anaHop = hopSize / factor
  let win = hannWindow(frameSize)
  let corrLen = corrLength(frameSize, synHop)

  let anaPos = 0, synPos = 0
  let prevReadPos = 0

  while (synPos + frameSize <= outLen) {
    let nomPos = Math.round(anaPos)
    let readPos = nomPos

    if (synPos > 0 && delta > 0) {
      let searchStart = Math.max(0, nomPos - delta)
      let searchEnd = Math.min(inLen - frameSize, nomPos + delta)
      if (searchEnd < searchStart) break

      let targetStart = prevReadPos + synHop
      let L = Math.min(corrLen, inLen - targetStart, inLen - searchEnd)
      if (L > 0) {
        let step = L > 768 ? 2 : 1
        let bestCorr = -Infinity, bestS = searchStart
        for (let s = searchStart; s <= searchEnd; s++) {
          let corr = 0
          for (let i = 0; i < L; i += step) corr += data[s + i] * data[targetStart + i]
          if (corr > bestCorr) { bestCorr = corr; bestS = s }
        }
        readPos = bestS
      }
    }

    if (readPos + frameSize > inLen) break

    for (let i = 0; i < frameSize && synPos + i < outLen; i++) {
      out[synPos + i] += data[readPos + i] * win[i]
      norm[synPos + i] += win[i]
    }

    prevReadPos = readPos
    anaPos += anaHop
    synPos += synHop
  }

  for (let i = 0; i < outLen; i++) if (norm[i] > 1e-8) out[i] /= norm[i]
  return out
}

function wsolaStream(opts) {
  let factor = opts?.factor ?? 1
  let frameSize = opts?.frameSize ?? 2048
  let hopSize = opts?.hopSize ?? (frameSize >> 2)
  let delta = opts?.delta ?? (frameSize >> 2)
  let win = hannWindow(frameSize)
  let synHop = hopSize
  let anaHop = hopSize / factor
  let corrLen = corrLength(frameSize, synHop)

  let st = makeStreamBufs(frameSize)
  let aPos = 0
  // Track absolute position of last read so the natural-progression target
  // survives input compaction (st.compactIn shifts ib).
  let prevReadAbs = 0
  let inOffset = 0  // absolute position of ib[0]

  function run() {
    while (Math.round(aPos) + frameSize <= st.il) {
      let nomPos = Math.round(aPos)
      let readPos = nomPos

      if (st.pos > 0 && delta > 0) {
        let searchS = Math.max(0, nomPos - delta)
        let searchE = Math.min(st.il - frameSize, nomPos + delta)
        if (searchE < searchS) break
        let targetStart = (prevReadAbs - inOffset) + synHop
        let L = Math.min(corrLen, st.il - targetStart, st.il - searchE)
        if (targetStart >= 0 && L > 0) {
          let step = L > 768 ? 2 : 1
          let bestCorr = -Infinity, bestS = searchS
          let ib = st.ib
          for (let s = searchS; s <= searchE; s++) {
            let corr = 0
            for (let i = 0; i < L; i += step) corr += ib[s + i] * ib[targetStart + i]
            if (corr > bestCorr) { bestCorr = corr; bestS = s }
          }
          readPos = bestS
        }
      }

      if (readPos + frameSize > st.il) break

      st.growOut(st.pos + frameSize)
      let ob = st.ob, nb = st.nb, base = st.pos, ib = st.ib
      for (let i = 0; i < frameSize; i++) {
        ob[base + i] += ib[readPos + i] * win[i]
        nb[base + i] += win[i]
      }
      prevReadAbs = inOffset + readPos
      aPos += anaHop
      st.pos += synHop
    }
    let used = Math.floor(aPos)
    if (used > frameSize * 2 + delta) {
      let trim = used - frameSize - delta
      st.compactIn(trim)
      aPos -= trim
      inOffset += trim
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
