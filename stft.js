import { fft, ifft } from 'fourier-transform'
import { hannWindow, normalize, PI2 } from './util.js'

function frame(data, pos, win, half, process, state, ctx, sc) {
  let N = win.length
  let f = sc.f
  for (let i = 0; i < N; i++) f[i] = (data[pos + i] || 0) * win[i]

  let [re, im] = fft(f)
  let mag = sc.mag, phase = sc.phase
  for (let k = 0; k <= half; k++) {
    mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
    phase[k] = Math.atan2(im[k], re[k])
  }

  let r = process(mag, phase, state, ctx)
  let r2 = sc.r2, i2 = sc.i2
  for (let k = 0; k <= half; k++) {
    r2[k] = r.mag[k] * Math.cos(r.phase[k])
    i2[k] = r.mag[k] * Math.sin(r.phase[k])
  }
  return ifft(r2, i2)
}

function scratch(N, half) {
  return { f: new Float64Array(N), mag: new Float64Array(half + 1), phase: new Float64Array(half + 1), r2: new Float64Array(half + 1), i2: new Float64Array(half + 1) }
}

// Steady-state win² sum — floor prevents amplification at OLA boundaries
function normFloor(win, hop) {
  let N = win.length, min = Infinity
  for (let i = 0; i < hop; i++) {
    let s = 0
    for (let j = i; j < N; j += hop) s += win[j] * win[j]
    if (s > 0 && s < min) min = s
  }
  return min === Infinity ? 0 : min
}

export function stftBatch(data, process, opts) {
  let factor = opts?.factor ?? 1
  let N = opts?.frameSize || 2048
  let hop = opts?.hopSize || (N >> 2)
  let half = N >> 1
  let win = hannWindow(N)
  let synHop = opts?.synHop ?? hop
  let anaHop = opts?.anaHop ?? hop / factor
  let ctx = { anaHop, synHop, half, N, freqPerBin: PI2 / N }

  let outLen = Math.round(data.length * synHop / anaHop)
  let out = new Float32Array(outLen)
  let norm = new Float32Array(outLen)
  let state = {}
  let sc = scratch(N, half)
  let aPos = 0, sPos = 0

  while (sPos + N <= outLen) {
    let sf = frame(data, Math.round(aPos), win, half, process, state, ctx, sc)
    for (let i = 0; i < N && sPos + i < outLen; i++) {
      out[sPos + i] += sf[i] * win[i]
      norm[sPos + i] += win[i] * win[i]
    }
    aPos += anaHop
    sPos += synHop
  }

  let nf = normFloor(win, synHop)
  for (let i = 0; i < outLen; i++) {
    let n = Math.max(norm[i], nf)
    if (n > 1e-8) out[i] /= n
  }
  return out
}

export function stftStream(process, opts) {
  let N = opts?.frameSize || 2048
  let hop = opts?.hopSize || (N >> 2)
  let half = N >> 1
  let win = hannWindow(N)
  let factor = opts?.factor ?? 1
  let synHop = opts?.synHop ?? hop
  let anaHop = opts?.anaHop ?? hop / factor
  let ctx = { anaHop, synHop, half, N, freqPerBin: PI2 / N }

  let inBuf = new Float32Array(N * 4)
  let inLen = 0
  let outBuf = new Float32Array(N * 8)
  let normBuf = new Float32Array(N * 8)
  let aPos = 0, sPos = 0, oRead = 0
  let state = {}
  let sc = scratch(N, half)
  let flushed = false
  let nf = normFloor(win, synHop)

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
    while (Math.round(aPos) + N <= inLen) {
      let sf = frame(inBuf, Math.round(aPos), win, half, process, state, ctx, sc)
      let need = sPos + N
      if (need > outBuf.length) {
        let len = Math.max(need * 2, outBuf.length * 2)
        let ob = new Float32Array(len), nb = new Float32Array(len)
        ob.set(outBuf); nb.set(normBuf)
        outBuf = ob; normBuf = nb
      }
      for (let i = 0; i < N; i++) {
        outBuf[sPos + i] += sf[i] * win[i]
        normBuf[sPos + i] += win[i] * win[i]
      }
      aPos += anaHop
      sPos += synHop
    }
    let used = Math.floor(aPos)
    if (used > N * 2) {
      let trim = used - N
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
      let n = Math.max(normBuf[j], nf)
      out[i] = n > 1e-8 ? outBuf[j] / n : 0
    }
    oRead += len
    if (oRead > N * 8) {
      let shift = oRead
      outBuf.copyWithin(0, shift)
      normBuf.copyWithin(0, shift)
      sPos -= shift
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
      return take(Math.max(0, sPos - N + synHop))
    },
    flush() {
      if (!flushed) { appendIn(new Float32Array(N)); flushed = true }
      run()
      return take(sPos)
    }
  }
}
