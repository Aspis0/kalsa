# Cell 78 (S23, unplugged): map Android's thermal headroom forecast (cmd thermalservice headroom 10; 1.0 = SEVERE)
# against the thermal status, HAL SKIN and battery temperature under NPU decode load, to set the engine's graduated
# pacing thresholds (decode_pacing_headroom_start / _full). Load: up to 4 separate governor-bench processes, each one
# 4096-token NPU rep at full speed (one model load per process: a second load in one process hard-reset the S23 on
# 2026-10-09). Stops at skin 43 C, status >= 3 sustained for 60 s, or MemAvailable < 500 MB.
#   sh run-s23-headroom-cal.sh
R=/data/local/tmp/kalsa77; M=/data/local/tmp/heat3way/ship.gguf; B=$R/governor-bench; D=/data/local/tmp/kalsa78
OUT=$D/headroom.csv; REPORT=$D/cal_report.txt; STOP_AT=43
mkdir -p $D; rm -f $D/stop $OUT $REPORT
export ADSP_LIBRARY_PATH="$R"
skin() { dumpsys thermalservice | sed -n '/^Current temperatures from HAL/,/^Current cooling devices/p' | grep 'mName=SKIN' | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p' | head -1; }
plugged() { dumpsys battery | grep -E 'AC powered|USB powered|Wireless powered' | grep -c true; }
[ "$(plugged)" -eq 0 ] || { echo "ABORT: plugged" > $REPORT; exit 1; }
echo "== cal start $(date) skin=$(skin)" > $REPORT
echo "t_s,headroom10,status,skin_c,batt_dc,mem_avail_kb,bench_running" > $OUT
( t=0; sev=0; while [ ! -e $D/stop ]; do
    h=$(cmd thermalservice headroom 10 | sed -nE 's/.*: ([0-9.NaN-]+).*/\1/p')
    st=$(dumpsys thermalservice | grep -m1 '^Thermal Status' | grep -oE '[0-9]+'); s=$(skin)
    bt=$(dumpsys battery | grep -m1 '  temperature:' | grep -oE '[0-9]+'); ma=$(grep MemAvailable /proc/meminfo | grep -oE '[0-9]+')
    br=$(pidof governor-bench >/dev/null && echo 1 || echo 0)
    echo "$t,$h,$st,$s,$bt,$ma,$br" >> $OUT
    si=${s%.*}; [ -n "$si" ] && [ "$si" -ge $STOP_AT ] && { touch $D/stop; pkill -x governor-bench; echo "STOP: skin $s at ${t}s" >> $REPORT; }
    [ -n "$ma" ] && [ "$ma" -lt 500000 ] && { pkill -x governor-bench; echo "MEM KILL: $ma kB at ${t}s" >> $REPORT; }
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
echo "== cal end $(date) skin=$(skin)" >> $REPORT
