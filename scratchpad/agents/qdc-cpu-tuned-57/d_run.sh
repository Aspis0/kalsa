#!/bin/bash
# Cell #52 driver — QRD7675 (Snapdragon 7+ Gen 3), CPU/GPU bench of ship config.
# Run on the Mac AFTER connect.sh has the 6037 tunnel up (connect.sh execs this).
# Usage: ./d_run.sh <JOB_TAG>
# Rev 2 after AUDIT-PRERUN.md: F1-F9,F11 addressed. No device-side `timeout`
# (toybox lacks it) and no Mac `timeout` either (verified absent) — caps are
# Mac-side polls; every adb call goes through a perl-alarm wrapper.
set -u
JOB="${1:?usage: d_run.sh <job_tag>}"
DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-cpu-tuned-57"
RAW="$DIR/raw"; mkdir -p "$RAW"
KIT="$HOME/kalsa-qdc/cpu-tuned-kit-57.tgz"
MODEL="$HOME/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf"
MODEL_SHA="a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03"
GATE="$HOME/kalsa-qdc/kexp-speed-cell/thermal_gate.sh"
D=/data/local/tmp/kalsa57
export ANDROID_ADB_SERVER_PORT=6037

log(){ echo "[$(date +%H:%M:%S)] $*"; }
# Mac-side hard cap on any adb invocation (F5). SIGALRM -> exit 142.
adbT(){ local t="$1"; shift; perl -e 'alarm shift; exec @ARGV or exit 127' "$t" adb "$@"; }

SER=$(adbT 60 devices | awk 'NR>1 && $2=="device"{print $1; exit}')
[ -n "$SER" ] || { log "NO_DEVICE on 6037"; exit 2; }
log "device=$SER job=$JOB"

gate_or_abort(){ # $1=arm name; rc 0 pass, 7 abort
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
# F7: OpenCL vendor lib is a hard prerequisite for R1/R3
# no OpenCL prerequisite: this kit is CPU-only by construction

# CPU_MASK = 4 highest-max-freq cores, 0x-prefixed (F8)
# bare hex: THIS device's toybox taskset rejects the 0x prefix (probed live:
# "taskset: bad mask '0xf0'"); records below add the 0x for readability only.
CPU_MASK=$(grep '^/sys' "$RAW/recon_$JOB.txt" | sed 's|.*cpu/cpu||' | sort -k2,2rn -k1,1rn \
  | head -4 | awk '{m += 2^$1} END{printf "%x", m}')
NPROC=$(adbT 60 -s "$SER" shell nproc | tr -d '\r')
log "CPU_MASK=$CPU_MASK nproc=$NPROC"
case "$CPU_MASK" in [1-9a-f]*) : ;; *) log "BAD_MASK '$CPU_MASK'"; exit 4;; esac

# ---- push + verify (each step guarded: F6) --------------------------------
adbT 60 -s "$SER" shell "mkdir -p $D" || { log "MKDIR_FAIL"; exit 5; }
# resume guard: skip pushes if the model already verifies on device
PRE=$(adbT 300 -s "$SER" shell "cd $D && sha256sum lfm26.gguf 2>/dev/null" | awk '{print $1}' | tr -d '\r')
if [ "$PRE" = "$MODEL_SHA" ] && adbT 60 -s "$SER" shell "test -x $D/llama-bench && echo BINOK" | grep -q BINOK; then
  log "resume: kit+model already on device, skipping pushes"
  SKIP_PUSH=1
else
  SKIP_PUSH=0
fi
if [ "$SKIP_PUSH" = "0" ]; then
  log "pushing kit"
  adbT 600 -s "$SER" push "$KIT" "$D/kit.tgz" >/dev/null || { log "KIT_PUSH_FAIL"; exit 5; }
  adbT 120 -s "$SER" shell "cd $D && tar xzf kit.tgz && chmod 755 llama-bench && echo EXTRACT_OK" | grep -q EXTRACT_OK \
    || { log "KIT_EXTRACT_FAIL"; exit 5; }
  log "pushing model (1.6 GB — several minutes)"
  adbT 2400 -s "$SER" push "$MODEL" "$D/lfm26.gguf" >/dev/null || { log "MODEL_PUSH_FAIL"; exit 5; }
  DS=$(adbT 300 -s "$SER" shell "cd $D && sha256sum lfm26.gguf" | awk '{print $1}' | tr -d '\r')
  [ "$DS" = "$MODEL_SHA" ] || { log "MODEL_SHA_MISMATCH device=$DS"; exit 5; }
  adbT 120 -s "$SER" shell "cd $D && sha256sum -c SHA256SUMS" > "$RAW/kit_verify_$JOB.txt" 2>&1
  grep -q "FAILED" "$RAW/kit_verify_$JOB.txt" && { log "KIT_SHA_MISMATCH"; exit 5; }
  log "push verified (model sha OK, kit shas OK)"
fi

run_arm(){ # $1=name $2=cap_seconds $3=device command (relative to $D)
  if grep -q "exit=0" "$RAW/$1_$JOB.out" 2>/dev/null; then log "skip $1 (already banked)"; return 0; fi
  gate_or_abort "$1" || return 7
  log "start $1 (cap ${2}s)"
  adbT 30 -s "$SER" shell "cd $D && rm -f $1.exit && echo CLEAN_OK" | grep -q CLEAN_OK \
    || { log "CLEAN_FAIL $1"; return 8; }
  # T4 pattern (probed live 3/09): nohup sh -c as the ONLY backgrounded word,
  # no cd-prefix in the bg list, else the bg subshell holds the adb socket.
  adbT 30 -s "$SER" shell "nohup sh -c 'cd $D; LD_LIBRARY_PATH=$D $3 > $D/$1.out 2>&1; echo \$? > $D/$1.exit' </dev/null >/dev/null 2>&1 & echo LAUNCH_OK" | grep -q LAUNCH_OK \
    || { log "LAUNCH_FAIL $1"; return 8; }
  local start=$(date +%s) E=""
  while :; do
    sleep 15
    E=$(adbT 60 -s "$SER" shell "cat $D/$1.exit 2>/dev/null" | tr -d '\r\n ')
    [ -n "$E" ] && break
    if [ $(( $(date +%s) - start )) -gt "$2" ]; then
      log "CAP_HIT $1 — killing"
      adbT 60 -s "$SER" shell "pkill -f 'llama-benc[h]|test-backend-op[s]|llama-cl[i]'" || true
      E=TIMEOUT; break
    fi
  done
  "$GATE" "$SER" "$RAW/therm_post_$1_$JOB.txt" || true
  if adbT 300 -s "$SER" pull "$D/$1.out" "$RAW/$1_$JOB.out" >/dev/null; then
    echo "nproc=$NPROC cpu_mask=0x$CPU_MASK exit=${E:-NONE}" >> "$RAW/$1_$JOB.out"
  else
    log "PULL_FAIL $1"; echo "PULL_FAIL exit=${E:-NONE}" > "$RAW/$1_$JOB.MISSING"
  fi
  log "done $1 exit=${E:-NONE}"
  [ "$E" = "0" ] || return 9
  return 0
}

ABORT=0
run_arm bench_cpu_tuned 1500 "taskset $CPU_MASK ./llama-bench -m lfm26.gguf -t 4 -p 512 -n 128 -r 3 -o md"
log "DONE (ABORT=$ABORT) — raw/ populated. Remember: End Session in the portal."
