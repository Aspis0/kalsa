# S23 governor LFM long run — run-book (2026-09-27)

Goal: one **unplugged 20–30 turn LFM2.5-2.6B session on the S23 with the
governor ON**. Pass: no Android SEVERE, correct answers, every route/pause
recorded. Device agent: run these from the app worktree; nothing else.

Worktree: `/Users/marco/Projects/kalsa-wt-iroh` at `69ca91ec` (contains the
campaign changes: engagement gate, governor+env per-turn fields, stop line).

## 0. Preconditions (tonight)

- `cd /Users/marco/Projects/kalsa-wt-iroh`
- Pre-flight self-tests, both must exit 0:
  ```sh
  npm run harness:campaign > /tmp/rt.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/rt.log      # expect EXIT=0, "selftest ok"
  bash scripts/campaign/selftest_defects.sh > /tmp/rd.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/rd.log   # expect EXIT=0, "passed=68 failed=0"
  ```
- Device endpoint must match the config exactly: `campaigns/t20c.json` declares
  `"device": "192.168.1.152:43089"`. Connect so that `adb devices` lists that
  serial (S23 may answer on the TLS endpoint
  `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` instead — if only the TLS
  serial is alive tonight, the config's `device` must be edited by the
  coordinator; the runner refuses any mismatch by design).
  ```sh
  adb connect 192.168.1.152:43089 || true
  adb devices            # must list 192.168.1.152:43089 ... device
  ```
- Phone **unplugged** (the runner refuses charging at preflight), battery
  **≥ 85 %** (`CAMPAIGN_MIN_BATTERY_LEVEL`), screen on/Kalsa installed.
- `CAMPAIGN_APK_PATH` must point at the APK **installed on the phone** (the
  Metro provenance gate verifies the bundle; the APK must be built from this
  worktree).

## 1. The run

```sh
cd /Users/marco/Projects/kalsa-wt-iroh
ANDROID_SERIAL=192.168.1.152:43089 \
CAMPAIGN_APK_PATH=/path/to/app-release.apk \
bash scripts/campaign/run-t20c.sh > /tmp/t20c.log 2>&1; echo "EXIT=$?"
```

- The runner **writes `kalsa.governor.enabled=1` itself** before the launch
  that loads the model, then **refuses to start** unless the load plan says
  `KALSA_GOVERNOR_PLAN {"gpu_fit":"Fit"}` — no manual Settings toggle needed;
  if the gate fails the run dies with `governor not engaged before turn 1`.
- Evidence lands in `results/t20c-campaign/` (`logcat.txt`, `T20C/c1-V1.jsonl`
  per-turn records incl. `telemetry.KALSA_GOVERNOR*` and `env`:
  thermalStatus/skin/battTemp/batteryLevel/plugged).

## 2. Stop lines (all automatic, before SEVERE)

- unplugged **thermal status ≥ 3** or **battery ≥ 44 °C** → hard abort, run ends
- **plugged = true** mid-run → stop (the run is unplugged by design)
- **battery level ≤ 25 %** → stop
- never writes `kalsa.bench.thermo` (a source-level selftest pins it)

## 3. Scoring / verdict

- Per-turn answers + scores are in the jsonl (`assistant`, `scores`);
  T20C's acceptance is the verdict tool:
  ```sh
  node scripts/campaign/verdict.mjs results/t20c-campaign --turns 20; echo "EXIT=$?"   # EXIT=0 = PASS
  ```
- Watch live: `adb -s 192.168.1.152:43089 logcat -d | grep -E "SEVERE|KALSA_GOVERNOR "`
  — any Android SEVERE voids the run.

## 4. Resume / reruns

- Same command resumes from `checkpoint.json` **only if** the acceptance jsonl
  is absent/empty; a partial jsonl is refused by design — move it aside (or set
  a fresh `OUT=...`) before restarting.
