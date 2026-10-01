# Device skel-swap — in-app HTP hang vs host↔DSP-skel protocol skew (Galaxy S23)

Date: 2026-09-30 23:52–23:55 local. Executed per DIAGNOSIS.md §4 ("cheapest device
experiment"), adapted: matched-pair A/B with the onecopy spike host, default two-copy
env, `-p 64 -n 0` instead of the §4 sketch. Purpose: on-device confirmation of H2
(host↔skel protocol skew) by swapping ONLY the DSP skel under an otherwise identical
CLI run. No app build, no root.

## Device & preflight

- Device: `192.168.1.152:34673` — `ro.product.model` = **SM-S911U**,
  `ro.serialno` = **R3CW406P8CV** (Galaxy S23). (The same phone was also visible via
  its `_adb-tls-connect._tcp` transport; all commands used the IP transport.)
- `persist.traced.enable` = **0**.
- Unplugged: `AC powered: false`, `USB powered: false`, `Wireless powered: false`,
  `Dock powered: false`, `Charging state: 0` (51 % before runs, untouched after).
- Screen: `mWakefulness=Awake` before, between, and after the arms (`input keyevent
  224` before each run).
- `am force-stop com.kalsa.app` executed before the first arm; `pidof com.kalsa.app`
  → empty (no pid). Re-checked implicitly: no concurrent DSP session (the three arms
  ran back-to-back under `shell`).

## Artifacts & provenance

| Artifact | sha256 (prefix) | Where verified |
|---|---|---|
| **APK skel** (arm A) `libggml-htp-v73.so`, 653,416 B | `f81f95e9502e5ffec783e55c1c3994b1857f394c88605a6fc146a66ac2e2f1c7` | binding `~/Projects/llama.rn-kalsa-gov-platform/bin/arm64-v8a/` AND inside APK `/tmp/apk-aea90427/…/app-release.apk` at `assets/ggml-hexagon/libggml-htp-v73.so` — **byte-identical** (same sha256 from both sources) |
| **Matched skel** (arm B) `libggml-htp-v73.so`, 836,392 B | `2808f70f0ad480efef4b24c1bd0c327843fe26e2ce0045e9bf36ebc4e96fe7dd` | device `/data/local/tmp/govhtp/onecopy-abba/dsp/` AND Mac build dir `~/Projects/kalsallama-onecopy-hmx/build-onecopy-hmx-fused-v73/ggml/src/ggml-hexagon/` — **byte-identical** |
| Host `llama-bench` | `5bcb3f7478318157c52b1893d68937ea35db8497c13e4a6e396eabba71f840d9` | device `onecopy-abba/bin/`, matches `s23-onecopy-abba-df538c50c/REPORT.md` line 18 |
| Model | `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` | `/data/local/tmp/heat3way/ship.gguf` (lfm2 2.6B Q4_0, 1.48 GiB) — same model as the spike |

Host protocol generation: `git -C ~/Projects/kalsallama-onecopy-hmx merge-base
--is-ancestor eafe15a5e HEAD` → **true** (HEAD = `df538c50c`, the spike tree the host
binary was built from). So the CLI host speaks the NEW opbatch wire protocol, exactly
like the APK's host backend (vendored pin d07d0181b also contains `eafe15a5e`) — which
is what makes it a valid stand-in for the in-app host.

## Arms

Identical except `ADSP_LIBRARY_PATH` (each dir held EXACTLY one file, named
`libggml-htp-v73.so` as the loader expects):

```
# per arm (B = /data/local/tmp/htpskel-swap/armB  [matched skel 2808f70f…]
#          A = /data/local/tmp/htpskel-swap/armA  [APK skel     f81f95e9…]):
adb logcat -c
adb shell 'input keyevent 224; sleep 1; cd /data/local/tmp/govhtp/onecopy-abba/bin && \
  LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib \
  ADSP_LIBRARY_PATH=<armdir> \
  timeout 90 ./llama-bench -m /data/local/tmp/heat3way/ship.gguf \
  -dev HTP0 -ngl 99 -p 64 -n 0 -r 1 2>&1; echo EXIT=$?'
```

Default two-copy env: NO `GGML_HEXAGON_*` variables (confirmed on the A run's init
line: `memory-path env: HOSTBUF=0 HOSTBUF_UNCACHED=0 RAW_HMX=0 RAW_LOCAL=0
RAWROW_PROBE=0`); only `LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib` (host ggml libs,
as in the spike's `env.sh`). Order: **B, A, B**. Hard 90 s timeout via
`/system/bin/timeout`. `logcat -d` filtered with
`grep -E "dspqueue_cpu|remote_handle64_invoke|ggml-hex"` after each arm.

## Results

### B1 (matched skel) — PASS, 3.5 s test

```
| lfm2 2.6B Q4_0 | 1.48 GiB | 2.70 B | OpenCL,HTP | 99 | HTP0 | pp64 | 511.18 ± 0.00 |
EXIT=0
```
logcat (3 lines, all benign): the expected queue-create version-probe rejection, then
success, then a benign teardown-time invoke error:
```
fastrpc_apps_user.c:1382: Error 0x80000414: remote_handle64_invoke failed for handle …, method 3 on domain 3 (sc 0x3010100) (errno Success)
dspqueue_cpu.c:593: dspqueue_create: created Queue 0, 0xb40000775f847c00, DSP 0x00000000 for domain 3
fastrpc_apps_user.c:1382: Error 0x8000040d: remote_handle64_invoke failed … (sc 0x3000000) (errno Success)
```
Zero `wait_signal_locked` lines.

### A (APK skel) — FAIL, abort on first data-plane batch

Table header printed (load, session create, queue create all succeeded — control
plane fine), then:

```
/workspace/ggml/src/ggml-hexagon/ggml-hexagon.cpp:3427: GGML_ASSERT(rsp.seq == this->batch_rsp_seq + 1) failed
0: 0x622f740a10 … 9: 0x7028ab1664 __libc_init
EXIT=134
```
`logcat`: `09-30 23:53:13.267 … Fatal signal 6 (SIGABRT) … pid 31248 (llama-bench)` —
**3.5 s after** `dspqueue_create` (23:53:09.752). Same benign init pair as B
(`Error 0x80000414` + `dspqueue_create: created Queue 0`), zero
`wait_signal_locked` lines — see "Failure-mode note" below for why.

### B2 (matched skel, repeat control) — PASS

```
| lfm2 2.6B Q4_0 | 1.48 GiB | 2.70 B | OpenCL,HTP | 99 | HTP0 | pp64 | 511.25 ± 0.00 |
EXIT=0
```
Same benign 3-line logcat as B1; zero `wait_signal_locked`.

## Interpretation

**Verdict: CONFIRMED.** Same host binary, same model, same bench args, same env shape,
same uid / SELinux domain / unsigned-PD session — the ONLY variable is which
`libggml-htp-v73.so` the FastRPC loader picks up. New-protocol host + matched skel ⇒
two clean passes at ~511 tok/s; new-protocol host + APK skel ⇒ deterministic crash on
the first data-plane batch. That is the host↔skel skew of H2, proven causally on
device.

Failure-mode note (expected per DIAGNOSIS §1.3 footnote): arm A did not reproduce the
in-app *silent* 1 Hz `wait_signal_locked` hang; it hit the sibling outcome the
diagnosis explicitly predicted for the case where the old skel's garbage-count size
check PASSES instead of dropping the packet ("a distinguishable but equally broken
outcome"): the old skel answers the small `-p 64` batch with an OLD-layout response;
the host's `flush_pending` read loop (`~/Projects/kalsallama-onecopy-hmx
ggml/src/ggml-hexagon/ggml-hexagon.cpp:3404-3427`) accepts the packet through the
`rsp_size != sizeof(rsp)` sanity check, then dies at `:3427`
`GGML_ASSERT(rsp.seq == this->batch_rsp_seq + 1)`. In the app, the first real prefill
ubatch (hundreds of tensors/ops) fails the old skel's size check instead, no response
is ever written, and the host spins forever — same root cause (old wire format in the
frozen `bin/arm64-v8a` skels vs post-`eafe15a5e` host), two batch-size-dependent
manifestations. Also re-confirmed: H1's `Error 0x80000414 … method 3` appears in ALL
THREE arms including both passing controls — definitively benign.

## Cleanup

- Removed `/data/local/tmp/htpskel-swap/` (both arm dirs). Verified gone.
- `/data/local/tmp/govhtp/onecopy-abba/` left untouched (verified listing intact).
- Local `/tmp/apk-aea90427/` restored to its original content (extraction dir removed;
  the APK itself untouched).
- Phone end state: screen on/Awake, unplugged (all `powered=false`), idle,
  `persist.traced.enable` = 0. `com.kalsa.app` remains force-stopped (was stopped on
  purpose before the runs; it will restart on next launch).

## Raw logs (this directory)

- `raw/skelswap-B1-run.txt`, `raw/skelswap-B1-logcat.txt`
- `raw/skelswap-A-run.txt`, `raw/skelswap-A-logcat.txt`
- `raw/skelswap-B2-run.txt`, `raw/skelswap-B2-logcat.txt`
