import wsola from './wsola.js'

// OLA = WSOLA without cross-correlation search (delta=0)
export default function ola(data, opts) {
  if (!(data instanceof Float32Array)) {
    return wsola({ ...data, frameSize: data?.frameSize || 2048, delta: 0 })
  }
  return wsola(data, { ...opts, frameSize: opts?.frameSize || 2048, delta: 0 })
}
