
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
- B7 (P2, 2026-10-09, cost one 40-min CI round) The binding globs vendor source dirs, so a lab-only engine TU landing in
  a globbed dir breaks only the Android CI: `ggml-opencl-tile32-verify.cpp` (engine-built only under
  GGML_OPENCL_TILE32_LAB) entered with vendor 1babccb9 and failed app run 37949782564; fixed per-file in binding
  `76768fb2`. `scripts/assert-rnllama-sources.sh` skips globs, so nothing local catches the class. Fix: diff each
  globbed dir against the engine's own source lists (allow-list binding-local `common/parsers/function-gemma.cpp`);
  optionally mirror the engine's per-variant ARM defines (GGML_USE_DOTPROD / MATMUL_INT8).
- E1 (P2, pre-existing, audit of engine b89014244, 2026-10-09) On the TWO-MODEL governor, a COOLMODE reached by battery
  heat (temp >= cool_enter clears state_from_platform_) selects GPU_COOLMODE with requires_reload, and the binding ends
  the completion with pause_reason "reload" instead of pacing (`llama-governor-policy.cpp:252-264, :524-533`). The
  one-copy hop path returns before that rule. Fix when the two-model path gets pacing: gate GPU_COOLMODE eligibility
  on pacing being off, or never request it mid-turn.
- E2 (P3, pre-existing) `llama_governor::stats()` is an unsynchronized struct copy read from the JS thread while the
  decode thread writes (now also decode_paced_*); torn reads possible. Fix: snapshot under a mutex.
- H1 (P2, app harness, audits of 2026-10-09 on kalsa `2a1d1055`) Supervisor path (Jelly campaigns): after an adb-drop,
  `campaign_restore_same_conv` in `scripts/campaign/conversation.sh` force-stops a live app (the T20C runner overrides
  it with a no-force-stop-while-alive version; the supervisor does not). Fix: the same alive guard in the shared one.
- H2 (P2) Every reconnect re-dumps the logcat ring into the campaign log; `campaign_telemetry_total` and the progress
  fingerprint count duplicate lines as progress. Fix: dedupe by timestamp+pid, or count from a slice offset.
- H3 (P2) `campaign_mdns_for_serial` takes the first whitespace field; adb 37 prints instance, service, addr:port
  (three fields) while the selftest fixture pins two. Verify on a real `adb mdns services` and align the fixture.
- H4 (P3) Every `die` runs the EXIT trap, which force-stops the app unconditionally (`ci-lib.sh` keep-awake restore):
  "aborting without force-stop" holds for the recovery action, not the teardown. State it or make it conditional.
- H5 (P3) Five consecutive unknown pid rounds (~30 s of a half-open wireless link) abort the run (safe, no recovery
  force-stop). A reconnect would heal it, but `adb disconnect` is forbidden in a multi-device lab; needs a per-serial
  reconnect that cannot touch other devices.
