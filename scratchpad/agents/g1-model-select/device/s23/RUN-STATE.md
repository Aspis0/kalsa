# S23 full-run state — 2026-09-09 11:39 EDT

## Verdict: run NOT started — admission condition fails (battery)

The full protocol needs ~6–8 h of sustained inference on the S23. The phone
is at **8 % battery, unplugged** (AC/USB powered: false, status 3
discharging), battery ~40 °C, voltage ~3.5 V and falling; thermal status 2.
Under load the voltage sag would trigger an OS shutdown mid-case, and the
runner's WAL-safe SQL write pushes a full DB copy in one window — a power cut
there risks corrupting the app's RKStorage, leaving the phone worse than
found. Per PROTOCOL.md ("verify admission conditions before booking a cell")
and the run rules ("if the run must stop — thermal, adb loss, quota — write
what was completed and how to resume, then stop"), no inference was started.

Completed: 0 / 48 case-cells (0 / 24 lfm, 0 / 24 minicpm).

## Run header (verified 2026-09-09, for the resume log)

- Phone: SM-S911U (S23), wireless adb 192.168.1.152:5555.
- APK: com.kalsa.app versionName 0.1.0; installed base.apk pulled from
  `pm path` and shasum'ed on the host:
  **sha256 cedd730151baa39bd0b7c19e108eba6e30cd5e133a0b61fec566d208760a5f45**
  (matches the expected main@5707cfe sha; 142,908,690 bytes; pulled copy kept
  at `device/s23/.base.apk`).
- Harness: kalsa repo at 5707cfe; `scripts/device-*.sh` unchanged vs the
  dry-run commit (diff f77ea7b..5707cfe touches no device script) — runner
  sources OK.
- Models on device: files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf,
  files/models/dev-minicpm5-2b/MiniCPM5-2B-Q4_K_M.gguf (1,561,318,368 B).
- Prefs: `kalsa.model.id=lfm2.5-2.6b` (as found), `kalsa.bench.devmodels=1`.
- App: not running (left as found). No files deleted on the phone.

## How to resume (after the phone is charged to ~100 % and unplugged)

    cd .../g1-model-select/device
    { echo "# full run header: apk sha256 cedd730151baa39bd0b7c19e108eba6e30cd5e133a0b61fec566d208760a5f45 (main@5707cfe) — see RUN-STATE.md"; date; } > s23/lfm.run.log
    nohup bash run_device_subset.sh 192.168.1.152:5555 lfm2.5-2.6b \
        subset-24.cases.jsonl s23/lfm.out.jsonl >> s23/lfm.run.log 2>&1 &
    # let the arm finish and the phone cool < 36 °C, charge to 100 %, then:
    { echo "# minicpm arm — apk sha as above; RUN-STATE.md holds the header"; date; } > s23/minicpm.run.log
    nohup bash run_device_subset.sh 192.168.1.152:5555 dev-minicpm5-2b \
        subset-24.cases.jsonl s23/minicpm.out.jsonl >> s23/minicpm.run.log 2>&1 &
    python3 score_device.py s23/lfm.out.jsonl s23/minicpm.out.jsonl \
        --cases subset-24.cases.jsonl | tee s23/SCORE.md

Resume after an interruption: re-run the same command with
`CASE_IDS=<remaining ids>` (append-only out files; rows already recorded for
completed ids stay valid — never re-run completed ids into the same file).
Per-case evidence lands under the runner's OUT dir (e.g. `s23/ev-lfm/`).

Order of the 24 ids (subset-24.txt): C01 C02 C03 C04 C05 C06 C07 I01 I02 I03
I04 I05 I06 I07 I08 I10 I12 I14 M01 M02 M03 M04 T09 T11 (lfm arm first, then
dev-minicpm5-2b — model blocks per PROTOCOL.md, not per-case interleave).

## Readings at stop (2026-09-09 11:38)

battery level 8 %, status 3 (discharging), AC/USB false, battery temp ~40 °C,
Thermal Status 2, app stopped, model pref lfm2.5-2.6b. Phone left idle; no
further inference was run to preserve the charge.

## DIAGNOSIS 2026-09-09 16:50 — arm halted by the user after 11 consecutive send_failed

Rows in s23/lfm.out.jsonl at halt: C01 ok (x2), then C02 C03 C04 C05 C06 C07 I01
I02 I03 I04 I05 all send_failed (one per ~8 min: 3 share attempts + 2
relaunches each).

ROOT CAUSE — runner bug, NOT the app (fix runner-side, planned):
1. PRIMARY: the new-APK override of device_share_send() in run_device_subset.sh
   compares the composer state against `needle` = the FIRST 48 chars of the
   turn (a truncation inherited from the old substring check). The override
   demanded EXACT equality: needle == composer text. Every corpus turn longer
   than 48 chars (C02 "Convert 7 kilometers…two decimals only." = 80 chars;
   C01 "Quanto fa 2 + 2?...numero." = 46 chars PASSED) landed in the composer
   as the FULL text, equality never matched, the runner relaunched the app
   (which DESTROYED the landed text), reshared, re-mismatched, and gave up
   send_failed after ~8 min. Evidence: the arm log shows the composer holding
   the complete message on every failed attempt (e.g.
   "composer mismatch after share (Formatta la frase 'Porta il caricatore
   domani' … nessun altro …)" — the full 100+ char text; uiautomator does NOT
   truncate the EditText text attr). FIX: land-acceptance = composer equals
   the FULL message, not the 48-char prefix.
2. SECONDARY — evidence-path bug: OUT="${OUT:-$OUT_JSONL.d}" is set in the
   runner AFTER `source device-share-send.sh`, whose top-level
   OUT="${OUT:-device-share-send-out}" binds the (then-unset) global OUT to
   device-share-send-out. The whole arm's per-case evidence (pre/ready/end/
   engine.ev/turns.jsonl) landed in device-share-send-out/ instead of
   s23/lfm.out.jsonl.d/. FIX: define OUT before sourcing (or export it).
3. MINOR UNRESOLVED: at arm start the already-ok C01 row (smoke3) was
   re-recorded ("re-run C01 (prior row not fully ok: removed)" while the row's
   turn was ok) — runner_case_need_run did not reproduce this in isolation
   afterwards; re-test during the fix pass.

VERIFIED HEALTHY (probe, 16:47, one manual send via the unmodified
scripts/device-share-send.sh with the app in its post-run state):
phone screenState=ON, mWakefulness=Awake, mDreamingLockscreen=false,
topResumedActivity=com.kalsa.app/.MainActivity; logcat shows
START {act=android.intent.action.VIEW dat=kalsa://share/… cmp=
com.kalsa.app/.MainActivity} at 16:42 with no SecurityException; probe output:
"Activity not started, intent has been delivered to currently running
top-most instance" -> tap 'Invia' at 963,2115 -> "share-send: submitted
prev=0 count=0" (message left the composer; reply persistence pending like
the earlier warm probes). The send path (deep link, foreground app, screen,
composer, Invia) works end-to-end on APK 5707cfe.

Phone state at halt: battery 37 %, charging (AC true), ~41 °C, thermal 2,
app alive and foreground (pid 16425). Runner process killed by the operator;
nothing deleted on the phone; no runner modifications made during this
diagnosis. Resume = apply fix 1+2, delete the 11 send_failed rows
(host-side, they are noise), re-run the arm (C02..T11 = 21 cases + verify
skip of C01-ok).

## FIXES APPLIED 2026-09-09 ~17:00 (runner-side; app untouched; phone untouched)
- run_device_subset.sh: land-acceptance in device_share_send compares the
  composer text with the FULL turn text, whitespace-normalised only
  (share_norm: html.unescape + collapse runs + strip; the uiautomator text
  attr carries the complete message). Fixes the 48-char needle bug that
  caused the 11 send_failed rows.
- run_device_subset.sh: OUT is bound (and exported) BEFORE sourcing
  device-share-send.sh, so evidence lands under s23/ev-lfm (LFM arm) and
  s23/ev-minicpm (MiniCPM arm) instead of device-share-send-out/.
- run_device_subset.sh: watchdog — after each case, if the last 3 rows in
  the out file are all non-ok, logs "WATCHDOG: 3 consecutive failures,
  stopping" and exits 3 (keep-awake restored via the EXIT trap).
- run_device_subset.sh: runner_case_need_run / runner_watchdog_failed
  call sites now test the python STDOUT verdict ("1"=act) instead of the
  exit code — the first version inverted the decision (rc 0 = skip was
  read as "re-run": 2nd arm re-ran the ok C01 and the watchdog fired after
  the first case; both observed and fixed before any case outside C01 ran).
- Host side: s23/lfm.out.jsonl pruned — the 11 send_failed rows (C02..I05)
  were moved to s23/lfm.out.send_failed-2026-09-09.jsonl (C02 rebuilt from
  its evidence files via g1_row.py after a need-run test consumed it; the
  rebuild matches the original schema). C01 kept (newest row).
- Result file baseline for the restarted arm: 1 x C01 ok (conv-
  -1788986959, from the 2nd arm attempt) + C02..T11 pending.

## OWNER STOP 2026-09-10 (S23 MiniCPM5 arm)
- Owner closed G1 and stopped the MiniCPM5 arm at 16/24. SIGINT was sent to
  the runner parent; it remained in the current polling child, so SIGTERM was
  sent to that same runner to release it. The EXIT cleanup completed:
  `case I12 done (rows appended to s23/minicpm.out.jsonl)`, then I14 started,
  followed by `keep-awake: deleted screen_off_timeout` and
  `keep-awake: removed com.kalsa.app from deviceidle whitelist`. No runner
  process remains. I14 was not written; final MiniCPM5 rows are 17 total
  (C01,C02 plus C03..C07,I01..I08,I10,I12), with I01/I06 reply_timeout.
- IDs not run: I14, M01, M02, M03, M04, T09, T11. The app was force-stopped
  on S23 and the runner exit preference write was restored/read back as
  `kalsa.model.id=lfm2.5-2.6b`. No further S23 work was started.
- Score: `s23/SCORE.md`. `score_device.py` does not deduplicate; scoring used
  temporary last-ok-per-id inputs `.score-lfm-last-ok.jsonl` and
  `.score-minicpm-last-ok.jsonl`. The original LFM file is 33 rows/24 ids.
- The runner snapshot diff added `MemAvailable`, `SwapFree`, and `SwapTotal`
  to `.pre`, `.ready`, and `.end` captures. Current-arm `.ready` memory
  values (kB; MemAvailable / SwapFree; SwapTotal was 4194300 for all):

  | case | MemAvailable / SwapFree |
  |---|---:|
  | C03 | 2341964 / 1948164 |
  | C04 | 2297800 / 1950688 |
  | C05 | 2327224 / 1908808 |
  | C06 | 2369256 / 1820616 |
  | C07 | 2295140 / 1870928 |
  | I01 | 2229584 / 2006156 |
  | I02 | 2218516 / 2058032 |
  | I03 | 2299220 / 1943956 |
  | I04 | 2251832 / 1921872 |
  | I05 | 2356224 / 1821372 |
  | I06 | 2354452 / 1777460 |
  | I07 | 2245904 / 1916560 |
  | I08 | 2235356 / 2036320 |
  | I10 | 2302712 / 1984804 |
  | I12 | 2259456 / 1992548 |
