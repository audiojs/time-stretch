# time-stretch [![test](https://github.com/audiojs/time-stretch/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/time-stretch/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/time-stretch)](https://www.npmjs.com/package/time-stretch) [![license](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/audiojs/time-stretch/blob/main/LICENSE)

Time stretching and pitch shifting.

| | Domain | Quality | CPU cost | Best for |
|---|---|---|---|---|
| [wsola](#wsola) | time | ★★★ | low | speech, real-time |
| [psola](#psola) | time | ★★★★ | medium | speech / monophonic instruments |
| [vocoder](#vocoder) | freq | ★★ | medium | educational baseline |
| [vocoder `{ lock }`](#vocoder) | freq | ★★★★ | medium | general music |
| [vocoder `{ transients }`](#vocoder) | freq | ★★★★★ | medium | music with percussion |
| [paulstretch](#paulstretch) | freq | — | medium | extreme stretch (ambient, drones) |
| [sms](#sms) | sinusoidal | ★★★★ | high | harmonic / tonal material |

For voice pitch shift with formant preservation, use the `pitch-shift` package.


## Usage

```
npm install time-stretch
```

```js
import { vocoder, pitchShift } from 'time-stretch'

let slower = vocoder(samples, { factor: 2, transients: true })  // 2× slower, same pitch
let higher = pitchShift(samples, { semitones: 5 })               // pitch up, same speed

let write = vocoder({ factor: 1.5, transients: true })           // real-time streaming
write(block1)
write(block2)
write()                                                           // → remaining samples
```

## Time domain

### `wsola`

Waveform Similarity Overlap-Add. Divides signal into overlapping frames and places them at new synthesis positions, but before placing each frame searches ±delta samples for the position that maximizes cross-correlation with the preceding output — eliminating the phase cancellation (flanging) of plain OLA. No FFT overhead.

```js
import { wsola } from 'time-stretch'

wsola(data, { factor: 1.5 })
wsola(data, { factor: 0.5, delta: 512 })
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `1024` | Window size |
| `hopSize` | `frameSize/4` | Hop between frames |
| `delta` | `frameSize/4` | Search range (±samples) |

**Use when:** Speech, real-time with tight CPU budgets, moderate ratios (0.5–2×).<br>
**Not for:** Polyphonic music with sustained tones — frequency-domain methods handle harmonics better.


### `psola`

Pitch-Synchronous Overlap-Add. Detects pitch period via autocorrelation, then windows grains at pitch cycle boundaries. Because grains align with the pitch cycle there are no phase discontinuities at overlaps — cleaner results than WSOLA for monophonic pitched signals.

```js
import { psola } from 'time-stretch'

psola(data, { factor: 1.5 })
psola(data, { factor: 0.75, sampleRate: 48000 })
psola(data, { factor: 2, minFreq: 100, maxFreq: 400 })  // male voice range
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `sampleRate` | `44100` | For pitch detection frequency range |
| `minFreq` | `80` | Lowest expected pitch (Hz) |
| `maxFreq` | `500` | Highest expected pitch (Hz) |

**Use when:** Speech, solo vocals, monophonic instruments, factors 0.5–2×.<br>
**Not for:** Polyphonic material — autocorrelation finds one pitch period so chords get mangled. Extreme ratios (>2×) cause gaps.


## Frequency domain

### `vocoder`

Phase vocoder with three quality modes, controlled by `lock` and `transients` options.

**Plain** — each bin's phase advances at its instantaneous frequency independently. Magnitudes are preserved but incoherent inter-harmonic phase relationships give complex signals a diffuse, "underwater" quality.

**`{ lock: true }`** — after propagating phases, locks non-peak bins to their nearest spectral peak's rotation (Laroche & Dolson, 1999). Restores harmonic phase coherence, eliminating phasiness.

**`{ transients: true }`** — phase-locked vocoder that also measures spectral flux between frames (Röbel, 2003). When a sharp onset is detected it resets to the original analysis phase instead of propagating it, preserving attack sharpness on drums and plucks. Implies `lock`.

```js
import { vocoder } from 'time-stretch'

vocoder(data, { factor: 2 })                                      // plain — educational baseline
vocoder(data, { factor: 2, lock: true })                          // phase-locked — general music
vocoder(data, { factor: 2, transients: true })                    // transient-aware — best quality
vocoder(data, { factor: 1.5, transientThreshold: 2.0 })           // less sensitive detection
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT size (power of 2) |
| `hopSize` | `frameSize/4` | Hop between frames |
| `lock` | `false` | Phase locking (Laroche & Dolson, 1999) |
| `transients` | `false` | Transient detection, implies `lock` (Röbel, 2003) |
| `transientThreshold` | `1.5` | Spectral flux threshold (higher = fewer resets) |

**Use when:** `transients: true` is the right default for most material — music with percussion, mixed sources.<br>
`lock: true` for purely tonal/ambient material where transient resets aren't needed.<br>
Plain for educational use or simple tonal signals only.<br>
**Not for:** Voice/speech — use [psola](#psola). Extreme stretch — use [paulstretch](#paulstretch).


### `paulstretch`

Extreme time stretching via phase randomization (Nasca, 2006). Preserves magnitudes but replaces all phases with random values, producing smooth, dreamlike textures. Designed for large factors.

```js
import { paulstretch } from 'time-stretch'

paulstretch(data, { factor: 8 })
paulstretch(data, { factor: 100, frameSize: 8192 })
```

| Param | Default | |
|---|---|---|
| `factor` | `8` | Time stretch ratio (best >2×) |
| `frameSize` | `4096` | FFT size (larger = smoother) |
| `seed` | `0x12345678` | PRNG seed for phase randomization (deterministic output) |

**Use when:** Ambient music, sound design, drone generation, 8×–1000× stretch.<br>
**Not for:** Small ratios (<2×) — sounds washed out. Not for preserving rhythm or transients.


## Sinusoidal

### `sms`

Sinusoidal Modeling Synthesis (Serra 1989, McAulay-Quatieri 1986). Decomposes audio into individually tracked sinusoidal partials and resynthesizes at the new time rate. Each partial's frequency and magnitude are interpolated independently — no phase spreading or bin-by-bin artifacts.

```js
import { sms } from 'time-stretch'

sms(data, { factor: 2 })
sms(data, { factor: 0.5, maxTracks: 80 })
sms(data, { factor: 3, frameSize: 4096 })
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT frame size |
| `hopSize` | `frameSize/4` | Hop between frames |
| `maxTracks` | `60` | Max simultaneous sinusoidal tracks |
| `minMag` | `1e-4` | Peak detection threshold (linear) |
| `freqDev` | `3` | Max frequency deviation (bins) for track continuation |
| `residualMix` | `1` | Stochastic residual blended into the sinusoidal output |

**Use when:** Harmonic / tonal content — instruments, chords, vocals — where the vocoder introduces smearing. Default `residualMix=1` blends breath, noise, and transient energy back in alongside the sinusoidal model.<br>
**Not for:** Noise-dominated material.


## Pitch shift

### `pitchShift`

Pitch shifting via time-stretch + resample: stretches by the pitch ratio (`ratio = 2^(semitones/12)`), then resamples back to original length. Output length equals input length.

```js
import { pitchShift } from 'time-stretch'

pitchShift(data, { semitones: 7 })    // perfect fifth up
pitchShift(data, { semitones: -12 })  // octave down
pitchShift(data, { ratio: 1.5 })      // direct ratio
```

| Param | Default | |
|---|---|---|
| `semitones` | `0` | Pitch shift in semitones |
| `ratio` | from semitones | Direct frequency ratio |
| `frameSize` | `2048` | Passed to stretch method |
| `hopSize` | `frameSize/4` | Passed to stretch method |
| `transientThreshold` | `1.5` | Transient sensitivity |

**Use when:** Pitch correction, harmonizing, creative effects.<br>
**Not for:** Voice without formant preservation — will sound chipmunk/giant. Use the `pitch-shift` package instead. For content-aware algorithm selection (voice → psola, tonal → sms) call those functions directly.



## Integration

### Streaming

All algorithms support block-by-block streaming. Call with options only (no data) to get a writer:

```js
let write = vocoder({ factor: 1.5, transients: true })

// in your audio callback:
let output = write(inputBlock)    // → Float32Array (may be empty while buffering)

// when done:
let tail = write()                // → remaining buffered samples
```

- Feed ordered `Float32Array` chunks. Output sizes are variable — small or empty early chunks are normal.
- Call `write()` exactly once at the end to flush.
- Use one writer per channel for stereo or multichannel material.

```js
wsola({ factor })
vocoder({ factor, lock, transients, transientThreshold })
paulstretch({ factor })
psola({ factor, sampleRate, minFreq, maxFreq })
sms({ factor, maxTracks, minMag, freqDev })
```

### One-shot buffer

```js
import { vocoder } from 'time-stretch'

let src = audioBuffer.getChannelData(0)
let out = vocoder(new Float32Array(src), { factor: 1.25, transients: true })
```

### Stereo / multi-channel

All algorithms process mono `Float32Array`. For stereo, split channels and process independently:

```js
let L = vocoder(left,  { factor: 2, transients: true })
let R = vocoder(right, { factor: 2, transients: true })

// Streaming:
let wL = vocoder({ factor: 2, transients: true })
let wR = vocoder({ factor: 2, transients: true })
```



## Research & comparison

| Command | What it does |
|---|---|
| `node scripts/compare.js` | writes `compare.html` — interactive waveforms, playback, internal-vs-external comparisons |
| `node scripts/bench.js` | throughput and ×realtime numbers for batch and streaming |
| `node scripts/diagnose.js` | targeted diagnostics for specific algorithm behaviors |

[Demo](https://audiojs.github.io/time-stretch/) for a lightweight browser listening matrix. `scripts/compare.js` for deeper analysis.


## See also

* [pitch-shift](https://github.com/audiojs/pitch-shift) — related pitch shifting algos
* [fourier-transform](https://github.com/audiojs/fourier-transform) — FFT
* [audio-filter](https://github.com/audiojs/audio-filter) — audio filters
* [digital-filter](https://github.com/audiojs/digital-filter) — filter design


## References

* Verhelst, W. & Roelands, M. (1993). "An overlap-add technique based on waveform similarity (WSOLA)." _ICASSP_.
* Laroche, J. & Dolson, M. (1999). "Improved phase vocoder time-scale modification of audio." _IEEE Trans. Speech Audio Processing_.
* Röbel, A. (2003). "A new approach to transient processing in the phase vocoder." _DAFx_.
* Nasca, P. (2006). "PaulStretch — extreme time stretching." _paulnasca.com_.
* Moulines, E. & Charpentier, F. (1990). "Pitch-synchronous waveform processing techniques for text-to-speech synthesis using diphones." _Speech Communication_, 9(5-6).
* Driedger, J. & Müller, M. (2016). "A review of time-scale modification of music signals." _Applied Sciences_, 6(2).
* Serra, X. (1989). "A System for Sound Analysis/Transformation/Synthesis Based on a Deterministic plus Stochastic Decomposition." PhD thesis, Stanford.
* McAulay, R.J. & Quatieri, T.F. (1986). "Speech analysis/synthesis based on a sinusoidal representation." _IEEE Trans. ASSP_, 34(4).


<div align="center">

[MIT](https://github.com/audiojs/time-stretch/blob/main/LICENSE) [ॐ](https://github.com/krishnized/license)

</div>
