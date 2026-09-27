#!/usr/bin/env bash
# fake-adb.sh — fake adb for this cell's dry-run. One responsibility:
# impersonate exactly the adb surface d_run.sh + restore.sh use (devices,
# get-state, wait-for-device, shell, push, pull) and answer from a per-fixture
# state dir, with reading injection so dryrun.sh can prove every stop, kill and
# restore. No device, no phone, no adb binary.
#
# Format fidelity (audit B-11, audit5 item-4): every LOGGER line is prefixed
# `<h>.<mm>.<ss>.<ms> <L> ` — byte-shape confirmed against the real f25f0c1c5
# S23 logs (qdc-heat-3way/raw/s23-calib-3/calib: `0.00.429.043 I …`,
# `0.00.325.939 D …`); placement/offload/buffer/device lines are copied
# verbatim from them. `GGML_OPENCL_LOG_KERNELS:` (fprintf) and the
# shell-appended `EXIT=` line are deliberately UNPREFIXED, as on the real
# device. Placement lines are emitted ONLY for `-lv 5` (DEBUG) / `-lv 4`+
# (INFO) commands — a measured turn never gets DEBUG.
#
# Knobs (exported by dryrun.sh):
#   DRY_<X>_AT / DRY_<X>_AFTER  reading X takes AFTER from call # AT onward
#       (AT defaults to 1): X in TEMP, THERMAL, LEVEL, PLUGGED, SKIN
#   DRY_MISS_TEMP=1 [DRY_MISS_TEMP_AT=N]  blank the battery temp (fail-closed)
#   DRY_SYSFS_TEMP=N            /sys battery temp (default 310 = dumpsys)
#   DRY_ARM_SLEEP_S             fake llama wall time per run (default 0)
#   DRY_ARM_RC                  remote exit code of the run (default 0)
#   DRY_PUSH_SLEEP_S            sleep per push (default 0)
#   DRY_NO_GPU_PROOF=1          too few drafter GPU placement lines
#   DRY_GPU_KERNELS=N           GGML_OPENCL_LOG_KERNELS count (default 6)
#   DRY_JITTER=1                overshoot on adjustment attempts = nmax
#                               (content-dependent, exercises MATCH_MAX)
#   DRY_NEVER_MATCH_ARM=<arm>   that arm always reports DRY_NEVER_MATCH_N
#   DRY_NEVER_MATCH_N=N         (default 132) -> non-converging match
#   DRY_KILL_FAIL=1             pkill does NOT kill: KILL_VERIFY must fail
#   DRY_HTP_LEAK=1              HTP0/session-failure lines in BOTH logs of a
#                               PINNED command (rc stays 0 -> parse gate)
#   DRY_TURN_HTP=1              same, TURN log only (proof stays clean)
#   DRY_CTX_MISMATCH=1          emit n_ctx=128000 (train ctx) even with -c
#                               (audit9 gate coverage)
#   DRY_PGREP_BROKEN=1          pgrep self-test fails -> setup aborts (exit 4)
#   DRY_PGREP_BREAK_AT=N        pgrep works for call #1 (self-test) then breaks
#   DRY_RESTORE_PUT_FAIL=1      the restore-time settings write fails (NEW-1)
#   DRY_N_DECODED_MISMATCH=1    the `decoded <N>` line disagrees with
#                               `n_predict = <N>` (audit3 count cross-check)
#   DRY_TURN_DISABLED=1          the TURN log carries the OpenCL
#                               `kernel set failed … device disabled` line
#                               (audit4 N-B2 silent-failure model)
#   DRY_TURN_NO_MARKER=1         the TURN log lacks the draft-load marker
#   DRY_TURN_NO_PLACEMENT=1      the TURN log lacks ALL INFO placement lines
#                               (AUDIT5 N-C2: "does -lv 4 admit them?")
#   DRY_TURN_PARTIAL=1           a C turn offloads only 3/6 drafter layers
#                               (AUDIT5 N-C1 partial-offload gate)
#   DRY_TURN_GPU_LEAK=1          an A/B turn offloads 3/6 drafter layers
#   DRY_TURN_INTERACTIVE=1       the TURN log carries `== Running in
#                                interactive mode. ==` (audit6 gate)
#   DRY_PROOF_INTERACTIVE=1      same, in the PROOF log
# Audit6b: KNOWN_SPEC_FLAGS above rejects unknown/misspelled flags (exit 65).
set -euo pipefail
STATE="${FAKE_ADB_STATE:-/tmp/dspark-spec-fake}"
DEV="$STATE/dev"
mkdir -p "$DEV"
CELL="$(cd "$(dirname "$0")" && pwd)"
PROMPT_SHA=$(awk '{print $1}' "$CELL/PROMPT.meta")
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
DRAFT_SHA=85a98fafdaf1328b6876fd1360d7ed69e74c6cefc14dd07fb6306e1940386c87
KIT_SHA=bd6be0a4808c35885318647fede6ef91dfa8f3fe4366a4a706f5110ae45447df

n_lines() { if [ -f "$STATE/log_lines" ]; then cat "$STATE/log_lines"; else echo 0; fi; }
pfx() {   # <level> -> "<h>.<mm>.<ss>.<ms> <L> "
  local n
  n=$(( $(n_lines) + 1 ))
  echo "$n" > "$STATE/log_lines"
  printf '0.00.%03d.%03d %s ' $((n / 1000)) $((n % 1000)) "$1"
}
lg() { pfx "$1"; shift; printf '%s\n' "$*"; }

count_up() { local f="$STATE/$1"
  if [ -f "$f" ]; then echo $(( $(cat "$f") + 1 )) > "$f"; else echo 1 > "$f"; fi
  cat "$f"
}
pick() { if [ -n "${2:-}" ] && [ "$4" -ge "${1:-1}" ]; then printf '%s' "$2"; else printf '%s' "$3"; fi; }

# pgrep_is_broken: shared counter over every pgrep-ish call (self-test,
# health probe, verdict). DRY_PGREP_BROKEN=1 breaks them all (the self-test
# must then abort the session); DRY_PGREP_BREAK_AT=N breaks call #N onwards
# (self-test passes, a later verdict fails closed).
pgrep_is_broken() {
  local n
  n=$(count_up pgrep_calls)
  if [ "${DRY_PGREP_BROKEN:-0}" = 1 ]; then return 0; fi
  if [ -n "${DRY_PGREP_BREAK_AT:-}" ] && [ "$n" -ge "$DRY_PGREP_BREAK_AT" ]; then return 0; fi
  return 1
}

dump_battery() {
  local n temp lvl plug miss
  n=$(count_up batt_reads)
  temp=$(pick "${DRY_TEMP_AT:-}" "${DRY_TEMP_AFTER:-}" 310 "$n")
  lvl=$(pick "${DRY_LEVEL_AT:-}" "${DRY_LEVEL_AFTER:-}" 88 "$n")
  plug=$(pick "${DRY_PLUGGED_AT:-}" "${DRY_PLUGGED_AFTER:-}" 0 "$n")
  miss=""
  if [ "${DRY_MISS_TEMP:-0}" = 1 ] && [ "$n" -ge "${DRY_MISS_TEMP_AT:-1}" ]; then miss=temp; fi
  if [ "$miss" = temp ]; then temp=""; fi
  local p=false
  if [ "$plug" = 1 ]; then p=true; fi
  cat <<EOF
Current Battery Service state:
  AC powered: $p
  USB powered: false
  Wireless powered: false
  Dock powered: false
  status: 2
  health: 2
  present: true
  level: $lvl
  voltage: 4200
  temperature: $temp
  technology: Li-ion
EOF
}

dump_thermals() {
  local n skin status
  n=$(count_up therm_reads)
  skin=$(pick "${DRY_SKIN_AT:-}" "${DRY_SKIN_AFTER:-}" 33.5 "$n")
  status=$(pick "${DRY_THERMAL_AT:-}" "${DRY_THERMAL_AFTER:-}" 0 "$n")
  cat <<EOF
IsStatusOverride: false
Thermal Status: $status
Thermal Statuses from API:
  mStatus=0
Current temperatures from HAL:
  Temperature{mValue=$skin, mType=3, mName=SKIN, name2=skin}
  Temperature{mValue=45.0, mType=0, mName=cpu-0}
Current cooling devices from HAL:
  Temperature{mValue=10.0, mType=15, mName=fan0}
EOF
}

# emit_ctx_block: the real llama_context / llama_kv_cache INFO lines, formats
# verbatim from src/llama-context.cpp:308-311 and src/llama-kv-cache.cpp:324
# (as seen in raw/s23-dspark-3/A-p.log:818-821,863); values come from the
# command's -c/-b/-ub (audit9: no -c meant the train ctx 128000).
emit_ctx_block() {
  printf '0.00.900.010 I llama_context: n_ctx                 = %u\n' "$c"
  printf '0.00.900.011 I llama_context: n_ctx_seq             = %u\n' "$c"
  printf '0.00.900.012 I llama_context: n_batch               = %u\n' "$b"
  printf '0.00.900.013 I llama_context: n_ubatch              = %u\n' "$ub"
  printf '0.00.900.020 I llama_kv_cache: size = %7.2f MiB (%6u cells, %3d layers, %2u/%u seqs), K (f16): %7.2f MiB, V (f16): %7.2f MiB\n' "$kv" "$c" 8 1 1 "$kvk" "$kvk"
}

# run_arm <cmd>: synthesize the pulled llama-speculative-simple log.
# Overshoot model: A -> +1; spec arms -> nmax+1, EXCEPT adjustment attempts
# under DRY_JITTER (= nmax) and DRY_NEVER_MATCH_ARM (fixed N, non-converging).
#
# Flag allowlist (audit6b): every flag the driver may pass to
# llama-speculative-simple. Anything else is REJECTED (exit 65 +
# shell_bad_flags.log) — a misspelling (`--no-cnv`; the real spelling is
# `-no-cnv`/`--no-conversation`, common/arg.cpp:1899-1900) or a flag that
# belongs to another binary (`-no-cnv`, `-cnv`, `-st` are completion-only and
# spec-simple would reject them too) must never pass the dry-run silently.
KNOWN_SPEC_FLAGS='^-m$|^-md$|^--spec-type$|^--spec-draft-n-max$|^--spec-draft-n-min$|^--spec-draft-p-min$|^-f$|^-n$|^--temp$|^--top-k$|^--seed$|^-t$|^-ngl$|^-ngld$|^-dev$|^-devd$|^-c$|^-b$|^-ub$|^-fit$|^-lv$'
run_arm() {
  local cmd=$1 tag limit nmax n i k kernels o n_predict dpn drafted accept rc gpu=0
  local badf
  badf=$(printf '%s\n' "$cmd" | tr ' ' '\n' | grep -E '^--?[A-Za-z0-9]' | grep -v -E "$KNOWN_SPEC_FLAGS" || true)
  if [ -n "$badf" ]; then
    {
      printf 'CMD: %s\n' "$cmd"
      printf 'BAD: %s\n' "$(printf '%s' "$badf" | tr '\n' ' ')"
    } >> "$STATE/shell_bad_flags.log"
    printf 'fake-adb: unknown flag(s): %s\n' "$(printf '%s' "$badf" | tr '\n' ' ')" >&2
    exit 65
  fi
  tag=$(printf '%s\n' "$cmd" | grep -o 'dspark-spec/[A-Za-z0-9._-]*\.log' | head -1 | sed 's#.*/##; s#\.log$##') || tag=""
  [ -n "$tag" ] || tag=unparsed.log
  limit=$(printf '%s\n' "$cmd" | sed -n 's#.* -n \([0-9][0-9]*\) .*#\1#p')
  nmax=$(printf '%s\n' "$cmd" | sed -n 's#.*--spec-draft-n-max \([0-9][0-9]*\).*#\1#p')
  [ -n "$limit" ] || limit=127
  [ -n "$nmax" ] || nmax=0
  if printf '%s' "$cmd" | grep -q -- '-devd GPUOpenCL'; then gpu=1; fi
  : > "$STATE/proc_running"      # the remote process exists while we sleep
  local slp="${DRY_ARM_SLEEP_S:-0}"
  case "$tag" in *-p) slp="${DRY_PROOF_SLEEP_S:-0}" ;; esac
  if [ "$slp" -gt 0 ]; then sleep "$slp"; fi
  o=1
  if [ "$nmax" -gt 0 ]; then o=$((nmax + 1)); fi
  if [ "${DRY_JITTER:-0}" = 1 ] && [ "$nmax" -gt 0 ]; then
    case "$tag" in *-m[0-9]*) o=$nmax ;; esac
  fi
  n_predict=$((limit + o))
  if [ -n "${DRY_NEVER_MATCH_ARM:-}" ]; then
    case "$tag" in "${DRY_NEVER_MATCH_ARM}"*) n_predict="${DRY_NEVER_MATCH_N:-132}" ;; esac
  fi
  case "$nmax" in
    0) drafted=0; accept="nan%" ;;
    4) drafted=$((n_predict * 2)); accept="56.000%" ;;
    *) drafted=$((n_predict * 3)); accept="39.000%" ;;
  esac
  dpn=$n_predict
  if [ "${DRY_N_DECODED_MISMATCH:-0}" = 1 ]; then dpn=$((n_predict + 7)); fi
  # audit9: context/batch values follow the command; a missing -c (run 2 / the
  # old command) means the train ctx 128000, and DRY_CTX_MISMATCH forces it so
  # the ctx gate can be exercised with a pinned command.
  c=$(printf '%s\n' "$cmd" | sed -n 's#.* -c \([0-9][0-9]*\) .*#\1#p')
  b=$(printf '%s\n' "$cmd" | sed -n 's#.* -b \([0-9][0-9]*\) .*#\1#p')
  ub=$(printf '%s\n' "$cmd" | sed -n 's#.* -ub \([0-9][0-9]*\) .*#\1#p')
  [ -n "$c" ] || c=128000
  [ -n "$b" ] || b=2048
  [ -n "$ub" ] || ub=512
  if [ "${DRY_CTX_MISMATCH:-0}" = 1 ]; then c=128000; fi
  kv=$(awk -v c="$c" 'BEGIN{printf "%.2f", c/64}')       # real: 128000 -> 2000.00 MiB
  kvk=$(awk -v c="$c" 'BEGIN{printf "%.2f", c/128}')     # real: 128000 -> 1000.00 MiB
  rc="${DRY_ARM_RC:-0}"
  # mode: `-lv 5` = proof run, anything else with `-lv` = measured turn (-lv 4).
  mode=measure
  case "$cmd" in *"-lv 5"*) mode=proof ;; esac
  # AUDIT5 N-C2 turn knobs (measure logs only — the proof run must stay intact).
  local no_place=0 no_marker=0
  if [ "$mode" = measure ]; then
    if [ "${DRY_TURN_NO_PLACEMENT:-0}" = 1 ]; then no_place=1; fi
    if [ "${DRY_TURN_NO_MARKER:-0}" = 1 ]; then no_marker=1; fi
  fi
  # audit8: without `-dev none` the kit registers Hexagon, llama's default
  # selection puts the target on HTP0, the session open fails and the run
  # SIGSEGVs (verbatim replay of raw/s23-dspark-2/A-p.log:51-52,856,858,859 +
  # bare `Segmentation fault` + `EXIT=139`, rc 139). The driver pins the
  # devices, so unpinned only fires on a regression (red); the knobs force the
  # gate on a PINNED command (rc stays 0 -> parse gate must catch it).
  local unpinned=0 htp=0
  case "$cmd" in *" -dev none"*) : ;; *) unpinned=1 ;; esac
  htp=$unpinned
  if [ "$mode" = measure ] && [ "${DRY_TURN_HTP:-0}" = 1 ]; then htp=1; fi
  if [ "${DRY_HTP_LEAK:-0}" = 1 ]; then htp=1; fi
  if [ "$unpinned" = 1 ] && [ -z "${DRY_ARM_RC:-}" ]; then rc=139; fi
  {
    lg I "load_tensors: loading model tensors, this can take a while... (load_mode = none)"
    # audit6: completion's interactive banner (tools/completion/completion.cpp:484)
    # — knobbed per run kind so BOTH parse gates get a red fixture.
    if { [ "$mode" = measure ] && [ "${DRY_TURN_INTERACTIVE:-0}" = 1 ]; } || \
       { [ "$mode" = proof ] && [ "${DRY_PROOF_INTERACTIVE:-0}" = 1 ]; }; then
      lg I "== Running in interactive mode. =="
    fi
    # INFO placement lines: hidden at default, admitted at -lv 4. Shapes and
    # values below are copied verbatim from the real f25f0c1c5 S23 logs
    # (qdc-heat-3way/raw/s23-calib-3/calib, same ship model): the target pair
    # is byte-identical to calcpu.log; the drafter's `6` denominators are
    # source-derived (5 dflash layers + 1) and declared UNVERIFIED.
    if printf '%s' "$cmd" | grep -q -- '-lv ' && [ "$no_place" -eq 0 ]; then
      lg I "load_tensors: offloading 0 repeating layers to GPU"
      lg I "load_tensors: offloaded 0/31 layers to GPU"
      lg I "load_tensors:          CPU model buffer size =   206.07 MiB"
      lg I "load_tensors:   CPU_REPACK model buffer size =  1511.20 MiB"
    fi
    # audit9: target context block + fit-probe lines; only for a pinned run
    # (an unpinned run crashes before the context is ever printed) and only
    # at -lv 4+ (LLAMA_LOG_INFO), exactly like the real logs.
    if [ "$unpinned" -eq 0 ] && printf '%s' "$cmd" | grep -q -- '-lv '; then
      emit_ctx_block
      if ! printf '%s' "$cmd" | grep -q -- '-fit off'; then
        printf '0.00.900.030 I operator(): getting device memory data for the extra model at a context size of %u:\n' "$c"
        printf '0.00.900.040 E llama_init_from_model: failed to initialize the context: dflash requires ctx_other to be set (this warning is normal during memory fitting)\n'
        printf '0.00.900.050 W operator(): failed to measure the memory of the extra model, fitting without it: failed to create llama_context from model\n'
      fi
    fi
    if printf '%s' "$cmd" | grep -q -- '-lv 5'; then
      i=0; while [ "$i" -lt 24 ]; do printf '0.00.%03d.%03d D load_tensors: layer %3d assigned to device CPU, is_swa = 0\n' "$((50 + i))" "$i" "$i"; i=$((i + 1)); done
    fi
    # audit8 HTP lines, shapes/values verbatim from raw/s23-dspark-2/A-p.log.
    if [ "$htp" = 1 ]; then
      if [ "$unpinned" = 1 ]; then
        lg I "llama_prepare_model_devices: using device GPUOpenCL (QUALCOMM Adreno(TM)) (unknown id) - 2512 MiB free"
      fi
      lg I "llama_prepare_model_devices: using device HTP0 (Hexagon) (unknown id) - 0 MiB free"
      lg E "ggml-hex: HTP0 failed to open session : uri file:///libggml-htp-v73.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0 error 0x80000406"
      lg E "llama_init_from_model: failed to initialize the context: ggml-hex: failed to open session (see log for details)"
      if [ "$unpinned" = 1 ]; then
        lg E "common_fit_params: encountered an error while trying to fit params to free device memory: failed to create llama_context from model"
        printf 'Segmentation fault\n'
        printf 'EXIT=%s\n' 139
      fi
    fi
    # the crash happened BEFORE the draft ever loads: no marker, no draft,
    # no stats — same shape as the real A-p.log tail.
    if [ "$unpinned" -eq 0 ]; then
    if [ "$no_marker" -eq 0 ]; then
      lg I "common_speculative_init_result: loading draft model '/data/local/tmp/dspark-spec/draft.gguf'"
    fi
    if [ "$gpu" = 1 ]; then
      lg I "llama_prepare_model_devices: using device GPUOpenCL (QUALCOMM Adreno(TM)) (unknown id) - 2512 MiB free"
    fi
    lg I "load_tensors: loading model tensors, this can take a while... (load_mode = none)"
    if printf '%s' "$cmd" | grep -q -- '-lv ' && [ "$no_place" -eq 0 ]; then
      if [ "$gpu" = 1 ]; then
        lg I "load_tensors: offloading output layer to GPU"
        lg I "load_tensors: offloading 4 repeating layers to GPU"
        if [ "$mode" = measure ] && [ "${DRY_TURN_PARTIAL:-0}" = 1 ]; then
          lg I "load_tensors: offloaded 3/6 layers to GPU"   # AUDIT5 N-C1 partial offload
        else
          lg I "load_tensors: offloaded 6/6 layers to GPU"
        fi
        lg I "load_tensors:       OpenCL model buffer size =   340.00 MiB"
      else
        lg I "load_tensors: offloading 0 repeating layers to GPU"
        if [ "$mode" = measure ] && [ "${DRY_TURN_GPU_LEAK:-0}" = 1 ]; then
          lg I "load_tensors: offloading 2 repeating layers to GPU"
          lg I "load_tensors: offloaded 3/6 layers to GPU"   # AUDIT5 N-C2 leak
        else
          lg I "load_tensors: offloaded 0/6 layers to GPU"
        fi
        lg I "load_tensors:          CPU model buffer size =   340.00 MiB"
      fi
    fi
    # audit9: the DRAFTER's own context (common/speculative.cpp:2550 copies
    # the target's) — second block, same values, after the marker.
    if printf '%s' "$cmd" | grep -q -- '-lv '; then
      emit_ctx_block
    fi
    if printf '%s' "$cmd" | grep -q -- '-lv '; then
      if [ "$mode" = measure ] && [ "${DRY_TURN_DISABLED:-0}" = 1 ]; then
        lg W "ggml_opencl: kernel set failed to build on 'kernel_00' (driver 'Adreno'); device disabled, ops stay on CPU"
      fi
    fi
    if printf '%s' "$cmd" | grep -q -- '-lv 5'; then
      if [ "$gpu" = 1 ]; then
        i=0
        if [ "${DRY_NO_GPU_PROOF:-0}" = 1 ]; then
          while [ "$i" -lt 2 ]; do printf '0.00.%03d.%03d D load_tensors: layer %3d assigned to device GPUOpenCL, is_swa = 0\n' "$((200 + i))" "$i" "$i"; i=$((i + 1)); done
        else
          while [ "$i" -lt 5 ]; do printf '0.00.%03d.%03d D load_tensors: layer %3d assigned to device GPUOpenCL, is_swa = 0\n' "$((200 + i))" "$i" "$i"; i=$((i + 1)); done
        fi
        k=0; kernels="${DRY_GPU_KERNELS:-6}"
        while [ "$k" -lt "$kernels" ]; do printf 'GGML_OPENCL_LOG_KERNELS: kernel_%02d\n' "$k"; k=$((k + 1)); done
      else
        i=0; while [ "$i" -lt 5 ]; do printf '0.00.%03d.%03d D load_tensors: layer %3d assigned to device CPU, is_swa = 0\n' "$((300 + i))" "$i" "$i"; i=$((i + 1)); done
      fi
    fi
    printf '0.00.900.001 I decoded %4d tokens in %8.3f seconds, speed: %8.3f t/s\n' "$dpn" 8.0 \
      "$(awk -v n="$n_predict" 'BEGIN{printf "%.3f", n / 8.0}')"
    lg I "n_draft   = $nmax"
    lg I "n_predict = $n_predict"
    lg I "n_drafted = $drafted"
    lg I "n_accept  = 0"
    lg I "accept    = $accept"
    printf 'EXIT=%s\n' "$rc"
    fi   # audit8: unpinned crash skipped marker/draft/stats
  } > "$DEV/$tag.log"
  rm -f "$STATE/proc_running"
  exit "$rc"
}

handle_shell() {
  local cmd="$*" err=""
  # audit4-adj (cell A died on an assembled `&& &&`), AUDIT5 N-C7: syntax-check
  # every command string with dash (POSIX, closest to the device's mksh —
  # cell A does the same) BEFORE answering it — a broken command must fail its
  # fixture loudly (exit 64 + log), never be silently absorbed by a case
  # branch or an `|| true` in the driver.
  if ! err=$(/bin/dash -n -c "$cmd" 2>&1); then
    {
      printf 'CMD: %s\n' "$cmd"
      printf 'ERR: %s\n' "$err"
    } >> "$STATE/shell_syntax_errors.log"
    printf 'fake-adb: shell syntax error: %s\n' "$err" >&2
    exit 64
  fi
  case "$cmd" in
    # pgrep self-test (d_run setup): FOUND + GONE, unless the fixture breaks
    # pgrep from this very call onwards (counter shared with the verdict path).
    *PGREP_SELFTEST*)
      if pgrep_is_broken; then
        echo PGREP_SELFTEST=MISS
        echo PGREP_SELFCLEAN=STILL
        exit 0
      fi
      # audit7: EXECUTE the real string under dash instead of pattern-matching
      # it — a spawn that fails for real (the quoted-"$q" trap: the shell
      # looks for ONE command literally named `sleep 12345`, spawns nothing)
      # must surface as PGREP_SELFTEST=MISS straight from the shell.
      /bin/dash -c "$cmd" || true
      exit 0 ;;
    # audit7: the health probe is EXECUTED for real under dash (no hand model
    # left): the answer comes from this Mac's own pgrep. Bracketed → PROBE=1
    # on host AND device (the only form the driver sends); a plain literal
    # self-matches on the S23's toybox (proven, run aaeeae16 class) though
    # macOS pgrep does not reproduce it — either way the bracketed probe is
    # unaffected. Knob precedence keeps DRY_PGREP_*.
    *zzz_no_such_proc*)
      if pgrep_is_broken; then echo PROBE_BROKEN; exit 0; fi
      /bin/dash -c "$cmd" || true
      exit 0 ;;
    *pgrep*)
      if pgrep_is_broken; then echo PGREP_BROKEN; exit 0; fi
      if [ -f "$STATE/proc_running" ]; then echo ALIVE; else echo GONE; fi
      exit 0 ;;
    *pkill*)
      printf '%s\n' "$cmd" >> "$STATE/pkill.log"
      case "$cmd" in
        *"llama-speculative-simpl[e]"*)
          # audit B-1: the fake models a real kill unless DRY_KILL_FAIL=1
          if [ "${DRY_KILL_FAIL:-0}" != 1 ]; then rm -f "$STATE/proc_running"; fi ;;
      esac
      exit 0 ;;
    *"sha256sum -c"*)
      if [ -f "$STATE/kit_unpacked" ]; then
        printf 'bin/llama-completion: OK\nbin/llama-speculative-simple: OK\nlib/libggml-opencl.so: OK\n'
        exit 0
      fi
      echo "sha256sum: SHA256SUMS: No such file or directory" >&2; exit 1 ;;
    *sha256sum*ship.gguf*)
      if [ -f "$STATE/present_ship" ]; then printf '%s  %s\n' "$MODEL_SHA" "/data/local/tmp/dspark-spec/ship.gguf"; exit 0; fi
      echo "sha256sum: No such file or directory" >&2; exit 1 ;;
    *sha256sum*draft.gguf*)
      if [ -f "$STATE/present_draft" ]; then printf '%s  %s\n' "$DRAFT_SHA" "/data/local/tmp/dspark-spec/draft.gguf"; exit 0; fi
      echo "sha256sum: No such file or directory" >&2; exit 1 ;;
    *sha256sum*prompt.txt*)
      if [ -f "$STATE/present_prompt" ]; then printf '%s  %s\n' "$PROMPT_SHA" "/data/local/tmp/dspark-spec/prompt.txt"; exit 0; fi
      echo "sha256sum: No such file or directory" >&2; exit 1 ;;
    *sha256sum*kit.tgz*)
      if [ -f "$STATE/present_kit" ]; then printf '%s  %s\n' "$KIT_SHA" "/data/local/tmp/dspark-spec/kit.tgz"; exit 0; fi
      echo "sha256sum: No such file or directory" >&2; exit 1 ;;
    *"tar -xzf"*)
      if [ -f "$STATE/present_kit" ]; then : > "$STATE/kit_unpacked"; exit 0; fi
      echo "tar: kit.tgz: No such file" >&2; exit 1 ;;
    *llama-speculative-simple*) run_arm "$cmd" ;;
    *"dumpsys thermalservice"*) dump_thermals; exit 0 ;;
    *"dumpsys battery"*) dump_battery; exit 0 ;;
    *power_supply/battery/temp*) echo "${DRY_SYSFS_TEMP:-310}"; exit 0 ;;
    *"getprop ro.soc.model"*) echo SM8550; exit 0 ;;
    *"settings get system screen_off_timeout"*) cat "$STATE/screen_timeout" 2>/dev/null || echo null; exit 0 ;;
    *"settings get global stay_on_while_plugged_in"*) cat "$STATE/stayon" 2>/dev/null || echo null; exit 0 ;;
    *"settings put system screen_off_timeout"*)
      v="${cmd##* }"
      # DRY_RESTORE_PUT_FAIL=1 fails the RESTORE write only (never the setup
      # mutation): audit2 NEW-1 fixture — a failed restore must keep the state.
      if [ "${DRY_RESTORE_PUT_FAIL:-0}" = 1 ] && [ "$v" != "1800000" ]; then
        echo "Error: settings put failed" >&2
        exit 1
      fi
      printf '%s\n' "$v" > "$STATE/screen_timeout"; exit 0 ;;
    *"settings put global stay_on_while_plugged_in"*) printf '%s\n' "${cmd##* }" > "$STATE/stayon"; exit 0 ;;
    *"settings delete system screen_off_timeout"*) rm -f "$STATE/screen_timeout"; exit 0 ;;
    *"settings delete global stay_on_while_plugged_in"*) rm -f "$STATE/stayon"; exit 0 ;;
    *"svc power stayon"*) printf '3\n' > "$STATE/stayon"; exit 0 ;;
    *"input keyevent"*) exit 0 ;;
    *) printf '%s\n' "$cmd" >> "$STATE/unknown_shell.log"; exit 0 ;;
  esac
}

# ---- argv ----
if [ "${1:-}" = "-s" ]; then shift 2; fi
verb="${1:-}"
[ $# -gt 0 ] && shift
case "$verb" in
  devices)
    printf 'List of devices attached\n%s\tdevice\n' "${FAKE_SERIAL:-fakes23}"
    exit 0 ;;
  get-state) echo device; exit 0 ;;
  wait-for-device) exit 0 ;;
  push)
    if [ "${DRY_PUSH_SLEEP_S:-0}" -gt 0 ]; then sleep "$DRY_PUSH_SLEEP_S"; fi
    case "$(basename "${2:-}")" in
      kit.tgz) : > "$STATE/present_kit" ;;
      ship.gguf) : > "$STATE/present_ship" ;;
      draft.gguf) : > "$STATE/present_draft" ;;
      prompt.txt) : > "$STATE/present_prompt" ;;
    esac
    printf 'pushed %s\n' "$(basename "${2:-}")" >> "$STATE/push.log"
    exit 0 ;;
  pull)
    if [ -f "$DEV/$(basename "${1:-}")" ]; then
      cp "$DEV/$(basename "${1:-}")" "${2:-/dev/null}"; exit 0
    fi
    echo "fake-adb: cannot stat '$1'" >&2; exit 1 ;;
  shell) handle_shell "$*" ;;
  *) echo "fake-adb: unhandled verb: $verb" >&2; exit 1 ;;
esac
