# Xiaomi / Qwen: fit-gate vision-eager refusal + ciswire char-vs-token overflow (2026-09-20)

> One-doc record of the 20/09 (night) session on the Xiaomi. Continuation of
> `CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md` (S23 + Jelly, LFM). Referenced from PLAN
> "Dove siamo" and ALIVE. Every device number is read back off the phone; every code claim is
> quoted file:line and verified on disk by the orchestrator, not taken from the audit's word.
> Goal of the session: the "qualsiasi altro modello" half of the standing goal — Qwen on Xiaomi.

## Provenance
- Device: Xiaomi **houji_global / 23127PN0CG**, 12 GB nominal RAM. Serial `adb-625689a2-9xEOfw._adb-tls-connect._tcp`.
- Model: **Qwen3.5-4B-Q4_K_M** (`files/models/qwen3.5-4b/`, 2 834 975 040 B) + `mmproj-F16.gguf` (672 423 616 B, vision).
- APK: same shipping engine as the S23/Jelly runs — CI **35463417214**, `main@809d191`, arm64-v8a debuggable, `sha256 7555bb1f…` (PRE-`50b8196` pin bump; deliberately unmoved for cross-device comparability).
- Harness: `scripts/device-ciswire-cache.sh`, `CONTEXT_MODE=ciswire`, seed `20260919`.

## 1. Qwen 4B loads on the Xiaomi ONLY via `kalsa.bench.norepack=1`
On a first run the app **refused Qwen and silently loaded LFM** (ground truth: `/proc/<pid>/maps`
showed `models/lfm2.5-2.6b/…gguf`, not qwen). This is why the earlier S23/Jelly "qwen" harness
config actually measured LFM — the harness verifies the DB pref `kalsa.model.id`, never the loaded
engine. logcat gave the reason verbatim:

```
KALSA_LOAD {"phase":"fitGate","modelId":"qwen3.5-4b","refusedBy":"fit","reasonKey":"model.tightNow","disposedResident":false}
```

`disposedResident:false` + `refusedBy:"fit"` ⇒ the gate saw no resident model to free and Qwen did
not fit at the available memory. Setting **`kalsa.bench.norepack=1`** (written to the DB via
ci-lib's pull/edit/push, app force-stopped) made Qwen load: `/proc/<pid>/maps` = `qwen3.5-4b`, and
with norepack the weights stay mmap'd/evictable so `MemAvailable` barely moved (4.9 GB with Qwen
resident). **The repack copy (~3 GB anon) was the real RAM hog, not the model.** Caveat: norepack
changes the REAL load config (via `resolveGateLoadPolicy`, not just the estimate), so tok/s and
thermal from a norepack run are a NON-SHIPPING config — good for "does Qwen run?", not a catalog
number. (kalsa-63 verified this on disk.)

## 2. BUG #1 — the app loads Qwen's vision mmproj eagerly + mandatorily, even for a text chat
The fit math is correct: it prices exactly what the app loads. The problem is WHAT it loads.
- `src/app/AppShell.tsx:4298` — `const mmprojPath = model.mmproj ? modelLocalPath(model, model.mmproj.file) : null;`
- `src/app/AppShell.tsx:4360` — `initEngine(…, { mmprojPath, … })` (also 4870→4986 on the download path). No condition on an image being present.
- `src/engine/LlamaService.ts:2363` — `const isMultimodal = Boolean(options.mmprojPath);` and `:2675` runs `initMultimodal`, which is MANDATORY (`:2099` — if it fails "l'engine NON si considera pronto").

So every Qwen chat load pulls in the vision projector (672 MB weights + vision compute), and that
footprint is what tips Qwen 4B from "fits" to "refused" on a mid-RAM device. **Fix candidate
(owner-scope, NOT implemented): lazy vision — load the mmproj only when an image is attached.**

## 3. BUG #2 (the main one) — ciswire budgets the window in CHARS, the ceiling-slide projects tokens as chars/3, so token-DENSE content overflows n_ctx
The first Qwen run (dense filler) generated turns 1-7 then hit **"context is full!"** from turn 8:
the reply persisted in **0 s** (no generation). logcat, verbatim:
```
loadPrompt:488 loadPrompt: prompt_n=17590 n_ctx=16384 embd=15824   (turn 8; grows 17590→19369→21144→22918→24697)
KALSA_WINDOW {"kvHeld":true,"nPast":15824,"lastSaveTokens":15824,"hasDigest":false,"textEst":6865→9794}
```
`prompt_n` (tokens) blew past `n_ctx=16384` while `nPast` stayed pinned at 15824 and the window never slid.

Root cause (audit + verified on disk):
- `src/context/windowProfile.ts:75` — `export const WINDOW_CHARS_PER_TOKEN = 3;` (deliberately low, for prose/Italian ~3.2-3.5).
- `src/context/windowProfile.ts:275` — `const charBudget = Math.floor(budgetTokens * WINDOW_CHARS_PER_TOKEN);` — budget is CHARS.
- `src/context/compactor.ts:517` — compactor rebuild trigger is char-based (`estimateWindowChars(recent) > cfg.windowCharBudget`).
- The ceiling slide `shouldSlideWindowAtCeiling` (`src/context/windowProfile.ts:149-172`, called `src/app/AppShell.tsx:6134`) IS token-aware — but only via `projectedWindowTokens = Math.ceil(windowChars / 3)` (`windowProfile.ts:135`), NOT a real tokenizer.

Arithmetic (ciswire = retrieval on → `WINDOW_SHARE_WITH_DIGEST = 0.6`): budget ≈ `(16384 − 2048) × 0.6 × 3 ≈ 25 805 chars`. The dense filler (`n20260919-fNN`) is **~1.12 chars/token** (measured: 2000-char prompt = ~1779 tokens). So 25 805 chars ≈ **~23 000 tokens ≫ n_ctx 16384** — the char-budget/`/3`-projection thinks there is room while the real tokens overflow → no slide → engine returns `context_full` (`src/engine/LlamaService.ts:4913`, detected only AFTER the call). Failure begins below **~2.25 chars/token**.

**Severity: REAL product bug, not synthetic-only.** Anything below 3 chars/token is undercounted:
code, JSON, long identifiers, CJK/non-Latin (`src/engine/prefixPrewarm.ts:279` notes CJK "price near
1 token per char"). Why LFM slid on S23/Jelly but Qwen did not here: LFM ran at a **smaller n_ctx**
(tighter char budget → slid early); Qwen got `n_ctx=16384` (large budget) so the dense filler
overflowed tokens first.

**Best fix location (owner-scope, NOT implemented):** `shouldSlideWindowAtCeiling`
(`src/context/windowProfile.ts:149-170`) must consume an actual / conservatively-measured rendered-
prompt token count, not `chars/3`. Fixing at `streamAssistantTurn` is too late (already at
`engine.completion`, `LlamaService.ts:4813`). Root-cause line: `windowProfile.ts:75`.

Bonus gap found in the same pass: `src/context/windowProfile.ts:246` — `charBudget: Number.POSITIVE_INFINITY`
on the "images"/attachment branch ⇒ an attachment turn gets an UNBOUNDED window (and a document-only
attachment wrongly takes the images branch — a pre-existing mismatch noted in KALSA_DEPENDENCIES.md).

## 4. The Xiaomi memory reality (why the fit-gate is not just being fussy)
`/proc/meminfo`: `MemTotal 11 436 476 kB (~11.4 GB)`, `MemAvailable 3 727 652 kB (~3.65 GB)`,
`SwapTotal 12 582 908 kB`, `SwapFree 9 188 752 kB` (~3.4 GB already in zram). Closing 3 foreground
apps moved MemAvailable by ~60 MB (3.65→3.71) — the RAM is held by MIUI/system/persistent services,
not the user's apps. Force-stopping the app freed the resident LFM and lifted MemAvailable to ~5 GB.
The fit-gate reads `MemAvailable` and is **swap-blind** (0 occurrences of zram/swap in `src/`).
kalsa-63's product view (agreed): do NOT teach the gate to count zram as available for weights —
compressed RAM counted as free buys thrashing. The defensible fix is BUG #1 (lazy vision), not a
swap-aware gate.

## 5. What we DID prove on Qwen (partial, valid)
- Qwen 4B **loads and runs** on the Xiaomi (via norepack): KV reuse + prefill work (dense run turns 1-7 generated, decode ~3.8 tok/s, prefill ~278 s on ~1774-token prompts).
- The **prose re-run** (see §6) confirmed the ciswire **digest leg activates on Qwen** (`KALSA_WINDOW … "hasDigest":true`) — unlike the dense run where `hasDigest` stayed false (because it never slid). Stopped at turn 1 to return the phone to the owner for the night; the full prose char-3-gram recall-after-eviction measurement is PENDING.

## 6. Harness change (local, uncommitted)
`scripts/device-ciswire-cache.sh` `cw_prompt`: added a **`CW_CORPUS`** knob (default `dense` =
unchanged committed behaviour). `CW_CORPUS=prose` swaps the dense `-fNN` filler for a fixed English
word list (~3.9 chars/token) and dilutes the marker to 1/12, so the char-budget slides at the right
point while the recall probe (count an earlier-turn marker) stays intact. Verified offline: turn 8
prose prompt = 2002 chars, 303 words, marker present 25×. For the recall-after-eviction test the
window must actually slide → use a larger `PROMPT_CHARS` (5000 exceeds the ~25.8 k-char budget by ~turn 6).
NOT committed (measurement variant; and the tree is behind origin after the `50b8196` pin bump).

## 7. Pending / next
- Complete the **prose char-3-gram recall measurement on Qwen** when the phone is free (owner needs it overnight).
- Two owner-scope fixes flagged, not touched: **lazy vision** (BUG #1) and **token-aware ceiling slide** (BUG #2). Vision-lazy is the more defensible / higher-leverage one (fixes both the refusal AND the overflow's realistic-content variant is separate).
- Post-`50b8196`: `git pull` + `npm install` (only after the E2E is green — it is: run 35483990916), and note the `Input processed` KV-reuse log line is retired at the new pin (6 harness consumers need migration to `KALSA_KVPREFIX`; kalsa-63's chapter).

## 8. 2026-09-21 (night) — prose run attempt: thermal abort + PARTIAL Qwen KV-reuse proof + a density correction
Owner authorised option A (unplugged clean run). Config: APK 809d191 (sha `7555bb1f…`, unchanged), `CW_CORPUS=prose PROMPT_CHARS=5000`, `kalsa.bench.norepack=1` (verified in DB), Xiaomi unplugged 95% 39.0°C. `/proc/<pid>/maps` (pid 27515) = `qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf` — Qwen genuinely loaded, NOT the LFM fallback.

**Verdict: ABORTED (device_safety_stop).** Battery temp climbed 390→402→419→**441** deci-C (44.1°C ≥ the 44.0 stop) by turn 3 in ~15-20 min. The watchdog fired correctly; settings restored, app force-stopped. Same sustained-load thermal wall as S23 (`s23-cpu-only-throttles`) and Jelly (`lfm-on-jelly-cpu`).

**PARTIAL but REAL result — Qwen whole-prefix KV reuse works (turn 3, the one clean turn):**
`KALSA_KVPREFIX embd=3865 text_tokens=6257 n_common=3865`; turns.tsv `reuse_state=whole`, `reuse_src=kvprefix_match`, `nPast=3865`, `promptN=2392`, `promptMs=248979`. → 3865/6257 tokens (62%) reused from the live KV; only 2392 new tokens prefilled, in ~249 s (~9.6 tok/s prefill on Xiaomi CPU under norepack — no ARM repack, hence slow). This is the standing goal's property ("kv + prefill on any other model") demonstrated on Qwen. Turn 1 timed out (`no_turn_end`, 600 s; `promptMs=267778`); turn 2's count was confused (turn 1's late reply). Only turn 3 is a clean datapoint.

**DENSITY CORRECTION (measure-don't-assume).** §6 assumed the prose corpus is ~3.9 chars/token. On the real Qwen tokenizer it is **~1.53 chars/token** (turn 1: 5130 chars = 3355 tokens). Consequence: the ciswire char budget ~25 805 chars ≈ ~16 860 tokens > `n_ctx` 16384, so the window would have crossed the token ceiling at **~turn 5** — i.e. `prose@5000` would trigger **Bug #2 (context_full) regardless of the thermal abort**. The corpus was mis-calibrated for this tokenizer; it does NOT produce the intended clean slide on Qwen.

**To measure char-3-gram recall on Qwen cleanly (owner-scope, next):** the CPU thermal budget caps the achievable turns, so the ceiling must be crossed with far LESS total inference — a **smaller `n_ctx`** (tighter char budget → early slide with small prompts, like LFM on S23/Jelly) is the promising path, or a genuinely lower-density corpus whose ratio is verified against the real Qwen tokenizer first. Do not re-run `prose@5000` at `n_ctx=16384`: it re-aborts thermally at turn 3 and would hit Bug #2 anyway.
