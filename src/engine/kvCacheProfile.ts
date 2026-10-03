/**
 * The K/V quantization pair a cache can be written with, and the rule that
 * picks the pair a load actually runs.
 *
 * Leaf on purpose, with zero imports: the pure-arithmetic engine modules
 * (kvQuantCost, loadGate, kvCachePref) need this type and this rule, and
 * reaching them through ModelRegistry pulls the whole catalog graph into the
 * standalone `--ignoreConfig` compile the session harnesses run. ModelRegistry
 * re-exports the type, so app-side importers are unaffected.
 */
export type KvCacheProfile = {
  k: "f16" | "f32" | "q8_0" | "q4_0" | "q4_1" | "iq4_nl" | "q5_0" | "q5_1";
  v: "f16" | "f32" | "q8_0" | "q4_0" | "q4_1" | "iq4_nl" | "q5_0" | "q5_1";
};

// The standalone `--ignoreConfig` harness compile has no node types; this
// module-scoped declaration names the bundler's require for it (Metro and
// jest still resolve the call below as a normal require).
declare const require: (id: string) => unknown;

/** The pair iOS runs: mixed K/V types leave Metal's fast path (see below). */
const IOS_KV_CACHE: KvCacheProfile = { k: "q8_0", v: "q8_0" };

/** The pair the catalog's `kvCache` fields carry. */
const SHIPPED_KV_CACHE: KvCacheProfile = { k: "q8_0", v: "q4_0" };

/**
 * Whether this build runs on iOS. The require is lazy and its failure reads as
 * off-iOS: node harnesses and tests load this module with no react-native, and
 * there the shipped pair has to keep standing. Exported because Settings picks
 * its cache copy with the same rule.
 */
export function isIosPlatform(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as { Platform: { OS: string } };
    return Platform.OS === "ios";
  } catch {
    return false;
  }
}

/**
 * The K/V pair a load runs with: `choice` is the user's stored pair (null when
 * they never picked one), `catalog` the model's shipped pair.
 *
 * Off iOS: choice ?? catalog ?? the shipped pair — the resolution unchanged.
 * On iOS: q8_0/q8_0 whatever came in, because mixed K/V types leave Metal's
 * fast path. Measured on an M1 Max Mac under Metal, not on an iPhone:
 * llama-bench on LFM2.5-2.6B Q4_0, -t 4, flash attention on — q8_0/q8_0
 * decodes at 97.5 tok/s against q8_0/q4_0's 31.3 at depth 2048, and 94.9
 * against 12.6 at depth 15744 (the app's own 16384 reservation; the iPhone is
 * unmeasured — lab ios-engine-choice/REPORT.md). So the mixed pair is a decode
 * cost there, not a saving. The Standard row resolves through here too, which
 * is what keeps it off both iOS paths (unset and an explicit Standard).
 */
export function resolveKvCacheProfile(
  choice: KvCacheProfile | null | undefined,
  catalog?: KvCacheProfile | null,
): KvCacheProfile {
  if (isIosPlatform()) return IOS_KV_CACHE;
  return choice ?? catalog ?? SHIPPED_KV_CACHE;
}
