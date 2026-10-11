# Cell 79 (Xiaomi 14, SM8650, unplugged): cell 78's map on the Xiaomi - Android's thermal headroom forecast
# (cmd thermalservice headroom 10; 1.0 = SEVERE) against the thermal status, HAL skin and battery temperature under
# NPU decode load, to check whether the S23-calibrated pacing lines (start 0.87, full 0.97) mean the same heat here.
# Known trap: this phone reported status 0 while its CPU frequency was already capped (memory, 2026-10).
# Load: up to 4 separate governor-bench processes (cell 76's bench), each one 4096-token NPU rep at full speed, one
# model load per process. Stops at skin 43 C, status >= 3 sustained for 60 s, MemAvailable < 500 MB, or battery
# level < 32 % (the G2 session needs the rest).   sh run-xiaomi-headroom-cal.sh
R=/data/local/tmp/kalsa76; M=/data/local/tmp/govhtp-xiaomi/model/ship.gguf; B=$R/governor-bench; D=/data/local/tmp/kalsa79
OUT=$D/headroom.csv; REPORT=$D/cal_report.txt; STOP_AT=43; MIN_LEVEL=32
mkdir -p $D; rm -f $D/stop $OUT $REPORT
export ADSP_LIBRARY_PATH="$R"
# The Xiaomi HAL lists several lowercase "skin" sensors (cell 76): take the hottest.
skin() { dumpsys thermalservice | sed -n '/^Current temperatures from HAL/,/^Current cooling devices/p' | grep 'mName=skin' | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p' | sort -n | tail -1; }
plugged() { dumpsys battery | grep -E 'AC powered|USB powered|Wireless powered' | grep -c true; }
level() { dumpsys battery | grep -m1 '  level:' | grep -oE '[0-9]+'; }
[ "$(plugged)" -eq 0 ] || { echo "ABORT: plugged" > $REPORT; exit 1; }
echo "== cal start $(date) skin=$(skin) level=$(level) bench=$(sha256sum $B | cut -c1-12)" > $REPORT
echo "t_s,headroom10,status,skin_c,batt_dc,level,mem_avail_kb,bench_running" > $OUT
( t=0; sev=0; while [ ! -e $D/stop ]; do
    h=$(cmd thermalservice headroom 10 | sed -nE 's/.*: ([0-9.NaN-]+).*/\1/p')
    st=$(dumpsys thermalservice | grep -m1 '^Thermal Status' | grep -oE '[0-9]+'); s=$(skin)
    bt=$(dumpsys battery | grep -m1 '  temperature:' | grep -oE '[0-9]+'); lv=$(level)
    ma=$(grep MemAvailable /proc/meminfo | grep -oE '[0-9]+'); br=$(pidof governor-bench >/dev/null && echo 1 || echo 0)
    echo "$t,$h,$st,$s,$bt,$lv,$ma,$br" >> $OUT
    si=${s%.*}; [ -n "$si" ] && [ "$si" -ge $STOP_AT ] && { touch $D/stop; pkill -x governor-bench; echo "STOP: skin $s at ${t}s" >> $REPORT; }
    [ -n "$ma" ] && [ "$ma" -lt 500000 ] && { pkill -x governor-bench; echo "MEM KILL: $ma kB at ${t}s" >> $REPORT; }
    [ -n "$lv" ] && [ "$lv" -lt $MIN_LEVEL ] && { touch $D/stop; pkill -x governor-bench; echo "STOP: level $lv at ${t}s" >> $REPORT; }
    if [ -n "$st" ] && [ "$st" -ge 3 ]; then sev=$((sev + 2)); else sev=0; fi
    [ $sev -ge 60 ] && { touch $D/stop; pkill -x governor-bench; echo "STOP: status >= 3 for 60 s at ${t}s" >> $REPORT; }
    input keyevent 224; sleep 2; t=$((t + 2))
  done ) &
for run in 1 2 3 4; do
  [ -e $D/stop ] && break
  echo "## run $run start $(date +%s) skin=$(skin)" >> $REPORT
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 GGML_OP_OFFLOAD_MIN_BATCH=1 \
      GGML_HEXAGON_ADMIT_OPS=7 GGML_OPENCL_TILE32_UNMEASURED=1 \
      $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 4097 --legs npu > $D/run$run.log 2>&1
  echo "## run $run exit=$? end $(date +%s) skin=$(skin)" >> $REPORT
  sleep 5
done
touch $D/stop; sleep 3
echo "== cal end $(date) skin=$(skin) level=$(level)" >> $REPORT
