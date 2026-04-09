import { ola, wsola, vocoder, phaseLock, transient, paulstretch, psola } from '../index.js'

let fs = 44100, dur = 5, n = fs * dur
let data = new Float32Array(n)
for (let i = 0; i < n; i++) data[i] = Math.sin(2 * Math.PI * 440 * i / fs) * 0.5 + Math.sin(2 * Math.PI * 880 * i / fs) * 0.3

let algos = [
  ['ola', ola, { factor: 2 }],
  ['wsola', wsola, { factor: 2 }],
  ['vocoder', vocoder, { factor: 2 }],
  ['phaseLock', phaseLock, { factor: 2 }],
  ['transient', transient, { factor: 2 }],
  ['paulstretch', paulstretch, { factor: 8 }],
  ['psola', psola, { factor: 2 }],
]

console.log(`Benchmark: ${dur}s signal (${n} samples) @ ${fs}Hz\n`)
console.log('algo           factor  time(ms)  x-realtime  samples/ms')
console.log('─'.repeat(58))

for (let [name, fn, opts] of algos) {
  // warmup
  fn(data.subarray(0, fs), opts)

  let t0 = performance.now()
  let iters = 3
  for (let i = 0; i < iters; i++) fn(data, opts)
  let avg = (performance.now() - t0) / iters

  let xrt = (dur * 1000 / avg).toFixed(1)
  let spm = Math.round(n / avg)
  console.log(`${name.padEnd(15)}${String(opts.factor).padEnd(8)}${avg.toFixed(1).padStart(8)}  ${xrt.padStart(10)}  ${String(spm).padStart(10)}`)
}

// streaming benchmark
console.log('\n--- Streaming (4096-sample chunks) ---\n')
console.log('algo           factor  time(ms)  x-realtime  samples/ms')
console.log('─'.repeat(58))

let chunkSize = 4096
for (let [name, fn, opts] of algos) {
  let write = fn(opts)
  // warmup
  for (let i = 0; i < fs; i += chunkSize) write(data.subarray(i, i + chunkSize))
  write()

  let t0 = performance.now()
  let iters = 3
  for (let iter = 0; iter < iters; iter++) {
    let w = fn(opts)
    for (let i = 0; i < n; i += chunkSize) w(data.subarray(i, Math.min(i + chunkSize, n)))
    w()
  }
  let avg = (performance.now() - t0) / iters

  let xrt = (dur * 1000 / avg).toFixed(1)
  let spm = Math.round(n / avg)
  console.log(`${name.padEnd(15)}${String(opts.factor).padEnd(8)}${avg.toFixed(1).padStart(8)}  ${xrt.padStart(10)}  ${String(spm).padStart(10)}`)
}
