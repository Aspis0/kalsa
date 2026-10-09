# Cell #77 (S23, SM8550, unplugged): does COOLMODE pacing lower the temperature, and is a paced NPU cooler than a
# paced GPU? Owner question 2026-10-09. Three arms, same afternoon, each from skin <= 31 C, 600 s fixed (or skin 43):
#   npu-paced  --legs npu --coolmode-duty 0.5 --platform-status 3   (status 3 floors the state to COOLMODE)
#   gpu-paced  --legs gpu --coolmode-duty 0.5 --platform-status 3
#   npu-full   --legs npu                                            (same-day control, no pacing)
# A 10 s sampler logs skin (HAL SKIN), battery temperature, Android thermal status and wakefulness.
#   sh run-s23-paced.sh
R=/data/local/tmp/kalsa77; M=/data/local/tmp/heat3way/ship.gguf; B=$R/governor-bench; REPORT=$R/paced_report.txt
COOL_SKIN=31; STOP_AT=43; DURATION_S=600; MIN_LEVEL=30
export ADSP_LIBRARY_PATH="$R"
# the same one-copy environment as cells #73-#76
shared() {
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 GGML_OP_OFFLOAD_MIN_BATCH=1 \
      GGML_HEXAGON_ADMIT_OPS=7 GGML_OPENCL_TILE32_UNMEASURED=1 "$@"
}
skin() { dumpsys thermalservice | sed -n '/^Current temperatures from HAL/,/^Current cooling devices/p' | grep 'mName=SKIN' | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p' | head -1; }
batt() { dumpsys battery | grep -m1 '  temperature:' | grep -oE '[0-9]+'; }
level() { dumpsys battery | grep -m1 '  level:' | grep -oE '[0-9]+'; }
plugged() { dumpsys battery | grep -E 'AC powered|USB powered|Wireless powered' | grep -c true; }
tstatus() { dumpsys thermalservice | grep -m1 '^Thermal Status' | grep -oE '[0-9]+'; }
wake() { dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2; }
st() { echo "lvl=$(level) plugged=$(plugged) batT=$(batt) skin=$(skin) status=$(tstatus) wake=$(wake)"; }
cd $R; rm -f $REPORT
echo "== paced start $(date) bench $(sha256sum $B | cut -c1-12) skel $(sha256sum $R/libggml-htp-v73.so | cut -c1-12) model $(sha256sum $M | cut -c1-12) [$(st)]" >> $REPORT
for spec in npu-paced gpu-paced npu-full; do
  leg=${spec%-*}; mode=${spec#*-}
  extra=""; [ "$mode" = paced ] && extra="--coolmode-duty 0.5 --platform-status 3"
  [ "$(plugged)" -eq 0 ] || { echo "ABORT: plugged" >> $REPORT; break; }
  [ "$(level)" -ge $MIN_LEVEL ] || { echo "ABORT: battery below $MIN_LEVEL" >> $REPORT; break; }
  waited=0
  while :; do
    s=$(skin); s=${s%.*}
    [ -n "$s" ] && [ "$s" -le $COOL_SKIN ] && break
    [ $waited -ge 1500 ] && { echo "cool wait gave up at skin $s" >> $REPORT; break; }
    input keyevent 224; sleep 30; waited=$((waited + 30))
  done
  input keyevent 224; wm dismiss-keyguard
  CSV=$R/paced_$spec.csv; LOG=$R/paced_$spec.log
  echo "## arm=$spec start $(date +%s) after ${waited}s cool wait [$(st)]" >> $REPORT
  echo "t_s,skin_c,batt_dc,status,wake" > $CSV
  ( t=0; while [ ! -e $CSV.stop ]; do
      s=$(skin); echo "$t,$s,$(batt),$(tstatus),$(wake)" >> $CSV
      si=${s%.*}
      if [ -n "$si" ] && [ "$si" -ge $STOP_AT ]; then pkill -x governor-bench; echo "ARM STOP: skin $s at ${t}s" >> $REPORT; fi
      if [ $t -ge $DURATION_S ]; then pkill -x governor-bench; echo "ARM END: ${DURATION_S}s reached" >> $REPORT; fi
      input keyevent 224; sleep 10; t=$((t + 10))
    done ) &
  shared $B --arm L -m $M -t 5 -r 20 --hop 32 --gen 2049 --legs $leg $extra -v > $LOG 2>&1
  rc=$?
  touch $CSV.stop; sleep 11; rm -f $CSV.stop
  echo "## arm=$spec exit=$rc end $(date +%s) [$(st)]" >> $REPORT
  grep -E 'run_start|leg_summary|leg_total' $LOG | cut -c1-320 >> $REPORT
done
echo "== paced end $(date) [$(st)]" >> $REPORT
