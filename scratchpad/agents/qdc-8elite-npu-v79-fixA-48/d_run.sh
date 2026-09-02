#!/bin/sh
# Cell #48 (qdc-8elite-npu-v79-fixA-48). Call AFTER adb sees the QDC device on 6037.
# DROP ORDER: kit -> R1 (MUL_MAT + EXTRA, judge-on) -> R2 (repeat) -> R3 (MUL_MAT_ID).
# No models. Cap 20 min; launch-stop 16 min (over 960s). Crash => NPU_DEAD, skip rest.
set -eu
export ANDROID_ADB_SERVER_PORT=6037
DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-npu-v79-fixA-48"
RAW="$DIR/raw"
KIT_TGZ="$HOME/kalsa-qdc/npu-v79-cell/npu-kit-153fdbafd.tgz"
GATE="$HOME/kalsa-qdc/kexp-speed-cell/thermal_gate.sh"
DEVDIR=/data/local/tmp/kalsa-npu
EXTRA='q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,1024;q8_0:2880,32,2880;q4_0:2880,64,2880'
T0=$(date +%s)
NPU_DEAD=0
mkdir -p "$RAW"

elapsed() { echo $(($(date +%s) - T0)); }
over() { [ "$(elapsed)" -ge 960 ]; }   # launch-stop 16 min; QDC cap 20 min (prereg)
crashed() { grep -Eiq 'qurt_exit|dspqueue_(read|write) failed|CDSP0 CRASHED' "$1"; }
note() { echo "[$(date +%H:%M:%S) e=$(elapsed)] $*" | tee -a "$RAW/events.txt"; }
dpush() { adb -s "$SER" push "$1" "$2" > "$RAW/push_$(basename "$2").log" 2>&1 || { note "PUSH_FAIL $2"; exit 6; }; }

SER=$(adb devices | awk '/\tdevice$/{print $1; exit}')
if [ -z "$SER" ]; then echo NO_DEVICE | tee "$RAW/events.txt"; exit 2; fi
echo "serial=$SER t0=$T0 t0_iso=$(date -u +%FT%TZ)" | tee "$RAW/serial.txt"
adb -s "$SER" shell "getprop ro.serialno; getprop ro.build.fingerprint; getprop ro.board.platform" \
  > "$RAW/provenance.txt" 2>&1 || true

# --- kit ---
adb -s "$SER" shell "mkdir -p $DEVDIR"
dpush "$KIT_TGZ" "$DEVDIR/kit.tgz"
adb -s "$SER" shell "cd $DEVDIR && tar -xzf kit.tgz && chmod -R 755 bin lib && \
  grep -v ' SHA256SUMS\$' SHA256SUMS > SUMS.check && sha256sum -c SUMS.check; echo MANIFEST_LINES=\$(wc -l < SUMS.check)" \
  > "$RAW/kit_verify.txt" 2>&1 || true
NOK=$(grep -c ': OK' "$RAW/kit_verify.txt" || true)
NMAN=$(sed -n 's/^MANIFEST_LINES=\([0-9]*\).*/\1/p' "$RAW/kit_verify.txt" | tr -d '\r')
if grep -q FAILED "$RAW/kit_verify.txt" || [ -z "$NMAN" ] || [ "$NOK" -ne "$NMAN" ]; then
  note "KIT_VERIFY_FAIL ok=$NOK manifest=$NMAN"; exit 3
fi
HTP_ENV="export LD_LIBRARY_PATH=\$PWD/lib ADSP_LIBRARY_PATH=\$PWD/lib"
adb -s "$SER" shell "cd $DEVDIR && $HTP_ENV && ./bin/llama-bench --list-devices; echo EXIT=\$?" \
  > "$RAW/list_devices.txt" 2>&1 || true
if ! grep -q 'Hexagon Arch version v79' "$RAW/list_devices.txt"; then
  note METHOD-VOID_NO_V79_END; exit 4
fi
BDEV=$(grep -o 'HTP[0-9]*: Hexagon' "$RAW/list_devices.txt" | head -1 | cut -d: -f1)
[ -n "$BDEV" ] || BDEV=HTP0
echo "backend=$BDEV" | tee -a "$RAW/serial.txt"

gate_pre() {
  "$GATE" "$SER" "$RAW/therm_pre_$1.txt" > "$RAW/gate_pre_$1.txt" 2>&1 && return 0
  note "GATE_WAIT $1"; sleep 180
  "$GATE" "$SER" "$RAW/therm_pre_$1.txt" > "$RAW/gate_pre_$1.txt" 2>&1 && return 0
  note "GATE_SKIP $1"; return 1
}
gate_post() { "$GATE" "$SER" "$RAW/therm_post_$1.txt" > "$RAW/gate_post_$1.txt" 2>&1 || true; }

# ops: $1=tag $2=op $3=extra-mm string ('' for none). Judge always ON per prereg.
run_ops() {
  tag=$1; op=$2; xmm=$3
  if over; then note "SKIP_$tag over"; return 0; fi
  if [ "$NPU_DEAD" = 1 ]; then note "CRASH_SKIP_$tag"; return 0; fi
  gate_pre "$tag" || return 0
  XENV=""
  [ -n "$xmm" ] && XENV="export GGML_TEST_EXTRA_MM='$xmm' && "
  adb -s "$SER" shell "cd $DEVDIR && $HTP_ENV && export GGML_TEST_PLAIN_HOST=1 && $XENV\
    ./bin/test-backend-ops -b $BDEV -o $op; echo EXIT=\$?" > "$RAW/ops_$tag.txt" 2>&1 || true
  echo $? > "$RAW/ops_$tag.adb.exit"
  gate_post "$tag"
  if crashed "$RAW/ops_$tag.txt"; then NPU_DEAD=1; note "CRASH_$tag (NPU work ends)"; fi
  # binding quick-counts (grep pair) + failing list; census.awk split is reported-not-binding
  IE=$(grep -c 'dsp-rsp: INTERNAL-ERROR' "$RAW/ops_$tag.txt" || true)
  GF=$(grep -c 'ggml_backend_graph_compute failed' "$RAW/ops_$tag.txt" || true)
  PASSLINE=$(grep -E '[0-9]+/[0-9]+ tests passed' "$RAW/ops_$tag.txt" | tail -1)
  echo "$tag: INTERNAL-ERROR=$IE graph_failed=$GF $PASSLINE" | tee -a "$RAW/summary.txt"
  sed -n '/Failing tests:/,/Backend /p' "$RAW/ops_$tag.txt" > "$RAW/failing_$tag.txt" || true
  sh "$DIR/census.sh" "$RAW/ops_$tag.txt" "$op" > /dev/null 2>&1 || note "CENSUS_ERR $tag"
}

run_ops mm_r1 MUL_MAT "$EXTRA"
run_ops mm_r2 MUL_MAT "$EXTRA"
run_ops mmid_r3 MUL_MAT_ID ""

note "DONE"
echo "DONE elapsed=$(elapsed)" | tee "$RAW/done.txt"
