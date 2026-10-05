# Low-priority backlog (owner rule 2026-10-02)

Owner: fix P0/P1 and the P2 that touch app, users or performance; everything else is logged here and work moves on.
One line per item: area - finding - source audit. Pick from here only when a related change is already open.

## pdf.js 5.7 upgrade (branch expo57-bump, NOT landed: device check FAILED, see pdfjs57-s23-check/REPORT.md)
- Page-side cap on `req.filename` + silent stop at 8 missing cmaps - ios-readiness/AUDIT-pdfjs-fixround2.md
- Two English engine-failure strings not localized (reach pdf.errorPrefix) - AUDIT-pdfjs-fixround2.md
- PdfToImages.tsx 766 lines, render/chunk pipeline duplicated - AUDIT-pdfjs-fixround2.md
- `.bcmap`-shape allowlist for cmapsMissing; extractionScopeLine truncation test; render test, wasm-kind and
  200-page fixtures - AUDIT-pdfjs-fixround3.md
- `src/util/pdfText.ts:73-75` comment still says missing-cmap pages extract empty - fix round 4 report
- 60 s bootstrap watchdog is a guess, no device p99 - AUDIT-pdfjs-fixround.md

## iOS
- appleDeviceClass.test.ts "unmapped identifiers" tests are tautologies; Android pin uses an id expo-device never
  produces; getOsAvailableMemoryBytes has no jest coverage - AUDIT-ios-landing.md
- iOS thermal branch has no hysteresis - AUDIT-ios-landing.md
- Commit 7bceff40 (now f7f17036 on main) message mentions package.json work that is not in it - AUDIT-ios-landing.md
- isIos() costs ~178 us per call under jest (require throws) - AUDIT-ios-followups-kv.md
- docs/KV-WINDOW* lines 78-86 stale after the iOS KV default - AUDIT-ios-followups-kv.md

## Expo SDK 58 (trial tag local/sdk58-trial, re-trial at RN 0.88 stable)
- Lock carries 3 peer conflicts (@expo/ws-tunnel wants ws ^8); fingerprint "balanced" ignores node_modules edits;
  whisper.rn batchedBridge path - AUDIT-sdk58-trial.md, WHISPER-RN-RECON.md (upgrade whisper.rn 0.7.4 when touched)

## iOS desktop link / iroh (branch ios/desktop-link; reviews ios-desktop-link/REVIEW-runtime.md, REVIEW-build.md)
- BEFORE TESTFLIGHT: `ITSAppUsesNonExemptEncryption: false` while the app ships its own TLS/QUIC (iroh) - check
  Apple export-compliance rules - REVIEW-runtime.md
- Android: same startBridge-vs-destroy race leaks a runtime + UDP socket (latent, pre-existing) - REVIEW-runtime.md
- `_ = previous` release idiom; spurious `try`; `[0]` force-index; `deadlineMs(max)` on a byte count; Swift 6
  Sendable annotations - REVIEW-runtime.md
- road.test.ts reads only the Kotlin file, Swift error codes can drift - REVIEW-runtime.md
- README:16 thread-pool description false; JS key-path comment says filesDir - both reviews
- No lock against concurrent pod installs; changed Android error string makes the JS bundle not byte-identical
  (behaviour identical) - REVIEW-build.md

## Doorless iroh pairing (branch pairing/iroh-no-door; reviews ios-desktop-link/REVIEW-doorless-*.md)
- `tailnet` field outside the pairing MAC steers the stored doorUrl/Host (no bearer leak, no downgrade) - security P2-6
- isNonLoopback("https://iroh.kalsa.invalid") is true; respelling the constant as loopback would drop
  remote_brain_token_required for doorless doors - security P2-7
- engine/remote imports from pairing/pairingUrls (layering); self-pinning literal at remoteEngineDoorless.test.ts:273;
  stale doorRequired copy - security P3

## Every-Snapdragon governor (2026-10-03, session 1d714246; audits 9ec5d8e8 engine, f718f7ec binding, b044597d app)
- Binding loads the prefill model at n_gpu_layers 99 even when the lane did not resolve and the policy can only pick
  CPU (rn-llama.cpp ~:235): wasted GPU memory on a double-failure path (HTP0 seen by the app, unresolved at load).
- A resolved HTP0 pins the one prefill context; a WARM-state "GPU" route then runs on HTP while stats say GPU.
- Runtime HTP failures with rc -2 (alloc) do not set KALSA_HTP_FALLBACK for later loads (rn-governor-params.cpp:204).
- Bench route "gpu" / bench_force_gpu_prefill / npu lane "on" bypass the GPU qualification list (bench-only, by
  design); bench force + bench thermo can make an iOS load a two-context Metal governor.
- KALSA_GOVERNOR has no TAG_SCHEMAS entry: a sent log carries the planned lane, not the resolved route.
- Four HTP skel lists (engine skel_archs, CMake build_htp_skel, binding HTP_DSP_VERSIONS, example gradle) with no
  check tying the C++ list to the others.

## iOS background generation (branch ios/background-generation; review luna db7af22b, 2026-10-03)
- P3: `reloadPending` lives in module state (iosBackgroundGuard.ts); a Fast Refresh while suspended resets it and the
  next "active" misses the release. Dev-only (Metro Fast Refresh), not in release builds.
- (audit luna 773e9e0d, engine 60b837197) Admission picks chunks from {128,512,1024,2048} by n_batch, not by the
  reported NPU prefill_token_cap 512: a WARM NPU prefill can admit 1024-token chunks (same as the old GPU path);
  the admission deltas are "unmeasured defaults" for CPU/GPU, none NPU-specific.
- GPU_COOLMODE (V73 MoE, cool_prefill_eligible) is not state-gated and can win in battery WARM (pre-existing).
- (audit luna 225ef274, binding 6752f659) JSI completion params mutate ctx->params thread counts
  (JSIParams.cpp:701) but no llama_set_n_threads reaches the governor contexts; the eval-failure log then reports the
  mutated count (rn-completion.cpp:1728), not the context's. No test pins the per-context thread counts.
- P2 copy: a turn the iOS guard stopped on background shows "Stopped by you" (shell.phase.stoppedByUser, chosen from
  the persisted `interrupted` flag in messageMapper/composerState). Needs a persisted interruption cause + 5-language
  copy ("Stopped when Kalsa left the screen"). Seen live on the Simulator 2026-10-04.
- Re-audit luna 9a5fa3ee (fix round eb7935b3), rare cases not fixed: (a) prewarm gap between its isActive check
  (LlamaService ~1097) and the job enqueue (~1152) can cross background unmarked; (b) releaseLocalContext waits
  unbounded on waitForInFlightChatLoad / a hung native-op FIFO (no "withheld" then); (c) a CPU-only embed op in the
  shared native-op FIFO marks the CHAT context -> one needless chat reload after an app switch; (d) duplicate "active"
  events can queue duplicate releases, and a release after another owner's dispose can report "released".

## Phone 1:1 images to the PC (branch phone/remote-images; review luna 684b7cfd, 2026-10-04)
- P2: rendered PDF pages ride at JPEG q0.8 (PdfToImages.tsx:711 toDataURL 0.8) while photos use 0.85; in-cap JPEGs
  skip the remote encoder. Documents are refused in remote mode, so only history pages are affected.
- P2: the remote picker probe can open the native picker after the host unmounts (remoteAttachmentGate.ts:46-48 has
  no lifetime check; useAttachments checks mountedRef only afterwards).
- P2: dev-only: openaiTransport.ts:106 logs a 160-char redacted excerpt of a server error; the redactor does not mask
  data: URIs or prompt text if the server echoes them. Production logs code + length only.
- P2 (review luna 9aa0420c on phone/attach-gate): useShareIn.ts:81 a file share accepted locally can finish
  importing after a switch to the PC; its library row id+name then appear in the remote document hint (metadata
  only, remote tools are off). Recheck remote mode after the await.
- P3: remoteAttachmentGate.test.ts:20 pins source text (regex count) instead of exercising row presses.

## Phone Room v1 text (branch phone/room-v1; review luna a4cf6816, 2026-10-04)
- P3: src/room/roomQueue.ts is 355 lines and owns sessions, persistence coordination, retries and posting; split by
  responsibility next time it is touched.

## iOS perf batch 1 (branch ios/perf-1; review luna 977ec3c3, 2026-10-04)
- P3: AppErrorBoundary Reload only remounts the React tree; module-level singletons (engine, refs) survive, so a
  failure rooted there can reproduce after Reload. A full JS reload (DevSettings/expo-updates reloadAsync) would be
  the stronger recovery; decide when a real crash report shows the need.

## One copy, step 3 (engine feat/governor-onecopy `8ac5522d0`; review luna efb869af, 2026-10-05)
- P2: the scheduler weight-copy guard (`ggml-backend.cpp`, split_failed) is reachable only with a mixed scheduler
  (HTP + OpenCL, pass 3 can assign OpenCL a GET_ROWS on a TILE32 weight); the host test covers the CPU-only graph,
  which dies at the pass-4 assert first. Exercise it on the S23 once the GPU leg (step 4) builds a mixed scheduler.
- P3: `ggml_backend_sched_reserve_size` is void and ignores split_failed; its only caller sizes buffers and the
  failure is logged by split_graph. Revisit only if a caller starts trusting the size after a refused split.
- P3: with `LLAMA_USE_SYSTEM_GGML`, a system libggml older than the fork lacks `ggml_backend_buft_weight_layout`
  (now public in ggml-backend.h); we never build against a system ggml.

## One copy, step 4 (engine `a651191f4`; review luna f3ab128b, 2026-10-05)
- P1 (carried to step 6, binding): `ggml_backend_opencl_release_imports` must be called before every
  `llama_model_free` of a shared-mode model; there is no automatic hook on the Hexagon buffer free.
- P3: OpenCL `supports_op` walks every src for the TILE32 layout before the op switch; a cheap op prefilter would
  save a little on placement. Not measured.

## One copy, main merge (engine `6a937f6db`; review luna 6982f590, 2026-10-05)
- Merge resolutions: all 13 conflict hunks refuted as lossy; the raw-Q4_0 640-byte stride is the aligned stride, fine.
- REFUTED by the coordinator: "explicit mmap bypasses TILE32 packing" - a TILE32 context is allocated by
  `ggml_backend_alloc_ctx_tensors_from_buft` (llama-model.cpp ~1942), so `cur->data` is set and load_all_data takes
  `ggml_backend_tensor_set` (llama-model-loader.cpp ~1703), which packs.
- P1 known: the scheduler's 1.off loop does not ask `supports_buft` (adding it was reverted in 915d10b51 because it
  changed shipped admission behaviour). Revisit with the leg contexts (step 5), where each context's device list is
  explicit.
- P3: ROW split mode puts the split buft before the extra bufts, so a shared load with split_mode=ROW fails its
  post-load audit (loud, by name). The app never uses ROW split.
- P2 plausible: a CPU extra-buffer kernel claiming an op whose OTHER src is TILE32 would skip the native-read guard;
  no such op in LFM2.

## Step 4b audit leftovers (reviewer n2, 2026-10-05; `audit-step4b-n2.md`)
- F1 REFUTED by the orchestrator: the lm_head launch matches upstream (`ggml-opencl.cpp:27803`), global[1] = local[1] = 2 -> one group in dim 1, `get_group_id(1)` is always 0.
- F2 (A7X lm-head guard bypassed on the HOST route): decided on the S23 by KLD + the new HOST self-check, not in code.
- F7: the shared-mode input buft list moves every input-role tensor (pos_embd, token_types, per-layer embd, masked-emb) to HTP0-HOST paired with the CPU device; only token_embd matters for LFM2/Qwen. The mmap swap to CPU does not apply in our runs (HTP present -> mmap off). Narrow to TOKEN_EMBD if another arch ever runs shared.
- F8/F10: `ggml_backend_opencl_release_imports` has no caller in-tree; stale-import warning is NDEBUG-silent and fd/base/size can collide after recycling. Wiring is step 6 (binding); revisit the detector there.
- F9: only a tied lm_head lands in HOST; an untied output in shared mode is unaddressed.
- F12/F13: per-op mutex/env cost on the compute path; discarded bool return; test covers little runtime decision surface beyond what the fixes add.
- P3 UX (Jelly 2026-10-05): a remote picture's composer chip reads "Reading from <file>" with a document icon; it
  should look like a picture chip (thumbnail or image icon, no "Reading from").

## Chat pill phone/PC switch (branch ux/model-bar-switch; review luna 64ae87ed, 2026-10-05)
- P3: switching back to the phone when its model is not downloaded gives a non-pressable status row
  (modelBarChoices.ts:50, ModelBar.tsx:136); the user must go to Settings to download.
- P3: modelBarChoices.test.ts:75 and :107-110 pin source text (toContain/regex) for wiring and dismissal.

## Virtualized transcript (branch ios/perf-2-transcript; review luna 6235c656, 2026-10-05)
- P3: transcriptEdgeFade.test.ts:124 finds the FlatList end with indexOf("/>") — syntax-pinned, not paint order.

## Option 3 audit leftovers (reviewer n2, 2026-10-05; `audit-option3-n2.md`)
- P1 DMA alignment (first non-128-aligned 2-D DMA rows, 1680 B) and P1 conversion cost (2.62e8 inner iterations/token; 0.9-0.95 only if the loop vectorises): decided by the S23 one-row probe and the NPU ABBA, not in code. Fable's "Q4_0 raw ran 0.70 with scalar conversion" premise is questioned: Q4_0's converter is the shape clang vectorises.
- P2 zero host tests for the three new host predicates (raw gate split, HMX refusal, has_raw_q6_K_mm): add with the step-6 binding tests if the gate changes again.
- P3: host packer compiled into the DSP TU then discarded; 256K memset calls per token; `int raw` mode relies on inlining; `has_raw_q6_K_mm` named like an identity test; fp16 byte identity rests on a shared unpinned implementation; duplicated TILE_SIZE; double-derived tile counts.

## Room layout fix (branch phone/room-layout; review space-bunny a643cb93, 2026-10-05)
- P3: the overlay frame literal (absolute fill + zIndex 50) is duplicated in ~10 screens; extract one helper.
- P3: roomLayout.test.ts mocks react-native minimally and stubs React hooks; it compares style objects, not layout,
  and breaks on unrelated AccountScreen imports.

## Stability batch 1 (app main 88357e64; review luna ea86880d, 2026-10-05)
- P3: a /bench send sets sendingRef before runBenchTurn appends the user message (sendHost.ts:151/161); a background
  flush in that window persists the old list, so a process death loses the bench command. Dev-only path.
- Open: duplicate transcript ids source not proven (warning now once per distinct set).

## Amendment I audit leftovers (reviewer n2, 2026-10-05; `audit-amendI-n2.md`)
- P2-5: `make_cpu_buft_list` still offers the CPU compute buft as a weight candidate (dead only because HOST and HOST-W share one iface).
- P2-9: OpenCL HOST admission depends on the mutable Hexagon global `opt_hostbuf` through `device_weight_host_buft`, resolved from a different registry than `make_cpu_buft_list`.
- P3s: identity test not fail-closed by itself; process-global v4 program/kernel; dead `ggml_hexagon_tensor_is_host` cited as live; no assertion that compute/output stayed in HTP0-HOST; v4 under the binary cache; two self-check preconditions share one message.
- Declared (not a defect): since Amendment I the v4 TILE32 kernel builds with the engine's fast-math options (comment at `ggml-opencl-tile32-matvec.cpp:50-55`); GPU-leg KLDs before/after 24fb5b8d6 are not strictly comparable.
