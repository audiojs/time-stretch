## time-stretch — Plan

### Phase 1: Foundation ✓
- [x] Review & fix WSOLA (cross-correlation, normalization, dead code removal)
- [x] Review & fix Phase Vocoder (fourier-transform FFT, first-frame phase init)
- [x] Review & fix pitch-shift (multi-backend: phaseLock default + wsola, ratio param)
- [x] Streaming API (write/flush pattern for all 6 algorithms, stft.js shared engine)
- [x] Shared util.js (hannWindow, normalize, wrapPhase, findPeaks, resample)
- [x] Comprehensive tests (68 tests, 117 assertions — batch + streaming, all algos)
- [x] Granular package.json exports, sideEffects: false

### Phase 2: Quality improvements
- [x] Identity phase locking (Laroche-Dolson 1999) — phase-lock.js
- [x] Transient detection + phase reset (Röbel 2003) — transient.js
- [x] Phase-lock + transient combined in transient.js
- [x] Formant-preserving pitch shift (spectral envelope estimation)
- [x] Multi-backend pitch-shift.js (phaseLock default, wsola option)

### Phase 3: Algorithm coverage
- [x] OLA (ola.js) — simplest baseline
- [x] PSOLA (psola.js) — pitch-synchronous OLA for speech/monophonic
- [x] PaulStretch (paulstretch.js) — extreme time stretching
- [x] Research sinusoidal modeling feasibility (McAulay-Quatieri) — implemented as sms.js: peak detection + sinusoidal tracking + IFFT synthesis, batch + streaming, 128 tests passing

### Phase 4: Package quality
- [x] Granular exports in package.json
- [x] TypeScript declarations (index.d.ts)
- [x] README.md (API reference, algorithm comparison, usage examples)
- [x] Benchmark: CPU cost per algorithm
- [x] Test multi-channel handling (stereo)
- [x] Test extreme ratios (0.1x, 10x, 100x)

### Phase 4.5: Comparative quality research
- [x] Benchmark script (bench.js): CPU cost per algorithm, batch + streaming
- [x] Compare script (compare.js → compare.html): waveform + audio playback per algo/factor
- [x] Reference signals: sine, chord, sweep, impulse train, synthetic vowel
- [x] Document findings in README (Quality notes section)
- [x] Real audio samples via `node scripts/compare.js` (generates interactive HTML)

### Phase 5: Integration
- [ ] Create fn/stretch.js in audio package
- [ ] Integrate into audio-effect if appropriate
- [ ] Publish to npm
