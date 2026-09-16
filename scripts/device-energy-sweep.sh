#!/usr/bin/env bash
# Core-placement energy sweep for the Jelly Star.
#
# This is deliberately a separate instrument from device-ngram-spec.sh. It
# answers one narrow Fase 2b question: does moving decode from the two A76
# cores to the six A55 cores change decode J/token enough to justify the
# latency cost? The sampler and phase-stamp paths are the same audited paths;
# only the taskset wrapper and the block schedule are new.
#
# Default comparison schedules, per model. Each arm invocation is a
# temperature-gated three-repetition block:
#   primary_t2: a55_t2 a76_t2 a76_t2 a55_t2
#   a55_t6:    a55_t6 a76_t2 a76_t2 a55_t6
#   control:   none
#   promptlen: p128 p256 p512 p1024 p1024 p512 p256 p128
#
# promptlen asks a different question on the same instrument: prefill energy
# as a function of prompt length (the price of one chat-window slide). Its
# arms select a generated prompt of a nominal token length instead of a CPU
# mask (placement stays the unset control), and the order is a forward-then-
# reverse sweep so any block-level drift shows up as a forward↔reverse
# disagreement. The report fits j_prefill against MEASURED prompt tokens
# (v3 stamped prompt_n): the slope is the marginal prefill cost of a slide —
# the number that matters mid-session — and the intercept is whatever fixed
# per-invocation cost remains. Measured on the reference phone (2026-09-16),
# prefill is genuine compute at roughly 5 tokens/s with the rate falling
# slowly with length; the earlier page-in story is refuted, so the lengths
# are 128..1024 and the whole block fits one charge.
#
# The first two are ABBA blocks. The unset-mask control is run as its own
# block and is reported separately. No device command runs at source time.
#
# Example (do not run without an explicit device decision):
#   ANDROID_SERIAL=192.168.1.82:5555 \
#   OUT=device-energy-sweep-out \
#   scripts/device-energy-sweep.sh
#
# Optional environment:
#   LOCAL_BIN             default: ../tmp/build-android-phase-stamps/bin
#   MODELS                default: LFM2.5-2.6B-Q4_K_M.gguf
#   INCLUDE_1P2B=1        append LFM2.5-1.2B-Instruct-Q4_K_M.gguf
#   BENCH_DIR             default: /data/local/tmp/energy-sweep
#   MODEL_DIR             default: /data/local/tmp/llamabench
#   TEMP_GATE_DECI        default: 300 (30.0 C); must be positive, never disabled
#   TEMP_GATE_TIMEOUT_S   default: 1200
#   TEMP_GATE_POLL_S      default: 30
#   IDLE_SECONDS          default: 60
#   REPS                  default: 3
#   NGEN                  default: 256
#   PROMPTLEN_NGEN        default: 32 (NGEN for the promptlen block only)
#   SETTLE_SECONDS        default: 45
#   STABILITY_MAX_PCT     default: 5
#   BLOCKS                default: "primary_t2 a55_t6 control"
#   COUNTS_MANIFEST       default: scripts/fixtures/energy-counts/manifest.csv

set -uo pipefail

_SWEEP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-device-energy-sweep-out}"
BENCH_DIR="${BENCH_DIR:-/data/local/tmp/energy-sweep}"
MODEL_DIR="${MODEL_DIR:-/data/local/tmp/llamabench}"
LOCAL_BIN="${LOCAL_BIN:-$HOME/Projects/kalsa-device-build/build-android-phase-stamps/bin}"
MODELS="${MODELS:-LFM2.5-2.6B-Q4_K_M.gguf}"
INCLUDE_1P2B="${INCLUDE_1P2B:-0}"
TEMP_GATE_DECI="${TEMP_GATE_DECI:-300}"
TEMP_GATE_TIMEOUT_S="${TEMP_GATE_TIMEOUT_S:-1200}"
TEMP_GATE_POLL_S="${TEMP_GATE_POLL_S:-30}"
IDLE_SECONDS="${IDLE_SECONDS:-60}"
REPS="${REPS:-3}"
NGEN="${NGEN:-256}"
PROMPTLEN_NGEN="${PROMPTLEN_NGEN:-32}"
SETTLE_SECONDS="${SETTLE_SECONDS:-45}"
STABILITY_MAX_PCT="${STABILITY_MAX_PCT:-5}"
BLOCKS="${BLOCKS:-primary_t2 a55_t6 control}"
COUNTS_MANIFEST="${COUNTS_MANIFEST:-$_SWEEP_DIR/fixtures/energy-counts/manifest.csv}"
REMOTE_PROMPT="$BENCH_DIR/rep.txt"

# Set these before sourcing device-share-send.sh: device-env.sh uses them for
# the shared serial, keep-awake, and restore primitives.
BENCH_TARGET=device
export BENCH_TARGET
source "$_SWEEP_DIR/device-share-send.sh"

if [ -e "$OUT" ]; then
  if [ -n "$(find "$OUT" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
    printf 'ABORT: output directory is not empty: %s\n' "$OUT" >&2
    exit 2
  fi
else
  mkdir -p "$OUT"
fi

DATA_DIR="$OUT/phase-data"
mkdir -p "$DATA_DIR"
RESULT="$OUT/results.txt"
ORDER_TSV="$OUT/order.tsv"
BLOCK_META_TSV="$OUT/block-meta.tsv"
REPORT="$OUT/SWEEP-REPORT.md"
REPORT_GENERATED=0
: > "$RESULT"
printf 'sequence\tmodel\tblock\tposition\tarm\tmask\tthreads\tstem\n' > "$ORDER_TSV"
printf 'model\tblock\tposition\tarm\tmask\tthreads\teffective_cpus\tstart_level\tstart_temp_deci\tend_level\tend_temp_deci\tstart_screen\tend_screen\tstart_state\tend_state\torder\n' > "$BLOCK_META_TSV"
IDLE_META_TSV="$OUT/idle-meta.tsv"
printf 'start_screen\tend_screen\tstart_level\tstart_temp_deci\tend_level\tend_temp_deci\tstart_state\tend_state\n' > "$IDLE_META_TSV"

blog() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$RESULT"; }

is_uint() {
  case "${1:-}" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac
}

is_pos_uint() {
  is_uint "$1" && [ "$1" -gt 0 ]
}

battery_line() {
  adb shell 'dumpsys battery | grep -E "level|temperature|powered"' </dev/null 2>/dev/null \
    | tr -d '\r' | tr '\n' ' '
}

battery_level_from_line() {
  printf '%s\n' "$1" | sed -n 's/.*level: \([0-9][0-9]*\).*/\1/p'
}

battery_temp_from_line() {
  printf '%s\n' "$1" | sed -n 's/.*temperature: \([0-9][0-9]*\).*/\1/p'
}

screen_state() {
  adb shell 'dumpsys power | grep -m1 mWakefulness' </dev/null 2>/dev/null | tr -d '\r' | sed 's/^[[:space:]]*//'
}

# Doze detected inside an arm invalidates the block, exactly like a
# stability-limit breach or a cadence warning. Pure decision on the recorded
# screen line (e.g. "mWakefulness=Dozing"): Dozing/Asleep/Dreaming is a doze,
# anything else (including an unreadable probe) is not claimed here.
screen_shows_doze() {
  case "${1:-}" in
    *Dozing*|*Asleep*|*Dreaming*) return 0 ;;
    *) return 1 ;;
  esac
}

preflight() {
  local b lvl
  b="$(battery_line)" || true
  blog "preflight: $b"
  if printf '%s' "$b" | grep -qE '(AC|USB) powered: true'; then
    blog "ABORT: charging. Unplug the Jelly and re-run."
    return 1
  fi
  lvl="$(battery_level_from_line "$b")"
  case "$lvl" in
    ''|*[!0-9]*) blog "ABORT: battery level is unreadable."; return 1 ;;
  esac
  if [ "$lvl" -lt 30 ]; then
    blog "ABORT: battery ${lvl}% below the 30% floor."
    return 1
  fi
  return 0
}

# This is intentionally called after every arm, including the unset-mask
# control. The older harness put the baseline continue before this check.
check_mid_campaign_charge() {
  local b lvl
  b="$(battery_line)" || true
  if printf '%s' "$b" | grep -qE '(AC|USB) powered: true'; then
    blog "ABORT: device plugged in mid-campaign."
    return 1
  fi
  lvl="$(battery_level_from_line "$b")"
  case "$lvl" in
    ''|*[!0-9]*) blog "ABORT: battery level became unreadable mid-campaign."; return 1 ;;
  esac
  if [ "$lvl" -lt 30 ]; then
    blog "ABORT: battery ${lvl}% crossed the 30% floor mid-campaign."
    return 1
  fi
  return 0
}

wait_for_temperature_gate() {
  local waited=0 b t lvl
  while :; do
    b="$(battery_line)" || true
    t="$(battery_temp_from_line "$b")"
    lvl="$(battery_level_from_line "$b")"
    if printf '%s' "$b" | grep -qE '(AC|USB) powered: true'; then
      blog "ABORT: charging detected during temperature gate."
      return 1
    fi
    case "$lvl" in
      ''|*[!0-9]*) blog "ABORT: battery level unreadable during temperature gate."; return 1 ;;
      *) [ "$lvl" -ge 30 ] || { blog "ABORT: battery ${lvl}% below the 30% floor."; return 1; } ;;
    esac
    case "$t" in
      ''|*[!0-9]*) ;;
      *)
        if [ "$t" -le "$TEMP_GATE_DECI" ]; then
          blog "temperature gate: ready at ${t} deci-C (threshold ${TEMP_GATE_DECI}), waited ${waited}s"
          return 0
        fi
        ;;
    esac
    if [ "$waited" -ge "$TEMP_GATE_TIMEOUT_S" ]; then
      blog "ABORT: temperature gate timed out at ${t:-unknown} deci-C after ${waited}s."
      return 1
    fi
    # Keep the display off while cooling. The keep-awake timeout is restored by
    # the shared EXIT cleanup; this explicit sleep is only the gate interval.
    if ! adb shell input keyevent KEYCODE_SLEEP </dev/null >/dev/null 2>&1; then
      blog "ABORT: could not turn the screen off during the temperature gate."
      return 1
    fi
    blog "temperature gate: waiting at ${t:-unknown} deci-C; poll in ${TEMP_GATE_POLL_S}s"
    sleep "$TEMP_GATE_POLL_S"
    waited=$((waited + TEMP_GATE_POLL_S))
  done
}

select_serial() {
  local attached picked
  attached="$(adb devices 2>/dev/null | awk '$2=="device" {print $1}')" || true
  if ! picked=$(device_pick_serial "${ANDROID_SERIAL:-}" "$attached"); then
    printf 'ABORT: set ANDROID_SERIAL (attached: %s)\n' "$(printf '%s' "$attached" | tr '\n' ' ')" >&2
    return 1
  fi
  ANDROID_SERIAL="$picked"
  export ANDROID_SERIAL
  blog "serial=$ANDROID_SERIAL"
}

push_bin() {
  [ -x "$LOCAL_BIN/llama-cli" ] || { blog "ABORT: missing executable $LOCAL_BIN/llama-cli"; return 1; }
  if ! adb shell "mkdir -p $BENCH_DIR" </dev/null; then
    blog "ABORT: could not create $BENCH_DIR"
    return 1
  fi
  local f pushed=0
  for f in "$LOCAL_BIN"/llama-cli "$LOCAL_BIN"/*.so; do
    [ -f "$f" ] || continue
    if ! adb push "$f" "$BENCH_DIR/$(basename "$f")" </dev/null >/dev/null 2>&1; then
      blog "ABORT: failed to push $(basename "$f")"
      return 1
    fi
    pushed=$((pushed + 1))
  done
  [ "$pushed" -ge 2 ] || { blog "ABORT: no shared library was pushed from $LOCAL_BIN"; return 1; }
  adb shell "chmod 755 $BENCH_DIR/llama-cli" </dev/null || return 1
  if ! adb shell "cd $BENCH_DIR && LD_LIBRARY_PATH=. ./llama-cli --version 2>&1" </dev/null 2>&1 | tr -d '\r' | tee -a "$RESULT"; then
    blog "ABORT: llama-cli does not run on the device"
    return 1
  fi
  if ! adb shell "taskset 3f /system/bin/true && taskset c0 /system/bin/true" </dev/null >/dev/null 2>&1; then
    blog "ABORT: toybox taskset rejected one of the required bare masks (3f/c0)"
    return 1
  fi
  return 0
}

PLACEMENT_EFFECTIVE_CPUS=""

probe_placement() {
  local mask="$1" raw eff probe
  if [ -n "$mask" ]; then
    probe="taskset $mask sh -c 'grep -m1 Cpus_allowed_list /proc/self/status'"
  else
    probe="grep -m1 Cpus_allowed_list /proc/self/status"
  fi
  raw="$(adb shell "$probe" </dev/null 2>/dev/null | tr -d '\r')" || true
  eff="$(printf '%s\n' "$raw" | sed -n 's/.*Cpus_allowed_list:[[:space:]]*//p' | head -1)"
  case "$mask:$eff" in
    3f:0-5|c0:6-7|:0-7) ;;
    *)
      blog "ABORT: mask ${mask:-unset} not effective (observed ${eff:-unreadable}; raw ${raw:-empty})"
      return 1
      ;;
  esac
  PLACEMENT_EFFECTIVE_CPUS="$eff"
  blog "placement: requested ${mask:-unset}, observed Cpus_allowed_list=$eff"
  return 0
}

push_prompt() {
  cat > "$OUT/rep.txt" <<'EOF'
Checklist for the warehouse audit:
- item 1: checked
- item 2: checked
- item 3: checked
- item 4: checked
- item 5: checked
Continue the checklist with items 6 through 40, same format.
EOF
  if ! adb push "$_SWEEP_DIR/energy-sample.sh" "$BENCH_DIR/energy-sample.sh" </dev/null >/dev/null 2>&1; then
    blog "ABORT: failed to push energy-sample.sh"
    return 1
  fi
  adb shell "chmod 755 $BENCH_DIR/energy-sample.sh" </dev/null || return 1
  adb push "$OUT/rep.txt" "$REMOTE_PROMPT" </dev/null >/dev/null 2>&1
}

# Prompt-length generator for the promptlen block: one checklist prompt per
# nominal length, same content shape at every length (only the item count
# varies), so length is the only thing that changes between points. Item
# counts are NOMINAL, calibrated against the committed REP-style counts
# (scripts/fixtures/energy-counts/manifest.csv, ~9-10 tokens per checklist
# line); the count the report plots against is the engine's stamped prompt_n
# carried in the v3 phase rows, never the nominal target.
generate_prompt_lengths() {
  local len items i
  for len in 128 256 512 1024; do
    items=$(( (len - 20) / 9 ))
    {
      printf 'Checklist for the warehouse audit:\n'
      for ((i = 1; i <= items; i++)); do printf -- '- item %d: checked\n' "$i"; done
      printf 'Continue the checklist with item %d onward, same format.\n' "$((items + 1))"
    } > "$OUT/rep.$len.txt"
  done
}

push_prompt_lengths() {
  local len
  for len in 128 256 512 1024; do
    if ! adb push "$OUT/rep.$len.txt" "$BENCH_DIR/rep.$len.txt" </dev/null >/dev/null 2>&1; then
      blog "ABORT: failed to push rep.$len.txt"
      return 1
    fi
  done
}

verify_models() {
  local model
  for model in $MODELS; do
    if ! adb shell "test -f $MODEL_DIR/$model" </dev/null 2>/dev/null; then
      blog "ABORT: model is missing at $MODEL_DIR/$model"
      return 1
    fi
  done
}

SAMPLER_ACTIVE=0
CURRENT_TAG=""
SWEEP_SEQUENCE=0

energy_start() {
  local tag="$1" max_iter="$2"
  local stop="$BENCH_DIR/stop.energy.$tag"
  [ "$SAMPLER_ACTIVE" -eq 0 ] || { blog "ABORT: sampler already active for $CURRENT_TAG"; return 1; }
  adb shell "pkill -f '[e]nergy-sample.sh' 2>/dev/null; rm -f $stop $BENCH_DIR/$tag.csv $BENCH_DIR/$tag.marks" </dev/null || return 1
  CURRENT_TAG="$tag"
  SAMPLER_ACTIVE=1
  if ! adb shell "(setsid sh $BENCH_DIR/energy-sample.sh $BENCH_DIR/$tag.csv $stop 1 $max_iter >$BENCH_DIR/$tag.err 2>&1 </dev/null &)" </dev/null; then
    blog "ABORT: could not start sampler for $tag"
    return 1
  fi
  sleep 2
  return 0
}

energy_stop() {
  local tag="${1:-$CURRENT_TAG}" dest="$DATA_DIR"
  [ "$SAMPLER_ACTIVE" -eq 1 ] || return 0
  [ "$tag" = "idle_floor" ] && dest="$OUT"
  adb shell "touch $BENCH_DIR/stop.energy.$tag 2>/dev/null; sleep 2; kill \$(cat $BENCH_DIR/$tag.csv.pid 2>/dev/null) 2>/dev/null; rm -f $BENCH_DIR/$tag.csv.pid" </dev/null
  if ! adb pull "$BENCH_DIR/$tag.csv" "$dest/$( [ "$tag" = "idle_floor" ] && printf 'idle-floor.csv' || printf '%s.csv' "$tag" )" </dev/null >/dev/null 2>&1; then
    blog "energy csv pull FAILED for $tag"
  fi
  if [ "$tag" != "idle_floor" ]; then
    adb pull "$BENCH_DIR/$tag.marks" "$DATA_DIR/$tag.marks" </dev/null >/dev/null 2>&1 \
      || blog "marks pull FAILED for $tag"
  fi
  SAMPLER_ACTIVE=0
  CURRENT_TAG=""
}

sweep_cleanup() {
  local rc=$?
  if [ "$SAMPLER_ACTIVE" -eq 1 ]; then
    energy_stop "$CURRENT_TAG"
  fi
  if [ "${REPORT_GENERATED:-0}" -eq 0 ] && [ -s "${ORDER_TSV:-}" ]; then
    generate_report >/dev/null 2>&1 || true
  fi
  if [ "${_KA_SETUP_DONE:-0}" = "1" ]; then
    device_termux_wakelock_restore
    _device_session_restore
  fi
  return "$rc"
}

trap sweep_cleanup EXIT
trap 'exit 130' INT TERM

speed_of() {
  grep -o 'Generation: [0-9.]* t/s' "$1" | head -1
}

# Worst-case per-invocation ceiling for promptlen arms, from the generated
# file's ACTUAL line count at a pessimistic 10 tokens/line (the per-line
# calibration is uncertain, so the count comes from the file, not the
# nominal target): prefill at the measured worst-case 5.0 t/s scaled 1.5x
# (lines*10/5*1.5 = lines*3), plus 90 s of fixed slack for load and decode.
# The 1024-length file has 113 lines -> 429 s; the audited blocks keep
# timeout 600.
promptlen_timeout() {
  local lines
  if ! lines=$(wc -l < "$1" | tr -d ' '); then
    blog "ABORT: cannot count lines of $1 for the promptlen timeout"
    return 1
  fi
  printf '%s\n' $(( lines * 3 + 90 ))
}

arm_config() {
  # Defaults for the existing mask arms; promptlen arms override these.
  ARM_PROMPT=""
  ARM_NGEN="$NGEN"
  ARM_TIMEOUT=""
  case "$1" in
    a55_t2) ARM_MASK=3f; ARM_THREADS=2; ARM_LABEL=a55_t2 ;;
    a55_t6) ARM_MASK=3f; ARM_THREADS=6; ARM_LABEL=a55_t6 ;;
    a76_t2) ARM_MASK=c0; ARM_THREADS=2; ARM_LABEL=a76_t2 ;;
    none) ARM_MASK=""; ARM_THREADS=2; ARM_LABEL=none ;;
    p128|p256|p512|p1024)
      local len="${1#p}"
      ARM_MASK=""; ARM_THREADS=2; ARM_LABEL="$1"
      ARM_PROMPT="$BENCH_DIR/rep.$len.txt"
      ARM_NGEN="$PROMPTLEN_NGEN"
      ARM_TIMEOUT="$(promptlen_timeout "$OUT/rep.$len.txt")" || return 1
      ;;
    *) blog "ABORT: unknown sweep arm '$1'"; return 1 ;;
  esac
}

run_one_arm() {
  local model="$1" block="$2" position="$3" arm="$4"
  local model_base stem mask threads launcher pf stop stamps stamp_out out speed rc i
  arm_config "$arm" || return 1
  mask="$ARM_MASK"
  threads="$ARM_THREADS"
  model_base="$(basename "$model" .gguf)"
  stem="${model_base}_${block}_p${position}_${ARM_LABEL}"
  pf="${ARM_PROMPT:-$REMOTE_PROMPT}"
  # The audited mask arms keep the literal timeout 600; promptlen arms carry
  # a per-arm ceiling (promptlen_timeout) sized for a full prefill at the
  # measured worst-case rate.
  local to="timeout 600"
  [ -n "$ARM_TIMEOUT" ] && to="timeout $ARM_TIMEOUT"
  energy_start "$stem" 7200 || return 1
  # Positive placement evidence from inside the wrapped command: the masked
  # process prints its own Cpus_allowed lines before exec, so each rep output
  # records the CPU set the CLI itself had. A separate probe child cannot
  # prove that (probe_placement stays the fail-closed gate; this is the
  # per-rep record). "$@" carries the CLI arguments through sh -c.
  launcher="sh -c 'grep -E ^Cpus_allowed /proc/self/status; exec ./llama-cli \"\$@\"' _"
  [ -n "$mask" ] && launcher="taskset $mask $launcher"

  for i in $(seq 1 "$REPS"); do
    out="$DATA_DIR/${stem}_r${i}.txt"
    stamps="$BENCH_DIR/${stem}_r${i}.stamps"
    stamp_out="$DATA_DIR/${stem}_r${i}.stamps"
    rm -f "$out" "$stamp_out"
    adb shell "rm -f $stamps" </dev/null
    adb shell "cd $BENCH_DIR && KALSA_PHASE_STAMPS=$stamps LD_LIBRARY_PATH=. $to $launcher -m $MODEL_DIR/$model -f $pf -n $ARM_NGEN -t $threads -st --temp 0 --simple-io" \
      </dev/null > "$out" 2>&1
    rc=$?
    # The mark is deliberately the first host-side action after llama-cli.
    adb shell "echo r$i \$(cut -d' ' -f1 /proc/uptime) >> $BENCH_DIR/$stem.marks" </dev/null
    # Report the CLI failure before anything about stamps: a timeout kill
    # writes no stamp at all, and the rc is the real diagnostic.
    if [ "$rc" -ne 0 ]; then
      blog "    r$i: llama-cli failed with status $rc"
      energy_stop "$stem"
      return 1
    fi
    adb pull "$stamps" "$stamp_out" </dev/null >/dev/null 2>&1
    if [ ! -s "$stamp_out" ]; then
      # One retry: a transient adb hiccup must not cost a rep.
      sleep 2
      adb pull "$stamps" "$stamp_out" </dev/null >/dev/null 2>&1
    fi
    if [ ! -s "$stamp_out" ] && [ "$block" = "promptlen" ]; then
      blog "ABORT: phase stamps pull FAILED or EMPTY for $stem r$i (expected $stamp_out); a promptlen rep without a stamp must not silently leave the split"
      energy_stop "$stem"
      return 1
    fi
    if [ ! -s "$stamp_out" ]; then
      blog "phase stamps MISSING/EMPTY for $stem r$i (expected $stamp_out)"
    fi
    speed="$(speed_of "$out")"
    if [ -z "$speed" ]; then
      blog "    r$i: FAILED: $(tail -1 "$out" | cut -c1-120)"
      energy_stop "$stem"
      return 1
    fi
    blog "    $stem r$i: $speed"
    sleep 5
  done
  energy_stop "$stem"
  return 0
}

block_arm_list() {
  case "$1" in
    primary_t2) printf '%s\n' 'a55_t2 a76_t2 a76_t2 a55_t2' ;;
    a55_t6) printf '%s\n' 'a55_t6 a76_t2 a76_t2 a55_t6' ;;
    control) printf '%s\n' 'none' ;;
    # Forward-then-reverse sweep: any linear drift over the block cancels
    # between the two halves of each length. Every arm_config p-arm fixes
    # placement at the unset control so only the prompt length varies.
    promptlen) printf '%s\n' 'p128 p256 p512 p1024 p1024 p512 p256 p128' ;;
    *) return 1 ;;
  esac
}

run_block() {
  local model="$1" block="$2" arms order start end start_level start_temp end_level end_temp
  local start_screen end_screen effective_cpus position=0 arm arm_rc sequence model_base stem mask threads arm_count
  arms="$(block_arm_list "$block")" || { blog "ABORT: unknown block '$block'"; return 1; }
  order="$(printf '%s' "$arms" | tr ' ' ',')"
  arm_count="$(printf '%s' "$arms" | awk '{print NF}')"
  blog "comparison start: model=$model block=$block order=$order"
  preflight || return 1
  model_base="$(basename "$model" .gguf)"

  for arm in $arms; do
    position=$((position + 1))
    arm_config "$arm" || return 1
    mask="$ARM_MASK"
    threads="$ARM_THREADS"
    stem="${model_base}_${block}_p${position}_${ARM_LABEL}"
    # Every arm is its own temperature-gated block. This keeps the ABBA
    # order while preventing the schedule itself from measuring warm-up.
    wait_for_temperature_gate || return 1
    probe_placement "$mask" || return 1
    # Hold the device awake for the WHOLE arm, not just at its start. The
    # campaign-start keep-awake alone did not survive the ~350 s A55 arms:
    # every pilot arm recorded mWakefulness=Awake at its start and
    # mWakefulness=Dozing at its end. Re-assert the keep-awake screen timeout
    # and wake the display before every arm, the same keep-awake the campaign
    # setup applies (re-put rather than device_keepawake_begin, which is
    # idempotent and would also clobber this script's combined EXIT trap).
    if ! adb shell "settings put system screen_off_timeout $KA_SCREEN_TIMEOUT_MS" </dev/null >/dev/null 2>&1; then
      blog "ABORT: could not re-arm screen timeout before arm $ARM_LABEL"
      return 1
    fi
    device_termux_wakelock_setup >/dev/null 2>&1 || true
    if ! adb shell input keyevent KEYCODE_WAKEUP </dev/null >/dev/null 2>&1; then
      blog "ABORT: could not wake the display before arm $ARM_LABEL"
      return 1
    fi
    start="$(battery_line)" || true
    start_level="$(battery_level_from_line "$start")"
    start_temp="$(battery_temp_from_line "$start")"
    start_screen="$(screen_state)" || true
    [ -n "$start_screen" ] || { blog "ABORT: screen state is unreadable before arm $ARM_LABEL"; return 1; }
    effective_cpus="$PLACEMENT_EFFECTIVE_CPUS"
    SWEEP_SEQUENCE=$((SWEEP_SEQUENCE + 1))
    sequence="$SWEEP_SEQUENCE"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$sequence" "$model_base" "$block" "$position" "$ARM_LABEL" "$mask" "$threads" "$stem" >> "$ORDER_TSV"
    blog "block start: model=$model block=$block position=$position arm=$ARM_LABEL order=$order"
    if run_one_arm "$model" "$block" "$position" "$arm"; then
      arm_rc=0
    else
      arm_rc=$?
    fi
    # This call is unconditional after the arm, including the unset-mask
    # control and a failed invocation, so charging cannot be hidden by order.
    check_mid_campaign_charge || return 1
    end="$(battery_line)" || true
    end_level="$(battery_level_from_line "$end")"
    end_temp="$(battery_temp_from_line "$end")"
    end_screen="$(screen_state)" || true
    [ -n "$end_screen" ] || { blog "ABORT: screen state is unreadable after arm $ARM_LABEL"; return 1; }
    # The end-of-arm awake state is load-bearing, not just recorded: a doze
    # detected at either endpoint invalidates the block in the report (the
    # rows carry the warning, the block and its frontier point read
    # UNINTERPRETABLE). Logged here, gated there, so the session still
    # publishes what it has.
    if screen_shows_doze "$start_screen" || screen_shows_doze "$end_screen"; then
      blog "DOZE DETECTED during arm $ARM_LABEL position $position (screen ${start_screen} -> ${end_screen}): block will be marked UNINTERPRETABLE"
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$model_base" "$block" "$position" "$ARM_LABEL" "$mask" "$threads" "$effective_cpus" \
      "$start_level" "$start_temp" "$end_level" "$end_temp" "$start_screen" "$end_screen" "$start" "$end" "$order" >> "$BLOCK_META_TSV"
    blog "block end: model=$model block=$block position=$position arm=$ARM_LABEL start=${start_level}%/${start_temp}dC end=${end_level}%/${end_temp}dC"
    [ "$arm_rc" -eq 0 ] || return "$arm_rc"
    if [ "$position" -lt "$arm_count" ]; then
      sleep "$SETTLE_SECONDS"
    fi
  done
  blog "comparison end: model=$model block=$block order=$order"
  return 0
}

run_idle_floor() {
  local start end start_screen end_screen start_level start_temp end_level end_temp
  preflight || return 1
  adb shell input keyevent KEYCODE_WAKEUP </dev/null >/dev/null 2>&1 || return 1
  start_screen="$(screen_state)" || true
  [ -n "$start_screen" ] || { blog "ABORT: screen state is unreadable before idle floor"; return 1; }
  start="$(battery_line)" || true
  start_level="$(battery_level_from_line "$start")"
  start_temp="$(battery_temp_from_line "$start")"
  blog "idle floor: screen awake, no llama-cli process, sampling ${IDLE_SECONDS}s"
  energy_start idle_floor "$IDLE_SECONDS" || return 1
  sleep "$((IDLE_SECONDS + 2))"
  energy_stop idle_floor
  end_screen="$(screen_state)" || true
  [ -n "$end_screen" ] || end_screen="unknown"
  end="$(battery_line)" || true
  end_level="$(battery_level_from_line "$end")"
  end_temp="$(battery_temp_from_line "$end")"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$start_screen" "$end_screen" "$start_level" "$start_temp" "$end_level" "$end_temp" "$start" "$end" >> "$IDLE_META_TSV"
  check_mid_campaign_charge || return 1
  return 0
}

generate_report() {
  local split_rc
  node "$_SWEEP_DIR/energyPhaseSplit.mjs" "$DATA_DIR" --counts-manifest "$COUNTS_MANIFEST" > "$OUT/split.stdout" 2> "$OUT/split.stderr"
  split_rc=$?
  [ "$split_rc" -eq 0 ] || { blog "ABORT: phase split failed; see $OUT/split.stderr"; return 1; }
  node --input-type=module - "$DATA_DIR" "$OUT" "$_SWEEP_DIR/energySchema.mjs" "$STABILITY_MAX_PCT" "$REPS" "$PROMPTLEN_NGEN" > "$REPORT" <<'NODE'
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [dataDir, outDir, schemaPath, stabilityLimitRaw, expectedRepsRaw, promptlenNgenRaw] = process.argv.slice(2);
const { parseEnergyCsv, integrate } = await import(pathToFileURL(schemaPath).href);
const stabilityLimit = Number(stabilityLimitRaw);
const expectedReps = Number(expectedRepsRaw);
const promptlenNgen = Number(promptlenNgenRaw);

function csvLine(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(field); field = ""; }
    else field += c;
  }
  out.push(field);
  return out;
}

function readRows(file) {
  const lines = readFileSync(file, "utf8").trimEnd().split("\n");
  if (lines.length < 2) return [];
  const header = csvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = csvLine(line);
    return Object.fromEntries(header.map((key, i) => [key, values[i] ?? ""]));
  });
}

function readTsv(file) {
  return readFileSync(file, "utf8").trimEnd().split("\n").slice(1).filter(Boolean).map((line) => line.split("\t"));
}

function md(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function finite(value) {
  const n = Number(value);
  return value !== "" && Number.isFinite(n) ? n : null;
}

function f(value, digits = 3) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

function speedOf(stem, rep) {
  const file = `${dataDir}/${stem}_r${rep}.txt`;
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const match = text.match(/Generation:\s*([0-9.]+)\s+t\/s/);
  return match ? Number(match[1]) : null;
}

function observedCpusOf(stem, rep) {
  const file = `${dataDir}/${stem}_r${rep}.txt`;
  if (!existsSync(file)) return null;
  const match = readFileSync(file, "utf8").match(/^Cpus_allowed_list:\s*(\S+)/m);
  return match ? match[1] : null;
}

const orderRows = readTsv(`${outDir}/order.tsv`).map((v) => ({
  sequence: Number(v[0]), model: v[1], block: v[2], position: Number(v[3]),
  arm: v[4], mask: v[5], threads: v[6], stem: v[7],
}));
const orderByStem = new Map(orderRows.map((v) => [v.stem, v]));
const metaRows = readTsv(`${outDir}/block-meta.tsv`).map((v) => ({
  model: v[0], block: v[1], position: Number(v[2]), arm: v[3], mask: v[4],
  threads: v[5], effectiveCpus: v[6], startLevel: v[7], startTemp: v[8], endLevel: v[9], endTemp: v[10],
  startScreen: v[11], endScreen: v[12], startState: v[13], endState: v[14], order: v[15],
}));
const metaByKey = new Map(metaRows.map((v) => [`${v.model}|${v.block}|${v.position}|${v.arm}`, v]));
const idleMetaRows = readTsv(`${outDir}/idle-meta.tsv`).map((v) => ({
  startScreen: v[0], endScreen: v[1], startLevel: v[2], startTemp: v[3],
  endLevel: v[4], endTemp: v[5], startState: v[6], endState: v[7],
}));
const actualOrderByComparison = new Map();
for (const row of [...orderRows].sort((a, b) => a.sequence - b.sequence)) {
  const key = `${row.model}|${row.block}`;
  if (!actualOrderByComparison.has(key)) actualOrderByComparison.set(key, []);
  actualOrderByComparison.get(key).push(`${row.arm}(p${row.position})`);
}

function cpuClockSummary(stem) {
  const file = `${dataDir}/${stem}.csv`;
  if (!existsSync(file)) return "n/a";
  const parsed = parseEnergyCsv(readFileSync(file, "utf8"));
  const sums = [];
  const counts = [];
  for (const row of parsed.rows) {
    for (const [index, raw] of (row.f || "").split(":").entries()) {
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) continue;
      sums[index] = (sums[index] || 0) + value;
      counts[index] = (counts[index] || 0) + 1;
    }
  }
  const clocks = sums.map((sum, index) => counts[index] ? `cpu${index}=${Math.round(sum / counts[index])}` : "").filter(Boolean);
  return clocks.length ? `${clocks.join("/")} kHz` : "n/a";
}

const clocksByStem = new Map(orderRows.map((v) => [v.stem, cpuClockSummary(v.stem)]));
const entries = [];
for (const file of readdirSync(dataDir).filter((name) => name.endsWith(".phases.csv"))) {
  const stem = file.slice(0, -".phases.csv".length);
  const info = orderByStem.get(stem);
  if (!info) continue;
  for (const row of readRows(`${dataDir}/${file}`)) {
    entries.push({
      ...info,
      row,
      rep: Number(row.rep),
      speed: speedOf(stem, Number(row.rep)),
    });
  }
}
entries.sort((a, b) => a.sequence - b.sequence || a.rep - b.rep);

function placementWarningOf(entry) {
  const meta = metaByKey.get(`${entry.model}|${entry.block}|${entry.position}|${entry.arm}`) ?? {};
  const inBand = observedCpusOf(entry.stem, entry.rep);
  const observed = inBand ?? meta.effectiveCpus ?? null;
  const mismatch = (entry.mask === "3f" && observed !== "0-5") ||
    (entry.mask === "c0" && observed !== "6-7") ||
    (entry.mask === "" && observed !== "0-7");
  return mismatch
    ? `MASK PLACEMENT WARNING: requested ${entry.mask || "unset"}, observed ${observed || "unreadable"}${inBand ? " (in-band)" : " (probe fallback; in-band record absent)"}`
    : "";
}

function observedCpusLabel(stem, rep, probeFallback) {
  const inBand = observedCpusOf(stem, rep);
  if (inBand) return `${inBand} (in-band)`;
  if (probeFallback) return `${probeFallback} (probe fallback)`;
  return "n/a";
}

// A doze detected inside an arm invalidates the block, exactly like a
// stability-limit breach or a cadence warning. Mirrors the shell-side
// screen_shows_doze: Dozing/Asleep/Dreaming at either recorded endpoint.
function screenShowsDoze(screen) {
  return /Dozing|Asleep|Dreaming/.test(screen || "");
}

function dozeWarningOf(meta) {
  const start = meta?.startScreen || "";
  const end = meta?.endScreen || "";
  if (screenShowsDoze(start) || screenShowsDoze(end)) {
    return `device dozed during arm (screen ${start || "unknown"}->${end || "unknown"})`;
  }
  return "";
}

for (const entry of entries) {
  const warning = placementWarningOf(entry);
  if (warning) entry.row.warnings = [entry.row.warnings || "", warning].filter(Boolean).join("; ");
  const meta = metaByKey.get(`${entry.model}|${entry.block}|${entry.position}|${entry.arm}`) ?? {};
  const dozeWarning = dozeWarningOf(meta);
  if (dozeWarning) entry.row.warnings = [entry.row.warnings || "", dozeWarning].filter(Boolean).join("; ");
}

const blockGroups = new Map();
for (const info of orderRows) {
  const key = `${info.model}|${info.block}|${info.position}|${info.arm}`;
  if (!blockGroups.has(key)) {
    blockGroups.set(key, {
      model: info.model, block: info.block, position: info.position, arm: info.arm,
      sequence: info.sequence, entries: [],
    });
  }
}
for (const entry of entries) {
  const key = `${entry.model}|${entry.block}|${entry.position}|${entry.arm}`;
  if (!blockGroups.has(key)) {
    blockGroups.set(key, {
      model: entry.model, block: entry.block, position: entry.position, arm: entry.arm,
      sequence: entry.sequence, entries: [],
    });
  }
  blockGroups.get(key).entries.push(entry);
}
for (const group of blockGroups.values()) {
  const speeds = group.entries.map((e) => e.speed).filter(Number.isFinite);
  const mean = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : NaN;
  group.spread = speeds.length && mean > 0 ? ((Math.max(...speeds) - Math.min(...speeds)) / mean) * 100 : NaN;
  group.usable = group.entries.filter((e) => finite(e.row.j_per_tok_decode) !== null).length;
  const meta = metaByKey.get(`${group.model}|${group.block}|${group.position}|${group.arm}`) ?? {};
  const dozed = screenShowsDoze(meta.startScreen) || screenShowsDoze(meta.endScreen);
  group.dozed = dozed;
  group.unstable =
    !Number.isFinite(group.spread) ||
    group.entries.length < expectedReps ||
    group.usable < expectedReps ||
    group.entries.some((e) => !Number.isFinite(e.speed) || finite(e.row.decode_s) === null) ||
    group.spread > stabilityLimit ||
    dozed ||
    group.entries.some((e) => /low-resolution|cadence max|MASK PLACEMENT WARNING|dozed during arm/.test(e.row.warnings || ""));
}

const groupsByComparison = new Map();
for (const group of blockGroups.values()) {
  const comparisonKey = `${group.model}|${group.block}`;
  if (!groupsByComparison.has(comparisonKey)) groupsByComparison.set(comparisonKey, []);
  groupsByComparison.get(comparisonKey).push(group);
}
const anyUnstable = [...blockGroups.values()].some((g) => g.unstable);

console.log("# Fase 2b core-placement energy sweep");
console.log("");
console.log("The stability check below is the first result to read. A block over the configured 5% throughput-spread limit is marked **UNINTERPRETABLE**; its arm rows and frontier points must not be used for a lever conclusion.");
console.log("");
console.log("## 1. Stability check — read first");
console.log("");
console.log("| model | comparison | position | arm | executed order | observed CPUs | per-CPU clocks (kHz) | per-rep generation t/s | spread | usable | status |");
console.log("|---|---|---:|---|---|---|---|---|---:|---:|---|");
for (const group of [...blockGroups.values()].sort((a, b) => {
  const as = a.sequence ?? 0;
  const bs = b.sequence ?? 0;
  return as - bs;
})) {
  const meta = metaByKey.get(`${group.model}|${group.block}|${group.position}|${group.arm}`) ?? {};
  const order = orderRows.filter((r) => r.model === group.model && r.block === group.block)
    .sort((a, b) => a.sequence - b.sequence)
    .map((r) => `${r.arm}(p${r.position})`).join(" → ");
  const values = group.entries.sort((a, b) => a.rep - b.rep)
    .map((e) => `r${e.rep}=${f(e.speed, 1)}`).join("/");
  const observedLabels = group.entries.map((e) => observedCpusLabel(e.stem, e.rep, meta.effectiveCpus));
  const observedDisplay = [...new Set(observedLabels)].join(" / ") || observedCpusLabel("", 0, meta.effectiveCpus);
  const status = group.unstable ? "**UNINTERPRETABLE**" : "stable";
  const stem = group.entries[0]?.stem;
  console.log(`| ${md(group.model)} | ${group.block} | ${group.position} | ${group.arm} | ${order} | ${observedDisplay} | ${stem ? clocksByStem.get(stem) : "n/a"} | ${values || "none"} | ${f(group.spread, 1)}% | ${group.usable}/${expectedReps} | ${status} |`);
}
if (anyUnstable) console.log("\n**STOP:** at least one block exceeded the 5% stability limit; its arm block and comparison frontier are uninterpretable, while unaffected comparisons remain separately marked.");
else console.log("\nAll completed blocks are within the configured throughput-spread limit.");

console.log("\n## 2. Idle floor");
const idleFile = `${outDir}/idle-floor.csv`;
if (existsSync(idleFile)) {
  const parsed = parseEnergyCsv(readFileSync(idleFile, "utf8"));
  const integrated = integrate(parsed.rows);
  const powers = parsed.rows.map((r) => Math.abs(Number(r.i) * Number(r.v)) / 1e12).filter(Number.isFinite).sort((a, b) => a - b);
  const p5 = powers.length ? powers[Math.floor(0.05 * (powers.length - 1))] : NaN;
  const idleMeta = idleMetaRows[0];
  console.log(`The screen-awake idle sampler ran for ${f(integrated.duration_s, 1)} s across ${parsed.rows.length} samples: mean ${f(integrated.mean_w, 3)} W, p5 ${f(p5, 3)} W, integrated ${f(integrated.joules, 3)} J.`);
  console.log(`Idle screen state: ${idleMeta?.startScreen || "n/a"} → ${idleMeta?.endScreen || "n/a"}; battery ${idleMeta?.startLevel || "n/a"}%/${idleMeta?.startTemp || "n/a"} deci-C → ${idleMeta?.endLevel || "n/a"}%/${idleMeta?.endTemp || "n/a"} deci-C.`);
} else {
  console.log("**MISSING:** idle-floor.csv was not produced.");
}

console.log("\n## 3. Block order and battery state");
console.log("");
console.log("| model | comparison | position | arm | executed order | observed CPUs | start screen | end screen | start level/temp | end level/temp |");
console.log("|---|---|---:|---|---|---|---|---|---|---|");
for (const meta of metaRows) {
  const actualOrder = actualOrderByComparison.get(`${meta.model}|${meta.block}`)?.join(" → ") || "n/a";
  const metaEntries = entries.filter((e) => e.model === meta.model && e.block === meta.block && e.position === meta.position && e.arm === meta.arm);
  const observedLabels = metaEntries.map((e) => observedCpusLabel(e.stem, e.rep, meta.effectiveCpus));
  const observedDisplay = [...new Set(observedLabels)].join(" / ") || observedCpusLabel("", 0, meta.effectiveCpus);
  console.log(`| ${md(meta.model)} | ${meta.block} | ${meta.position} | ${meta.arm} | ${actualOrder} | ${observedDisplay} | ${meta.startScreen || "n/a"} | ${meta.endScreen || "n/a"} | ${meta.startLevel}% / ${meta.startTemp} deci-C | ${meta.endLevel}% / ${meta.endTemp} deci-C |`);
}

console.log("\n## 4. Per-arm, per-rep results");
console.log("");
console.log("| model | block | position | arm | mask | observed CPUs | per-CPU clocks (kHz) | threads | rep | gen t/s | decode_s | coverage | J/decode-tok | J_load_idle | J_prefill | J_decode | warnings | screen start→end | battery start→end | block status |");
console.log("|---|---|---:|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|");
for (const e of entries) {
  const meta = metaByKey.get(`${e.model}|${e.block}|${e.position}|${e.arm}`) ?? {};
  const nominal = finite(e.row.decode_s);
  const integrated = finite(e.row.decode_s_int);
  const coverage = nominal && integrated !== null ? `${f((integrated / nominal) * 100, 1)}%` : "n/a";
  const status = blockGroups.get(`${e.model}|${e.block}|${e.position}|${e.arm}`)?.unstable ? "UNINTERPRETABLE" : "stable";
  const observedDisplay = observedCpusLabel(e.stem, e.rep, meta.effectiveCpus);
  const warnings = e.row.warnings || "—";
  console.log(`| ${md(e.model)} | ${e.block} | ${e.position} | ${e.arm} | ${e.mask || "unset"} | ${observedDisplay} | ${clocksByStem.get(e.stem) || "n/a"} | ${e.threads} | ${e.rep} | ${f(e.speed, 1)} | ${md(e.row.decode_s)} | ${coverage} | ${md(e.row.j_per_tok_decode)} | ${md(e.row.j_load_idle)} | ${md(e.row.j_prefill)} | ${md(e.row.j_decode)} | ${md(warnings)} | ${meta.startScreen || "n/a"}→${meta.endScreen || "n/a"} | ${meta.startLevel}%/${meta.startTemp} → ${meta.endLevel}%/${meta.endTemp} | ${status} |`);
}

function meanMetric(model, block, position, arm, field) {
  const group = blockGroups.get(`${model}|${block}|${position}|${arm}`);
  const values = (group?.entries || []).map((e) => finite(e.row[field])).filter((v) => v !== null);
  return { mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN, n: values.length };
}

function meanArmMetric(model, arm, field) {
  const values = entries.filter((e) => e.model === model && e.arm === arm)
    .map((e) => finite(e.row[field])).filter((v) => v !== null);
  return { mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN, n: values.length };
}

function meanArmSpeed(model, block, arm) {
  const values = entries.filter((e) => e.model === model && e.block === block && e.arm === arm)
    .map((e) => e.speed).filter(Number.isFinite);
  return { mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN, n: values.length };
}

const pairSpecs = {
  primary_t2: [["a55_t2", 1, 4], ["a76_t2", 2, 3]],
  a55_t6: [["a55_t6", 1, 4], ["a76_t2", 2, 3]],
};
const orderConfoundByModel = new Map();
const orderConfoundRows = [];
for (const key of [...new Set(orderRows.map((r) => `${r.model}|${r.block}`))]) {
  const [model, block] = key.split("|");
  for (const [arm, earlyPosition, latePosition] of (pairSpecs[block] || [])) {
    const early = meanMetric(model, block, earlyPosition, arm, "j_per_tok_decode");
    const late = meanMetric(model, block, latePosition, arm, "j_per_tok_decode");
    const step = Number.isFinite(early.mean) && early.mean !== 0 && Number.isFinite(late.mean)
      ? ((late.mean / early.mean) - 1) * 100 : NaN;
    const pairUnstable = blockGroups.get(`${model}|${block}|${earlyPosition}|${arm}`)?.unstable ||
      blockGroups.get(`${model}|${block}|${latePosition}|${arm}`)?.unstable;
    const exceeds = Number.isFinite(step) && Math.abs(step) > stabilityLimit;
    if (exceeds) orderConfoundByModel.set(model, true);
    orderConfoundRows.push({ model, block, arm, earlyPosition, latePosition, early, late, step, pairUnstable, exceeds });
  }
}

console.log("\n## 5. Order confound and self-consistency");
console.log("");
console.log("The ABBA order-confound estimate compares the same arm in its early and late positions. A step over the configured stability limit makes the model UNINTERPRETABLE for the placement headline; missing or warning-bearing buckets are also shown rather than treated as stable.");
console.log("");
console.log("| model | comparison | arm | early position J/token | late position J/token | late-vs-early step | n early/late | status |");
console.log("|---|---|---|---:|---:|---:|---:|---|");
for (const row of orderConfoundRows) {
  const status = row.exceeds || row.pairUnstable ? "**UNINTERPRETABLE**" : Number.isFinite(row.step) ? "bounded" : "missing";
  console.log(`| ${md(row.model)} | ${row.block} | ${row.arm} | ${f(row.early.mean)} | ${f(row.late.mean)} | ${f(row.step, 1)}% | ${row.early.n}/${row.late.n} | ${status} |`);
}

console.log("");
console.log("Self-consistency checks:");
for (const model of [...new Set(orderRows.map((r) => r.model))]) {
  const none = meanArmMetric(model, "none", "j_per_tok_decode");
  const a76 = meanArmMetric(model, "a76_t2", "j_per_tok_decode");
  const agreement = Number.isFinite(none.mean) && Number.isFinite(a76.mean) && a76.mean !== 0
    ? ((none.mean / a76.mean) - 1) * 100 : NaN;
  console.log(`- ${md(model)}: unset control versus a76_t2 J/token difference = ${f(agreement, 1)}% (n=${none.n}/${a76.n}); this is a diagnostic, not a substitute for placement proof.`);
  for (const block of Object.keys(pairSpecs)) {
    const treatment = block === "primary_t2" ? "a55_t2" : "a55_t6";
    const treatmentSpeed = meanArmSpeed(model, block, treatment);
    const a76Speed = meanArmSpeed(model, block, "a76_t2");
    const ratio = Number.isFinite(treatmentSpeed.mean) && Number.isFinite(a76Speed.mean) && a76Speed.mean !== 0
      ? treatmentSpeed.mean / a76Speed.mean : NaN;
    const aa = orderConfoundRows.find((r) => r.model === model && r.block === block && r.arm === "a76_t2");
    console.log(`- ${md(model)}/${block}: ${treatment} versus a76_t2 generation ratio = ${f(ratio, 2)}x (n=${treatmentSpeed.n}/${a76Speed.n}); a76_t2 p2→p3 J/token step = ${f(aa?.step, 1)}%.`);
  }
}

console.log("\n## 6. Frontier: J/token versus relative slowdown");
console.log("");
console.log("Relative slowdown is mean stamped decode duration against the `a76_t2` no-change control in the same comparison. The owner reading rule is a possible win only when slowdown ≤25% and J/token falls by ≥15%; unstable blocks, low-resolution/cadence warnings, missing reps, and an excessive same-arm order step remain uninterpretable.");
console.log("");
console.log("| model | comparison | arm | mean decode_s | mean J/decode-tok | slowdown vs a76_t2 | J/token change | owner rule |");
console.log("|---|---|---|---:|---:|---:|---:|---|");
const armGroups = new Map();
for (const e of entries) {
  if (e.block === "promptlen") continue; // placement frontier; the promptlen curve is section 8
  const key = `${e.model}|${e.block}|${e.arm}`;
  if (!armGroups.has(key)) armGroups.set(key, { model: e.model, block: e.block, arm: e.arm, durations: [], jtok: [] });
  const g = armGroups.get(key);
  if (finite(e.row.decode_s) !== null) g.durations.push(Number(e.row.decode_s));
  if (finite(e.row.j_per_tok_decode) !== null) g.jtok.push(Number(e.row.j_per_tok_decode));
}
for (const group of [...armGroups.values()].sort((a, b) => a.model.localeCompare(b.model) || a.block.localeCompare(b.block) || a.arm.localeCompare(b.arm))) {
  const ref = armGroups.get(`${group.model}|${group.block}|a76_t2`);
  const meanDuration = group.durations.length ? group.durations.reduce((a, b) => a + b, 0) / group.durations.length : NaN;
  const meanJ = group.jtok.length ? group.jtok.reduce((a, b) => a + b, 0) / group.jtok.length : NaN;
  const refDuration = ref?.durations.length ? ref.durations.reduce((a, b) => a + b, 0) / ref.durations.length : NaN;
  const refJ = ref?.jtok.length ? ref.jtok.reduce((a, b) => a + b, 0) / ref.jtok.length : NaN;
  const slowdown = Number.isFinite(meanDuration) && Number.isFinite(refDuration) ? ((meanDuration / refDuration) - 1) * 100 : NaN;
  const change = Number.isFinite(meanJ) && Number.isFinite(refJ) ? ((meanJ / refJ) - 1) * 100 : NaN;
  const comparisonGroups = groupsByComparison.get(`${group.model}|${group.block}`) ?? [];
  const unstable = comparisonGroups.filter((g) => g.block === group.block).some((g) => g.unstable);
  const orderUnstable = orderConfoundByModel.get(group.model) === true;
  let rule = "n/a";
  if (unstable || orderUnstable) rule = "UNINTERPRETABLE";
  else if (Number.isFinite(slowdown) && Number.isFinite(change)) rule = slowdown <= 25 && change <= -15 ? "meets rule" : "does not meet rule";
  console.log(`| ${md(group.model)} | ${group.block} | ${group.arm} | ${f(meanDuration)} | ${f(meanJ)} | ${f(slowdown, 1)}% | ${f(change, 1)}% | ${rule} |`);
}

console.log("\n## 7. Provenance and reading rules");
console.log("");
console.log("- Raw sampler CSVs, `.marks`, `.stamps`, and CLI output are under `phase-data/`; `idle-floor.csv` is the 60-second screen-awake floor.");
console.log("- Sweep stems are not entries in the committed counts manifest; prompt_n and predicted_n come from the phase stamps. The manifest is passed for compatibility but is not consulted for these stem names; see `split.stdout` and `split.stderr` for the exact rerun output.");
console.log("- Absolute J/token is session-relative. Compare the frontier only after the stability check and the session idle floor are recorded.");

const plEntries = entries.filter((e) => e.block === "promptlen");
if (plEntries.length) {
  console.log("\n## 8. Window-slide curve: promptlen block — prefill cost versus prompt length");
  console.log("");
  console.log("The v3 prefill bucket is prompt evaluation through the first generated token (docs/ENERGY-SCHEMA.md). A page-in-dominated prefill would amortise a fixed cost and get faster with length; the reference phone shows the opposite — prompt evaluation runs at roughly 5 tokens/s at 66 tokens and 3.6 tokens/s near 4096, and a warm page cache did not speed it up — so prefill is genuine compute, and the lengths are 128..1024 nominal tokens so the whole block prices it inside one charge. The fit therefore reads: the **slope** is the marginal prefill energy per prompt token — the recurring cost of a mid-conversation window slide, where the model is already resident — and the **intercept** is whatever fixed per-invocation cost remains (model load residual, warm-up), which a slide does not pay. No warm-up rep is excluded: the intercept absorbs the fixed part. Measured token counts are the v3 stamped `prompt_n`, never the nominal target; the fit is a least-squares line on the per-length means of measured (prompt_tokens, j_prefill).");
  console.log("");
  console.log("Arm order is the forward-then-reverse sweep p128 → p256 → p512 → p1024 → p1024 → p512 → p256 → p128. Thermal confound, stated so the checks below make sense: arms of different lengths heat the die by different amounts DURING their own measurement (leakage rises with temperature), and that heating is intrinsic to each length, so the forward↔reverse ordering does not remove it. What the ordering buys is a test: the reverse pass of each length runs on a globally hotter die, so if forward and reverse agree per length, temperature is not moving the number. This gate is load-bearing, not decorative: on the reference phone, two identical back-to-back prefills differed by at least 49% across an 11 °C battery-temperature rise. Any length whose forward↔reverse J step exceeds the configured stability limit refuses the slope, and the per-arm start→end battery temperature and observed clocks are printed in the table to keep the confound visible.");
  console.log("");

  let idleW = NaN;
  if (existsSync(`${outDir}/idle-floor.csv`)) {
    idleW = integrate(parseEnergyCsv(readFileSync(`${outDir}/idle-floor.csv`, "utf8")).rows).mean_w;
  }
  // Expected arms come from the order rows, which are written BEFORE each arm
  // runs: a vanished arm must be visible instead of silently shrinking the
  // denominator (a 4-of-8 block must never read "all arms stable").
  const plExpectedKeys = [...new Set(orderRows.filter((r) => r.block === "promptlen").map((r) => `${r.model}|${r.block}|${r.position}|${r.arm}`))];
  const plGroupKeys = new Set(plEntries.map((e) => `${e.model}|${e.block}|${e.position}|${e.arm}`));
  const plMissingArms = plExpectedKeys.filter((k) => !plGroupKeys.has(k));
  const plUnstableCount = plExpectedKeys.filter((k) => blockGroups.get(k)?.unstable).length;
  const plStateParts = [];
  if (plUnstableCount) plStateParts.push(`${plUnstableCount} of ${plExpectedKeys.length} expected arms UNINTERPRETABLE (section 1)`);
  if (plMissingArms.length) plStateParts.push(`${plMissingArms.length} of ${plExpectedKeys.length} expected arms produced no rows (${plMissingArms.map((k) => k.split("|")[3]).join(", ")})`);
  if (!plStateParts.length) plStateParts.push(`all ${plExpectedKeys.length} expected arms stable (section 1)`);
  console.log(`Block state: ${plStateParts.join("; ")}; session idle floor ${f(idleW, 3)} W (section 2); per-arm battery, temperature, ordering and screen state in sections 1 and 3. Absolute joules are session-relative (docs/ENERGY-SCHEMA.md). Each rep generates ${Number.isFinite(promptlenNgen) ? promptlenNgen : "n/a"} tokens (PROMPTLEN_NGEN) so the decode bucket is present as a reference only — at that length decode J/token is low-resolution by the schema's own coverage discipline and is not a J/token claim.`);
  console.log("");

  // Points are keyed by model|arm: with INCLUDE_1P2B=1 both models produce
  // the same arm labels, and their rows must never merge into one curve.
  const plByArm = new Map();
  for (const e of plEntries) {
    const key = `${e.model}|${e.arm}`;
    if (!plByArm.has(key)) plByArm.set(key, []);
    plByArm.get(key).push(e);
  }
  const meanOf = (list, field) => {
    const v = list.map((e) => finite(e.row[field])).filter((x) => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  };
  const covOf = (list, nomField, intField) => {
    const v = list.map((e) => {
      const nom = finite(e.row[nomField]);
      const int = finite(e.row[intField]);
      return nom && int !== null && nom > 0 ? int / nom : null;
    }).filter((x) => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  };
  // A rep enters its length point only with a real stamped prefill bucket.
  // The v2 fallback writes j_prefill = "0.000" (energyPhaseSplit.mjs:408),
  // which is finite and would drag the mean toward zero, so zero prefill
  // seconds or zero prefill energy marks the row unusable for this section.
  const plRepUsable = (e) => {
    const ps = finite(e.row.prefill_s);
    const jp = finite(e.row.j_prefill);
    const np = Number(e.row.n_prefill);
    return ps !== null && ps > 0 && jp !== null && jp > 0 && Number.isFinite(np) && np > 0;
  };
  const plTempOf = (half) => {
    const e = half[0];
    if (!e) return "n/a";
    const meta = metaByKey.get(`${e.model}|${e.block}|${e.position}|${e.arm}`);
    return meta ? `${meta.startTemp}→${meta.endTemp}` : "n/a";
  };
  const plPoints = [...plByArm.entries()].map(([key, list]) => {
    const sep = key.indexOf("|");
    const model = key.slice(0, sep);
    const arm = key.slice(sep + 1);
    const good = list.filter(plRepUsable);
    const nominal = Number(arm.slice(1));
    const positions = [...new Set(list.map((e) => e.position))].sort((a, b) => a - b);
    const fwd = good.filter((e) => e.position === positions[0]);
    const rev = good.filter((e) => e.position === positions[positions.length - 1]);
    const measuredSet = [...new Set(good.map((e) => finite(e.row.prompt_tokens)).filter((x) => x !== null))];
    // Forward↔reverse agreement exists only when BOTH halves ran and each
    // kept a usable rep: with a single position, fwd and rev would be the
    // same set and drift would read 0.0% — a phantom proof of cleanliness.
    const bothHalves = positions.length >= 2 && fwd.length > 0 && rev.length > 0;
    const fwdJ = meanOf(fwd, "j_prefill");
    const revJ = meanOf(rev, "j_prefill");
    const meanJPrefill = meanOf(good, "j_prefill");
    return {
      model,
      arm,
      nominal,
      used: good.length,
      total: list.length,
      bothHalves,
      measured: measuredSet.length === 1 ? measuredSet[0] : NaN,
      meanPrefillS: meanOf(good, "prefill_s"),
      meanJPrefill,
      jPer1k: measuredSet.length === 1 && Number.isFinite(meanJPrefill) ? meanJPrefill / (measuredSet[0] / 1000) : NaN,
      decodeJ: meanOf(good, "j_decode"),
      decodeCov: covOf(good, "decode_s", "decode_s_int"),
      prefillCov: covOf(good, "prefill_s", "prefill_s_int"),
      fwdJ,
      revJ,
      drift: bothHalves && Number.isFinite(fwdJ) && Number.isFinite(revJ) && fwdJ !== 0 ? ((revJ / fwdJ) - 1) * 100 : NaN,
      stable: list.every((e) => !blockGroups.get(`${e.model}|${e.block}|${e.position}|${e.arm}`)?.unstable),
      fwdTemp: plTempOf(fwd),
      revTemp: plTempOf(rev),
      clocks: fwd[0] ? (clocksByStem.get(fwd[0].stem) || "n/a") : "n/a",
    };
  }).sort((a, b) => a.model.localeCompare(b.model) || a.nominal - b.nominal);

  console.log("| model | nominal target | measured tokens | reps used | mean prefill s | mean j_prefill J | J per 1000 prompt tok (raw, incl. fixed cost) | forward J | reverse J | fwd→rev step | decode ref (cov) | prefill coverage | fwd temp deci-C start→end | rev temp deci-C start→end | observed clocks (fwd) | stable |");
  console.log("|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---|---:|---|---|---|---|");
  for (const p of plPoints) {
    const decodeRef = Number.isFinite(p.decodeJ) ? `${f(p.decodeJ, 2)} J (${f(p.decodeCov * 100, 0)}%)` : "n/a";
    // Without both halves a forward or reverse mean is not a measurement;
    // print n/a instead of echoing the surviving half.
    const fwdCell = p.bothHalves ? f(p.fwdJ) : "n/a";
    const revCell = p.bothHalves ? f(p.revJ) : "n/a";
    console.log(`| ${md(p.model)} | ${p.nominal} | ${Number.isFinite(p.measured) ? p.measured : "n/a"} | ${p.used}/${p.total} | ${f(p.meanPrefillS)} | ${f(p.meanJPrefill)} | ${f(p.jPer1k, 2)} | ${fwdCell} | ${revCell} | ${f(p.drift, 1)}% | ${decodeRef} | ${f(p.prefillCov * 100, 0)}% | ${p.fwdTemp} | ${p.revTemp} | ${p.clocks} | ${p.stable ? "stable" : "**UNINTERPRETABLE**"} |`);
  }
  console.log("");

  const fitPts = plPoints.filter((p) => Number.isFinite(p.measured) && Number.isFinite(p.meanJPrefill) && Number.isFinite(p.meanPrefillS))
    .map((p) => ({ x: p.measured, y: p.meanJPrefill, y2: p.meanPrefillS, label: p.arm }));
  function linfit(pts, key) {
    const n = pts.length;
    if (n < 3) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of pts) { sx += p.x; sy += p[key]; sxx += p.x * p.x; sxy += p.x * p[key]; }
    const denom = n * sxx - sx * sx;
    if (denom === 0) return null;
    const slope = (n * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / n;
    const ymean = sy / n;
    let ssres = 0, sstot = 0;
    const residuals = pts.map((p) => {
      const r = p[key] - (intercept + slope * p.x);
      ssres += r * r;
      sstot += (p[key] - ymean) ** 2;
      return r;
    });
    return { slope, intercept, n, r2: sstot > 0 ? 1 - ssres / sstot : NaN, residuals };
  }
  const fitJ = linfit(fitPts, "y");
  const fitS = linfit(fitPts, "y2");
  // The headline inherits every refusal: all four designed length points
  // must survive with every rep, every arm stable, every length carrying a
  // real forward↔reverse pair within the stability limit, exactly one model
  // in the block, and a slope that survives dropping any single point.
  const plModels = [...new Set(plEntries.map((e) => e.model))];
  const driftFailures = plPoints.filter((p) => p.bothHalves && !(Number.isFinite(p.drift) && Math.abs(p.drift) <= stabilityLimit));
  const reasons = [];
  if (fitPts.length < 4) reasons.push(`only ${fitPts.length} of 4 length points survived into the fit (missing stamps, zeroed v2-fallback prefill rows, or undeterminable counts — see the reps-used column)`);
  if (plModels.length > 1) reasons.push(`promptlen entries span ${plModels.length} models (${plModels.join(", ")}) — the marginal prefill cost is per-model and this section is calibrated to one reference model; run one campaign per model instead of fitting across them`);
  for (const p of plPoints.filter((p) => !p.stable)) reasons.push(`${p.arm} is UNINTERPRETABLE in section 1`);
  for (const p of plPoints.filter((p) => !p.bothHalves)) reasons.push(`${p.arm} has no forward↔reverse pair (a half is missing or kept no usable reps) — thermal agreement cannot be checked`);
  for (const p of plPoints.filter((p) => p.used < p.total)) reasons.push(`${p.arm} lost ${p.total - p.used} of ${p.total} reps to unusable prefill buckets`);
  for (const p of driftFailures) reasons.push(`${p.arm} forward↔reverse J step ${f(p.drift, 1)}% is not within the ${stabilityLimit}% stability limit`);
  // Leave-one-out slope gate, replacing an R² threshold: at four points
  // spread over an 8x range one bad endpoint barely moves R² while moving
  // the published slope a lot. Refuse when dropping any single point moves
  // the slope by more than 5% — the same stability limit the instrument
  // already applies to throughput spread — i.e. the tolerance is the slope
  // error we are willing to publish, not how straight the line looks.
  const PL_LOO_TOLERANCE_PCT = 5;
  const looSlopes = plModels.length === 1 && fitPts.length >= 4
    ? fitPts.map((_, i) => {
        const loo = linfit(fitPts.filter((_, j) => j !== i), "y");
        return loo && fitJ && fitJ.slope !== 0 ? ((loo.slope / fitJ.slope) - 1) * 100 : NaN;
      })
    : [];
  for (let i = 0; i < looSlopes.length; i++) {
    if (!(Number.isFinite(looSlopes[i]) && Math.abs(looSlopes[i]) <= PL_LOO_TOLERANCE_PCT)) {
      reasons.push(`${fitPts[i].label} is load-bearing: dropping it moves the slope ${f(looSlopes[i], 1)}%, over the ${PL_LOO_TOLERANCE_PCT}% leave-one-out tolerance`);
    }
  }
  // The residual table prints on refusals too: it is the diagnostic for a
  // refused fit, with each point's leave-one-out slope showing which point
  // is load-bearing. R² stays as information, never as the gate.
  if (plModels.length === 1 && fitJ && fitS) {
    console.log(`Full fit (informational; the gate is the ${PL_LOO_TOLERANCE_PCT}% leave-one-out slope tolerance): slope ${f(fitJ.slope, 4)} J/token, intercept ${f(fitJ.intercept, 1)} J, R² = ${f(fitJ.r2, 4)}.`);
    console.log("| point | measured tokens | mean j_prefill J | j_prefill residual J | mean prefill s | prefill residual s | leave-one-out slope step |");
    console.log("|---|---:|---:|---:|---:|---:|---:|");
    fitPts.forEach((p, i) => {
      console.log(`| ${p.label} | ${p.x} | ${f(p.y)} | ${f(fitJ.residuals[i])} | ${f(p.y2)} | ${f(fitS.residuals[i])} | ${looSlopes.length ? `${f(looSlopes[i], 1)}%` : "n/a"} |`);
    });
    console.log("");
  }
  if (reasons.length === 0 && fitJ && fitS) {
    console.log(`**Headline: a window slide of N prompt tokens costs about ${f(fitJ.slope * 1000, 1)} J per 1000 tokens (${f(fitJ.slope, 4)} J/token) of marginal prefill energy, on top of a fixed ${f(fitJ.intercept, 1)} J per-invocation cost that a mid-session slide does not pay** — least-squares fit of mean j_prefill on measured prompt tokens over ${fitJ.n} points, R² = ${f(fitJ.r2, 4)}.`);
    console.log(`Marginal time: ${f(fitS.slope * 1000, 2)} s per 1000 prompt tokens (${f(fitS.slope * 1000, 2)} ms/token), fixed per-invocation intercept ${f(fitS.intercept, 2)} s, R² = ${f(fitS.r2, 4)}.`);
  } else {
    console.log(`**SLOPE REFUSED:** ${reasons.join("; ") || "no fit could be computed"}. The per-point table above is the published curve; do not quote a slope from it.`);
  }
  console.log("");
  console.log("Provenance: measured token counts and phase energies come from the `.stamps` sidecars joined by `energyPhaseSplit.mjs` (schema kalsa-energy-rep-v3); nominal lengths come from `generate_prompt_lengths` in this script and set the target only. Raw rows: section 4 and `phase-data/*.phases.csv`.");
}
NODE
  local report_rc=$?
  [ "$report_rc" -eq 0 ] || { blog "ABORT: report generation failed"; return 1; }
  REPORT_GENERATED=1
  cat "$REPORT"
  return 0
}

main() {
  local model block
  is_pos_uint "$TEMP_GATE_DECI" && is_pos_uint "$TEMP_GATE_TIMEOUT_S" && is_pos_uint "$TEMP_GATE_POLL_S" && \
    is_pos_uint "$IDLE_SECONDS" && is_pos_uint "$REPS" && is_pos_uint "$NGEN" && is_uint "$SETTLE_SECONDS" && \
    is_pos_uint "$PROMPTLEN_NGEN" \
    || { blog "ABORT: numeric environment values are invalid"; return 2; }
  case "$STABILITY_MAX_PCT" in ''|*[!0-9.]*|.*|*.*.*) blog "ABORT: STABILITY_MAX_PCT is invalid"; return 2 ;; esac
  case "$INCLUDE_1P2B" in
    1) case " $MODELS " in *" LFM2.5-1.2B-Instruct-Q4_K_M.gguf "*) ;; *) MODELS="$MODELS LFM2.5-1.2B-Instruct-Q4_K_M.gguf" ;; esac ;;
    0) ;;
    *) blog "ABORT: INCLUDE_1P2B must be 0 or 1"; return 2 ;;
  esac

  select_serial || return 2
  preflight || return 1
  device_keepawake_begin
  # device_keepawake_begin installs the shared restore trap. Replace it with
  # one combined trap so sampler cleanup and the shared restore both happen.
  trap sweep_cleanup EXIT
  trap 'exit 130' INT TERM
  adb shell input keyevent KEYCODE_WAKEUP </dev/null >/dev/null 2>&1 || true
  push_bin || return 1
  verify_models || return 1
  push_prompt || { blog "ABORT: failed to push REP prompt"; return 1; }
  case " $BLOCKS " in
    *" promptlen "*)
      generate_prompt_lengths || { blog "ABORT: could not generate length prompts"; return 1; }
      push_prompt_lengths || return 1
      ;;
  esac
  run_idle_floor || return 1

  for model in $MODELS; do
    for block in $BLOCKS; do
      run_block "$model" "$block" || return 1
    done
  done
  generate_report || return 1
  blog "done -> $REPORT"
  return 0
}

main "$@"
