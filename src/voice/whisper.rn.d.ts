// Ambient module for whisper.rn 0.7.2 — explicit subpath entry.
// package.json exports omit a root "." key (only "./*" style globs).
// import from "whisper.rn" fails under moduleResolution bundler/node16.
// import from "whisper.rn/index" maps to src/index.ts / lib module index.js.
// Types mirror node_modules/whisper.rn/lib/typescript/index.d.ts for the
// surface used by Kalsa (init/transcribe/release). Extra APIs present in
// 0.7.2 (bench, Parakeet, VAD, CoreML flags) are declared for completeness
// against the locked version — not all are used by the app.
declare module "whisper.rn/index" {
  export type TranscribeOptions = {
    language?: string;
    /** Translate from source language to English. */
    translate?: boolean;
    maxThreads?: number;
    nProcessors?: number;
    maxContext?: number;
    maxLen?: number;
    tokenTimestamps?: boolean;
    /** Tinydiarize speaker-turn detection (when model supports it). */
    tdrzEnable?: boolean;
    wordThold?: number;
    offset?: number;
    duration?: number;
    temperature?: number;
    temperatureInc?: number;
    beamSize?: number;
    bestOf?: number;
    prompt?: string;
  };

  export type TranscribeResult = {
    result: string;
    language: string;
    segments: Array<{ text: string; t0: number; t1: number }>;
    isAborted: boolean;
  };

  export type TranscribeNewSegmentsResult = {
    nNew: number;
    totalNNew: number;
    result: string;
    segments: TranscribeResult["segments"];
  };

  export interface TranscribeFileOptions extends TranscribeOptions {
    onProgress?: (progress: number) => void;
    onNewSegments?: (result: TranscribeNewSegmentsResult) => void;
  }

  export type BenchResult = {
    config: string;
    nThreads: number;
    encodeMs: number;
    decodeMs: number;
    batchMs: number;
    promptMs: number;
  };

  export type CoreMLModelAssetOptions = {
    filename: string;
    assets: string[] | number[];
  };

  export type ContextOptions = {
    filePath: string | number;
    /** Required for Core ML when filePath is a require() asset. */
    coreMLModelAsset?: CoreMLModelAssetOptions;
    isBundleAsset?: boolean;
    /** Prefer Core ML model on iOS when available (0.7.2). */
    useCoreMLIos?: boolean;
    /** iOS GPU path; when enabled, Core ML option is ignored. */
    useGpu?: boolean;
    useFlashAttn?: boolean;
  };

  export class WhisperContext {
    ptr: number;
    id: number;
    gpu: boolean;
    reasonNoGPU: string;
    transcribe(
      filePathOrBase64: string | number,
      options?: TranscribeFileOptions,
    ): {
      stop: () => Promise<void>;
      promise: Promise<TranscribeResult>;
    };
    /**
     * ArrayBuffer: signed 16-bit mono PCM (decoded natively via decodePcm16).
     * string: base64 of the same PCM bytes.
     */
    transcribeData(
      data: string | ArrayBuffer,
      options?: TranscribeFileOptions,
    ): {
      stop: () => Promise<void>;
      promise: Promise<TranscribeResult>;
    };
    /** whisper.cpp bench (locked 0.7.2 API — unused by Kalsa). */
    bench(maxThreads: number): Promise<BenchResult>;
    release(): Promise<void>;
  }

  export function initWhisper(options: ContextOptions): Promise<WhisperContext>;
  export function releaseAllWhisper(): Promise<void>;
  export const libVersion: string;
  /** Whether the binary was built with Core ML (iOS). */
  export const isUseCoreML: boolean;
  export const isCoreMLAllowFallback: boolean;
}
