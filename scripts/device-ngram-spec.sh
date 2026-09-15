#!/usr/bin/env bash
# N-gram self-speculative decoding A/B on the Jelly Star (mt6789 / Helio G99).
#
# The kalsallama fork carries five n-gram speculative types that upstream
# llama.cpp does not have (ngram-simple, ngram-map-k, ngram-map-k4v, ngram-mod,
# ngram-cache). None was ever measured on our hybrid LFM2.5 models, where the
# draft-verify loop rides the same hybrid KV rollback paths we fixed for KV
# reuse. This script answers two questions per (model, prompt, arm):
#
#   1. Correctness — greedy (--temp 0) output must be IDENTICAL to the
#      baseline (none) arm. Mac sanity: ngram-cache violates this (accepted a
#      wrong token near the end of a diverse-prose run), the other three hold.
#   2. Speed — "[ Prompt: X t/s | Generation: Y t/s ]" per rep, aggregated.
#
# Arms: none ngram-simple ngram-map-k4v ngram-mod. ngram-cache is excluded by
# default (fails the greedy gate); pass CACHE=1 to add it and re-check on
# device.
#
# Timing discipline (project rule, same as device-decode-lineup.sh): the run
# ABORTS if the device is charging — timings on charge are not comparable.
# Battery floor 30%. Temp/level logged around every arm; 45s settle between.
#
# Uses ONLY /data/local/tmp/ngramspec. Never the app's files/models.
#
#   ANDROID_SERIAL=<serial> scripts/device-ngram-spec.sh
#   ARMS="none ngram-simple" MODELS="LFM2.5-1.2B-Instruct-Q4_K_M.gguf" REPS=3 …
set -uo pipefail

_NGS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_NGS_DIR/device-share-send.sh"

OUT="device-ngram-spec-out"
BENCH_DIR="/data/local/tmp/ngramspec"
LOCAL_MODELS="${LOCAL_MODELS:-$HOME/kalsa-models}"
LOCAL_BIN="${LOCAL_BIN:-$_NGS_DIR/../tmp/build-android/bin}"
MODELS="${MODELS:-LFM2.5-2.6B-QAD-Q4_0.gguf LFM2.5-1.2B-Instruct-Q4_K_M.gguf}"
ARMS="${ARMS:-none ngram-simple ngram-map-k4v ngram-mod}"
[ "${CACHE:-0}" = "1" ] && ARMS="$ARMS ngram-cache"
PROMPTS="${PROMPTS:-REP DIV}"
NGEN="${NGEN:-256}"
REPS="${REPS:-2}"
THREADS="${THREADS:-2}"

mkdir -p "$OUT"
RESULT="$OUT/results.txt"
: > "$RESULT"

blog() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$RESULT"; }

battery_line() {
  adb shell 'dumpsys battery | grep -E "level|temperature|powered"' </dev/null 2>/dev/null \
    | tr -d '\r' | tr '\n' ' '
}

# Charging invalidates every number this script produces (project rule).
preflight() {
  local b; b="$(battery_line)"
  blog "preflight: $b"
  if printf '%s' "$b" | grep -qE '(AC|USB) powered: true'; then
    blog "ABORT: charging. Unplug the Jelly and re-run."
    return 1
  fi
  local lvl; lvl="$(printf '%s' "$b" | sed -n 's/.*level: \([0-9]*\).*/\1/p')"
  if [ -n "$lvl" ] && [ "$lvl" -lt 30 ]; then
    blog "ABORT: battery ${lvl}% below the 30% floor."
    return 1
  fi
  return 0
}

push_bin() {
  adb shell "mkdir -p $BENCH_DIR" </dev/null
  local f
  for f in "$LOCAL_BIN"/llama-cli "$LOCAL_BIN"/*.so; do
    [ -f "$f" ] || continue
    adb push "$f" "$BENCH_DIR/$(basename "$f")" </dev/null >/dev/null 2>&1
  done
  adb shell "chmod 755 $BENCH_DIR/llama-cli" </dev/null
  # One smoke invocation; a missing .so or ABI mismatch dies here.
  if ! adb shell "cd $BENCH_DIR && LD_LIBRARY_PATH=. ./llama-cli --version 2>&1 | head -2" </dev/null 2>&1 | tr -d '\r' | tee -a "$RESULT"; then
    blog "ABORT: llama-cli does not run on device"
    return 1
  fi
  return 0
}

push_prompt_files() {
  # REP: structured, self-similar continuation — the n-gram friendly case and
  # the shape of the app's own structured replies (lists, repeated fields).
  cat > "$OUT/rep.txt" <<'EOF'
Checklist for the warehouse audit:
- item 1: checked
- item 2: checked
- item 3: checked
- item 4: checked
- item 5: checked
- item 6: checked
Continue the checklist with items 7 through 40, same format.
EOF
  # DIV: wiki excerpt — adversarial, near-zero repeats; measures the pure
  # overhead of a speculative arm when the draft should rarely fire.
  head -c 1500 "$LOCAL_MODELS/wiki.test.raw" > "$OUT/div.txt" 2>/dev/null
  adb push "$OUT/rep.txt" "$BENCH_DIR/rep.txt" </dev/null >/dev/null 2>&1
  adb push "$OUT/div.txt" "$BENCH_DIR/div.txt" </dev/null >/dev/null 2>&1
}

# Speed lines look like: [ Prompt: 266.6 t/s | Generation: 91.5 t/s ]
speed_of() {
  grep -o 'Generation: [0-9.]* t/s' "$1" | head -1
}

# Drop banner/timing/exiting noise so arms compare byte-for-byte.
clean_out() {
  grep -v '^\[ Prompt:\|^Exiting\|^Loading model' "$1" \
    | sed -e 's/[[:space:]]*$//' -e '/^$/d'
}

run_arm() {
  local model="$1" arm="$2" prompt="$3" rep i out speed
  # macOS ships bash 3.2: no ${var,,}. tr it.
  local pf="$BENCH_DIR/$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]').txt"
  for i in $(seq 1 "$REPS"); do
    out="$OUT/$(basename "$model" .gguf)_${arm}_${prompt}_r$i.txt"
    adb shell "cd $BENCH_DIR && LD_LIBRARY_PATH=. timeout 600 ./llama-cli \
      -m /data/local/tmp/llamabench/$model -f $pf -n $NGEN -t $THREADS \
      -st --temp 0 --simple-io ${arm:+--spec-type $arm}" \
      </dev/null > "$out" 2>&1
    if [ ! -s "$out" ]; then
      blog "EMPTY OUTPUT $out"
      return 1
    fi
    speed="$(speed_of "$out")"
    if [ -z "$speed" ]; then
      # No perf line = the run never completed (link error, crash, timeout).
      # Never let a failed run reach the greedy gate: two identical failures
      # compare equal and would masquerade as a pass (seen in the first smoke).
      blog "    r$i: FAILED: $(tail -1 "$out" | cut -c1-120)"
      return 1
    fi
    blog "    r$i: ${speed}"
    sleep 5
  done
  return 0
}

# Correctness gate: every rep of every arm must equal the baseline text.
# Divergence means the arm accepted a draft token the target would not have
# sampled (self-speculation invariant), or truncated differently.
check_correctness() {
  local model="$1" arm="$2" prompt="$3" i base mine
  local base_clean="$OUT/_base_clean.txt" mine_clean="$OUT/_mine_clean.txt"
  for i in $(seq 1 "$REPS"); do
    base="$OUT/$(basename "$model" .gguf)_none_${prompt}_r$i.txt"
    mine="$OUT/$(basename "$model" .gguf)_${arm}_${prompt}_r$i.txt"
    [ -f "$base" ] && [ -f "$mine" ] || { blog "  GATE INCONCLUSIVE (missing files)"; return 1; }
    clean_out "$base" > "$base_clean"
    clean_out "$mine" > "$mine_clean"
    if ! cmp -s "$base_clean" "$mine_clean"; then
      blog "  GREEDY GATE FAILED r$i (arm text != baseline text) — see $OUT/"
      return 1
    fi
  done
  blog "  greedy gate: IDENTICAL ($REPS reps)"
  return 0
}

device_keepawake_begin
# SMOKE=1 skips the charging gate: correctness-only runs produce no timings,
# so they are valid on charge. Any run meant for SPEED must go unplugged.
[ "${SMOKE:-0}" = "1" ] || preflight || exit 1
push_bin || exit 1
push_prompt_files

for m in $MODELS; do
  if ! adb shell "test -f /data/local/tmp/llamabench/$m" </dev/null 2>/dev/null; then
    blog "SKIP $m — not on device (/data/local/tmp/llamabench)"
    continue
  fi
  for p in $PROMPTS; do
    blog "--- $m  prompt=$p  (t=$THREADS, n=$NGEN, r=$REPS)"
    blog "    before: $(battery_line)"
    for arm in $ARMS; do
      blog "  arm: ${arm:-none}"
      if ! run_arm "$m" "$arm" "$p"; then
        blog "  arm $arm failed, continuing"
      fi
      if [ "$arm" = "none" ]; then
        continue  # baseline is the reference, no gate against itself
      fi
      check_correctness "$m" "$arm" "$p" || true
      blog "    after:  $(battery_line)"
      # Let the SoC settle so the next arm does not start hot.
      sleep 45
      # Mid-campaign re-check: plugging in mid-run invalidates the rest.
      if [ "${SMOKE:-0}" != "1" ] && printf '%s' "$(battery_line)" | grep -qE '(AC|USB) powered: true'; then
        blog "ABORT: device plugged in mid-campaign."
        exit 1
      fi
    done
  done
done

blog "done -> $RESULT"
blog "aggregate with: node scripts/ngramSpecAggregate.mjs"
