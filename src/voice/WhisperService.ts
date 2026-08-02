/**
 * On-device ASR via whisper.rn (whisper.cpp).
 *
 * Lifecycle: init once per model path (serialized mutex),
 * transcribe raw mono 16 kHz signed 16-bit PCM ArrayBuffer,
 * release on dispose.
 *
 * Runtime entry: "whisper.rn/index" (package exports have no root "." entry).
 * Loaded via src/voice/whisperRn.ts so tsc does not typecheck the package
 * src tree under Expo customConditions ["react-native"].
 *
 * Native path (whisper.rn 0.7.2): requireAudioBufferArgument then decodePcm16
 * so ArrayBuffer must be int16 PCM (not float32), despite the TS comment.
 */

import { initWhisper, type WhisperContext } from "./whisperRn";

import { isModelBundleDownloaded, modelLocalPath } from "../engine/ModelDownloader";
import { WHISPER_MODEL } from "../engine/ModelRegistry";
import type { Locale } from "../i18n";

export type WhisperLocale = "en" | "it";

type WhisperPhase = "idle" | "ready" | "closing";

let context: WhisperContext | null = null;
let activePath: string | null = null;
let phase: WhisperPhase = "idle";
/** Active transcription stop handle (for cancel/release). */
let activeStop: (() => Promise<void>) | null = null;

/**
 * FIFO mutex — same pattern as LlamaService `withEngineJob`.
 * Serializes ensureWhisper / release / transcribe so they never interleave.
 */
let whisperJobChain: Promise<unknown> = Promise.resolve();

function withWhisperJob<T>(fn: () => Promise<T>): Promise<T> {
  const run = whisperJobChain.then(fn, fn);
  whisperJobChain = run.catch(() => undefined);
  return run;
}

/** True when the Whisper Tiny bundle is fully on disk (exact sizeBytes). */
export async function isWhisperModelDownloaded(): Promise<boolean> {
  return isModelBundleDownloaded(WHISPER_MODEL);
}

/** Absolute local path of the whisper model file. */
export function whisperModelPath(): string {
  return modelLocalPath(WHISPER_MODEL, WHISPER_MODEL.file);
}

/**
 * Initialize whisper context once for the given path.
 * Concurrent callers are serialized via the mutex.
 */
export async function ensureWhisper(path: string): Promise<void> {
  return withWhisperJob(async () => {
    if (phase === "closing") {
      throw new Error("whisper_closing");
    }
    if (context && activePath === path && phase === "ready") return;

    if (context) {
      try {
        if (activeStop) {
          try {
            await activeStop();
          } catch {
            // ignore
          }
          activeStop = null;
        }
        await context.release();
      } catch {
        // ignore release errors on re-init
      }
      context = null;
      activePath = null;
      phase = "idle";
    }

    const next = await initWhisper({ filePath: path });
    context = next;
    activePath = path;
    phase = "ready";
  });
}

/** Ensure the registry whisper model is downloaded and loaded. */
export async function ensureDefaultWhisper(): Promise<void> {
  if (!(await isWhisperModelDownloaded())) {
    throw new WhisperModelMissingError();
  }
  await ensureWhisper(whisperModelPath());
}

/**
 * Transcribe mono 16 kHz signed 16-bit PCM (ArrayBuffer).
 * `locale` maps to whisper language codes "en" | "it".
 * Rejects odd-length buffers (int16 requires even byte count).
 */
export async function transcribePcm(
  pcm: ArrayBuffer,
  locale: Locale,
): Promise<string> {
  if (pcm.byteLength % 2 !== 0) {
    throw new Error("whisper_pcm_odd_length");
  }
  if (pcm.byteLength < 3200) {
    // < ~100 ms at 16 kHz mono int16 — treat as empty
    return "";
  }

  return withWhisperJob(async () => {
    if (phase === "closing") {
      throw new Error("whisper_closing");
    }
    if (!context) {
      // Load default inside the same job so we hold the mutex.
      if (!(await isWhisperModelDownloaded())) {
        throw new WhisperModelMissingError();
      }
      const path = whisperModelPath();
      const next = await initWhisper({ filePath: path });
      context = next;
      activePath = path;
      phase = "ready";
    }
    if (!context || phase !== "ready") {
      throw new WhisperModelMissingError();
    }

    const language: WhisperLocale = locale === "it" ? "it" : "en";
    const { promise, stop } = context.transcribeData(pcm, {
      language,
      maxThreads: 4,
    });
    activeStop = stop;
    try {
      const result = await promise;
      if (result.isAborted) return "";
      return (result.result ?? "").trim();
    } finally {
      activeStop = null;
    }
  });
}

/** Convenience: ensure model + transcribe a file path/URI in one call. */
export async function transcribeFile(
  fileUri: string,
  locale: Locale,
): Promise<string> {
  return withWhisperJob(async () => {
    if (phase === "closing") {
      throw new Error("whisper_closing");
    }
    if (!context) {
      if (!(await isWhisperModelDownloaded())) {
        throw new WhisperModelMissingError();
      }
      const modelPath = whisperModelPath();
      const next = await initWhisper({ filePath: modelPath });
      context = next;
      activePath = modelPath;
      phase = "ready";
    }
    if (!context || phase !== "ready") {
      throw new WhisperModelMissingError();
    }
    const language: WhisperLocale = locale === "it" ? "it" : "en";
    const path = fileUri.startsWith("file://") ? fileUri : `file://${fileUri}`;
    const { promise, stop } = context.transcribe(path, {
      language,
      maxThreads: 4,
    });
    activeStop = stop;
    try {
      const result = await promise;
      if (result.isAborted) return "";
      return (result.result ?? "").trim();
    } finally {
      activeStop = null;
    }
  });
}

/**
 * Release the whisper context. Enters `"closing"` so new transcribe jobs
 * reject until release finishes; aborts any in-flight transcription first.
 */
export async function releaseWhisper(): Promise<void> {
  return withWhisperJob(async () => {
    phase = "closing";
    if (activeStop) {
      try {
        await activeStop();
      } catch {
        // ignore
      }
      activeStop = null;
    }
    if (context) {
      try {
        await context.release();
      } catch {
        // ignore
      }
    }
    context = null;
    activePath = null;
    phase = "idle";
  });
}

export class WhisperModelMissingError extends Error {
  readonly code = "whisper_model_missing" as const;
  constructor() {
    super("whisper_model_missing");
    this.name = "WhisperModelMissingError";
  }
}
