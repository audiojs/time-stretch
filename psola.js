/**
 * Pitch-Synchronous Overlap-Add — time-domain stretch for speech/monophonic signals.
 * Detects pitch via autocorrelation, uses pitch-synchronous grains for artifact-free stretching.
 *
 * @param {Float32Array} data - mono audio samples
 * @param {{factor?: number, sampleRate?: number, minFreq?: number, maxFreq?: number}} opts
 * @returns {Float32Array} time-stretched audio
 */

import wsola from './wsola.js'
import { clamp, normalize, writer } from './util.js'

const PI2 = Math.PI * 2

function detectPeriodRange(data, pos, minLag, maxLag, prevPeriod) {
  if (minLag > maxLag) return { period: 0, score: 0 }

  let corr = new Float64Array(maxLag + 2)
  let n = maxLag
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0, e1 = 0, e2 = 0
    for (let i = 0; i < n; i++) {
      let a = data[pos + i], b = data[pos + i + lag]
      sum += a * b
      e1 += a * a
      e2 += b * b
    }
    let d = Math.sqrt(e1 * e2)
    corr[lag] = d > 1e-10 ? sum / d : 0
  }

  let best = 0
  let bestScore = 0
  let bestMetric = -Infinity
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (corr[lag] < 0.3 || corr[lag] < corr[lag - 1] || corr[lag] < corr[lag + 1]) continue

    let score = corr[lag]
    let metric = score
    if (prevPeriod > 0) metric += 0.18 * Math.max(-1, 1 - Math.abs(Math.log(lag / prevPeriod)))

    let doubled = lag * 2
    if (doubled < maxLag && corr[doubled] >= score * 0.88 && corr[doubled] >= corr[doubled - 1] && corr[doubled] >= corr[doubled + 1]) {
      let doubledMetric = corr[doubled]
      if (prevPeriod > 0) doubledMetric += 0.18 * Math.max(-1, 1 - Math.abs(Math.log(doubled / prevPeriod)))
      if (doubledMetric > metric) {
        lag = doubled
        score = corr[lag]
        metric = doubledMetric
      }
    }

    if (metric > bestMetric) {
      bestMetric = metric
      bestScore = score
      best = lag
    }
  }

  if (!best) {
    let bestVal = -Infinity
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (corr[lag] > bestVal) {
        bestVal = corr[lag]
        best = lag
        bestScore = corr[lag]
      }
    }
  }

  if (bestScore <= 0.35 || !best) return { period: 0, score: Math.max(0, bestScore) }

  let period = best
  if (best > minLag && best < maxLag) {
    let ym1 = corr[best - 1]
    let y0 = corr[best]
    let yp1 = corr[best + 1]
    let denom = ym1 - 2 * y0 + yp1
    if (Math.abs(denom) > 1e-8) period += clamp(0.5 * (ym1 - yp1) / denom, -0.5, 0.5)
  }

  return { period, score: bestScore }
}

function reuseContourSample(cache, absCenter, hop, state) {
  if (!cache?.positions?.length) return null

  let positions = cache.positions
  let idx = state?.index || 0
  while (idx + 1 < positions.length && positions[idx + 1] <= absCenter) idx++
  if (state) state.index = idx

  let best = -1
  let bestDist = Infinity
  let start = Math.max(0, idx - 1)
  let end = Math.min(positions.length - 1, idx + 1)
  for (let i = start; i <= end; i++) {
    let dist = Math.abs(positions[i] - absCenter)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }

  if (best < 0 || bestDist > hop * 0.45) return null
  return {
    period: cache.periods[best],
    score: cache.scores[best],
    voiced: cache.voiced[best],
  }
}

function detectPeriod(data, pos, minP, maxP, end, prevPeriod = 0) {
  if (pos + maxP * 2 > end) return { period: 0, score: 0 }

  if (prevPeriod > 0) {
    let localMin = clamp(Math.floor(prevPeriod * 0.78), minP, maxP)
    let localMax = clamp(Math.ceil(prevPeriod * 1.28), minP, maxP)
    let local = detectPeriodRange(data, pos, localMin, localMax, prevPeriod)
    if (local.score >= 0.58) return local
  }

  return detectPeriodRange(data, pos, minP, maxP, prevPeriod)
}

function peakNear(data, center, radius) {
  let start = Math.max(1, center - radius)
  let end = Math.min(data.length - 2, center + radius)
  let best = clamp(Math.round(center), start, end)
  let bestVal = -Infinity
  for (let i = start; i <= end; i++) {
    let v = Math.abs(data[i])
    if (v >= Math.abs(data[i - 1]) && v >= Math.abs(data[i + 1])) {
      let score = v - 0.08 * Math.abs(i - center) / Math.max(1, radius)
      if (score > bestVal) {
        best = i
        bestVal = score
      }
    }
  }
  if (bestVal > -Infinity) return best

  for (let i = start; i <= end; i++) {
    let score = Math.abs(data[i]) - 0.08 * Math.abs(i - center) / Math.max(1, radius)
    if (score > bestVal) {
      best = i
      bestVal = score
    }
  }
  return best
}

function smoothPeriods(periods, voiced, defP) {
  if (!periods.length) return periods

  let out = periods.slice()
  for (let pass = 0; pass < 2; pass++) {
    let next = out.slice()
    for (let i = 0; i < out.length; i++) {
      if (!voiced[i]) continue
      let win = []
      for (let k = Math.max(0, i - 2); k <= Math.min(out.length - 1, i + 2); k++) {
        if (voiced[k]) win.push(out[k])
      }
      if (win.length < 3) continue
      win.sort((a, b) => a - b)
      let med = win[Math.floor(win.length / 2)]
      next[i] = clamp(0.6 * out[i] + 0.4 * med, med * 0.75, med * 1.35)
    }
    out = next
  }

  let firstVoiced = out.findIndex((_, i) => voiced[i])
  let seed = firstVoiced >= 0 ? out[firstVoiced] : defP
  let prev = seed
  for (let i = 0; i < out.length; i++) {
    if (voiced[i]) {
      out[i] = clamp(out[i], prev * 0.8, prev * 1.25)
      prev = out[i]
    }
    else out[i] = prev || seed
  }

  let next = prev || seed
  for (let i = out.length - 1; i >= 0; i--) {
    if (voiced[i]) next = out[i]
    else out[i] = next || seed
  }

  return out
}

function pitchContour(data, minP, maxP, defP, opts = {}) {
  let start = maxP * 2
  let end = data.length - maxP * 2
  if (end <= start) return null

  let hop = opts.pitchHop ?? Math.max(12, Math.floor(minP * 0.75))
  let periods = []
  let scores = []
  let voiced = []
  let positions = []
  let prevPeriod = defP
  let cacheState = { index: 0 }
  let segmentOffset = opts.segmentOffset || 0

  for (let center = start; center <= end; center += hop) {
    let absCenter = segmentOffset + center
    let cached = reuseContourSample(opts.contourCache, absCenter, hop, cacheState)
    let period, score, isVoiced
    if (cached) {
      period = cached.period
      score = cached.score
      isVoiced = cached.voiced
    } else {
      ({ period, score } = detectPeriod(data, center - maxP, minP, maxP, data.length, prevPeriod))
      isVoiced = score >= 0.72 && period > 0
    }
    periods.push(isVoiced ? period : prevPeriod)
    scores.push(score)
    voiced.push(isVoiced)
    positions.push(absCenter)
    if (isVoiced) prevPeriod = period
  }

  return { start, hop, periods: smoothPeriods(periods, voiced, defP), scores, voiced, positions }
}

function periodAt(contour, pos) {
  let x = (pos - contour.start) / contour.hop
  if (x <= 0) return contour.periods[0]
  if (x >= contour.periods.length - 1) return contour.periods[contour.periods.length - 1]
  let i = Math.floor(x)
  let frac = x - i
  return contour.periods[i] * (1 - frac) + contour.periods[i + 1] * frac
}

function voicedAt(contour, pos) {
  let i = clamp(Math.round((pos - contour.start) / contour.hop), 0, contour.voiced.length - 1)
  return contour.voiced[i] && contour.scores[i] >= 0.4
}

function voicedWeight(contour, index) {
  if (!contour.voiced[index]) return 0

  let sum = 0
  let count = 0
  for (let k = Math.max(0, index - 1); k <= Math.min(contour.scores.length - 1, index + 1); k++) {
    if (!contour.voiced[k]) continue
    sum += clamp((contour.scores[k] - 0.34) / 0.18, 0, 1)
    count++
  }

  return count ? sum / count : 0
}

function voicedWeightAt(contour, pos) {
  let x = (pos - contour.start) / contour.hop
  if (x <= 0) return voicedWeight(contour, 0)
  if (x >= contour.scores.length - 1) return voicedWeight(contour, contour.scores.length - 1)
  let i = Math.floor(x)
  let frac = x - i
  let a = voicedWeight(contour, i)
  let b = voicedWeight(contour, i + 1)
  return a * (1 - frac) + b * frac
}

function findAnchor(contour) {
  for (let i = 1; i < contour.voiced.length - 1; i++) {
    if (contour.voiced[i - 1] && contour.voiced[i] && contour.voiced[i + 1]) return i
  }

  let best = -1
  let bestScore = 0
  for (let i = 0; i < contour.voiced.length; i++) {
    if (contour.voiced[i] && contour.scores[i] > bestScore) {
      best = i
      bestScore = contour.scores[i]
    }
  }
  return best
}

function marks(data, contour, minP, maxP) {
  let anchorIdx = findAnchor(contour)
  if (anchorIdx < 0) return { markPos: [], periods: [], voiced: [] }

  let anchorCenter = contour.start + anchorIdx * contour.hop
  let anchorPeriod = periodAt(contour, anchorCenter)
  let anchorMark = peakNear(data, anchorCenter, Math.max(4, Math.floor(anchorPeriod * 0.35)))

  let headMarks = []
  let headPeriods = []
  let headVoiced = []
  let pos = anchorMark
  while (pos > minP) {
    let period = periodAt(contour, pos)
    let predicted = pos - period
    if (predicted <= 0) break
    let nextPeriod = periodAt(contour, predicted)
    let isVoiced = voicedAt(contour, predicted)
    let radius = Math.max(4, Math.floor(nextPeriod * 0.35))
    let mark = isVoiced ? peakNear(data, predicted, radius) : Math.round(predicted)
    let minStep = Math.max(1, Math.floor(nextPeriod * 0.55))
    let maxStep = Math.max(minStep + 1, Math.ceil(nextPeriod * 1.8))
    let step = pos - mark
    if (step < minStep) mark = pos - minStep
    if (step > maxStep) mark = pos - maxStep
    if (mark <= 0 || mark >= pos) break
    headMarks.push(mark)
    headPeriods.push(nextPeriod)
    headVoiced.push(isVoiced)
    pos = mark
  }

  let markPos = headMarks.reverse()
  let periods = headPeriods.reverse()
  let voiced = headVoiced.reverse()

  markPos.push(anchorMark)
  periods.push(anchorPeriod)
  voiced.push(true)

  pos = anchorMark
  while (pos + minP < data.length) {
    let period = periodAt(contour, pos)
    let predicted = pos + period
    if (predicted + minP >= data.length) break
    let nextPeriod = periodAt(contour, predicted)
    let isVoiced = voicedAt(contour, predicted)
    let radius = Math.max(4, Math.floor(nextPeriod * 0.35))
    let mark = isVoiced ? peakNear(data, predicted, radius) : Math.round(predicted)
    let minStep = Math.max(1, Math.floor(nextPeriod * 0.55))
    let maxStep = Math.max(minStep + 1, Math.ceil(nextPeriod * 1.8))
    let step = mark - pos
    if (step < minStep) mark = pos + minStep
    if (step > maxStep) mark = pos + maxStep
    if (mark <= pos || mark >= data.length) break
    markPos.push(mark)
    periods.push(nextPeriod)
    voiced.push(isVoiced)
    pos = mark
  }

  return { markPos, periods, voiced }
}

function addGrain(data, srcPos, left, right, out, norm, dstPos) {
  left = Math.max(1, Math.round(left))
  right = Math.max(1, Math.round(right))
  let len = left + right
  for (let i = -left; i < right; i++) {
    let si = srcPos + i
    let di = dstPos + i
    if (si < 0 || si >= data.length || di < 0 || di >= out.length) continue
    let phase = (i + left) / len
    let w = 0.5 * (1 - Math.cos(PI2 * phase))
    out[di] += data[si] * w
    norm[di] += w
  }
}

function render(data, outLen, factor, markPos, periods, voiced, minP, maxP) {
  let out = new Float32Array(outLen)
  let norm = new Float32Array(outLen)
  if (!markPos.length) return { out, norm }

  let synPos = Math.round(markPos[0] * factor)
  let cursor = 0
  let last = markPos.length - 1

  while (synPos < outLen) {
    let srcTime = synPos / factor
    if (srcTime > markPos[last] + periods[last]) break

    while (cursor + 1 < markPos.length && markPos[cursor + 1] <= srcTime) cursor++

    let best = cursor
    if (cursor + 1 < markPos.length && Math.abs(markPos[cursor + 1] - srcTime) < Math.abs(markPos[cursor] - srcTime)) best = cursor + 1

    let left = best > 0 ? markPos[best] - markPos[best - 1] : periods[best]
    let right = best < last ? markPos[best + 1] - markPos[best] : periods[best]
    left = clamp(left, minP, maxP * 2)
    right = clamp(right, minP, maxP * 2)

    addGrain(data, markPos[best], left, right, out, norm, Math.round(synPos))

    let step = voiced[best] ? periods[best] : 0.5 * (left + right)
    synPos += clamp(step, minP * 0.75, maxP * 1.25)
  }

  return { out, norm }
}

function psolaBatchCore(data, opts) {
  let factor = opts?.factor ?? 1
  if (factor === 1) return { out: new Float32Array(data), contour: null }

  let sr = opts?.sampleRate || 44100
  let minP = Math.floor(sr / (opts?.maxFreq || 500))
  let maxP = Math.ceil(sr / (opts?.minFreq || 80))
  let defP = Math.round((minP + maxP) / 2)

  let n = data.length
  let outLen = Math.round(n * factor)
  if (n < maxP * 6) return { out: wsola(data, { factor }), contour: null }

  let contour = pitchContour(data, minP, maxP, defP, {
    pitchHop: opts?.pitchHop,
    contourCache: opts?.contourCache,
    segmentOffset: opts?.segmentOffset || 0,
  })
  if (!contour) return { out: wsola(data, { factor }), contour: null }

  let { markPos, periods, voiced } = marks(data, contour, minP, maxP)
  if (markPos.length < 4) return { out: wsola(data, { factor }), contour }

  let voicedCount = 0
  for (let i = 0; i < voiced.length; i++) if (voiced[i]) voicedCount++
  if (voicedCount < Math.max(4, voiced.length * 0.2)) return { out: wsola(data, { factor }), contour }

  let { out, norm } = render(data, outLen, factor, markPos, periods, voiced, minP, maxP)
  if (norm.every((value) => value <= 1e-8)) return { out: wsola(data, { factor }), contour }

  normalize(out, norm)

  // Blend WSOLA in weakly voiced regions where pitch-synchronous grains sound brittle
  if (voicedCount < voiced.length * 0.95) {
    let noise = wsola(data, { factor })
    for (let i = 0; i < outLen; i++) {
      let weight = voicedWeightAt(contour, i / factor)
      out[i] = out[i] * weight + noise[i] * (1 - weight)
    }
  }

  return { out, contour }
}

function psolaBatch(data, opts) {
  return psolaBatchCore(data, opts).out
}

function psolaStream(opts) {
  let factor = opts?.factor ?? 1
  let sr = opts?.sampleRate || 44100
  let maxP = Math.ceil(sr / (opts?.minFreq || 80))
  let batchOpts = { factor, sampleRate: sr, minFreq: opts?.minFreq, maxFreq: opts?.maxFreq }

  // Segment sizing: enough for pitch contour + marks + rendering
  let segLen = Math.max(maxP * 12, 8192)
  let advance = Math.max(maxP * 8, 4096)
  let outOlap = Math.round((segLen - advance) * factor)
  let pitchHop = Math.max(12, Math.floor((Math.floor(sr / (opts?.maxFreq || 500))) * 0.75))

  let inBuf = new Float32Array(segLen * 2)
  let inLen = 0
  let tail = null
  let streamOffset = 0
  let contourCache = null

  function concat(parts) {
    let n = 0
    for (let p of parts) n += p.length
    if (!n) return new Float32Array(0)
    let out = new Float32Array(n)
    let off = 0
    for (let p of parts) { out.set(p, off); off += p.length }
    return out
  }

  function blend(out, results) {
    if (tail) {
      let xLen = Math.min(tail.length, out.length, outOlap)
      let xf = new Float32Array(xLen)
      for (let i = 0; i < xLen; i++) {
        let w = (i + 0.5) / xLen
        xf[i] = tail[i] * (1 - w) + out[i] * w
      }
      results.push(xf)
      let emitEnd = out.length - outOlap
      if (emitEnd > xLen) results.push(new Float32Array(out.subarray(xLen, emitEnd)))
      tail = emitEnd < out.length ? new Float32Array(out.subarray(Math.max(xLen, emitEnd))) : null
    } else {
      let emitEnd = out.length - outOlap
      if (emitEnd > 0) results.push(new Float32Array(out.subarray(0, emitEnd)))
      tail = new Float32Array(out.subarray(Math.max(0, emitEnd)))
    }
  }

  return {
    write(chunk) {
      if (inLen + chunk.length > inBuf.length) {
        let nb = new Float32Array(Math.max((inLen + chunk.length) * 2, inBuf.length * 2))
        nb.set(inBuf.subarray(0, inLen))
        inBuf = nb
      }
      inBuf.set(chunk, inLen)
      inLen += chunk.length
      let results = []
      while (inLen >= segLen) {
        let seg = new Float32Array(segLen)
        seg.set(inBuf.subarray(0, segLen))
        let { out, contour } = psolaBatchCore(seg, { ...batchOpts, pitchHop, contourCache, segmentOffset: streamOffset })
        blend(out, results)
        contourCache = contour
        inBuf.copyWithin(0, advance, inLen)
        inLen -= advance
        streamOffset += advance
      }
      return concat(results)
    },
    flush() {
      let results = []
      if (inLen > 0) {
        let seg = new Float32Array(inLen)
        seg.set(inBuf.subarray(0, inLen))
        let { out } = psolaBatchCore(seg, { ...batchOpts, pitchHop, contourCache, segmentOffset: streamOffset })
        if (tail) {
          let xLen = Math.min(tail.length, out.length, outOlap)
          let xf = new Float32Array(xLen)
          for (let i = 0; i < xLen; i++) {
            let w = (i + 0.5) / xLen
            xf[i] = tail[i] * (1 - w) + out[i] * w
          }
          results.push(xf)
          if (out.length > xLen) results.push(new Float32Array(out.subarray(xLen)))
        } else {
          results.push(out)
        }
        inLen = 0
      } else if (tail) {
        results.push(tail)
      }
      tail = null
      contourCache = null
      return concat(results)
    }
  }
}

export default function psola(data, opts) {
  if (!(data instanceof Float32Array)) return writer(psolaStream(data))
  return psolaBatch(data, opts)
}
