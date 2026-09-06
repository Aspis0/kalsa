#!/usr/bin/env bash
set -u

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    [ "$#" -ge 3 ] && [ "$#" -le 4 ] || { echo "usage: $0 <job_id> <baseline_tgz> <candidate_tgz> [deadline_min=60]" >&2; exit 2; }
    JOB="$1"; BASELINE="$2"; CANDIDATE="$3"; DEADLINE_MIN="${4:-60}"
    case "$DEADLINE_MIN" in ''|*[!0-9]*) echo "bad deadline_min: $DEADLINE_MIN" >&2; exit 2 ;; esac
    DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-750-mulmat-view"
    RAW="$DIR/raw/$JOB"; REMOTE=/data/local/tmp/k750
    MODEL="$HOME/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf"
    MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
    MODEL_DEV="$REMOTE/lfm26.gguf"; GATE="$HOME/kalsa-qdc/kexp-speed-cell/thermal_gate.sh"
    export ANDROID_ADB_SERVER_PORT="${ANDROID_ADB_SERVER_PORT:-6037}"
    mkdir -p "$RAW"
    START=$(date +%s); DEADLINE_AT=$((START + DEADLINE_MIN * 60)); END_REASON=complete
    trap 'rc=$?; log "END reason=$END_REASON rc=$rc"; exit "$rc"' EXIT
fi

log() { echo "[$(date +%H:%M:%S)] $*"; }
adbT() { local t="$1"; shift; perl -e 'alarm shift; exec @ARGV or exit 127' "$t" adb "$@"; }

deadline_check() {
    if [ "$(date +%s)" -ge "$DEADLINE_AT" ]; then END_REASON=deadline; exit 124; fi
}

thermal_gate() {
    local sha="$1" step="$2" phase="$3"
    local out="$RAW/${sha}_${step}_thermal.txt"
    local tmp rc tries=0
    while [ "$tries" -lt 3 ]; do
        tmp="/tmp/${sha}_${step}_${phase}_thermal.$$.$tries"
        "$GATE" "$SER" "$tmp" >> "$out" 2>&1; rc=$?
        printf 'phase=%s attempt=%s rc=%s\n' "$phase" "$((tries + 1))" "$rc" >> "$out"
        cat "$tmp" >> "$out" 2>/dev/null || :; rm -f "$tmp"
        [ "$rc" -eq 0 ] && return 0
        [ "$phase" = post ] && return "$rc"
        log "GATE_FAIL pre $sha/$step (try $((tries + 1))/3) — wait 60s"
        sleep 60; tries=$((tries + 1))
    done
    log "GATE_ABORT $sha/$step"; return 7
}

kit_sha() {
    local full
    full=$(tar -xOf "$1" GIT_SHA 2>/dev/null | tr -d '[:space:]') || return 1
    [[ "$full" =~ ^[0-9a-fA-F]{40}$ ]] || return 1
    printf '%s\n' "${full:0:7}"
}

count_tbo() {
    local file="$1" out="$2" pass fail
    local clean="$out.clean.$$"
    sed $'s/\033\\[[0-9;]*m//g' "$file" | tr -d '\r' > "$clean"
    pass=$(grep -E '^  MUL_MAT\(.*: OK[[:space:]]*$' "$clean" | wc -l | tr -d ' ')
    fail=$(grep -E '^  MUL_MAT\(.*: FAIL[[:space:]]*$' "$clean" | wc -l | tr -d ' ')
    awk -v total_pass="$pass" -v total_fail="$fail" '
    $0 ~ /^  MUL_MAT\(/ && ($0 ~ /: OK[[:space:]]*$/ || $0 ~ /: FAIL[[:space:]]*$/) {
      k=kv=m=n=-1; fields_n=split($0, fields, ",")
      for (i=1; i<=fields_n; i++) { if (fields[i] ~ /^m=/) {sub(/^m=/,"",fields[i]); m=fields[i]+0}
        if (fields[i] ~ /^k=/) {sub(/^k=/,"",fields[i]); k=fields[i]+0}
        if (fields[i] ~ /^k_v=/) {sub(/^k_v=/,"",fields[i]); kv=fields[i]+0}
        if (fields[i] ~ /^n=/) {sub(/^n=/,"",fields[i]); n=fields[i]+0} }
      good=($0 ~ /: OK[[:space:]]*$/); bad=($0 ~ /: FAIL[[:space:]]*$/)
      if (kv>k) { if (kv==2112 && m==128 && n==1) {if(good) fp++; if(bad) ff++}
        else {if(good) op++; if(bad) of++} }
    } END {printf "pass=%d\nfail=%d\nfamily_pass=%d\nfamily_fail=%d\nother_pass=%d\nother_fail=%d\n",total_pass,total_fail,fp+0,ff+0,op+0,of+0}' "$clean" > "$out"
    grep -E '^  MUL_MAT\(.*: FAIL[[:space:]]*$' "$clean" > "$out.fail_cases" || :
    rm -f "$clean"
}

summarize() {
    local sha="$1" step="$2" op="$3" rc="$4" seconds="$5"
    local out="$RAW/${sha}_${step}.out"
    local clean="$out.clean.$$" pass fail
    sed $'s/\033\\[[0-9;]*m//g' "$out" | tr -d '\r' > "$clean"
    if [ "$op" = bench ]; then
        pass=$(awk -F'|' '/pp512/ {v=$(NF-1); sub(/[[:space:]].*/,"",v); gsub(/[[:space:]]/,"",v); print v; exit}' "$clean")
        fail=$(awk -F'|' '/tg128/ {v=$(NF-1); sub(/[[:space:]].*/,"",v); gsub(/[[:space:]]/,"",v); print v; exit}' "$clean")
        [ -n "$pass" ] || pass=NA; [ -n "$fail" ] || fail=NA; LAST_FAIL=0
    elif [ "$op" = MUL_MAT ]; then
        local counts="$out.counts.$$"
        count_tbo "$out" "$counts"
        pass=$(awk -F= '$1=="pass"{print $2}' "$counts")
        fail=$(awk -F= '$1=="fail"{print $2}' "$counts")
        cp "$counts.fail_cases" "$RAW/${sha}_tbo_mm_fail_cases.txt"
        cp "$counts" "$RAW/${sha}_tbo_mm_view_counts.txt"
        rm -f "$counts" "$counts.fail_cases"
        LAST_FAIL="$fail"
    else
        pass=$(grep -E "^  ${op}\\(.*OK[[:space:]]*$" "$clean" | wc -l | tr -d ' ')
        fail=$(grep -E "^  ${op}\\(.*: FAIL[[:space:]]*$" "$clean" | wc -l | tr -d ' ')
        LAST_FAIL="$fail"
    fi
    printf '%s %s %s %s %s %s %s\n' "$KIT_LABEL" "$sha" "$step" "$pass" "$fail" "$rc" "$seconds" >> "$RAW/summary.tsv"
    rm -f "$clean"
}

run_device_step() {
    local sha="$1" step="$2" cap="$3" cmd="$4" op="$5"
    local dir="$REMOTE/$sha"
    local out="$RAW/${sha}_${step}.out" e="" start seconds
    LAST_FAIL=0; : > "$RAW/${sha}_${step}_thermal.txt"; deadline_check
    thermal_gate "$sha" "$step" pre || { END_REASON=thermal; exit 7; }
    adbT 30 -s "$SER" shell "rm -f $dir/$step.out $dir/$step.exit && echo CLEAN_OK" | grep -q CLEAN_OK || { log "CLEAN_FAIL $sha/$step"; return 1; }
    adbT 30 -s "$SER" shell "nohup sh -c 'cd $dir/bin; LD_LIBRARY_PATH=$dir/lib $cmd > $dir/$step.out 2>&1; echo \$? > $dir/$step.exit' </dev/null >/dev/null 2>&1 & echo LAUNCH_OK" | grep -q LAUNCH_OK || { log "LAUNCH_FAIL $sha/$step"; return 1; }
    start=$(date +%s); log "start $sha/$step cap=${cap}s"
    while :; do
        sleep 15; e=$(adbT 60 -s "$SER" shell "cat $dir/$step.exit 2>/dev/null" | tr -d '\r\n ')
        [ -n "$e" ] && break
        if [ $(( $(date +%s) - start )) -ge "$cap" ]; then
            log "CAP_HIT $sha/$step — killing"; adbT 60 -s "$SER" shell "pkill -f 'llama-benc[h]|test-backend-op[s]'" || true; e=TIMEOUT; break
        fi
    done
    thermal_gate "$sha" "$step" post || true
    seconds=$(( $(date +%s) - start ))
    if adbT 300 -s "$SER" pull "$dir/$step.out" "$out" >/dev/null; then summarize "$sha" "$step" "$op" "$e" "$seconds"; else log "PULL_FAIL $sha/$step exit=$e"; fi
    log "done $sha/$step exit=$e"
}

verify_kit() {
    local kit="$1" sha="$2" rc
    local dir="$REMOTE/$sha" verify="$RAW/${sha}_kit_verify.txt"
    adbT 600 -s "$SER" push "$kit" "$dir.tgz" >/dev/null || return 1
    adbT 120 -s "$SER" shell "mkdir -p $dir && rm -rf $dir/bin $dir/lib && tar xzf $dir.tgz -C $dir && chmod 755 $dir/bin/llama-bench $dir/bin/test-backend-ops && echo EXTRACT_OK" | grep -q EXTRACT_OK || return 1
    adbT 120 -s "$SER" shell "cd $dir && sha256sum -c SHA256SUMS" > "$verify" 2>&1; rc=$?
    if grep -Eq 'FAILED|did NOT match' "$verify"; then log "METHOD-VOID kit=$sha reason=kit_sha_mismatch"; return 10; fi
    [ "$rc" -eq 0 ] || return 1
}

run_kit() {
    local label="$1" kit="$2" sha="$3" rc
    KIT_LABEL="$label"; verify_kit "$kit" "$sha"; rc=$?
    [ "$rc" -eq 10 ] && return 0
    [ "$rc" -eq 0 ] || return 1
    : > "$RAW/${sha}_tbo_mm_fail_cases.txt"
    run_device_step "$sha" tbo_mm 1200 './test-backend-ops test -b GPUOpenCL -o MUL_MAT' MUL_MAT
    if [ "$label" = baseline ] && [ "$LAST_FAIL" -ne 20 ]; then log "BASELINE_GATE fail_count=$LAST_FAIL expected=20"; END_REASON=baseline_gate; exit 6; fi
    run_device_step "$sha" tbo_mmid 1200 './test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID' MUL_MAT_ID
    run_device_step "$sha" tbo_fa 1500 './test-backend-ops test -b GPUOpenCL -o FLASH_ATTN_EXT' FLASH_ATTN_EXT
    run_device_step "$sha" bench_gpu 1500 "./llama-bench -m $MODEL_DEV -t 4 -ngl 99 -fa 0 -p 512 -n 128 -r 3 -o md" bench
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
SER=$(adbT 60 devices | awk 'NR>1 && $2=="device"{print $1; exit}')
[ -n "$SER" ] || { log "NO_DEVICE on 6037"; END_REASON=no_device; exit 2; }
log "device=$SER job=$JOB"
{
    echo '== getprop =='; adbT 120 -s "$SER" shell 'getprop ro.soc.model; getprop ro.board.platform; getprop ro.build.fingerprint; getprop ro.product.model'
    echo '== cores =='; adbT 120 -s "$SER" shell 'for c in /sys/devices/system/cpu/cpu[0-9]*; do echo "$c $(cat $c/cpufreq/cpuinfo_max_freq 2>/dev/null)"; done'
    echo '== mem =='; adbT 60 -s "$SER" shell 'grep MemTotal /proc/meminfo'
    echo '== opencl =='; adbT 60 -s "$SER" shell 'ls /vendor/lib64/libOpenCL.so 2>&1 && echo OPENCL_LIB_PRESENT'
    echo '== storage =='; adbT 60 -s "$SER" shell 'df /data | tail -1'
} > "$RAW/recon.txt" 2>&1
grep -q OPENCL_LIB_PRESENT "$RAW/recon.txt" || { log "NO_OPENCL_LIB"; END_REASON=no_opencl; exit 5; }
adbT 60 -s "$SER" shell "mkdir -p $REMOTE" || { END_REASON=mkdir; exit 5; }
got=$(adbT 300 -s "$SER" shell "sha256sum $MODEL_DEV 2>/dev/null" | awk '{print $1}' | tr -d '\r')
if [ "$got" != "$MODEL_SHA" ]; then
    log "pushing model"; adbT 2400 -s "$SER" push "$MODEL" "$MODEL_DEV" >/dev/null || { END_REASON=model_push; exit 5; }
    got=$(adbT 300 -s "$SER" shell "sha256sum $MODEL_DEV 2>/dev/null" | awk '{print $1}' | tr -d '\r')
fi
[ "$got" = "$MODEL_SHA" ] || { log "MODEL_SHA_MISMATCH device=$got"; END_REASON=model_sha; exit 5; }
: > "$RAW/summary.tsv"
for index in 0 1; do
    KIT_LABEL="baseline"; KIT="$BASELINE"; [ "$index" -eq 1 ] && KIT_LABEL=candidate KIT="$CANDIDATE"
    SHA7=$(kit_sha "$KIT") || { log "METHOD-VOID kit=$KIT_LABEL reason=invalid_GIT_SHA"; continue; }
    run_kit "$KIT_LABEL" "$KIT" "$SHA7" || { END_REASON=kit_setup; exit 5; }
done
log "DONE"
fi
