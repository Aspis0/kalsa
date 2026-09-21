/**
 * Unit tests for the per-model weight-load policy (loadPolicy.ts) and for the
 * catalogue entries that deviate from its default.
 *
 * Pure modules — no AsyncStorage, no llama.rn, loadable under plain node jest.
 */

import {
  DEFAULT_LOAD_POLICY,
  resolveGateLoadPolicy,
  resolveLoadPolicy,
} from "./loadPolicy";
import { MODEL_REGISTRY } from "./ModelRegistry";

describe("resolveLoadPolicy — default", () => {
  it("DEFAULT_LOAD_POLICY is llama.cpp normal behaviour: mmap on, repack on", () => {
    expect(DEFAULT_LOAD_POLICY).toEqual({ mmap: true, repack: true });
  });

  it("no entry and no levers → weights file-mapped, repack kept", () => {
    expect(
      resolveLoadPolicy({
        policy: undefined,
        streamExperts: false,
        benchNoRepack: undefined,
      }),
    ).toEqual({ useMmap: true, noExtraBufts: false });
  });
});

describe("resolveLoadPolicy — per-model entries", () => {
  it("mmap off, repack on policy shape", () => {
    const load = resolveLoadPolicy({
      policy: { mmap: false, repack: true },
      streamExperts: false,
      benchNoRepack: undefined,
    });
    expect(load.useMmap).toBe(false);
    expect(load.noExtraBufts).toBe(false);
  });

  it("repack off policy shape keeps mmap untouched", () => {
    const load = resolveLoadPolicy({
      policy: { mmap: true, repack: false },
      streamExperts: false,
      benchNoRepack: undefined,
    });
    expect(load.useMmap).toBe(true);
    expect(load.noExtraBufts).toBe(true);
  });
});

describe("resolveLoadPolicy — precedence: streaming > bench > policy > default", () => {
  it('kalsa.bench.norepack="1" wins over a policy that keeps repack', () => {
    const load = resolveLoadPolicy({
      policy: { mmap: true, repack: true },
      streamExperts: false,
      benchNoRepack: true,
    });
    expect(load.noExtraBufts).toBe(true);
  });

  it('kalsa.bench.norepack="0" forces repack ON over a policy that disables it', () => {
    // The A/B arm that validates the curated entries: without it no bench
    // could ever measure repack-on on a model whose catalog policy disables it.
    const load = resolveLoadPolicy({
      policy: { mmap: true, repack: false },
      streamExperts: false,
      benchNoRepack: false,
    });
    expect(load.noExtraBufts).toBe(false);
  });

  it("streaming forces BOTH flags — mirrors native bmoe_stream.cpp arm()", () => {
    // Native rebinds tensors to the file layout and forces no_extra_bufts=true
    // AND use_mmap=true regardless of JS; even a bench useMmap=false cannot
    // reach the engine under an armed streamer.
    const load = resolveLoadPolicy({
      policy: { mmap: false, repack: true },
      streamExperts: true,
      benchNoRepack: false,
      benchUseMmap: false,
    });
    expect(load.noExtraBufts).toBe(true);
    expect(load.useMmap).toBe(true);
  });

  it("bench:engine useMmap wins over a policy turning mmap off", () => {
    const load = resolveLoadPolicy({
      policy: { mmap: false, repack: true },
      streamExperts: false,
      benchNoRepack: undefined,
      benchUseMmap: true,
    });
    expect(load.useMmap).toBe(true);
  });

  it("bench:engine useMmap=false wins over the default mmap=true", () => {
    const load = resolveLoadPolicy({
      policy: undefined,
      streamExperts: false,
      benchNoRepack: undefined,
      benchUseMmap: false,
    });
    expect(load.useMmap).toBe(false);
  });
});

describe("resolveGateLoadPolicy — gate-side pricing input", () => {
  it("absent policy and lever → the historic constants (mmap on, repack on)", () => {
    expect(resolveGateLoadPolicy({})).toEqual({ mmap: true, repack: true });
  });

  it("policy repack:false survives; lever \"0\" forces it back on", () => {
    expect(
      resolveGateLoadPolicy({ policy: { mmap: true, repack: false } }),
    ).toEqual({ mmap: true, repack: false });
    expect(
      resolveGateLoadPolicy({
        policy: { mmap: true, repack: false },
        benchNoRepack: false,
      }),
    ).toEqual({ mmap: true, repack: true });
  });

  it("kexp policy: mmap off reaches the estimator so weights count anonymous", () => {
    expect(
      resolveGateLoadPolicy({ policy: { mmap: false, repack: true } }),
    ).toEqual({ mmap: false, repack: true });
  });

  it("bench:engine useMmap reaches the gate resolution too", () => {
    // The gate must price the mode init will use, and init honours this lever.
    expect(resolveGateLoadPolicy({ benchUseMmap: false })).toEqual({
      mmap: false,
      repack: true,
    });
    expect(
      resolveGateLoadPolicy({ benchNoRepack: false, benchUseMmap: true }),
    ).toEqual({ mmap: true, repack: true });
  });
});

describe("MODEL_REGISTRY — loadPolicy entries", () => {
  const qwen = MODEL_REGISTRY.find((entry) => entry.id === "qwen3.5-4b");
  const lfm = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b");

  it("qwen3.5-4b is the one curated entry: mmap kept, repack off", () => {
    expect(qwen?.loadPolicy).toEqual({ mmap: true, repack: false });
  });

  it("lfm2.5-2.6b keeps the default policy: repack stays on", () => {
    expect(lfm?.loadPolicy).toBeUndefined();
    expect(resolveGateLoadPolicy({ policy: lfm?.loadPolicy })).toEqual({
      mmap: true,
      repack: true,
    });
  });

  it("every listed entry other than qwen3.5-4b uses the default policy", () => {
    for (const model of MODEL_REGISTRY.filter(
      (entry) => entry.listed !== false && entry.id !== "qwen3.5-4b",
    )) {
      expect(model.loadPolicy).toBeUndefined();
    }
  });

  it("resolveLoadPolicy: qwen3.5-4b noExtraBufts, lfm2.5-2.6b repack on", () => {
    expect(
      resolveLoadPolicy({ policy: qwen?.loadPolicy, streamExperts: false }),
    ).toEqual({ useMmap: true, noExtraBufts: true });
    expect(
      resolveLoadPolicy({ policy: lfm?.loadPolicy, streamExperts: false }),
    ).toEqual({ useMmap: true, noExtraBufts: false });
  });

  it("resolveGateLoadPolicy: qwen repack false, LFM repack true", () => {
    expect(resolveGateLoadPolicy({ policy: qwen?.loadPolicy })).toEqual({
      mmap: true,
      repack: false,
    });
    expect(resolveGateLoadPolicy({ policy: lfm?.loadPolicy })).toEqual({
      mmap: true,
      repack: true,
    });
  });

  it("kalsa.bench.norepack overrides a registry entry both ways", () => {
    // "1" removes repack even where the entry (LFM) keeps the default on.
    expect(
      resolveGateLoadPolicy({ policy: lfm?.loadPolicy, benchNoRepack: true }),
    ).toEqual({ mmap: true, repack: false });
    // "0" forces repack ON even on the curated repack-off entry (qwen).
    expect(
      resolveGateLoadPolicy({ policy: qwen?.loadPolicy, benchNoRepack: false }),
    ).toEqual({ mmap: true, repack: true });
  });
});
