# q52 axis-B v2 phase-1 run log

## Contract and scope

- Locked preregistration: commit `1a1c9a19`; this phase performs only generation setup and launch.
- Required context read in full: `PREREG.md`, `SAMPLER_PARAMS.md`, and q49 `run_q49.py`.
- No `prompts.json` edits; no machine checks, `REPORT.md`, or gate computation in phase 1.
- All writes for this task are confined to `scratchpad/agents/q52-axisB-v2/`.

## Preflight evidence

- Commit-lock note recorded before the first llama-cli spawn.
- control GGUF SHA-256: `f3e2826f78c78452afa0765613875c806f1ca3976f1f59ff4e8ff85bea5782ea` — matches PREREG.
- q8_0 GGUF SHA-256: `bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419` — matches PREREG.
- Frozen q49 `prompts.json` SHA-256: `56574436b342d71464b58fd66982a2dbf8b9fb3f5fb14ddf12bf01cca2aacfb9` — matches PREREG; file was not edited.
- `llama-cli.exe` SHA-256: `035ac1a68cff7ffaee243946f66443a95cf436dd8185b14fb458f58f689c1518`; also recorded in `run_manifest.json` before generation.
- Python `shutil.disk_usage` free-space check: approximately 103 GB free at preflight; runner requires at least 10 GiB before starting.
- Prompt inventory check: 60 prompt objects with `id`, `cat`, `lang`, `n_predict`, and `text`; loop-prone IDs `code_en_05` and `long_it_04` are present. Per-prompt `n_predict` values are ignored by the runner.

## CLI flag verification

The actual `build-llama-pc/bin/llama-cli.exe --help` was checked before launch. Every requested spelling is present exactly; no mapping or semantic substitution is needed:

`--temp`, `--top-k`, `--top-p`, `--min-p`, `--repeat-last-n`, `--repeat-penalty`, `--mirostat`, `--seed`, `-cnv`, `--single-turn`, `--no-display-prompt`, `--log-disable`, `--no-warmup`, `--reasoning`.

The runner follows q49's successful invocation pattern: `-f` and `-o` use files, `-c 4096`, `-t 8`, `-ngl 0`, conversation single-turn mode, prompt/log suppression, no warmup, and reasoning off. The locked sampler values are unchanged; only the model path and matrix seed vary among sampler/generation settings, while prompt/output file paths vary as required for each job. Windows process creation uses Idle priority.

## Matrix

- Base: all 60 prompts × seeds `101, 102, 103` × arms `control`, `q8_0` = 360 generations.
- Loop-prone: `code_en_05`, `long_it_04` × seeds `201..210` × both arms = 40 generations.
- Total: 400 generations, sequential, one llama-cli process at a time, `n_predict=1024` for every prompt.
- Resumption: skip any existing non-empty `gen/<arm>/<id>_s<seed>.txt`.

Per-run timing and output-character records are appended to `run.log`; the resumable manifest is `run_manifest.json`.

## Detached launch verification

- Detached runner PID: `783252` (saved in `runner.pid.txt`). A Windows `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` probe returned a non-zero handle while the runner was active.
- First paired final outputs are non-empty: `gen/control/fact_it_01_s101.txt` = 202 bytes and `gen/q8_0/fact_it_01_s101.txt` = 137 bytes.
- First 12 completed generations recorded wall times of 11.06–16.58 s, mean approximately 13.12 s. At that observed rate, the remaining 388 generations are estimated at approximately 85 minutes (roughly 1 hour 25 minutes), excluding variability from prompt length and any interruption.
- `runner.out.log` and `runner.err.log` are the detached process redirections. The runner remains active after this phase-1 handoff.

## 2026-08-24 console-event incident and hardening

- At `16:34:04Z`, the control child for `fact_en_04` seed `102` exited `rc=3221225786` (`0xC000013A`, `STATUS_CONTROL_C_EXIT`) after writing an untrusted 88-character partial output. At `16:34:12Z`, the immediately following q8_0 child for the same prompt/seed exited with the same code and zero output. The runner then took its old STOP path; PID `783252` was confirmed dead. The preceding 50 generations were clean.
- Root cause: the old child `creationflags` used only `IDLE_PRIORITY_CLASS`, so llama-cli inherited the parent console and could receive a console control event from another shell being killed by a timeout on this machine.
- Hardening: llama-cli children now use `IDLE_PRIORITY_CLASS | CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP` (`0x40 | 0x08000000 | 0x00000200`). The runner ignores `SIGINT` and `SIGBREAK` and requests `SetConsoleCtrlHandler(None, True)` on Windows.
- Failure policy: a nonzero or empty run output is deleted and retried once; a second failure is recorded in `failed_runs` and logged as `FAILED-SKIP`, then the matrix continues.
- This is process hygiene only: zero change to the model files, sampler flags, seeds, prompt set, or any locked PREREG measurement design.

## Hardened relaunch verification

- Tainted outputs `gen/control/fact_en_04_s102.txt` and `gen/q8_0/fact_en_04_s102.txt` were deleted and confirmed absent before relaunch.
- Hardened detached runner launched at `16:49:44Z` as PID `10892`; it skipped the 50 existing non-empty clean outputs and resumed at `fact_en_04` seed `102`.
- Regenerated control `fact_en_04_s102`: `rc=0`, non-empty, 47 output characters / 47 bytes.
- Regenerated q8_0 `fact_en_04_s102`: `rc=0`, non-empty, 48 output characters / 48 bytes.
- PID `10892` remains alive under the Windows process probe. The manifest has 56 clean run records and `failed_runs=[]` at this verification point.
- Updated ETA: successful-run mean wall time is 13.06 s across 56 records; 344 remaining generations estimate to approximately 75 minutes, subject to prompt-length variability.
- Final handoff recheck: 61 clean records, `failed_runs=[]`, mean wall time 12.70 s, and 339 remaining generations; updated ETA is approximately 72 minutes.

## Phase 2 machine check

- Integrity preflight: expected `400`, non-empty `400`, missing `0`, empty `0`; manifest records `400`; `failed_runs=[]`.
- DONE reconciliation: `403` lines containing `DONE` including the single `ALL_GEN_DONE` summary; `402` per-generation `DONE` lines; `400` recorded runs; retry excess `2` from the interrupted control/q8_0 attempts.
- `machine_checks.csv` written with the locked columns `id, seed, arm, loop, true_loop, chars` and `400` data rows.
- Machine-check totals: `loop=1` rows `3`; `true_loop=1` rows `3`; `L_B=2`; `L_C=1`.
- Gate verdict: `ESCALATION`; triggering prompts: `code_en_05`, `long_it_04`.
- Escalation seeds `301..310` were not run.
- Anomaly count `chars<10`: `6` rows, all `fact_zh_01` seeds `101..103` for both arms; anomalies are not gated.
- Runtime over the `400` recorded runs: total wall `6671.65` seconds; mean `16.68` seconds/run.
- `REPORT.md` written with paired loop rows, true-loop counts, anomalies, runtime, and the incident reference.

## Escalation execution and final gate

- Arbitration applied: `code_en_05` B′ `1` / control `1` tied and was excluded; `long_it_04` B′ `1` / control `0` supplied the excess. No code_en_05 escalation generations were run.
- Detached escalation PID `2105480` launched at `18:51:14Z` with `ESC_*` telemetry and completed at `19:07:17Z`: `ESC_ALL_GEN_DONE planned=20 recorded_runs=20`.
- Escalation integrity: expected `20`, non-empty `20`, missing `0`, empty `0`, manifest records `20`, failed runs `0`.
- Escalation machine checks written to `machine_checks_esc.csv` with `20` rows; base `machine_checks.csv` remains the 400-row base set.
- Escalation true-loop rows: q8_0 seeds `303`, `306`, `308`, `309`; control true-loop rows `0`.
- Escalation counts: `L_B=4`, `L_C=0`; final cell verdict `FAIL` per the frozen escalation rule.


- `2026-08-24T16:22:54Z` Detached runner verified preconditions again: control sha `f3e2826f78c78452afa0765613875c806f1ca3976f1f59ff4e8ff85bea5782ea`, q8_0 sha `bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419`, prompts sha `56574436b342d71464b58fd66982a2dbf8b9fb3f5fb14ddf12bf01cca2aacfb9`, llama-cli sha `035ac1a68cff7ffaee243946f66443a95cf436dd8185b14fb458f58f689c1518`, free disk `122329841664` bytes; matrix is `400` generations.

- `2026-08-24T16:49:44Z` Detached runner verified preconditions again: control sha `f3e2826f78c78452afa0765613875c806f1ca3976f1f59ff4e8ff85bea5782ea`, q8_0 sha `bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419`, prompts sha `56574436b342d71464b58fd66982a2dbf8b9fb3f5fb14ddf12bf01cca2aacfb9`, llama-cli sha `035ac1a68cff7ffaee243946f66443a95cf436dd8185b14fb458f58f689c1518`, free disk `120399609856` bytes; matrix is `400` generations.

- `2026-08-24T18:30:04Z` Runner completed or reached current resumable frontier; pre-existing non-empty outputs skipped: `50`.

- `2026-08-24T18:51:14Z` Escalation runner started for `long_it_04` only, seeds `301..310`, both arms, 20 generations; code_en_05 excluded by per-prompt arbitration.

- `2026-08-24T19:07:17Z` Escalation runner completed or reached its resumable frontier; pre-existing non-empty outputs skipped: `0`.
