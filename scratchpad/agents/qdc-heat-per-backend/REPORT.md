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
  pairs 1-2 (`ARM_ORDER=CGCG`, `PAIR_START` unset → 1), session 2 = pairs 3-4
  (same `ARM_ORDER`, `PAIR_START=3`). `validate_deadline_minutes` still caps
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
