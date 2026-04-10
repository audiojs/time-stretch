# time-stretch [![test](https://github.com/audiojs/time-stretch/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/time-stretch/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/time-stretch)](https://www.npmjs.com/package/time-stretch) [![license](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/audiojs/time-stretch/blob/main/LICENSE)

Time stretching and pitch shifting.

<table><tr><td valign="top">

**[Time domain](#time-domain)**<br>
<sub>[ola](#ola) · [wsola](#wsola) · [psola](#psola)</sub>

**[Frequency domain](#frequency-domain)**<br>
<sub>[vocoder](#vocoder) · [phaseLock](#phaselock) · [transient](#transient) · [paulstretch](#paulstretch)</sub>

**[Sinusoidal](#sinusoidal)**<br>
<sub>[sms](#sms)</sub>

</td><td valign="top">

**[Pitch shift](#pitch-shift)**<br>
<sub>[pitchShift](#pitchshift) · [formantShift](#formantshift)</sub>

**[Streaming](#streaming)**<br>
<sub>[write / flush](#streaming)</sub>

</td></tr></table>

## Install

```
npm install time-stretch
```

```js
import { phaseLock, pitchShift } from 'time-stretch'
// import phaseLock from 'time-stretch/phase-lock'

let slower = phaseLock(samples, { factor: 2 })        // 2× slower, same pitch
let higher = pitchShift(samples, { semitones: 5 })     // pitch up, same speed

let write = phaseLock({ factor: 1.5 })                 // real-time streaming
write(block1)                                           // → Float32Array chunk
write(block2)
write()                                                 // → remaining samples
```

> For audio-domain filters see [audio-filter](https://github.com/audiojs/audio-filter). For FFT see [fourier-transform](https://github.com/audiojs/fourier-transform).


## Intro

**Time stretching.** Changes duration without changing pitch. `factor > 1` = slower, `factor < 1` = faster. Every algorithm splits input into overlapping frames, repositions them in time, and crossfades.

**Pitch shifting.** Changes pitch without changing duration. Time-stretch by the pitch ratio, then resample back to original length.

**Algorithm choice.**

| | Domain | Quality | CPU | Best for |
|---|---|---|---|---|
| [ola](#ola) | time | ★ | lowest | previews, prototyping |
| [wsola](#wsola) | time | ★★★ | low | speech, real-time |
| [psola](#psola) | time | ★★★★ | medium | **speech/monophonic** (pitch-synchronous) |
| [vocoder](#vocoder) | freq | ★★ | medium | simple tonal material |
| [phaseLock](#phaselock) | freq | ★★★★ | medium | **music** (general purpose) |
| [transient](#transient) | freq | ★★★★★ | medium | **music with percussion** |
| [paulstretch](#paulstretch) | freq | — | medium | extreme stretch (ambient, drones) |
| [sms](#sms) | sinusoidal | ★★★★ | high | **harmonic/tonal** (tracks individual partials) |
| [formantShift](#formantshift) | freq | ★★★★ | medium | **voice pitch shift** (preserves formants) |

**Frames.** All algorithms slice input into overlapping windows (default: 1024–4096 samples, 75% overlap). The ratio of analysis hop to synthesis hop is what stretches time.

```
Input:   |--frame--|        analysis hop (small for stretch)
              |--frame--|
                   |--frame--|

Output:  |--frame--|              synthesis hop (normal)
                   |--frame--|
                             |--frame--|
```

**Frequency domain.** Vocoder-based algorithms convert each frame to magnitude + phase via FFT, modify only the phase to maintain pitch coherence, then IFFT back. The phase modification is what distinguishes them.


## Time domain

### `ola`

Overlap-Add. Simplest possible: window each frame, place at new position, crossfade. No alignment, no FFT. Fast but introduces phase artifacts — the crossfade between frames at different phases creates frequency modulation proportional to the hop size. Uses a hybrid hop strategy: fixed analysis hop for stretching, fixed synthesis hop for compression, minimizing overlap and phase cancellation in both directions.

```
Analysis:  ╭──╮    ╭──╮    ╭──╮
           │  │    │  │    │  │       → window + copy at new rate
Synthesis: ╭──╮     ╭──╮     ╭──╮
           │  │  +  │  │  +  │  │    → overlap-add (no alignment)
```

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

**Use when**: CPU is the constraint, quality doesn't matter, quick previews.<br>
**Not for**: any production use — causes audible flanging/phasing on all material. Use [wsola](#wsola) for quality time-domain stretching.<br>
**Artifacts**: phase cancellation between misaligned overlapping frames → metallic, hollow sound. Severity depends on frequency/hop alignment — no single hop size works well for all frequencies.


### `wsola`

Waveform Similarity Overlap-Add (Verhelst & Roelands, 1993). Like OLA but searches for the best alignment within a tolerance window using cross-correlation. Time-domain only — no FFT overhead.

```
Analysis:  ╭──╮    ╭──╮    ╭──╮
           │  │    │  │    │  │
                   ↕ search ±δ        → find best waveform match
Synthesis: ╭──╮     ╭──╮     ╭──╮
           │  │  ⊛  │  │  ⊛  │  │   → overlap-add (aligned)
```

The search correlates each candidate position against the existing output tail, finding the offset (within ±`delta` samples) that maximizes waveform similarity. This eliminates the phase cancellation that plagues OLA.

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

**Use when**: speech, real-time with tight CPU budgets, moderate stretch ratios (0.5–2×).<br>
**Not for**: polyphonic music with sustained tones — frequency-domain methods preserve harmonics better.<br>
**Compared to OLA**: dramatically better quality for +search cost. Compared to vocoder: no FFT, but can't handle extreme ratios as cleanly.


## Frequency domain

### `vocoder`

Phase vocoder. STFT → phase advance → ISTFT. Each frame is transformed to frequency domain; magnitudes are kept, phases are propagated forward by the instantaneous frequency at each bin. Basic version — no phase locking.

```
              FFT                    IFFT
Input frame ──→ |mag|∠φ ──→ advance φ ──→ output frame
                  ↓
            phase difference
            from previous frame
                  ↓
            instantaneous freq
                  ↓
            accumulate into
            synthesis phase
```

$\phi_{syn}[k] \mathrel{+}= \omega_k \cdot H_{syn}$, where $\omega_k = k \cdot \frac{2\pi}{N} + \frac{\Delta\phi[k] - k \cdot \frac{2\pi}{N} \cdot H_{ana}}{H_{ana}}$

```js
import { vocoder } from 'time-stretch'

vocoder(data, { factor: 2 })
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT size (power of 2) |
| `hopSize` | `frameSize/4` | Hop between frames |

**Use when**: educational purposes, simple tonal signals, as a building block.<br>
**Not for**: production music — suffers from "phasiness" (loss of transient sharpness, smeared stereo image). Use phaseLock or transient instead.<br>
**Artifacts**: each bin's phase evolves independently → incoherent phase relationships between harmonics → diffuse, underwater sound on complex signals.


### `phaseLock`

Phase vocoder with identity phase locking (Laroche & Dolson, 1999). Same STFT pipeline as vocoder, but after computing propagated phases, locks non-peak bins to the phase rotation of their nearest spectral peak. This preserves the phase relationships between harmonics.

```
              FFT                           IFFT
Input frame ──→ |mag|∠φ ──→ advance φ ──→ output frame
                  ↓
            find spectral peaks
            (local maxima in |mag|)
                  ↓
            peaks: keep propagated phase
            others: inherit peak's rotation
                  ↓
            ∠φ_out[k] = ∠φ[k] + (∠φ_prop[peak] − ∠φ[peak])
```

The key insight: in a harmonic signal, all partials share a common phase evolution. By identifying peaks and forcing their neighbors to follow the same rotation, the reconstructed waveform maintains the original harmonic structure instead of devolving into noise.

```js
import { phaseLock } from 'time-stretch'

phaseLock(data, { factor: 2 })    // recommended default for music
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT size (power of 2) |
| `hopSize` | `frameSize/4` | Hop between frames |

**Use when**: general-purpose music stretching — best quality-to-cost ratio.<br>
**Not for**: material with sharp transients (drums, plucks) — still smears onsets. Use transient for that.<br>
**Compared to vocoder**: same CPU cost, dramatically less phasiness. The standard choice for music.


### `transient`

Phase-locked vocoder with transient detection (Röbel, 2003). Combines identity phase locking with spectral flux onset detection. On detected transients, resets to original phase instead of propagating — preserving attack sharpness.

```
              FFT                              IFFT
Input frame ──→ |mag|∠φ ──→ detect transient? ──→ output frame
                  ↓              ↓
              spectral flux   YES: reset to original phase
              = Σ max(0,       NO: phase-locked propagation
                |mag|−|prev|)       (same as phaseLock)
              / Σ|mag|
                  ↓
              > threshold?
```

Spectral flux measures the sum of positive magnitude changes between consecutive frames, normalized by total energy. A sharp onset (snare hit, guitar pluck) produces a large flux spike. When detected, the algorithm bypasses phase propagation and uses the original analyzed phase directly — as if starting fresh — preventing the temporal smearing that makes drums sound soft.

```js
import { transient } from 'time-stretch'

transient(data, { factor: 2 })                       // highest quality
transient(data, { factor: 1.5, transientThreshold: 2.0 })  // less sensitive
```

| Param | Default | |
|---|---|---|
| `factor` | `1` | Time stretch ratio |
| `frameSize` | `2048` | FFT size (power of 2) |
| `hopSize` | `frameSize/4` | Hop between frames |
| `transientThreshold` | `1.5` | Spectral flux threshold (higher = fewer resets) |

**Use when**: mixed material — music with drums, speech with plosives, anything with sharp attacks.<br>
**Not for**: purely tonal/ambient material (phaseLock is sufficient and avoids rare false-positive resets).<br>
**Compared to phaseLock**: same cost + one comparison per frame. Strictly better for percussive material.


### `paulstretch`

Extreme time stretching via phase randomization (Nasca, 2006). Preserves magnitudes, replaces all phases with random values. Produces smooth, dreamlike textures. Designed for factors >2×.

```
              FFT                              IFFT
Input frame ──→ |mag|∠φ ──→ randomize ∠φ ──→ output frame
                              ↓
                  ∠φ_out[k] = random [0, 2π)
                              ↓
                  magnitude spectrum preserved
                  → timbral character maintained
                  → temporal structure dissolved
```

Because phases are fully randomized, there's no concept of "preserving" the original waveform — only the spectral envelope (timbre) survives. This is a feature: at extreme ratios, phase coherence produces repetitive cycling artifacts. Randomization converts those into a smooth, evolving texture.

```js
import { paulstretch } from 'time-stretch'

paulstretch(data, { factor: 8 })
paulstretch(data, { factor: 100, frameSize: 8192 })
```

| Param | Default | |
|---|---|---|
| `factor` | `8` | Time stretch ratio (best >2×) |
| `frameSize` | `4096` | FFT size (larger = smoother) |

**Use when**: ambient music, sound design, drone generation, 8×–1000× stretch.<br>
**Not for**: small ratios (<2×) — sounds washed out. Not for preserving rhythm or transients.


### `psola`

Pitch-Synchronous Overlap-Add (Moulines & Charpentier, 1990). Detects pitch via autocorrelation, windows grains at pitch-synchronous positions. Each grain is exactly 2 periods wide, so speech waveforms are segmented at their natural period boundaries.

```
              pitch detection         grain extraction
Input ──→ autocorrelation ──→ pitch marks ──→ grains
                                  ↓
                   mark[i] spaced by T0[i]
                   grain = Hann(2·T0) centered on mark
                                  ↓
                     synPos += T0 × factor
                                  ↓
                     OLA at synthesis positions
```

Because grains align with the pitch period, there are no phase discontinuities at overlap boundaries — each grain contains exactly one full pitch cycle. This produces cleaner results than generic OLA/WSOLA for pitched monophonic signals (speech, solo instruments).

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

**Use when**: speech, solo vocals, monophonic instruments, factors 0.5×–2×.<br>
**Not for**: polyphonic material — autocorrelation finds a single pitch period, so chords and multi-voice signals get mangled. Use [phaseLock](#phaselock) or [transient](#transient) for polyphonic content. Not for extreme ratios (>2× causes gaps).


## Sinusoidal

### `sms`

Sinusoidal Modeling Synthesis (Serra 1989, McAulay-Quatieri 1986). Decomposes audio into individually tracked sinusoidal partials, then resynthesizes at the new time rate. Each partial's frequency and magnitude are interpolated independently — no phase spreading or bin-by-bin artifacts.

```
Analysis:  FFT → peak detection → track across frames
             ╭─╮                   ╭─╮
           ──┤ ├──  frame 1  →  ──┤ ├──  track id=3: 440Hz → 441Hz
             ╰─╯                   ╰─╯

Synthesis: interpolate tracks → IFFT → overlap-add
           track 3 at t=1.5:  440.5Hz, mag=0.6
           → place in spectrum → IFFT → windowed frame
```

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
| `freqDev` | `3` | Max frequency deviation in bins for track continuation |
| `residualMix` | `1` | Amount of stochastic residual energy blended back into the sinusoidal model |

**Use when**: harmonic/tonal content (instruments, chords, vocals), cases where phaseLock introduces smearing.<br>
**Not for**: fully noise-dominated material — the sinusoidal model is still the anchor, even though a residual path now preserves more breath/noise/transient content.<br>
**Note**: default `residualMix=1` adds shaped stochastic residual synthesis on top of the sinusoidal model, turning the implementation into a practical deterministic-plus-stochastic hybrid instead of peak-only reconstruction.


## Pitch shift

### `pitchShift`

Pitch shifting via time-stretch + resample. Stretches by the pitch ratio (making the signal longer), then resamples back to original length (restoring duration, changing pitch). Output length = input length.

```
                    time-stretch              resample
Input ──→ pitch up (ratio 2) ──→ 2× longer ──→ squeeze to original length
          ↑                                      ↑
          transient by default                   linear interpolation
          (or wsola via method param)
```

$\text{ratio} = 2^{\text{semitones}/12}$

```js
import { pitchShift } from 'time-stretch'

pitchShift(data, { semitones: 7 })           // perfect fifth up
pitchShift(data, { semitones: -12 })         // octave down
pitchShift(data, { ratio: 1.5 })             // direct ratio
pitchShift(data, { semitones: 5, method: wsola })  // use wsola backend
pitchShift(data, { semitones: 5, content: 'voice', sampleRate: 48000 })  // prefer psola backend
pitchShift(data, { semitones: 5, content: 'tonal' })  // prefer sms backend
pitchShift(data, { semitones: 5, formant: true })   // preserve formants (voice)
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

**Use when**: pitch correction, harmonizing, creative effects.<br>
**Not for**: large shifts on voice without `formant: true` — will sound chipmunk/giant. For best defaults, set `content` so the stretcher matches the material.


### `formantShift`

Frequency-domain pitch shift with spectral envelope preservation. Estimates the formant envelope via moving average, separates fine harmonic structure from envelope, shifts harmonics by pitch ratio, reapplies original envelope. Prevents the chipmunk/giant effect on voice.

```
Magnitude spectrum:

  ╭─╮ ╭──╮    ╭─╮            ← spectral envelope (formants)
  │╷│ │╷╷│    │╷│            ← harmonics (fine structure)
──┘└┘─┘└└┘────┘└┘──

Shift harmonics, keep envelope:

  ╭──╮ ╭──╮    ╭─╮            ← same envelope (formants preserved)
  │ ╷│╷│╷ │╷   │╷│            ← shifted harmonics
──┘─└┘┘└──┘└───┘└┘──
```

```js
import { formantShift } from 'time-stretch'

formantShift(data, { semitones: 7 })         // pitch up, natural voice
formantShift(data, { semitones: -12 })       // octave down, no giant effect
formantShift(data, { ratio: 1.5 })           // direct ratio
```

| Param | Default | |
|---|---|---|
| `semitones` | `0` | Pitch shift in semitones |
| `ratio` | from semitones | Direct frequency ratio |
| `envelopeWidth` | `N/64` | Smoothing width in bins (larger = smoother envelope) |
| `frameSize` | `2048` | FFT frame size |
| `hopSize` | `frameSize/4` | Hop size |

**Use when**: voice pitch shifting, vocal harmonizing, gender transformation.<br>
**Not for**: extreme shifts (> 1 octave) — quality degrades. For instruments, regular `pitchShift` may be cleaner.


## Streaming

All time-stretch algorithms and `formantShift` support block-by-block streaming. Call with options only (no data) to get a writer function — suitable for real-time processing.

```js
let write = phaseLock({ factor: 1.5 })

// in your audio callback:
let output = write(inputBlock)    // → Float32Array (may be empty if buffering)

// when done:
let tail = write()                // → remaining buffered samples
```

The writer buffers internally until it has enough data for a complete analysis frame, then emits normalized output. Small or empty output chunks are normal during initial buffering.

| Call | |
|---|---|
| `write(chunk)` | Feed a Float32Array, returns available output |
| `write()` | Returns all remaining buffered output |

```js
// call with options only → returns writer function:
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


## Stereo / multi-channel

All algorithms process mono `Float32Array`. For stereo or multi-channel audio, split channels and process independently:

```js
let L = phaseLock(left, { factor: 2 })
let R = phaseLock(right, { factor: 2 })
```

Streaming:

```js
let wL = phaseLock({ factor: 2 })
let wR = phaseLock({ factor: 2 })

// in your audio callback:
let outL = wL(leftBlock)
let outR = wR(rightBlock)
```

Each channel gets its own independent processing state. Output lengths will match for identical-length inputs.


## Quality notes

**OLA** has inherent phase cancellation: overlapping out-of-phase frames cause pitch-dependent flanging. This is a fundamental limitation, not a bug — confirmed by [Driedger & Müller (2016)](https://www.mdpi.com/2076-3417/6/2/57) and [echo66/OLA-TS.js](https://github.com/nickarls/OLA-TS.js). Larger frames (≥4096) reduce the effect but slow processing.

**WSOLA** eliminates phase artifacts by aligning each frame to its best match via cross-correlation. The tradeoff is minor temporal smearing — transients lose sharpness. Best general-purpose time-domain algorithm.

**PSOLA** is designed for monophonic pitched signals (speech, solo instruments). It detects the fundamental pitch and places grains at pitch-synchronous boundaries. On polyphonic material (chords, full mixes), pitch detection fails and quality degrades significantly.

**Vocoder** preserves pitch perfectly but introduces "phasiness" — a diffuse, smeared quality from phase incoherence between bins. Transients become soft.

**PhaseLock** (Laroche-Dolson 1999) fixes vocoder phasiness by locking phase relationships between frequency bins. This preserves harmonic structure and stereo image. Best frequency-domain algorithm for general music.

**Transient** extends phaseLock with onset detection (spectral flux). Phase is reset at transients, preserving drum attacks and percussive sharpness. Best overall quality for music with percussion.

**Paulstretch** is purpose-built for extreme stretching (4×+). Randomizes phase to create smooth ambient textures. Not suitable for moderate time adjustments.

**SMS** (Sinusoidal Modeling Synthesis) tracks individual partials across frames, so each harmonic is independently controlled through the stretch. Achieves excellent quality on harmonic content (instruments, chords). The tradeoff is that only the sinusoidal component is preserved — noise, breath, and transients are lost. Higher CPU than STFT-based methods due to peak detection and tracking per frame.

Run `node scripts/compare.js` to generate an interactive comparison page with waveforms and audio playback for all algorithms.


## See also

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
