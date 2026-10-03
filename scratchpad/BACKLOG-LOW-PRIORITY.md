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
