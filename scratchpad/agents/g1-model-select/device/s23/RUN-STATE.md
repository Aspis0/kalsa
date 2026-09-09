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
