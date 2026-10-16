/**
 * KALSA_SESSION through the report's projection: the save/load verdict reaches
 * an uploaded report, and nothing else about a session does. Payloads mirror
 * the emitters (chatKvSessionSave.ts, chatKvSessionLoad.ts,
 * chatKvSessionNative.ts, chatKvSessionShared.ts, sessionEvictMarker.ts).
 */
import { finalizeLine } from "../normalize";
import { formatRecord } from "../schema";

function report(payload: Record<string, unknown>): Record<string, unknown> | null {
  const record = formatRecord("KALSA_SESSION", payload);
  if (record === null) return null;
  const line = finalizeLine(record);
  if (line === null) return null;
  const body = line.slice(line.indexOf(" ") + 1);
  return JSON.parse(body.slice(body.indexOf(" ") + 1));
}

describe("KALSA_SESSION carries the save/load verdict and nothing else", () => {
  const projected = (payload: Record<string, unknown>) =>
    report(payload);

  it("keeps the governor refusal, the one the report had no way to see", () => {
    expect(projected({ op: "save", ok: false, reason: "governor_mode" })).toEqual({
      op: "save",
      ok: false,
      reason: "governor_mode",
    });
    expect(projected({ op: "load", ok: false, reason: "kv_inconsistent", ms: 12 })).toEqual({
      op: "load",
      ok: false,
      reason: "kv_inconsistent",
      ms: 12,
    });
    expect(projected({ op: "save", ok: true, ms: 41, estimatedBytes: 1048576, usedTokens: 4096 })).toEqual({
      op: "save",
      ok: true,
      ms: 41,
    });
  });

  it("keeps the mark_prefix refusal that rides on op mark_prefix", () => {
    // chatKvSessionSave.ts:139 — the prefix mark skipped, not the save.
    expect(report({ op: "mark_prefix", ok: false, reason: "kv_prefix_unavailable" })).toEqual({
      op: "mark_prefix",
      ok: false,
      reason: "kv_prefix_unavailable",
    });
  });

  it("keeps the evict outcomes", () => {
    expect(projected({ op: "evict", ok: false, reason: "over_budget_unevictable" })).toEqual({
      op: "evict",
      ok: false,
      reason: "over_budget_unevictable",
    });
  });

  it("drops the open-ended reasons and every session artifact", () => {
    // The composites build their suffix from a meta field name or a JS error
    // name, so they are not a closed set and fail closed.
    expect(projected({ op: "load", ok: false, reason: "meta_mismatch:promptEnvHash" })).toEqual({
      op: "load",
      ok: false,
    });
    expect(projected({ op: "save", ok: false, reason: "error:TypeError" })).toEqual({
      op: "save",
      ok: false,
    });
    // A stem is a conversation id (sessionKey.ts) — it must never ride.
    expect(projected({ op: "save", ok: false, stemHash: "a1b2c3d4" })).toEqual({
      op: "save",
      ok: false,
    });
  });
});