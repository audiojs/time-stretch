# time-stretch [![test](https://github.com/audiojs/time-stretch/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/time-stretch/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/time-stretch)](https://www.npmjs.com/package/time-stretch) [![license](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/audiojs/time-stretch/blob/main/LICENSE)

Time stretching and pitch shifting.

| | Domain | Quality | CPU cost | Best for |
|---|---|---|---|---|
| [ola](#ola) | time | ★ | lowest | prototyping only |
| [wsola](#wsola) | time | ★★★ | low | speech, real-time |
| [psola](#psola) | time | ★★★★ | medium | speech / monophonic instruments |
| [vocoder](#vocoder) | freq | ★★ | medium | educational, simple tonal |
| [phaseLock](#phaselock) | freq | ★★★★ | medium | general music |
| [transient](#transient) | freq | ★★★★★ | medium | music with percussion |
| [paulstretch](#paulstretch) | freq | — | medium | extreme stretch (ambient, drones) |
| [sms](#sms) | sinusoidal | ★★★★ | high | harmonic / tonal material |
| [formantShift](#formantshift) | freq | ★★★★ | medium | voice pitch shift |


## Usage

```
npm install time-stretch
```

```js
import { phaseLock, pitchShift } from 'time-stretch'

let slower = phaseLock(samples, { factor: 2 })        // 2× slower, same pitch
let higher = pitchShift(samples, { semitones: 5 })     // pitch up, same speed

let write = phaseLock({ factor: 1.5 })                 // real-time streaming
write(block1)
write(block2)
write()                                                 // → remaining samples
```

## Time domain

### `ola`

Overlap-Add. Simplest possible: window each frame, place at new position, crossfade. No alignment, no FFT. Fast, but misaligned phase between overlapping frames causes audible flanging on all material.

```js
import { ola } from 'time-stretch'

ola(data, { factor: 2 })
ola(data, { factor: 0.5, frameSize: 4096 })
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | Window size in samples |
| `hopSize` | `frameSize/4` | Hop between frames |

**Use when:** CPU is the only constraint, quick previews, educational baseline.<br>
**Not for:** Any production use — audible flanging on all material. Use [wsola](#wsola) instead.


### `wsola`

Waveform Similarity Overlap-Add. Like OLA, but searches for the best alignment within a tolerance window via cross-correlation — no FFT overhead. Each frame is placed at the position that maximizes waveform similarity with the preceding output, eliminating phase cancellation.

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

Pitch-Synchronous Overlap-Add. Detects pitch via autocorrelation, then windows grains at pitch period boundaries. Because grains align with the pitch cycle, there are no phase discontinuities at overlaps — cleaner results than OLA/WSOLA for monophonic pitched signals.

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
**Not for:** Polyphonic material — autocorrelation finds one pitch period, so chords and multi-voice signals get mangled. Use [phaseLock](#phaselock) or [transient](#transient) for full mixes. Extreme ratios (>2×) cause gaps.


## Frequency domain

### `vocoder`

Phase vocoder. STFT → propagate phases forward → ISTFT. Magnitudes are preserved; phases advance by each bin's instantaneous frequency. Preserves pitch perfectly, but each bin evolves independently — incoherent phase relationships between harmonics give complex signals a diffuse, "underwater" quality.

```js
import { vocoder } from 'time-stretch'

vocoder(data, { factor: 2 })
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT size (power of 2) |
| `hopSize` | `frameSize/4` | Hop between frames |

**Use when:** Educational baseline, simple tonal signals.<br>
**Not for:** Production music. Use [phaseLock](#phaselock) or [transient](#transient) instead.


### `phaseLock`

Phase vocoder with identity phase locking (Laroche & Dolson, 1999). Same pipeline as vocoder, but after propagating phases, locks non-peak bins to their nearest spectral peak's rotation — preserving harmonic phase relationships and eliminating the "phasiness" of a plain vocoder.

```js
import { phaseLock } from 'time-stretch'

phaseLock(data, { factor: 2 })
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT size (power of 2) |
| `hopSize` | `frameSize/4` | Hop between frames |

**Use when:** General-purpose music stretching — best quality-to-cost ratio for tonal material.<br>
**Not for:** Material with sharp transients (drums, plucks) — still smears onsets. Use [transient](#transient) for that.


### `transient`

Phase-locked vocoder with transient detection (Röbel, 2003). Same as phaseLock, but measures spectral flux between frames — when a sharp onset is detected, it resets to the original phase instead of propagating it, preserving attack sharpness on drums and plucks.

```js
import { transient } from 'time-stretch'

transient(data, { factor: 2 })
transient(data, { factor: 1.5, transientThreshold: 2.0 })  // less sensitive
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT size (power of 2) |
| `hopSize` | `frameSize/4` | Hop between frames |
| `transientThreshold` | `1.5` | Spectral flux threshold (higher = fewer resets) |

**Use when:** Mixed material — music with drums, speech with plosives, anything with sharp attacks.<br>
**Not for:** Purely tonal/ambient material — phaseLock is sufficient and avoids occasional false-positive resets.


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

**Use when:** Harmonic / tonal content — instruments, chords, vocals — where phaseLock introduces smearing. Default `residualMix=1` adds stochastic residual synthesis, blending breath, noise, and transient energy back in alongside the sinusoidal model.<br>
**Not for:** Noise-dominated material.


## Pitch shift

### `pitchShift`

Pitch shifting via time-stretch + resample: stretches by the pitch ratio (ratio = 2^(semitones/12)), then resamples back to original length. Output length equals input length.

```js
import { pitchShift } from 'time-stretch'

pitchShift(data, { semitones: 7 })                                        // perfect fifth up
pitchShift(data, { semitones: -12 })                                      // octave down
pitchShift(data, { ratio: 1.5 })                                          // direct ratio
pitchShift(data, { semitones: 5, content: 'voice', sampleRate: 48000 })  // psola backend
pitchShift(data, { semitones: 5, content: 'tonal' })                      // sms backend
pitchShift(data, { semitones: 5, formant: true })                         // formant-preserving
```

| Param | Default | |
|---|---|---|
| `semitones` | `0` | Pitch shift in semitones |
| `ratio` | from semitones | Direct frequency ratio |
| `content` | `music` | Default backend choice (`music` → `transient`, `voice`/`speech` → `psola`, `tonal` → `sms`) |
| `method` | content-dependent | Stretch algorithm override (`transient`, `psola`, `sms`, `wsola`, etc.) |
| `sampleRate` | `44100` | Used by voice-oriented methods like `psola` |
| `minFreq` | backend default | Passed to `psola` when used |
| `maxFreq` | backend default | Passed to `psola` when used |
| `frameSize` | `2048` | Passed to stretch method |
| `hopSize` | `frameSize/4` | Passed to stretch method |
| `formant` | `false` | Use formant-preserving mode (delegates to `formantShift`) |

**Use when:** Pitch correction, harmonizing, creative effects.<br>
**Not for:** Large shifts on voice without `formant: true` — will sound chipmunk/giant. Set `content` to match your material for best results.


### `formantShift`

Pitch shift with spectral envelope preservation. Separates fine harmonic structure from the formant envelope, shifts harmonics by the pitch ratio, then reapplies the original envelope. Prevents the chipmunk/giant effect on voice.

```js
import { formantShift } from 'time-stretch'

formantShift(data, { semitones: 7 })
formantShift(data, { semitones: -12 })
formantShift(data, { ratio: 1.5 })
```

| Param | Default | |
|---|---|---|
| `semitones` | `0` | Pitch shift in semitones |
| `ratio` | from semitones | Direct frequency ratio |
| `envelopeWidth` | `N/64` | Smoothing width in bins (larger = smoother envelope) |
| `frameSize` | `2048` | FFT frame size |
| `hopSize` | `frameSize/4` | Hop size |

**Use when:** Voice pitch shifting, vocal harmonizing, gender transformation.<br>
**Not for:** Extreme shifts (>1 octave) — quality degrades. For instruments, regular `pitchShift` may be cleaner.



## Integration

### Streaming

All algorithms support block-by-block streaming. Call with options only (no data) to get a writer:

```js
let write = phaseLock({ factor: 1.5 })

// in your audio callback:
let output = write(inputBlock)    // → Float32Array (may be empty while buffering)

// when done:
let tail = write()                // → remaining buffered samples
```

- Feed ordered `Float32Array` chunks. Output sizes are variable — small or empty early chunks are normal.
- Call `write()` exactly once at the end to flush.
- Use one writer per channel for stereo or multichannel material.

```js
ola({ factor })
wsola({ factor })
vocoder({ factor })
phaseLock({ factor })
transient({ factor, transientThreshold })
paulstretch({ factor })
psola({ factor, sampleRate, minFreq, maxFreq })
sms({ factor, maxTracks, minMag, freqDev })
formantShift({ semitones, ratio, envelopeWidth })
```

### One-shot buffer

```js
import { transient } from 'time-stretch'

let src = audioBuffer.getChannelData(0)
let out = transient(new Float32Array(src), { factor: 1.25 })
```

### Stereo / multi-channel

All algorithms process mono `Float32Array`. For stereo, split channels and process independently:

```js
let L = phaseLock(left, { factor: 2 })
let R = phaseLock(right, { factor: 2 })

// Streaming:
let wL = phaseLock({ factor: 2 })
let wR = phaseLock({ factor: 2 })
```



## Research & comparison

| Command | What it does |
|---|---|
| `node scripts/compare.js` | writes `compare.html` — interactive waveforms, playback, internal-vs-external comparisons |
| `node scripts/bench.js` | throughput and ×realtime numbers for batch and streaming |
| `node scripts/diagnose.js` | targeted diagnostics for specific algorithm behaviors |

`demo.html` for a lightweight browser listening matrix. `scripts/compare.js` for deeper analysis.


## See also

* [pitch-shift](https://github.com/audiojs/pitch-shift) — related pitch shifting algos
* [fourier-transform](https://github.com/audiojs/fourier-transform) — FFT
* [window-function](https://github.com/audiojs/window-function) — Hann, Hamming, Blackman, etc.
* [audio-filter](https://github.com/audiojs/audio-filter) — audio filters
* [digital-filter](https://github.com/audiojs/digital-filter) — filter design


## References

* Verhelst, W. & Roelands, M. (1993). "An overlap-add technique based on waveform similarity (WSOLA)." _ICASSP_.
* Laroche, J. & Dolson, M. (1999). "Improved phase vocoder time-scale modification of audio." _IEEE Trans. Speech Audio Processing_.
* Röbel, A. (2003). "A new approach to transient processing in the phase vocoder." _DAFx_.
* Nasca, P. (2006). "PaulStretch — extreme time stretching." _paulnasca.com_.
* Moulines, E. & Charpentier, F. (1990). "Pitch-synchronous waveform processing techniques for text-to-speech synthesis using diphones." _Speech Communication_, 9(5-6).
* Driedger, J. & Müller, M. (2016). "A review of time-scale modification of music signals." _Applied Sciences_, 6(2).


<div align="center">

[MIT](https://github.com/audiojs/time-stretch/blob/main/LICENSE) [ॐ](https://github.com/krishnized/license)

</div>
