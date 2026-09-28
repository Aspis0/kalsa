#!/system/bin/sh
# On-device session runner for qdc-8elite-heat-arms: runs the 15 pre-registered
# arms in order (PREREG "Arms"), each with NPU proof (P-NPU only) -> cooldown
# to skin <= 36.0 C (15 s poll, 600 s cap -> VOID hot) -> measured run
# (300 s timeout) -> 60 s sampled tail. Writes marker lines to out/markers.txt;
# all parsing happens on the host (analyze.py).
# Usage: sh sess.sh <deadline_epoch>
D=/data/local/tmp/h8e
O=$D/out
M=$O/markers.txt
DEADLINE="$1"
cd "$D" || exit 2
export LD_LIBRARY_PATH=$D/lib
export ADSP_LIBRARY_PATH=$D/lib
export GGML_HEXAGON_NDEV=1

mark() { echo "$* $(date +%s)" >> "$M"; }

skin_now() {
  dumpsys thermalservice 2>/dev/null | sed -n '/Current temperatures from HAL/,/Current cooling devices from HAL/p' | grep -Eo 'mValue=[0-9.]*, mType=3, mName=[sS][kK][iI][nN]' | head -1 | sed 's/mValue=//;s/,.*//'
}

# cooldown <idx>: prints ok|hot; skin <= 36.0 compared in tenths.
cooldown() {
  t0=$(date +%s)
  while :; do
    s=$(skin_now)
    # Pure sh (no awk dependency on the board), in hundredths: "35.97" ->
    # 3597, "36.04" -> 3604 (not ok). Extra digits are truncated.
    ip=${s%%.*}; fp=${s#*.}; [ "$fp" = "$s" ] && fp=""
    fp="${fp}00"; fp=${fp%"${fp#??}"}
    hund=$(( ${ip:-99} * 100 + 1${fp} - 100 ))
    if [ -n "$s" ] && [ "$hund" -le 3600 ]; then echo "ok $s $(( $(date +%s) - t0 ))"; return; fi
    if [ $(( $(date +%s) - t0 )) -ge 600 ]; then echo "hot $s $(( $(date +%s) - t0 ))"; return; fi
    sleep 15
  done
}

COMMON="-m $D/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt"
pflags() {
  case "$1" in
    cpu) echo "-dev none -ngl 0" ;;
    gpu) echo "-dev GPUOpenCL -ngl 99" ;;
    npu) echo "-dev HTP0 -ngl 99 -nkvo" ;;
  esac
}

echo h8e > /sys/power/wake_lock 2>/dev/null && mark "H wake_lock ok" || mark "H wake_lock fail"
rm -f "$O/smp.stop"
sh "$D/smp.sh" > "$O/smp.out" 2>&1 &
mark "H session_start deadline=$DEADLINE"

i=0
for arm in P-cpu-1 P-gpu-1 P-npu-1 P-cpu-2 P-gpu-2 P-npu-2 P-cpu-3 P-gpu-3 P-npu-3 \
           D-6-1 D-4-1 D-2-1 D-6-2 D-4-2 D-2-2; do
  i=$((i + 1))
  kind=${arm%%-*}; rest=${arm#*-}; b=${rest%-*}; rep=${rest##*-}
  tag=$(printf '%02d-%s' "$i" "$arm")
  if [ $(( $(date +%s) + 150 )) -gt "$DEADLINE" ]; then mark "V $tag deadline"; continue; fi
  if [ "$kind" = P ] && [ "$b" = npu ]; then
    mark "PROOF_START $tag"
    GGML_HEXAGON_VERBOSE=1 timeout -s KILL 180 ./bin/llama-completion $COMMON -p " " -n 4 -lv 5 $(pflags npu) \
      > "$O/$tag.proof.log" 2>&1 < /dev/null
    echo "EXIT=$?" >> "$O/$tag.proof.log"
    mark "PROOF_END $tag"
  fi
  mark "C $tag $(cooldown)"
  mark "A_START $tag"
  if [ "$kind" = P ]; then
    timeout -s KILL 300 ./bin/llama-completion $COMMON -f $D/prompt.txt -n 16 -lv 4 $(pflags "$b") \
      > "$O/$tag.log" 2>&1 < /dev/null
  else
    timeout -s KILL 300 ./bin/llama-bench -m $D/ship.gguf -p 0 -n 256 -r 1 -t "$b" -ngl 0 -dev none -fa 1 --no-warmup -o md \
      > "$O/$tag.log" 2>&1 < /dev/null
  fi
  rc=$?
  echo "EXIT=$rc" >> "$O/$tag.log"
  mark "A_END $tag rc=$rc"
  sleep 60
  mark "T_END $tag"
done

touch "$O/smp.stop"
sleep 2
echo h8e > /sys/power/wake_unlock 2>/dev/null
mark "H session_done"
touch "$O/DONE"
