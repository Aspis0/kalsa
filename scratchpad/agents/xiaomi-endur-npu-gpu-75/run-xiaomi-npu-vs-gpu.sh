# Xiaomi 14 (SM8650, Hexagon v75, Adreno 750), UNPLUGGED (owner 2026-10-09, cell 75): per-leg speed and heat of the ONE copy,
# NPU alone vs GPU alone, with the merged engine 23b2a44d7 whose GPU leg passes KL on this phone (cell 74).
# Back-to-back 2048-token runs (n_ctx 2816; the S23 reset needs n_ctx 8960) up to RUNS per arm, stop at skin STOP_AT.
# Order npu gpu (AB); each arm starts from skin <= COOL_SKIN (max 15 min wait, logged; AB only, owner time window). Owner's daily driver
# with a PIN: no keyguard command, no settings change; screen_off_timeout is already 24 h. Every sample records
# wakefulness AND keyguard; any non-Awake or keyguard sample = INVALID (and the owner must unlock).
#   (nohup sh -c ". /data/local/tmp/kalsa75/run-xiaomi-npu-vs-gpu.sh" > /data/local/tmp/kalsa75/endur.out 2>&1 < /dev/null &)
R=/data/local/tmp/kalsa75; M=/data/local/tmp/govhtp-xiaomi/model/ship.gguf; B=$R/governor-bench; REPORT=$R/endur_report.txt
WS=$R/endur.stop; COOL_SKIN=35; STOP_AT=43; MIN_LEVEL=30; RUNS=4
export ADSP_LIBRARY_PATH="$R"
shared() {
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 GGML_OP_OFFLOAD_MIN_BATCH=1 \
      GGML_HEXAGON_ADMIT_OPS=7 GGML_OPENCL_TILE32_UNMEASURED=1 "$@"
}
# HAL current section only: the "Cached temperatures" block can hold a stale skin value (46.7 C cached vs 31.0 C
# current on 2026-10-09), which would stop every arm at once.
skin() { dumpsys thermalservice | sed -n '/^Current temperatures from HAL/,/^Current cooling devices/p' | grep 'mName=skin' | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p' | sort -n | tail -1; }
level() { dumpsys battery | grep -m1 '  level:' | grep -oE '[0-9]+'; }
plugged() { dumpsys battery | grep -E 'AC powered|USB powered|Wireless powered' | grep -c true; }
wake() { dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2; }
kg() { dumpsys window | grep -m1 -oE 'isKeyguardShowing=(true|false)' | cut -d= -f2; }
st() { echo "lvl=$(level) plugged=$(plugged) batT=$(dumpsys battery | grep -m1 '  temperature:' | grep -oE '[0-9]+') skin=$(skin) wake=$(wake) keyguard=$(kg) thermal=$(dumpsys thermalservice | grep -m1 '^Thermal Status' | grep -oE '[0-9]+')"; }
rm -f $REPORT $WS
echo "== endur start $(date) bench $(sha256sum $B | cut -c1-12) skel $(sha256sum $R/libggml-htp-v75.so | cut -c1-12) model $(sha256sum $M | cut -c1-12) [$(st)]" >> $REPORT
[ "$(plugged)" -eq 0 ] || { echo "SESSION ABORTED: phone is plugged" >> $REPORT; return 1 2>/dev/null || exit 1; }
cd $R
( while [ ! -e $WS ]; do
    s=$(skin); s=${s%.*}
    if [ -n "$s" ] && [ "$s" -ge $STOP_AT ] && pgrep -f governor-bench > /dev/null; then
      pkill -f governor-bench; echo "ARM STOP: skin $s >= $STOP_AT $(date +%s)" >> $REPORT
    fi
    sleep 2
  done ) &
n=0
for arm in npu gpu; do
  n=$((n + 1))
  lv=$(level); [ -n "$lv" ] && [ "$lv" -lt $MIN_LEVEL ] && { echo "STOP: battery $lv < $MIN_LEVEL" >> $REPORT; break; }
  [ "$(plugged)" -eq 0 ] || { echo "STOP: phone was plugged in" >> $REPORT; break; }
  CSV=$R/endur_${n}_$arm.csv; LOG=$R/endur_${n}_$arm.log
  waited=0
  while :; do
    s=$(skin); s=${s%.*}
    [ -n "$s" ] && [ "$s" -le $COOL_SKIN ] && break
    [ $waited -ge 900 ] && { echo "cool wait gave up at skin $s" >> $REPORT; break; }
    sleep 30; waited=$((waited + 30))
  done
  echo "## $n arm=$arm start $(date +%s) after ${waited}s cool wait [$(st)]" >> $REPORT
  echo "t_s,skin_c,batt_dc,wake,keyguard" > $CSV
  ( t=0; while [ ! -e $CSV.stop ]; do
      echo "$t,$(skin),$(dumpsys battery | grep -m1 '  temperature:' | grep -oE '[0-9]+'),$(wake),$(kg)" >> $CSV
      sleep 10; t=$((t + 10))
    done ) &
  : > $LOG; k=0; rc=0
  while [ $k -lt $RUNS ]; do
    k=$((k + 1)); before=$(grep -c "ARM STOP" $REPORT)
    echo "### run $k start $(date +%s)" >> $LOG
    shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 2049 --legs $arm -v >> $LOG 2>&1
    rc=$?
    [ "$(grep -c "ARM STOP" $REPORT)" -gt "$before" ] && break
    [ $rc -ne 0 ] && break
  done
  echo "runs=$k" >> $REPORT
  touch $CSV.stop; sleep 11; rm -f $CSV.stop
  bad=$(grep -vcE ',Awake,false$' $CSV); [ "$bad" -gt 1 ] && echo "INVALID: $((bad - 1)) non-Awake or keyguard samples" >> $REPORT
  tok=$(grep '^leg_window' $LOG | sed -nE 's/.*tokens=([0-9]+).*/\1/p' | awk '{s+=$1} END {print s+0}')
  us=$(grep '^leg_window' $LOG | sed -nE 's/.* us=([0-9]+).*/\1/p' | awk '{s+=$1} END {print s+0}')
  echo "## $n arm=$arm exit=$rc end $(date +%s) [$(st)] windows_tokens=$tok windows_us=$us" >> $REPORT
  grep -E 'run_start|leg_summary|leg_total|abort|error' $LOG | cut -c1-260 >> $REPORT
done
touch $WS
echo "== endur end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE"
