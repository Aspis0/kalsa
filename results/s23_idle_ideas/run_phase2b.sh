#!/data/data/com.termux/files/usr/bin/bash
# run_phase2b.sh — S23 ONLY. 2B phase-ceiling + thermal handoff.
# Probe llama-cli/bmoe-cli for -ngl 99 -fa off. No invented GPU numbers.
# Speed/thermal: UNPLUGGED, batt>=45, temp<=45C.
# MemFree < 300 MiB sustained 60s -> BLOCKED_MEM. Do not kill other jobs.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

WS="${WS:-$HOME/gdn_k2/idle_ideas}"
OUTDIR="${OUTDIR:-$WS/phase2b}"
MEM_ABORT_KB="${MEM_ABORT_KB:-300000}"
BATT_FLOOR="${BATT_FLOOR:-45}"
TEMP_CEIL="${TEMP_CEIL:-45}"
THREADS="${THREADS:-6}"
CELL_TIMEOUT="${CELL_TIMEOUT:-360}"
PROBE_TIMEOUT="${PROBE_TIMEOUT:-180}"
LAST_PLUG=""
LAST_PCT=""
LAST_TEMP=""
LAST_MF=""
CLI=""
CLI_KIND=""
MODEL=""
GPU_OK=0
WATCH_PID=""
CELL_PID=""

mkdir -p "$OUTDIR/batt" "$OUTDIR/cells" "$OUTDIR/probe"
MASTER="$OUTDIR/PHASE2B.master.log"
STATUS="$OUTDIR/STATUS.txt"
RAWCSV="$OUTDIR/cells.csv"
SUMCSV="$OUTDIR/summary.csv"
: > "$MASTER"
echo "RUNNING" > "$STATUS"
echo "cell,ngl,kind,n_predict,prompt_bytes,prompt_tok,n_gen,pp_ms,pp_t_s,tg_ms,tg_t_s,ms_per,wall_s,exit,batt_pct,plugged,temp_c,memfree_kb,cli,notes" > "$RAWCSV"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }

fail() {
  local code="$1"; shift
  log "BLOCKED $code $*"
  echo "$code" > "$STATUS"
  stop_watch || true
  if [ -n "${CELL_PID:-}" ] && kill -0 "$CELL_PID" 2>/dev/null; then
    kill "$CELL_PID" 2>/dev/null || true
  fi
  exit 1
}

memfree_kb() { awk '/^MemFree:/{print $2}' /proc/meminfo; }

batt_json() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 5 termux-battery-status 2>/dev/null || echo ''
  else
    termux-battery-status 2>/dev/null || echo ''
  fi
}

batt_fields() {
  python3 -c '
import json, sys
raw = sys.stdin.read().strip()
if not raw:
    print("MISSING 0 0")
    raise SystemExit(0)
try:
    d = json.loads(raw)
except Exception:
    print("BADJSON 0 0")
    raise SystemExit(0)
plug = str(d.get("plugged", "?"))
try:
    pct = int(d.get("percentage", 0))
except Exception:
    pct = 0
try:
    temp = float(d.get("temperature", 0))
except Exception:
    temp = 0.0
print("%s %s %s" % (plug, pct, temp))
'
}

snapshot_batt() {
  local tag="$1"
  local bj plug pct temp mf
  bj=$(batt_json)
  printf '%s\n' "$bj" > "$OUTDIR/batt/${tag}.json"
  read -r plug pct temp <<EOF
$(printf '%s\n' "$bj" | batt_fields)
EOF
  mf=$(memfree_kb)
  echo "$mf" > "$OUTDIR/batt/${tag}.memfree_kb"
  log "batt $tag plugged=$plug batt=$pct temp=$temp MemFree_kB=$mf"
  LAST_PLUG="$plug"
  LAST_PCT="$pct"
  LAST_TEMP="$temp"
  LAST_MF="$mf"
}

guardrail() {
  local tag="$1"
  local nowait="${2:-}"
  local mf2
  snapshot_batt "$tag"
  if [ "$LAST_PLUG" = "MISSING" ] || [ "$LAST_PLUG" = "BADJSON" ]; then
    fail "BLOCKED_BATT" "$tag cannot read termux-battery-status ($LAST_PLUG)"
  fi
  if ! echo "$LAST_PLUG" | grep -qi UNPLUGGED; then
    fail "BLOCKED_PLUGGED" "$tag plugged=$LAST_PLUG"
  fi
  if [ "$LAST_PCT" -lt "$BATT_FLOOR" ] 2>/dev/null; then
    fail "BLOCKED_BATT" "$tag batt=$LAST_PCT < $BATT_FLOOR"
  fi
  if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > float(sys.argv[2]) else 1)" "$LAST_TEMP" "$TEMP_CEIL"; then
    fail "BLOCKED_THERMAL" "$tag temp=$LAST_TEMP > $TEMP_CEIL"
  fi
  if [ "$LAST_MF" -lt "$MEM_ABORT_KB" ] 2>/dev/null; then
    if [ "$nowait" = "nowait" ]; then
      fail "BLOCKED_MEM" "$tag MemFree_kB=$LAST_MF < $MEM_ABORT_KB"
    fi
    sleep 2
    mf2=$(memfree_kb)
    log "guard $tag MemFree_kB pair $LAST_MF $mf2"
    if [ "$mf2" -lt "$MEM_ABORT_KB" ] 2>/dev/null; then
      fail "BLOCKED_MEM" "$tag MemFree_kB=$LAST_MF then $mf2 < $MEM_ABORT_KB"
    fi
    LAST_MF="$mf2"
  fi
}

stop_watch() {
  rm -f "$OUTDIR/WATCH.alive"
  if [ -n "${WATCH_PID:-}" ] && kill -0 "$WATCH_PID" 2>/dev/null; then
    kill "$WATCH_PID" 2>/dev/null || true
    wait "$WATCH_PID" 2>/dev/null || true
  fi
  WATCH_PID=""
}

start_watch() {
  stop_watch || true
  : > "$OUTDIR/WATCH.alive"
  : > "$OUTDIR/watchdog.csv"
  echo "ts,plugged,batt,temp,memfree_kb,event" > "$OUTDIR/watchdog.csv"
  (
    bad_mem=0
    while [ -f "$OUTDIR/WATCH.alive" ]; do
      bj=$(batt_json)
      read -r plug pct temp <<EOF
$(printf '%s\n' "$bj" | batt_fields)
EOF
      mf=$(memfree_kb)
      ev="ok"
      if [ "$plug" = "MISSING" ] || [ "$plug" = "BADJSON" ]; then
        ev="batt_unreadable"
      elif ! echo "$plug" | grep -qi UNPLUGGED; then
        ev="plugged"
        echo "BLOCKED_PLUGGED" > "$STATUS"
        echo "$(ts),$plug,$pct,$temp,$mf,$ev" >> "$OUTDIR/watchdog.csv"
        if [ -f "$OUTDIR/cell.pid" ]; then kill "$(cat "$OUTDIR/cell.pid")" 2>/dev/null || true; fi
        rm -f "$OUTDIR/WATCH.alive"
        exit 0
      elif [ "$pct" -lt "$BATT_FLOOR" ] 2>/dev/null; then
        ev="batt_low"
        echo "BLOCKED_BATT" > "$STATUS"
        echo "$(ts),$plug,$pct,$temp,$mf,$ev" >> "$OUTDIR/watchdog.csv"
        if [ -f "$OUTDIR/cell.pid" ]; then kill "$(cat "$OUTDIR/cell.pid")" 2>/dev/null || true; fi
        rm -f "$OUTDIR/WATCH.alive"
        exit 0
      elif python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > float(sys.argv[2]) else 1)" "$temp" "$TEMP_CEIL"; then
        ev="thermal"
        echo "BLOCKED_THERMAL" > "$STATUS"
        echo "$(ts),$plug,$pct,$temp,$mf,$ev" >> "$OUTDIR/watchdog.csv"
        if [ -f "$OUTDIR/cell.pid" ]; then kill "$(cat "$OUTDIR/cell.pid")" 2>/dev/null || true; fi
        rm -f "$OUTDIR/WATCH.alive"
        exit 0
      fi
      if [ "$mf" -lt "$MEM_ABORT_KB" ] 2>/dev/null; then
        bad_mem=$((bad_mem + 1))
        ev="mem_low_$bad_mem"
        if [ "$bad_mem" -ge 4 ]; then
          ev="mem_sustained"
          echo "BLOCKED_MEM" > "$STATUS"
          echo "$(ts),$plug,$pct,$temp,$mf,$ev" >> "$OUTDIR/watchdog.csv"
          if [ -f "$OUTDIR/cell.pid" ]; then kill "$(cat "$OUTDIR/cell.pid")" 2>/dev/null || true; fi
          rm -f "$OUTDIR/WATCH.alive"
          exit 0
        fi
      else
        bad_mem=0
      fi
      echo "$(ts),$plug,$pct,$temp,$mf,$ev" >> "$OUTDIR/watchdog.csv"
      sleep 15
    done
  ) >> "$OUTDIR/watchdog.log" 2>&1 &
  WATCH_PID=$!
  echo "$WATCH_PID" > "$OUTDIR/watchdog.pid"
  log "watchdog pid=$WATCH_PID"
}

parse_timings() {
  python3 - "$1" <<'PY'
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
pe_ms = pe_n = ev_ms = ev_n = ""

def grab(pat, flags=0):
    return re.search(pat, text, flags)

# llama-cli slot print_timing / llama_perf
for m in re.finditer(
    r"prompt eval time\s*=\s*([0-9.]+)\s*ms\s*/\s*(\d+)\s*tokens",
    text, re.I,
):
    pe_ms, pe_n = m.group(1), m.group(2)
for m in re.finditer(
    r"(?<![A-Za-z])eval time\s*=\s*([0-9.]+)\s*ms\s*/\s*(\d+)\s*tokens",
    text, re.I,
):
    ev_ms, ev_n = m.group(1), m.group(2)

# bmoe-cli
if not pe_ms:
    m = re.search(r"prefill:\s*(\d+)\s*tokens,\s*([0-9.]+)\s*s", text)
    if m:
        pe_n = m.group(1)
        pe_ms = f"{float(m.group(2)) * 1000.0:.3f}"
if not ev_ms:
    m = re.search(r"generation:\s*(\d+)\s*tokens,\s*([0-9.]+)\s*s/token", text)
    if m:
        ev_n = m.group(1)
        ev_ms = f"{float(m.group(1)) * float(m.group(2)) * 1000.0:.3f}"

# UI banner fallback: t/s only — leave ms empty so we do not invent token counts
ui_pp = ui_tg = ""
m = re.search(r"Prompt:\s*([0-9.]+)\s*t/s", text)
if m:
    ui_pp = m.group(1)
m = re.search(r"Generation:\s*([0-9.]+)\s*t/s", text)
if m:
    ui_tg = m.group(1)

print(pe_ms)
print(pe_n)
print(ev_ms)
print(ev_n)
print(ui_pp)
print(ui_tg)
PY
}

opencl_in_log() {
  local f="$1"
  grep -Eiq 'ggml_opencl|OpenCL|Adreno|offloaded [1-9][0-9]*|GPUOpenCL|n_gpu_layers=[1-9]' "$f"
}

crash_in_log() {
  local f="$1"
  grep -Eiq 'GGML_ASSERT|segmentation fault|SIGSEGV|cannot open shared object|failed to initialize|clGetPlatformIDs|no OpenCL|OpenCL error|Aborted \(core' "$f"
}

resolve_model() {
  local p
  for p in \
    "$HOME/gdn_k2/models/Qwen3.5-2B-Q4_K_M.gguf" \
    "$HOME/models/Qwen3.5-2B-Q4_K_M.gguf" \
    "$HOME/gdn_k2/Qwen3.5-2B-Q4_K_M.gguf"
  do
    if [ -f "$p" ]; then
      printf %s "$p"
      return 0
    fi
  done
  return 1
}

# $1 path  $2 kind=llama|bmoe
probe_one() {
  local bin="$1" kind="$2"
  local pdir="$OUTDIR/probe/$(basename "$(dirname "$bin")")_$(basename "$bin")"
  mkdir -p "$pdir"
  local clidir rc
  clidir="$(dirname "$bin")"
  export LD_LIBRARY_PATH="${clidir}:/vendor/lib64"
  {
    echo "date=$(ts)"
    echo "bin=$bin"
    echo "kind=$kind"
    echo "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"
    echo "MODEL=$MODEL"
    sha256sum "$bin" || true
    ls -l "$bin"
  } > "$pdir/meta.txt"
  log "PROBE $kind $bin"

  local -a cmd
  if [ "$kind" = "bmoe" ]; then
    cmd=("$bin" -m "$MODEL" -p "The capital of France is" -n 1 --ngl 99 --flash-attn off -t "$THREADS" -c 512)
  else
    cmd=("$bin" -m "$MODEL" -c 512 --temp 0 -s 42 -n 1 -no-cnv -st -ngl 99 -fa off -t "$THREADS" --simple-io --no-warmup --ignore-eos --perf -lv 3 -p "The capital of France is")
  fi
  printf 'cmd=' > "$pdir/cmd.txt"
  printf '%q ' "${cmd[@]}" >> "$pdir/cmd.txt"
  echo >> "$pdir/cmd.txt"

  set +e
  if command -v timeout >/dev/null 2>&1; then
    timeout "$PROBE_TIMEOUT" env LD_LIBRARY_PATH="$LD_LIBRARY_PATH" "${cmd[@]}" > "$pdir/stdout.txt" 2> "$pdir/stderr.txt"
    rc=$?
  else
    env LD_LIBRARY_PATH="$LD_LIBRARY_PATH" "${cmd[@]}" > "$pdir/stdout.txt" 2> "$pdir/stderr.txt"
    rc=$?
  fi
  set -e
  echo "exit=$rc" >> "$pdir/cmd.txt"
  cat "$pdir/stdout.txt" "$pdir/stderr.txt" > "$pdir/combo.txt" 2>/dev/null || true
  log "PROBE rc=$rc bin=$bin"
  if [ "$rc" -ne 0 ]; then
    log "PROBE fail rc=$rc"
    return 1
  fi
  if crash_in_log "$pdir/combo.txt"; then
    log "PROBE crash signature in log"
    return 1
  fi
  if opencl_in_log "$pdir/combo.txt"; then
    log "PROBE OpenCL/offload evidence present"
  else
    log "PROBE WARN no OpenCL string in log; accepting exit 0 + no crash (do not invent GPU t/s if later cells look CPU-like)"
  fi
  CLI="$bin"
  CLI_KIND="$kind"
  GPU_OK=1
  echo "$bin" > "$OUTDIR/cli.path"
  echo "$kind" > "$OUTDIR/cli.kind"
  sha256sum "$bin" | awk '{print $1}' > "$OUTDIR/cli.sha256"
  log "PROBE_OK cli=$bin kind=$kind sha=$(cat "$OUTDIR/cli.sha256")"
  return 0
}

find_working_gpu_cli() {
  local p
  # k22b binary lives in bin_fix2 (k22b/ dir has logs only).
  for p in \
    "$HOME/gdn_k2/bin_fix2/llama-cli" \
    "$HOME/gdn_k2/k22b/llama-cli" \
    "$HOME/gdn_k2/bin_cpufix/llama-cli" \
    "$HOME/gdn_k2/bin/llama-cli" \
    "$HOME/gdn_k2/bin_fix/llama-cli"
  do
    if [ -e "$p" ]; then
      if probe_one "$p" llama; then
        return 0
      fi
    else
      log "PROBE skip missing $p"
    fi
  done
  if [ -e "$HOME/gdn_k2/k4split/bin/bmoe-cli" ]; then
    if probe_one "$HOME/gdn_k2/k4split/bin/bmoe-cli" bmoe; then
      return 0
    fi
  else
    log "PROBE skip missing $HOME/gdn_k2/k4split/bin/bmoe-cli"
  fi
  return 1
}

# $1 cell  $2 ngl  $3 n_predict  $4 prompt_file  $5 notes
run_cell() {
  local cell="$1" ngl="$2" npred="$3" pfile="$4" notes="${5:-}"
  local cdir="$OUTDIR/cells/$cell"
  mkdir -p "$cdir"
  local pbytes wall0 wall1 wall rc
  local pe_ms pe_n ev_ms ev_n ui_pp ui_tg
  local pp_s tg_s ms_per
  pbytes=$(wc -c < "$pfile" | tr -d ' ')

  local clidir
  clidir="$(dirname "$CLI")"
  export LD_LIBRARY_PATH="${clidir}:/vendor/lib64"

  local -a cmd
  if [ "$CLI_KIND" = "bmoe" ]; then
    cmd=("$CLI" -m "$MODEL" -p "$(cat "$pfile")" -n "$npred" --ngl "$ngl" -t "$THREADS" -c 2048 --temp 0 --seed 42)
    if [ "$ngl" != "0" ]; then
      cmd+=(--flash-attn off)
    fi
  else
    cmd=("$CLI" -m "$MODEL" -c 2048 --temp 0 -s 42 -n "$npred" -no-cnv -st -ngl "$ngl" -t "$THREADS" --simple-io --no-warmup --ignore-eos --perf -lv 3 -f "$pfile")
    if [ "$ngl" != "0" ]; then
      cmd+=(-fa off)
    fi
  fi

  {
    echo "date=$(ts)"
    echo "cell=$cell"
    echo "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"
    echo "MODEL=$MODEL"
    echo "CLI=$CLI"
    echo "kind=$CLI_KIND"
    printf 'cmd='
    printf '%q ' "${cmd[@]}"
    echo
    echo "prompt_file=$pfile"
    echo "notes=$notes"
  } > "$cdir/cmd.txt"
  log "RUN $cell ngl=$ngl n=$npred prompt_bytes=$pbytes"

  wall0=$(python3 -c 'import time; print("%.3f" % time.time())')
  set +e
  if command -v timeout >/dev/null 2>&1; then
    timeout "$CELL_TIMEOUT" env LD_LIBRARY_PATH="$LD_LIBRARY_PATH" "${cmd[@]}" > "$cdir/stdout.txt" 2> "$cdir/stderr.txt" &
  else
    env LD_LIBRARY_PATH="$LD_LIBRARY_PATH" "${cmd[@]}" > "$cdir/stdout.txt" 2> "$cdir/stderr.txt" &
  fi
  CELL_PID=$!
  echo "$CELL_PID" > "$OUTDIR/cell.pid"
  wait "$CELL_PID"
  rc=$?
  set -e
  rm -f "$OUTDIR/cell.pid"
  CELL_PID=""
  wall1=$(python3 -c 'import time; print("%.3f" % time.time())')
  wall=$(python3 -c "print('%.3f' % (float('$wall1')-float('$wall0')))")
  cat "$cdir/stdout.txt" "$cdir/stderr.txt" > "$cdir/combo.txt" 2>/dev/null || true
  echo "exit=$rc wall_s=$wall" >> "$cdir/cmd.txt"

  if [ -f "$STATUS" ] && grep -q '^BLOCKED_' "$STATUS"; then
    log "watchdog fired during $cell status=$(cat "$STATUS")"
    fail "$(cat "$STATUS")" "watchdog during $cell"
  fi

  pe_ms=""; pe_n=""; ev_ms=""; ev_n=""; ui_pp=""; ui_tg=""
  if [ -f "$cdir/combo.txt" ]; then
    {
      read -r pe_ms
      read -r pe_n
      read -r ev_ms
      read -r ev_n
      read -r ui_pp
      read -r ui_tg
    } <<EOF
$(parse_timings "$cdir/combo.txt")
EOF
  fi

  pp_s=""; tg_s=""; ms_per=""
  if [ -n "$pe_ms" ]; then
    pp_s=$(python3 -c "print('%.6f' % (float('$pe_ms')/1000.0))")
  fi
  if [ -n "$ev_ms" ]; then
    tg_s=$(python3 -c "print('%.6f' % (float('$ev_ms')/1000.0))")
  fi
  if [ -n "$ev_ms" ] && [ -n "$ev_n" ] && [ "$ev_n" != "0" ]; then
    ms_per=$(python3 -c "print('%.3f' % (float('$ev_ms')/float('$ev_n')))")
  fi

  snapshot_batt "post_$cell"
  {
    echo "pe_ms=$pe_ms pe_n=$pe_n ev_ms=$ev_ms ev_n=$ev_n"
    echo "ui_pp=$ui_pp ui_tg=$ui_tg"
    echo "pp_t_s=$pp_s tg_t_s=$tg_s ms_per=$ms_per"
  } >> "$cdir/cmd.txt"
  log "DONE $cell rc=$rc wall_s=$wall pe_ms=$pe_ms n=$pe_n ev_ms=$ev_ms n=$ev_n ui_pp=$ui_pp ui_tg=$ui_tg"

  echo "$cell,$ngl,$CLI_KIND,$npred,$pbytes,$pe_n,$ev_n,$pe_ms,$pp_s,$ev_ms,$tg_s,$ms_per,$wall,$rc,$LAST_PCT,$LAST_PLUG,$LAST_TEMP,$LAST_MF,$CLI,$notes" >> "$RAWCSV"
  printf '%s\n' "$pe_n" > "$cdir/prompt_tok"
  printf '%s\n' "$ev_n" > "$cdir/n_gen"
  printf '%s\n' "$pp_s" > "$cdir/pp_t_s"
  printf '%s\n' "$tg_s" > "$cdir/tg_t_s"
  printf '%s\n' "$ms_per" > "$cdir/ms_per"
  printf '%s\n' "$rc" > "$cdir/exit"
  return 0
}

write_summary() {
  python3 - "$OUTDIR" <<'PY'
import csv
from pathlib import Path
out = Path(__file__) if False else None
root = Path(__import__("sys").argv[1])
rawp = root / "cells.csv"
sump = root / "summary.csv"
rows = []
if rawp.exists():
    with rawp.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
by = {r["cell"]: r for r in rows}

def fnum(x):
    try:
        if x is None or x == "":
            return None
        return float(x)
    except Exception:
        return None

def write_rows(items):
    fields = ["cell", "ngl", "prompt_tok", "n_gen", "pp_t_s", "tg_t_s", "ms_per", "batt", "temp", "notes"]
    with sump.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for it in items:
            w.writerow({k: it.get(k, "") for k in fields})

items = []
for name in ("CPU_512_128", "GPU_512_128", "HANDOFF_GPU_PP", "HANDOFF_CPU_TG"):
    r = by.get(name)
    if not r:
        continue
    items.append({
        "cell": name,
        "ngl": r.get("ngl", ""),
        "prompt_tok": r.get("prompt_tok", ""),
        "n_gen": r.get("n_gen", ""),
        "pp_t_s": r.get("pp_t_s", ""),
        "tg_t_s": r.get("tg_t_s", ""),
        "ms_per": r.get("ms_per", ""),
        "batt": r.get("batt_pct", ""),
        "temp": r.get("temp_c", ""),
        "notes": r.get("notes", ""),
    })

cpu = by.get("CPU_512_128")
gpu = by.get("GPU_512_128")
hgpu = by.get("HANDOFF_GPU_PP")
hcpu = by.get("HANDOFF_CPU_TG")

def model_row(label, ngl, src_pp, src_tg, notes):
    pp = fnum(src_pp.get("pp_t_s") if src_pp else None)
    tg = fnum(src_tg.get("tg_t_s") if src_tg else None)
    ptok = ""
    ngen = ""
    batt = ""
    temp = ""
    if src_pp:
        ptok = src_pp.get("prompt_tok", "")
        batt = src_pp.get("batt_pct", "")
        temp = src_pp.get("temp_c", "")
    if src_tg:
        ngen = src_tg.get("n_gen", "")
        if not batt:
            batt = src_tg.get("batt_pct", "")
        if not temp:
            temp = src_tg.get("temp_c", "")
    user = None
    if pp is not None and tg is not None:
        user = pp + tg
    ms_per = ""
    if user is not None and fnum(ngen):
        ms_per = f"{(user * 1000.0) / float(ngen):.3f}"
    items.append({
        "cell": label,
        "ngl": ngl,
        "prompt_tok": ptok,
        "n_gen": ngen,
        "pp_t_s": f"{pp:.6f}" if pp is not None else "",
        "tg_t_s": f"{tg:.6f}" if tg is not None else "",
        "ms_per": ms_per,
        "batt": batt,
        "temp": temp,
        "notes": notes + (f"; user_turn_s={user:.6f}" if user is not None else "; user_turn_s=NA missing timing"),
    })

if cpu and cpu.get("pp_t_s") and cpu.get("tg_t_s"):
    model_row(
        "MODEL_CPU",
        "0",
        cpu,
        cpu,
        "user_turn_s ~= t_pp + t_tg; single-process 512-pp + 128-tg CPU-only",
    )
if gpu and gpu.get("pp_t_s") and gpu.get("tg_t_s"):
    model_row(
        "MODEL_GPU",
        "99",
        gpu,
        gpu,
        "user_turn_s ~= t_pp + t_tg; single-process 512-pp + 128-tg GPU-only -fa off",
    )
if gpu and cpu and gpu.get("pp_t_s") and cpu.get("tg_t_s"):
    model_row(
        "MODEL_GPU_PP_CPU_TG",
        "99/0",
        gpu,
        cpu,
        "user_turn_s ~= t_pp(GPU) + t_tg(CPU); composed ceiling; Handoff does NOT share KV",
    )

if hgpu and hcpu:
    w1 = fnum(hgpu.get("wall_s"))
    w2 = fnum(hcpu.get("wall_s"))
    pair = None
    if w1 is not None and w2 is not None:
        pair = w1 + w2
    items.append({
        "cell": "HANDOFF_PAIR",
        "ngl": "99 then 0",
        "prompt_tok": hgpu.get("prompt_tok", ""),
        "n_gen": hcpu.get("n_gen", ""),
        "pp_t_s": hgpu.get("pp_t_s", ""),
        "tg_t_s": hcpu.get("tg_t_s", ""),
        "ms_per": "",
        "batt": hcpu.get("batt_pct", ""),
        "temp": hcpu.get("temp_c", ""),
        "notes": (
            "thermal handoff actual sequential walls; Handoff does NOT share KV; "
            "CPU leg re-prefills; wall_sum=%s"
            % (f"{pair:.3f}" if pair is not None else "NA")
        ),
    })

write_rows(items)
print(str(sump))
PY
}

# ---- preflight ----
if ! command -v python3 >/dev/null 2>&1; then
  fail "BLOCKED_PY" "python3 required"
fi
if ! command -v termux-battery-status >/dev/null 2>&1; then
  fail "BLOCKED_BATT" "termux-battery-status not on PATH"
fi

TA_STATUS="$WS/typeahead/STATUS.txt"
if [ ! -f "$TA_STATUS" ] || ! grep -qx 'TYPEAHEAD_DONE' "$TA_STATUS"; then
  fail "BLOCKED_TYPEAHEAD" "typeahead not finished ($(cat "$TA_STATUS" 2>/dev/null || echo missing))"
fi

# Refuse if another infer is live. Do not kill it.
if pgrep -x llama-cli >/dev/null 2>&1 || pgrep -x bmoe-cli >/dev/null 2>&1; then
  pgrep -af 'llama-cli|bmoe-cli' | tee -a "$MASTER" || true
  fail "BLOCKED_BUSY" "infer already running; will not start a second one"
fi

MODEL="$(resolve_model)" || fail "BLOCKED_MODEL" "no Qwen3.5-2B-Q4_K_M.gguf"
log "MODEL=$MODEL size=$(stat -c%s "$MODEL" 2>/dev/null || echo '?')"
sha256sum "$MODEL" | tee "$OUTDIR/model.sha256" | tee -a "$MASTER"

# ~512-token prompt: repeat a baked English paragraph.
PP_PARA=$(cat <<'EOF'
A transformer prefill reads the whole prompt, builds attention over every token, and produces the first output token. This repeated English paragraph is used to build a prompt of about five hundred twelve tokens for the CPU and GPU prefill cells on Qwen three point five two B. Flash attention stays off. Thread count is six. OpenCL should take the matrix multiplies when ngl is ninety nine.
EOF
)
PP_PROMPT=""
i=0
while [ "$i" -lt 6 ]; do
  PP_PROMPT="${PP_PROMPT}${PP_PARA} "
  i=$((i + 1))
done
printf %s "$PP_PROMPT" > "$OUTDIR/prompt_pp.txt"
{
  echo "pp_bytes=$(wc -c < "$OUTDIR/prompt_pp.txt" | tr -d ' ') repeats=6"
  sha256sum "$OUTDIR/prompt_pp.txt"
} | tee -a "$MASTER"

guardrail "preflight"
start_watch

log "=== GPU probe: find a cli that runs -ngl 99 -fa off on 2B ==="
if find_working_gpu_cli; then
  log "using GPU-capable CLI=$CLI kind=$CLI_KIND"
else
  log "no OpenCL-capable cli accepted"
  stop_watch || true
  # CPU-only ceiling still useful; do not invent GPU numbers.
  if [ -e "$HOME/gdn_k2/bin_fix2/llama-cli" ]; then
    CLI="$HOME/gdn_k2/bin_fix2/llama-cli"
    CLI_KIND="llama"
  elif [ -e "$HOME/gdn_k2/bin/llama-cli" ]; then
    CLI="$HOME/gdn_k2/bin/llama-cli"
    CLI_KIND="llama"
  else
    write_summary || true
    fail "BLOCKED_OPENCL" "OpenCL probe failed and no CPU llama-cli fallback"
  fi
  GPU_OK=0
  echo "$CLI" > "$OUTDIR/cli.path"
  echo "$CLI_KIND" > "$OUTDIR/cli.kind"
  sha256sum "$CLI" | awk '{print $1}' > "$OUTDIR/cli.sha256"
  log "CPU fallback CLI=$CLI (GPU probe failed)"
fi

log "CLI=$CLI kind=$CLI_KIND sha=$(cat "$OUTDIR/cli.sha256") GPU_OK=$GPU_OK threads=$THREADS"

sleep 3
guardrail "pre_CPU_512_128"
run_cell CPU_512_128 0 128 "$OUTDIR/prompt_pp.txt" "single-process CPU 512-pp + 128-tg"

if [ "$GPU_OK" -eq 1 ]; then
  log "cooldown 15s before GPU cell"
  sleep 15
  guardrail "pre_GPU_512_128"
  run_cell GPU_512_128 99 128 "$OUTDIR/prompt_pp.txt" "single-process GPU 512-pp + 128-tg; -fa off"

  sleep 3
  guardrail "pre_HANDOFF"
  log "HANDOFF start: GPU_PP then CPU_TG immediately; KV is NOT shared"
  run_cell HANDOFF_GPU_PP 99 1 "$OUTDIR/prompt_pp.txt" "handoff GPU prefill n=1; KV NOT shared with next cell"
  run_cell HANDOFF_CPU_TG 0 128 "$OUTDIR/prompt_pp.txt" "handoff CPU 512-pp + 128-tg after GPU; KV NOT shared; re-prefill paid"
  snapshot_batt "post_HANDOFF"
else
  log "skip GPU/handoff cells: OpenCL probe failed"
fi

stop_watch || true
snapshot_batt "final"
write_summary

if [ "$GPU_OK" -ne 1 ]; then
  fail "BLOCKED_OPENCL" "CPU cells written; GPU/handoff not measured. see probe/ logs"
fi

# Require timings on the three MODEL inputs.
if [ ! -s "$OUTDIR/cells/CPU_512_128/pp_t_s" ] || [ ! -s "$OUTDIR/cells/CPU_512_128/tg_t_s" ]; then
  fail "BLOCKED_PARSE" "CPU_512_128 missing t_pp/t_tg"
fi
if [ ! -s "$OUTDIR/cells/GPU_512_128/pp_t_s" ] || [ ! -s "$OUTDIR/cells/GPU_512_128/tg_t_s" ]; then
  fail "BLOCKED_PARSE" "GPU_512_128 missing t_pp/t_tg"
fi

echo "PHASE2B_DONE" > "$STATUS"
log "PHASE2B_DONE summary=$SUMCSV"
exit 0
