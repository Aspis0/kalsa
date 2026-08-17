/**
 * Module-level T. Commit only after the engine accepts a completion.
 * Abort/dispose/refuse leave the last committed T and mark a named rebuild.
 */

import {
  decideAdvance,
  firstDiverge,
  generationSuffix,
  glueEot,
  refuseReasonFromResult,
  transcriptFingerprint,
  type AdvanceDecision,
  type KvRebuildReason,
} from "./kvTranscriptDelta";

export type { AdvanceDecision, KvRebuildReason } from "./kvTranscriptDelta";

let transcript = "";
let lastPPrev: string | null = null;
let envHashForT: string | undefined;
let epoch = 0;
let pendingRebuild: KvRebuildReason | undefined;
let commitLen = 0;
let commitFp = transcriptFingerprint("");

function recordCommit(): void {
  commitLen = transcript.length;
  commitFp = transcriptFingerprint(transcript);
}

function logKv(payload: Record<string, unknown>): void {
  console.log("KALSA_KVTRANSCRIPT " + JSON.stringify(payload));
}

export function logKvHalt(extra?: Record<string, unknown>): void {
  logKv({ op: "halt", ...extra });
}

export function getKvEpoch(): number {
  return epoch;
}

export function markKvUntrusted(reason: KvRebuildReason): void {
  pendingRebuild = reason;
}

export function getPendingRebuild(): KvRebuildReason | undefined {
  return pendingRebuild;
}

export function resetKvTranscript(): void {
  transcript = "";
  lastPPrev = null;
  envHashForT = undefined;
  pendingRebuild = undefined;
  epoch += 1;
  recordCommit();
}

/**
 * Seed T from NativeSessionLoadResult.prompt — the native KV bytes, as-generated
 * (think block included). Template renders of the same history are the
 * history-shape (think stripped). Those two strings are never textually equal;
 * pPrev is only a ruler for what is new, not a claim about T. Do not require
 * T === pPrev (that disables append on every restore).
 */
export function seedKvTranscript(prompt: string, envHash?: string): void {
  transcript = prompt;
  lastPPrev = null;
  envHashForT = envHash;
  pendingRebuild = undefined;
  epoch += 1;
  recordCommit();
  logKv({ op: "session_restore", tLen: transcript.length });
}

export function getKvTranscript(): string {
  return transcript;
}

/** Does not mutate T or pendingRebuild. */
export function computeCandidatePrompt(args: {
  pPrev: string;
  pNew: string;
  envHash: string;
  kvHoldsChatSession: boolean;
  eot?: string;
}): { prompt: string; decision: AdvanceDecision } {
  const decision = decideAdvance({
    t: transcript,
    pPrev: args.pPrev,
    pNew: args.pNew,
    envHash: args.envHash,
    envHashForT,
    lastPPrev,
    kvHoldsChatSession: args.kvHoldsChatSession,
    pendingReason: pendingRebuild,
    commitLen,
    commitFp,
  });
  // Append path: T (KV, as-generated) + optional eot glue + (pNew − pPrev).
  // pPrev is a ruler, not T. Glue eot when restore left T without it.
  const prompt =
    decision.kind === "rebuild"
      ? args.pNew
      : glueEot(transcript, decision.delta, args.eot ?? "");
  if (decision.kind === "rebuild" && decision.reason === "prefix_mismatch") {
    const d = firstDiverge(args.pNew, args.pPrev);
    console.log(
      "KALSA_KVDIVERGE " +
        JSON.stringify({
          offset: d.offset,
          prevLen: args.pPrev.length,
          newLen: args.pNew.length,
          prev: d.prevWin,
          next: d.newWin,
        }),
    );
  }
  if (decision.kind === "rebuild") {
    logKv({ op: "rebuild", reason: decision.reason, tLen: prompt.length });
  } else {
    const glued = prompt.length - transcript.length - decision.delta.length;
    logKv({
      op: "delta",
      prevLen: args.pPrev.length,
      newLen: args.pNew.length,
      deltaLen: decision.delta.length,
      glueLen: glued,
      tTail: transcript.slice(-48),
      dHead: decision.delta.slice(0, 48),
      tLen: prompt.length,
    });
  }
  return { prompt, decision };
}

export function commitAcceptedCompletion(args: {
  candidate: string;
  emitted: string;
  eot: string;
  stoppingWord: string;
  stoppedWord: string;
  pPrev: string;
  envHash: string;
  epoch: number;
  consumeReason?: KvRebuildReason;
}): boolean {
  if (args.epoch !== epoch) return false;
  const suffix = generationSuffix(
    args.emitted,
    args.eot,
    args.stoppingWord,
    args.stoppedWord,
  );
  transcript = args.candidate + args.emitted + suffix;
  lastPPrev = args.pPrev;
  envHashForT = args.envHash;
  if (args.consumeReason && pendingRebuild === args.consumeReason) {
    pendingRebuild = undefined;
  }
  recordCommit();
  logKv({
    op: "append_gen",
    emittedLen: args.emitted.length,
    eotLen: suffix.length,
  });
  return true;
}

/**
 * Only commit path for a native completion result.
 * Refuses when context_full / truncated / interrupted.
 */
export function commitFromNativeResult(args: {
  candidate: string;
  emitted: string;
  eot: string;
  stoppingWord: string;
  stoppedWord: string;
  pPrev: string;
  envHash: string;
  epoch: number;
  context_full: boolean;
  truncated: boolean;
  interrupted: boolean;
  tokens_cached?: number;
  tokens_evaluated?: number;
  consumeReason?: KvRebuildReason;
}): "committed" | KvRebuildReason {
  const refuse = refuseReasonFromResult(args);
  if (refuse) {
    markKvUntrusted(refuse);
    return refuse;
  }
  const ok = commitAcceptedCompletion(args);
  return ok ? "committed" : "completion_failed";
}

export function applyGeneration(
  emitted: string,
  eot: string,
  stoppingWord: string,
  stoppedWord: string,
  capturedEpoch = epoch,
): string {
  commitAcceptedCompletion({
    candidate: transcript,
    emitted,
    eot,
    stoppingWord,
    stoppedWord,
    pPrev: lastPPrev ?? "",
    envHash: envHashForT ?? "",
    epoch: capturedEpoch,
  });
  return transcript;
}
