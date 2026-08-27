# PREREG — `s23-plugged-baseline`

**DRAFT — NOT LOCKED.** This document is a preparation draft only. No benchmark or model load was performed. Day-1 cleanup, model staging, and correctness certification are recorded in `RUN_LOG.md` and `CERT_DAY0.md`.

Device: S23, exact ADB serial `adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp`. Device must be online over the already-paired wireless transport; if it is offline, stop and report BLOCKED. Never `adb connect` to an IP. Battery must be >=45% and **plugged declared** for every planned arm.

## Pin and correctness gate

Use the preserved `/data/local/tmp/s3oracle/` set as the day-1 pin: all 11 device SHA-256 values are in `PINNED_SET.md`. Lineage is consolidated head `1882bf8cd`, K2 `c1bb48d32`, qk23 `ec7235af`, barrier-safe queue #13 `9a4112106`. The current set is functionally certified in `CERT_DAY0.md`; it differs from the archived barrier PC record in 3/11 shared objects.

Models staged on device (exact PC/device SHA match):

- `/data/local/tmp/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf`, 4,213,513,024 bytes, `3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe`.
- `/data/local/tmp/Marco-Mini-Instruct-KEXP.gguf`, 6,385,238,848 bytes, `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777`.

Before speed cells:

- `test-backend-ops -o MUL_MAT_ID`: all required types and lineup shapes, including dense-vs-reference checks; acceptance 407/407.
- `test-backend-ops -o MUL_MAT`: dense suite; acceptance 925/925.
- Roundtrip/raw-zero checks; acceptance zero failures and no unexpected nonzero residuals.
- Record device SHA-256 for `test-backend-ops`, `llama-bench`, every loaded `.so`, and both GGUFs before the first cell and in every run manifest.

## Speed matrix

Models: `Marco-Mini-Instruct-KEXP.gguf` and `OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf`.

Arms, identical except offload: A = `-ngl 99`; C = `-ngl 0`. Both must include `-nr -fa off`. Run pp512 and tg128 for each model. Use N >= 3 ABBA blocks per model/workload: `A, C, C, A`; never mix models, flags, thermal classes, or cpuset state inside a block. Report medians and all raw rows; do not claim absolute speed across different harnesses.

The model-load time is excluded from pp/tg measurements but recorded separately. One llama process at a time. No silent fallback: a load/placement failure is an invalid cell, not a CPU result.

## Thermal, cool-start, and guard

Every planned cell, correctness suite, and thermal profile runs with the q56 guard: WARN 40 °C, KILL 43 °C, poll 10 s. The exact reusable guard is `scratchpad/agents/q56-thermal-watchdog/thermal_guard.sh`; wrapper style is `scratchpad/agents/q56-thermal-watchdog/launch_with_guard.py` (reuse only after removing/disabled reconnect behavior; this task permits no re-pairing or IP connect).

The plan §0 cool-start class is now **`cool`**, filled from `T_idle_plugged = 27.8 °C` (median of the settled last-10-minute window in `THERMAL_SNAPSHOT.md`). The compact recapture was AC-powered, screen-off, and remained below 32 °C. The first full 30-minute capture was lost to terminal truncation; the compact recapture is the recorded datum. Per the draft scheme:

- idle <32 °C: `cool_start_class=cool` — **selected**; `T_idle_plugged=27.8 °C`;
- idle >=32 °C and <38 °C: `cool_start_class=plugged-warm`, relative gate = idle + 3 °C, hard max 36 °C, KILL 43 °C;
- idle >=38 °C: suspend GPU/NPU speed cells; correctness only, <=5 min.

Recorded offsets for this draft: the selected cool class has no plugged-warm relative offset; the fallback plugged-warm relative gate would be `27.8 + 3.0 = 30.8 °C`, with hard max 36 °C and KILL 43 °C.

Record screen state, battery level, battery temperature, all thermal zones, and plugged state in every manifest. Planned thermal-only profiles (guard on, plugged declared): 5 min CPU load, then cooldown/idle record, then 5 min GPU load. These are thermal profiles, not performance claims.

## Cpuset gate

Reuse the gate style from `results/lineup_abs_s23/one_cell_lineup.sh` and the evidence format in `results/lineup_abs_s23/probes/*_HARNESS_cpuset.txt` and `*_BIN_cpuset.txt`: `nproc >= 6`, affinity popcount >=6, allowed list recorded, and cpuset/cgroup must not contain `background`, `system-background`, or `moderate`. Record `/proc/<pid>/cpuset`, `Cpus_allowed_list`, and the harness mask per cell. Gate failure is a skipped/invalid cell (historical harness convention: exit 93), never a result.

## Hygiene / exact stop rule

Thermal guard (WARN 40 / KILL 43), cool-start ≤ 32 °C, battery ≥ 45 %, unplugged declared, exact stop rule (CDSP0 CRASHED / dspqueue_* failed / INTERNAL-ERROR / ggml_abort / GGML_ASSERT / Aborted / Segmentation / rc ≥ 128 not from the guard), no deletions, no pushes except the binary (and only if free space allows), sha on device. Outputs: RUN_LOG.md, manifest.json, raw/ (engine csv + traces + sampler), REPORT.md (numbers only + both shares + headroom table).

For future speed cells, the plan requires **plugged declared**. The owner-approved preparation permitted only the two model pushes and correctness certification recorded here; no further pushes or deletions are permitted. Stop immediately on any listed token, guard kill, cpuset failure, battery/plug failure, ADB loss, or model hash mismatch. Do not retry by reconnecting or re-pairing.

Day-1 preparation status: cleanup complete; model hashes match; current `s3oracle` is certified `407/407` MoE and `925/925` dense under the q56 guard. Storage after staging was `104G` total, `92G` used, `12G` available, `89%`. Plugged reference recorded: `T_idle_plugged=27.8 °C`, `cool_start_class=cool`. This preregistration remains **DRAFT — NOT LOCKED**.

## Outputs and budget

Planned outputs: `RUN_LOG.md`, `manifest.json`, `raw/` (engine CSV, thermal sampler, guard traces), `REPORT.md`, and per-run SHA/cpuset/thermal records under this cell directory. Include `STORAGE_LEDGER.md`, `DROP_CHAIN.md`, `THERMAL_SNAPSHOT.md`, and `TOOLCHAIN_CHECK.md` as prerequisites; this draft is not a lock.

Budget: Phase 1 target ~1 h device time per the signed-off plan; hard wall cap 2 h, with <=10 min per individual cell. The full draft matrix is correctness + 2 models x 2 workloads x 3 ABBA blocks x 4 arms-in-order = 48 short invocations, plus 5 min CPU and 5 min GPU thermal profiles. If the cap is reached, stop and report the incomplete matrix; no partial speed claim.
