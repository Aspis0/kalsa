#!/system/bin/sh
# Amendment A1 (decided 2026-09-28 15:29 EDT, AFTER round 1 had run): the soft 60 s gate let the skin
# reach the 45 C watchdog and voided P1-b, P1-c, D1-*. A1 re-runs the missing cells, shorter, with a
# hard cooldown (skin <= 38.0 C, status 0, cap 240 s). Usage: sh a1.sh <deadline_epoch>
D=/data/local/tmp/oc8
O=$D/out
M=$O/markers.txt
DEADLINE="$1"
cd "$D" || exit 2
export ADSP_LIBRARY_PATH=$D/dsp
export GGML_HEXAGON_NDEV=1
# Upstream b11304 renamed -nr to --repack <0|1>; the binary's help says which it speaks.
if ./bin/llama-bench --help 2>&1 | grep -q -e '--repack'; then NR='--repack 0'; else NR='-nr'; fi

mark() { echo "$* $(date +%s)" >> "$M"; }
hal_dump() { dumpsys thermalservice 2>/dev/null; }
skin_of() { echo "$1" | sed -n '/Current temperatures from HAL/,/Current cooling devices from HAL/p' | grep -Eo 'mValue=[0-9.]*, mType=3, mName=[sS][kK][iI][nN]' | head -1 | sed 's/mValue=//;s/,.*//'; }
status_of() { echo "$1" | grep -m1 'Thermal Status:' | sed 's/.*Thermal Status: *//'; }
hund() {
  ip=${1%%.*}; fp=${1#*.}; [ "$fp" = "$1" ] && fp=""
  fp="${fp}00"; fp=${fp%"${fp#??}"}
  echo $(( ${ip:-99} * 100 + 1${fp} - 100 ))
}
cooldown() {
  t0=$(date +%s)
  while :; do
    d=$(hal_dump); s=$(skin_of "$d"); st=$(status_of "$d")
    if [ -n "$s" ] && [ "$(hund "$s")" -le 3800 ] && [ "${st:-9}" = 0 ]; then echo "ok $s $st $(( $(date +%s) - t0 ))"; return; fi
    if [ $(( $(date +%s) - t0 )) -ge 240 ]; then echo "warm ${s:-na} ${st:-na} $(( $(date +%s) - t0 ))"; return; fi
    sleep 5
  done
}
killed_since() { awk -v t="$1" '$1=="K" && $2>=t {f=1} END{exit !f}' "$O/samples.txt"; }
runm() {
  tag="$1"; lim="$2"; shift 2
  "$@" > "$O/$tag.out" 2> "$O/$tag.err" < /dev/null &
  pid=$!
  t0=$(date +%s)
  while kill -0 "$pid" 2> /dev/null; do
    grep -E 'VmHWM|VmRSS' "/proc/$pid/status" > "$O/$tag.rss.tmp" 2> /dev/null && mv "$O/$tag.rss.tmp" "$O/$tag.rss"
    [ $(( $(date +%s) - t0 )) -gt "$lim" ] && { kill -9 "$pid"; echo "LIMIT_KILL" >> "$O/$tag.err"; }
    sleep 1
  done
  wait "$pid"; RC=$?
  echo "EXIT=$RC" >> "$O/$tag.err"
}
unit() {
  tag="$1"; lim="$2"; shift 2
  if [ $(( $(date +%s) + lim )) -gt "$DEADLINE" ]; then mark "V $tag deadline"; return; fi
  c=$(cooldown); mark "C $tag $c"
  t0=$(date +%s)
  mark "U_START $tag"
  runm "$tag" "$lim" "$@"
  mark "U_END $tag rc=$RC"
  if killed_since "$t0"; then mark "V $tag watchdog"; fi
}

ONE="GGML_HEXAGON_MM_SELECT=1 GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_HOSTBUF=1 GGML_OP_OFFLOAD_MIN_BATCH=32"
P5="(blk\.[0-9]+\.(attn_norm|ffn_norm|attn_q_norm|attn_k_norm|shortconv\.conv)|token_embd_norm)\.weight=HTP0;.*=HTP0-HOST"
BF="-m $D/ship.gguf -lm none -fa 1 -t 6 -o jsonl -v"

mark "H A1_start deadline=$DEADLINE"
unit A1-d-cpu    60 ./bin/llama-bench $BF -p 0 -n 128 -r 2 -dev none -ngl 0
unit A1-d-cpu-nr 60 ./bin/llama-bench $BF -p 0 -n 128 -r 2 -dev none -ngl 0 $NR
unit A1-d-host   60 env $ONE ./bin/llama-bench $BF -p 0 -n 128 -r 2 -dev HTP0 -ngl 99 -nkvo 1 -ot '.*=HTP0-HOST'
unit A1-b512     120 env $ONE ./bin/llama-bench $BF -p 512 -n 0 -r 3 -b 2048 -ub 1024 -dev HTP0 -ngl 99 -ot "$P5"
unit A1-c2048    90 ./bin/llama-bench $BF -p 2048 -n 0 -r 2 -b 2048 -ub 1024 -dev none -ngl 0
unit A1-b2048    150 env $ONE ./bin/llama-bench $BF -p 2048 -n 0 -r 1 -b 2048 -ub 1024 -dev HTP0 -ngl 99 -ot "$P5"
mark "H A1_done"
touch "$O/A1_DONE"
