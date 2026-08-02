/**
 * Tap-to-talk PCM capture via @fugood/react-native-audio-pcm-stream.
 *
 * Strategy (chosen for robustness over RealtimeTranscriber):
 * - init LiveAudioStream at 16 kHz mono 16-bit PCM
 * - on('data') → collect base64 chunks (byte-capped)
 * - stop → merge to ArrayBuffer → WhisperService.transcribePcm
 *
 * State machine: idle → starting → recording → stopping → idle.
 * startCapture() throws CaptureBusyError when not idle (documented; not idempotent).
 * Any setup failure runs best-effort LiveAudioStream.stop() + listener remove + chunk reset.
 *
 * Hard cap: 60 s OR ~2 MB accumulated PCM base64 payload (≈32 KB/s raw at 16 kHz/mono/16-bit),
 * whichever comes first → auto-stop stream, fire onLimitReached, leave buffer for stopCapture().
 *
 * Permission: PermissionsAndroid.RECORD_AUDIO (core RN, no extra deps).
 * The native module does not request permission itself.
 */

import { PermissionsAndroid, Platform } from "react-native";
import LiveAudioStream from "@fugood/react-native-audio-pcm-stream";

const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
/** Android MediaRecorder.AudioSource.VOICE_RECOGNITION */
const AUDIO_SOURCE = 6;
const BUFFER_SIZE = 4096;

/** Max recording wall-clock duration. */
export const MAX_CAPTURE_MS = 60_000;
/**
 * Cap on accumulated base64 payload size (~2 MB).
 * Raw PCM is ~32 KB/s; base64 expands ~4/3, so this is a bit under 60 s of audio.
 */
export const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

export type CaptureState = "idle" | "starting" | "recording" | "stopping";

export type CaptureLimitHandler = () => void;

/** Thrown by startCapture when the machine is not idle. Map to voice.error in UI. */
export class CaptureBusyError extends Error {
  readonly code = "capture_busy" as const;
  constructor() {
    super("capture_busy");
    this.name = "CaptureBusyError";
  }
}

let state: CaptureState = "idle";
let chunks: string[] = [];
/** Approximate accumulated base64 character length (proxy for bytes). */
let totalChars = 0;
let dataSub: { remove: () => void } | null = null;
let limitTimer: ReturnType<typeof setTimeout> | null = null;
let limitHandler: CaptureLimitHandler | null = null;
let limitFired = false;
/** Stream already stopped (e.g. by auto-limit) but buffer still held for stopCapture. */
let streamStopped = false;

/** Decode a base64 PCM chunk without relying on Node Buffer. */
function base64ToUint8Array(b64: string): Uint8Array {
  // React Native provides atob in modern Hermes/JSC runtimes.
  if (typeof globalThis.atob !== "function") {
    throw new Error("base64 decoder unavailable");
  }
  const binary = globalThis.atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function mergeChunks(parts: string[]): ArrayBuffer {
  const arrays = parts.map(base64ToUint8Array);
  let total = 0;
  for (const a of arrays) total += a.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.byteLength;
  }
  return out.buffer;
}

function clearLimitTimer(): void {
  if (limitTimer !== null) {
    clearTimeout(limitTimer);
    limitTimer = null;
  }
}

function removeDataListener(): void {
  if (dataSub) {
    try {
      dataSub.remove();
    } catch {
      // ignore
    }
    dataSub = null;
  }
}

async function stopStreamBestEffort(): Promise<void> {
  if (streamStopped && state !== "starting") {
    // Already stopped by limit path (or never started).
    return;
  }
  try {
    await Promise.resolve(LiveAudioStream.stop());
  } catch {
    // ignore
  }
  streamStopped = true;
}

/**
 * Full teardown: stop stream, drop listener/timer, clear buffer, idle.
 * Safe from any state. Used on cancel and setup failure.
 */
async function hardReset(): Promise<void> {
  clearLimitTimer();
  removeDataListener();
  await stopStreamBestEffort();
  chunks = [];
  totalChars = 0;
  limitHandler = null;
  limitFired = false;
  streamStopped = false;
  state = "idle";
}

/**
 * Stop the live stream (free mic) but keep chunks so stopCapture can return them.
 * Invokes the limit handler once.
 */
async function fireLimit(): Promise<void> {
  if (limitFired || state !== "recording") return;
  limitFired = true;
  clearLimitTimer();
  removeDataListener();
  await stopStreamBestEffort();
  // Stay conceptually "recording" with a frozen buffer so stopCapture still works
  // and isCapturing() remains true until the UI drains the buffer.
  const handler = limitHandler;
  limitHandler = null;
  try {
    handler?.();
  } catch {
    // ignore handler errors
  }
}

function onPcmChunk(data: string): void {
  if (state !== "recording" || limitFired) return;
  if (typeof data !== "string" || data.length === 0) return;
  chunks.push(data);
  totalChars += data.length;
  if (totalChars >= MAX_CAPTURE_BYTES) {
    void fireLimit();
  }
}

/** Request microphone permission. iOS handles via Info.plist prompt at first use. */
export async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const existing = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    if (existing) return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export function getCaptureState(): CaptureState {
  return state;
}

/** True while a capture session owns the mic or still holds a buffer for stopCapture. */
export function isCapturing(): boolean {
  return state === "starting" || state === "recording" || state === "stopping";
}

/**
 * Start PCM capture.
 *
 * @throws {CaptureBusyError} when state is not `"idle"` (not idempotent — call stop/cancel first).
 * @throws on native init/start failure (after best-effort cleanup back to idle).
 *
 * Options:
 * - `onLimitReached`: fired once when 60 s or ~2 MB is hit; stream is already stopped,
 *   call `stopCapture()` to obtain the PCM buffer and free the session.
 */
export async function startCapture(opts?: {
  onLimitReached?: CaptureLimitHandler;
}): Promise<void> {
  if (state !== "idle") {
    throw new CaptureBusyError();
  }

  state = "starting";
  chunks = [];
  totalChars = 0;
  limitFired = false;
  streamStopped = false;
  limitHandler = opts?.onLimitReached ?? null;

  try {
    // Detach any previous listener before re-init (Android releases recorder on stop).
    removeDataListener();

    const maybePromise = LiveAudioStream.init({
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      bitsPerSample: BITS_PER_SAMPLE,
      audioSource: AUDIO_SOURCE,
      bufferSize: BUFFER_SIZE,
      wavFile: "",
    });
    if (
      maybePromise &&
      typeof (maybePromise as Promise<void>).then === "function"
    ) {
      await maybePromise;
    }

    // Bail if cancelCapture raced during init.
    if (state !== "starting") {
      await hardReset();
      throw new CaptureBusyError();
    }

    const sub = LiveAudioStream.on("data", onPcmChunk);
    if (sub && typeof sub.remove === "function") {
      dataSub = sub;
    }

    LiveAudioStream.start();

    if (state !== "starting") {
      // Cancelled mid-start after start() — tear down.
      await hardReset();
      throw new CaptureBusyError();
    }

    state = "recording";
    streamStopped = false;
    limitTimer = setTimeout(() => {
      void fireLimit();
    }, MAX_CAPTURE_MS);
  } catch (error) {
    // ANY setup failure: stop + remove listener + reset chunks.
    clearLimitTimer();
    removeDataListener();
    await stopStreamBestEffort();
    chunks = [];
    totalChars = 0;
    limitHandler = null;
    limitFired = false;
    streamStopped = false;
    state = "idle";
    throw error;
  }
}

/**
 * Stop capture and return merged mono 16 kHz int16 PCM as ArrayBuffer.
 * Captures the chunk list locally first; finally always stops stream, removes
 * listener, and resets — even if merge/decode fails.
 * Safe to call when not recording (returns empty buffer).
 */
export async function stopCapture(): Promise<ArrayBuffer> {
  if (state === "idle") {
    return new ArrayBuffer(0);
  }

  // Capture buffer locally BEFORE teardown so merge can run after finally resets.
  const parts = chunks;
  chunks = [];
  totalChars = 0;
  const previousState = state;
  state = "stopping";
  clearLimitTimer();
  limitHandler = null;

  try {
    // If still starting, never got data — just hard-reset.
    if (previousState === "starting") {
      return new ArrayBuffer(0);
    }
    await stopStreamBestEffort();
    try {
      return mergeChunks(parts);
    } catch {
      // decode/merge failure → empty buffer (session still cleaned in finally)
      return new ArrayBuffer(0);
    }
  } finally {
    removeDataListener();
    // Ensure stream is stopped even if the try path threw before stopStreamBestEffort.
    await stopStreamBestEffort();
    chunks = [];
    totalChars = 0;
    limitHandler = null;
    limitFired = false;
    streamStopped = false;
    state = "idle";
  }
}

/**
 * Abort capture without returning audio (e.g. on unmount / AppState background).
 * Works from `"starting"` as well as `"recording"` / `"stopping"`.
 */
export async function cancelCapture(): Promise<void> {
  if (state === "idle") {
    chunks = [];
    totalChars = 0;
    return;
  }
  await hardReset();
}
