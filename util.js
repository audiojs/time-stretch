const PI2 = Math.PI * 2

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

// Wrap { write, flush } stream into single callable: write(chunk) → process, write() → flush
export function writer(s) {
  return (chunk) => chunk ? s.write(chunk) : s.flush()
}

let _hannCache = new Map()
export function hannWindow(N) {
  if (_hannCache.has(N)) return _hannCache.get(N)
  let w = new Float64Array(N)
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos(PI2 * i / N))
  _hannCache.set(N, w)
  return w
}

export function normalize(out, norm) {
  for (let i = 0; i < out.length; i++) {
    if (norm[i] > 1e-8) out[i] /= norm[i]
  }
}

function sinc(x) { return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x) }

// Windowed sinc resampler (Lanczos, a=3) — avoids aliasing from linear interpolation
export function resample(data, outLen) {
  let out = new Float32Array(outLen)
  let ratio = (data.length - 1) / (outLen - 1 || 1)
  let a = 3, n = data.length
  for (let i = 0; i < outLen; i++) {
    let pos = i * ratio
    let lo = Math.ceil(pos - a), hi = Math.floor(pos + a)
    let sum = 0, wsum = 0
    for (let j = Math.max(0, lo); j <= Math.min(n - 1, hi); j++) {
      let d = pos - j, w = sinc(d) * sinc(d / a)
      sum += data[j] * w
      wsum += w
    }
    out[i] = wsum > 0 ? sum / wsum : 0
  }
  return out
}

// Shared streaming buffer state: inBuf, outBuf/nrmBuf with grow/compact/take
export function makeStreamBufs(N, nf = 0) {
  let ib = new Float32Array(N * 4), il = 0
  let ob = new Float32Array(N * 8), nb = new Float32Array(N * 8)
  let pos = 0, oread = 0

  function appendIn(chunk) {
    let need = il + chunk.length
    if (need > ib.length) {
      let b = new Float32Array(Math.max(need * 2, ib.length * 2))
      b.set(ib.subarray(0, il)); ib = b
    }
    ib.set(chunk, il); il += chunk.length
  }

  function growOut(need) {
    if (need <= ob.length) return
    let len = Math.max(need * 2, ob.length * 2)
    let o = new Float32Array(len), n = new Float32Array(len)
    o.set(ob); n.set(nb); ob = o; nb = n
  }

  function compactIn(trim) {
    if (trim <= 0) return
    ib.copyWithin(0, trim, il); il -= trim
  }

  function take(upTo) {
    upTo = Math.min(upTo, pos)
    if (upTo <= oread) return new Float32Array(0)
    let len = Math.floor(upTo - oread)
    let out = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      let j = oread + i, n = nf > 0 ? Math.max(nb[j], nf) : nb[j]
      out[i] = n > 1e-8 ? ob[j] / n : 0
    }
    oread += len
    if (oread > N * 8) {
      ob.copyWithin(0, oread); nb.copyWithin(0, oread)
      pos -= oread; oread = 0
      ob.fill(0, pos); nb.fill(0, pos)
    }
    return out
  }

  return {
    get ib() { return ib }, get il() { return il },
    get ob() { return ob }, get nb() { return nb },
    get pos() { return pos }, set pos(v) { pos = v },
    appendIn, growOut, compactIn, take
  }
}

export { PI2 }
