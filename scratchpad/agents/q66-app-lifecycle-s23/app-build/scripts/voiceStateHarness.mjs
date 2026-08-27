/**
 * Harness for src/voice/voiceUiState.ts (pure mic-tap resolver + phase reduce).
 *
 * Covers: second tap stops, tap during transcribing does not restart capture,
 * error path returns to idle, stop with no audio does not hang (phase only —
 * empty PCM short-circuit is UI-side; here we pin phase transitions).
 *
 * Compile-from-disk pattern (same as engineParamsHarness). Exit 1 on fail.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function compile() {
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/voice/voiceUiState.ts",
      "--outDir",
      "scripts/.build",
      "--module",
      "nodenext",
      "--target",
      "es2020",
      "--moduleResolution",
      "nodenext",
      "--skipLibCheck",
      "--ignoreConfig",
      "--esModuleInterop",
      "--types",
      "node",
    ],
    { cwd: projectRoot, encoding: "utf8", shell: true },
  );
  if (r.status !== 0) {
    console.error("tsc failed:\n", r.stdout, r.stderr);
    process.exit(1);
  }
}

function resolveBuilt() {
  const candidates = [
    path.join(projectRoot, "scripts/.build/voiceUiState.js"),
    path.join(projectRoot, "scripts/.build/voice/voiceUiState.js"),
    path.join(projectRoot, "scripts/.build/src/voice/voiceUiState.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(
    "Could not find compiled voiceUiState.js. Tried:\n",
    candidates.join("\n"),
  );
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertIntent(got, expectedType, detail = "") {
  assert(
    got && got.type === expectedType,
    `expected intent ${expectedType}, got ${JSON.stringify(got)}${detail ? ` (${detail})` : ""}`,
  );
}

async function main() {
  console.log("Compiling voiceUiState.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  // Drop stale module from a previous harness run in the same process.
  delete require.cache[require.resolve(modPath)];
  const mod = require(modPath);
  const { resolveMicTap, reduceVoicePhase } = mod;
  assert(typeof resolveMicTap === "function", "resolveMicTap missing");
  assert(typeof reduceVoicePhase === "function", "reduceVoicePhase missing");

  // ── 1) Second tap stops (listening + capturing) ─────────────────────────
  {
    const start = resolveMicTap({
      phase: "idle",
      capturing: false,
      busy: false,
      stopInFlight: false,
      sending: false,
    });
    assertIntent(start, "start", "idle → start");

    const listening = reduceVoicePhase("idle", { type: "STARTED" });
    assert(listening === "listening", `STARTED → listening, got ${listening}`);

    // Field bug: busy stays true while listening; second tap must still STOP.
    const secondTap = resolveMicTap({
      phase: "listening",
      capturing: true,
      busy: true,
      stopInFlight: false,
      sending: false,
    });
    assertIntent(secondTap, "stop", "second tap while listening");

    // Stale-looking flags: capturing true even if phase ref lagged as idle.
    const stopViaCapture = resolveMicTap({
      phase: "idle",
      capturing: true,
      busy: true,
      stopInFlight: false,
      sending: false,
    });
    assertIntent(stopViaCapture, "stop", "capturing overrides idle phase");

    // Phase listening even if capture module already drained (desync).
    const stopViaPhase = resolveMicTap({
      phase: "listening",
      capturing: false,
      busy: true,
      stopInFlight: false,
      sending: false,
    });
    assertIntent(stopViaPhase, "stop", "listening phase without capturing");
  }

  // ── 2) Tap during transcribing does not restart capture ─────────────────
  {
    const phase = reduceVoicePhase("listening", { type: "STOP_BEGIN" });
    assert(phase === "transcribing", `STOP_BEGIN → transcribing, got ${phase}`);

    const midTranscribe = resolveMicTap({
      phase: "transcribing",
      capturing: false,
      busy: true,
      stopInFlight: true,
      sending: false,
    });
    assertIntent(midTranscribe, "ignore", "tap while transcribing");
    assert(
      midTranscribe.reason === "transcribing" ||
        midTranscribe.reason === "stop_in_flight",
      `transcribe ignore reason, got ${midTranscribe.reason}`,
    );

    // stopInFlight alone (race) must not restart.
    const stopInFlightOnly = resolveMicTap({
      phase: "idle",
      capturing: false,
      busy: true,
      stopInFlight: true,
      sending: false,
    });
    assertIntent(stopInFlightOnly, "ignore", "stopInFlight without capture");
  }

  // ── 3) Error path returns to idle ───────────────────────────────────────
  {
    let phase = reduceVoicePhase("idle", { type: "STARTED" });
    phase = reduceVoicePhase(phase, { type: "STOP_BEGIN" });
    phase = reduceVoicePhase(phase, { type: "ERROR" });
    assert(phase === "idle", `ERROR → idle, got ${phase}`);

    // CANCEL (background / clearChat) also idles from listening.
    phase = reduceVoicePhase("listening", { type: "CANCEL" });
    assert(phase === "idle", `CANCEL → idle, got ${phase}`);

    // DONE after successful transcribe.
    phase = reduceVoicePhase("transcribing", { type: "DONE" });
    assert(phase === "idle", `DONE → idle, got ${phase}`);
  }

  // ── 4) Stop with no audio does not hang (phase machine only) ────────────
  // Empty PCM short-circuit is in AiChatPage; here we assert stop→transcribing
  // →DONE never leaves a non-idle phase without an event, and start_in_flight
  // does not look like a hang (ignore, not start).
  {
    const startInFlight = resolveMicTap({
      phase: "idle",
      capturing: false,
      busy: true,
      stopInFlight: false,
      sending: false,
    });
    assertIntent(startInFlight, "ignore", "permission/pre-init busy");
    assert(
      startInFlight.reason === "start_in_flight",
      `expected start_in_flight, got ${startInFlight.reason}`,
    );

    // Empty-audio path: stop begins, then DONE (UI skips whisper on short PCM).
    let phase = "listening";
    phase = reduceVoicePhase(phase, { type: "STOP_BEGIN" });
    assert(phase === "transcribing", "empty-audio still enters transcribing");
    phase = reduceVoicePhase(phase, { type: "DONE" });
    assert(phase === "idle", "empty-audio completes to idle (no hang)");
  }

  // ── 5) Sending blocks mic ───────────────────────────────────────────────
  {
    const whileSending = resolveMicTap({
      phase: "idle",
      capturing: false,
      busy: false,
      stopInFlight: false,
      sending: true,
    });
    assertIntent(whileSending, "ignore", "sending");
    assert(whileSending.reason === "sending", "sending reason");
  }

  console.log("All voiceState harness cases passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
