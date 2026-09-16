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
#   SETTLE_SECONDS        default: 45
#   STABILITY_MAX_PCT     default: 5
#   BLOCKS                default: "primary_t2 a55_t6 control"
#   COUNTS_MANIFEST       default: scripts/fixtures/energy-counts/manifest.csv

set -uo pipefail

_SWEEP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-device-energy-sweep-out}"
BENCH_DIR="${BENCH_DIR:-/data/local/tmp/energy-sweep}"
MODEL_DIR="${MODEL_DIR:-/data/local/tmp/llamabench}"
LOCAL_BIN="${LOCAL_BIN:-$_SWEEP_DIR/../tmp/build-android-phase-stamps/bin}"
MODELS="${MODELS:-LFM2.5-2.6B-Q4_K_M.gguf}"
INCLUDE_1P2B="${INCLUDE_1P2B:-0}"
TEMP_GATE_DECI="${TEMP_GATE_DECI:-300}"
TEMP_GATE_TIMEOUT_S="${TEMP_GATE_TIMEOUT_S:-1200}"
TEMP_GATE_POLL_S="${TEMP_GATE_POLL_S:-30}"
IDLE_SECONDS="${IDLE_SECONDS:-60}"
REPS="${REPS:-3}"
NGEN="${NGEN:-256}"
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

arm_config() {
  case "$1" in
    a55_t2) ARM_MASK=3f; ARM_THREADS=2; ARM_LABEL=a55_t2 ;;
    a55_t6) ARM_MASK=3f; ARM_THREADS=6; ARM_LABEL=a55_t6 ;;
    a76_t2) ARM_MASK=c0; ARM_THREADS=2; ARM_LABEL=a76_t2 ;;
    none) ARM_MASK=""; ARM_THREADS=2; ARM_LABEL=none ;;
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
  pf="$REMOTE_PROMPT"
  energy_start "$stem" 7200 || return 1
  launcher="./llama-cli"
  [ -n "$mask" ] && launcher="taskset $mask ./llama-cli"

  for i in $(seq 1 "$REPS"); do
    out="$DATA_DIR/${stem}_r${i}.txt"
    stamps="$BENCH_DIR/${stem}_r${i}.stamps"
    stamp_out="$DATA_DIR/${stem}_r${i}.stamps"
    rm -f "$out" "$stamp_out"
    adb shell "rm -f $stamps" </dev/null
    adb shell "cd $BENCH_DIR && KALSA_PHASE_STAMPS=$stamps LD_LIBRARY_PATH=. timeout 600 $launcher -m $MODEL_DIR/$model -f $pf -n $NGEN -t $threads -st --temp 0 --simple-io" \
      </dev/null > "$out" 2>&1
    rc=$?
    # The mark is deliberately the first host-side action after llama-cli.
    adb shell "echo r$i \$(cut -d' ' -f1 /proc/uptime) >> $BENCH_DIR/$stem.marks" </dev/null
    adb pull "$stamps" "$stamp_out" </dev/null >/dev/null 2>&1 \
      || blog "phase stamps pull FAILED for $stem r$i"
    if [ ! -s "$stamp_out" ]; then
      blog "phase stamps MISSING/EMPTY for $stem r$i (expected $stamp_out)"
    fi
    if [ "$rc" -ne 0 ]; then
      blog "    r$i: llama-cli failed with status $rc"
      energy_stop "$stem"
      return 1
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
    [ -n "$end_screen" ] || end_screen="unknown"
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
  node --input-type=module - "$DATA_DIR" "$OUT" "$_SWEEP_DIR/energySchema.mjs" "$STABILITY_MAX_PCT" "$REPS" > "$REPORT" <<'NODE'
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [dataDir, outDir, schemaPath, stabilityLimitRaw, expectedRepsRaw] = process.argv.slice(2);
const { parseEnergyCsv, integrate } = await import(pathToFileURL(schemaPath).href);
const stabilityLimit = Number(stabilityLimitRaw);
const expectedReps = Number(expectedRepsRaw);

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
  group.unstable =
    !Number.isFinite(group.spread) ||
    group.entries.length < expectedReps ||
    group.usable < expectedReps ||
    group.entries.some((e) => !Number.isFinite(e.speed) || finite(e.row.decode_s) === null) ||
    group.spread > stabilityLimit ||
    group.entries.some((e) => /low-resolution|cadence max/.test(e.row.warnings || ""));
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
  const stem = orderRows.find((r) => r.model === group.model && r.block === group.block && r.position === group.position && r.arm === group.arm)?.stem;
  const order = orderRows.filter((r) => r.model === group.model && r.block === group.block)
    .sort((a, b) => a.sequence - b.sequence)
    .map((r) => `${r.arm}(p${r.position})`).join(" → ");
  const values = group.entries.sort((a, b) => a.rep - b.rep)
    .map((e) => `r${e.rep}=${f(e.speed, 1)}`).join("/");
  const status = group.unstable ? "**UNINTERPRETABLE**" : "stable";
  console.log(`| ${md(group.model)} | ${group.block} | ${group.position} | ${group.arm} | ${order} | ${meta.effectiveCpus || "n/a"} | ${stem ? clocksByStem.get(stem) : "n/a"} | ${values || "none"} | ${f(group.spread, 1)}% | ${group.usable}/${expectedReps} | ${status} |`);
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
  console.log(`| ${md(meta.model)} | ${meta.block} | ${meta.position} | ${meta.arm} | ${actualOrder} | ${meta.effectiveCpus || "n/a"} | ${meta.startScreen || "n/a"} | ${meta.endScreen || "n/a"} | ${meta.startLevel}% / ${meta.startTemp} deci-C | ${meta.endLevel}% / ${meta.endTemp} deci-C |`);
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
  const placementWarning = ((e.mask === "3f" && meta.effectiveCpus !== "0-5") || (e.mask === "c0" && meta.effectiveCpus !== "6-7") || (e.mask === "" && meta.effectiveCpus !== "0-7"))
    ? `MASK PLACEMENT WARNING: requested ${e.mask || "unset"}, observed ${meta.effectiveCpus || "unreadable"}` : "";
  const warnings = [e.row.warnings || "", placementWarning].filter(Boolean).join("; ") || "—";
  console.log(`| ${md(e.model)} | ${e.block} | ${e.position} | ${e.arm} | ${e.mask || "unset"} | ${meta.effectiveCpus || "n/a"} | ${clocksByStem.get(e.stem) || "n/a"} | ${e.threads} | ${e.rep} | ${f(e.speed, 1)} | ${md(e.row.decode_s)} | ${coverage} | ${md(e.row.j_per_tok_decode)} | ${md(e.row.j_load_idle)} | ${md(e.row.j_prefill)} | ${md(e.row.j_decode)} | ${md(warnings)} | ${meta.startScreen || "n/a"}→${meta.endScreen || "n/a"} | ${meta.startLevel}%/${meta.startTemp} → ${meta.endLevel}%/${meta.endTemp} | ${status} |`);
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
    is_pos_uint "$IDLE_SECONDS" && is_pos_uint "$REPS" && is_pos_uint "$NGEN" && is_uint "$SETTLE_SECONDS" \
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
