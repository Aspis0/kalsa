#!/bin/bash
# Cell #53 driver — HDK8550 (Snapdragon 8 Gen 2 / Adreno 740), OpenCL picks A/B.
# Derived from cell #52 rev7: adbT perl-alarm caps, T4 launch pattern,
# re-entrant arms, bare-hex taskset, no llama-cli probe, thermal gates.
# Run on the Mac AFTER connect.sh has the 6037 tunnel up (connect.sh execs this).
# Usage: ./d_run.sh <JOB_TAG>
set -u
JOB="${1:?usage: d_run.sh <job_tag>}"
DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8g3-oclpicks-54"
RAW="$DIR/raw"; mkdir -p "$RAW"
KIT_PICKS="$HOME/kalsa-qdc/opencl-picks-cell/picks-kit-53.tgz"
KIT_BASE="$HOME/kalsa-qdc/opencl-picks-cell/base-kit-53.tgz"
MODEL="$HOME/kalsa-qdc/models/LFM2.5-2.6B-Q4_K_M.gguf"
MODEL_SHA_FILE="$DIR/MODEL_SHA.txt"   # written by the orchestrator after download
MODEL_SHA=$(cat "$MODEL_SHA_FILE" 2>/dev/null | tr -d '\n ')
[ -n "$MODEL_SHA" ] || { echo "NO MODEL_SHA.txt — refuse to run unpinned"; exit 3; }
GATE="$HOME/kalsa-qdc/kexp-speed-cell/thermal_gate.sh"
D=/data/local/tmp/kalsa54
export ANDROID_ADB_SERVER_PORT=6037

log(){ echo "[$(date +%H:%M:%S)] $*"; }
adbT(){ local t="$1"; shift; perl -e 'alarm shift; exec @ARGV or exit 127' "$t" adb "$@"; }

SER=$(adbT 60 devices | awk 'NR>1 && $2=="device"{print $1; exit}')
[ -n "$SER" ] || { log "NO_DEVICE on 6037"; exit 2; }
log "device=$SER job=$JOB"

gate_or_abort(){
  local t=0
  while [ $t -lt 3 ]; do
    "$GATE" "$SER" "$RAW/therm_pre_$1_$JOB.txt" && return 0
    log "GATE_FAIL pre $1 (try $((t+1))/3) — wait 60s"; sleep 60; t=$((t+1))
  done
  log "GATE_ABORT $1"; return 7
}

# ---- recon ----------------------------------------------------------------
{
  echo "== getprop =="
  adbT 120 -s "$SER" shell "getprop ro.soc.model; getprop ro.soc.manufacturer; getprop ro.board.platform; getprop ro.build.fingerprint; getprop ro.product.model"
  echo "== cores =="
  adbT 120 -s "$SER" shell 'for c in /sys/devices/system/cpu/cpu[0-9]*; do echo "$c $(cat $c/cpufreq/cpuinfo_max_freq 2>/dev/null)"; done'
  echo "== nproc =="; adbT 60 -s "$SER" shell nproc
  echo "== opencl lib =="; adbT 60 -s "$SER" shell "ls /vendor/lib64/libOpenCL.so 2>&1 && echo OPENCL_LIB_PRESENT"
  echo "== mem =="; adbT 60 -s "$SER" shell "grep MemTotal /proc/meminfo"
  echo "== storage =="; adbT 60 -s "$SER" shell "df /data | tail -1"
} > "$RAW/recon_$JOB.txt" 2>&1
log "recon done"
grep -q OPENCL_LIB_PRESENT "$RAW/recon_$JOB.txt" || { log "NO_OPENCL_LIB — abort"; exit 5; }

CPU_MASK=$(grep '^/sys' "$RAW/recon_$JOB.txt" | sed 's|.*cpu/cpu||' | sort -k2,2rn -k1,1rn \
  | head -4 | awk '{m += 2^$1} END{printf "%x", m}')
NPROC=$(adbT 60 -s "$SER" shell nproc | tr -d '\r')
log "CPU_MASK=$CPU_MASK nproc=$NPROC"
case "$CPU_MASK" in [1-9a-f]*) : ;; *) log "BAD_MASK '$CPU_MASK'"; exit 4;; esac

# ---- push + verify --------------------------------------------------------
adbT 60 -s "$SER" shell "mkdir -p $D/picks $D/base" || { log "MKDIR_FAIL"; exit 5; }
PRE=$(adbT 300 -s "$SER" shell "cd $D && sha256sum model.gguf 2>/dev/null" | awk '{print $1}' | tr -d '\r')
if [ "$PRE" = "$MODEL_SHA" ] && adbT 60 -s "$SER" shell "test -x $D/picks/llama-bench && test -x $D/base/llama-bench && echo BINOK" | grep -q BINOK; then
  log "resume: kits+model already on device, skipping pushes"
else
  log "pushing kits"
  adbT 600 -s "$SER" push "$KIT_PICKS" "$D/picks/kit.tgz" >/dev/null || { log "PICKS_PUSH_FAIL"; exit 5; }
  adbT 600 -s "$SER" push "$KIT_BASE"  "$D/base/kit.tgz"  >/dev/null || { log "BASE_PUSH_FAIL"; exit 5; }
  adbT 120 -s "$SER" shell "cd $D/picks && tar xzf kit.tgz && chmod 755 llama-bench llama-cli test-backend-ops && cd $D/base && tar xzf kit.tgz && chmod 755 llama-bench test-backend-ops && cp $D/picks/libomp.so $D/base/libomp.so && echo EXTRACT_OK" | grep -q EXTRACT_OK \
    || { log "KIT_EXTRACT_FAIL"; exit 5; }
  adbT 120 -s "$SER" shell "cd $D/picks && sha256sum -c SHA256SUMS && echo PICKS_SHA_OK" > "$RAW/kit_verify_$JOB.txt" 2>&1
  adbT 120 -s "$SER" shell "cd $D/base && sha256sum -c SHA256SUMS && echo BASE_SHA_OK" >> "$RAW/kit_verify_$JOB.txt" 2>&1
  grep -q "PICKS_SHA_OK" "$RAW/kit_verify_$JOB.txt" || { log "PICKS_SHA_MISMATCH"; exit 5; }
  grep -q "BASE_SHA_OK"  "$RAW/kit_verify_$JOB.txt" || { log "BASE_SHA_MISMATCH"; exit 5; }
  log "pushing model (1.6 GB)"
  adbT 2400 -s "$SER" push "$MODEL" "$D/model.gguf" >/dev/null || { log "MODEL_PUSH_FAIL"; exit 5; }
  DS=$(adbT 300 -s "$SER" shell "cd $D && sha256sum model.gguf" | awk '{print $1}' | tr -d '\r')
  [ "$DS" = "$MODEL_SHA" ] || { log "MODEL_SHA_MISMATCH device=$DS"; exit 5; }
  log "push verified"
fi

run_arm(){ # $1=name $2=cap_seconds $3=kit_subdir $4=device command (relative to $D/$3)
  if grep -q "exit=0" "$RAW/$1_$JOB.out" 2>/dev/null; then log "skip $1 (already banked)"; return 0; fi
  gate_or_abort "$1" || return 7
  log "start $1 (cap ${2}s)"
  adbT 30 -s "$SER" shell "cd $D/$3 && rm -f $1.exit && echo CLEAN_OK" | grep -q CLEAN_OK \
    || { log "CLEAN_FAIL $1"; return 8; }
  adbT 30 -s "$SER" shell "nohup sh -c 'cd $D/$3; LD_LIBRARY_PATH=$D/$3 $4 > $D/$3/$1.out 2>&1; echo \$? > $D/$3/$1.exit' </dev/null >/dev/null 2>&1 & echo LAUNCH_OK" | grep -q LAUNCH_OK \
    || { log "LAUNCH_FAIL $1"; return 8; }
  local start=$(date +%s) E=""
  while :; do
    sleep 15
    E=$(adbT 60 -s "$SER" shell "cat $D/$3/$1.exit 2>/dev/null" | tr -d '\r\n ')
    [ -n "$E" ] && break
    if [ $(( $(date +%s) - start )) -gt "$2" ]; then
      log "CAP_HIT $1 — killing"
      adbT 60 -s "$SER" shell "pkill -f 'llama-benc[h]|test-backend-op[s]'" || true
      E=TIMEOUT; break
    fi
  done
  "$GATE" "$SER" "$RAW/therm_post_$1_$JOB.txt" || true
  if adbT 300 -s "$SER" pull "$D/$3/$1.out" "$RAW/$1_$JOB.out" >/dev/null; then
    echo "nproc=$NPROC cpu_mask=0x$CPU_MASK kit=$3 exit=${E:-NONE}" >> "$RAW/$1_$JOB.out"
  else
    log "PULL_FAIL $1"; echo "PULL_FAIL exit=${E:-NONE}" > "$RAW/$1_$JOB.MISSING"
  fi
  log "done $1 exit=${E:-NONE}"
  [ "$E" = "0" ] || return 9
  return 0
}

ABORT=0
ck(){ rc=$?; [ $rc -eq 7 ] || [ $rc -eq 8 ] && ABORT=1; }
# ---- A: correctness, base first then picks, per-op (non-zero = RESULT) ----
if [ $ABORT -eq 0 ]; then run_arm tbo_base_mm    1200 base  "./test-backend-ops test -b GPUOpenCL -o MUL_MAT";        ck; fi
if [ $ABORT -eq 0 ]; then run_arm tbo_picks_mm   1200 picks "./test-backend-ops test -b GPUOpenCL -o MUL_MAT";        ck; fi
if [ $ABORT -eq 0 ]; then run_arm tbo_base_mmid  1200 base  "./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID";     ck; fi
if [ $ABORT -eq 0 ]; then run_arm tbo_picks_mmid 1200 picks "./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID";     ck; fi
if [ $ABORT -eq 0 ]; then run_arm tbo_base_fa    1500 base  "./test-backend-ops test -b GPUOpenCL -o FLASH_ATTN_EXT"; ck; fi
if [ $ABORT -eq 0 ]; then run_arm tbo_picks_fa   1500 picks "./test-backend-ops test -b GPUOpenCL -o FLASH_ATTN_EXT"; ck; fi
# ---- B: q4_K_M bench A/B, interleaved order control -----------------------
BENCH="taskset $CPU_MASK ./llama-bench -m $D/model.gguf -t 4 -ngl 99 -fa 0 -p 512 -n 128 -r 3 -o md"
if [ $ABORT -eq 0 ]; then run_arm bench_base_1  1500 base  "$BENCH"; ck; fi
if [ $ABORT -eq 0 ]; then run_arm bench_picks_1 1500 picks "$BENCH"; ck; fi
if [ $ABORT -eq 0 ]; then run_arm bench_picks_2 1500 picks "$BENCH"; ck; fi
if [ $ABORT -eq 0 ]; then run_arm bench_base_2  1500 base  "$BENCH"; ck; fi

log "DONE (ABORT=$ABORT) — raw/ populated. Remember: End Session in the portal."
