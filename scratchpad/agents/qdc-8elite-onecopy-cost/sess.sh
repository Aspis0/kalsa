#!/system/bin/sh
# On-device runner for qdc-8elite-onecopy-cost (PREREG). Usage: sh sess.sh <deadline_epoch>
# Order: names/NKV/dispatch proofs -> KLD (base, a-flat control, P5) -> round 1
#   (prefill a-hmx a-flat b c, decode d-cpu d-cpu-nr d-host) -> round 2 (reverse order).
# Markers go to out/markers.txt; every parse happens on the host (analyze.py).
D=${OC_D:-/data/local/tmp/oc8}
O=$D/out
M=$O/markers.txt
DEADLINE="$1"
cd "$D" || exit 2
export ADSP_LIBRARY_PATH=$D/dsp
export GGML_HEXAGON_NDEV=1
[ -n "$OC_LD" ] && export LD_LIBRARY_PATH=$OC_LD

mark() { echo "$* $(date +%s)" >> "$M"; }

hal_dump() { dumpsys thermalservice 2>/dev/null; }
skin_of() { echo "$1" | sed -n '/Current temperatures from HAL/,/Current cooling devices from HAL/p' | grep -Eo 'mValue=[0-9.]*, mType=3, mName=[sS][kK][iI][nN]' | head -1 | sed 's/mValue=//;s/,.*//'; }
status_of() { echo "$1" | grep -m1 'Thermal Status:' | sed 's/.*Thermal Status: *//'; }

# Hundredths of a degree, pure sh: "35.97" -> 3597; empty -> 9900.
hund() {
  ip=${1%%.*}; fp=${1#*.}; [ "$fp" = "$1" ] && fp=""
  fp="${fp}00"; fp=${fp%"${fp#??}"}
  echo $(( ${ip:-99} * 100 + 1${fp} - 100 ))
}

# Soft gate: wait for skin <= 37.0 C and status 0, at most CAP s; then run anyway.
# Prints "ok|warm <skin> <status> <waited_s>". Speed, not heat, is the subject here.
CAP=${OC_CAP:-60}
cooldown() {
  t0=$(date +%s)
  while :; do
    d=$(hal_dump); s=$(skin_of "$d"); st=$(status_of "$d")
    if [ -n "$s" ] && [ "$(hund "$s")" -le 3700 ] && [ "${st:-9}" = 0 ]; then echo "ok $s $st $(( $(date +%s) - t0 ))"; return; fi
    if [ $(( $(date +%s) - t0 )) -ge "$CAP" ]; then echo "warm ${s:-na} ${st:-na} $(( $(date +%s) - t0 ))"; return; fi
    sleep 5
  done
}

status_stop() { st=$(status_of "$(hal_dump)"); [ "${st:-0}" -ge 3 ] 2>/dev/null; }
killed_since() { awk -v t="$1" '$1=="K" && $2>=t {f=1} END{exit !f}' "$O/samples.txt"; }
time_left() { [ $(( $(date +%s) + $1 )) -le "$DEADLINE" ]; }

# runm <tag> <limit_s> <cmd...>: stdout -> out/<tag>.out, stderr -> out/<tag>.err.
# Polls the child pid once a second: VmHWM (peak RSS) to <tag>.rss, smaps_rollup
# (last sample) to <tag>.smaps. No `timeout` wrapper, so $! is the real pid.
# Sets RC. Kills the child after <limit_s>.
runm() {
  tag="$1"; lim="$2"; shift 2
  "$@" > "$O/$tag.out" 2> "$O/$tag.err" < /dev/null &
  pid=$!
  t0=$(date +%s)
  while kill -0 "$pid" 2> /dev/null; do
    grep -E 'VmHWM|VmRSS' "/proc/$pid/status" > "$O/$tag.rss.tmp" 2> /dev/null && mv "$O/$tag.rss.tmp" "$O/$tag.rss"
    cat "/proc/$pid/smaps_rollup" > "$O/$tag.smaps.tmp" 2> /dev/null && mv "$O/$tag.smaps.tmp" "$O/$tag.smaps"
    [ $(( $(date +%s) - t0 )) -gt "$lim" ] && { kill -9 "$pid"; echo "LIMIT_KILL" >> "$O/$tag.err"; }
    sleep 1
  done
  wait "$pid"; RC=$?
  echo "EXIT=$RC" >> "$O/$tag.err"
}

STOPPED=0
echo oc8 > /sys/power/wake_lock 2> /dev/null && mark "H wake_lock ok" || mark "H wake_lock fail"
rm -f "$O/smp.stop"
sh "$D/smp.sh" > "$O/smp.out" 2>&1 &
sleep 3
mark "H session_start deadline=$DEADLINE"

# ---- names: the buffer-type names the -ot regex must target ----
./bin/llama-bench -m "$D/ship.gguf" -p 1 -n 0 -r 1 -ngl 99 -dev HTP0 -ot 'zzz=NOSUCH' -o md > "$O/probe-names.out" 2>&1 < /dev/null
HTPB=$(awk '/^  HTP/ && !/HOST/ {print $1; exit}' "$O/probe-names.out")
HOSTB=$(awk '/^  HTP/ && /HOST/ {print $1; exit}' "$O/probe-names.out")
mark "H names htp=${HTPB:-NONE} host=${HOSTB:-NONE}"
OT_ALL=".*=$HOSTB"
# P5 placement: norms + shortconv.conv in the normal HTP buffer, everything else -HOST.
OT_P5B="(blk\.[0-9]+\.(attn_norm|ffn_norm|attn_q_norm|attn_k_norm|shortconv\.conv)|token_embd_norm)\.weight=$HTPB;.*=$HOSTB"
OT_P5P="(blk\.[0-9]+\.(attn_norm|ffn_norm|attn_q_norm|attn_k_norm|shortconv\.conv)|token_embd_norm)\.weight=$HTPB,.*=$HOSTB"

ENV_FLAT="GGML_HEXAGON_MM_SELECT=1 GGML_HEXAGON_OPFUSION=0"
ENV_ONE="GGML_HEXAGON_MM_SELECT=1 GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_HOSTBUF=1 GGML_OP_OFFLOAD_MIN_BATCH=32"
BF="-m $D/ship.gguf -lm none -fa 1 -t 6 -o jsonl -v"

# ---- NKV: does the HTP normal-buffer arm load with the KV cache on the device? ----
NKV=""
mark "PROOF_START nkv"
runm proof-nkv 200 env GGML_HEXAGON_VERBOSE=1 ./bin/llama-bench $BF -p 128 -n 0 -r 1 -b 2048 -ub 1024 -dev HTP0 -ngl 99 --no-warmup
mark "PROOF_END nkv rc=$RC"
if [ "$RC" != 0 ]; then
  NKV="-nkvo 1"
  mark "H nkv_fallback"
  runm proof-nkv2 200 env GGML_HEXAGON_VERBOSE=1 ./bin/llama-bench $BF -p 128 -n 0 -r 1 -b 2048 -ub 1024 -dev HTP0 -ngl 99 $NKV --no-warmup
  mark "PROOF_END nkv2 rc=$RC"
fi
# Dispatch proofs for the flat control and the one-copy arm (host/raw reads).
mark "PROOF_START flat"
runm proof-flat 200 env GGML_HEXAGON_VERBOSE=1 $ENV_FLAT ./bin/llama-bench $BF -p 128 -n 0 -r 1 -b 2048 -ub 1024 -dev HTP0 -ngl 99 $NKV --no-warmup
mark "PROOF_END flat rc=$RC"
if [ -n "$HOSTB" ]; then
  mark "PROOF_START one"
  runm proof-one 200 env GGML_HEXAGON_VERBOSE=1 $ENV_ONE ./bin/llama-bench $BF -p 128 -n 0 -r 1 -b 2048 -ub 1024 -dev HTP0 -ngl 99 $NKV -ot "$OT_P5B" --no-warmup
  mark "PROOF_END one rc=$RC"
fi

# ---- KLD sanity: CPU base on this device, a-flat control, P5 one-copy ----
PPL="-m $D/ship.gguf -f $D/fixture.txt -c 512 -b 512 -ub 128 -lm none --chunks 2"
mark "K_START k0-base"
runm k0-base 400 env GGML_HEXAGON_HOSTBUF=0 ./bin/llama-perplexity $PPL -ngl 0 -dev none --kl-divergence-base "$D/base.logits"
mark "K_END k0-base rc=$RC"
mark "K_START k2-flat"
runm k2-flat 600 env GGML_HEXAGON_VERBOSE=1 $ENV_FLAT ./bin/llama-perplexity $PPL -ngl 99 -dev HTP0 --no-warmup -lv 5 --kl-divergence-base "$D/base.logits" --kl-divergence
mark "K_END k2-flat rc=$RC"
if [ -n "$HOSTB" ]; then
  mark "K_START k1-p5"
  runm k1-p5 600 env GGML_HEXAGON_VERBOSE=1 $ENV_ONE ./bin/llama-perplexity $PPL -ngl 99 -dev HTP0 -ot "$OT_P5P" --no-warmup -lv 5 --kl-divergence-base "$D/base.logits" --kl-divergence
  mark "K_END k1-p5 rc=$RC"
fi

# ---- timing arms ----
# unit <tag> <limit_s> <cmd...>: deadline + gate + run + watchdog/status checks.
unit() {
  tag="$1"; lim="$2"; shift 2
  if [ "$STOPPED" = 1 ]; then mark "V $tag stop"; return; fi
  if ! time_left "$lim"; then mark "V $tag deadline"; return; fi
  c=$(cooldown); mark "C $tag $c"
  t0=$(date +%s)
  mark "U_START $tag"
  runm "$tag" "$lim" "$@"
  mark "U_END $tag rc=$RC"
  if killed_since "$t0"; then mark "V $tag watchdog"; fi
  if status_stop; then mark "H status_stop after=$tag"; STOPPED=1; fi
}

prefill() { # <round> <arm>
  tag="P$1-$2"
  case "$2" in
    a-hmx)  unit "$tag" 240 ./bin/llama-bench $BF -p 512,2048 -n 0 -r 3 -b 2048 -ub 1024 -dev HTP0 -ngl 99 $NKV ;;
    a-flat) unit "$tag" 240 env $ENV_FLAT ./bin/llama-bench $BF -p 512,2048 -n 0 -r 3 -b 2048 -ub 1024 -dev HTP0 -ngl 99 $NKV ;;
    b)      [ -n "$HOSTB" ] && unit "$tag" 300 env $ENV_ONE ./bin/llama-bench $BF -p 512,2048 -n 0 -r 3 -b 2048 -ub 1024 -dev HTP0 -ngl 99 $NKV -ot "$OT_P5B" ;;
    c)      unit "$tag" 240 ./bin/llama-bench $BF -p 512,2048 -n 0 -r 3 -b 2048 -ub 1024 -dev none -ngl 0 ;;
  esac
}
decode() { # <round> <arm>
  tag="D$1-$2"
  case "$2" in
    d-cpu)    unit "$tag" 200 ./bin/llama-bench $BF -p 0 -n 256 -r 3 -dev none -ngl 0 ;;
    d-cpu-nr) unit "$tag" 200 ./bin/llama-bench $BF -p 0 -n 256 -r 3 -dev none -ngl 0 -nr ;;
    d-host)   [ -n "$HOSTB" ] && unit "$tag" 240 env $ENV_ONE ./bin/llama-bench $BF -p 0 -n 256 -r 3 -dev HTP0 -ngl 99 -nkvo 1 -ot "$OT_ALL" ;;
  esac
}

for a in a-hmx a-flat b c; do prefill 1 $a; done
for a in d-cpu d-cpu-nr d-host; do decode 1 $a; done
for a in c b a-flat a-hmx; do prefill 2 $a; done
for a in d-host d-cpu-nr d-cpu; do decode 2 $a; done

touch "$O/smp.stop"
sleep 2
echo oc8 > /sys/power/wake_unlock 2> /dev/null
mark "H session_done"
touch "$O/DONE"
