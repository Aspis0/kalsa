#!/system/bin/sh
# On-device runner for qdc-8elite-hopping-heat (PREREG A then B).
# A: blocks P-CPU x6 -> P-NPU x12 -> P-GPU x12, back-to-back units inside a
#    block, cooldown (skin <= 36.0 C, status 0) only between blocks, 60 s tail.
# B: tg256 arms in rotated order, cooldown before each, 60 s tail.
# Writes marker lines to out/markers.txt; parsing is on the host (analyze.py).
# Usage: sh sess.sh <deadline_epoch>
D=/data/local/tmp/h8h
O=$D/out
M=$O/markers.txt
DEADLINE="$1"
cd "$D" || exit 2
export LD_LIBRARY_PATH=$D/lib
export ADSP_LIBRARY_PATH=$D/lib
export GGML_HEXAGON_NDEV=1

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

# cooldown: prints "ok|hot <skin> <status> <waited_s>".
cooldown() {
  t0=$(date +%s)
  while :; do
    d=$(hal_dump); s=$(skin_of "$d"); st=$(status_of "$d")
    if [ -n "$s" ] && [ "$(hund "$s")" -le 3600 ] && [ "${st:-9}" = 0 ]; then echo "ok $s $st $(( $(date +%s) - t0 ))"; return; fi
    if [ $(( $(date +%s) - t0 )) -ge 600 ]; then echo "hot ${s:-na} ${st:-na} $(( $(date +%s) - t0 ))"; return; fi
    sleep 15
  done
}

status_stop() { st=$(status_of "$(hal_dump)"); [ "${st:-0}" -ge 3 ] 2>/dev/null; }
killed_since() { awk -v t="$1" '$1=="K" && $2>=t {f=1} END{exit !f}' "$O/samples.txt"; }

COMMON="-m $D/ship.gguf -lm none -f $D/prompt.txt -n 16 --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -lv 4"
pflags() {
  case "$1" in
    cpu) echo "-dev none -ngl 0" ;;
    gpu) echo "-dev GPUOpenCL -ngl 99" ;;
    npu) echo "-dev HTP0 -ngl 99 -nkvo" ;;
  esac
}
bflags() {
  case "$1" in
    cpu) echo "-ngl 0 -dev none" ;;
    gpu) echo "-ngl 99 -dev GPUOpenCL" ;;
    npu) echo "-ngl 99 -dev HTP0" ;;
  esac
}
# bench <n_gen> <extra flags...>: one llama-bench tg run (-v: model-buffer lines for the proof).
bench() { n="$1"; shift; timeout -s KILL 300 ./bin/llama-bench -m $D/ship.gguf -p 0 -n "$n" -r 1 -t 6 "$@" -fa 1 --no-warmup -o md -v; }

STOPPED=0
echo h8h > /sys/power/wake_lock 2>/dev/null && mark "H wake_lock ok" || mark "H wake_lock fail"
rm -f "$O/smp.stop"
sh "$D/smp.sh" > "$O/smp.out" 2>&1 &
sleep 3
mark "H session_start deadline=$DEADLINE"

# ---- A: sustained prefill blocks ----
for blk in cpu:6 npu:12 gpu:12; do
  b=${blk%%:*}; n=${blk##*:}; tag="A-$b"
  if [ "$STOPPED" = 1 ]; then mark "V $tag stop"; continue; fi
  if [ $(( $(date +%s) + 150 )) -gt "$DEADLINE" ]; then mark "V $tag deadline"; continue; fi
  c=$(cooldown); mark "C $tag $c"
  case "$c" in hot*) mark "V $tag hot"; continue ;; esac
  mark "B_START $tag"
  k=1
  while [ "$k" -le "$n" ]; do
    u=$(printf '%s-u%02d' "$tag" "$k")
    t0=$(date +%s)
    mark "U_START $u"
    timeout -s KILL 300 ./bin/llama-completion $COMMON $(pflags "$b") > "$O/$u.log" 2>&1 < /dev/null
    rc=$?; echo "EXIT=$rc" >> "$O/$u.log"
    mark "U_END $u rc=$rc"
    if killed_since "$t0"; then mark "V_REST $tag watchdog_after=$k"; break; fi
    if status_stop; then mark "V_REST $tag stop_after=$k"; STOPPED=1; break; fi
    k=$((k + 1))
  done
  mark "B_END $tag"
  sleep 60
  mark "T_END $tag"
done

# ---- B: decode heat per token, rotated order ----
PROOF_DONE=0
i=0
for b in cpu gpu npu gpu npu cpu npu cpu gpu; do
  i=$((i + 1))
  tag=$(printf 'B%d-%s' "$i" "$b")
  if [ "$STOPPED" = 1 ]; then mark "V $tag stop"; continue; fi
  if [ $(( $(date +%s) + 150 )) -gt "$DEADLINE" ]; then mark "V $tag deadline"; continue; fi
  if [ "$b" = npu ] && [ "$PROOF_DONE" = 0 ]; then
    mark "PROOF_START B-npu"
    # Subshell export: an env prefix on a shell FUNCTION call is not reliably exported.
    (export GGML_HEXAGON_VERBOSE=1; bench 4 $(bflags npu)) > "$O/B-npu.proof.log" 2>&1 < /dev/null
    echo "EXIT=$?" >> "$O/B-npu.proof.log"
    mark "PROOF_END B-npu"
    PROOF_DONE=1
  fi
  c=$(cooldown); mark "C $tag $c"
  case "$c" in hot*) mark "V $tag hot"; continue ;; esac
  t0=$(date +%s)
  mark "A_START $tag"
  bench 256 $(bflags "$b") > "$O/$tag.log" 2>&1 < /dev/null
  rc=$?; echo "EXIT=$rc" >> "$O/$tag.log"
  mark "A_END $tag rc=$rc"
  if [ "$b" = npu ] && [ "$rc" != 0 ] && ! grep -q 'tg256' "$O/$tag.log" && ! killed_since "$t0"; then
    # PREREG: one retry with -nkvo 1 on an HTP load failure (not a crash).
    sleep 60; mark "T_END $tag"
    tag="$tag-nkvo"
    c=$(cooldown); mark "C $tag $c"
    case "$c" in hot*) mark "V $tag hot"; continue ;; esac
    mark "A_START $tag"
    bench 256 $(bflags npu) -nkvo 1 > "$O/$tag.log" 2>&1 < /dev/null
    rc=$?; echo "EXIT=$rc" >> "$O/$tag.log"
    mark "A_END $tag rc=$rc"
  fi
  sleep 60
  mark "T_END $tag"
  if status_stop; then mark "H status_stop after=$tag"; STOPPED=1; fi
done

touch "$O/smp.stop"
sleep 2
echo h8h > /sys/power/wake_unlock 2>/dev/null
mark "H session_done"
touch "$O/DONE"
