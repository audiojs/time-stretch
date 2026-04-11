- [x] Update `pitch-shift.js` with input validation and explainable decision hook
- [x] Update `index.d.ts` with `PitchShiftDecision`, wider method typing, and `onDecision`
- [x] Add targeted tests in `test.js` for validation and decision reporting
- [x] Run `npm test` and confirm all tests pass

## Next Tasks

- [x] Add a clearer app-developer entry point in `README.md` with “just works” defaults and a minimal quick-start path
- [x] Add a concise “which algorithm should I use?” guide for the main audiences and use cases
- [x] Surface the comparative research story publicly by linking or documenting the output of `scripts/compare.js`
- [ ] Expand the public comparison demo to cover more of the promised source set: speech, percussion, polyphonic, sweep, and extreme ratios
- [ ] Add spectrogram visualization to the demo so users can compare artifacts as well as hear them
- [ ] Publish quality comparisons against external references where available, especially Rubber Band and SoundTouch
- [x] Add production-facing benchmark guidance: latency, realtime factor, CPU expectations, and bundle-size notes
- [x] Document the streaming API contract more clearly and reconcile it with the original “state in params” vision
- [x] Add Web Audio / AudioWorklet integration examples for browser users
- [x] Define or document the `jz`/WASM compilation path, or explicitly reduce that promise in the vision docs
- [x] Decide whether to expose more low-level DSP primitives for engineers, or document that the package intentionally stays at the algorithm level
- [ ] Add stronger trust signals for offline/high-quality users with real-source listening notes and published comparison results
