/**
 * Runtime loader for whisper.rn.
 *
 * package.json exports only star-subpaths (no root "."). The explicit entry
 * "whisper.rn/index" is what Metro/RN must load. Types come from the ambient
 * shim in src/voice/whisper.rn.d.ts (mirror of 0.7.2 surface used by Kalsa).
 */

export type TranscribeOptions = {
  language?: string;
  translate?: boolean;
  maxThreads?: number;
  nProcessors?: number;
  maxContext?: number;
  maxLen?: number;
  tokenTimestamps?: boolean;
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

export type ContextOptions = {
  filePath: string | number;
  coreMLModelAsset?: { filename: string; assets: string[] | number[] };
  isBundleAsset?: boolean;
  useCoreMLIos?: boolean;
  useGpu?: boolean;
  useFlashAttn?: boolean;
};

export type WhisperContext = {
  ptr: number;
  id: number;
  gpu: boolean;
  reasonNoGPU: string;
  transcribe: (
    filePathOrBase64: string | number,
    options?: TranscribeFileOptions,
  ) => {
    stop: () => Promise<void>;
    promise: Promise<TranscribeResult>;
  };
  /**
   * ArrayBuffer: signed 16-bit mono PCM (native decodePcm16).
   * string: base64 of the same PCM bytes.
   */
  transcribeData: (
    data: string | ArrayBuffer,
    options?: TranscribeFileOptions,
  ) => {
    stop: () => Promise<void>;
    promise: Promise<TranscribeResult>;
  };
  bench: (maxThreads: number) => Promise<unknown>;
  release: () => Promise<void>;
};

type WhisperRnModule = {
  initWhisper: (options: ContextOptions) => Promise<WhisperContext>;
  releaseAllWhisper: () => Promise<void>;
  libVersion: string;
};

let cached: WhisperRnModule | null = null;

/**
 * Load whisper.rn/index once. Literal require so Metro can statically resolve
 * the package subpath (dynamic require(specifier) fails export:embed).
 */
function loadWhisperRn(): WhisperRnModule {
  if (cached) return cached;
  // @ts-ignore — "whisper.rn" dichiara exports senza entry "."; l'import letterale serve a Metro, lo shim src/voice/whisper.rn.d.ts fornisce i tipi
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const WhisperRn = require("whisper.rn/index") as WhisperRnModule;
  cached = WhisperRn;
  return WhisperRn;
}

export function initWhisper(options: ContextOptions): Promise<WhisperContext> {
  return loadWhisperRn().initWhisper(options);
}

export function releaseAllWhisper(): Promise<void> {
  return loadWhisperRn().releaseAllWhisper();
}

export function getWhisperLibVersion(): string {
  try {
    return loadWhisperRn().libVersion;
  } catch {
    return "";
  }
}
