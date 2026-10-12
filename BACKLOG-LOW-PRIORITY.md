
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
- E3 (P2, audit of engine 74b75037f, 2026-10-10) Graduated pacing: a COOLMODE latched by its dwell after the platform
  status falls to 1 paces only by the forecast and battery ramps, so a cool forecast + cool battery decodes at duty 1.0
  inside COOLMODE. Intended (slow only as much as needed, owner 2026-10-10 "Fai 1"); revisit only if the S23 G2 repeat
  shows a re-escalation sawtooth.
- E4 (P2) `decode_pacing_duty_last` is computed from the requested delay before the sleep; an oversleeping scheduler
  makes the real duty lower than reported. Fix if the stat drives a decision: measure the sleep.
- E5 (P2/P3) governor-bench: the start<full order check runs only when both flags are given (`--pacing-headroom-start
  1.1` alone is reset by the policy while the bench echoes the request is no longer true since run_start prints the
  applied values, but the run silently uses defaults); `--battery-temp` has no upper bound before the int32 tenths cast.
- E6 (P3) `sanitize_coolmode_duty` WARN says "pacing is off" but a SEVERE status still caps at min_duty; two
  test-governor-pacing comments/cases: :352 comment names SEVERE on a status-2 case, :249 status-2 integration case
  would pass with a broken NaN fallback (the pure duty test covers it).
- B8 (P2, audit of binding 2b85937b, 2026-10-10) A native-only resend (headroom every 2 s, or a status change, the
  latter pre-existing) re-runs the engine's battery state machine on the battery value of the last APP profile, which
  JSI refuses during a completion; after the COOLMODE dwell a long turn can leave COOLMODE on a stale cool battery while
  the battery is hot. Pacing still follows the fresh forecast and the status cap. Fix: read battery temperature
  natively too, or skip state transitions on native-only resends.
- B9 (P2, pre-existing) `rn_governor::failure_reason()` returns a reference to a string decode may assign while the JSI
  stats worker reads it. Fix: copy under engine_mutex_.
- B10 (P3) `KALSA_GOVERNOR_HEADROOM {available:1}` means only that the symbol resolved; a device that answers NaN
  forever looks available. Host tests cover the pure helpers, not the dlsym or refresh-to-engine path; params tests miss
  numeric NaN/Infinity.
- H6 (P2, S23 G2 run 2026-10-10, `s23-g2-graduated-867affaa`) Turn 10: the model called `write_note`
  (`KALSA_TOOLCALL` round 0 `executed:1`) and the app closed the turn without a round-1 continuation. `turn.sh` reads
  `executed:1` as "continuation pending", waits 600 s, then force-stops a healthy app (`RECOVERY reason=toolround`).
  Either the app must always run the continuation round after an executed tool, or the harness must accept a turn
  whose KALSA_GOVERNOR/answer landed after the last executed round. Cost: 10 idle minutes and a restart per hit.
- H7 RESOLVED 2026-10-11 by app `bc99cfeb` (per-model declared-SEVERE table keyed on Build.MODEL; `KALSA_GOVERNOR_PLAN` logs pacing_start/pacing_full). Was: (P2, audit of app 233486dd, 2026-10-10) The S23 pacing line 0.99 is keyed on the SoC (SM8550/KALAMA), so every
  Snapdragon 8 Gen 2 phone gets it although the headroom lines are per-HAL (cell 78 calibrated one S23). The text
  fallback never matches the S23's model code (SM-S911U); the real S23 reports ro.soc.model=SM8550, so it is reached.
  The governor plan log / G2 gate do not record the pacing params; the run proves them only through
  decode_pacing_duty_last vs decode_pacing_headroom_last in KALSA_GOVERNOR.
- H8 (P2, audit of app d7ffa0e8, 2026-10-11) A turn that ends on an error bubble ("⚠️ ...") emits no KALSA_GOVERNOR, so
  turn.sh still waits the 600 s tool-round bound and force-stops; the interrupted-bubble detector only knows "Risposta
  interrotta" / "removed from memory". The tool-args cause is fixed (af7e6fc3/fa816975); other errors still hit it.
- A1 (P2, audit of fa816975) A malformed third-or-later tool call in one round gets the generic cap-skip result, not the
  retry message (still echoed "{}", so the turn no longer breaks). The tool loop itself has no jest harness.
- E7 (P2, audit of engine 016f58633, 2026-10-11) A hot-plugged profile still takes the plain GPU prefill branch
  (V73/V75/V79 and now V81 with no live NPU lane); only GPU_COOLMODE checks `hot_plugged_`, while
  `llama-governor-runtime.cpp:325` logs "hot-plugged profile is CPU-only with no cool mode". Either guard the GPU
  branch or reword the log.
- A2 (P2, audit of app c5898702, 2026-10-11) `LlamaService.ts:2521` refuses every governor load with `gpu_fit === "NoFit"`,
  although `buildGovernorParams` can enable the governor on the NPU lane's own fit (`governorInputs.ts:360-370`, whose
  comment promises a lane-only load). A device whose GPU does not fit but whose NPU lane does falls to CPU.
- A3 (P3, same audit) `KALSA_GOVERNOR_FALLBACK` reason `gpu-prefill-incorrect-V81` is now unreachable (V81 enabled), but
  `schemaDrift.test.ts:48-51` requires one reason per generation; derive the allowed reasons from the false entries.
- A4 RESOLVED 2026-10-11: the lane-off V81 path ran on the SM8850 (`qdc-v81-fallback-df359450`, two turns: prefill
  GPU 295 tok/s, decode CPU, no fallback, no crash). Still unrun: the no-HTP-arch entry to the same path.
- H9 (P1 for harness runs with the governor OFF, 2026-10-11) The readiness gate `device_ready_log_seen`
  (`scripts/device-share-send.sh:49-62`) waits for `KALSA_PREWARM op=done`, but a prewarm that restores its saved
  snapshot ends with `{"op":"restore","ok":true,...}` and never logs `done` (`LlamaService.ts` ~1349-1355). Any launch
  after the first one that saved a snapshot then dies at the 240 s ready timeout ("model load died"). Seen on the S23
  Meter OFF arm (app bc99cfeb); the governor-ON G2 runs never hit it. RESOLVED 2026-10-12, app `8a8d74cf` (pushed):
  the gate accepts restore ok:true and keeps only the launched PID's lines; self-tests 121/121, two hostile audits
  (deepseek). Still open (low): a failed restore followed by a skip/pause still reads as "never became ready"; the
  PID filter falls back to unfiltered when CAMPAIGN_LAUNCHED_PID is unset.
