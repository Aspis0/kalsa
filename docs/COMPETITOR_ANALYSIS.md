# Competitor analysis — Kalsa vs PocketPal AI / MLC Chat / Layla / Offline Private AI

Date: 2026-08-10 · Scope: repo ai-chat (Kalsa) · Research: read-only study of each competitor (repos where public).

## 1. TL;DR

| Competitor | License | Verdict |
|---|---|---|
| **PocketPal AI** | **MIT** (verified: `a-ghorbani/pocketpal-ai` LICENSE, Copyright 2024) | Most similar product. Legit to borrow patterns + code (attribution required). |
| **MLC Chat / MLC-LLM** | **Apache-2.0** (verified) | Different runtime (TVM, no GGUF). Borrow catalog/VRAM metadata + download FSM; not the runtime. |
| **Layla** | **Closed source** (app). Open peripherals Apache-2.0 (`layla-sdk`, `Layla-Server`). | Product/UX reference only; trust-risk flagged (cloud IAPs contradict "offline"). |
| **Offline Private AI** | **Closed source** (iOS-only). | Product reference; trust-risk flagged (ad SDK vs "zero data" claims). Weak document chat on paper. |

## 2. Verified licenses

- PocketPal AI: **MIT** — `https://github.com/a-ghorbani/pocketpal-ai` LICENSE (MIT License, Copyright (c) 2024 Asghar Ghorbani). NOTE: PLAN.md's "Apache-2.0" claim for pocketpal is **wrong** — it is MIT.
- MLC-LLM: **Apache-2.0** — `https://github.com/mlc-ai/mlc-llm` LICENSE + NOTICE (2023-2025 MLC LLM Contributors).
- Layla: main app **closed source** (store-distributed, `com.layla`); open repos `l3utterfly/layla-sdk` + `l3utterfly/Layla-Server` are Apache-2.0 (LICENSE files; package.json says MIT — trust LICENSE).
- Offline Private AI: **closed source** (App Store id6761763518, Neylton Nascimento Santos Filho, `com.offlineprivateai.mobile`).

## 3. Stack comparison

| | Kalsa | PocketPal | MLC Chat | Layla | OfflinePrivate AI |
|---|---|---|---|---|---|
| Framework | RN/Expo | RN | Kotlin/Compose + SwiftUI | RN WebView host (closed) | Native iOS (unverified) |
| Engine | llama.rn 0.12.8 (llama.cpp b10156) | llama.rn 0.12.7 | TVM/MLC (OpenCL/Metal) | llama.cpp + LiteRT-LM/ExecuTorch claims | Unverified (likely MediaPipe/llama.cpp) |
| Format | GGUF | GGUF (+mmproj) | MLC-compiled (no GGUF) | GGUF | GGUF-ish (unverified) |
| Platforms | Android-first, minSdk 33 | Android+iOS | Android+iOS | Android+iOS | iOS only |
| Web search | Exa agent tools (webSearch/webFetch) | local "talents" | none | hybrid (reported) | none (offline pitch) |
| PDF/doc chat | PDF text + vision + BM25+ retrieval loop | none | none | unclear | Documents tab (likely context stuffing) |
| Voice | Whisper STT + TTS | strong TTS, STT secondary | none | STT+TTS | voice I/O, OCR |
| Memory | facts + compaction + BM25 retriever | context ladder only | none | LTM + knowledge graphs | none |
| Device gating | **hard RAM/disk/tier gates both platforms** | soft tier + learned ceiling | VRAM gate **iOS only** | soft "flagship 8GB+" | none verified |
| Model catalog | curated Qwen3.5 2B/4B | curated + HF browser | mlc-package-config | curated | Gemma 4 E2B, Llama 3.2 1B/3B |

## 4. Feature matrix (Kalsa vs rivals)

Kalsa already leads on: agent tool loop (Exa), PDF pipeline, BM25+ multi-round retrieval, hard device gating (both platforms), Whisper STT, memory/compaction, en/it i18n, privacy (no ad SDK).

Rivals lead on: PocketPal — learned memory ceiling, background context auto-release, context ladder UX, edit/regenerate, HF browser, strong TTS, WorkManager downloads, benchmark UI; MLC — compile-time per-device variants, download FSM (pause/resume, 3 concurrent, file-count progress), warm-up completion, usage telemetry; Layla — persona/character ecosystem, mini-app platform + public SDK, knowledge-graph memory, WebRTC PC remote; OfflinePrivate — Documents-tab product UX (not technology).

## 5. Trust risks (both rivals and us)

- **Layla**: paid $19.99 + **cloud IAPs** (Monarch/Birdwing/Blue Morpho) while marketing "offline/no account". Users report responses "too fast" → cloud suspicion. ~14 tok/s CPU on S25 Ultra (third-party) is plausible for small models, so speed alone is not proof — but the cloud IAPs are real and undisclosed. **Benchmark any Layla claim; do not trust their offline story.**
- **Offline Private AI**: claims "zero data collection" but App Privacy labels report **Identifiers used to track you** + **Meta Audience Network** ad SDK (v1.0.8 notes). 0 ratings. **Privacy positioning is marketing, not engineering.**
- **Kalsa's counter-position**: measured local performance (harness), no ad SDK, hard gates, transparent stack. This is our differentiator — document it in-store.

## 6. What to borrow (verified paths + license)

### From PocketPal (MIT — attribution in NOTICE/README)
1. `src/utils/memoryEstimator.ts` — GGUF weights+KV+compute estimate (we already have `memoryEstimate.ts`; borrow the "learned ceiling" idea: `largestSuccessfulLoad` ∪ cold availMem beats static %).
2. `src/hooks/useMemoryCheck.ts` — learned ceiling + fit badges (align with our `modelGateVerdict`).
3. `src/utils/contextInitParamsVersions.ts` — versioned init params + migrations (we have engineParams; adopt versioning if catalog grows).
4. `src/screens/BenchmarkScreen/BenchmarkScreen.tsx` + `src/store/BenchmarkStore.ts` — PP/TG tok/s UI (we have the bench harness; a user-facing screen is new).
5. `src/components/IncreaseContextSheet/` + `bannerVariantResolver.ts` — context-full ladder UX (n_ctx upgrade sheet).
6. `src/hooks/useMessageActions.ts` — edit/regenerate semantics.
7. **Background context auto-release** on background → reload on foreground (best lmkd/OOM pattern).
8. Android defaults: **mmap off + kv_unified + threads ≈ 80% cores** (we measured our own; compare).

### From MLC-LLM (Apache-2.0)
1. `mlc-package-config.json` schema — `estimated_vram_bytes` as first-class catalog field (we have `kvBytesPerToken` + `estimateMemory`; adopt a per-model "estimated footprint" in ModelRegistry if not already).
2. iOS VRAM preflight `os_proc_available_memory()` pattern (`ios/MLCChat/.../ChatState.swift:326-340`) — **we already gate both platforms**; keep.
3. Download FSM (pause/resume, max-3 concurrent, file-count progress) — `android/MLCChat/.../AppViewModel.kt` ModelState.
4. Warm-up empty completion after reload (`mainReloadChat`) — cheap win.
5. `stream_options.include_usage` — tok/s usage telemetry (optional, no FPS HUD).

### From Layla (Apache-2.0 peripherals only)
1. `layla-sdk/src/internal/bridge.ts` — single-slot queue over WebView postMessage (mini-app host bridge pattern).
2. `layla-sdk/src/resources/memories.ts` — memory list/top/upsert API shape (feed into our MemoryStore).
3. `Layla-Server/src/main.ts` — spawn/kill llama-server (+mmproj) — relevant only if we ship a PC-remote (later).
4. Product ideas (do not copy closed assets): persona cards (TavernCardV2), knowledge-graph memory, WebRTC QR remote, use-case onboarding.

### From Offline Private AI (closed — ideas only)
1. Documents-tab product UX (import → ask with page citations).
2. "Snap & Ask" OCR prompt flow (we have vision attachments; productize).

## 7. Gap analysis — where Kalsa is weak vs each rival

1. **Learned memory ceiling / auto-release on background** (PocketPal) — real OOM-prevention UX we lack.
2. **User-facing benchmark/telemetry** — we measure via harness only; no in-app "how fast is my device" screen (careful: no FPS HUD per user directive; a tok/s model-info screen is fine).
3. **Edit / regenerate** a message.
4. **Context-full ladder UX** — upgrade n_ctx when RAM allows (we auto-upgrade 16k on high RAM; a user sheet is missing).
5. **Mini-app platform** (Layla) — we have in-chat miniapps; a public SDK/bridge is future.
6. **Documents library UX** (OfflinePrivate) — our PDF/retrieval tech exists; the "Documents tab" product layer doesn't.
7. **Voice-first assistant mode** (Layla) — persona/always-on flows.

## 8. Recommendations (prioritized — feeds the tuning-layer + tranche-1 design)

1. **Tranche 1 unique layer (per model/GPU/CPU tuning)**: build the device-tuning profile layer on `deviceProfile.ts` — per-device: threads from cpu_capacity (done), ubatch, KV quant, mmap/repack defaults, context budget, GPU backend policy per family (Adreno/Mali/Apple), thermal-aware decode. This is the "something unique" the user asked for: an optimization per model/GPU/CPU with measured fallbacks.
2. **Document chat product layer** (match + beat OfflinePrivate): Documents tab → `requestPdfText` → `DocRetrieverIndex` → `runRetrievalLoop` → citations; full-context for small docs, BM25 for large; scanned-PDF → vision fallback. Reuse exists.
3. **Background auto-release + reload** (PocketPal pattern) — OOM guard.
4. **Edit/regenerate** (PocketPal) — core chat UX.
5. **Benchmark info screen** (model-level tok/s, no FPS HUD).
6. Later: mini-app SDK, personas, PC-remote, knowledge-graph memory.

## 9. Attribution notes

- PocketPal: MIT — include "Portions based on PocketPal AI (c) 2024 Asghar Ghorbani, MIT" in NOTICE/README if code is adapted.
- MLC-LLM: Apache-2.0 — keep LICENSE/NOTICE headers if files are adapted.
- Layla SDK/Server: Apache-2.0 — same.
- Layla app, OfflinePrivate AI: no code reuse (closed source).
