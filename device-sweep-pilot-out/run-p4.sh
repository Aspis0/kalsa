#!/usr/bin/env bash
# Continuation of the killed Fase 2b sweep: completes p4 (a55_t2 late position)
# with the EXACT commands of run_one_arm/run_block/energy_start/energy_stop
# from scripts/device-energy-sweep.sh. Host harness died by client timeout;
# device-side orphan was killed before any p4 mark; sampler restarted fresh.
set -uo pipefail
export ANDROID_SERIAL=192.168.1.82:5555
OUT=/tmp/kalsa-pilot/out
DATA_DIR="$OUT/phase-data"
RESULT="$OUT/results.txt"
BLOCK_META_TSV="$OUT/block-meta.tsv"
BENCH_DIR=/data/local/tmp/energy-sweep
MODEL_DIR=/data/local/tmp/llamabench
REMOTE_PROMPT="$BENCH_DIR/rep.txt"
model="LFM2.5-2.6B-Q4_K_M.gguf"
model_base="LFM2.5-2.6B-Q4_K_M"
block="primary_t2"
position=4
arm="a55_t2"
mask="3f"
threads=2
stem="${model_base}_${block}_p${position}_${arm}"
order="a55_t2,a76_t2,a76_t2,a55_t2"
REPS=3
NGEN=256

blog() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$RESULT"; }
battery_line() {
  adb shell 'dumpsys battery | grep -E "level|temperature|powered"' </dev/null 2>/dev/null \
    | tr -d '\r' | tr '\n' ' '
}
battery_level_from_line() { printf '%s\n' "$1" | sed -n 's/.*level: \([0-9][0-9]*\).*/\1/p'; }
battery_temp_from_line() { printf '%s\n' "$1" | sed -n 's/.*temperature: \([0-9][0-9]*\).*/\1/p'; }
screen_state() {
  adb shell 'dumpsys power | grep -m1 mWakefulness' </dev/null 2>/dev/null | tr -d '\r' | sed 's/^[[:space:]]*//'
}
speed_of() { grep -o 'Generation: [0-9.]* t/s' "$1" | head -1; }

blog "p4-restart: host harness was killed by client timeout at ~05:34 local; orphaned p4 r1 (no mark written, speed line lost) killed; sampler restarted fresh; placement probe + temp gate from 05:34:10 stand (mask 3f observed 0-5)"

b="$(battery_line)" || true
blog "p4-restart preflight: $b"
if printf '%s' "$b" | grep -qE '(AC|USB) powered: true'; then blog "ABORT: charging."; exit 1; fi
lvl="$(battery_level_from_line "$b")"
if [ -z "$lvl" ] || [ "$lvl" -lt 30 ]; then blog "ABORT: battery floor."; exit 1; fi

adb shell input keyevent KEYCODE_WAKEUP </dev/null >/dev/null 2>&1 || { blog "ABORT: wakeup failed"; exit 1; }
start="$(battery_line)" || true
start_level="$(battery_level_from_line "$start")"
start_temp="$(battery_temp_from_line "$start")"
start_screen="$(screen_state)" || true
[ -n "$start_screen" ] || { blog "ABORT: screen unreadable"; exit 1; }
blog "p4-restart block start sample: level=${start_level} temp=${start_temp} screen=${start_screen}"

# energy_start (verbatim logic)
tag="$stem"
adb shell "pkill -f '[e]nergy-sample.sh' 2>/dev/null; rm -f $BENCH_DIR/stop.energy.$tag $BENCH_DIR/$tag.csv $BENCH_DIR/$tag.marks" </dev/null || exit 1
adb shell "(setsid sh $BENCH_DIR/energy-sample.sh $BENCH_DIR/$tag.csv $BENCH_DIR/stop.energy.$tag 1 7200 >$BENCH_DIR/$tag.err 2>&1 </dev/null &)" </dev/null || { blog "ABORT: sampler start failed"; exit 1; }
sleep 2

launcher="sh -c 'grep -E ^Cpus_allowed /proc/self/status; exec ./llama-cli \"\$@\"' _"
launcher="taskset $mask $launcher"

for i in $(seq 1 "$REPS"); do
  out="$DATA_DIR/${stem}_r${i}.txt"
  stamps="$BENCH_DIR/${stem}_r${i}.stamps"
  stamp_out="$DATA_DIR/${stem}_r${i}.stamps"
  rm -f "$out" "$stamp_out"
  adb shell "rm -f $stamps" </dev/null
  adb shell "cd $BENCH_DIR && KALSA_PHASE_STAMPS=$stamps LD_LIBRARY_PATH=. timeout 600 $launcher -m $MODEL_DIR/$model -f $REMOTE_PROMPT -n $NGEN -t $threads -st --temp 0 --simple-io" \
    </dev/null > "$out" 2>&1
  rc=$?
  adb shell "echo r$i \$(cut -d' ' -f1 /proc/uptime) >> $BENCH_DIR/$stem.marks" </dev/null
  adb pull "$stamps" "$stamp_out" </dev/null >/dev/null 2>&1 \
    || blog "phase stamps pull FAILED for $stem r$i"
  if [ ! -s "$stamp_out" ]; then
    blog "phase stamps MISSING/EMPTY for $stem r$i (expected $stamp_out)"
  fi
  if [ "$rc" -ne 0 ]; then
    blog "    r$i: llama-cli failed with status $rc"
    adb shell "touch $BENCH_DIR/stop.energy.$tag 2>/dev/null; sleep 2; kill \$(cat $BENCH_DIR/$tag.csv.pid 2>/dev/null) 2>/dev/null; rm -f $BENCH_DIR/$tag.csv.pid" </dev/null
    exit 1
  fi
  speed="$(speed_of "$out")"
  if [ -z "$speed" ]; then
    blog "    r$i: FAILED: $(tail -1 "$out" | cut -c1-120)"
    adb shell "touch $BENCH_DIR/stop.energy.$tag 2>/dev/null; sleep 2; kill \$(cat $BENCH_DIR/$tag.csv.pid 2>/dev/null) 2>/dev/null; rm -f $BENCH_DIR/$tag.csv.pid" </dev/null
    exit 1
  fi
  blog "    $stem r$i: $speed"
  sleep 5
done

# energy_stop (verbatim logic)
adb shell "touch $BENCH_DIR/stop.energy.$tag 2>/dev/null; sleep 2; kill \$(cat $BENCH_DIR/$tag.csv.pid 2>/dev/null) 2>/dev/null; rm -f $BENCH_DIR/$tag.csv.pid" </dev/null
if ! adb pull "$BENCH_DIR/$tag.csv" "$DATA_DIR/$tag.csv" </dev/null >/dev/null 2>&1; then
  blog "energy csv pull FAILED for $tag"
fi
adb pull "$BENCH_DIR/$tag.marks" "$DATA_DIR/$tag.marks" </dev/null >/dev/null 2>&1 \
  || blog "marks pull FAILED for $tag"

# mid-campaign charge check (verbatim)
b="$(battery_line)" || true
if printf '%s' "$b" | grep -qE '(AC|USB) powered: true'; then blog "ABORT: device plugged in mid-campaign."; exit 1; fi
lvl="$(battery_level_from_line "$b")"
case "$lvl" in ''|*[!0-9]*) blog "ABORT: battery unreadable mid-campaign."; exit 1 ;; esac
if [ "$lvl" -lt 30 ]; then blog "ABORT: battery ${lvl}% below floor."; exit 1; fi

end="$(battery_line)" || true
end_level="$(battery_level_from_line "$end")"
end_temp="$(battery_temp_from_line "$end")"
end_screen="$(screen_state)" || true
[ -n "$end_screen" ] || end_screen="unknown"
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$model_base" "$block" "$position" "$arm" "$mask" "$threads" "0-5" \
  "$start_level" "$start_temp" "$end_level" "$end_temp" "$start_screen" "$end_screen" "$start" "$end" "$order" >> "$BLOCK_META_TSV"
blog "block end: model=$model block=$block position=$position arm=$arm start=${start_level}%/${start_temp}dC end=${end_level}%/${end_temp}dC"
blog "comparison end: model=$model block=$block order=$order"
blog "p4-restart: DONE"
