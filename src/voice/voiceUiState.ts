/**
 * Pure voice UI phase machine for tap-to-talk.
 *
 * No React Native / native module imports — safe to compile and run from
 * Node harnesses (see scripts/harnesses/voiceStateHarness.mjs).
 *
 * Phases: idle → listening → transcribing → idle
 * Mic tap resolution is separate from reduce so UI can map intents to I/O.
 */

export type VoiceUiPhase = "idle" | "listening" | "transcribing";

export type VoiceMicIgnoreReason =
  | "sending"
  | "transcribing"
  | "stop_in_flight"
  | "start_in_flight";

export type VoiceMicIntent =
  | { type: "start" }
  | { type: "stop" }
  | { type: "ignore"; reason: VoiceMicIgnoreReason };

export type VoiceMicTapInput = {
  phase: VoiceUiPhase;
  /** True while VoiceCapture owns the mic or still holds a PCM buffer. */
  capturing: boolean;
  /** True for the whole start→stop run (sync guard for send/attach). */
  busy: boolean;
  /** True while stop+transcribe is in flight (user tap vs 60s limit). */
  stopInFlight: boolean;
  sending: boolean;
};

export type VoicePhaseEvent =
  | { type: "STARTED" }
  | { type: "STOP_BEGIN" }
  | { type: "DONE" }
  | { type: "ERROR" }
  | { type: "CANCEL" };

/**
 * Decide what a mic tap should do from sync flags (refs + capture module).
 *
 * Rules:
 * - Second tap while listening/capturing → always stop (never restart).
 * - Tap during transcription / stop-in-flight → ignore (caller shows a hint).
 * - Tap while start is in flight but capture not yet up → ignore start_in_flight
 *   (caller cancels the pending start so the UI cannot stick on a red mic).
 * - Otherwise from idle → start.
 */
export function resolveMicTap(input: VoiceMicTapInput): VoiceMicIntent {
  if (input.sending) {
    return { type: "ignore", reason: "sending" };
  }

  // Stop path first: phase or live capture both mean "end this session".
  if (input.capturing || input.phase === "listening") {
    if (input.stopInFlight || input.phase === "transcribing") {
      return { type: "ignore", reason: "stop_in_flight" };
    }
    return { type: "stop" };
  }

  if (input.phase === "transcribing" || input.stopInFlight) {
    return { type: "ignore", reason: "transcribing" };
  }

  // Busy but not capturing yet (e.g. permission / pre-init await).
  if (input.busy || input.phase !== "idle") {
    return { type: "ignore", reason: "start_in_flight" };
  }

  return { type: "start" };
}

/** Pure phase transition. Unknown events leave the phase unchanged. */
export function reduceVoicePhase(
  phase: VoiceUiPhase,
  event: VoicePhaseEvent,
): VoiceUiPhase {
  switch (event.type) {
    case "STARTED":
      return "listening";
    case "STOP_BEGIN":
      return "transcribing";
    case "DONE":
    case "ERROR":
    case "CANCEL":
      return "idle";
    default:
      return phase;
  }
}
