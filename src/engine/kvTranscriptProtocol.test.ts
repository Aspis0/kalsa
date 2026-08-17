/**
 * Commit-after-accept protocol. Loaded by kvTranscript.test.ts.
 */

import {
  commitAcceptedCompletion,
  commitFromNativeResult,
  computeCandidatePrompt,
  getKvEpoch,
  getKvTranscript,
  markKvUntrusted,
  resetKvTranscript,
  seedKvTranscript,
} from "./kvTranscript";
import type { KvRebuildReason } from "./kvTranscriptDelta";

function nativeCommit(
  extra: {
    context_full?: boolean;
    truncated?: boolean;
    interrupted?: boolean;
    epoch?: number;
    candidate?: string;
    emitted?: string;
    consumeReason?: KvRebuildReason;
  } = {},
) {
  return commitFromNativeResult({
    candidate: extra.candidate ?? "sys user gen",
    emitted: extra.emitted ?? "ans",
    eot: "<eot>",
    stoppingWord: "",
    stoppedWord: "",
    pPrev: "sys",
    envHash: "h",
    epoch: extra.epoch ?? getKvEpoch(),
    context_full: extra.context_full === true,
    truncated: extra.truncated === true,
    interrupted: extra.interrupted === true,
    consumeReason: extra.consumeReason,
  });
}

function advance(
  pNew: string,
  pPrev = "sys",
  envHash = "h",
  holds = true,
) {
  return computeCandidatePrompt({
    pPrev,
    pNew,
    envHash,
    kvHoldsChatSession: holds,
  });
}

describe("commit protocol", () => {
  afterEach(() => {
    resetKvTranscript();
  });

  test("rejection leaves T uncommitted", () => {
    const { prompt, decision } = advance("sys user gen", "sys", "h", false);
    expect(decision).toEqual({ kind: "rebuild", reason: "fresh" });
    expect(prompt).toBe("sys user gen");
    expect(getKvTranscript()).toBe("");
    markKvUntrusted("completion_failed");
    expect(advance("sys user gen", "sys", "h", false).decision).toEqual({
      kind: "rebuild",
      reason: "completion_failed",
    });
    expect(getKvTranscript()).toBe("");
  });

  test("context_full refuses commit and marks that reason", () => {
    advance("sys user gen");
    expect(nativeCommit({ context_full: true })).toBe("context_full");
    expect(getKvTranscript()).toBe("");
    expect(advance("sys user gen").decision).toEqual({
      kind: "rebuild",
      reason: "context_full",
    });
  });

  test("truncated refuses commit and marks that reason", () => {
    advance("sys user gen");
    expect(nativeCommit({ truncated: true })).toBe("truncated");
    expect(getKvTranscript()).toBe("");
    expect(advance("sys user gen").decision).toEqual({
      kind: "rebuild",
      reason: "truncated",
    });
  });

  test("cancellation during formatting does not commit T", () => {
    const epoch = getKvEpoch();
    const { prompt } = advance("sys user gen");
    expect(getKvTranscript()).toBe("");
    resetKvTranscript();
    expect(nativeCommit({ epoch, candidate: prompt })).toBe("completion_failed");
    expect(getKvTranscript()).toBe("");
  });

  test("image turn then text-only turn rebuilds with media", () => {
    const { prompt } = advance("sys img gen");
    expect(
      nativeCommit({ candidate: prompt, emitted: "saw", consumeReason: "fresh" }),
    ).toBe("committed");
    markKvUntrusted("media");
    expect(getKvTranscript()).toBe("sys img gensaw<eot>");
    const next = advance("sys img gensaw<eot> text gen", "sys img gensaw<eot>");
    expect(next.decision).toEqual({ kind: "rebuild", reason: "media" });
    expect(getKvTranscript()).toBe("sys img gensaw<eot>");
  });

  test("dispose during generation does not resurrect T", () => {
    const epoch = getKvEpoch();
    advance("sys user gen");
    resetKvTranscript();
    expect(
      commitAcceptedCompletion({
        candidate: "sys user gen",
        emitted: "ans",
        eot: "<eot>",
        stoppingWord: "",
        stoppedWord: "",
        pPrev: "sys",
        envHash: "h",
        epoch,
      }),
    ).toBe(false);
    expect(getKvTranscript()).toBe("");
  });

  test("ON then reset (OFF turn) then ON rebuilds full P_new", () => {
    const epoch = getKvEpoch();
    const { prompt } = advance("ON1");
    commitAcceptedCompletion({
      candidate: prompt,
      emitted: "ans",
      eot: "\n",
      stoppingWord: "",
      stoppedWord: "",
      pPrev: "sys",
      envHash: "h",
      epoch,
    });
    expect(getKvTranscript()).toBe("ON1ans\n");
    resetKvTranscript();
    const again = advance("ON1ans\nOFF gen", "ON1ans\n");
    expect(again.decision).toEqual({ kind: "rebuild", reason: "fresh" });
    expect(again.prompt).toBe("ON1ans\nOFF gen");
    expect(getKvTranscript()).toBe("");
  });

  test("aux clear then ON turn rebuilds", () => {
    seedKvTranscript("chatT", "h");
    resetKvTranscript();
    expect(advance("sys user gen", "sys", "h", false).decision).toEqual({
      kind: "rebuild",
      reason: "fresh",
    });
    expect(getKvTranscript()).toBe("");
  });

  test("EOT capture failure forces a rebuild next advance", () => {
    seedKvTranscript("AB", "h1");
    markKvUntrusted("eot_unknown");
    const next = advance("ABuser", "AB", "h1");
    expect(next.decision).toEqual({ kind: "rebuild", reason: "eot_unknown" });
    expect(getKvTranscript()).toBe("AB");
  });

  test("seeded env-hash mismatch rebuilds with system_prompt_changed", () => {
    seedKvTranscript("AB", "h1");
    expect(advance("ABuser", "AB", "h2").decision).toEqual({
      kind: "rebuild",
      reason: "system_prompt_changed",
    });
    expect(getKvTranscript()).toBe("AB");
  });

  test("commit consumes matching pending; later marks survive", () => {
    markKvUntrusted("tool_round");
    expect(advance("sys user gen").decision).toEqual({
      kind: "rebuild",
      reason: "tool_round",
    });
    expect(nativeCommit({ consumeReason: "tool_round" })).toBe("committed");
    markKvUntrusted("eot_unknown");
    expect(
      advance("sys user genans<eot>x", "sys user genans<eot>").decision,
    ).toEqual({ kind: "rebuild", reason: "eot_unknown" });
  });
});
