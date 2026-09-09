# HOSTILE AUDIT — device-campaign harness (scripts/campaign/*, responseProfile.mjs)

Audited 2026-08-26, unattended 3-4 day lens, against `PART3_CAMPAIGN_KIT.md` rev 5 + the 11
must-fix in `AUDIT_PART3_KIT_REV5.md`. Method: full read of every harness file + the adb/ci-lib
layer it sources, app-side telemetry timing (`LlamaService.ts`, `turnTelemetry.ts`), replay of the
dry-run artifacts in `results/ciswire-campaign/2026-08-25/`, selftest re-run (exit 0), and
numerical re-check of prereg arithmetic. `git diff HEAD -- src/` is empty (no src changes).

Verdict up front: **FIX-AGAIN — 5 targeted must-fix items (all small, no redesign).** The
architecture (append-only datastore, checkpointed resume, per-turn watchdog, layered flag-trap,
device pinning) survives the audit; the settings, two failure-path plumbing gaps, and the
calibration handoff do not.

---

## 1. Findings

| # | Verdict | Finding | Evidence |
|---|---|---|---|
| H1 | CONFIRMED-OK | Per-turn hang detection is REAL, not pidof-alive: loop requires `KALSA_TELEMETRY` in the turn slice (`campaign_slice_has_telemetry`), aborts on `elapsed≥timeout` AND on `now−last_progress≥gap` (telemetry silence) | `turn.sh:158-176`; `watchdog.sh:21-23` |
| H2 | **DEFECT** | Hang settings sit BELOW the audit's floor: `turnTimeoutMs=1200000` / `telemetryGapMs=720000` (20/12 min). `KALSA_TELEMETRY` is emitted only at ROUND COMPLETION (`LlamaService.ts:2966-2980`, single line per single-round turn) — a legit turn >12 min (variant-A eviction re-prefill 195-405 s + 2.6B decode at 5.5-7.2 tok/s, thinking-on; E2E measured 254 s for one cold turn; prior campaigns hit 2400 s turns) is force-stopped as HANG mid-decode **before it could ever emit**. Audit must-fix #5 specified 30-45 min. | `campaigns/ciswire.json` `watchdog` block; `turn.sh:129-130,169-175`; rev-5 audit §2 + F3 |
| H3 | CONFIRMED-OK | Abort/resume/skip discipline is clean: abort force-stops + appends a `RECOVERY` jsonl row + writes checkpoint; recovery restores SAME conv (no wipe); retry once; skip with user-landed guard (no duplicate share); aborted recounts are flagged | `watchdog.sh:17-50`; `oneTurn.sh:20-64,68-107`; `conversation.sh:83-89` |
| H4 | CONFIRMED-OK | `fatal_*` files are BENIGN by design — `die()` evidence capture (UI dump, logcat tail, `-b crash` buffer, meminfo), not a bug | `ci-lib.sh:203-236,500-505`. **But** the dry-run's own dir contains one real FATAL (`fatal_state.txt` = Android tag/NFC app on screen; `com.kalsa.app` force-stopped 23:17:42; second invocation succeeded 23:48-23:58) → the die-path below fires on real anomalies |
| H5 | **DEFECT** | First-attempt share-send failure kills the ENTIRE supervisor (`die`), while the identical failure on the retry path is skippable (inconsistent). One UI-foreground takeover (NFC dialog, ANR, notification shade) → 3 failed sends → campaign stalled until human. Already fired once during the dry run (H4) | `oneTurn.sh:80` vs `oneTurn.sh:100`; `turn.sh:95-156` |
| R1 | CONFIRMED-OK | mDNS reconnect is implemented for real: offline → re-`adb connect` w/ backoff (5 tries, 2→30 s), stale-IP miss → `adb mdns services` filtered to `192.168.1.82:*` → connect new IP; `logcat -d` dump before resume; pairing (unauthorized) correctly handled as human-in-the-loop | `recovery.sh:10-66`; `logcat.sh:42-50` |
| R2 | CONFIRMED-OK | Reinstall is `-r` only; zero occurrences of `pm clear`/`uninstall` in the harness (grep); models in `/data/data/com.kalsa.app/files/models` survive `-r` | `recovery.sh:103-108`; grep clean; rev-5 audit C3 |
| R3 | **DEFECT** | Reinstall path reinstalls the WRONG APK: `campaign_find_apk` falls back to `android/app/build/outputs/apk/release/app-release.apk` — the only apk in the repo (**no debug apk exists**), a non-debuggable, different-build artifact. After the first pid-death reinstall: `run-as` breaks → every `sql`/`sql_write`/pull fails → campaign dies, and the device now runs the wrong build. Config `apk` field exists (`supervisor.sh:97-99`) but `campaigns/ciswire.json` doesn't set it | `recovery.sh:72-90`; `ls android/app/build/outputs/apk/{debug,release}`; `build.gradle:110-127` (release = no debuggable) |
| R4 | CONFIRMED-OK | Hard-offline mid-turn is bounded: adb-drop → abort → ensure_device (≤~2-3 min) → die if still missing; thermal cooldown capped 1200 s then die. No infinite loops anywhere | `recovery.sh:10-25,128-148`; `oneTurn.sh:36-41` |
| R5 | PLAUSIBLE-RISK | Recovery `die`s on transient flakiness (device-gone-after-restore `oneTurn.sh:28`, `ensure_device` miss, thermal >20 min `oneTurn.sh:34`, ready-timeout 240 s `conversation.sh:44-57`). Bounded ✓ but fatal-to-run; there is no auto-restart — any die = stall until a human re-invokes (resume then works). For unattended days, the supervisor wants a restart wrapper | `oneTurn.sh:20-51`; `supervisor.sh:105` |
| R6 | PLAUSIBLE-RISK | RKStorage pull-before-restart exists ONLY on pid-death (`oneTurn.sh:45`); hang/thermal/adb-drop restarts force-stop+relaunch without a pull — the in-flight turn's text is then only in the logcat forensics, not the datastore (it IS flagged via RECOVERY) | `oneTurn.sh:22-41` vs `45` |
| F1 | CONFIRMED-OK | Flag-trap is enforced at THREE layers, incl. the post-turn `ciswireFlags` bit0 assertion on EVERY collected turn; on a ciswire arm with no telemetry the collector throws TELEMETRY GUARD FAIL and the supervisor dies (loud, never silent anchored) | config reject `config.mjs:20-31`; write-time validate+readback `flags.sh:8-20,62-84,86-108`; per-turn assert `collector.mjs:66-72` + `telemetryParse.mjs:113-125`, wired `turn.sh:214-229` |
| F2 | CONFIRMED-OK | Force-stop BEFORE any flag write: `campaign_write_flags` force-stops, then `sql_write` itself DIES if the app is RUNNING — race closed on both sides; wipe also runs app-stopped | `flags.sh:70-75`; `ci-lib.sh:110-126`; `conversation.sh:10-40` |
| I1 | CONFIRMED-OK | Device isolation: zero adb commands target any other serial; `ANDROID_SERIAL` exported once (`supervisor.sh:72-79`) and every adb call is env-scoped; mdns parse filtered to the Jelly prefix; no `192.168.1.152`/Xiaomi/wildcard matches anywhere in campaign scripts (grep) | `recovery.sh:33-47`; grep of `scripts/campaign/**` |
| L1 | CONFIRMED-OK | Logcat captures crash stacks: filter `ReactNativeJS AndroidRuntime libc llama native DEBUG *:W` (not `-s ReactNativeJS`); `-c` clear at conv start; `logcat -d` dump on every reconnect before resume; crash buffer dumped at die | `logcat.sh:13,28-40,42-50`; `ci-lib.sh:214` |
| L2 | PLAUSIBLE-RISK | Two holes: local-stream death restart (`logcat.sh:56-63`) restarts WITHOUT the `-d` dump (ring-buffer gap); `-b crash` only captured on die, not streamed; file truncated per conversation (not per arm) so prior-conversation forensics are gone — datastore remains source of truth | `logcat.sh:34-40,56-63` |
| D1 | CONFIRMED-OK | Append is one `appendFileSync` JSON line per record; checkpoint written AFTER append; abort path appends RECOVERY before checkpoint; resume is checkpoint-driven, not jsonl-driven — exact arm/variant/conv/turn resume verified (incl. skip-completed / new-cell semantics) | `datastore.mjs:25-31,44-50`; `oneTurn.sh:101-105`; `resume.mjs:41-70`; selftest |
| D2 | **DEFECT** | Resume duplicates an in-flight turn: host death mid-turn → checkpoint points at the last COMPLETED turn → on restart the mode_run resume path re-sends that user text unconditionally (`campaign_run_script_turns → campaign_one_turn → campaign_send_turn`), NO "last stored user == script turn" idempotence check (the in-process retry path HAS one). Result: duplicated user message + intent/transcript misalignment in that conversation; corrupts the degradation-slope/probe alignment for it | `oneTurn.sh:80,92-94` vs `supervisor.sh:216-221`; `conversation.sh:83-89` |
| D3 | **DEFECT** | Same-day OUT collision: the dry-run left `checkpoint.json {arm:R1,variant:B,conv:dry-1,turn:3}` in `results/ciswire-campaign/2026-08-25/`; a `--run` started the same calendar day reads it (`resume.mjs:79`) and `convNum("dry-1")=0` → **all cells before (R1,B) — i.e. R1-A × 3 conversations — are silently SKIPPED**. Also: a restart on a *different* day lands in a fresh date dir → run-order regenerated + checkpoint absent → full 48-conversation restart, old day's data orphaned | `supervisor.sh:85-86,195-199`; `resume.mjs:28-40,45-70`; `datastore.mjs:43-57` |
| P1 | CONFIRMED-OK | responseProfile: all metrics deterministic regex/counts on real text; per-100 normalization; empty reply → 0 tokens, drift `und`-safe, no crash on long/odd-unicode input (selftest re-run exit 0); numeric claims defined as "absent from conversation's own text" (the F18 fix) — no world-knowledge | `responseProfile.mjs:96-147`; selftest |
| P2 | PLAUSIBLE-RISK | Lexicon substring overlap double-counts: "potrebbe"⊂"potrebbero", "non posso"⊂"non posso aiutarti con" → small hedge/refusal inflation; per-100 normalization bounds it | `responseProfile.mjs:44-53`; `lexicon.json` |
| P3 | PLAUSIBLE-RISK | Turn-level battery/thermal values are never persisted in the jsonl (only `charging` + timing stamps); `campaign_health` goes to stdout only — the kit's "battery/thermals recorded" is not in the datastore | `oneTurn.sh:57-66`; `watchdog.sh:50-57`; `turn.sh:190-196` |
| M1 | CONFIRMED-OK | prereg math verified numerically against the rev-5 table: δ80=2.802σ√(2/n) → 0.81σ pooled / 1.14σ variant; Holm m=15 first α=0.0033 (0.05/15); floors: echo-rate σ=0.082 → 6.6 pp pooled / 9.4 pp variant; recall σ=0.35 → 0.283; 95% CI of an n=3 delta ±13.1 pp. `provisionalFloors` prints PENDING_PHASE0 until real σ exists; `floorsFromR1` falls back honestly when n<2 — it will report "no significance/insufficient n" numerically rather than spin | `prereg.mjs:17-60,117-147`; node re-check |
| M2 | **DEFECT** | Phase-0 winbudget calibration is not plumbed: `PHASE0_WINBUDGET` is CONSUMED (`flags.sh:89-93`, die if unset) but never PRODUCED — phase0's R2 probe uses a fixed `PHASE0_WINBUDGET_PROBE=256` and writes no calibrated ≈¼-window value anywhere. `--run` therefore dies loudly at the first variant-A cell unless a human hand-exports an unmeasured number. Must-fix #3's "calibrate ≈¼ of measured" and "post-eviction per-turn cost → timeout" are unimplemented (timeout never adjusted either) | `flags.sh:89-93`; `phase0.sh:29-44,84`; grep `PHASE0_WINBUDGET` |
| T1 | CONFIRMED-OK | Keep-awake: screen_off_timeout→24 h, deviceidle whitelist, Termux wake-lock, KEYCODE_WAKEUP; restore trap on EXIT; never uninstall (grep); thermal stop → cooldown → resume SAME arm/conv (turn skipped-if-landed, flagged RECOVERY, retried) | `device-env.sh:86-97`; `ci-lib.sh:1101-1160`; `recovery.sh:128-148` |
| T2 | PLAUSIBLE-RISK | Thermal pause criterion ignores the 42-44 °C battery ceiling: harness pauses on platform status ≥3 only (`device_thermal_status`); ci-lib's own `THERMAL_BATTERY_PAUSE_DECI=440` dual-criterion is unused by the campaign — if the Jelly reports 44 °C at status 2, decoding continues | `recovery.sh:128-134`; `device-env.sh:69-74`; `ci-lib.sh:14-17` |
| T3 | PLAUSIBLE-RISK | Keep-awake ceiling is 24 h while the campaign runs 45-110 h; turn-cadence WAKEUPs usually re-light the screen, but a long cooldown/silent period on day 2+ can sleep the phone → wifi-adb drop + engine stall. Recommend `settings put global stay_on_while_plugged_in 7` before launch | `ci-lib.sh:12-13`; `device-env.sh:92-94` |
| S1 | CONFIRMED-OK | Run order randomized (Fisher-Yates, monotone-R1→R8 reshuffle guard, seed persisted in run-order.json, never regenerated for an existing dir) | `runOrder.mjs:47-65`; `supervisor.sh:195-199` |
| S2 | CONFIRMED-OK | Constraint checks: no `src/**` changes (git diff empty); no full campaign launched (no run-order.json/floors.json anywhere in results/; the only checkpoint/conv is the dry-run's `R1/dry-1`); selftest + `bash -n` all green | `git status`, `find results` |
| S3 | PLAUSIBLE-RISK | `campaign_assistant_count` (every 5 s poll) can `die` on an unparseable conversation index mid-turn → `set -e` kills the supervisor (the exact "burned a 40-min arm" failure named in ci-lib) | `device-share-send.sh:104-108`; `ci-lib.sh:933-946`; `turn.sh:155-157` |
| S4 | CONFIRMED-OK | Eviction stamping exists per conversation (`evictionTurn` sidecar + field) and variant labels are honest ("production cadence", not "no eviction") | `datastore.mjs:62-88`; `campaigns/ciswire.json` variants |
| S5 | PLAUSIBLE-RISK | Off-arm eviction (20-msg cap slide) is unmeasured — `KALSA_DIGEST` only exists on ciswire arms → the must-fix #10 "evictionTurn as covariate" holds for on-arms only; label off-arm eviction by construction, not measurement | `datastore.mjs:67-76`; schema `expectedWhen` |

---

## 2. Answers to the audit questions (terse)

1. **Hang detection** — Real (telemetry-gap + hard timeout, not pidof), but the 12/20-min settings sit below the audit's 30-45-min floor and below a plausible legit single-round duration (telemetry only at round end) → false-positive aborts lose real replies. `fatal_*` = benign evidence files; the die that produced them (NFC overlay) is exactly the H5 fragility.
2. **Recovery** — mDNS→connect re-runs for real; `-r` never uninstalls; models survive; RKStorage pull-before-restart only on pid-death; KV restore resumes same conv; hard-offline bounded (~2-3 min) then die — no infinite loop, but a stall.
3. **Flag-trap** — Enforced at 3 layers incl. the per-turn bit assertion; force-stop precedes every write; sql_write self-guards. A mistyped config cannot silently run anchored.
4. **Device isolation** — Clean: single env-scoped serial, mdns filtered to the Jelly; no other device/wildcard.
5. **Logcat** — Crash stacks captured (AndroidRuntime/native tags + `-d` on reconnect + crash buffer at die); small holes: restart-without-dump, per-conv truncation.
6. **Data integrity** — Append atomic + checkpoint-after-append; EXACT turn resume works; two resume defects: duplicate-send mid-flight (D2) and same-day dry-run checkpoint poisoning (D3).
7. **responseProfile** — Deterministic, edge-safe (empty/unicode/long), drift sound; minor lexicon double-counts.
8. **prereg** — Math is exactly the rev-5 arithmetic; floors honest (PENDING until real σ); no significance will be reported as such.
9. **Screen/thermal/uninstall** — Keep-awake ✓ (24 h ceiling caveat), thermal status-only criterion (battery-hostile caveat), same arm/conv/turn resume ✓, never uninstall ✓.

---

## 3. Must fix before Phase-0

1. **H2 — watchdog settings above the false-positive floor**: `turnTimeoutMs` ≥ 30 min, `telemetryGapMs` ≥ 20 min (audit must-fix #5); ideally gate on Phase-0's measured post-eviction turn cost (must-fix #3) — `campaigns/ciswire.json` + `turn.sh:129-130`.
2. **R3 — pin the campaign APK**: set `"apk"` in `campaigns/ciswire.json` to the debuggable `7c8cce7` apk and make `campaign_find_apk` fail loudly before ever touching `app-release.apk`.
3. **M2 — calibration handoff**: phase0 writes the measured winbudget (≈¼ window) and the supervisor sources it (file or env) before `--run`; document/export `PHASE0_WINBUDGET` otherwise `--run` dies at the first A cell.
4. **H5 — first-send failure must NOT die**: apply the retry-path skip/record discipline to the first attempt (`oneTurn.sh:80` → same as `:100`); keep `die` for device-gone only.
5. **D3 — OUT/collision hygiene**: dry-run/phase0 checkpoint must not poison `--run` (separate OUT dir per mode, or resume.mjs ignores non-`c{n}-{variant}` conv ids); restart should continue in the campaign's start-day dir, not today's (recommend a stable `--out` override).

## 4. Can defer (but know)

- D2 (resume duplicate-send) — acceptable if host restarts only between turns; fix with a pre-send landed-check in the resume path.
- R5/R6, L2, S3 — die-path hardening (restart wrapper, pull-before-restart on all recoveries, logcat restart-with-dump, index-parse die → skip).
- T2/T3, P2, P3, S5 — thermal battery criterion, stay-on-while-plugged, lexicon overlap, per-turn thermal persistence, off-arm eviction labeling.

---

## Verdict: **FIX-AGAIN** (targeted — 5 small items above; no structural redesign)

The harness is fundamentally sound for unattended operation: append-only datastore + checkpoint
resume + real hang watchdog + triple flag-trap + strict device pinning + honest stats. The
must-fix list is exactly the gap between "selftest green" and "3-4 days unattended without a
plausible stall or silent misrun": watchdog settings, the reinstall-APK pin, the winbudget
handoff, the first-send die, and OUT-dir hygiene. Phase-0 should not start until items 1-5 are in.