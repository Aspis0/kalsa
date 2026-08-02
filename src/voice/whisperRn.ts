/**
 * Runtime loader for whisper.rn.
 *
 * package.json exports only star-subpaths (no root "."). The explicit entry
 * "whisper.rn/index" is what Metro/RN must load. TypeScript with Expo's
 * customConditions ["react-native"] resolves that entry to src/index.ts and
 * typechecks it (global is missing there). To keep `tsc --noEmit` clean we:
 *  - type the surface locally (mirror of 0.7.2)
 *  - load the module via a dynamic require so TS cannot resolve the package graph
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
 * Load whisper.rn/index once. Dynamic require keeps tsc from following the
 * react-native export into src/index.ts.
 */
function loadWhisperRn(): WhisperRnModule {
  if (cached) return cached;
  // Split the specifier so TypeScript cannot statically resolve it.
  const specifier = ["whisper.rn", "index"].join("/");
  // Metro/Hermes provide require for package subpaths at bundle time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(specifier) as WhisperRnModule;
  cached = mod;
  return mod;
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
