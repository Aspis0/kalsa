#!/bin/sh
# Cell #46 (qdc-8elite-npu-v79-judge), PREREG rev-3. Call AFTER adb sees the QDC device on 6037.
# DROP ORDER: kit+probes -> ops(PLAIN_HOST=1) MM, ID -> ops control ID (PLAIN_HOST=0) ->
#             PPL ship HTP, CPU -> PPL OLMoE HTP, CPU -> PPL Qwen HTP, CPU (only if early).
# No new invocation at >= 24 min elapsed (T0 = script start; owner writes Running to raw/running.txt).
# CRASH (qurt_exit / dspqueue failed / CDSP0 CRASHED) skips the remaining HTP invocations,
# CPU invocations still run. INTERNAL-ERROR is NOT a crash. No retry anywhere.
set -eu
export ANDROID_ADB_SERVER_PORT=6037
DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-npu-v79-judge"
RAW="$DIR/raw"
KIT_TGZ="$HOME/kalsa-qdc/npu-v79-cell/npu-kit-93e9592fa.tgz"
MODELS="$HOME/kalsa-models"
CORPUS="$MODELS/wiki.test.raw"
CORPUS_SHA="173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08"
SHIP="$MODELS/LFM2.5-2.6B-QAD-Q4_0.gguf"
SHIP_SHA="a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03"
OLMOE="$MODELS/OLMoE-1B-7B-0924-Instruct-Q4_0-requant-from-q4km.gguf"
OLMOE_SHA="9d0b90c60a5b4732ba1faeb0b8940523173bf7e2a7f038d5753ce3ac24b98618"
QWEN="$MODELS/Qwen3.5-4B-Q4_0-requant-from-q4km.gguf"
QWEN_SHA="f1635f9c30430dadae1230ee29047e70251a8926bb569a6eeae95db00ff4bd36"
GATE="$HOME/kalsa-qdc/kexp-speed-cell/thermal_gate.sh"
DEVDIR=/data/local/tmp/kalsa-npu
PPL_FLAGS="-c 2048 -b 2048 -ub 1024 -fa on --chunks 32 -t 8"
T0=$(date +%s)
NPU_DEAD=0
mkdir -p "$RAW"

elapsed() { echo $(($(date +%s) - T0)); }
over() { [ "$(elapsed)" -ge 1440 ]; }
crashed() { grep -Eiq 'qurt_exit|dspqueue_(read|write) failed|CDSP0 CRASHED' "$1"; }
note() { echo "[$(date +%H:%M:%S) e=$(elapsed)] $*" | tee -a "$RAW/events.txt"; }
dpush() { adb -s "$SER" push "$1" "$2" > "$RAW/push_$(basename "$2").log" 2>&1 || { note "PUSH_FAIL $2"; exit 6; }; }

SER=$(adb devices | awk '/\tdevice$/{print $1; exit}')
if [ -z "$SER" ]; then echo NO_DEVICE | tee "$RAW/events.txt"; exit 2; fi
echo "serial=$SER t0=$T0 t0_iso=$(date -u +%FT%TZ)" | tee "$RAW/serial.txt"
adb -s "$SER" shell "getprop ro.serialno; getprop ro.build.fingerprint; getprop ro.board.platform" \
  > "$RAW/provenance.txt" 2>&1 || true

# --- arm 1: kit, verify (self-line ignored, OK count == manifest lines), probes ---
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
adb -s "$SER" shell "cd $DEVDIR && $HTP_ENV && ./bin/llama-perplexity --help; echo EXIT=\$?" \
  > "$RAW/perplexity_help.txt" 2>&1 || true
LOADMODE=""
for f in '--load-mode' '-fa' '--chunks'; do
  if grep -q -- "$f" "$RAW/perplexity_help.txt"; then note "FLAG_OK $f"; else note "FLAG_MISSING $f"; fi
done
if grep -q -- '--load-mode' "$RAW/perplexity_help.txt"; then LOADMODE="--load-mode none"; fi
STDBUF=""
if adb -s "$SER" shell "command -v stdbuf" 2>/dev/null | grep -q stdbuf; then STDBUF="stdbuf -oL"; note "STDBUF present"; else note "STDBUF absent (block-buffered tee declared)"; fi
note "ppl flags: $PPL_FLAGS $LOADMODE"

gate_pre() {
  "$GATE" "$SER" "$RAW/therm_pre_$1.txt" > "$RAW/gate_pre_$1.txt" 2>&1 && return 0
  note "GATE_WAIT $1"; sleep 180
  "$GATE" "$SER" "$RAW/therm_pre_$1.txt" > "$RAW/gate_pre_$1.txt" 2>&1 && return 0
  note "GATE_SKIP $1"; return 1
}
gate_post() { "$GATE" "$SER" "$RAW/therm_post_$1.txt" > "$RAW/gate_post_$1.txt" 2>&1 || true; }

# ops: $1=tag $2=PLAIN_HOST value $3=op
run_ops() {
  tag=$1; ph=$2; op=$3
  if over; then note "SKIP_$tag over"; return 0; fi
  if [ "$NPU_DEAD" = 1 ]; then note "CRASH_SKIP_$tag"; return 0; fi
  gate_pre "$tag" || return 0
  adb -s "$SER" shell "cd $DEVDIR && $HTP_ENV && export GGML_TEST_PLAIN_HOST=$ph && \
    ./bin/test-backend-ops -b $BDEV -o $op; echo EXIT=\$?" > "$RAW/ops_$tag.txt" 2>&1 || true
  echo $? > "$RAW/ops_$tag.adb.exit"
  gate_post "$tag"
  if crashed "$RAW/ops_$tag.txt"; then NPU_DEAD=1; note "CRASH_$tag (NPU work ends)"; fi
  sh "$DIR/census.sh" "$RAW/ops_$tag.txt" "$op" > /dev/null 2>&1 || note "CENSUS_ERR $tag"
}

# push model: $1=host path $2=host sha $3=device name -> 0 ok / 1 void
push_model() {
  dpush "$1" "$DEVDIR/$3"
  DEV_SHA=$(adb -s "$SER" shell "sha256sum $DEVDIR/$3" | awk '{print $1}')
  printf 'host=%s\ndevice=%s\n' "$2" "$DEV_SHA" | tee "$RAW/sha_$3.txt"
  [ "$DEV_SHA" = "$2" ]
}

# ppl: $1=tag $2=model device name $3=arm (htp|cpu); output tee'd on device, pulled after
run_ppl() {
  tag=$1; mdl=$2; arm=$3
  if over; then note "SKIP_$tag over"; return 0; fi
  if [ "$arm" = htp ] && [ "$NPU_DEAD" = 1 ]; then note "CRASH_SKIP_$tag"; return 0; fi
  gate_pre "$tag" || return 0
  if [ "$arm" = htp ]; then
    CMD="export GGML_HEXAGON_VERBOSE=1 && $STDBUF ./bin/llama-perplexity -m $mdl -f wiki.test.raw --device $BDEV -ngl 99 $PPL_FLAGS $LOADMODE"
  else
    CMD="$STDBUF ./bin/llama-perplexity -m $mdl -f wiki.test.raw -ngl 0 $PPL_FLAGS $LOADMODE"
  fi
  adb -s "$SER" shell "cd $DEVDIR && $HTP_ENV && ( $CMD; echo EXIT=\$? ) 2>&1 | tee $DEVDIR/ppl_$tag.dev.txt" \
    > "$RAW/ppl_$tag.txt" 2>&1 || true
  echo $? > "$RAW/ppl_$tag.adb.exit"
  gate_post "$tag"
  adb -s "$SER" pull "$DEVDIR/ppl_$tag.dev.txt" "$RAW/ppl_$tag.dev.txt" > /dev/null 2>&1 || true
  grep -E 'Final estimate|EXIT=' "$RAW/ppl_$tag.txt" | sed "s/^/$tag: /" | tee -a "$RAW/ppl_summary.txt"
  if [ "$arm" = htp ] && crashed "$RAW/ppl_$tag.txt"; then NPU_DEAD=1; note "CRASH_$tag (NPU work ends)"; fi
}

# --- arm 2: ops with the real judge ---
run_ops mm_ph1 1 MUL_MAT
run_ops id_ph1 1 MUL_MAT_ID
# --- arm 3: control, env off (elapsed-from-T0 < 8 min) ---
if [ "$(elapsed)" -lt 480 ]; then run_ops id_ph0 0 MUL_MAT_ID; else note "SKIP_id_ph0 time"; fi

# --- corpus + arm 4: ship model ---
if push_model "$CORPUS" "$CORPUS_SHA" wiki.test.raw; then
  if push_model "$SHIP" "$SHIP_SHA" ship.gguf; then
    run_ppl ship_htp ship.gguf htp
    run_ppl ship_cpu ship.gguf cpu
  else note METHOD-VOID_SHIP_SHA; fi
  # --- arm 5: OLMoE experts ---
  if over; then note "SKIP_olmoe over"
  elif push_model "$OLMOE" "$OLMOE_SHA" olmoe.gguf; then
    run_ppl olmoe_htp olmoe.gguf htp
    run_ppl olmoe_cpu olmoe.gguf cpu
  else note METHOD-VOID_OLMOE_SHA; fi
  # --- arm 6: Qwen dense, only if early ---
  if [ "$(elapsed)" -ge 1080 ]; then note "SKIP_qwen time"
  elif push_model "$QWEN" "$QWEN_SHA" qwen.gguf; then
    run_ppl qwen_htp qwen.gguf htp
    run_ppl qwen_cpu qwen.gguf cpu
  else note METHOD-VOID_QWEN_SHA; fi
else note "METHOD-VOID_CORPUS_SHA (arms 4-6)"; fi

note "DONE npu_dead=$NPU_DEAD"
echo "DONE elapsed=$(elapsed)" | tee "$RAW/done.txt"
