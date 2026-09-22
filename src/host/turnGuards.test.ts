import { createTurnFence, type TurnToken } from "./turnGuards";

describe("turnGuards — run fencing", () => {
  it("refuses a stale run id (prevents: a replaced send run painting into its successor's turn)", () => {
    const fence = createTurnFence();
    const first = fence.beginRun();
    const second = fence.beginRun();

    const state = ["assistant-v1"];
    const applied = fence.apply(first, state, (prev) => [...prev, "stale-patch"]);

    expect(applied).toBe(state);
    expect(applied).toEqual(["assistant-v1"]);
    expect(fence.owns(first)).toBe(false);
    expect(fence.owns(second)).toBe(true);
  });

  it("refuses a stale generation (prevents: a cleared chat's late callback resurrecting wiped messages)", () => {
    const fence = createTurnFence();
    const token = fence.beginRun();
    const cleared: string[] = [];

    fence.invalidate();
    const applied = fence.apply(token, cleared, (prev) => [...prev, "resurrected"]);

    expect(applied).toBe(cleared);
    expect(applied).toEqual([]);
    expect(fence.owns(token)).toBe(false);
  });

  it("a refused update changes nothing — the update never runs (prevents: partial mutations from a half-refused patch)", () => {
    const fence = createTurnFence();
    const token = fence.beginRun();
    fence.invalidate();

    const state = { text: "old" };
    let updateRan = 0;
    const applied = fence.apply(token, state, (prev) => {
      updateRan += 1;
      return { ...prev, text: "new" };
    });

    expect(updateRan).toBe(0);
    expect(applied).toBe(state);
    expect(applied).toEqual({ text: "old" });
  });

  it("re-checks ownership when a deferred updater finally runs (prevents: a Fabric-queued update committing after clearChat)", () => {
    const fence = createTurnFence();
    const token = fence.beginRun();
    const queued = (prev: string[]) => fence.apply(token, prev, (p) => [...p, "late"]);

    // Scheduled while the token was live…
    expect(fence.owns(token)).toBe(true);
    // …committed after a clear applied it.
    fence.invalidate();
    const afterClear = ["cleared"];
    expect(queued(afterClear)).toBe(afterClear);
  });

  it("a fresh token applies and a new run survives a prior invalidation (prevents: reset counters short-circuiting the fence)", () => {
    const fence = createTurnFence();
    const stale: TurnToken = fence.beginRun();
    fence.invalidate();
    const fresh = fence.beginRun();

    expect(fence.owns(stale)).toBe(false);
    expect(fence.owns(fresh)).toBe(true);
    expect(fence.apply(fresh, ["a"], (p) => [...p, "b"])).toEqual(["a", "b"]);
  });
});
