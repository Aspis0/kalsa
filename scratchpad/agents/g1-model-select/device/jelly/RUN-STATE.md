# Jelly G1 full-run state — 2026-09-09

## Run header

- Phone: Unihertz Jelly Star; USB adb `JELLYS0000053795` only. S23/Xiaomi are out of scope.
- APK: `main@4b29466`, `com.kalsa.app` versionName 0.1.0; installed base.apk pulled from `pm path`; sha256 `30253a561638d24a776c09e95887edd3f931ef8cb87add2d9331699725ab7934` (142,912,926 bytes).
- Models: `lfm2.5-2.6b` and `dev-minicpm5-2b`; MiniCPM5 GGUF sha256 `ec2d5801640099e97d8d7e8003ad4d81f336e757811f03a26173dddf386602fd`.
- Prefs before arm: `kalsa.model.id=lfm2.5-2.6b`, `kalsa.bench.devmodels=1`; battery 100%, 33 °C at preflight, Thermal Status 0.
- S23 reference arm used `main@5707cfe`; Jelly uses the same prompts and tool loop, with the later prewarm fix, document prefill-budget routing, and answer-language cue. No S23/Xiaomi command was issued here.
- Runner: on-disk uncommitted `run_device_subset.sh`, unchanged; Jelly timeouts explicitly set in the arm environment to `REPLY_TIMEOUT=600`, `READY_TIMEOUT=600` (the runner's Jelly defaults, already larger than S23-sized values). G1 thermal gate unchanged: pause status >=3 or battery >=41.0 °C; resume status <=1 and battery <38.0 °C.
- Probe before arm (75 chars): `device_share_send` returned rc 0; evidence: `share: submitted (composer empty, prev=0)`.

## Outputs

- `lfm.out.jsonl`, `ev-lfm/`, `lfm.run.log`; then `minicpm.out.jsonl`, `ev-minicpm/`, `minicpm.run.log`.
- Completed rows are never re-run; three consecutive non-ok rows stop the arm with exit 3. Thermal pauses are allowed and are not failures.

## Resume

- Order is the 24 ids in `subset-24.txt`, LFM first then MiniCPM5. Resume by using `CASE_IDS` for ids without a fully-ok row; do not re-run ok ids into the same output.
- Update this file at arm completion with row counts, wall time, readings, and the exact resume filter if interrupted.

## Stopped at first non-OK row

- Probe: 75-character text; `device_share_send` returned rc 0 and logged `share: submitted (composer empty, prev=0)`.
- Foreground supervisor restart began 2026-09-09 19:21:32 EDT after an earlier host-background attempt was reaped with zero rows. First successful LFM row: C01, `ok`, 242 s; ready RSS 2,265,248 kB, HWM 2,338,140 kB, battery 33.0 °C, Thermal Status 0.
- LFM first non-OK: monitor checkpoint 2026-09-09 21:51:39 EDT, row `M02`, `send_failed`, turn 4, duration 729 s. Exact full row: `lfm.first-nonok-row.json`; case evidence: `ev-lfm/case-M02.*`; arm log: `lfm.run.log`.
- M02 evidence recorded pre-gate battery 39.0 °C/status 0, ready battery 39.0 °C/status 3, end battery 39.0 °C/status 3. This was a `send_failed` row, not a thermal pause, so the stop rule fired. At cleanup the Jelly was 100%, 38.0 °C, Thermal Status 3; app force-stopped; screen timeout restored to `null`, and `com.kalsa.app` removed from the Doze whitelist.
- The detached runner child continued briefly after the supervisor interrupt and appended M03 `not_run` and M04 `ok`; these post-stop rows are retained but are not counted as a valid continuation. No MiniCPM5 arm or `SCORE.md` was started. No S23/Xiaomi process was touched.
- Resume: use the same on-disk runner and `subset-24.cases.jsonl` against the existing output; its skip logic will leave fully-ok ids alone and rerun M02/M03. Do not start MiniCPM5 until LFM is complete and cool per `PROTOCOL.md`.

## Resume plan for remaining LFM cases

- The remaining-case file is `lfm-remaining.cases.jsonl`, in source order: M02, M03, T09, T11. The original `lfm.out.jsonl` rows are preserved; because the on-disk runner removes partial rows when rerunning an id, the resumed runner will write to a temporary arm JSONL and append those new rows to the original afterward. This keeps the old M02 `send_failed` and M03 `not_run` rows for audit. The morning score input will dedupe by id, selecting the last `ok` row when one exists, otherwise the last row; `score_device.py` itself does not dedupe.
- M02 review note (hypothesis, not verdict): `lfm.run.log` records turn 3 settled after 25 s, while the device was at Thermal Status 3; turn 4 then logged `node 'Send' NOT FOUND` three times. The likely runner false-settle sequence is that the 20 s quiet window fired while LFM was still generating on the throttled CPU, leaving the app without a visible Send node. This is flagged for morning review and is not classified as an app bug from this evidence.
- Resume protocol: watch the new arm every 30 s for newly written rows and report every non-ok row; reset the consecutive counter on `ok`, stop only at 3 consecutive non-ok rows, and leave the thermal gate unchanged. On success, cool per `PROTOCOL.md`, run all 24 MiniCPM5 cases, dedupe both model inputs by last-ok-per-id into temporary score files, then write `SCORE.md`.

## LFM remaining arm completed

- `lfm-remaining.cases.jsonl` ran M02, M03, T09, T11 in order. New-row statuses: `M02=send_failed`, `M03=ok`, `T09=ok`, `T11=ok`; the watcher logged only one non-OK, so the three-consecutive stop threshold was not reached. The four rows were appended to `lfm.out.jsonl`; original M02/M03 rows remain in that audit file.
- The old supervisor then entered its cool loop and printed `thermal_status=unknown` because its awk expected `Current thermal status:`. It was stopped before MiniCPM5. The replacement is `supervise_g1_minicpm.sh`: it parses `/[Tt]hermal [Ss]tatus:/`, logs numeric status, caps cooling at 1800 s with `COOL-TIMEOUT`/exit 4, keeps the three-consecutive non-OK watcher, and starts only MiniCPM5 plus scoring.

## Corrected MiniCPM5 arm and final score

- The old supervisor was stopped after all four LFM-remaining rows were appended. The corrected copy `supervise_g1_minicpm.sh` then logged numeric cooling readings, beginning `2026-09-09 23:16:09 EDT cool waited=0s battery_deciC=380 thermal_status=0`; it started MiniCPM5 with exactly one Jelly runner (`run_device_subset.sh ... JELLYS0000053795 ...`). First row was `C01=ok`.
- LFM final audit file has 26 rows: 23 `ok`, two `send_failed` rows for the retained/original and resumed M02, and one retained `M03=not_run`. The last-ok-per-id score input (`lfm-score-dedup.jsonl`) has 24 rows: 23 `ok`, `M02=send_failed`; resumed `M03`, `T09`, and `T11` were `ok`.
- MiniCPM5 completed all 24 rows: 23 `ok`, `M02=send_failed`; the three-consecutive watcher never fired because surrounding rows were `ok`. The case-level M02 failure followed the runner's Send-node recovery/relaunch; it is retained for morning review.
- Scoring used `lfm-score-dedup.jsonl` and `minicpm-score-dedup.jsonl` because `score_device.py` does not dedupe. `SCORE.md` completed with `score_rc=0`; the score reports LFM median promptMs 6212.4 / tok_s 3.4 and MiniCPM5 median promptMs 13008.3 / tok_s 2.3, with the listed case mismatches/tool failures and M02 send failures.
- Cleanup verified on USB Jelly only: `kalsa.model.id=lfm2.5-2.6b`, `kalsa.bench.devmodels=1`, app stopped, thermal status 0, battery 37.0 °C, screen timeout `null`, and no Kalsa Doze whitelist entry. `run_device_subset.sh` was not edited; no S23/Xiaomi command was issued.
