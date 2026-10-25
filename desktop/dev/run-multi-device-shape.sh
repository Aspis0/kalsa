#!/usr/bin/env zsh
# Multi-device shape experiment — one household server, two candidate designs.
#
#   A  --parallel 1   one slot, whole context, requests serialise in the queue
#   B2 --parallel 2   two slots, context split in two
#   B4 --parallel 4   four slots, context split in four
#   U  (no flag)      slots auto -> 4 AND kv_unified=true: idle slots are purged
#                     on every new task (the erasure behaviour behind the 21x
#                     finding). Explicit -np N keeps kv_unified=false.
#
# Every run: same total --ctx-size 16384, the app's own argv shape
# (crates/kalsa-launch/src/argv.rs) plus --metrics and -lv 5 so the queue
# gauges and the real llama_kv_cache / sched_reserve lines land in the log.
#
# Real exit codes for every step, every server stopped, 20 s cool-down
# between runs (heat is conservative; Trinity is small).

set -u

BIN="/Users/marco/Library/Application Support/kalsa-brain/runtime/builds/metal/llama-b10950/llama-server"
MODEL="/Users/marco/Library/Application Support/kalsa-brain/runtime/models/Trinity-Nano-Preview-Q4_K_M.gguf"
PY=/opt/homebrew/bin/python3
HERE=/Users/marco/Projects/kalsa-brain/dev
RESULTS="$HERE/results/multi-device-shape"
SCRIPT="$HERE/simulate-phones.py"

mkdir -p "$RESULTS"
MANIFEST="$RESULTS/manifest.txt"
: > "$MANIFEST"

note() { print -r -- "$1" >> "$MANIFEST"; }

note "host: $(sysctl -n machdep.cpu.brand_string)"
note "binary: b10950 ($("$BIN" --version 2>&1 | head -1))"
note "model: $(basename "$MODEL")"

run_one() {
  local name="$1" parallel_args="$2" phones="$3" doc_words="$4" port="$5"

  local dir="$RESULTS/$name"
  mkdir -p "$dir"
  note "--- run $name (parallel: ${parallel_args:-auto}, phones: $phones, doc_words: $doc_words, port: $port)"

  if lsof -i ":$port" -sTCP:LISTEN | grep -q LISTEN; then
    note "port $port occupied, aborting run"
    return 90
  fi

  local argv=(--host 127.0.0.1 --port "$port" --model "$MODEL"
    --threads 4 --threads-batch 4
    --batch-size 2048 --ubatch-size 512
    --ctx-size 16384
    --n-gpu-layers all
    --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0
    --sleep-idle-seconds 3600 --no-webui
    --cache-ram 384 --metrics -lv 5)
  if [[ -n "$parallel_args" ]]; then
    argv+=(${=parallel_args})
  fi
  print -r -- "${argv[*]}" > "$dir/argv.txt"

  nohup "$BIN" "${argv[@]}" > "$dir/server.log" 2>&1 &
  local spid=$!
  local up=0
  for i in {1..120}; do
    # -f: /health answers 503 while the model loads; only 200 counts as up.
    if curl -sf -o /dev/null "http://127.0.0.1:$port/health"; then up=1; break; fi
    sleep 1
  done
  if [[ $up -ne 1 ]]; then
    note "server did not become healthy, aborting"
    kill "$spid" 2>/dev/null
    return 91
  fi
  note "server_up_exit=0"

  "$PY" "$SCRIPT" --port "$port" --phones "$phones" --turns 3 \
    --doc-words "$doc_words" --label "$name" --out "$dir/results.json" \
    > "$dir/sim.out" 2> "$dir/sim.err"
  local py_exit=$?
  note "sim_exit=$py_exit"
  [[ -s "$dir/sim.out" ]] && note "sim: $(cat "$dir/sim.out")"
  [[ -s "$dir/sim.err" ]] && note "sim_err: $(tail -2 "$dir/sim.err")"

  kill "$spid" 2>/dev/null
  for i in {1..15}; do
    lsof -i ":$port" -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 1
  done
  if lsof -i ":$port" -sTCP:LISTEN >/dev/null 2>&1; then
    kill -9 "$spid" 2>/dev/null
    note "server needed SIGKILL"
  fi
  note "server_stop_exit=0"

  # The memory rows for the doc: real load-time lines, no arithmetic.
  grep -E "n_slots = |llama_kv_cache_iswa|llama_kv_cache: size|sched_reserve:.*compute buffer" \
    "$dir/server.log" > "$dir/memory.txt"
  note "memory_lines=$(wc -l < "$dir/memory.txt" | tr -d ' ')"

  sleep 20
  return "$py_exit"
}

port=18311
fail=0
for spec in \
  "A-2p:--parallel 1:2:1500" \
  "A-4p:--parallel 1:4:1500" \
  "B2-2p:--parallel 2:2:1500" \
  "B2-4p:--parallel 2:4:1500" \
  "B4-2p:--parallel 4:2:1500" \
  "B4-4p:--parallel 4:4:1500" \
  "U-2p::2:1500" \
  "U-4p::4:1500" \
  "CLIFF-B4:--parallel 4:2:3000" \
  "CLIFF-A:--parallel 1:2:3000"
do
  name="${spec%%:*}"; rest="${spec#*:}"
  pargs="${rest%%:*}"; rem="${rest#*:}"
  nph="${rem%%:*}"; words="${rem##*:}"
  run_one "$name" "$pargs" "$nph" "$words" "$port"
  rc=$?
  note "run $name exit=$rc"
  [[ $rc -ne 0 ]] && fail=1
  port=$((port + 1))
done

note "ALL DONE fail=$fail"
print -r -- "ALL DONE fail=$fail"
exit "$fail"
