/**
 * The load path's KV wiring, pinned in source: performEngineLoad resolves the
 * stored choice through resolveKvCacheProfile before initEngine sees it, and
 * passes that profile's cache types into EngineInitOptions unchanged.
 *
 * A source pin, not a runtime assertion, for two reasons. The module pulls
 * llama.rn through LlamaService, so a node test cannot import it. And the
 * revert this guards (`kvCache ?? model.kvCache`) is behavior-preserving:
 * resolveContextProfile re-applies resolveKvCacheProfile itself, so both forms
 * hand iOS q8_0/q8_0 and Android the catalog pair. The behavioral half of the
 * rule lives in contextProfile.test.ts and deviceTuning.test.ts; this file
 * keeps the load path routed through it.
 */
import { readFileSync } from "fs";
import { join } from "path";

const SOURCE = readFileSync(join(__dirname, "engineEnsureLoad.ts"), "utf8");

describe("the load path resolves the KV pair through the platform rule", () => {
  test("the profile's kvCache is resolved, never a raw pass-through", () => {
    expect(SOURCE).toContain(
      "kvCache: resolveKvCacheProfile(kvCache, model.kvCache)",
    );
    expect(SOURCE).not.toContain("kvCache: kvCache ?? model.kvCache");
  });

  test("initEngine receives that profile's cache types", () => {
    expect(SOURCE).toContain("cacheTypeK: profile.cacheTypeK");
    expect(SOURCE).toContain("cacheTypeV: profile.cacheTypeV");
  });
});
