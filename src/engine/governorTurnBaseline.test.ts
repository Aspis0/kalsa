/**
 * The wiring that keeps a turn's cost honest: the places that abandon a turn
 * must mark the gap the report's COST line reads, or the next turn's delta
 * silently spans two turns.
 */
import {
  markObservationGap,
  resetObservationBaseline,
} from "./governorObservationRead";
import {
  governorTurnPayloads,
  resetGovernorTurnCost,
} from "./governorTurnLog";

jest.mock("llama.rn", () => ({ NativeModules: {} }));

const COUNTERS = {
  decode_hop_commit_bytes: 4096,
  decode_tokens_cpu: 100,
  decode_tokens_gpu: 200,
  decode_tokens_npu: 300,
  decode_hops: 5,
};

const cost = (overrides: object = {}) =>
  governorTurnPayloads({
    stats: { ...COUNTERS, ...overrides },
    forced: false,
    fallbackCode: "none",
    routeChunks: null,
  }).cost;

beforeEach(() => {
  resetObservationBaseline();
});

describe("a skipped turn never folds into the next delta", () => {
  it("markObservationGap reaches the report line, not only the observation row", () => {
    cost();
    markObservationGap();
    // The observation module's own row already did this; the question here is
    // whether the report's baseline learned about it too.
    expect(cost({ decode_hops: 6, decode_hop_commit_bytes: 5120 })).toMatchObject({
      dhb: null,
      tok: null,
      hops: null,
      first: 0,
      gap: 1,
    });
    // And the line after that one is a clean delta again.
    expect(cost({ decode_hops: 9, decode_hop_commit_bytes: 6144 })).toMatchObject({
      dhb: 1024,
      hops: 3,
      first: 0,
      gap: 0,
    });
  });

  it("resetObservationBaseline clears the report's baseline with its own", () => {
    cost();
    expect(cost({ decode_hops: 6, decode_hop_commit_bytes: 5120 })).toMatchObject({
      dhb: 1024,
      hops: 1,
    });
    resetObservationBaseline();
    // A load restarted the counters: the next line is a fresh first read, not
    // a subtraction from a context that no longer exists.
    expect(cost({ decode_hops: 1, decode_hop_commit_bytes: 64 })).toMatchObject({
      dhb: 64,
      hops: 1,
      first: 1,
      gap: 0,
    });
  });

  it("a reload clears a pending gap along with the baseline", () => {
    markObservationGap();
    resetObservationBaseline();
    // The new context is the first line again; the old one's hole is not
    // carried into a counter series that restarted.
    expect(cost({ decode_hops: 2 })).toMatchObject({ hops: 2, first: 1, gap: 0 });
  });

  it("reports nothing at all when the binding answered no counters", () => {
    const silent = governorTurnPayloads({
      stats: { commit_bytes: 4096 },
      forced: false,
      fallbackCode: "none",
      routeChunks: null,
    }).cost;
    // A silent binding is an absent cost, never a cost of zero — and it must
    // not poison the baseline the next real line deltas against.
    expect(silent).toMatchObject({ cb: 4096, dhb: null, tok: null, hops: null });
    expect(silent).not.toHaveProperty("first");
    expect(cost()).toMatchObject({ dhb: 4096, first: 1, gap: 0 });
  });

  it("a line that read no counters does not clear a pending gap", () => {
    markObservationGap();
    const silent = governorTurnPayloads({
      stats: { commit_bytes: 4096 },
      forced: false,
      fallbackCode: "none",
      routeChunks: null,
    }).cost;
    expect(silent).not.toHaveProperty("gap");
    // The silent line reported nothing about the counters, so it may not also
    // clear the record that a turn went unread: the next real line still owes
    // the reader a gap.
    expect(cost({ decode_hops: 9, decode_hop_commit_bytes: 8192 })).toMatchObject({
      dhb: null,
      tok: null,
      hops: null,
      gap: 1,
      first: 0,
    });
  });
});

describe("the module owns the baseline it resets", () => {
  it("resetGovernorTurnCost alone is enough for a plain restart", () => {
    cost();
    resetGovernorTurnCost();
    expect(cost({ decode_hops: 7 })).toMatchObject({ hops: 7, first: 1, gap: 0 });
  });
});