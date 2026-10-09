
## Binding bump to engine 23b2a44d7 (kalsa.rn 1632a4a2) - audit leftovers (deepseek e75f5d18, 2026-10-09)

- B1 (P2) [FIXED: engine 2e723bd9d + binding 1babccb9, both pushed 2026-10-09] One-copy Hexagon caps leak: `restore_hexagon_shared_weights` passes `{false, 0}` because the engine
  setter writes ONE cap to both `opt_mbuf_dyn` (512 MiB) and `opt_mbuf_static` (1 GiB); after a one-copy load every
  later two-copy load in the process runs with both at 832 MiB (+320 MiB dyn ceiling, more static splits; a user's
  `GGML_HEXAGON_MBUF=dyn,static,total` overridden). Fix engine-side: snapshot both caps at init/first enable and
  restore them on `{false, 0}`; then re-vendor.
- B2 (P2) `scripts/assert-kalsa-vendor.sh` never compares the vendored tree / `src/version.ts` stamp to
  `vendor/VERSIONS` (a stale 7-char stamp passes); the audit proved equality by reconstruction in /tmp only.
- B3 (P3) `scripts/kalsa-patches/` is a stale duplicate with flattened paths and no consumer.
- B4 (P3) `vendor/README.md:81` names a non-existent `scripts/build-hexagon-htp.sh` and says the QAIC files are
  gitignored (they are tracked); `vendor/README.md:41-42` + `scripts/update-llama-cpp.sh` cite a deleted
  `sync-llama-cpp.yml` that would re-vendor plain upstream over the fork pin.
- B5 (P3) `common_chat_input(std::string)` allocates a token vector per streamed parse (twice), unused by the parser.
- B6 (note for the app pin) `LLAMA_STATE_SEQ_VERSION` 3 -> 4: state files saved by the old engine are refused and
  `rn-slot-manager.cpp:613` reports a load failure, not a cold start.

## App pin e8707470 (binding 1babccb9 / engine 2e723bd9d) - audit leftovers (deepseek 6220ecfa, 2026-10-09)

- A1 (P2, pre-existing) Governor mode: `restoreEngineSession` (src/engine/LlamaService.ts ~4085) has no governor
  guard; the JSI refuses session loads under the governor ("Session load is not supported while governor mode is
  enabled"), the generic catch classifies it as an unexpected failure and `deleteSessionArtifacts` removes a .kvs
  whose meta matched (governor ON by default; chat switch calls restore).
- A2 (P3, latent) `staticPrefixSnapshot.ts:178-180` native-throw path does not delete the file its doc says it
  deletes (unreachable with a content-hash engineBuild; the caller goes cold).
- A3 (P3, pre-existing) The app's `assert-htp-skels-installed.sh` trusts the manifest's ENGINE_COMMIT / fingerprint;
  the recomputing gate lives only in the binding repo.
- A4 (P2, audit of A1 fix `45d3989d`, 2026-10-09) `staticPrefixSnapshot.ts:165/225` (prewarm snapshot load/save) still
  maps the governor refusal to `load_error` / `save_error` in `KALSA_PREWARM`; no data loss (load deletes nothing, save
  only its tmp). Fix: share the `governor_mode` reason/guard with `sessionPersistence.ts`.
- A5 (P3, same audit) the `KALSA_SESSION` governor skip line has no `source` field, so a save skip and a
  memory-extract restore skip are indistinguishable to `scripts/restoreVerdict.mjs`; the source-pin privacy guard
  checks only `stem`.
- A6 (P2, pre-existing, Luna audit of `ffc84ee9`, 2026-10-09) On a chat switch the load-failure path calls
  `dropHoldAfterOptionalNativeClear`; if the native `clearCache()` fails it still drops the hold
  (`LlamaService.ts:3419/3435`), and B's identity-scoped save hint (`sessionPersistence.ts:173-174`) cannot reveal
  A's surviving KV, so B's first send may assemble over A's tokens. Same path since the governor went default ON
  (2026-10-02); not introduced by the A1 fix. Fix: keep an identity-independent "native KV may remain" state that
  forces reconciliation, or block the send until a clear succeeds.
