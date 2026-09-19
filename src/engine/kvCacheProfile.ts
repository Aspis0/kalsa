/**
 * The K/V quantization pair a cache can be written with.
 *
 * Leaf on purpose, with zero imports: the pure-arithmetic engine modules
 * (kvQuantCost, loadGate, kvCachePref) need this type only, and reaching it
 * through ModelRegistry pulls the whole catalog graph into the standalone
 * `--ignoreConfig` compile the session harnesses run. ModelRegistry re-exports
 * the type, so app-side importers are unaffected.
 */
export type KvCacheProfile = {
  k: "f16" | "f32" | "q8_0" | "q4_0" | "q4_1" | "iq4_nl" | "q5_0" | "q5_1";
  v: "f16" | "f32" | "q8_0" | "q4_0" | "q4_1" | "iq4_nl" | "q5_0" | "q5_1";
};
