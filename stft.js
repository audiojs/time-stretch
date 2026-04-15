import { fft, ifft } from 'fourier-transform'
import { hannWindow, normalize, PI2, makeStreamBufs } from './util.js'

export function wrapPhase(p) {
  return p - Math.round(p / PI2) * PI2
}

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
  let state = {}, sc = scratch(N, half)
  let nf = normFloor(win, synHop)

  let st = makeStreamBufs(N, nf)
  let aPos = 0, flushed = false

  function run() {
    while (Math.round(aPos) + N <= st.il) {
      let sf = frame(st.ib, Math.round(aPos), win, half, process, state, ctx, sc)
      st.growOut(st.pos + N)
      let ob = st.ob, nb = st.nb, base = st.pos
      for (let i = 0; i < N; i++) {
        ob[base + i] += sf[i] * win[i]
        nb[base + i] += win[i] * win[i]
      }
      aPos += anaHop
      st.pos += synHop
    }
    let used = Math.floor(aPos)
    if (used > N * 2) { st.compactIn(used - N); aPos -= used - N }
  }

  return {
    write(chunk) {
      st.appendIn(chunk)
      run()
      return st.take(Math.max(0, st.pos - N + synHop))
    },
    flush() {
      if (!flushed) { st.appendIn(new Float32Array(N)); flushed = true }
      run()
      return st.take(st.pos)
    }
  }
}
