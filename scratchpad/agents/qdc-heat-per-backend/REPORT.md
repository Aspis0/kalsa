# QDC per-backend prefill heat — QRD8650 (Snapdragon 8 Gen 3 / Adreno 750)

**Status: PREREGISTERED 2026-09-25 ~11:30 EDT (before the QDC session was opened);
outcome: session 844629 ran 32.3 min and produced ZERO valid heat arms. The
prediction below stands UNTESTED. See "Session accounting" and "Result" for
the honest record; raw evidence under raw/sa848698/.** Board target: QRD8650 (same SoC as the owner's Xiaomi 14,
whose battery we must spare). Fallback if QRD8650 has no minutes or is
unavailable: QRD8750 (8 Elite), to be stated here if used: _pending_.

## Protocol

- **APK** `/Users/marco/kalsa-apks/aceee960/app-release.apk`, SHA-256
  `633887432181f0ae7d0e3a525b346320dd5cdc022282ec28c950ede8b12e1bea`
  (verified locally before this report was written). Normal install on the
  fresh QDC board.
- **Model**: the shipped model the app offers on this board. QRD8650 reports
  ~11.5 GB RAM → RAM tier "high" → catalog recommendation `qwen3.5-4b`
  (`Qwen3.5-4B-Q4_K_M.gguf`, 2,834,975,040 B, sha256
  `3874209241c9a397e2f62cd3f70f80fd2dfbf0dfccb6838416bdb48a714e8630`,
  unsloth/Qwen3.5-4B-MTP-GGUF @ 86835bf9). Sideloaded to
  `files/models/qwen3.5-4b/` via run-as (app-smoke #63 method), selected with
  `kalsa.model.id`.
- **Route**: set in chat with `bench:route cpu|gpu` (typed in pieces). Per
  turn, `route_push`, `route_chunks`, `route_mismatch` are read from the
  `KALSA_GOVERNOR` log line (format confirmed in the S23 heat-run raw logs,
  same APK build: `route_push:"applied"`, `route_mismatch:false`,
  `route_chunks[{requested,actual,tokens,prefill_ms,forced}]`).
- **Arms**: 1024-token uncached prefill, CPU vs GPU, 3-4 pairs in alternating
  order (C→G, G→C, C→G[, G→C]). Uncached = fresh chat per arm via the drawer
  "New chat" (KV dropped); arm valid only if `sum(route_chunks.tokens)` is in
  [973, 1126].
- **Prompt**: frozen word-cycle filler (S23 heat-run style) + fixed tail
  "Ignore all text above. Reply with exactly READY." (bounds decode).
  Tokenizer-verified on the Mac with the Qwen3.5-4B GGUF (homebrew
  llama-tokenize). The chat-template overhead (~250-270 tokens, measured
  from the S23 smoke turn `prompt_n=273` for a ~6-token message) is measured
  again in-session with a READY smoke turn and the filler variant that puts
  the total turn prefill nearest 1024 tokens is chosen BEFORE the first arm;
  the frozen file and its SHA in PROMPT.meta are the arm identity.
- **Cooldown gate before every arm**: skin HAL ≤ 37.0 °C, poll 15 s, cap
  720 s. Cap hit → arm VOID `hot`, run continues, never aborts. After the
  route/reload activity a settle poll (same target, cap 240 s) is recorded —
  informational, not gated.
- **Sampling**: one on-device sampler (`smp.sh`) runs continuously from setup
  to end of arms: every ~1 s it reads all `cpu*`/`gpuss*` sysfs thermal zones
  and the skin HAL sensor (`dumpsys thermalservice`, `mName=skin`); each line
  carries its own epoch (actual cadence reported, dumpsys is the limiter).
  `skin_before` = HAL skin immediately before the send tap; `skin_after` =
  HAL skin 60 s after turn completion; per-arm ΔT also computed from the
  sampler series (peak in [send, send+180 s] minus value at send).
- **Validity**: arm INVALID if `route_mismatch != false`, `route_push !=
  "applied"`, `route_requested != arm backend`, governor `failed=true`, any
  `KALSA_GOVERNOR_FALLBACK` in the arm window, per-chunk `actual` != backend,
  or `sum(route_chunks.tokens)` outside [973, 1126]. Invalid rows stay
  visible in results.tsv.
- **NPU**: no working HTP/NPU path exists in the lab for this board (all NPU
  cells were 8 Elite/QRD8750 v79 or 8 Gen 2 v73 CLI kits, not the shipped app
  path on SM8650/v75) → **"NPU: no path"**, skipped per instruction.
- **Session**: QDC interactive SSH session, tunnel on local port 6037 only
  (never 5037, never `/vendor/lib64` in LD_LIBRARY_PATH), no local phone is
  touched. Minimum requested cap ≤ 90 min, driver deadline a few minutes
  under it. Device-card minutes read before and after.

## Prediction (written before measurement)

From the same-SoC cells in `governor-archive-mining/SYNTHESIS.md` §1 (Xiaomi
14 = Snapdragon 8 Gen 3, unplugged, Qwen3.5-2B): prefill heat at pp1024 was
**battery +2.8 °C (CPU) vs −0.3 °C (GPU)**; at pp2048 the SoC zones moved
**+19.3 °C (CPU) vs +1.4 °C (GPU)** — roughly linear in tokens, so ~+9.7 vs
+0.7 °C at 1024 on the zone scale, with decode on CPU in both arms (common
mode). The skin HAL integrates and damps the zone spike.

1. **Direction**: CPU arms end hotter than GPU arms. High confidence — every
   prior same-SoC comparison (battery, SoC zones, S23 KEXP peaks) agrees.
2. **Skin ΔT per 1024-token prefill, point estimate**: CPU ≈ +1.5 °C above
   its pre-send baseline (range +0.5..+3 °C); GPU ≈ +0.3 °C (range
   −0.3..+1 °C); **predicted CPU−GPU pair contrast ≈ +1.2 °C skin
   (plausible range +0.2..+2.5 °C)**.
3. **Secondary**: prefill wall time CPU ≫ GPU (in-app CPU likely 15-60
   tok/s → ~17-70 s; GPU ~280 tok/s class → ~4 s + chunk overhead);
   `engine_decode` expected CPU in both arms, so decode heat is common mode.
4. A near-zero result is possible if the board's skin sensor saturates or
   the 60 s tail clips the CPU peak (skin lag); that would show as
   CPU-arm ΔT still rising at tail end, not as a symmetric null.

No routing conclusion is licensed by 3-4 pairs; this prices one board, one
model, one app build, one prompt length.

## Session accounting

- **Minutes before session (QRD8650 card): 35** (QRD8750: 51; QRD8750 not used)
- **Session**: `qdc-heat-per-backend-8650` = QDC interactive 844629, unit
  `sa848698`, device serial `cacfeec9`, SM8650 / QRD8650 / Android 14,
  SSH-only mode, key `kalsa-mac`, requested cap 35 min (the minimum that
  could contain even one pair — the pool held only 35).
- Started 11:46:09 EDT, ended 12:18:26 EDT (Completed, portal-verified) =
  32 min 27 s.
- **Minutes after session (QRD8650 card): 0** ("Request Free Minutes"). The
  QRD8750 card kept its 51 min (now "Unavailable", pool-side queue state).

## Result — ZERO valid arms

No CPU or GPU arm produced a route-validated turn. results.tsv holds one row:

| Pair | Arm | Turn | Status | void_reason | skin_after |
|---:|---|---:|---|---|---:|
| 1 | cpu | 1 | INVALID | composer | 35.628 |

Valid pairs: **n = 0**. The predicted CPU−GPU skin contrast could not be
evaluated. No heat conclusion is licensed; the preregistered prediction
(+1.2 °C skin, CPU hotter) remains open.

## What consumed the session (failure chain, with evidence)

1. **Setup (fine, ~5 min).** APK installed and DEBUGGABLE-verified, RKStorage
   bootstrapped, prefs set (model `qwen3.5-4b`, governor on, greedy,
   toolchoice none), Qwen3.5-4B Q4_K_M pushed at 23.2 MB/s (116.6 s) and
   run-as-copied into `files/models/qwen3.5-4b/` (device-side stat verified
   2,834,975,040 B), on-device thermal sampler running (`raw/sa848698/samples.txt`).
2. **Smoke blocked by the load-on-send state.** After setup the app bar showed
   "Held: the model has to be loaded again"; `KALSA_PREWARM` repeatedly logged
   `{"op":"skip","reason":"not_ready"}` and no `llama_model_loader` line ever
   appeared — on this build the engine only (re)loads when a message is sent.
   The smoke phase's `poll_load` therefore waited on a prewarm that could only
   start after its own route-command send; killed before its 300 s cap
   (`raw/driver-sa848698-smoke.log`).
3. **Screen doze between phases.** The board ignores `svc power stayon true`
   (mIsPowered=false) and the driver's own cleanup restored
   `screen_off_timeout=60000` between phases, so the display dozed between
   operator steps and UI dumps repeatedly captured the AOD/lock screen
   (harness trap 7 re-confirmed).
4. **Driver bug (fixed in-session):** `thermal_record` doubled `$RAW` when
   given an absolute prefix → first arms attempt died with
   COOLDOWN_THERMAL_FAIL at its first poll. Fixed by basename-ing the arg
   (`parse.sh`).
5. **Arms attempt 2: cooldown gate PASSED first poll (skin 35.395 ≤ 37) but
   the route turn was VOID `composer`.** The composer contained leftover text
   from the earlier manual attempts ("bench:route cpu" had been typed but its
   Send tap landed on the dozed screen); with fast-typing the verification
   found `actual=30 expected=15`, the clear/retype ladder also failed
   (`composer_len.txt`), and the arm was marked INVALID per protocol.
6. **Manual endgame abandoned on time.** With ~7 min of cap left, the
   route→load (60–90 s for a 2.8 GB mmap)→new-chat→3,266-char prompt→CPU
   prefill→completion sequence could not fit; the route command was never
   successfully sent, so no turn ever reached `KALSA_TELEMETRY`
   (`final_logcat.txt` contains no telemetry/governor lines).
7. **Session ended cleanly** (ref-click End Session + Yes + reload + "Ended
   On" verified), data pulled, tunnel closed.

## Fixes already in place for the retry (driver in this folder)

- `thermal_record` basename fix; sampler/driver path unification
  (`/data/local/tmp/kalsa-heat/heat/`); `TYPE_FAST=1` (single full-text
  composer verification instead of per-chunk dumps; ~60–90 s typing at the
  200-rung); arms phase starts with the route-command send (which triggers
  the model load) instead of polling for a prewarm that cannot run.
- Retry needs: minutes ≥ 90 on QRD8650 (pool now 0 — owner can unlock more
  via his documented multi-account path), then `DRIVER_PHASE=arms` with
  `ARM_ORDER=CGGC` (or CGGCGC), deadline a few minutes under the cap.

## Per-arm table

| Pair | Arm | Turn | Status | void_reason | cooldown_s | settle_s | skin_before | skin_after | prefill_ms | engine_prefill | engine_decode | route_push | route_mismatch | chunks_sum | prompt_n | tokens_predicted |
|---:|---|---:|---|---|---:|---:|---:|---:|---:|---|---|---|---|---:|---:|---:|

_(filled from raw/<job>/results.tsv after the run)_

## Pair deltas

| Pair | dT_cpu | dT_gpu | Δ (cpu−gpu) | valid n |
|---:|---:|---:|---:|---:|

## Raw data

`raw/<job_id>/` — logcat dumps, filtered KALSA_* lines, cooldown/settle
series, sampler file (`samples.txt`), results.tsv, adb exit codes, recon.

---

# QRD8750 (Snapdragon 8 Elite / Adreno 830) — owner-approved fallback run

**Everything in this section is 8 Elite data, NOT the Xiaomi SoC.** The QRD8650
pool hit 0 after session 844629; the owner approved using the QRD8750's
remaining minutes. Preregistered 2026-09-25 ~13:10 EDT, BEFORE this session
was opened. Same APK (`aceee960`, sha verified again below), same protocol,
same validity rules; `ARM_ORDER=CG` (one pair), driver deadline a few minutes
under the cap, session ended as soon as the driver exits.

## Plan (fixed before the session)

- Dry-run of the fixed driver on the Mac PASSED end-to-end against a fake-adb
  harness (setup → arms; route-send-first arm order; typing 17 chunks at the
  200-rung with TYPE_FAST single verification; logcat parse of the real
  KALSA_GOVERNOR/KALSA_TELEMETRY formats incl. route fields; results rows OK
  for both C and G). The dry-run caught and fixed two real bugs first:
  `new_chat` matched `Menu`/`Apri il menu` but this APK's hamburger is
  `Open menu`; and the fake exposed that logcat epochs must be device-clock
  consistent (no driver change needed — `shell date +%s` and logcat epochs are
  the same clock on a real board).
- Cap 35 min (smallest that safely contains setup ≈5 min + CPU arm ≈9 min +
  GPU arm ≈8 min with the 240 s settle caps and a cold 2.8 GB load), driver
  deadline 30. At most the 51 available.
- Doze control: single `DRIVER_PHASE=full` invocation — `screen_off_timeout`
  set to 1,800,000 once at start (after a real wake+dismiss+tap), restored
  only by cleanup at driver exit; every UI step re-checks wakefulness and
  wakes via KEYCODE_WAKEUP + `wm dismiss-keyguard` + tap (trap 7).
- Model: expected `qwen3.5-4b` (QRD8750 MemTotal ~16 GB → tier "high"); the
  board's actual recommendation is read from the model bar dump and recorded
  below regardless.
- Skin cooldown gate unchanged (≤37.0 °C, poll 15 s, cap 720 s → VOID `hot`).
- Validity unchanged: route_requested = arm, route_push = applied,
  route_mismatch false, chunk sum within ±5 % of 1024 ([973, 1126]).

## Prediction for QRD8750 (written before the session)

The only same-board-class app-path evidence (S5b run 4, QRD8750, LFM2.5-2.6B
governor app, ~938-token prefill + 128-token decode) had **GPU-routed turns
ending 44.6–45.3 °C skin vs 41.4 °C for the CPU turn — GPU arms ~3.4 °C
warmer**. The 8 Gen 3/Xiaomi prior (CPU hotter on battery) is a different SoC
and is explicitly NOT transferred. CLI same-board rates: GPU pp512 274.5 t/s
vs CPU 107.4 (17B Q4_K) — GPU prefill is a much shorter, higher-power burst
on the Adreno 830 die.

Predictions per arm (skin ΔT = after − before; typing is inside the window
and common-mode; 60 s post-completion tail):

| quantity | CPU arm | GPU arm |
|---|---:|---:|
| prefill_ms (1024 tok, in-app, Qwen3.5-4B Q4_K_M) | 13,000–30,000 | 3,000–7,000 |
| skin ΔT point (range) | +1.0 °C (0.3–2.5) | +2.2 °C (0.8–4.0) |

**Pair contrast CPU−GPU: −1.2 °C (GPU warmer; plausible range −3.0…+0.5)** —
the OPPOSITE sign of the QRD8650/Xiaomi prediction above. Decode is expected
on CPU in both arms. One pair, directional only: no routing conclusion.

## Session — NOT OPENED (pool blocked)

- Minutes before (QRD8750 card): **51**. Availability: **Unavailable** — the
  shared 8 Elite pool had zero free units.
- 2026-09-25 ~13:20–14:20 EDT: the wizard was driven to step 2; BOTH QRD8750
  cards render as `disabled-card` (selection impossible, Next disabled), so
  no session could be created and **no minutes were spent** (card still reads
  "51 min remaining" after the hour; QRD8650 shows "1 min remaining" — too
  little for even setup). The login had NOT expired.
- Launch when a unit frees (owner or next session): create interactive
  session `qdc-heat-per-backend-8750`, cap 35, SSH-only, key `kalsa-mac`,
  QRD8750; tunnel `-L 6037:<host>:5037`; then
  `DRIVER_PHASE=full TYPE_FAST=1 TYPE_LADDER="200 100" bash d_run.sh <job> /Users/marco/kalsa-apks/aceee960/app-release.apk CG 30`
  and end the session as soon as it exits. Prediction above stays locked.

---

# QRD7675 (Snapdragon 7+ Gen 3 / Adreno 732) — app heat arms, 2 pairs

Preregistered 2026-09-25 evening, BEFORE this board's session was opened.
Account note: this lane runs on the ORIGINAL account (the owner account)
— QRD7675 there has 555 min; the new aspis.launcher account lives in the
other agent's isolated browser tab (new-tab creation on the host failed), so
QRD8650 (marco: 1 min left) could not be claimed/run from my surfaces; see
the session log below. New APK `0509f8c8` (sha verified), tools OFF via
`kalsa.web.enabled/tools.device/tools.calendar = "0"`, tools-off probe =
calibration turn with zero KALSA_TOOLCALL. No cool-start gate (owner
decision): per-arm start skin+battery recorded; cooldown only caps the wait
(≤720 s, warm_start flagged).

## Prediction for QRD7675 (written before the session)

No same-SoC heat prior exists for the 732 (SYNTHESIS §1 has speed/correctness
only: GPU pp512 151.8 t/s vs CPU on a weak baseline; FA does not compile).
Transfer reasoning: smaller SoC, slower both backends, longer arms → more
wall time per arm at lower power density; the 8 Gen 3 prior (CPU hotter) and
the 8 Elite prior (GPU hotter) disagree, so this is a genuinely open sign.

- prefill_ms (1024 tok, in-app, Qwen3.5-4B Q4_K_M): CPU 25,000–70,000
  (mid-tier cores); GPU 6,000–12,000 (151.8 t/s class minus app overhead).
- skin ΔT per arm (after − before; typing in-window, common-mode):
  CPU +1.2 °C (0.4–3.0); GPU +1.0 °C (0.3–2.5).
- **Pair contrast CPU−GPU: +0.3 °C (range −1.5…+2.0) — no confident sign.**
- Decode CPU both arms; battery ΔT expected smaller than skin (QDC boards
  report a stub battery). 2 pairs, directional only.

## Session

- Minutes before (QRD7675 card, marco account): _pending_

---

# Retry on the aspis.launcher account — 2026-09-25 evening — ABORTED BEFORE ANY SESSION

Prepared and verified, then blocked at the account gate. **No QDC session was
opened, no minutes were claimed or spent, no device was touched.**

Preparation done (kept for the retry):

- New APK verified: `/Users/marco/kalsa-apks/0509f8c8/kalsa-apk-arm64-v8a-debuggable-0509f8c8c07d1a28fff627e086247c5f6d2b7ec0/app-release.apk`,
  sha256 `855c89de6496b00d0721f981d551842abfd544a26c62d4c3a816028c4b5c91e7`
  (engine v1-1-8: pause at 43 °C, kill at 44 °C). Local model
  `Qwen3.5-4B-Q4_K_M.gguf` re-verified (sha `3874209241…e8630`).
- `d_run.sh`: QRD7675 added to the SOC allowlist (`SM7675|QRD7675 →
  BOARD=7-Gen-3`); it previously exited 6 on any SoC other than SM8650/SM8750.
  `bash -n` clean.
- Predictions: the QRD8650 prediction above (CPU−GPU skin contrast ≈ +1.2 °C,
  CPU hotter) and the QRD7675 prediction above (no confident sign) stay locked
  for the retry; the retry plan is ARM_ORDER=CGGCGCGC on QRD8650 (4 pairs),
  CGGC on QRD7675 (2 pairs), tools OFF, 1024 ±5 % new tokens, cooldown as cap
  only (≤720 s), smallest cap that holds the run, session ended at driver exit.

Block (evidence): after `browser_new_tab` timeouts cleared, a fresh tab on
qdc.qualcomm.com logged in as **66642624+Aspis0@users.noreply.github.com** — device
cards read QRD8650 "1 min remaining", QRD7675 "555 min remaining", QRD8750
"51 min remaining" (the OLD account's balances). The aspis.launcher session
survives only inside the NPU lane's tab (its sessionStorage token; that tab
shows job 845063, kalsa-npu-spec-verify-8750, Completed). The browser's shared
cookie jar is back on the old account — consistent with this lane's own earlier
QRD7675 attempt having logged the profile into marco. Per instruction the lane
STOPs on the old account; the other tab was never touched (read-only snapshots
only), no login form was touched, no password was read, typed or stored.

To unblock: the owner logs into aspis.launcher@gmail.com in a NEW tab of the
Paseo browser (his 2FA email code; the lane never handles credentials), says a
word when done; the lane then re-verifies the account chip before anything
else and proceeds with the plan above.

---

# Account diagnosis and aspis.launcher run — 2026-09-25 ~17:45–EDT

## Why new tabs landed on the old account (diagnosis, measured)

The Okta/sessionStorage hypothesis is **refuted** in its mechanism. The QDC SPA
keeps its access token in JS memory only (no token in localStorage or
sessionStorage), obtained on every page load by `POST
https://oidc-backend.qdc.qualcomm.com/auth-session` with credentials (an
httpOnly BFF cookie on `oidc-backend`). The same credentialed POST, issued at
the same moment from the two open Paseo tabs, returned **aspis.launcher** in
tab `4e7a3b7e` and **the owner account** in tab `c969cc68` (only the email
claim was read, never a token). Same URL, same instant, different identities ⇒
**the Paseo browser gives these tabs separate cookie jars**. A reload inside
`4e7a3b7e` stayed on aspis (the NPU lane reloaded it repeatedly). So the aspis
session lives in that tab's cookie jar, and a fresh tab gets a jar that holds
the old account's session. No logout, no password, no login form was touched.

Fix used: option (a). Once the NPU lane (agent e9a4485a) finished (session
845063 Completed, QRD8635 never started, agent idle), this lane took tab
`4e7a3b7e` over and navigated by clicking. The account chip read
aspis.launcher@gmail.com throughout.

To make a NEW tab land on aspis (owner, only if ever needed): log in as
aspis.launcher inside that new tab; or keep using tab `4e7a3b7e`.

## Minutes (aspis account)

- Claimed with "Claim Offer" (questionnaire: app = Kalsa on-device LLM chat
  app, goal = Optimize my application): **QRD8650 0 → 1000**, **QRD7675 0 → 1000**.
- Before the session: QRD8650 **1000**, QRD7675 **1000** (Unavailable), QRD8750 994.

## Driver fixes made before/during this run

1. `ADB_PORT` override (6037|6039 only). Port 6037 was held by a LOCAL adb
   server (pid 13821, started 12:19 EDT right after session 844629), which
   sees the S23 over adb-tls. Left untouched; this run used tunnel port 6039.
2. SoC allowlist moved BEFORE `configure_screen`: previously the driver wrote
   `screen_off_timeout` to whatever device answered first, before checking
   it was a QDC board (a failed tunnel + auto-started local server could have
   targeted a local phone).
3. **Root cause of 844629 and of this lane's first attempt (sa849155):** the
   `qwen3.5-4b` registry entry declares `mmproj-F16.gguf` (672,423,616 B);
   `isModelBundleDownloaded()` refuses the bundle without it, the composer
   phase becomes `unloaded` ("Held: the model has to be loaded again") and
   `canSend=false` — the route-command Send tap is a no-op, so no turn and no
   KALSA_* line ever appears. The model sheet showed "Download 3.5 GB". The
   driver only copied the GGUF. Fixed: `mmproj_setup` (push + run-as copy +
   exact-size check).

## QRD8650 session

- Interactive session **845086** `qdc-heat-per-backend-8650-aspis`, unit
  `sa849155`, serial `cacfeec9` (SM8650), SSH-only, key `kalsa-mac`, "Screen
  Always On" toggled (board reported `mStayOn=true`), cap **115 min**.
  Submitted 17:56:58, Started 17:58:33 EDT.
- Attempt 1 (`raw/sa849155/`): setup OK (skin0 30.675 °C), calibration
  `NO_TELEMETRY` after 480 s → driver exit `calib_fail` (cause 3 above).
- Attempt 2 (`raw/sa849155b/`): relaunched with the mmproj fix, ARM_ORDER
  CGGCGCGC, deadline 89 min (cap end 19:53:33).
- Attempt 2 (`raw/sa849155b/`): setup OK (skin0 35.518 °C); the model now
  loaded (`KALSA_PREWARM done promptN=502`), Send enabled, route command sent
  18:23:36 — then the calibration hung waiting for telemetry. **Second driver
  defect:** `bench:route` is intercepted by `runBenchTurn`
  (`src/host/benchTurn.ts`: "never calls the model"), so it can never emit
  KALSA_TELEMETRY; `calibrate_turn`, the smoke path and every arm polled for
  one after the route send. Driver stopped (exit_143). Fixed: the three
  polls became `sleep 3` (the arm's own KALSA_GOVERNOR `route_requested`
  already validates the route).
- Attempt 3 (`raw/sa849155c/`): setup OK (skin0 38.405 °C); the READY
  calibration turn completed (KALSA_TELEMETRY prompt_n 15, 254 tokens
  predicted, 9.7 tok/s; KALSA_TOOLCALL toolChoice none, structuredCalls 0,
  executed 0 — **tools OFF confirmed**; the driver's `tool_calls=1` counts the
  KALSA_TOOLCALL LINE, not calls — driver bug, harmless here). But the turn's
  KALSA_GOVERNOR read `engine_prefill:"CPU"`, `prefill_ctx_ngl:0`,
  `fallback_reason:"governor not eligible"`, `route_requested:null`,
  `route_push:"skipped"` → `chunks_sum=na` → CALIB_FAIL at 18:38:40.

## BLOCKER (app build 0509f8c8) — the preregistered arms cannot be validated

`src/engine/LlamaService.ts:2433-2441` (at 0509f8c8): `governorLoad` requires
`!options.mmprojPath`; `src/host/engineEnsureLoad.ts:158` passes
`mmprojPath` for EVERY model whose entry declares an `mmproj`, unconditionally.
`qwen3.5-4b` declares one, and `isModelBundleDownloaded()` refuses the model
without it. So for Qwen 3.5 4B the governor is never eligible, the route
request is never pushed, and no arm can ever satisfy `route_requested = arm,
route_push = applied, route_mismatch = false` — on ANY board, this build.
(Product note for the owner: the high-tier recommended model never runs
under the governor in this build.)

Not done, because it changes the preregistered protocol (owner's call):
running the arms on a model without an mmproj (e.g. the shipping LFM), which
also needs a new tokenizer calibration and new predictions. The QRD7675 lane
was NOT started: same model, same blocker (its card is also Unavailable).

## Accounting (aspis account)

- Session 845086: Started 17:58:33, Ended 18:39:36 EDT (Completed,
  portal-verified after reload) = 41 min 3 s. Portal "Total Minutes Used" 0
  (log upload pending).
- **QRD8650: 1000 before → 885 after = 115 billed = the full requested cap**
  (41 min actually used). Cap billing re-confirmed for mobile boards.
- QRD7675: 1000 → 1000 (no session). QRD8750: 994 (untouched by this lane).
- Tunnel on 6039 closed; the local adb server on 6037 (pid 13821, sees the
  S23) was left alone.

## Result

Valid arms: **n = 0** on QRD8650, not run on QRD7675. Both preregistered
predictions (QRD8650 CPU−GPU ≈ +1.2 °C, QRD7675 no confident sign) remain
UNTESTED. Per-arm table and pair deltas: empty.

Start temperatures recorded (skin HAL, per setup): 30.675 (attempt 1),
35.518 (attempt 2), 38.405 °C (attempt 3).

---

## LFM retarget (2026-09-25)

Owner decision: heat arms move to the shipping LFM2.5-2.6B (its catalog entry
declares no mmproj, so `governorLoad`'s `!options.mmprojPath` — LlamaService.ts:2433
at 0509f8c8 — stays true and `route_push` can finally be `applied`).

**What changed (cell `d_run.sh` / `parse.sh`, this session):**

- Defaults now LFM, **measuring the shipped config (coordinator decision
  2026-09-25)**: `MODEL=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`,
  `MODEL_SIZE=1593894944`, `MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`
  (sha256 recomputed here; size equals `ModelRegistry.ts:279 sizeBytes: 1_593_894_944`
  exactly), `MODEL_DIR=lfm2.5-2.6b` = the app catalog id
  (`src/engine/ModelRegistry.ts:272  id: "lfm2.5-2.6b",`), `MODEL_FILE` =
  `ModelRegistry.ts:278 file: "LFM2.5-2.6B-QAD-Q4_0.gguf"`. Q4_K_M is no
  longer a default (explicit `MODEL`/`MODEL_FILE`/`MODEL_SIZE`/`MODEL_SHA` only).
  Qwen stays reachable
  via env: `MODEL_DIR=qwen3.5-4b MODEL_FILE=Qwen3.5-4B-Q4_K_M.gguf MMPROJ=/Users/marco/kalsa-qdc/models/mmproj-F16.gguf`
  (size/sha/mmproj defaults key off MODEL_FILE).
- `MMPROJ` is empty by default; `mmproj_setup` returns 0 before any copy/size
  check and logs `MMPROJ_SKIP` (parse.sh). Qwen runs still do the full mmproj
  push + run-as copy + exact-size check.
- Calibration is board- and tokenizer-side as before: `calibrate_turn` recomputes
  N0 per run from the READY turn's `KALSA_GOVERNOR` chunks_sum — no Qwen number
  is reused. The Qwen-frozen part was the `prompt-<n>.txt` labels (token counts
  under the Qwen tokenizer); the driver now counts each variant against `$MODEL`
  with `llama-tokenize` (`variant_tokens`, label fallback, `PROMPT_VARIANTS`
  env). Validated: labels reproduce 727/786/841 on Qwen3.5-4B, and read
  **799/863/922 on LFM2.5 with both quants (Q4_K_M and the default QAD-Q4_0 —
  same tokenizer)** — stale labels would have overshot the 1024 window.

**App-side check (quoted):** directory matches — `ModelDownloader.ts:19
MODELS_DIR = \`${FileSystem.documentDirectory ?? ""}models/\`` + `:82 return
${MODELS_DIR}${model.id}/${file}` = `files/models/lfm2.5-2.6b/`, the same target
`model_setup` run-as copies to (parse.sh:85), and the engine loads
`initEngine(modelLocalPath(model, model.file), ...)` (engineEnsureLoad.ts:219).
**File-name gate (resolved):** `isModelBundleDownloaded`
(ModelDownloader.ts:163) → `verifyFileForPresence` (:204) demands exact name+size
(`isFileComplete`, :111): the Q4_K_M file (1,674,455,040 B) would have failed that
gate on APK 0509f8c8 → the same "Held" composer deadlock as the mmproj, and
`MODEL_LOAD_PATTERN` (from MODEL_FILE) would have missed the loader line. The
coordinator therefore switched the default to the catalog file itself:
`/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf` (sha256 and size
verified above), so name+size now satisfy the gate and the load-proof pattern
matches the path `initEngine` loads (engineEnsureLoad.ts:219). Still not
verified on a device: no device, no QDC session, no browser in this retarget.

**Dry-run (fake adb, Mac only): EXIT=0.** `raw/dryrun-lfm-qad-driver.log` —
`MMPROJ_SKIP`, `CALIB_DONE N0=250 variant=727 tokens=799 total_estimate=1049 chars=3027`,
both arms OK, device-side copy stat 1593894944, `END reason=exit_0`.
(The earlier Q4_K_M-default run `raw/dryrun-lfm-driver.log` and the Qwen-via-env
regression `raw/dryrun-qwen-driver.log` also exited 0; Qwen reproduced
variant=786 tokens=786 total=1036 chars=3266 with the mmproj checks exercised.)

---

# Audit e662b9fb fixes — live thermo safety, calibration band, prompt pin (2026-09-25 night)

Scope: defects F1, F2, F3, F5, F6, F9, F10 of hostile audit e662b9fb (F1 and
F5 were coordinator-verified first). The session started from an uncommitted
partial fix by a previous coder; what matched the audit was kept (the 30-column
results printf, the band check, the missing_failed gate, `safety.sh`,
`restore.sh`), what was wrong was corrected, what was missing was added.
`parse.sh` (~944 lines) is pre-existing excess, declared, not refactored; all
new logic went to `safety.sh` (one responsibility: live thermo and stops).

## What changed, per defect

- **F1 (frozen bench thermo).** `make_thermo` (old parse.sh:178, wrote
  `batt_level_pct:100`, `plugged:false`, skin fixed at session start) is gone.
  `safety.sh` re-reads `dumpsys thermalservice` + `dumpsys battery` before
  EVERY model turn (`safety_gate setup` at d_run.sh:248, `safety_gate calib`
  at :269, `safety_gate armN` in run_arm step 5, plus `safety_stops` at arm
  entry) and pushes a fresh `kalsa.bench.thermo` through `set_prefs` with live
  skin (in `batt_temp_tenths_c`, same field the frozen profile filled), the
  real `batt_level_pct` and the real `plugged` — readGovernorThermo prefers
  this profile over the sensor (governorInputs.ts:259-263), so the engine's
  pause/kill and low-battery paths now see current values. Driver stops log
  `STOP reason=...`, write `END reason=stop_*` and exit 0 (a stop is the
  safety policy working, not a driver error): skin >= 44 C, thermal status >= 3,
  battery temperature >= 44 C, battery level <= 25 %, plugged = true
  (safety.sh:47-56). Two traps fixed while wiring it: (a) skin is now taken
  from the `Current temperatures from HAL` section only (safety.sh:34) — the
  un-gated sed matched `Cached temperatures` first, which trailed the live
  value by 8.0 C in raw/sa849155c/session_pre_thermal.txt (30.361 cached,
  line 36, vs 38.405 HAL, line 45); (b) a missing battery level aborts the
  gate (`NO_LIVE_BATT_LEVEL`, safety.sh:72) instead of writing a fabricated
  100 % back into the profile.
- **F2 (band abort).** `CAL_TOTAL` must lie in [973, 1075] (= 1024 ±5 %)
  after variant selection and before any arm: `CALIB_BAND_FAIL`, END
  `calib_band`, exit 3 (d_run.sh:298). The old parse.sh band text said 1126
  (wrong arithmetic); row validity uses the same [973,1075] (parse.sh:927).
- **F3 (arms send the calibrated variant).** The neutered `.cp` dance is gone:
  the chosen variant is copied to `PROMPT.txt`, `PROMPT.meta` is re-pinned
  (sha256 + byte count), and `PROMPT_TEXT` is reloaded through the same
  `load_prompt` a `DRIVER_PHASE=arms` invocation uses (d_run.sh:301-308) —
  setup/full and arms invocations now send one identical text.
- **F5 (printf fields).** The row printf has 30 `%s` for the 30-column header
  (parse.sh:939-944); checked column by column against the header in the dry
  run (both NF=30, every value in its column).
- **F6 (battery columns).** `batt_before/batt_after` held the temperature;
  they are now `batt_temp_before/batt_temp_after`, and `batt_level` +
  `plugged` are separate columns filled from the live reading taken at the
  pre-turn gate.
- **F9 (tokens of the exact text sent).** `variant_tokens` reads the text on
  stdin; the caller builds it exactly as the composer will receive it
  (`tr '\n' ' '` then strip one trailing space): `load_prompt` now stores the
  stripped text in `PROMPT_TEXT` (d_run.sh:39), so counted == typed. Proven
  in the dry run: typed bytes == counted bytes (3027) -> 798 tokens on
  LFM2.5-2.6B-QAD-Q4_0.
- **Validity.** `failed="na"` voids the row with `void_reason=missing_failed`;
  the gate runs last inside the validity block, so it overwrites the reasons
  the gates above recorded (parse.sh:929-935).
- **Load proof.** `poll_load`/`has_load_proof` existed in HEAD but were dead
  (`run_smoke` was never called). They are now wired into the setup block at
  d_run.sh:271-276 — but BEFORE `calibrate_turn`, because the engine
  eager-loads at app start (device evidence:
  s23-heat-cpu-vs-gpu-v2/raw/arm-stream-logcat.txt: `Running "main"` ->
  `engine.eagerInit` -> `llama_model_loader` within 1 s), so the loader line
  is in the buffer only until `clear_anchor` wipes it; placed after the anchor
  a fresh session never loads again and poll_load would abort every real run.
  The log records which GGUF the engine opened (`LOAD_PROOF ...`); unless the
  line names `files/models/$MODEL_DIR/$MODEL_FILE`, setup aborts (END
  `load_proof`, exit 3). `DRIVER_PHASE=setup` sends no turn, so it logs
  `LOAD_PROOF_DEFERRED`; the full phase gates before any arm.
- **Dead code deleted:** `smoke_turn` + `run_smoke` (unused in HEAD),
  `device_tag`, `ttft`.
- **F10 `restore.sh` (documented here):** after ANY abnormal end (SIGKILL,
  crash, session abort) run `bash restore.sh` (ADB_PORT/ADB_BIN overridable,
  as in d_run.sh). It undoes every device change d_run.sh makes:
  `svc power stayon false`, the pre-run `screen_off_timeout`,
  `locksettings set-disabled false` (keyguard re-enabled), and the sampler
  (stop file + pkill). Exit 0 = all restores succeeded, nonzero = at least
  one adb command failed (the `rc=` line says which state was attempted).
  The normal end already restores via the driver's EXIT trap (`restore_device`).
  Caveat: on a safety STOP the device-side `samples.txt` is not pulled (the
  pull sits at the normal end of d_run.sh:331); it survives until the next
  run's `launch_sampler` truncates it, so pull it manually before rerunning
  if the aborted session's samples matter.

## `.restore-state` — runtime state, NOT in git

`d_run.sh:215` writes `$OUT/.restore-state` (`SER`, pre-run
`SCREEN_OFF_TIMEOUT`) right after `configure_screen`, so a recovery is possible
even if the process dies before its EXIT trap runs. It is runtime state —
rewritten on every run, only read by `restore.sh` — so it is added to the repo
`.gitignore` and never committed.

## Dry-run fixtures (fake adb; Mac only — no device, no QDC, no browser)

Harness now committed as `dryrun-adb.sh` (the old /tmp copy is a symlink to
it); canned dumps + state in `/tmp/kalsa-dry` (RKStorage, logcat-cal/cpu/gpu).
Reset state before each run:
`rm -f /tmp/kalsa-dry/state/{typed,last_route,drawer,therm_calls}`.
Common command shape (REPORT line 248 + fake adb + skipped sampler):

```
ADB_BIN=/tmp/kalsa-dry/bin/adb SKIP_SAMPLER=1 DRIVER_PHASE=full \
  TYPE_FAST=1 TYPE_LADDER="200 100" bash d_run.sh <job> <apk> CG 30
```

| fixture | extra env | expectation | EXIT |
|---|---|---|---|
| `dryrun-fix-full` | — | LOAD_PROOF before calib, CALIB_DONE N0=250 variant=727 tokens=798 total=1048, both arms OK, results NF=30 both rows, `END reason=exit_0` | 0 |
| `dryrun-fix-skin` | `DRY_SKIN_AT=6 DRY_SKIN_AFTER=44.5` | skin crosses 44 C at the pre-turn gate: `STOP reason=skin`, `END reason=stop_skin`, no arm row | 0 |
| `dryrun-fix-band` | `PROMPT_VARIANTS=841` | `CALIB_BAND_FAIL total=1171`, `END reason=calib_band`, zero arm files (aborted before any arm) | 3 |
| `dryrun-fix-batt` | `DRY_BATT_LEVEL=20` | `STOP reason=battery_level` at the setup gate, `END reason=stop_battery_level` | 0 |
| `dryrun-fix-arms` | `DRIVER_PHASE=arms` | pinned PROMPT.txt/meta loaded and sent (F3/F9), both arms OK, NF=30 | 0 |
| `restore.sh` | `ADB_BIN=/tmp/kalsa-dry/bin/adb` | `restored serial=dryserial ... rc=0` | 0 |

`bash -n` clean: d_run.sh, parse.sh, safety.sh, restore.sh, smp.sh,
dryrun-adb.sh.

## Not verified (no device, no QDC, no browser)

- The stops, the HAL-only skin read and the load-proof placement never ran on
  a real board; the supporting evidence is historical device output
  (sa849155c session_pre thermal dump, the S23 launch logcat), not a live
  QDC session. `Thermal Status:` parsing matches raw/sa849155c/
  session_pre_thermal.txt:10, but a status >= 3 was only exercised through
  the fake.
- Prewarm `op:done` landing inside the poll_load window on a fresh QRD8750
  session (S23 evidence: +24 s after launch) is expected but unconfirmed.

---

# Re-audit 39c2dde6 fixes — mid-turn safety, strict readings, load-proof restore (2026-09-25, late)

Scope: items (a)-(d) of re-audit 39c2dde6 against commit `091bf0ac`, nothing
else. The plugged stop stays: all 31 real QDC battery dumps in this repo read
`AC powered: false` / `USB powered: false`.

- **(a) Mid-turn safety.** `poll_until_telemetry` (parse.sh:370-395) now, while
  waiting for telemetry: every ~30 s runs `safety_stops` (live readings +
  all hard stops) and `thermo_refresh midturn` (safety.sh:83) — the same
  rebuild+`set_prefs` push `safety_gate` does, so an engine that re-reads the
  pref mid-turn sees live temperature; and it enforces a per-turn wall cap
  `TURN_WALL_CAP_S` (default 900 s, d_run.sh:89; the turn's clock starts at
  parse.sh:893 before `ui_send`). Cap hit → return 2 → the row is
  voided `void_reason=turn_timeout`, the app is force-stopped
  (parse.sh:908-917, evidence `<prefix>_turn_timeout.txt`), and the run
  continues to the next arm's gates. The refresh label is `midturn`
  (`$RAW/safety_midturn_prefs.txt`).
- **(b) Fail-open readings gone.** `require_numeric` (safety.sh:51) runs first
  in `hard_stops`: a missing/non-numeric skin, thermal status, battery
  temperature or battery level ends the session with
  `STOP reason=missing_<name>` (END `stop_missing_<name>`). The old `:-0` /
  `:-100` defaults of 091bf0ac (safety.sh:48-55) and the `:-100` inside the
  profile are
  removed, so `thermo_refresh` can only run on validated readings —
  `sensor_valid:true` never rests on a bad reading (it is only ever called
  right after `safety_stops`).
- **(c) Load proof.** `PREWARM_PATTERN` (parse.sh:97) accepts
  `op:"restore", ok:true` as well as `op:"done"` (KV-snapshot restore logs no
  `done`: LlamaService.ts:1328-1333). The anchor is now cleared BEFORE
  `app_foreground` (d_run.sh:275): poll_load only accepts lines from this
  launch (stale buffer lines cannot pass it), while clearing *after* the
  app start would erase the eager load's loader line — the one line the proof
  needs; that ordering trap is in the comment.
- **(d) Leftovers.** `session_stop` force-stops the app before exiting
  (safety.sh:20-28). The sampler stops on EVERY exit path: the
  `STOP_SAMPLER_ON_EXIT` flag is deleted, `cleanup` (d_run.sh:187) calls
  `stop_sampler` unconditionally, and `stop_sampler` (d_run.sh:175) touches
  the device-side stop file even when `SAMPLER_PID=0` (a sampler orphaned by
  an earlier invocation); `ensure_sampler` relaunches it on the next phase.
  `restore.sh` additionally force-stops the app (line 30, before the DB edit)
  and runs `bench_prefs_clear` (line 46), the same pull-edit-push round trip
  as `set_prefs`, deleting the driver's bench prefs —
  **`kalsa.bench.thermo`, `kalsa.bench.governor_force`, `kalsa.bench.sampling`,
  `kalsa.bench.toolchoice`** (whole `kalsa.bench.%` namespace).
  The other driver-set keys (`kalsa.model.id`, `kalsa.governor.enabled`,
  `kalsa.web.enabled`, `kalsa.tools.device`, `kalsa.tools.calendar`) are
  ordinary app settings, not bench overrides, and no pre-run value was
  recorded for them, so they stay. Verified locally against the fixture DB:
  after the DELETE only `kalsa.governor.enabled` of a seeded set remained
  (SQL roundtrip EXIT=0).

## Dry-run fixtures (fake adb; Mac only — no device, no QDC, no browser)

State reset before each run:
`rm -f /tmp/kalsa-dry/state/{typed,last_route,drawer,therm_calls,tel_ready_at}`.
Harness knobs added to `dryrun-adb.sh`: `DRY_THERMAL_STATUS` set empty = no
status line; `DRY_TELEMETRY_DELAY_S` holds telemetry/governor lines back after
the prompt is typed; `DRY_PREWARM=restore` serves only restore-style proof
(zero `op:"done"` lines in the served buffer).

| fixture | extra env | expectation | EXIT |
|---|---|---|---|
| `dryrun-fix-midturn-skin` (new) | `DRY_TELEMETRY_DELAY_S=45 DRY_SKIN_AT=8 DRY_SKIN_AFTER=44.5` | `STOP reason=skin` from the poll at the ~30 s mid-turn check, `END reason=stop_skin`, results header only | 0 |
| `dryrun-fix-missing-status` (new) | `DRY_THERMAL_STATUS=` | `STOP reason=missing_thermal_status`, `END reason=stop_missing_thermal_status` | 0 |
| `dryrun-fix-restore-turn` (new) | `DRY_PREWARM=restore DRY_TELEMETRY_DELAY_S=50` | `LOAD_PROOF` with 0 `op:"done"` lines in the proof file, `THERMO_REFRESH label=midturn` + `safety_midturn_prefs.txt`, both arms OK NF=30 | 0 |
| `dryrun-fix-turn-timeout` (new) | `TURN_WALL_CAP_S=60 DRY_TELEMETRY_DELAY_S=999` | `TURN_TIMEOUT after 60s` + `TURN_TIMEOUT_VOID`, both rows `INVALID void=turn_timeout`, `<prefix>_turn_timeout.txt` written, next arm's gates still ran | 0 |
| `dryrun-fix-full` | — | LOAD_PROOF, CALIB_DONE, 2 OK rows NF=30, END exit_0 | 0 |
| `dryrun-fix-skin` | `DRY_SKIN_AT=6 DRY_SKIN_AFTER=44.5` | pre-turn `STOP reason=skin` | 0 |
| `dryrun-fix-band` | `PROMPT_VARIANTS=841` | `CALIB_BAND_FAIL total=1171`, no arm files | 3 |
| `dryrun-fix-batt` | `DRY_BATT_LEVEL=20` | `STOP reason=battery_level` | 0 |
| `dryrun-fix-arms` | `DRIVER_PHASE=arms` | 2 OK rows NF=30 | 0 |
| `restore.sh` | `ADB_BIN=/tmp/kalsa-dry/bin/adb` | `... app=force-stopped bench_prefs=removed rc=0` | 0 |

`bash -n` clean: d_run.sh, parse.sh, safety.sh, restore.sh, smp.sh,
dryrun-adb.sh.

## Not verified (no device, no QDC, no browser)

- Mid-turn stops/refresh, the wall cap and the restore-only proof never ran
  on a real board; the restore pattern is taken from app source
  (LlamaService.ts:1328-1333), the mid-turn and timeout paths only from the
  fake.
- `restore.sh`'s DB round trip mirrors `set_prefs` but was only executed
  against the fixture RKStorage, not a device database.

---

# LFM heat arms on QDC (2026-09-26) — NOT OPENED (browser host disconnected)

**No QDC session was requested, no minutes spent, no device touched.**

- Pre-flight OK: APK `0509f8c8` sha256 `855c89de…5c91e7` (matches line 296);
  model `LFM2.5-2.6B-QAD-Q4_0.gguf` sha256 `a247afd6…8b40b03` (matches d_run.sh:77);
  `llama-tokenize` present; local adb server still on 6037 (pid 13821) → tunnel must use 6039.
- Block: tab `4e7a3b7e-a2a7-4d6f-8452-09c65b9e172e` (the aspis.launcher login) answers
  `browser_no_host: The app hosting browser tab … disconnected` (3 tries); `browser_list_tabs`
  returns no tabs for this workspace. Portal not reachable → minutes not read, cap not requested.

## Cap arithmetic (driver's own constants, for the retry)

Per warm arm: cooldown cap 720 s (d_run.sh:87) + settle cap 240 s (:88) + route/new-chat
~60 s + safety_gate set_prefs ~30 s + typing 3,027 chars at 200/chunk ~90 s + turn ~60 s +
tail 60 s + dumps ~20 s ≈ 1,280 s ≈ 21.5 min. Both caps are expected to be hit after every
hot turn: QRD8650 S5b run 8 B2 still read 38.49 °C at 900 s (qdc-governor-s5b/REPORT.md:191).
First arm (cold, no wait) ≈ 5.5 min. Setup (install, bootstrap, 1.59 GB push ~75 s + sha,
copy) + load proof + calibration ≈ 10 min.
- QRD8650, 8 arms: 10 + 5.5 + 7 × 21.5 ≈ 166 min driver time → cap ≈ 166 + 5 (tunnel/end) = 171.
  **The driver refuses deadlines > 110** (d_run.sh:13), so 4 pairs cannot fit one run as-is;
  deadline 110 / cap 115 holds ≈ 5 arms (2 full pairs).
- QRD7675, 4 arms: 10 + 5.5 + 3 × 21.5 ≈ 80 min → deadline 80, cap 85.
- Risk that makes a large cap wasteful: `run_arm` calls `safety_stops` at arm entry, BEFORE
  cooldown (parse.sh:851); S5b 8650 turns ended at 43.2 / 47.4 °C skin (PREREG-LFM.md:25-26),
  so a skin ≥ 44 at the next arm's entry ends the session (by design, not loosened).

## Pre-run observations (not fixed; no failure occurred yet)

- Pair label: d_run.sh:332 increments PAIR on every arm change, so CGGCGCGC labels pairs
  1,2,2,3,4,5,6,7. Data unaffected; pair = ceil(turn/2) must be used in analysis.
- PREREG-LFM.md:17 says chunk band [973, 1126]; driver and brief use [973, 1075] (parse.sh:957).
- restore.sh:51,54 tests `databases/RKStorage-wal|shm` without `run-as` (always false →
  WAL not pulled before the DELETE).
- smp.sh:25 greps the first skin value without the HAL-section gate (can read the cached value);
  informational sampler only.

To unblock: owner reconnects the Paseo browser host / re-opens the aspis.launcher tab, and
decides between cap 115 (deadline 110, ~2 pairs) and raising the 110 guard (cap ~171).

---

# Owner decision (2026-09-26) — stop set, pair numbering, session split

Applied on top of `930d9737`, addressing the QDC runner's pre-run observations
(d3f85707, "Pre-run observations" block). No session was open when these were
made; no data exists yet.

- **Stops (owner's list, nothing else).** The driver-level `skin >= 44 C`
  stop is removed — it was a coordinator invention, not the owner's rule.
  Kept (safety.sh:55-69): thermal status >= 3, battery temperature >= 44 C,
  battery level <= 25 %, plugged = true, and the fail-closed
  `missing_<name>` stops for every reading (skin included — the profile's
  `batt_temp_tenths_c` carries skin, so a bad skin read still fails closed).
  Skin is recorded everywhere (results columns, thermo profile) and reaches
  the engine's unchanged **pause 43 / kill 44** through the bench profile;
  the profile construction (`thermo_refresh`) is untouched.
- **Stop check moved after the wait.** The per-arm `safety_stops` ran at arm
  entry, BEFORE the cooldown/settle wait (old parse.sh:851), so a board that
  the wait could still cool ended the session instead. It now runs right
  after step 4 settle (parse.sh:884-888); `safety_gate` re-checks before
  typing and the poll keeps checking every ~30 s with the new stop set.
- **Pair numbering.** Old d_run.sh:332 incremented `PAIR` on every arm change
  → CGGCGCGC labelled 1,2,2,3,4,5,6,7. Now `pair = ceil(turn/2) + (PAIR_START-1)`
  (d_run.sh:337-339): default CGCG → 1,1,2,2; `PREV_ARM` machinery removed.
  `PAIR_START` is validated like the other args (non-integer or < 1 → exit 2).
- **`PAIR_START` = the session split (deadline stays 110).** Owner chose two
  QRD8650 sessions of ~115 min, 2 pairs each, order per PREREG: session 1 =
  pairs 1-2 (`ARM_ORDER=CGGC`, `PAIR_START` unset → 1), session 2 = pairs 3-4
  (`ARM_ORDER=GCGC`, `PAIR_START=3`) - the halves of PREREG-LFM's CGGCGCGC
  (coordinator correction: CGCG was not the preregistered order). `validate_deadline_minutes` still caps
  at 110 (d_run.sh:13) — unchanged, as decided.
- **`restore.sh` WAL/SHM test fixed** (restore.sh:53-57): the `test -f` now
  runs under `run-as` like the `cat` beside it; without it the test always
  said "not found" (runner's d3f85707 finding) and the WAL was never pulled
  before the DELETE.
- **`smp.sh` skin read gated** (smp.sh:25-27): same HAL-section-only
  `sed -n '/Current temperatures from HAL/,/Current cooling devices from HAL/p'`
  gate as safety.sh. Proven against the real dump: ungated grep returns the
  cached 30.361 °C, gated returns the HAL 38.405 °C
  (raw/sa849155c/session_pre_thermal.txt).
- **PREREG band amended, predictions untouched.** `PREREG-LFM.md` now ends
  with "Pre-run amendment (2026-09-26)": band **[973, 1075]** (±5 % of 1024);
  the earlier 1126 was +10 % and contradicted the same bullet's stated ±5 %.
  Written before any LFM run (the 2026-09-26 session was never opened).

## Dry-run fixtures after the stop-set change

State reset before each run:
`rm -f /tmp/kalsa-dry/state/{typed,last_route,drawer,therm_calls,tel_ready_at,batt_calls}`.
Harness knob added: `DRY_BATT_TEMP_AT`/`DRY_BATT_TEMP_AFTER` (battery-temp
crossing after N dumps).

| fixture | env / order | expectation | EXIT |
|---|---|---|---|
| `dryrun-fix-skin47` (replaces fix-skin) | `DRY_SKIN_AT=6 DRY_SKIN_AFTER=47`, `C` | skin 47 at the pre-turn gate does NOT stop: 0 STOP lines, `THERMO_REFRESH label=arm1 skin=47`, 1 OK row, `END exit_0` | 0 |
| `dryrun-fix-batt-temp` (new) | `DRY_BATT_TEMP=445`, `C` | `STOP reason=battery_temp`, `END stop_battery_temp` | 0 |
| `dryrun-fix-midturn-batt` (replaces midturn-skin) | `DRY_TELEMETRY_DELAY_S=45 DRY_BATT_TEMP_AT=5 DRY_BATT_TEMP_AFTER=445`, `C` | `STOP reason=battery_temp` at the ~30 s mid-turn check, `END stop_battery_temp`, header-only results | 0 |
| `dryrun-fix-pair-start` (new) | `PAIR_START=3`, `CGCG` | rows pairs **3,3,4,4** (turns 1-4), all OK NF=30 | 0 |
| `dryrun-fix-full` | `CG` | pairs **1,1** (was 1,2 — numbering fix visible), 2 OK rows | 0 |
| `dryrun-fix-band` | `PROMPT_VARIANTS=841` | `CALIB_BAND_FAIL total=1171` | 3 |
| `dryrun-fix-batt` | `DRY_BATT_LEVEL=20` | `STOP reason=battery_level` | 0 |
| `dryrun-fix-missing-status` | `DRY_THERMAL_STATUS=` | `STOP reason=missing_thermal_status` | 0 |
| `dryrun-fix-arms` | `DRIVER_PHASE=arms`, `CG` | pairs 1,1, 2 OK rows NF=30 | 0 |
| `restore.sh` | fake adb | `app=force-stopped bench_prefs=removed rc=0` (run-as WAL tests now taken) | 0 |
| `PAIR_START=abc` / `PAIR_START=0` | arg validation | rejected before any adb call | 2 / 2 |

`bash -n` clean: d_run.sh, parse.sh, safety.sh, restore.sh, smp.sh,
dryrun-adb.sh.

## Not verified (no device, no QDC, no browser)

- The owner's stop set and the moved check never ran on a board; the
  battery-temp stop and the mid-turn path were proven against the fake only.
- `restore.sh`'s run-as WAL/SHM test could not find a real WAL to pull (the
  fixture DB has none); the command form mirrors `run_as_retry` (parse.sh:34).
- `smp.sh`'s gated read is validated on a captured dump, not a live sampler.

---

# LFM heat arms on QDC (2026-09-26)

Account verified from the page before anything else: tab `3774c340`, `auth-session` email claim
and account chip = **aspis.launcher@gmail.com** (no credential typed or read).

## Cap arithmetic (written before requesting session 1)

Owner decision: QRD8650 in two sessions, 2 pairs each, cap ~115 / driver deadline 110.
Expected driver time for 4 arms (constants d_run.sh:87-89): setup+load proof+calibration
≈ 10 min + cold first arm ≈ 5.5 min + 3 warm arms × 21.5 min (720 s cooldown cap + 240 s
settle cap + ~5.5 min active) ≈ **80 min**. The remaining 30 min of deadline absorb the
driver's own retry caps (typing rung cap 400/700 s, turn wall cap 900 s) — one retry ladder
or one slow turn fits, two do not. Cap = 110 deadline + ~4 min tunnel/start + ~1 min end
= **115 min requested**.
Portal before session 1: QRD8650 **957 min** remaining (Available Now; was 885 after 845086 —
the portal later credited 72 min back, unexplained), QRD7675 1000 (Unavailable), QRD8750 994.

## QRD8650 session 1 — QDC 845459, unit sa849528, serial 7b5f6c52 (SM8650, Android 14 userdebug)

`qdc-heat-lfm-8650-s1`, SSH only, key kalsa-mac, Screen Always On, cap 115. Submitted 23:43:07,
Started 23:44:22, Ended 01:23:25 EDT (Completed, portal-verified after a second End→Yes) = 99 min 3 s.
**QRD8650 card 957 → 842 = 115 billed = the full cap.** Tunnel `-L 6039:sa849528…:5037` (6037 held by
the local adb server, left alone). Four driver runs inside the one session:

| run | outcome | cause / action |
|---|---|---|
| `sa849528` | `STOP reason=plugged` at the setup gate, 23:47:00, no turn | `dumpsys battery` = `(UPDATES STOPPED)`, `AC powered: true`, level 100, temp 250 — an injected battery override, not real power (`stop_battery_dump.txt`). `dumpsys battery reset` → real HAL: `AC powered: false`, sysfs `battery/status=Discharging`, `battery/temp=250` (stub, constant; `battery_after_reset.txt`, `power_supply_sysfs.txt`). Stop set untouched; device reset only. |
| `sa849528b` | `TOOLS_NOT_OFF tool_calls=1` after calibration | driver counted KALSA_TOOLCALL **lines**; the line read `toolChoice:"none","structuredCalls":0,…,"executed":0`. Also N0=15 (tokensCached 564: the system prompt is prewarmed), so the largest variant gave 922+15=937 < 973. **Fix commit `90a12c99`** (count calls, add `prompt-1010.txt`). |
| `sa849528c` | arm 1 CPU `INVALID composer` (skin 34.45→43.96 with no turn sent) | `TYPE_FAST=1` lost characters: 2993/3832, retype 3219/3832 (`*_composer_len.txt`) — QRD trap 4 (no dump pacing). Stopped by operator; **SIGTERM does not stop d_run.sh** (the TERM trap runs cleanup and the script continues; END.txt then says `exit_0`) → SIGKILL. |
| `sa849528d` | **2 valid rows (pair 1)**, operator stop after row 2 at 01:22 | `TYPE_FAST=0`; arm 3 could not finish before the 01:35 deadline (cooldown cap alone 12 min), so the driver was killed and the session ended early. Typing: the 200 rung lost characters on both arms (rc=1 after 199/222 s), the 100 rung was exact (473/450 s) → 672 s typing per arm. |

`restore.sh` ran after every abnormal end; it returned rc=1 each time with `rkstorage-restore-*` files left in
`/data/local/tmp/kalsa-heat/heat/` → its final `run-as cp` fails (not diagnosed; the app was force-stopped and
stay-on/timeout/keyguard restored — `restore.txt` per run).

Calibration (`sa849528d`): READY turn chunk sum N0=15, tools 0, variant 1010 → estimate 1025; PROMPT.meta
`2a4b5dea…0ea1 3833`. Load proof: `…files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf`.

Mid-turn safety interval: no mid-turn check fired (both turns completed before 30 s of polling). One
`logcat -v epoch -d -b all` through the tunnel took **1.59 s** (1.95 MB) → interval ≈ 6 × (5 + 1.6) ≈ 40 s,
far under the 120 s abort limit.

## QRD8650 session 2 — QDC 845490, unit sa849559, serial 36aa3b71 (SM8650)

`qdc-heat-lfm-8650-s2`, same config, cap 115. Submitted 01:24:28, Started 01:25:45, Ended 03:11:33 EDT
(Completed, portal-verified; End Session needed a JS click to open the dialog — ref-clicks did nothing
twice) = 105 min 48 s. **QRD8650 card 842 → 741 = 101 min**, neither the cap (115) nor the duration (106);
read once right after the end, may still move. Same injected battery override on this unit
(`battery_before_reset.txt`: UPDATES STOPPED, AC powered: true) → `dumpsys battery reset` before the
driver (`battery_after_reset.txt`: AC false). Driver `ARM_ORDER=GCGC PAIR_START=3`, deadline 109,
`TYPE_FAST=0 TYPE_LADDER="100"` (env only: the 200 rung failed on both session-1 arms; 100 was exact in
478/…s, cap 700). Normal end `exit_0`, samples pulled, app force-stopped after.

Arm t1 (G, pair 3) **INVALID `token_band`**: chunk sum 1536 = 512+7+512+128+128+128+118+3. The board was
cold (32.4 °C), so cooldown/settle took 0 s and the send raced the new chat's system-prompt prewarm:
`KALSA_PREWARM {"op":"start",…}` then `{"match":false,"reason":"prefix_miss",…}` — the system prompt was
prefilled inside the arm. In session 1 the 720+240 s waits always let the prewarm finish. Not rescued.
Candidate fix (not made): after `new_chat`, wait for `KALSA_PREWARM op:done` before typing.

## Per-arm table (valid and invalid rows; source raw/sa849528d, raw/sa849559 results.tsv)

| session | pair | arm | turn | status | warm_start | cooldown_s / settle_s | skin before→after °C | ΔT °C | prefill_ms | chunks | engine prefill/decode | route req/push/mismatch | tokens_pred | decode tok/s | thermal_state |
|---|---:|---|---:|---|---:|---|---|---:|---:|---:|---|---|---:|---:|---|
| 1 | 1 | cpu | 1 | OK | 1 | 720 / 240 | 38.540→45.378 | +6.838 | 11109.2 | 1018 | CPU/CPU | cpu/applied/0 | 96 | 16.50 | WARM |
| 1 | 1 | gpu | 2 | OK | 1 | 720 / 240 | 40.368→45.272 | +4.904 | 6881.6 | 1018 | GPU/CPU | gpu/applied/0 | 42 | 18.21 | COOLMODE |
| 2 | 3 | gpu | 1 | INVALID token_band | 0 | 0 / 0 | 32.434→39.640 | (+7.206) | 10088.0 | 1536 | GPU/CPU | gpu/applied/0 | 42 | 24.84 | FAST |
| 2 | 3 | cpu | 2 | OK | 1 | 720 / 240 | 38.263→43.971 | +5.708 | 10749.4 | 1018 | CPU/CPU | cpu/applied/0 | 96 | 17.08 | WARM |
| 2 | 4 | gpu | 3 | OK | 1 | 720 / 240 | 40.260→44.457 | +4.197 | 6879.9 | 1018 | GPU/CPU | gpu/applied/0 | 42 | 17.71 | COOLMODE |
| 2 | 4 | cpu | 4 | OK | 1 | 720 / 240 | 40.926→45.535 | +4.609 | 11140.0 | 1018 | CPU/CPU | cpu/applied/0 | 96 | 16.69 | COOLMODE |

All valid rows: failed=0, fallback 0, tool calls 0, lmkd 0, plugged false, batt level 100, batt temp 25.0
(stub). **n valid: CPU 3, GPU 2.** Pair 2 was never run (session 1 ended after pair 1). Every valid arm was a
warm start (cooldown cap hit: the board never got back to 37 °C in 720 s).

## Pair deltas (ΔT cpu − ΔT gpu, same pair)

| pair | order | ΔT cpu | ΔT gpu | Δ cpu−gpu |
|---:|---|---:|---:|---:|
| 1 | C→G | +6.838 | +4.904 | **+1.934** |
| 2 | G→C | — | — | not run |
| 3 | G→C | +5.708 | invalid | — |
| 4 | G→C | +4.609 | +4.197 | **+0.412** |

Median of the 2 valid pairs: **+1.173 °C**. Arm means: CPU +5.718 (n=3), GPU +4.550 (n=2).

## Against PREREG-LFM (QRD8650 row) — hit/miss, no re-interpretation

| prediction | measured | verdict |
|---|---|---|
| P1 ≈ +2.2 (range −1.0…+4.5) | +1.934 | hit (inside range) — note P1 was not a cold start (CPU arm started at 38.54 °C) |
| P2/P4 ≈ 0…+1 | P4 +0.412; P2 not run | hit for P4; P2 untested |
| median ≈ +1.5; falsifier: median ≤ 0 | +1.173 (2 pairs) | not refuted; below the point estimate |
| prefill 9,400 / 4,750 ms | CPU 10,749–11,140; GPU 6,880–6,882 | miss (both slower) |
| prefill ratio GPU/CPU in 0.45–0.60 | 0.619 (P1), 0.618 (P4) | miss (off-prior, just above) |
| decode 21.2 / 18.9 tok/s | CPU 16.50–17.08; GPU 17.71–18.21 | CPU miss (−20 %); GPU close |
| decode spread > 20 % = off-prior | CPU vs GPU ≈ 7–10 % | not off-prior |

**Confound not in the prereg:** greedy output differs by backend — every CPU arm generated 96 tokens,
every GPU arm 42 — so decode (CPU in both arms) is NOT common mode: CPU arms carry ~54 extra decode tokens
(~3 s at ~17 tok/s). Part of the CPU−GPU contrast is decode length, not prefill backend.

Descriptive only (n = 2 pairs), one board, one model, one build; no routing conclusion.

## QRD7675

Not run: the card read **Unavailable** (1000 min) after QRD8650 finished (03:12). No session requested.

## Minutes billed (aspis account, QRD8650 card)

957 before → 842 after session 1 (115 = cap) → 741 after session 2 (101). Total 216 min for 2 sessions.

## Not verified / open

- Session-2 billing (101) was read once right after the end; not re-read later.
- `restore.sh` rc=1 on every run (leftover `rkstorage-restore-*`); cause not diagnosed.
- `d_run.sh` ignores SIGTERM (the TERM trap does not exit) and then writes `END reason=exit_0` — misleading;
  not fixed.
- No mid-turn safety check ever fired (all turns < 30 s of polling); the ≈40 s interval is computed from one
  timed logcat dump, not observed.
- The battery override (`AC powered: true`, UPDATES STOPPED) was present on both fresh units — presumably
  QDC provisioning; battery temperature is a constant stub (25.0 °C), so the battery-temp stop cannot fire
  on these boards; skin (recorded, and reaching the engine through the bench profile) peaked at 45.535 °C.

# Driver fixes after the 2026-09-26 run

Cell-driver fixes for the confound and the three live findings above. App repo untouched (read at
main 19526d78); no device/QDC/browser. Closes "Not verified" items 2 and 3 of the run section.

## P1 — CPU 96 vs GPU 42 tokens: cause, and the fix the driver now wires

(a) Sampling: the driver sets `kalsa.bench.sampling='greedy'` (parse.sh set_prefs) → app-side
`applyBenchSampling` (benchSampling.ts:68-94) pins temperature 0, top_k 1, top_p 1, min_p 0, all
penalties off, n_probs 1, **seed 42** → deterministic greedy. `n_predict` becomes max(48, 1024) — a
ceiling only; EOS/stop ends the turn. Completion params are built at LlamaService.ts:5133 (main
round) and :5581 (fallback round) through `applyBenchSampling`.

(b) Fixed decode length: **no bench key for ignore_eos/n_predict exists** (full key list
benchConfig.ts:30-68 + benchSampling.ts:3-5). The native engine supports `ignore_eos` (kalsa.rn
types.ts:437; JSIParams.cpp:469; EOS logit_bias −∞ at :658-661) but the app never sets it — adding
it would touch `BenchSamplingParams`/`applyBenchSampling` (benchSampling.ts:9,74). **But a working
lever already exists: `kalsa.bench.force_ids`** (benchSampling.ts:5, read at :38-66, applied only in
greedy — LlamaService.ts:4464-4465): the native loop ends exactly when the forced list is exhausted
(rn-completion.cpp:1908-1910) and forced ids bypass sampling and natural EOS, so N forced ids = N
decode tokens on both arms. Wired (new `forced_decode.sh`): FORCED_DECODE_N=128 (default) repeats
one benign id — 'heat' → 30157, derived from the measured GGUF with llama-tokenize (`--ids
--no-bos`); its piece cannot match any stop word (STOP_WORDS are special tokens,
LlamaService.ts:667). `set_prefs` writes the key (parse.sh, one conditional SQL fragment; SQL shape
unit-tested against sqlite); every arm's results.tsv `tokens_predicted` reads 128. Setup aborts
(`write_end forced_decode`, exit 6) if derivation fails; `FORCED_DECODE_N=0` opts out. Recorded:
driver.log `FORCED_DECODE n=128 id=30157 ids_sha256=fe8b738a…` + `raw/<job>/forced_ids.txt`.
Caveat for the next run: forced decode removes the length confound, it does not make the two
prefills bit-identical (see (c)).

(c) GPU-vs-CPU divergence = the documented f16/f32 GEMM residual, yes: GPU prefill vs CPU median
KLD 0.4538 root-caused to an f16 multiply in the batched GEMM (QDC-GPU-GOVERNOR-MAP-2026-09-16.md:
141-145,308; ALIVE row 56); the shipped f32 kernel collapsed it to KLD 0.004736, same-top 94.8 %,
median |Δp1| 0.0861 → 0.0014 (gemm-f32-ship REPORT — QRD8650/Adreno 750, this run's exact GPU;
qdc-governor-s5 REPORT:79-84 saw the same as deterministic divergence at position 14). A ~5 %
top-1 disagreement over a 1018-token greedy generation flips a token somewhere, after which the
continuations legitimately diverge and EOS lands at 42 vs 96. Forcing ids makes decode work common
mode; the logit residual itself remains.

## P2 — d_run.sh ends cleanly on SIGTERM/SIGINT

Cause of the old behavior: one trap ran `cleanup` for EXIT/INT/TERM and RETURNED (script resumed;
END said `exit_0`), and while blocked inside a foreground adb call the trap waited out the whole
call. Fix (d_run.sh): adbT backgrounds its perl-alarm adb child and `wait`s on it (signals interrupt
`wait` at once; non-signal rc semantics unchanged); INT/TERM get `on_signal`, which kills the
in-flight adb child, runs the same cleanup, writes `END reason=signal_<name>`, exits 128+signum.
Worst-case delivery is the current bare sleep (5 s poll quantum / 15 s cooldown / 60 s tail).
Note: SIGINT only works where INT is deliverable (foreground terminal); a background-spawned
driver has INT ignored at entry per POSIX — use TERM there. Dry-run (fake adb, mid-turn):
`kill -TERM` → **EXIT=143**, `END reason=signal_TERM`; INT variant → **EXIT=130**,
`END reason=signal_INT`; END guard prevents the EXIT trap from overwriting the reason.

## P3 — restore.sh rc=1 every time: root cause + fix

Cause: the final device command folded `rm -f $remote` into the run-as chain
(`cp … && rm -f databases/RKStorage-wal … && rm -f $remote`). `$HEAT_TMP` is shell-owned 0755, so
the app uid cannot unlink from it: the cp **succeeded** (the DB was restored every time), the chain
returned nonzero, and the pushed `rkstorage-restore-*` stayed behind — exactly the leftover files
seen on both units. set_prefs never had the bug (it removes the remote as shell, parse.sh:179).
Fix (restore.sh): run-as chain keeps cp + wal/shm removal only; remote removed as shell afterwards
(`rm -f $HEAT_TMP/rkstorage-restore-*`, also sweeps the stale pre-fix leftovers; non-fatal); the
cp-chain output now lands in `restore-prefs.log` (gitignored) instead of /dev/null.
Dry-run: pre-fix restore.sh against the fake adb (emulating the real app-uid denial) → **EXIT=1**;
fixed → **EXIT=0**, `bench_prefs=removed`.

## P4 — untrusted battery sensor (QDC stubs) + skin fallback — COORDINATOR DECISION, PENDING OWNER REVIEW

New `battery_trust.sh`, run in the setup phase before the first gate: two samples
BATT_TRUST_INTERVAL_S apart (default 30 s) of dumpsys battery, sysfs
`/sys/class/power_supply/battery/temp`, and HAL skin. Flags the board untrusted on (a) dumpsys vs
sysfs mismatch, or (b) a frozen reading that is either exactly the 25.0 °C stub (BATT_STUB_TENTHS=
250, both units observed) or frozen while the skin moves ≥ 0.3 °C. Logs
`BATTERY_SENSOR_UNTRUSTED reason=…`, persists `raw/<job>/battery_trust.txt`; an arms-only
invocation of the same job reloads the verdict. safety.sh `hard_stops`: on an untrusted board the
can-never-fire battery ≥ 44 °C stop is REPLACED by a skin ≥ 46 °C stop (`STOP reason=skin_fallback`)
— for that board only; trusted boards keep skin as a recorded value with the engine's own
pause 43 / kill 44. Owner sign-off requested on the 46 °C figure and on the replacement semantics
before the next QDC session. Dry-run: stub setup → `BATTERY_SENSOR_UNTRUSTED why=fixed_25.0C_stub
temp=250,250` (EXIT=0); arms on that job with skin 46.5 → **EXIT=0**, `END reason=stop_skin_fallback`;
trusted battery + skin 46.5 → **EXIT=0**, no STOP, arm gates pass (2 OK rows from the real
sa849528d canned logs).

## Fixture/harness notes

`dryrun-adb.sh`: RKStorage fixture now self-creates a real sqlite DB; new emulation of the real
app-uid remote-rm denial (run-as-only pattern; the P3 before/after proof rests on it); sysfs
battery-temp line; logcat epoch normalization now handles the fractional epochs + leading
whitespace of REAL captured logs — canned logcat-cal/cpu/gpu are staged from raw/sa849528d
calibration and pair-1 arm dumps (`/tmp/kalsa-dry`, same arrangement as before, REPORT:593).
`bash -n` clean on all eight scripts (d_run, parse, safety, smp, restore, dryrun-adb,
forced_decode, battery_trust). New runtime artifacts: `.restore-state` restored to the real values
after a setup-phase dry-run overwrote it (SER=dryserial); `restore-prefs.log` gitignored.
Not verified on a device: force_ids decode length on hardware, the 46 °C fallback against a real
QDC thermal ramp, signal delivery during a real adb push.

---

# LFM heat arms on QDC — dataset "forced-128" (2026-09-26, day)

**A new dataset, separate from the 2026-09-26 night rows above.** Driver at lab `4f1e6907` (forced
decode `kalsa.bench.force_ids` = 128 × id 30157 on both arms, battery-trust check with the owner-approved
skin ≥ 46 °C stop on untrusted boards, clean SIGTERM, restore.sh fix) plus `851ec2f4` (every arm relaunches
the app and waits for the load+prewarm proof before its route command — the night's pair-3 race; the
prewarm is skipped while the KV holds a chat, so waiting after `new_chat` could not work). PREREG-LFM
predictions assumed free decode; they are compared below, with that noted.

Account verified on the page before anything else: `auth-session` email claim + chip =
aspis.launcher@gmail.com (tab 3774c340). Portal before: QRD8650 **749** (741 read right after the night's
session 2, credited +8 later), QRD7675 1000 (Unavailable), QRD8750 994.

Cap arithmetic (per session, 4 arms): setup + load proof + calibration ≈ 6 min (night: 01:26:52 → 01:32:10);
cold first arm ≈ 11 min (no wait, 478 s typing at the 100 rung, relaunch+proof ≈ 20 s, 128-token decode
≈ 8 s, 60 s tail); 3 warm arms × (720 cooldown + 240 settle + ~80 route/relaunch/new chat + 480 typing
+ ~30 turn + 60 tail + ~40 dumps ≈ 27.5 min) ≈ 83 min → ≈ 100 min driver time; deadline 110 (guard max),
cap 115 (tunnel + end). Env: `TYPE_FAST=0 TYPE_LADDER="100"`, tunnel port 6039.

## forced-128, QRD8650 session 1 — STOPPED after arm 1 (tokens_predicted 127 ≠ 128; harness abort)

- Session 847173 (`qdc-heat-f128-8650-s1`): stuck in QDC Setup "Enabling wifi on device" / "Failed to
  enable wifi … Will retry" for 7 min → **canceled before start** (Started N/A). The card briefly read 634
  (a 115 hold), then returned: see minutes below. A wizard script cut by the 15 s evaluate limit may have
  toggled WiFi; the re-created session had WiFi/BT verified off and still showed "Enabling wifi" before
  starting.
- Session 847269 (`qdc-heat-f128-8650-s1b`), unit sa851338, serial cacfeec9 (SM8650), cap 115, SSH only,
  Screen Always On, WiFi/BT off. Started 09:51:36, Ended 10:12:03 EDT (Completed; portal "21m").
  Same injected battery override → `dumpsys battery reset` before the driver (`battery_*_reset.txt`).
  Driver `CGGC`, deadline 110, `TYPE_FAST=0 TYPE_LADDER="100"`, forced decode default.
- Driver log: `FORCED_DECODE n=128 id=30157 ids_sha256=fe8b738a…`; `BATTERY_SENSOR_UNTRUSTED
  why=fixed_25.0C_stub temp=250,250` → skin ≥ 46 °C stop active; calibration N0=15, variant 1010, tools 0.
- **Prewarm fix works on hardware:** arm 1 logcat `KALSA_PREWARM skip already_warm` then
  `KALSA_KVPREFIX embd=518 text_tokens=1536 n_common=518`, chunks 1018 (`_relaunch.txt`, `_load.txt`).

| dataset | session | pair | arm | turn | status | skin before→after | ΔT | prefill_ms | chunks | tokens_pred | decode tok/s | thermal |
|---|---|---:|---|---:|---|---|---:|---:|---:|---:|---:|---|
| forced-128 | 847269 | 1 | cpu | 1 | OK (gates) | 35.622→42.659 (cold, no wait) | +7.037 | 9969.0 | 1018 | **127** | 17.25 | FAST |

- **Stop reason 1 (owner rule): tokens_predicted = 127, not 128**, with 128 forced ids. The calibration turn
  also read 127. Not explained on hardware; unverified hypothesis: the reported count is decode evaluations and
  the last forced token is sampled but never evaluated. Whether the GPU arm also reads 127 was not measured.
- **Stop reason 2 (harness, my bug): driver ABORT after arm 1** (`lmkd_count=1`): the per-arm relaunch
  (`851ec2f4`) force-stops the app, which logs `am_kill … stop com.kalsa.app due to from pid 14869`; the lmkd
  counter matched it. Fixed in **`7e452572`** (excluded; real log 0, synthetic low-memory line 1). The fake
  adb has no am_kill lines, so the dry-run could not see it.
- `restore.sh` after the abort: **rc=0** (`bench_prefs=removed`) — the P3 fix holds on hardware.

Minutes (QRD8650 card): 749 before → 634 while the canceled session held its cap → **728 after**
(= 21 min for 847269, the actual duration; 847173 cost 0). QRD7675: 1000, Unavailable — not run.
Comparison to PREREG-LFM: not attempted (1 row, no pair; and the prereg assumed free decode).

**Decode-length gate (coordinator decision 2026-09-26).** 127 is ACCEPTED as the forced-decode length (the goal
is equal decode on both arms). Hypothesis for 127 vs 128 forced ids — **UNVERIFIED**: the reported count is
decode evaluations, and the last forced id is sampled but never evaluated. Gate (driver, per arm, logged as
`DECODE_LEN_CHECK`): tokens_predicted must equal the calibration turn's value (`DECODE_LEN_REF`, persisted in
`raw/<job>/decode_len_ref.txt`); any other numeric value voids the row (`decode_len`) and stops the session
after that arm (`STOP_UNEQUAL_DECODE`). Dry-runs: mismatch (ref 30, arm 96) EXIT=1 with the stop; equal (127 on
calibration and both arms) EXIT=0, 2 OK rows.

## forced-128 (decode length 127) — QRD8650, 2 sessions, 4 pairs — 2026-09-26 day

Driver at `851b053d` (equal-decode gate) on top of `7e452572`/`851ec2f4`/`4f1e6907`. Both units: injected battery
override reset before the driver; `BATTERY_SENSOR_UNTRUSTED fixed_25.0C_stub` → skin ≥ 46 °C stop (never fired;
peak 45.613). `DECODE_LEN_REF=127` in both calibrations; `DECODE_LEN_CHECK` = 127 on all 8 arms; tools 0,
lmkd 0, failed 0, chunks 1018 on every arm (the cold-first-arm prewarm race is gone: session-2 G arm 1 was
cold and read 1018). Env `TYPE_FAST=0 TYPE_LADDER="100"`, deadline 109/110, cap 115.

- S1: QDC **847601**, unit sa851670, serial a652109b, Started 10:24:20, Ended 12:10:29 (106 min), `CGGC`,
  END exit_0.
- S2: QDC **848429**, unit sa852498, serial 36aa3b71, Started 12:12:45, Ended 14:00:10 (107 min), `GCGC
  PAIR_START=3`. All 4 rows written; then `END reason=exit_258` with `d_run.sh: line 386: syntax error` —
  **d_run.sh was modified on disk by another session at 13:28 during the run** (uncommitted, not mine, not
  committed here); bash had already parsed the arm loop, so the rows ran the committed code; only the post-loop
  sample pull died (pulled manually; restore.sh rc=0).

| pair | arm | turn | start | skin before→after | ΔT | prefill_ms | tokens_pred | decode tok/s | thermal |
|---:|---|---:|---|---|---:|---:|---:|---:|---|
| 1 | cpu | 1 | cold | 33.768→40.509 | +6.741 | 10142.4 | 127 | 17.30 | FAST |
| 1 | gpu | 2 | warm | 37.801→43.227 | +5.426 | 6599.8 | 127 | 17.05 | FAST |
| 2 | gpu | 3 | warm | 39.190→44.109 | +4.919 | 6594.8 | 127 | 17.38 | WARM |
| 2 | cpu | 4 | warm | 39.789→45.257 | +5.468 | 11235.7 | 127 | 16.33 | COOLMODE |
| 3 | gpu | 1 | cold | 33.844→40.432 | +6.588 | 6347.0 | 127 | 18.41 | FAST |
| 3 | cpu | 2 | warm | 38.717→44.478 | +5.761 | 10890.6 | 127 | 16.66 | WARM |
| 4 | gpu | 3 | warm | 40.769→45.613 | +4.844 | 6889.4 | 127 | 18.18 | COOLMODE |
| 4 | cpu | 4 | warm | 41.017→45.585 | +4.568 | 10367.8 | 127 | 17.75 | COOLMODE |

**Pair deltas CPU−GPU:** P1 **+1.315**, P2 **+0.549**, P3 **−0.827**, P4 **−0.276**. Mean +0.190, median
+0.137; arm means CPU +5.634, GPU +5.444 (n = 4 each). The sign follows which arm got the cold board: P1 (CPU
cold) +1.3, P3 (GPU cold) −0.8; the two all-warm pairs +0.55 / −0.28.

**vs PREREG-LFM (its predictions assumed FREE decode; this dataset forces 127 tokens on both arms):**
P1 +2.2 (−1.0…+4.5) → +1.315 inside range (hit); P2/P4 0…+1 → P2 +0.549 hit, P4 −0.276 miss (below 0);
median ≈ +1.5 / falsifier ≤ 0 → +0.137, not refuted, far below the point; prefill 9,400 / 4,750 ms → CPU
10,142–11,236, GPU 6,347–6,889: miss; GPU/CPU ratio 0.45–0.60 → 0.651, 0.587, 0.583, 0.665: 2 of 4 inside;
decode tok/s (prereg 21.2/18.9, free decode) not comparable here (CPU 16.3–17.8, GPU 17.1–18.4).

Minutes (QRD8650 card): 728 before S1 → 613 right after (115 hold) → 621 before S2 (S1 settled at 107) → 506
right after S2 (115 hold, not yet settled). QRD7675: 1000, **Unavailable** at 14:01 — not run.

---

# Galaxy S23 (SM8550 / Adreno 740) — CPU vs GPU heat attempt

**Result: n=0 valid arms.** Three live starts reached model load and CPU calibration, but each first CPU prompt failed composer verification before Send. No generation, route telemetry, token count, prefill measurement, or decode rate was produced. The requested two CGGC pairs and pair deltas therefore remain unavailable; no heat comparison is licensed.

## Setup and method

- Reused this QDC driver with a minimal S23 override: local ADB serial/port 5037, SM8550 board mapping, S23 HAL `SKIN` label support, preserved matching APK data, and `run-as` path when `/data` chmod is denied. Kept QDC model, forced-decode workflow, per-turn thermals, route/prewarm checks, and lmkd accounting unchanged. Working diff was checked against HEAD `5c472986`; the `DECODE_LEN_REF` / `DECODE_LEN_CHECK` equality gate from `851b053d` remains present.
- Fake-ADB full dry-run: **EXIT=0**, evidence `raw/s23-dryrun-after-typing-fix/END.txt`.
- Installed APK already matched target `0509f8c8` SHA-256 `855c89de6496b00d0721f981d551842abfd544a26c62d4c3a816028c4b5c91e7`; no install was needed. Package `0.1.0`, last update `2026-09-25 15:03:17`; target model SHA-256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`.
- Live gates passed on the three attempts: unplugged, battery level 86–92%, battery 28.3–36.0 °C, thermal status 0, screen awake/Kalsa foreground, and DSP snapshots recorded. Calibration loaded the model, selected prompt variant 1010 at N0=15, and fixed decode reference at 127 tokens. `restore.sh` returned rc=0, force-stopped the app, removed harness prefs, stopped the sampler, restored screen timeout to `null`; no app uninstall or data clear was used.

## Failed first CPU arms

All composer failures occurred before Send, so route and tokens are `na`; prefill and decode timing are `na`, not zero.

| Attempt | Route / tokens | Skin °C | Battery °C | Prefill / decode tok/s | Stop reason |
|---|---|---:|---:|---|---|
| r1 C1 | no turn / na | 33.4→33.9 | 32.3→32.2 | na / na | composer incomplete; invocation manually terminated during next-arm setup |
| r2 C1 | no turn / na | 34.6→35.7 | 33.8→34.7 | na / na | composer incomplete; STOP_INVALID_ROW |
| r3 C1 | no turn / na | 35.5→36.2 | 34.8→36.0 | na / na | composer 1387/1400 chars after retry ladder; STOP_INVALID_ROW |

No arm crossed the battery/thermal stop thresholds. The valid results table is empty apart from its header in each run. Before r3 DSP snapshot: `adsprpcd` pid 2222 utime/stime 4/0, `cdsprpcd` pid 2225 147/0; post-run snapshot recorded in `raw/s23-20260926/post_dsp_ticks.log` as 0/0 and 0/5 respectively (same pid values; counters as observed). Screen timeout post-restore: `null`.

Raw preflight, all three driver logs/results, restore logs, and post-run state are under `raw/s23-20260926/` and `raw/s23-heat-cpu-vs-gpu-20260926-r{1,2,3}/`.

## Slow-pacing relaunch — 2026-09-26

**Result: n=0 valid arms; no CPU/GPU heat comparison.** Relaunched with the audited QDC driver, `CGGC`, and the opt-in typing override proved on the scratch chat: `TYPE_LADDER="50 50 50" TYPE_CHUNK_PAUSE_S=1.5 TYPE_FAST=0`. QDC defaults remain unchanged. The preflight passed: unplugged, 72% battery, 37.6 °C battery / 37.0 °C skin, thermal status 0, traced disabled; screen wake and foreground checks were performed by the driver. Calibration loaded the model and set `DECODE_LEN_REF=127`.

The first CPU arm failed the composer's exact-text gate before Send. Its three 50-character typing attempts with the 1.5-second pause were exact prefixes through 1,599/1,600, 1,749/1,750, and 1,844/1,850 characters. No prompt was sent, so equal-decode validation, backend route, prefill, and decode rate were not reached. I interrupted the driver after its first invalid row, before arm 2; the remaining CGGC arms were not run.

| Pair | Arm | Route / tokens | Skin °C | Battery °C | Prefill / decode tok/s | Stop |
|---|---|---|---:|---:|---|---|
| 1 | CPU | no call / n.a. | 36.9→38.5 | 37.6→38.8 | n.a. / n.a. | composer incomplete (1844/1850 at final check) |

No complete pair exists, so CPU−GPU deltas are n.a. DSP before: `adsprpcd` 0/0, `cdsprpcd` 0/5 ticks; after: `adsprpcd` 0/0, `cdsprpcd` 0/5. `restore.sh` returned rc=0, restoring screen timeout `null`, stopping the sampler, force-stopping the app, and clearing bench preferences. Raw files, including the command, per-chunk composer checks, results row, preflight, restore, and post-run DSP snapshot, are in `raw/s23-heat-cpu-vs-gpu-20260926-slow4/`.

## Composer diagnosis — slow-input check

The r1-r3 UI dumps were exact prefixes of the expected prompt: there are no changed characters, autocorrections, capitalization changes, punctuation insertions, or altered spaces. Every mismatch is a missing suffix at the in-progress input boundary (positions are zero-based): r1 expected `[1197,1200)` `amb`, got empty; r2 first attempt `[970,1000)` `lacier harbor indigo juniper k`, got empty; r2 retry `[1389,1400)` ` juniper ke`, got empty; r3 first attempt `[965,1000)` `int glacier harbor indigo juniper k`, got empty; r3 retry `[1387,1400)` `go juniper ke`, got empty. All characters before those ranges matched byte-for-character.

Diagnosis: **(b) chunk pacing/input injection drops the trailing characters**, not Samsung autocorrect or app-side text mutation. In one new scratch chat, one unsent 1400-character attempt typed as 50-character chunks with 1.5 s between chunks produced exactly 1400/1400 expected characters. No Send was pressed, no model load was requested, and the unsent text was cleared. Samsung Keyboard settings and installed IMEs were left unchanged. Raw diagnostic dumps for the slow check were kept under `/tmp` only.

---

# forced-decode heat arms — all boards (owner: "proviamoli tutti"), 2026-09-26 afternoon

Driver: lab HEAD `bc389a0e` (adds SM8635|QRD8635 to the SoC allowlist). Luna's S23 commits
(3b3be15c/f6656ade/9123a73c) checked: every new knob is opt-in (`TYPE_CHUNK_PAUSE_S` default 0,
`ALLOW_RUN_AS_WITHOUT_CHMOD` 0, `PRESERVE_APP_DATA` 0, `ADB_SERIAL` unset, `50` ladder rung only if asked);
QDC defaults incl. typing unchanged; skin sensor name now matched case-insensitively. Env per QRD run
unchanged: `TYPE_FAST=0 TYPE_LADDER="100"`, forced decode default, cap 115 / deadline ≤110.

Balances read 14:1x EDT on aspis (account verified): QRD8750 **994** (Available), QRD8635 **1000**
(Unavailable), QRD7675 **1000** (Unavailable), QRD8650 **506** (Available; the last 848429 hold not yet settled).

## QRD8750 (8 Elite, Android 16) — S1 QDC 849171, unit sa853240, serial 9aed338b

Started 14:39:14, Ended 16:10:42 (92 min; card 994 → 902). Battery override reset as usual, but this board's
battery reads a flat **42.0 °C** (dumpsys 420 = sysfs 420 while skin 30.4) — `battery_trust` called it
TRUSTED (it only knows the 25.0 stub; skin moved 0.03 °C in its window), which would have left NO working
temperature stop (battery ≥ 44 can never fire on a frozen 42.0, skin ≥ 46 inactive). Driver SIGTERMed after
calibration, before any arm (`sa853240`, END `signal_TERM`, 0 rows, restore rc=0), relaunched as `sa853240b`
with the existing opt-in `BATT_STUB_TENTHS=420` → `BATTERY_SENSOR_UNTRUSTED` (log label still says
"fixed_25.0C_stub": hardcoded text) → skin ≥ 46 stop active. `DECODE_LEN_REF=127`. END exit_0.

| pair | arm | turn | skin before→after | ΔT | prefill_ms | tokens | decode tok/s | cooldown/settle s |
|---:|---|---:|---|---:|---:|---:|---:|---|
| 1 | cpu | 1 | 35.914→38.146 | +2.232 | 6308.7 | 127 | 26.13 | 0/0 |
| 1 | gpu | 2 | 36.943→38.826 | +1.883 | 3428.3 | 127 | 27.20 | 225/150 |
| 2 | gpu | 3 | 37.272→39.597 | +2.325 | 3562.0 | 127 | 25.90 | 720/240 |
| 2 | cpu | 4 | 37.730→40.413 | +2.683 | 6554.9 | 127 | 26.04 | 720/240 |

Pair deltas CPU−GPU: P1 **+0.349**, P2 **+0.358**. All chunks 1018, tools 0, lmkd 0.
QRD8650 card settled at 512 (848429 = 109 min).

## QRD8750 — S2 QDC 849776, unit sa853845, serial f3b4a4c5 — STOPPED: setup failed twice

Started 16:13:43, Ended 16:36:38 (23 min; card 902 → 787 right after = the 115 hold, not settled). This unit's
battery stub reads **40.0 °C** (400), not the S1 unit's 420: the first launch (`sa853845`, with
`BATT_STUB_TENTHS=420`) was SIGTERMed before its trust check; relaunched with `BATT_STUB_TENTHS=400` →
`BATTERY_SENSOR_UNTRUSTED` (skin ≥ 46 stop active). Then **`LOAD_PROOF_FAIL` twice** (`sa853845b`,
`sa853845c`, END `load_proof`, 0 rows): each time `PowerManagerService: Going to sleep due to timeout
(screenOffTimeout=1800000 …)` ~10 s after the app start (`screen_toggled: 0`, MainActivity paused), so the
eager prewarm logged `skip not_ready` then `skip background` and no `op:done`/restore proof ever came. A
manual WAKEUP + dismiss-keyguard + tap right before attempt 2 (`mWakefulness=Awake`, `mIsPowered=false`,
`mStayOn=false`) did not change it — QRD trap 7 (stay-on inert on an unpowered board), deterministic on this
unit; the S1 unit (9aed338b) never slept. Per the owner rule (board fails twice in setup) QRD8750 stops here
with S1's 2 pairs. restore.sh rc=0 after each run (one rc=2 = transient tunnel reset right after a SIGTERM,
re-run rc=0; one rc=1 = no app DB yet on a run stopped mid-setup).

Not done / open: QRD8635 and QRD7675 read **Unavailable** at 16:37 — not run. Candidate fix for the
unit-specific sleep (not made): keep the screen awake through the load (e.g. a periodic input tap / wake
during poll_load, or `svc power stayon usb` if the board honours it) — driver change, needs owner/coordinator.
Also: `battery_trust` only knows one stub value per run (`BATT_STUB_TENTHS`); QDC units carry 25.0 / 42.0 / 40.0
stubs, so a frozen-identical dumpsys==sysfs reading while skin is ≥ 8 °C lower should be flagged generically.

## Driver: generic battery-stub detection, rule A5, screen kept awake during the load proof (2026-09-26 eve)

Coordinator decisions, dry-run only (fake adb; no device).
- `battery_trust.sh`: UNTRUSTED on (a) dumpsys≠sysfs; (b) frozen at `BATT_STUB_TENTHS` (default 250, override
  kept); (c) dumpsys==sysfs frozen across the setup samples with skin ≥ 5.0 °C away from it; (d) reading identical
  in every sample (setup + every `safety_stops`) while skin moves ≥ 1.0 °C — can fire mid-session. Verdict only
  trusted→untrusted, persisted with tracking state (`track_ref`, `skin_min/max`) and reloaded in arms phase.
  The old 0.3 °C frozen rule is replaced by (d)'s 1.0 °C.
- `safety.sh`: **rule A5** — battery ≥ 44 °C is always armed; untrusted only ADDS skin ≥ 46 °C.
  `safety_stops` calls `battery_trust_update` each turn (arm gate, pre-turn, mid-turn).
- `parse.sh poll_load`: every ~5 s checks `mWakefulness` then sends `KEYCODE_WAKEUP`; Asleep/Dozing → rc 3,
  logged `LOAD_PROOF_SCREEN_OFF`; calibration ends `LOAD_PROOF_FAIL reason=screen_off` / END `screen_off`; an arm
  voids `screen_off`. On AC only: `svc power stayon true` for the wait, previous
  `stay_on_while_plugged_in` restored exactly (null → delete). Not exercised by a fixture (AC=true trips the
  plugged stop in setup); the stay-on branch is untested.
- Caveat: rule (c) also flags a real battery sitting ≥ 5 °C off the skin; under A5 that only adds the skin stop.

| fixture | env | result | EXIT |
|---|---|---|---|
| frozen 42.0, skin 30→46.5 | `DRY_BATT_TEMP=420 DRY_SKIN=30.0 DRY_SKIN_AT=4 DRY_SKIN_AFTER=46.5` | `UNTRUSTED frozen_far_from_skin temp=420 sysfs=420 skin=30.0`, `STOP reason=skin_fallback` | 0 |
| frozen 40.0 | `DRY_BATT_TEMP=400 DRY_SKIN=35.0` | `UNTRUSTED frozen_far_from_skin`, 2 OK rows | 0 |
| trusted moving battery, skin 46.5 | `DRY_BATT_TEMP=340 …_AT=1 …_AFTER=345 DRY_SKIN_AFTER=46.5 PROMPT_VARIANTS=841` | `TRUSTED dumpsys=340,345`; calib gate at skin 46.5 → no STOP (ends at the intended CALIB_BAND_FAIL) | 3 |
| mid-session freeze | `DRY_BATT_TEMP=350 DRY_SKIN=35.0 DRY_SKIN_AT=4 DRY_SKIN_AFTER=36.5` | TRUSTED at setup → `UNTRUSTED frozen_while_skin_moves … (mid-session)`, persisted, 2 OK rows | 0 |
| screen off during load | `DRY_POWER_DOZE_AFTER_CLEARS=1` | `LOAD_PROOF_SCREEN_OFF wakefulness=Dozing`, END `screen_off` | 3 |
| A5: untrusted + battery 44.5 | `DRY_BATT_TEMP=250 DRY_BATT_TEMP_AT=3 DRY_BATT_TEMP_AFTER=445` | `UNTRUSTED fixed_stub`, `STOP reason=battery_temp` | 0 |

(Canned logcats set to tokensPredicted 127 for these runs, restored after; the first frozen-40 run stopped on
the decode gate with the stale 96/30 canned values — gate behaving.) `bash -n` clean on all eight scripts.

## Audit f2ee97f4 fixes — QDC untrusted by default, exact restore, helper jobs (2026-09-26 eve)

Coordinator decision: detection is no longer the safety basis.
- **Every QDC board: skin ≥ 46 °C always armed** (`safety.sh`), plus battery ≥ 44 (A5), thermal ≥ 3, level ≤ 25 %,
  plugged, missing readings. QDC detection in `d_run.sh`, fail-closed: tunnel port 6037/6039, or fingerprint
  `qti/*`, or model `*for arm64*` → `QDC_BOARD=1` (logged with reason); only a non-QRD build on another port is a
  local phone. `QDC_BOARD=1` in the env can force QDC mode, nothing forces it off; unset in safety.sh = 1.
- `battery_trust.sh` = logging on QDC (per arm: `BATTERY_TRUST turn=… qdc=… untrusted=… why=…`); on local phones
  an untrusted verdict ADDS skin ≥ 46. A1: numeric, jitter-tolerant ranges (battery range ≤ 0.3 °C =
  frozen), no permanent latch; rule (b) also re-checked every turn. A3: the setup check loads and never
  downgrades a stored verdict. D4: verdict written tmp + mv.
- C1/C2/C5: `screen_off_timeout` and `stay_on_while_plugged_in` are read ONCE per job into
  `raw/<job>/restore-state` (tmp + mv; reused by later invocations of the job) and copied to `.restore-state`
  (`RESTORE_STATE` overridable); `restore_device` (EXIT trap → every exit path incl. deadline 124 and
  signals) and `restore.sh` put back exactly those values (`null` → delete). `svc power stayon true` is no
  longer forced: only when the board is on AC (configure_screen, wake_sequence, poll_load).
- C3: keep-awake = one dedicated background job (KEYCODE_WAKEUP every ~5 s) started/stopped by `poll_load`,
  also stopped in cleanup. C4: holder and keep-awake run in their own process group (`set -m`), are killed as
  a group, and exit by themselves when the driver PID is gone (covers SIGKILL).
- Test hygiene: `PROMPT_FILE`/`PROMPT_META`/`RESTORE_STATE` overridable; the dry-run runner pins them under
  `raw/<job>/` (tracked-by-intent PROMPT files untouched: mtime unchanged). Fake adb: stateful settings
  (get/put/delete, svc stayon), `DRY_BATT_JITTER`, `DRY_BATT_RAMP`, sysfs follows the last dumpsys value,
  `DRY_NO_LOAD_PROOF`, WAKEUP log.
- Found by the dry-run and fixed before commit: the new detection line had overwritten `$MODEL` (the GGUF path)
  with the product model → forced_decode failed; renamed `PROD_MODEL`.

| fixture | result | EXIT |
|---|---|---|
| QDC, battery jitter 420/421, skin 30→46.5 | `QDC_BOARD=1`; trust (log) `frozen_far_from_skin temp=421,420`; `STOP skin_fallback` | 0 |
| local (port 5037), battery ramping, skin 46.5 | `QDC_BOARD=0`, TRUSTED, calib gate at 46.5 → no stop (intended band stop after) | 3 |
| full CG, pre-run stay_on=1 / timeout=60000 | 2 OK rows; no `svc stayon true`; final stay_on=1, timeout=60000; holder + keep-awake gone; 7 wakeups | 0 |
| SIGTERM during load proof | END `signal_TERM`; stay_on=1 / 60000 exact; both jobs gone; wakeups stop (8→8) | 143 |
| SIGKILL during load proof | both jobs exit by themselves; wakeups stop (7→7); `restore.sh` rc=0 → stay_on=1 / 60000 | 137 |
| screen off during load | `LOAD_PROOF_FAIL reason=screen_off` | 3 |
| A5: untrusted (25.0 stub) + battery 44.5 | `STOP battery_temp` | 0 |
| decode gate, stale canned 96 vs ref 30 | `STOP_UNEQUAL_DECODE` | 1 |

`bash -n` clean on all eight scripts. Untested: the on-AC stay-on branch (AC=true trips the plugged stop).

## QRD8750 S2 retry on the new driver — QDC 850167, unit sa854236, serial 9aed338b — safety STOP at setup

Started 17:29:26, Ended 17:32:20 (3 min; card 876 → 761 = the 115 hold, not settled). Same serial as S1
(9aed338b), whose stub read 42.0 then; this time the injected battery reads **44.0 °C** (dumpsys 440 = sysfs 440,
skin 30.6). `QDC_BOARD=1 why=tunnel_port=6039,fingerprint=qti,model=Sun for arm64`; trust (log)
`frozen_far_from_skin temp=440,440`; **`STOP reason=battery_temp` at the setup gate** — rule A5 keeps battery ≥ 44
armed, so a QDC stub at ≥ 44.0 blocks the board before any turn. No rows. Cleanup verified on the board:
screen_off_timeout 60000 and stay_on_while_plugged_in **15** (the pre-run values saved in raw/sa854236/restore-state)
restored exactly, holder gone, app stopped. QRD8635 / QRD7675 still Unavailable (17:33).

Decision needed (coordinator/owner): A5 vs QDC stubs ≥ 44.0 (the injected value varies per session: 42.0,
40.0, 44.0 on QRD8750; 25.0 on QRD8650). Retrying QRD8750 may land on the same unit again.
