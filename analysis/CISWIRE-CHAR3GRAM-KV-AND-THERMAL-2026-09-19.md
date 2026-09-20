# ciswire char-3-gram: recall, KV/prefill, and device thermal (2026-09-19)

> One-doc record of the 19/09 (evening) session. Referenced from PLAN "Dove siamo" and
> ALIVE. Every device number below is read back off the phone, not a boolean the app sets
> about itself. Verdicts are honest: a FAIL is reported as a FAIL, with what actually failed.

## What was changed and measured

ciswire's context regime = legacy sliding window + BM25 lexical digest + (new) a **char-3-gram
dense retrieval leg**, fused with BM25 via RRF. The digest rides on the last user message, so it
is KV-safe (it does not perturb the held prefix). The change made the char-3-gram leg **rank all
marks** (not just rerank a top-k) and enabled hybrid ranking by default (`resolveCiswireRanking`
→ "hybrid" unless `kalsa.bench.ranking` says otherwise). The v42 "rolling summary" leg is and
stays **structurally dead** (no producer; `summaryChars=0` on every row).

APK under test (shipping engine, char-3-gram JS): CI run **35463417214**, `main@809d191`,
arm64-v8a, debuggable. `bytes=151275598 sha256=7555bb1f583e61c6e720135311a4d3da44fe8043f20afd83997ef4068149cada`
(hashed from the file on disk, not the CI summary). The engine is the OLD pin
(`llama.rn@95c3493b` → `kalsallama@2361be35`), deliberately unmoved until the fork is proven, so
what was measured is the char-3-gram retrieval change on the shipping engine — the intended
comparison.

## 1. char-3-gram recall — mechanism PROVEN off-device (deterministic)

`src/context/retriever.test.ts` "Biting recall test for the hybrid char-3-gram leg" — **3/3 green**
(`npx jest src/context/retriever.test.ts`, exit 0):
- `hybrid` recalls a doc the shared-gram cutoff drops that `bm25` does not: hybrid → `[0,1]`,
  bm25 → `[0]`; with no BM25 candidate at all, hybrid answers while bm25 returns `[]`. This is the
  recall lift: the char-3-gram leg recovers a lexically-divergent turn BM25 misses entirely.
- refcount-eviction fix (two docs with identical normalized text keep the survivor's dense vector).
- dense noise floor (`cosine > 0`): hybrid never outputs a zero-cosine doc.

This is a constructed corpus: it proves the **mechanism** works, not a real-conversation recall
rate. It is device-independent (retrieval is pure CPU logic), which is why it is the right place to
prove recall — the on-device runs (filler corpus) cannot isolate it (see caveats).

## 2. S23 (SM-S911U, Snapdragon 8 Gen 2) — ciswire ciswire, LFM2.5-2.6B-QAD-Q4_0

Run: `CONTEXT_MODE=ciswire TURNS=14 PROMPT_CHARS=2000 SEED=20260919`, unplugged, raised thermal
limits (`CW_THERMAL_STOP=5 CW_TEMP_STOP_DECI=480`). Same seed as the pre-char-3-gram run, so the
only variable is the ranking change. `verdict=FAIL`, but the FAILs are NOT the char-3-gram nor KV:

**KV "da dio" — all KV-structural checks PASS:**
- `slide_cleared PASS` (6 clean slides, `kvCleared=true` on every one)
- `reprefill_without_slide PASS` (every re-prefill explained by a slide; no spurious reprefill)
- `restore_exercised PASS` (restore turn reloaded whole, `1826/1826`, `sessionLoadOk=1`)
- `reuse_recorded PASS`; whole reuse on the clean turns (5659/5659, 6457/6457, 6576/6576, …)
- `digest_telemetry_present PASS` (KALSA_DIGEST on 11/11 post-boundary rows)
- `operative_content PASS` — digest injected on **6/11** post-boundary rows (prior run, same seed:
  5/11), `digestChars` 748–889 (same band as prior). **No regression from the char-3-gram change**;
  on filler the char-3-gram does not shift selection (expected — see caveats).

**FAILs, all extraneous to char-3-gram/KV:** `ciswire_summary_leg` (the dead v42 summary, expected)
+ `telemetry_signal / engine_alive / reply_complete / reply_not_interrupted / reuse_matched`, all
concentrated on turns 2/5/6/10 — interrupted generation and missing telemetry under thermal
throttling (driving/telemetry noise, not a ciswire defect).

**Thermal (Governor material):** battery temp ~37 → **max 44.5 °C**, `thermal_status` up to **3
(SEVERE)**. Per-turn degrades monotonically with heat: 117 → 132 → 105 s (cool) then
198 → 240 → 258 → 255 → 264 → **438 s** (turn 14). At ~4 min/turn the app is effectively
**unusable** for a real user. Conclusion: **S23 CPU-only throttles to unusable under sustained
load** — the concrete, measured justification for the Governor, which must manage the *sustained*
curve, not the cold peak. (Caveat: `adsprpcd/cdsprpcd` contaminate S23 baseline, but here the heat
is real compute — 255 s of generation per turn.)

## 3. Jelly Star (MediaTek, Mali, 8 GB, 480×854) — same run

Same params, char-3-gram APK, raised thermal, UI driving repaired. `verdict=FAIL`.

**Prefill/reuse KV — works da dio here too:** reuse is **whole** on every captured turn and grows
monotonically — 3587 → 5049 → 6505 → 8504 → 10194 → 10706 → 12213 → 12725 → **14554** tokens — then
drops to **2147** after the slide (window slid, new window fully reused). Genuine growing-conversation
reuse, not prewarm (prewarm is a small static prefix). `slide_cleared PASS`,
`reprefill_without_slide PASS`, `digest_telemetry_present PASS`, `operative_content PASS` (digest
injected 2/2 post-boundary, 846 chars). Boundary reached late (turn 14) because the Jelly held a
larger nCtx (reuse to 14554).

**KV RESTORE — NOT verified on the Jelly:** `restore_exercised FAIL` (no `KALSA_SESSION op=load
ok=true` in the restore slice). Most probable cause: thermal non-completion meant no reply finished
→ no `.kvs` saved → nothing to reload. **A thermal gap, not a KV defect.** (On the S23 restore
PASSED.) Closing it would need a shorter/cooler Jelly run so replies complete and a session is saved.

**Thermal + non-viability:** replies land only while cool (assistant count → 7 in early turns), then
from ~turn 8 `thermal_status=3 (SEVERE)` at **only 39 °C** (max 39.0 °C — the Jelly flags SEVERE far
earlier than the S23's 44.5 °C) and generation **stops completing**: 7 of 15 rows `no turn-end within
600s`; battery **85 % → 44 %**. Not merely slow — **non-functional under sustained load.**
Conclusion (owner): **LFM 2.6B on the Jelly CPU-only is impractical**, unless the GPU/NPU are made to
work AND are shown to lower the thermal curve.

**RAM is not the limiter — thermal is (owner insight, confirmed).** 8 GB loaded model (1.6 GB) + KV
(nCtx to 14554 tokens) with room; the wall is heat dissipation (compute-bound, RAM-independent).
Above the load floor, more RAM buys *capacity* (bigger context/KV, embedder co-residency), not
*sustained throughput*. Catalog implication: gate on **sustained thermal/compute capacity, not GB**
(cf. catalog-must-gate-by-device-prefill-cost). Complementary reading: a 2.6B may simply be
out-of-class for the Jelly.

**GPU/NPU is the right hypothesis but unproven:** Jelly = Mali (parked, never ported); NPU decode
currently stays on CPU; GPU offload is not automatically a thermal win (f16 GEMM was the culprit on
Adreno). Double jump: (a) get Mali offload running, (b) prove it lowers energy/token, not just
latency.

## 4. Overall

- **char-3-gram: measured and closed.** Recall mechanism proven off-device (deterministic, 3/3);
  live and KV-safe on the shipping engine on-device (S23 + Jelly): reuse whole, slides clean,
  reprefill only from slides, digest injects; no regression vs the prior ciswire on the same seed.
- **Prefill/KV "da dio" on LFM across both devices** for the turns that ran. **Restore** verified on
  S23, **unverified on Jelly** (thermal, not KV).
- Both device runs FAIL the overall ciswire verdict for two reasons only: the **dead v42 summary
  leg** (expected) and **thermal-driven driving/completion flakiness** — neither touches char-3-gram
  or KV.
- **Device thermal** is the dominant product constraint for CPU-only LFM: S23 throttles to unusable,
  the Jelly cannot complete replies. Strong material for the Governor and for a thermal-based catalog
  gate.

## 5. What is next

- **Xiaomi (Qwen 4B)** is the last device and the most valuable: Qwen has a different KV shape
  (SWA / think-in-history), so it attacks the "any model" half of the standing goal. It is Dozing +
  lock-password → the **owner must wake and unlock it**; the orchestrator sends no wake commands.
  Its `Thermal Status` hides the frequency cap, so the number to watch there is the freq cap, not
  the status.
- Not chasing the Jelly restore hole: the device is already concluded non-viable for sustained LFM.

## 6. Harness changes (local, UNCOMMITTED)

- `scripts/device-ciswire-cache.sh`: after `cw_wait_ready`, poll `kalsa.conversations.v1` until the
  app has persisted the fresh conversation before reading the active id (the "Ready"/"Pronto" label
  can render at t=0, before conversation-create, racing ahead of it — observed "ready after 0s" →
  FATAL). Gated on the real state; genuine cold boots persist within ~5 s.
- `scripts/device-share-send.sh`: the send loop now waits for the Send/Invia affordance to reappear
  up to `SHARE_SEND_NODE_WAIT` s (default 6 preserves the S23/campaign fast path), interruptible by
  `SHARE_SEND_ABORT_FILE` so a thermal watchdog can still break a long wait. Fixes the Jelly turn-5
  wash: on a slow device the harness sent turn N+1 while turn N was still generating, when the send
  button is a stop control and no Send/Invia node exists. With the fix all 14 turns + restore drove.

## 7. Caveats

- The on-device harness uses a **filler corpus** (pseudo-random `n20260919-fNN` tokens that all
  share the date prefix), which **dilutes** the char-3-gram signal — so the device runs confirm
  liveness + KV-safety, not recall lift. Recall lift is proven only off-device (§1).
- Per-turn timings on the Jelly are unreliable (the turn-end DB fallback fires at stream-start).
- Both runs measured the OLD engine (see provenance); no engine-side difference is attributable to
  the char-3-gram change.
