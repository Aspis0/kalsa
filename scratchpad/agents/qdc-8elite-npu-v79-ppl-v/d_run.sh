#!/bin/sh
# Cell #47 (qdc-8elite-npu-v79-ppl-v). Call AFTER adb sees the QDC device on 6037.
# DROP ORDER: kit -> ship HTP (-v) -> OLMoE HTP (-v). No CPU twins (reused from #46 by prereg).
# No new invocation at >= 20 min elapsed (over 1200s); QDC cap 25 min. CRASH ends the cell (only HTP arms here).
set -eu
export ANDROID_ADB_SERVER_PORT=6037
DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-npu-v79-ppl-v"
RAW="$DIR/raw"
KIT_TGZ="$HOME/kalsa-qdc/npu-v79-cell/npu-kit-93e9592fa.tgz"
MODELS="$HOME/kalsa-models"
CORPUS="$MODELS/wiki.test.raw"
CORPUS_SHA="173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08"
SHIP="$MODELS/LFM2.5-2.6B-QAD-Q4_0.gguf"
SHIP_SHA="a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03"
OLMOE="$MODELS/OLMoE-1B-7B-0924-Instruct-Q4_0-requant-from-q4km.gguf"
OLMOE_SHA="9d0b90c60a5b4732ba1faeb0b8940523173bf7e2a7f038d5753ce3ac24b98618"
GATE="$HOME/kalsa-qdc/kexp-speed-cell/thermal_gate.sh"
DEVDIR=/data/local/tmp/kalsa-npu
PPL_FLAGS="-c 2048 -b 2048 -ub 1024 -fa on --chunks 32 -t 8 -v"
T0=$(date +%s)
mkdir -p "$RAW"

elapsed() { echo $(($(date +%s) - T0)); }
over() { [ "$(elapsed)" -ge 1200 ]; }   # launch-stop 20 min; QDC cap 25 min (prereg)
# lines worth keeping from a -v perplexity run (proof + offload split + result), so the
# on-device log stays a few MB instead of 1-2 GB (device already holds 5.5 GB of models)
KEEP='execute-op|Final estimate|^\[[0-9]+\]|EXIT=|offloaded|assigned to|buffer size|n_gpu_layers|load_tensors|llama_kv|KV self|Hexagon Arch|HTP0|qurt_exit|dspqueue_(read|write) failed|CDSP0 CRASHED|INTERNAL-ERROR|error|abort|GGML_ASSERT'
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
note "ppl flags: $PPL_FLAGS"

gate_pre() {
  "$GATE" "$SER" "$RAW/therm_pre_$1.txt" > "$RAW/gate_pre_$1.txt" 2>&1 && return 0
  note "GATE_WAIT $1"; sleep 180
  "$GATE" "$SER" "$RAW/therm_pre_$1.txt" > "$RAW/gate_pre_$1.txt" 2>&1 && return 0
  note "GATE_SKIP $1"; return 1
}
gate_post() { "$GATE" "$SER" "$RAW/therm_post_$1.txt" > "$RAW/gate_post_$1.txt" 2>&1 || true; }

push_model() {
  dpush "$1" "$DEVDIR/$3"
  DEV_SHA=$(adb -s "$SER" shell "sha256sum $DEVDIR/$3" | awk '{print $1}')
  printf 'host=%s\ndevice=%s\n' "$2" "$DEV_SHA" | tee "$RAW/sha_$3.txt"
  [ "$DEV_SHA" = "$2" ]
}

run_ppl_htp() {
  tag=$1; mdl=$2
  if over; then note "SKIP_$tag over"; return 0; fi
  gate_pre "$tag" || return 0
  # -v log is filtered ON DEVICE to the witness lines; the full stream is discarded there
  # (device-space safe). No --line-buffered: toybox grep rejects the GNU flag; a completing
  # run closes the pipe so grep flushes everything (incl. the trailing EXIT=) at exit.
  CMD="export GGML_HEXAGON_VERBOSE=1 && ( ./bin/llama-perplexity -m $mdl -f wiki.test.raw --device $BDEV -ngl 99 $PPL_FLAGS; echo EXIT=\$? ) 2>&1 | grep -E '$KEEP' > $DEVDIR/ppl_$tag.dev.txt"
  adb -s "$SER" shell "cd $DEVDIR && $HTP_ENV && $CMD" > "$RAW/ppl_$tag.txt" 2>&1 || true
  echo $? > "$RAW/ppl_$tag.adb.exit"
  gate_post "$tag"
  adb -s "$SER" pull "$DEVDIR/ppl_$tag.dev.txt" "$RAW/ppl_$tag.dev.txt" > /dev/null 2>&1 || true
  cp "$RAW/ppl_$tag.dev.txt" "$RAW/ppl_$tag.txt" 2>/dev/null || true
  { grep -E 'Final estimate|EXIT=' "$RAW/ppl_$tag.txt"; echo "execute-op MUL_MAT: $(grep -c 'execute-op MUL_MAT[^_]' "$RAW/ppl_$tag.txt") MUL_MAT_ID: $(grep -c 'execute-op MUL_MAT_ID' "$RAW/ppl_$tag.txt")"; } | sed "s/^/$tag: /" | tee -a "$RAW/ppl_summary.txt"
  if crashed "$RAW/ppl_$tag.txt"; then note "CRASH_$tag (cell ends)"; exit 8; fi
}

if push_model "$CORPUS" "$CORPUS_SHA" wiki.test.raw; then
  if push_model "$SHIP" "$SHIP_SHA" ship.gguf; then run_ppl_htp ship_htp ship.gguf
  else note METHOD-VOID_SHIP_SHA; fi
  if over; then note "SKIP_olmoe over"
  elif push_model "$OLMOE" "$OLMOE_SHA" olmoe.gguf; then run_ppl_htp olmoe_htp olmoe.gguf
  else note METHOD-VOID_OLMOE_SHA; fi
else note "METHOD-VOID_CORPUS_SHA (all arms)"; fi

note "DONE"
echo "DONE elapsed=$(elapsed)" | tee "$RAW/done.txt"
