/**
 * Pure delta-rule tests. No module state.
 */

import {
  decideAdvance,
  generationSuffix,
  messagesThroughLastAssistant,
  refuseReasonFromResult,
  sliceDelta,
  transcriptFingerprint,
} from "./kvTranscriptDelta";

describe("sliceDelta", () => {
  test("prefix match returns the suffix", () => {
    expect(sliceDelta("ABCdef", "ABC")).toBe("def");
  });

  test("identical strings yield empty delta", () => {
    expect(sliceDelta("ABC", "ABC")).toBe("");
  });

  test("prefix mismatch returns null", () => {
    expect(sliceDelta("XYdef", "ABC")).toBe(null);
  });

  test("pPrev longer than pNew is a mismatch", () => {
    expect(sliceDelta("ab", "abcd")).toBe(null);
  });

  test("surrogate-pair cut is a mismatch, not a lone low surrogate", () => {
    const high = "\uD83D";
    const smile = "\uD83D\uDE00";
    expect(sliceDelta(`x${smile}`, `x${high}`)).toBe(null);
    expect(sliceDelta(`ok${smile}`, "ok")).toBe(smile);
  });
});

describe("transcriptFingerprint", () => {
  test("same-length DJB2 collision pair is distinct", () => {
    expect(transcriptFingerprint("BA")).not.toBe(transcriptFingerprint("Ab"));
  });
});

describe("messagesThroughLastAssistant", () => {
  test("no assistant keeps only leading system", () => {
    expect(
      messagesThroughLastAssistant([
        { role: "system", content: "s" },
        { role: "user", content: "u" },
      ]),
    ).toEqual([{ role: "system", content: "s" }]);
  });

  test("one assistant keeps through that message", () => {
    const msgs = [
      { role: "system", content: "s" },
      { role: "user", content: "u" },
      { role: "assistant", content: "a" },
    ];
    expect(messagesThroughLastAssistant(msgs)).toEqual(msgs);
  });

  test("trailing user+note stay out of the prefix", () => {
    expect(
      messagesThroughLastAssistant([
        { role: "system", content: "s" },
        { role: "user", content: "u1" },
        { role: "assistant", content: "a" },
        { role: "user", content: "note" },
        { role: "user", content: "u2" },
      ]),
    ).toEqual([
      { role: "system", content: "s" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a" },
    ]);
  });
});

describe("generationSuffix", () => {
  test("eot already in emitted appends nothing more", () => {
    expect(generationSuffix("hello<|im_end|>\n", "<|im_end|>\n", "", "")).toBe("");
  });

  test("dummy eot with newline is appended", () => {
    expect(generationSuffix("hello", "<|im_end|>\n", "ignored", "")).toBe(
      "<|im_end|>\n",
    );
  });

  test("stopping_word fallback when eot is empty", () => {
    expect(generationSuffix("hello", "", "<|im_end|>", "")).toBe("<|im_end|>");
  });

  test("does not double-append stopping_word", () => {
    expect(generationSuffix("hello<|im_end|>", "", "<|im_end|>", "")).toBe("");
  });

  test("abort with zero tokens appends nothing (no EOT)", () => {
    expect(generationSuffix("", "<|im_end|>\n", "STOP", "x")).toBe("");
  });
});

describe("refuseReasonFromResult", () => {
  test("context_full wins over truncated and interrupted", () => {
    expect(
      refuseReasonFromResult({
        context_full: true,
        truncated: true,
        interrupted: true,
      }),
    ).toBe("context_full");
  });

  test("truncated is its own reason", () => {
    expect(refuseReasonFromResult({ truncated: true })).toBe("truncated");
  });

  test("interrupted is completion_failed", () => {
    expect(refuseReasonFromResult({ interrupted: true })).toBe(
      "completion_failed",
    );
  });

  test("clean result is accepted", () => {
    expect(
      refuseReasonFromResult({
        context_full: false,
        truncated: false,
        interrupted: false,
      }),
    ).toBeNull();
  });
});

describe("decideAdvance rebuild reasons", () => {
  const base = {
    t: "AB",
    pPrev: "A",
    pNew: "AB",
    envHash: "h1",
    envHashForT: "h1",
    lastPPrev: "A",
    kvHoldsChatSession: true,
  };

  test("prefix_mismatch", () => {
    expect(decideAdvance({ ...base, pPrev: "xx", pNew: "yy" })).toEqual({
      kind: "rebuild",
      reason: "prefix_mismatch",
    });
  });

  test("fresh when T is empty", () => {
    expect(decideAdvance({ ...base, t: "" })).toEqual({
      kind: "rebuild",
      reason: "fresh",
    });
  });

  test("system_prompt_changed", () => {
    expect(decideAdvance({ ...base, envHash: "h2" })).toEqual({
      kind: "rebuild",
      reason: "system_prompt_changed",
    });
  });

  test("history_rewritten", () => {
    expect(
      decideAdvance({ ...base, pPrev: "XY", pNew: "XYZ", lastPPrev: "AB" }),
    ).toEqual({ kind: "rebuild", reason: "history_rewritten" });
  });

  test("kv_cleared", () => {
    expect(decideAdvance({ ...base, kvHoldsChatSession: false })).toEqual({
      kind: "rebuild",
      reason: "kv_cleared",
    });
  });

  test("delta when prefix holds", () => {
    expect(decideAdvance({ ...base, t: "A", pNew: "ABC" })).toEqual({
      kind: "delta",
      delta: "BC",
    });
  });

  test("completion_failed pending wins over delta", () => {
    expect(
      decideAdvance({ ...base, pendingReason: "completion_failed" }),
    ).toEqual({ kind: "rebuild", reason: "completion_failed" });
  });

  test("eot_unknown pending forces rebuild", () => {
    expect(decideAdvance({ ...base, pendingReason: "eot_unknown" })).toEqual({
      kind: "rebuild",
      reason: "eot_unknown",
    });
  });

  test("tool_round pending forces rebuild", () => {
    expect(decideAdvance({ ...base, pendingReason: "tool_round" })).toEqual({
      kind: "rebuild",
      reason: "tool_round",
    });
  });

  test("media pending forces rebuild", () => {
    expect(decideAdvance({ ...base, pendingReason: "media" })).toEqual({
      kind: "rebuild",
      reason: "media",
    });
  });

  test("context_full pending forces rebuild", () => {
    expect(decideAdvance({ ...base, pendingReason: "context_full" })).toEqual({
      kind: "rebuild",
      reason: "context_full",
    });
  });

  test("truncated pending forces rebuild", () => {
    expect(decideAdvance({ ...base, pendingReason: "truncated" })).toEqual({
      kind: "rebuild",
      reason: "truncated",
    });
  });

  test("commit_mismatch when T does not match the fingerprint", () => {
    expect(
      decideAdvance({ ...base, t: "AB", commitLen: 0, commitFp: "0:0" }),
    ).toEqual({ kind: "rebuild", reason: "commit_mismatch" });
  });
});
