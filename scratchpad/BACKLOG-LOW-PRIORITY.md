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
