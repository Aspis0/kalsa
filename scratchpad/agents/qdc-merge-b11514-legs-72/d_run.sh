#!/bin/bash
# Cell #72 driver - one copy, three legs with the upstream-b11514 merge bench (engine 904d38fad): CORRECTNESS on QDC
# legs on an unmeasured SoC (QDC devices are always powered: speeds indicative only, no heat). Mirrors the Xiaomi 14
# (SM8650) run of 2026-10-08. Run on the Mac AFTER connect.sh has the 6037 tunnel up (connect.sh execs this).
# Usage: ./d_run.sh <JOB_TAG>. No `timeout` on the Mac or the device: Mac-side perl alarms + polls.
set -u
JOB="${1:?usage: d_run.sh <job_tag>}"
DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-merge-b11514-legs-72"
RAW="$DIR/raw"; mkdir -p "$RAW"
KIT="$HOME/kalsa-qdc/merge-kit-904d38fad.tgz"
MODEL="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-newapk/raw/host-materials/LFM2.5-2.6B-QAD-Q4_0.gguf"
MODEL_SHA="a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03"
D=/data/local/tmp/kalsa72
export ANDROID_ADB_SERVER_PORT=6037
log(){ echo "[$(date +%H:%M:%S)] $*"; }
adbT(){ local t="$1"; shift; perl -e 'alarm shift; exec @ARGV or exit 127' "$t" adb "$@"; }

SER=$(adbT 60 devices | awk 'NR>1 && $2=="device"{print $1; exit}')
[ -n "$SER" ] || { log "NO_DEVICE on 6037"; exit 2; }
log "device=$SER job=$JOB"
adbT 120 -s "$SER" shell "getprop ro.soc.model; getprop ro.product.model; getprop ro.build.fingerprint; ls /vendor/lib64/libOpenCL.so; ls /vendor/lib64/libcdsprpc.so; grep MemTotal /proc/meminfo; df /data | tail -1" > "$RAW/recon_$JOB.txt" 2>&1
log "recon: $(head -2 "$RAW/recon_$JOB.txt" | tr '\n' ' ')"
grep -q libOpenCL.so "$RAW/recon_$JOB.txt" || { log "NO_OPENCL_LIB - abort"; exit 5; }

adbT 60 -s "$SER" shell "mkdir -p $D" || { log "MKDIR_FAIL"; exit 5; }
adbT 600 -s "$SER" push "$KIT" "$D/kit.tgz" >/dev/null || { log "KIT_PUSH_FAIL"; exit 5; }
adbT 120 -s "$SER" shell "cd $D && tar xzf kit.tgz && chmod 755 governor-bench && sha256sum -c SHA256SUMS" > "$RAW/kit_verify_$JOB.txt" 2>&1
grep -q FAILED "$RAW/kit_verify_$JOB.txt" && { log "KIT_SHA_MISMATCH"; exit 5; }
PRE=$(adbT 300 -s "$SER" shell "sha256sum $D/lfm26.gguf 2>/dev/null" | awk '{print $1}' | tr -d '\r')
if [ "$PRE" != "$MODEL_SHA" ]; then
  log "pushing model (1.6 GB)"
  adbT 2400 -s "$SER" push "$MODEL" "$D/lfm26.gguf" >/dev/null || { log "MODEL_PUSH_FAIL"; exit 5; }
  PRE=$(adbT 300 -s "$SER" shell "sha256sum $D/lfm26.gguf" | awk '{print $1}' | tr -d '\r')
  [ "$PRE" = "$MODEL_SHA" ] || { log "MODEL_SHA_MISMATCH $PRE"; exit 5; }
fi
log "kit + model verified"

adbT 30 -s "$SER" shell "nohup sh -c 'sh $D/run-legs.sh > $D/legs_session.out 2>&1' </dev/null >/dev/null 2>&1 & echo LAUNCH_OK" | grep -q LAUNCH_OK || { log "LAUNCH_FAIL"; exit 8; }
start=$(date +%s)
while :; do
  sleep 30
  adbT 60 -s "$SER" shell "grep -q '^== legs end' $D/legs_report.txt && echo DONE" | grep -q DONE && break
  if [ $(( $(date +%s) - start )) -gt 3600 ]; then log "CAP_HIT - killing"; adbT 60 -s "$SER" shell "pkill -f governor-benc[h]; touch $D/watchdog.stop" || true; break; fi
done
adbT 300 -s "$SER" pull "$D/legs_report.txt" "$RAW/legs_report_$JOB.txt" >/dev/null || log "PULL_FAIL report"
for n in G L L-npu L-gpu L-gpu2 L-cpu A-gpu A-j1 V-gpu; do adbT 300 -s "$SER" pull "$D/$n.log" "$RAW/${n}_$JOB.log" >/dev/null 2>&1 || log "PULL_FAIL $n"; done
log "DONE - raw/ populated ($(grep -c '^## ' "$RAW/legs_report_$JOB.txt" 2>/dev/null) arms). Remember: End Session in the portal."
