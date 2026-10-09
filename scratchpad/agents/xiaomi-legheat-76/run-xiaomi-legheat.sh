# Cell #76 (Xiaomi 14, SM8650, unplugged, owner's 15-minute window): the per-leg values the SM8650 legs-table row
# still lacks after cell #75 - CPU skin heat per 1k tokens, and every leg's own zone rise under load (load step).
# One arm per leg (arm L, --legs <leg>, --hop 32), CPU first while the phone is coolest; no cool wait (no time).
# A 1 Hz sampler logs skin (HAL current section only, see cell #75) and the max nsp / gpu / cpu zone temps.
# Skin stop 43 C kills the bench.   sh run-xiaomi-legheat.sh
R=/data/local/tmp/kalsa76; M=/data/local/tmp/govhtp-xiaomi/model/ship.gguf; B=$R/governor-bench
REPORT=$R/legheat_report.txt; STOP_AT=43
export ADSP_LIBRARY_PATH="$R"
# the same one-copy environment as cell #75
shared() {
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 GGML_OP_OFFLOAD_MIN_BATCH=1 \
      GGML_HEXAGON_ADMIT_OPS=7 GGML_OPENCL_TILE32_UNMEASURED=1 "$@"
}
skin() { dumpsys thermalservice | sed -n '/^Current temperatures from HAL/,/^Current cooling devices/p' | grep 'mName=skin' | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p' | sort -n | tail -1; }
mx() { m=0; for z in $1; do v=$(cat $z/temp 2>/dev/null); [ -n "$v" ] && [ "$v" -gt "$m" ] && m=$v; done; echo $m; }
NSP=""; GPU=""; CPU=""
for z in /sys/class/thermal/thermal_zone*; do
  case "$(cat $z/type)" in nsp*) NSP="$NSP $z";; gpuss*) GPU="$GPU $z";; cpu-*) CPU="$CPU $z";; esac
done
st() { echo "lvl=$(dumpsys battery | grep -m1 '  level:' | grep -oE '[0-9]+') plugged=$(dumpsys battery | grep -E 'AC powered|USB powered|Wireless powered' | grep -c true) batT=$(dumpsys battery | grep -m1 '  temperature:' | grep -oE '[0-9]+') skin=$(skin) wake=$(dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2)"; }
cd $R; rm -f $REPORT
echo "== legheat start $(date) bench $(sha256sum $B | cut -c1-12) [$(st)] zones nsp:$(echo $NSP | wc -w) gpu:$(echo $GPU | wc -w) cpu:$(echo $CPU | wc -w)" >> $REPORT
for spec in cpu:1024 npu:512 gpu:512; do
  leg=${spec%:*}; gen=${spec#*:}; CSV=$R/legheat_$leg.csv
  input keyevent 224; wm dismiss-keyguard
  echo "## leg=$leg gen=$gen start $(date +%s) [$(st)]" >> $REPORT
  echo "epoch,skin_c,nsp_mc,gpu_mc,cpu_mc" > $CSV
  ( while [ ! -e $CSV.stop ]; do
      s=$(skin); echo "$(date +%s),$s,$(mx "$NSP"),$(mx "$GPU"),$(mx "$CPU")" >> $CSV
      [ -n "$s" ] && [ "${s%.*}" -ge $STOP_AT ] && { pkill -x governor-bench; echo "ARM STOP: skin $s $(date +%s)" >> $REPORT; }
      input keyevent 224; sleep 1
    done ) &
  shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen $gen --legs $leg -v > $R/legheat_$leg.log 2>&1
  rc=$?
  sleep 5; touch $CSV.stop; sleep 2; rm -f $CSV.stop
  echo "## leg=$leg exit=$rc end $(date +%s) [$(st)]" >> $REPORT
  grep -E 'run_start|leg_summary|leg_total' $R/legheat_$leg.log | cut -c1-260 >> $REPORT
done
echo "== legheat end $(date) [$(st)]" >> $REPORT
