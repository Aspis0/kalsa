#!/usr/bin/env zsh
# Isolation (red/green, wrap) + switch-cost + true-overflow cliff runs.
# Every step prints a real exit code. Every server is stopped. 15-20 s
# cool-downs between GPU-heavy phases.

set -u

BIN="/Users/marco/Library/Application Support/kalsa-brain/runtime/builds/metal/llama-b10950/llama-server"
MODEL="/Users/marco/Library/Application Support/kalsa-brain/runtime/models/Trinity-Nano-Preview-Q4_K_M.gguf"
PY=/opt/homebrew/bin/python3
HERE=/Users/marco/Projects/kalsa-brain/dev
R="$HERE/results/multi-device-shape"
mkdir -p "$R/isolation"
MAN="$R/isolation/manifest.txt"
: > "$MAN"
note() { print -r -- "$1" >> "$MAN"; print -r -- "$1"; }

base_flags=(--host 127.0.0.1 --model "$MODEL"
  --threads 4 --threads-batch 4 --batch-size 2048 --ubatch-size 512
  --ctx-size 16384 --n-gpu-layers all
  --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0
  --sleep-idle-seconds 3600 --no-webui --cache-ram 384 -lv 5)

start_server() { # port, extra args...
  local port="$1"; shift
  nohup "$BIN" --port "$port" "${base_flags[@]}" "$@" > "$R/isolation/server-$port.log" 2>&1 &
  echo $!
}

wait_health() {
  local port="$1"
  for i in {1..90}; do
    curl -sf -o /dev/null "http://127.0.0.1:$port/health" && return 0
    sleep 1
  done
  return 1
}

stop_server() { # pid port
  kill "$1" 2>/dev/null
  for i in {1..15}; do
    lsof -i ":$2" -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 1
  done
  lsof -i ":$2" -sTCP:LISTEN >/dev/null 2>&1 && kill -9 "$1" 2>/dev/null
}

# --- isolation, np=1 -------------------------------------------------------
port=18331
note "isolation np=1 on $port"
pid=$(start_server "$port" --parallel 1)
if wait_health "$port"; then
  "$PY" "$HERE/test-isolation.py" --port "$port" --np 1 --red > /dev/null 2> "$R/isolation/red-np1.log"
  note "isolation-np1-red-exit=$?"
  "$PY" "$HERE/test-isolation.py" --port "$port" --np 1 > /dev/null 2> "$R/isolation/green-np1.log"
  note "isolation-np1-green-exit=$?"
else
  note "isolation-np1 server failed to start"
fi
stop_server "$pid" "$port"
note "isolation-np1-server-stopped"
sleep 15

# --- isolation, np=2 (adds the id_slot wrap test) --------------------------
port=18332
note "isolation np=2 on $port"
pid=$(start_server "$port" --parallel 2)
if wait_health "$port"; then
  "$PY" "$HERE/test-isolation.py" --port "$port" --np 2 --red > /dev/null 2> "$R/isolation/red-np2.log"
  note "isolation-np2-red-exit=$?"
  "$PY" "$HERE/test-isolation.py" --port "$port" --np 2 --wrap > /dev/null 2> "$R/isolation/green-np2.log"
  note "isolation-np2-green-exit=$?"
  grep -E "get_slot_by_id|wrap|selected slot by id" "$R/isolation/server-$port.log" | head -4 > "$R/isolation/wrap-log-lines.txt"
else
  note "isolation-np2 server failed to start"
fi
stop_server "$pid" "$port"
note "isolation-np2-server-stopped"
sleep 15

# --- true overflow cliff pair (docs that really exceed the 4096 slot) ------
for spec in "CLIFF2-B4:--parallel 4:18361" "CLIFF2-A:--parallel 1:18362"; do
  name="${spec%%:*}"; rest="${spec#*:}"; pargs="${rest%%:*}"; port="${rest##*:}"
  note "cliff $name on $port ($pargs)"
  mkdir -p "$R/$name"
  pid=$(start_server "$port" ${=pargs})
  if wait_health "$port"; then
    "$PY" "$HERE/simulate-phones.py" --port "$port" --phones 2 --turns 3 \
      --doc-words 3400 --label "$name" --out "$R/$name/results.json" \
      > "$R/$name/sim.out" 2>&1
    note "cliff-$name-sim-exit=$?"
    grep -E "n_slots = " "$R/isolation/server-$port.log" > "$R/$name/memory.txt" 2>/dev/null
    grep -E "llama_kv_cache: size|sched_reserve:.*compute buffer" "$R/isolation/server-$port.log" >> "$R/$name/memory.txt" 2>/dev/null
  else
    note "cliff-$name server failed to start"
  fi
  stop_server "$pid" "$port"
  note "cliff-$name-server-stopped"
  sleep 15
done

# --- cost of a switch, design A (one slot), sizes ~2k/8k/16k ---------------
port=18351
note "switch-cost design A on $port"
mkdir -p "$R/SWITCH-A"
pid=$(start_server "$port" --parallel 1)
if wait_health "$port"; then
  "$PY" "$HERE/measure-switch-cost.py" --port "$port" \
    --sizes-words 1500,6100,12000 \
    --out "$R/SWITCH-A/results.json" > "$R/SWITCH-A/sim.out" 2>&1
  note "switch-cost-A-exit=$?"
else
  note "switch-cost server failed to start"
fi
stop_server "$pid" "$port"
note "switch-cost-A-server-stopped"
sleep 20

# --- cost of an eviction, design B2: four phones rotate on two 8k slots ----
port=18352
note "switch-cost design B2 (4 phones, ~8k docs) on $port"
mkdir -p "$R/B2-8k"
pid=$(start_server "$port" --parallel 2)
if wait_health "$port"; then
  "$PY" "$HERE/simulate-phones.py" --port "$port" --phones 4 --turns 2 \
    --doc-words 5900 --n-predict 24 --label "B2-8k" --out "$R/B2-8k/results.json" \
    > "$R/B2-8k/sim.out" 2>&1
  note "switch-cost-B2-exit=$?"
else
  note "switch-cost-B2 server failed to start"
fi
stop_server "$pid" "$port"
note "switch-cost-B2-server-stopped"
sleep 20

# --- unified shape at ~16k: the pool itself is the eviction pressure -------
port=18353
note "switch-cost unified (2 phones, ~16k docs) on $port"
mkdir -p "$R/U-16k"
pid=$(start_server "$port")   # no --parallel: auto -> 4 slots, kv_unified
if wait_health "$port"; then
  "$PY" "$HERE/simulate-phones.py" --port "$port" --phones 2 --turns 2 \
    --doc-words 12000 --n-predict 24 --label "U-16k" --out "$R/U-16k/results.json" \
    > "$R/U-16k/sim.out" 2>&1
  note "switch-cost-U-exit=$?"
else
  note "switch-cost-U server failed to start"
fi
stop_server "$pid" "$port"
note "switch-cost-U-server-stopped"

# --- the price of changing model: kill + reload + first token --------------
MS="$R/model-switch"
mkdir -p "$MS"
GEMMA="/Users/marco/Library/Application Support/kalsa-brain/runtime/models/gemma-4-12B-it-Q4_K_M.gguf"

"$PY" "$HERE/measure-model-switch.py" --bin "$BIN" --trinity "$MODEL" --gemma "$GEMMA" \
  --results-dir "$MS" > "$MS/sim.out" 2>&1
note "model-switch-exit=$?"
note "ALL DONE"
exit 0
