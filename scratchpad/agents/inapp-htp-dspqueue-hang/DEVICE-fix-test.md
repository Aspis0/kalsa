# Device fix test — engine main a48cc3e08 bounded Hexagon dspqueue (Galaxy S23)

Date: 2026-10-01 02:58–03:22 local. Executor: ZCode agent session (main agent, no
sub-agents), per coordinator task. Followed `FIX-engine.md` (commit under test:
`a48cc3e083ed5516649c038ff390ce4e2ae87308`) and the skel-swap env layout from
`DEVICE-skel-swap.md`.

**Verdict: FIX VERIFIED. All five arms behaved as specified. No SIGABRT anywhere
(exit 134 never seen), no hang, no infinite 1 Hz loop; matched-skels pass at
~527–533 tok/s pp64; stale-skels fail bounded with one clear named error line.**

## Device & preflight

- Transport used: `192.168.1.152:34673` (same-phone mdns transport
  `adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp` also present; the IP transport
  is the one used by the previous skel-swap session). `getprop ro.product.model` =
  **SM-S911U**, `ro.serialno` = **R3CW406P8CV**. Jelly Star never touched
  (not present in `adb devices`).
- Unplugged: `AC powered: false`, `USB powered: false`, `Wireless powered: false`,
  `Dock powered: false`.
- Battery: **38 %** at start (status 3 = discharging), **37 %** at end.
- `persist.traced.enable` = **0** (before and after).
- Screen: `mWakefulness=Awake` throughout; `input keyevent 224` before each arm.
- `am force-stop com.kalsa.app` before the first arm; `pidof` empty before and after.

## Artifacts & hashes

All sha256 verified on the Mac **and** after push on the device — byte-identical,
no exceptions.

| Artifact | sha256 (verified Mac + device) |
|---|---|
| `llama-bench` | `831901f07dd892dc7a85e82e714c36decb96e633edfdff2d2459232db5fc63ce` |
| `llama-cli` | `520ebd7bdca58b47dee2798d46768f6095d70b44996487c5522358a28933e704` |
| `libggml-hexagon.so` | `abafd69a4264172a5fe3fa7055bcf82df6f77f77b7d893a93190a9e14c86662d` |
| matched skel `libggml-htp-v73.so` | `8bb02f50db0703cfc489f109fc34de1fd116cbadf94b4a59a1da133f6401d459` |
| stale skel `libggml-htp-v73.so` | `f81f95e9502e5ffec783e55c1c3994b1857f394c88605a6fc146a66ac2e2f1c7` |

Device layout (per `DEVICE-skel-swap.md` method): binaries + `libggml-hexagon.so`
in `/data/local/tmp/htp-fix/bin/`, stale skel alone in `.../stale/`, matched skel
alone in `.../matched/` (each ADSP dir held exactly one file named
`libggml-htp-v73.so`). Env per arm: `LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib`
(host ggml libs) + `ADSP_LIBRARY_PATH=<armdir>`. `GGML_HEXAGON_RSP_TIMEOUT_MS` left
**unset** in every arm (exercises the default; init line announces
`ggml-hex: batch response timeout 30000 ms`). Hard outer guard
`/system/bin/timeout 120`. Model: `/data/local/tmp/heat3way/ship.gguf`
(LFM2.5-2.6B Q4_0, 1.48 GiB).

Model-location note: the task said the model lives "under `/data/local/tmp/govhtp/`"
— there is **no** `.gguf` anywhere under that tree; the on-device LFM2.5-2.6B Q4_0
is `/data/local/tmp/heat3way/ship.gguf`, the same model file as the pre-fix
skel-swap baseline (sha256 `a247afd6…` per `DEVICE-skel-swap.md`), which is what
makes the ~511 tok/s comparison valid.

## Arms and results

Common protocol per arm: `adb logcat -c` → run under `timeout 120` →
`adb logcat -d | grep -Ei "dspqueue_cpu|ggml-hex|remote_handle"` captured to
`raw/`. Exit codes and wall times are on-device measurements.

| Arm | Skel | Command | EXIT | Wall | Result |
|---|---|---|---:|---:|---|
| M1 | matched | bench `-p 64 -n 0 -r 1` | 0 | 4 s | **PASS** pp64 **532.61 ± 0.00** |
| S1 | stale | bench `-p 64 -n 0 -r 1` | 1 | 3 s | **PASS** bounded fail, no abort |
| S1b | stale | CLI small batch (named-line sidecar) | 0* | 4 s | sequence mismatch line @ 3.6 s |
| S2 | stale | bench `-p 512 -ub 512 -n 0 -r 1` | 1 | 4 s | **PASS** bounded fail, no abort |
| S2b | stale | CLI `-b 512 -ub 512` 608-tok prompt | 0* | 4 s | sequence mismatch @ 3.4 s, n_batch=512 |
| H-matched | matched | CLI + `GGML_HEXAGON_HEALTHCHECK=1` | 0 | 5 s | clean run |
| H-matched-v | matched | bench `-v` + HEALTHCHECK | 0 | 4 s | **`HTP data-plane healthcheck PASS`** |
| H-stale | stale | CLI + HEALTHCHECK | 0* | 34 s | bounded 30.7 s probe timeout, clean exit |
| H-stale-v | stale | bench `-v` + HEALTHCHECK | 1 | 34 s | **`HTP data-plane healthcheck FAIL`** @ 30.7 s |
| M2 | matched | bench control, same as M1 | 0 | 4 s | **PASS** pp64 **526.33 ± 0.00** |

\* llama-cli catches the decode failure ("Compute error.") and exits its
interactive path with code 0; the bench (the task's S1/S2 command) exits **1**.
Exit 134 (SIGABRT) never appeared in any arm. `timeout`-kill (124) never appeared.

### M1 / M2 — matched controls

```
| lfm2 2.6B Q4_0 | 1.48 GiB | 2.70 B | OpenCL,HTP,HTP | 99 | HTP0 | pp64 | 532.61 ± 0.00 |   (M1, EXIT=0, 4 s)
| lfm2 2.6B Q4_0 | 1.48 GiB | 2.70 B | OpenCL,HTP,HTP | 99 | HTP0 | pp64 | 526.33 ± 0.00 |   (M2, EXIT=0, 4 s)
```

vs pre-fix baseline 511.18 / 511.25 (`DEVICE-skel-swap.md`): +3–4 %, same ballpark;
the host build differs (a48cc3e08 vs the earlier df538c50c tree) and the health
check runs at init, so a few percent is plausible. Both controls clean.

### S1 / S2 — stale skel, bounded failure

Visible bench output (llama-bench installs `llama_null_log_callback` at
`llama-bench.cpp:2284` unless `-v`, so the library's named line is suppressed; the
surface evidence is the status propagation):

```
test_prompt: failed to decode prompt batch, res = -3        (GGML_STATUS_FAILED)
llama_bench: error: failed to run prompt warmup
EXIT=1                                                      (3 s @ -p 64, 4 s @ -p 512)
```

Named error line, captured via llama-cli sidecars (same skel, same env):

```
E ggml-hex: HTP0 batch response sequence mismatch : expected 1, got 12884901889
```

- S1b (small batch): mismatch at t=3.6 s of a 4 s run, then
  `srv update_slots: decode() failed: Compute error.`, clean exit.
- S2b (512-token ubatch — the shape that previously hung forever in-app):
  mismatch at t=3.4 s, `srv decode: Compute error. off = 0, n_batch = 512, ret = -3`,
  clean exit.

`12884901889` = 0x3_0000_0001 — the stale skel's old-layout response seq (upper
garbage bits + seq 1): exactly the pre-fix arm-A mechanism
(`GGML_ASSERT(rsp.seq == batch_rsp_seq + 1)` → SIGABRT exit 134 in 3.5 s), now a
single logged session error and a clean non-zero(ish) exit. Pre-fix hang case: see
H-stale — the old skel simply never answers batches it drops, and that path is now
bounded by the 30 s default deadline.

### H — health check

- Matched (bench `-v`, HEALTHCHECK=1): `ggml-hex: HTP data-plane healthcheck PASS`,
  run completes normally (EXIT=0, 4 s).
- Stale (bench `-v`, HEALTHCHECK=1): the 1-op F32 FILL probe batch is dropped by the
  old skel (no response at all), the bounded wait expires at the default deadline,
  the probe reports FAIL, and the session-error gate rejects all further work
  instantly (EXIT=1, 34 s total):

```
E ggml-hex: HTP0 batch response timeout : seq 1 elapsed 30725 ms
ggml-hex: HTP data-plane healthcheck FAIL
graph_compute: ggml_backend_sched_graph_compute_async failed with error -1
test_prompt: failed to decode prompt batch, res = -3
llama_bench: error: failed to run prompt warmup
```

Same shape without `-v` (plain CLI, H-stale): `batch response timeout : seq 1
elapsed 30698 ms` → `decode() failed: Compute error.` → clean exit, 34 s.
**This is the in-app silent-hang mechanism reproduced on purpose and bounded**:
60 `wait_signal` polls over the 30 s wait, then exit — no 1 Hz infinite loop.
Log-level note: the plain (non-`-v`) llama-cli build suppresses INFO-level lines,
so the literal PASS/FAIL line is only visible via `llama-bench -v`; the behavioral
result (probe timeout + gate) is visible in both.

### Logcat summary (all arms)

Passing arms show only the known-benign pattern (identical to the pre-fix
controls): the queue-create version-probe rejection
(`Error 0x80000414 … method 3`), `dspqueue_cpu.c:593: dspqueue_create: created
Queue 0 …`, and teardown-time `Error 0x8000040d`. `wait_signal` count: 0 in every
arm except the two 30 s stale-healthcheck arms (60 lines = bounded polling inside
the deadline wait). **No `Fatal signal` in any arm.**

Cosmetic observation: the bench backend column reads `OpenCL,HTP,HTP` — the static
binaries also dlopen `bin/libggml-hexagon.so` (GGML_BACKEND_DL loader scans the
binary's directory), registering the same fixed backend twice. Single DSP
session/queue per run in logcat; harmless.

## Cleanup & end state

- `/data/local/tmp/htp-fix/` (created by this test) removed; verified gone.
- `/data/local/tmp/govhtp/onecopy-abba/` untouched (listing verified intact:
  `bin/`, `dsp/`, `env.sh`, logs).
- Phone end state: screen on/Awake, unplugged (all `powered=false`), idle,
  battery 37 %, `persist.traced.enable` = 0, `com.kalsa.app` remains force-stopped.

## Raw logs (this directory, `raw/`)

- `fixtest-M1-run.txt` / `fixtest-M1-logcat.txt`
- `fixtest-S1-run.txt` / `fixtest-S1-logcat.txt`
- `fixtest-S1b-run.txt` / `fixtest-S1b-logcat.txt`
- `fixtest-S2-run.txt` / `fixtest-S2-logcat.txt`
- `fixtest-S2b-run.txt` / `fixtest-S2b-logcat.txt`
- `fixtest-Hmatched-run.txt` / `fixtest-Hmatched-logcat.txt`
- `fixtest-Hstale-run.txt` / `fixtest-Hstale-logcat.txt`
- `fixtest-Hmv-run.txt` / `fixtest-Hmv-logcat.txt`   (bench -v, healthcheck PASS)
- `fixtest-Hsv-run.txt` / `fixtest-Hsv-logcat.txt`   (bench -v, healthcheck FAIL)
- `fixtest-M2-run.txt` / `fixtest-M2-logcat.txt`
