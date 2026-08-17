/**
 * Pure delta-rule tests. No module state.
 */

import {
  decideAdvance,
  dropReRenderedTail,
  firstDiverge,
  generationSuffix,
  glueEot,
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

describe("firstDiverge", () => {
  test("offset is the first differing index", () => {
    const d = firstDiverge("aaaXbbb", "aaaYbbb");
    expect(d.offset).toBe(3);
    expect(d.prevWin).toContain("Y");
    expect(d.newWin).toContain("X");
  });

  test("windows are capped at 80", () => {
    const prev = "P".repeat(200);
    const next = "P".repeat(50) + "Q" + "P".repeat(149);
    const d = firstDiverge(next, prev);
    expect(d.offset).toBe(50);
    expect(d.prevWin.length).toBeLessThanOrEqual(80);
    expect(d.newWin.length).toBeLessThanOrEqual(80);
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

describe("glueEot", () => {
  const eot = "<|im_end|>\n";
  const delta = "<|im_start|>user\nU1<|im_end|>\n<|im_start|>assistant\n";

  test("inserts eot when T ends at a generated period (turn-6 join)", () => {
    const t = "Per favore, usa un formato JSON valido.";
    const prompt = glueEot(t, delta, eot);
    expect(prompt.startsWith(t + eot)).toBe(true);
    expect(prompt).toBe(t + eot + delta);
    expect(prompt.includes("valido.<|im_start|>")).toBe(false);
  });

  test("does not double-insert when T already ends with eot", () => {
    const t = `hello${eot}`;
    expect(glueEot(t, delta, eot)).toBe(t + delta);
  });

  test("restores trailing newline if restore dropped it", () => {
    const t = "hello<|im_end|>";
    expect(glueEot(t, delta, eot)).toBe(t + "\n" + delta);
  });
});

describe("dropReRenderedTail", () => {
  const eot = "<|im_end|>\n";
  const emitted = "Di che cosa hai bisogno?";
  const user = "<|im_start|>user\nnext";

  test("drops emitted+eot prefix (normal commit)", () => {
    const t = `<think>\n\n</think>\n\n${emitted}${eot}`;
    const delta = `${emitted}${eot}${user}`;
    expect(dropReRenderedTail(delta, emitted, eot, t)).toBe(user);
  });

  test("drops emitted-only prefix (post-restore)", () => {
    const t = `<think>\n\n</think>\n\n${emitted}`;
    const delta = `${emitted}${eot}${user}`;
    expect(dropReRenderedTail(delta, emitted, eot, t)).toBe(user);
  });

  test("untouched when delta does not start with emitted", () => {
    const t = `<think>\n\n</think>\n\n${emitted}`;
    const delta = user;
    expect(dropReRenderedTail(delta, emitted, eot, t)).toBe(user);
  });

  test("empty emitted leaves delta unchanged", () => {
    expect(dropReRenderedTail(user, "", eot, "T")).toBe(user);
  });

  test("belt: T does not end with emitted — no trim", () => {
    const t = "unrelated tail";
    const delta = `${emitted}${eot}${user}`;
    expect(dropReRenderedTail(delta, emitted, eot, t)).toBe(delta);
  });

  test("emitted also later in delta is not trimmed twice", () => {
    const t = `head${emitted}`;
    const delta = `${emitted}${eot}${emitted}${user}`;
    expect(dropReRenderedTail(delta, emitted, eot, t)).toBe(
      `${emitted}${user}`,
    );
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

  test("tokens_cached < tokens_evaluated is decode_failed", () => {
    expect(
      refuseReasonFromResult({
        tokens_cached: 1648,
        tokens_evaluated: 1700,
      }),
    ).toBe("decode_failed");
    expect(
      refuseReasonFromResult({
        tokens_cached: 1700,
        tokens_evaluated: 1700,
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

  test("delta when prefix holds even if T is not pPrev", () => {
    expect(decideAdvance({ ...base, t: "A", pNew: "ABC" })).toEqual({
      kind: "delta",
      delta: "BC",
    });
    expect(
      decideAdvance({ ...base, t: "AS-GENERATED", pPrev: "A", pNew: "ABC" }),
    ).toEqual({ kind: "delta", delta: "BC" });
  });

  test("pprev_sentinel pending forces rebuild", () => {
    expect(
      decideAdvance({ ...base, pendingReason: "pprev_sentinel" }),
    ).toEqual({ kind: "rebuild", reason: "pprev_sentinel" });
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
