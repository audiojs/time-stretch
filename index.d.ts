type Writer = (chunk?: Float32Array) => Float32Array

export interface StretchOpts {
  factor?: number
  frameSize?: number
  hopSize?: number
}

export interface WsolaOpts extends StretchOpts {
  delta?: number
}

export interface StftOpts extends StretchOpts {
  synHop?: number
  anaHop?: number
}

export interface TransientOpts extends StftOpts {
  transientThreshold?: number
}

export interface PaulstretchOpts {
  factor?: number
  frameSize?: number
}

export interface PsolaOpts {
  factor?: number
  sampleRate?: number
  minFreq?: number
  maxFreq?: number
}

export interface PitchShiftOpts {
  semitones?: number
  ratio?: number
  formant?: boolean
  method?: StretchFn
  frameSize?: number
  hopSize?: number
}

export interface FormantShiftOpts {
  semitones?: number
  ratio?: number
  envelopeWidth?: number
  frameSize?: number
  hopSize?: number
}

export interface SmsOpts extends StretchOpts {
  maxTracks?: number
  minMag?: number
  freqDev?: number
}

type StretchFn = {
  (data: Float32Array, opts?: StretchOpts): Float32Array
  (opts?: StretchOpts): Writer
}

export declare const ola: {
  (data: Float32Array, opts?: StretchOpts): Float32Array
  (opts?: StretchOpts): Writer
}

export declare const wsola: {
  (data: Float32Array, opts?: WsolaOpts): Float32Array
  (opts?: WsolaOpts): Writer
}

export declare const vocoder: {
  (data: Float32Array, opts?: StftOpts): Float32Array
  (opts?: StftOpts): Writer
}

export declare const phaseLock: {
  (data: Float32Array, opts?: StftOpts): Float32Array
  (opts?: StftOpts): Writer
}

export declare const transient: {
  (data: Float32Array, opts?: TransientOpts): Float32Array
  (opts?: TransientOpts): Writer
}

export declare const paulstretch: {
  (data: Float32Array, opts?: PaulstretchOpts): Float32Array
  (opts?: PaulstretchOpts): Writer
}

export declare const psola: {
  (data: Float32Array, opts?: PsolaOpts): Float32Array
  (opts?: PsolaOpts): Writer
}

export declare function pitchShift(data: Float32Array, opts?: PitchShiftOpts): Float32Array

export declare const formantShift: {
  (data: Float32Array, opts?: FormantShiftOpts): Float32Array
  (opts?: FormantShiftOpts): Writer
}

export declare const sms: {
  (data: Float32Array, opts?: SmsOpts): Float32Array
  (opts?: SmsOpts): Writer
}
