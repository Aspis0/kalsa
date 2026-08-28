#!/usr/bin/env bash
# Decode tok/s on the Jelly for the models the quality bake-off shortlisted.
#
# WHY A CONTROL: every speed number in HARNESS_FINDINGS §7.38 is a PREDICTION —
# file size divided by the 9.11 GB/s effective bandwidth that LFM2.5-2.6B's own
# in-app measurement implies. This run measures two of the predictions and,
# crucially, re-measures the model the constant came from. Without that arm the
# other two cannot be compared to anything: llama-bench is not the app, and the
# offset between them is exactly what the control reports.
#
# Threads: 2, the helio-g99 preset's DECODE count (deviceTuning.ts). Not 8 —
# that is the prefill count, and using it here would measure a config the app
# never decodes with.
#
# ⛔ Touches only /data/local/tmp/llamabench. Never the app's files/models.
# One invocation, keep-awake armed at the top, `</dev/null` on every adb call.
#
#   ANDROID_SERIAL=<serial> scripts/device/device-decode-lineup.sh
set -uo pipefail

_DL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=device-share-send.sh
source "$_DL_DIR/device-share-send.sh"

OUT="out/device/decode-lineup"
BENCH_DIR="/data/local/tmp/llamabench"
LOCAL_MODELS="/Users/marco/kalsa-models"
THREADS="${THREADS:-2}"
REPS="${REPS:-3}"
NGEN="${NGEN:-128}"

mkdir -p "$OUT"
RESULT="$OUT/results.txt"
: > "$RESULT"

blog() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$RESULT"; }

battery_line() {
  adb shell 'dumpsys battery | grep -E "level|temperature|powered"' </dev/null 2>/dev/null \
    | tr -d '\r' | tr '\n' ' '
}

# Refuse to produce numbers that are not comparable to anything else we have.
preflight() {
  local b; b="$(battery_line)"
  blog "preflight: $b"
  if printf '%s' "$b" | grep -qE '(AC|USB) powered: true'; then
    blog "ABORT: charging. Timings taken on charge are not comparable (project rule)."
    return 1
  fi
  local lvl; lvl="$(printf '%s' "$b" | sed -n 's/.*level: \([0-9]*\).*/\1/p')"
  if [ -n "$lvl" ] && [ "$lvl" -lt 30 ]; then
    blog "ABORT: battery ${lvl}% below the 30% floor."
    return 1
  fi
  return 0
}

push_model() {
  local name="$1" local_path="$LOCAL_MODELS/$1"
  [ -f "$local_path" ] || { blog "SKIP $name — not on this Mac"; return 1; }
  local want have
  want="$(stat -f%z "$local_path")"
  have="$(adb shell "stat -c%s $BENCH_DIR/$name 2>/dev/null" </dev/null 2>/dev/null | tr -d '\r')"
  if [ "$have" = "$want" ]; then blog "$name already on device ($want bytes)"; return 0; fi
  blog "pushing $name ($((want/1000000)) MB)…"
  adb push "$local_path" "$BENCH_DIR/$name" </dev/null >/dev/null 2>&1 || { blog "push FAILED"; return 1; }
  have="$(adb shell "stat -c%s $BENCH_DIR/$name" </dev/null 2>/dev/null | tr -d '\r')"
  [ "$have" = "$want" ] || { blog "SIZE MISMATCH after push: $have vs $want"; return 1; }
  blog "$name pushed and size-verified"
}

bench_model() {
  local name="$1"
  blog "--- $name  (t=$THREADS, tg$NGEN, r=$REPS)"
  blog "    before: $(battery_line)"
  adb shell "cd $BENCH_DIR && LD_LIBRARY_PATH=. ./llama-bench -m $name -p 0 -n $NGEN -t $THREADS -r $REPS 2>&1 | tail -8" \
    </dev/null 2>&1 | tr -d '\r' | tee -a "$RESULT"
  blog "    after:  $(battery_line)"
  # Let the SoC settle so the next arm does not start hot on the previous one.
  sleep 45
}

device_keepawake_begin
preflight || exit 1

for m in LFM2.5-1.2B-Instruct-Q4_K_M.gguf LFM2.5-2.6B-QAD-Q4_0.gguf; do
  push_model "$m" || blog "continuing without $m"
done

# Control first, while the device is coldest: it is the arm the other two are read against.
for m in LFM2.5-2.6B-Q4_K_M.gguf LFM2.5-2.6B-QAD-Q4_0.gguf LFM2.5-1.2B-Instruct-Q4_K_M.gguf; do
  adb shell "test -f $BENCH_DIR/$m" </dev/null 2>/dev/null && bench_model "$m" || blog "SKIP $m — not on device"
done

blog "done -> $RESULT"
