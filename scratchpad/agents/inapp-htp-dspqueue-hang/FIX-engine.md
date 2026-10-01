# Hexagon dspqueue hang fix — simplified engine, recipe for the S23 run

Date: 2026-10-01. Repository: Aspis0/kalsallama, branch main. No push, no device
was used by the engine session. The existing untracked CMakeUserPresets.json was
not staged or modified. This revision supersedes the 643332f8f recipe: the
coordinator simplification removed the health-probe session and all queue
locking, so the old recipe's health-check arms and env knobs no longer exist.

## Commits

- 643332f8fcdc2b344064c5fb4c991fe1d4705c90 — prior fix head (probe + global mutex build; superseded)
- 9f3c2e069 — kalsallama main 643332f8f: simplify the Hexagon dspqueue fix — drop the probe session and all queue locking

Final HEAD: 9f3c2e069 (new commit on top of 643332f8f; no history rewrite).

## Engine state after the simplification

Diff vs e775fb2bf (start of the fix series) shrank from 336+/26- to 205+/29- in
ggml/src/ggml-hexagon/ggml-hexagon.cpp only; htp/htp-ops.h is untouched by the
whole series at this head. graph_compute, cpy_tensor_async_phys, device_init and
get_proc_address are pristine upstream again.

Removed: the data-plane health probe (device_healthcheck / device_status /
probe session / GGML_HEXAGON_HEALTHCHECK / GGML_HEXAGON_PROBE_TIMEOUT_MS /
rsp_timeout_override plumbing / dead valid_session flag), and both queue
mutexes (the process-wide opt_dspqueue_mutex and the per-session op_mutex). No
lock exists on any dspqueue path, so no lock is held across a DSP wait. The
stale-skel root cause is prevented at build time in the binding instead (skel
and host built from the same engine commit); the engine keeps only the runtime
safety net.

Kept (r2-audit verified): bounded batch wait (GGML_HEXAGON_RSP_TIMEOUT_MS,
default 30000 ms, accepted range 1..600000 ms, strict decimal parse);
deadline-bounded fence wait in event_synchronize, polling every 200 us with no
lock held; exact req/rsp shape equality incl n_ops via opqueue req_shape[slot];
all aborts reachable from a skewed/dead DSP replaced by set_error + log
(dspqueue_write x2, get_tensor_async x2, enqueue_op fit failure, dspqueue_read,
event response, release teardown); sticky fail-fast guards on every entry point
so llama_decode returns -3 instead of aborting. Also closed at this head:
r2 N10 (enqueue_mdev_group error guard), r2 N11 (buffer_clear skips the memset
on an errored session; release_buffer logs instead of GGML_ASSERT), r2 N9
symmetric (set_error marks virt/phys peers as well as mdev subs).

## Build and artifacts

- Host: cmake --build build-metal -j8 — EXIT=0 (hexagon disabled in this host
  configuration; the Android build below compiled and linked the changed file).
- Source archive: git archive HEAD — EXIT=0, SHA-256
  fbdebcc5548ce9e1c45a1d656a328069c718ee1957fbe514d127df33fe79a991.
- Android built from that archive in one docker run --rm --platform linux/amd64
  -i -u 501:20 with ghcr.io/snapdragon-toolchain/arm64-android:v0.7; the
  checkout was not bind-mounted; the untracked preset was mounted at
  /preset.json and copied into the extracted tree. Full log:
  ~/Projects/kalsallama-htpfix-android-artifacts/9f3c2e069/build-summary.log
  (plus container-build.sh, conf/build logs).
- Static configure/build (llama-cli, llama-bench): attempt 1 EXIT=1 (known
  transient OpenCL embed_kernel generate step), attempt 2 EXIT=0.
- Shared Hexagon configure/build (ggml-hexagon, htp-v73): attempt 1 EXIT=0.
- No compiler warnings from ggml-hexagon.cpp in any build log. Binary sanity:
  libggml-hexagon.so carries the new init banner "ggml-hex: batch response
  timeout %u ms" and no healthcheck/probe strings.

Android artifact SHA-256 (~/Projects/kalsallama-htpfix-android-artifacts/9f3c2e069/):

| Artifact | SHA-256 |
|---|---|
| llama-bench | ede63f2203b50fd94e1656e0a861943f5286e42dd6dcb6640b6b28c78d7b2a14 |
| llama-cli | 99dce3dc086450210031d3cd1f404ba3a70c3545a4ff14f6f66f3981238c83b1 |
| libggml-hexagon.so | 5a663b0e701a965d7b16fd6fde30b6cde648c743ebfda4178a9c515e1eb51ad8 |
| libggml-htp-v73.so | 4b822b583a50c570f67e3526dddd6992797d45a87335aaa63eda531cd4b50b0c |

## S23 test recipe — not run here

Five arms: M1 matched pp64, M1b matched pp512, M2 matched pp64 control repeat,
S1 stale pp64, S2 stale pp512. There is no health-check arm: the probe was
removed, and GGML_HEXAGON_HEALTHCHECK / GGML_HEXAGON_PROBE_TIMEOUT_MS are no
longer read by the engine. Run every bench arm with -v (llama-bench installs a
null log callback without it, which would hide the named error lines). Leave
GGML_HEXAGON_RSP_TIMEOUT_MS unset everywhere to exercise the 30000 ms default;
the init line "ggml-hex: batch response timeout 30000 ms" confirms it. Keep the
standard preflight (unplugged; never benchmark while charging).

    S23=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
    ART=~/Projects/kalsallama-htpfix-android-artifacts/9f3c2e069
    RAW=~/Projects/kalsa-moe-experiments/scratchpad/agents/inapp-htp-dspqueue-hang/raw/final-9f3c2e069
    DEV=/data/local/tmp/htp-fix
    STALE=~/Projects/llama.rn-kalsa-gov-platform/bin/arm64-v8a/libggml-htp-v73.so
    mkdir -p "$RAW"
    shasum -a 256 "$STALE"
    adb -s "$S23" shell 'mkdir -p /data/local/tmp/htp-fix/bin /data/local/tmp/htp-fix/stale /data/local/tmp/htp-fix/matched /data/local/tmp/htp-fix/lib'
    adb -s "$S23" push "$ART/llama-bench" "$DEV/bin/llama-bench"
    adb -s "$S23" push "$ART/libggml-hexagon.so" "$DEV/lib/libggml-hexagon.so"
    adb -s "$S23" push "$STALE" "$DEV/stale/libggml-htp-v73.so"
    adb -s "$S23" push "$ART/libggml-htp-v73.so" "$DEV/matched/libggml-htp-v73.so"

Per-arm template ( Arms: M1/M2 use matched, S1/S2 use stale, -p 64; M1b uses
matched, -p 512 -ub 512 ). Shell timeout is an outer guard only (40 s over the
30 s deadline for stale arms, 120 s for matched arms):

    adb -s "$S23" shell 'logcat -c'
    set +e
    adb -s "$S23" shell 'cd /data/local/tmp/htp-fix; start=$(date +%s); \
      LD_LIBRARY_PATH=/data/local/tmp/htp-fix/lib:/data/local/tmp/govhtp/lib \
      ADSP_LIBRARY_PATH=/data/local/tmp/htp-fix/<matched|stale> \
      timeout <40|120> ./bin/llama-bench -v -m /data/local/tmp/heat3way/ship.gguf \
      -p <64|512> -n 0 <-ub 512> -ngl 99 -dev HTP0 -r 1 \
      > /data/local/tmp/htp-fix/<arm>.log 2>&1; rc=$?; elapsed=$(($(date +%s)-start)); \
      echo "<ARM> BENCH_EXIT=$rc ELAPSED_SECONDS=$elapsed"'
    adb -s "$S23" pull "$DEV/<arm>.log" "$RAW/<arm>.log"
    adb -s "$S23" logcat -d -v threadtime > "$RAW/<arm>.logcat.txt" 2>&1
    set -e

Required evidence:

- M1 / M2 (matched, pp64): BENCH_EXIT=0 and the pp64 row. Historical context:
  pre-fix two-copy baseline 511.18/511.25 tok/s (DEVICE-skel-swap.md), and
  526.33-532.61 tok/s measured on the earlier bounded-wait host
  (DEVICE-fix-test.md, a48cc3e08 — a no-mutex host). Anything in that 511-533
  ballpark is consistent; M2 repeats M1 to show run-to-run stability.
- M1b (matched, pp512 -ub 512): BENCH_EXIT=0 and the pp512 row, compared
  against the pre-fix documented two-copy band 878.3-882.4 tok/s (856.2-882.4
  full gate band, s23-onecopy-abba-df538c50c/REPORT.md:56). This arm is the
  throughput regression gate the mutex build never measured: a material drop
  below that band would mean the kept fence-wait/entry-point changes cost
  prefill throughput.
- S1 / S2 (stale, pp64 / pp512 -ub 512): BENCH_EXIT=1 (never 124, never 134)
  within ~35 s, "test_prompt: failed to decode prompt batch, res = -3", and one
  clear ERROR line from the engine:
  "ggml-hex: <session> batch response sequence mismatch : expected <n>, got <n>"
  (the typical stale-skel signature) or
  "ggml-hex: <session> batch response timeout : seq <n> elapsed <ms> ms"
  (if the old skel drops the batch silently). The stale skel is
  ~/Projects/llama.rn-kalsa-gov-platform/bin/arm64-v8a/libggml-htp-v73.so,
  sha256 prefix f81f95e9.
- All arms: the init line "ggml-hex: batch response timeout 30000 ms".

## Not verified

No phone was used. All five arms, both skel outcomes, and the pp512 comparison
against the 878-882 band remain for the coordinator to run. pp512 has never
been measured on this engine line; the historical bands come from pre-fix
hosts (df538c50c-era), so a few percent of host-side drift is expected — the
gate is the ballpark, not equality.
