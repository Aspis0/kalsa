/**
 * Where the memory sample behind "tap to retry" lives, and the host's answer
 * to it — source pins, because both halves are outside this slice's reach or
 * inside a module the stack cannot import: the cache is `src/engine/**`
 * (read-only here), and the gate helpers pull llama.rn (not importable in
 * node). The pins name the exact engine call a full fix would need, so the
 * workaround and its expiry are visible in one file.
 */
import { readFileSync } from "fs";
import { join } from "path";

const read = (...segments: string[]) => readFileSync(join(__dirname, ...segments), "utf8");

const ENSURE = read("engineEnsure.ts");
const HELPERS = read("engineGateHelpers.ts");
const LOAD = read("engineLoad.ts");
const DEVICE_PROFILE = read("..", "engine", "deviceProfile.ts");
const MONITOR = read("..", "engine", "monitor.ts");

describe("the retry re-runs the verdict against a fresh MemAvailable", () => {
  test("the load gate's profile passes through the uncached reader", () => {
    expect(ENSURE).toContain("getCachedDeviceProfile().then(profileWithFreshMemory)");
    expect(HELPERS).toContain("await getAvailableMemoryBytesUncached()");
  });

  test("the second gate already sampled uncached — the host gate now matches it", () => {
    // evaluateLoadGate's injected fit probe; the refusal the capture showed
    // comes from the FIRST gate, which was the stale one.
    expect(LOAD).toContain("getAvailableMemoryBytesUncached()");
  });
});

describe("the stale sample's home, named — the engine change this slice did not make", () => {
  test("the process-lifetime profile cache and its test-only reset", () => {
    expect(DEVICE_PROFILE).toContain(
      "let cachedProfilePromise: Promise<DeviceProfile> | undefined;",
    );
    expect(DEVICE_PROFILE).toContain("__resetDeviceProfileCacheForTests");
    // No production invalidation exists beside it: a full fix needs the
    // engine to export one (or to re-sample in the builder) — reported,
    // not patched.
    expect(DEVICE_PROFILE).not.toContain("export function invalidateDeviceProfileCache");
  });

  test("the reader the fresh path uses is the one monitor.ts anoints for live decisions", () => {
    expect(MONITOR).toContain("must NOT be used for live decisions");
    expect(MONITOR).toContain("export async function getAvailableMemoryBytesUncached");
  });
});
