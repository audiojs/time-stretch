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

export interface VocoderOpts extends StftOpts {
  lock?: boolean
  transients?: boolean
  transientThreshold?: number
}

export interface PaulstretchOpts {
  factor?: number
  frameSize?: number
  seed?: number
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
  frameSize?: number
  hopSize?: number
  transientThreshold?: number
}

export interface SmsOpts extends StretchOpts {
  maxTracks?: number
  minMag?: number
  freqDev?: number
  residualMix?: number
}

export declare const wsola: {
  (data: Float32Array, opts?: WsolaOpts): Float32Array
  (opts?: WsolaOpts): Writer
}

export declare const vocoder: {
  (data: Float32Array, opts?: VocoderOpts): Float32Array
  (opts?: VocoderOpts): Writer
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

export declare const sms: {
  (data: Float32Array, opts?: SmsOpts): Float32Array
  (opts?: SmsOpts): Writer
}

export interface QualityOpts {
  frameSize?: number
  hopSize?: number
  trim?: number
  floor?: number
}

export declare function lsd(a: Float32Array, b: Float32Array, opts?: QualityOpts): number
export declare function spectralSim(a: Float32Array, b: Float32Array, opts?: QualityOpts): number
export declare function goertzelEnergy(data: Float32Array, freq: number, sr: number): number
export declare function chordBalance(data: Float32Array, freqs: number[], sr: number): number
export declare function chordRetention(data: Float32Array, ref: Float32Array, freqs: number[], sr: number): number

export interface ModulationDepthOpts {
  envWindow?: number
  envHop?: number
  trim?: number
}
export declare function modulationDepth(data: Float32Array, freqs: number[], sr: number, opts?: ModulationDepthOpts): number
