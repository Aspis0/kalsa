#!/bin/bash
# Cell #60 driver — HDK8550 v73 mapping-budget discriminator.
# Usage: ./d_run.sh <job_tag>
set -u
JOB="${1:?usage: d_run.sh <job_tag>}"
DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8g2-npu-mmapbudget-60"
RAW="$DIR/raw"
mkdir -p "$RAW"
KIT="$HOME/kalsa-qdc/npu-v79-cell/npu-kit-59.tgz"
MODEL="$HOME/kalsa-qdc/models/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf"
MODEL_SHA="361e8d83f0820e50d0ed1a13b10586ed9f476d99dcaf6aafd14f07e11840b22b"
GATE="$HOME/kalsa-qdc/kexp-speed-cell/thermal_gate.sh"
D=/data/local/tmp/kalsa60
export ANDROID_ADB_SERVER_PORT=6037

log(){ echo "[$(date +%H:%M:%S)] $*"; }
# Mac-side hard cap for each adb call; SIGALRM returns 142.
adbT(){ local t="$1"; shift; perl -e 'alarm shift; exec @ARGV or exit 127' "$t" adb "$@"; }

SER=$(adbT 60 devices | awk 'NR>1 && $2=="device"{print $1; exit}')
[ -n "$SER" ] || { log "NO_DEVICE on 6037"; exit 2; }
log "device=$SER job=$JOB"

gate_or_abort(){
  local t=0
  while [ "$t" -lt 3 ]; do
    "$GATE" "$SER" "$RAW/therm_pre_$1_$JOB.txt" && return 0
    t=$((t + 1))
    log "GATE_FAIL pre $1 (try $t/3) — wait 60s"
    sleep 60
  done
  log "GATE_ABORT $1"
  return 7
}

LOCAL_SHA=$(sha256sum "$MODEL" 2>/dev/null | awk '{print $1}')
if [ "$LOCAL_SHA" != "$MODEL_SHA" ]; then
  log "METHOD-VOID model sha mismatch local=$LOCAL_SHA"
  exit 5
fi
if ! adbT 60 -s "$SER" shell "mkdir -p $D"; then
  log "MKDIR_FAIL"
  exit 5
fi

# Resume guard: model sha plus the extracted executable are both required.
PRE=$(adbT 300 -s "$SER" shell "cd $D && sha256sum olmoe.gguf 2>/dev/null" | awk '{print $1}' | tr -d '\r')
SKIP_PUSH=0
if [ "$PRE" = "$MODEL_SHA" ]; then
  if adbT 60 -s "$SER" shell "test -x $D/bin/llama-bench && echo BINOK" | grep -q BINOK; then
    SKIP_PUSH=1
  fi
fi
if [ "$SKIP_PUSH" -eq 1 ]; then
  log "resume: kit+model already on device, skipping pushes"
else
  log "pushing kit"
  if ! adbT 600 -s "$SER" push "$KIT" "$D/kit.tgz" >/dev/null; then
    log "KIT_PUSH_FAIL"
    exit 5
  fi
  if ! adbT 120 -s "$SER" shell "cd $D && tar xzf kit.tgz && chmod 755 bin/* && echo EXTRACT_OK" | grep -q EXTRACT_OK; then
    log "KIT_EXTRACT_FAIL"
    exit 5
  fi
  log "pushing model (3.9 GB — cap 3600s)"
  if ! adbT 3600 -s "$SER" push "$MODEL" "$D/olmoe.gguf" >/dev/null; then
    log "MODEL_PUSH_FAIL"
    exit 5
  fi
  DS=$(adbT 300 -s "$SER" shell "cd $D && sha256sum olmoe.gguf" | awk '{print $1}' | tr -d '\r')
  if [ "$DS" != "$MODEL_SHA" ]; then
    log "METHOD-VOID model sha mismatch device=$DS"
    exit 5
  fi
  adbT 120 -s "$SER" shell "cd $D && sha256sum -c SHA256SUMS" > "$RAW/kit_verify_$JOB.txt" 2>&1
  kit_rc=$?
  if grep -q FAILED "$RAW/kit_verify_$JOB.txt"; then
    log "KIT_SHA_MISMATCH"
    exit 5
  fi
  if [ "$kit_rc" -ne 0 ]; then
    log "KIT_SHA_CHECK_FAIL"
    exit 5
  fi
  log "push verified (model sha OK, kit shas OK)"
fi

if ! adbT 60 -s "$SER" shell "printf '0x1F' > $D/lib-fix/llama-bench.farf"; then
  log "FARF_CREATE_FAIL — continuing"
else
  log "FARF_READY"
fi

run_arm(){ # $1=name $2=cap_seconds $3=device command $4=ENV $5=expected_exps
  if [ -f "$RAW/$1_$JOB.out" ] && ! grep -q 'PULL_FAIL' "$RAW/$1_$JOB.out" 2>/dev/null && grep -q '^proof .* exit=0$' "$RAW/$1_$JOB.out" 2>/dev/null; then
    log "skip $1 (already banked)"
    return 0
  fi
  gate_or_abort "$1" || return 7
  local before="$RAW/tomb_${1}_${JOB}.before"
  local after="$RAW/tomb_${1}_${JOB}.after"
  local tombdir="$RAW/tomb_${1}_${JOB}"
  local sigfile="$RAW/${1}_${JOB}.sig"
  local logfile="$RAW/logcat_${1}_${JOB}.txt"
  local out="$RAW/${1}_${JOB}.out"
  local err="$RAW/${1}_${JOB}.err"
  local e="" start retry_cmd sigline stdout_pulled=1
  mkdir -p "$tombdir"
  adbT 30 -s "$SER" logcat -c || true
  adbT 60 -s "$SER" shell "ls -1 /data/tombstones/tombstone_* 2>/dev/null || true" > "$before" || true
  tr -d '\r' < "$before" > "$before.tmp" && mv "$before.tmp" "$before"
  if ! adbT 30 -s "$SER" shell "cd $D && rm -f $1.out $1.err $1.exit && echo CLEAN_OK" | grep -q CLEAN_OK; then
    log "CLEAN_FAIL $1"
    return 8
  fi
  log "start $1 (cap ${2}s)"
  # T4 shape: only nohup sh -c is backgrounded; stdout=jsonl and stderr=-v.
  # Vendor dirs are required by the thin ELF's libcdsprpc dependency (audit 6e/f2b:61).
  local env_prefix="unset GGML_HEXAGON_HOSTBUF; $4"
  if ! adbT 30 -s "$SER" shell "nohup sh -c 'cd $D; $env_prefix LD_LIBRARY_PATH=$D/lib-fix:/vendor/lib64:/system/vendor/lib64:/system/lib64 ADSP_LIBRARY_PATH=$D/lib-fix CDSP_LIBRARY_PATH=$D/lib-fix GGML_HEXAGON_NDEV=1 GGML_HEXAGON_VERBOSE=1 $3 > $D/$1.out 2> $D/$1.err; echo \$? > $D/$1.exit' </dev/null >/dev/null 2>&1 & echo LAUNCH_OK" | grep -q LAUNCH_OK; then
    log "LAUNCH_FAIL $1"
    return 8
  fi
  start=$(date +%s)
  while :; do
    sleep 15
    e=$(adbT 60 -s "$SER" shell "cat $D/$1.exit 2>/dev/null" | tr -d '\r\n ')
    [ -n "$e" ] && break
    if [ $(( $(date +%s) - start )) -gt "$2" ]; then
      log "CAP_HIT $1 — killing"
      adbT 60 -s "$SER" shell "pkill -f 'llama-benc[h]'" || true
      e=TIMEOUT
      break
    fi
  done

  "$GATE" "$SER" "$RAW/therm_post_$1_$JOB.txt" || true
  adbT 120 -s "$SER" logcat -d -b main,system,crash > "$logfile" 2>&1 || true
  adbT 60 -s "$SER" shell "ls -1 /data/tombstones/tombstone_* 2>/dev/null || true" > "$after" || true
  tr -d '\r' < "$after" > "$after.tmp" && mv "$after.tmp" "$after"
  comm -13 <(sort "$before") <(sort "$after") | while IFS= read -r tomb; do
    [ -n "$tomb" ] || continue
    adbT 300 -s "$SER" pull "$tomb" "$tombdir/" >/dev/null 2>&1 || log "TOMBSTONE_PULL_FAIL $1 $tomb"
  done
  if ! adbT 300 -s "$SER" pull "$D/$1.out" "$out" >/dev/null 2>&1; then
    echo "PULL_FAIL stdout rc=${e:-NONE}" > "$out"
    stdout_pulled=0
  fi
  if ! adbT 300 -s "$SER" pull "$D/$1.err" "$err" >/dev/null 2>&1; then
    echo "PULL_FAIL stderr exit=${e:-NONE}" > "$err"
  fi
  sigline=$(grep -Eai 'dspqueue|fastrpc|qurt_exit|0x2e' "$err" "$logfile" "$tombdir"/* 2>/dev/null | head -1 | tr '\r\n' ' ')
  if [ -n "$sigline" ]; then
    printf 'SIGNATURE=%s expected_exps=%s\n' "$sigline" "$5" > "$sigfile"
  else
    echo "SIGNATURE=none expected_exps=$5" > "$sigfile"
  fi
  n_htp=$(grep "execute-op" "$err" 2>/dev/null | grep "HTP0" 2>/dev/null | wc -l | tr -d ' ')
  n_mul_mat_id=$(grep "execute-op" "$err" 2>/dev/null | grep "MUL_MAT_ID" 2>/dev/null | wc -l | tr -d ' ')
  n_exps_htp0=$(grep "HTP0 execute-op MUL_MAT_ID" "$err" 2>/dev/null | grep -E "ffn_gate_exps|ffn_up_exps|ffn_down_exps" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$stdout_pulled" -eq 1 ]; then
    echo "proof n_htp=$n_htp n_mul_mat_id=$n_mul_mat_id n_exps_htp0=$n_exps_htp0 exit=${e:-NONE}" >> "$out"
  else
    echo "proof n_htp=$n_htp n_mul_mat_id=$n_mul_mat_id n_exps_htp0=$n_exps_htp0 rc=${e:-NONE} pulled=fail" >> "$out"
  fi

  # A3/A4 only: a non-zero -n 0 run with no fatal signature and no jsonl gets one -n 1 retry.
  case "$3" in
    *" -n 0 "*)
      case "$e" in
        ''|0|*[!0-9]*) ;;
        *)
          if ! grep -Eiq 'dspqueue|fastrpc|qurt_exit|0x2e' "$sigfile" && ! grep -q avg_ts "$out"; then
            retry_cmd=$(printf '%s\n' "$3" | sed 's/-n 0/-n 1/')
            log "FALLBACK $1: -n 0 non-zero with empty jsonl; retrying as ${1}_n1"
            run_arm "${1}_n1" "$2" "$retry_cmd" "$4" "$5"
            return $?
          fi
        ;;
      esac
    ;;
  esac
  [ "$e" = "0" ] && return 0
  return 9
}

# Historical f2b_driver.sh:64-65 used exactly:
#   export GGML_HEXAGON_NDEV=1
#   export GGML_HEXAGON_VERBOSE=1
# Keep that spelling; the audit confirmed it, while VERBOSE/GGML_HTP_* are wrong.
T="./bin/llama-bench -m olmoe.gguf -p 16 -n 8 -r 1 --no-warmup -dev HTP0 -v -o jsonl --mmap 0 -fa on --ubatch-size 1024"
ABORT=0
B1_OK=0

run_arm ngl8_mbuf1g   900  "$T -ngl 8"   "" 24; rc=$?
case $rc in 7|8) ABORT=1;; 0) B1_OK=1;; esac
run_arm ngl99_mbuf512 900  "$T -ngl 99"  "GGML_HEXAGON_MBUF=512" 48; rc=$?
case $rc in 7|8) ABORT=1;; esac
run_arm ngl99_vmem1800 900 "$T -ngl 99"  "GGML_HEXAGON_VMEM=1800" 48; rc=$?
case $rc in 7|8) ABORT=1;; esac
run_arm ngl99_vmem0   900  "$T -ngl 99"  "GGML_HEXAGON_VMEM=0" 48; rc=$?
case $rc in 7|8) ABORT=1;; esac
if [ "$ABORT" -eq 0 ]; then
  run_arm ngl12_mbuf1g  900  "$T -ngl 12"  "" 36; rc=$?
  case $rc in 7|8) ABORT=1;; esac
fi
if [ "$B1_OK" -eq 1 ] && [ "$ABORT" -eq 0 ]; then
  run_arm ngl8_tg128    1200 "${T/-p 16 -n 8/-p 0 -n 128} -ngl 8" "" 24; rc=$?
  case $rc in 7|8) ABORT=1;; esac
fi

log "DONE (ABORT=$ABORT) — raw/ populated. Remember: End Session in the portal."
