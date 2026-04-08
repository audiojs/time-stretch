## Vision

Collection of canonical timeless performant industry-standard time-stretching algorithms, usable for any audio purposes: WAA, worklets, audio etc. Code is compilable via jz to wasm.

---

## Audiences (NICE)

### 1. Frontend/App Devs (Needs: simple, just works)
- **Need**: Change speed/pitch of audio in browser apps. DJ tools, karaoke, podcast players, language learning, accessibility.
- **Interest**: `audio('song.mp3').stretch(1.5)` — one line, no DSP knowledge. Presets over parameters.
- **Concern**: Bundle size, latency, "does it sound good enough?"
- **Expectation**: Works in browser, works with Web Audio, works with streams.

### 2. Tool Builders / DAW Makers (Needs: control, quality, streaming)
- **Need**: Build audio editors, DJ apps, music production tools, sample manipulators, loop stretchers.
- **Interest**: Algorithm selection, parameter tuning, real-time streaming, transient handling, formant preservation.
- **Concern**: Artifacts at extreme ratios, latency budget, CPU cost, multi-channel sync.
- **Expectation**: Predictable latency, state persistence across blocks, per-channel control.

### 3. DSP/Audio Engineers (Needs: correct, composable, hackable)
- **Need**: Raw algorithms to compose into custom pipelines. Research, plugin development, novel effects.
- **Interest**: Direct access to phase vocoder internals, custom window functions, STFT parameters.
- **Concern**: Correctness vs. reference implementations, numerical precision, edge cases.
- **Expectation**: Pure functions, Float32Array I/O, zero dependencies where possible, well-documented math.

### 4. Offline/Batch Processors (Needs: quality over speed)
- **Need**: Highest quality time-stretch for mastering, sample library creation, forensic audio, archival.
- **Interest**: Multi-pass processing, transient detection, sinusoidal modeling.
- **Concern**: Artifacts on complex polyphonic material, percussive smearing.
- **Expectation**: Quality rivaling Elastique/Rubber Band for common use cases.

---

## Purposes

| Purpose | Domain | Latency | Quality | Example |
|---|---|---|---|---|
| **Live playback** | DJ, karaoke, practice | Real-time (<50ms) | Good | Tempo sync, speed change during playback |
| **Music production** | DAW, loop stretching | Near-real-time | High | Fit loops to BPM, warp audio clips |
| **Speech processing** | Podcast, accessibility, TTS | Real-time | Moderate | 1.5x/2x podcast speed, slow down for transcription |
| **Pitch correction** | Vocal tuning, harmonizer | Real-time | High | Shift pitch ±semitones preserving formants |
| **Sample manipulation** | Sound design, instruments | Offline | Highest | Extreme stretch (10x+), granular textures |
| **Broadcast/sync** | Film, TV, ads | Offline | High | Fit audio to exact duration (24→25fps) |
| **Creative effects** | Sound design, art | Either | Variable | PaulStretch ambient, glitch, granular |

---

## Algorithms

### Time-Domain (fast, simple, good for speech/transients)

| Algorithm | Quality | Speed | Transients | Polyphonic | Notes |
|---|---|---|---|---|---|
| **OLA** | Low | Very fast | Poor | Poor | Overlap-add, no alignment. Baseline only. |
| **SOLA** | Medium | Fast | Fair | Fair | Cross-correlation alignment. SoundTouch uses this. |
| **WSOLA** | Medium+ | Fast | Good | Fair | Best-offset search via correlation. ✅ Already implemented. |
| **PSOLA** | Good (speech) | Fast | Good | Poor | Pitch-synchronous OLA. Requires pitch detection. Best for monophonic speech/voice. |
| **TD-PSOLA** | Good (speech) | Fast | Good | Poor | Time-domain PSOLA variant. Standard for speech synthesis (WORLD, STRAIGHT). |

### Frequency-Domain (better quality, heavier CPU)

| Algorithm | Quality | Speed | Transients | Polyphonic | Notes |
|---|---|---|---|---|---|
| **Phase Vocoder** | Good | Medium | Poor | Good | STFT + phase advance. ✅ Already implemented. Classic phasiness on transients. |
| **Phase Vocoder + Phase Locking** | High | Medium | Fair | Good | Identity/scaled phase locking reduces phasiness. Laroche & Dolson 1999. |
| **Phase Vocoder + Transient Detection** | High | Medium | Good | Good | Separate transient/tonal, process differently. Röbel 2003. |
| **Sinusoidal Modeling (SMS)** | Very High | Slow | Good | Good | Track sinusoidal partials, resynthesize. McAulay-Quatieri. Complex. |

### Hybrid / Advanced

| Algorithm | Quality | Speed | Transients | Polyphonic | Notes |
|---|---|---|---|---|---|
| **Élastique** (zplane) | Excellent | Fast | Excellent | Excellent | Commercial. Industry standard (Ableton, FL Studio). Proprietary. |
| **Rubber Band** (R3 engine) | Excellent | Medium | Excellent | Excellent | Open source (GPL). Sinusoidal + transient detection. C++. |
| **Signalsmith Stretch** | Very Good | Fast | Good | Very Good | Open source (MIT). JS/WASM available. Frequency-domain with good transient handling. |
| **SoundTouch** | Good | Very Fast | Fair | Fair | Open source (LGPL). SOLA-based. Simple, fast, moderate quality. |
| **PaulStretch** | Extreme | Slow | N/A | Good | Open source. Extreme stretching (10x–1000x). Spectral smearing is the feature. |

### What We Should Implement

**Priority order based on ecosystem needs:**

1. **WSOLA** ✅ — Done. Time-domain, real-time capable, good for speech/moderate stretching.
2. **Phase Vocoder** ✅ — Done. Frequency-domain baseline.
3. **Phase Vocoder + Phase Locking** — Next. Major quality improvement over basic vocoder. Laroche-Dolson identity phase locking.
4. **Phase Vocoder + Transient Detection** — Separate transient frames from tonal, reset phases on transients. Big quality win for music.
5. **OLA** — Simplest baseline, useful as reference and for non-critical applications.
6. **PSOLA** — Best for speech/monophonic. Requires pitch detection dependency.
7. **PaulStretch** — Extreme stretching. Unique creative tool. Simple to implement.
8. **Formant-preserving pitch shift** — Envelope estimation + pitch shift. Important for vocal quality.

---

## Competitive Landscape (JS/npm)

| Package | Algos | Quality | Downloads | Notes |
|---|---|---|---|---|
| **signalsmith-stretch** | Proprietary freq-domain | Very Good | 55K/wk | WASM, MIT. Best JS option currently. |
| **audio-tempo-changer.js** | Phase vocoder | Low | ~0 | Abandoned (7 years). |
| **SoundTouch (ports)** | SOLA | Moderate | Small | Various partial JS ports exist. |
| **(nothing else significant)** | — | — | — | The JS ecosystem has no canonical time-stretch library. |

**Gap**: No pure-JS, modular, multi-algorithm time-stretch package exists. signalsmith-stretch is WASM (opaque binary), single-algorithm. We fill the gap of composable, hackable, multi-algorithm, pure JS with WASM compilation path.

---

## Mission Statement

### Purpose
Provide the canonical collection of time-stretching and pitch-shifting algorithms for JavaScript — from simple real-time WSOLA to high-quality offline phase vocoder variants — as composable Layer 3 primitives in the audiojs ecosystem.

### Activities
- Implement industry-standard TSM algorithms as pure JS functions (Float32Array → Float32Array)
- Cover the full quality/speed spectrum: OLA → WSOLA → Phase Vocoder → Phase-locked Vocoder → Transient-aware Vocoder → PSOLA → PaulStretch
- Maintain streaming-compatible API (state in params object, block-by-block processing)
- Provide pitch-shifting as time-stretch + resample composition
- Ensure formant preservation option for vocal pitch shifting
- Ship with sensible defaults for 44.1kHz, scale automatically for other rates
- Follow audiojs conventions: granular exports, tree-shakeable, zero-config, physical units
- Compilable to WASM via jz for performance-critical paths

### Non-goals
- Not a DAW/framework — raw algorithms only
- Not competing on proprietary quality (Élastique) — competing on openness, composability, correctness
- Not wrapping C++ libraries — pure JS implementations that can compile to WASM

---

## Architecture Alignment

### Layer Integration
```
Layer 1: audio('file.mp3').stretch(2)              ← audio package, fn/stretch.js
Layer 2: audio-effect (may wrap time-stretch)      ← umbrella, later
Layer 3: time-stretch (this package)               ← raw algorithms
         ├── wsola.js
         ├── vocoder.js
         ├── phase-lock.js
         ├── transient.js
         ├── psola.js
         ├── paulstretch.js
         ├── ola.js
         ├── pitch-shift.js
         └── util.js
```

### API Pattern (matches audio-filter/audio-effect)
```js
// Offline (full buffer)
let out = wsola(data, { factor: 1.5 })

// Streaming (block-by-block, state in params)
let p = { factor: 1.5, fs: 44100 }
for (let block of stream) {
  let stretched = wsola(block, p)  // p._state persists
  output(stretched)
}
```

### Signature Convention
```js
fn(data: Float32Array, params: {
  factor?: number,      // time stretch ratio (1 = unchanged, 2 = double length)
  fs?: number,          // sample rate (default 44100)
  frameSize?: number,   // analysis frame size
  hopSize?: number,     // hop between frames
  ...algoSpecific
}) → Float32Array
```

### References
- Driedger & Müller (2016). "A Review of Time-Scale Modification of Music Signals." _Applied Sciences_.
- Laroche & Dolson (1999). "Improved Phase Vocoder Time-Scale Modification of Audio."
- Röbel (2003). "A New Approach to Transient Processing in the Phase Vocoder."
- Verhelst & Roelands (1993). "An Overlap-Add Technique Based on Waveform Similarity (WSOLA)."
- Moulines & Charpentier (1990). "Pitch-Synchronous Waveform Processing Techniques for Text-to-Speech."
