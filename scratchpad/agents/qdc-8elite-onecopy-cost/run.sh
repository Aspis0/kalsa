#!/bin/bash
# Host driver for qdc-8elite-onecopy-cost (structure copied from qdc-8elite-hopping-heat). One step per
# invocation, so the operator reads each result before the next:
#   run.sh preflight | push | launch <deadline_epoch> | poll | pull
# adb talks ONLY to the QDC tunnel on port 6037 (never 5037: the local
# server owns the lab phones). Every step logs to raw/<step>.log with rc.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
RAW=$HERE/raw
D=/data/local/tmp/oc8
BLD=${OC_BUILD:-/Users/marco/Projects/kalsallama-onecopy/build-onecopy-v79b}
SUMS=$HERE/artifacts.sha256
MODEL=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
FIXTURE=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-htp-prefill-spike/raw/kld_english_fixture.txt
FIXTURE_SHA=bca6ac9fd2d398f73bd21b7910e279d12f79c9744dfa49294cb810e781c06728
export ANDROID_ADB_SERVER_PORT=6037
mkdir -p "$RAW"

# adbT <secs> <args...>: adb with a hard alarm (macOS has no `timeout`).
adbT() { local t="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$t" adb "$@"; }
rsha() { adbT 120 shell "sha256sum $1 2>/dev/null" | awk '{print $1}'; }
lsha() { shasum -a 256 "$1" | awk '{print $1}'; }

step_preflight() {
  adbT 20 devices -l
  adbT 20 shell 'id; getprop ro.soc.model; getprop ro.product.model; getprop ro.build.version.release; nproc; df -h /data | tail -1'
  adbT 30 shell 'dumpsys thermalservice | sed -n "/Current temperatures from HAL/,/Current cooling devices from HAL/p" | grep -i "mName=skin"; dumpsys thermalservice | grep -m1 "Thermal Status"'
  adbT 20 shell 'dumpsys battery | grep -E "level|temperature|powered|voltage"; dumpsys power | grep -E "mWakefulness=|mStayOn="'
  adbT 20 shell 'free -m 2>/dev/null | head -3; grep -E "MemTotal|MemAvailable" /proc/meminfo'
  adbT 20 shell 'ps -A | grep -E "llama|bench" || echo no_llama; which awk grep sleep kill env pkill setsid'
}

step_push() {
  [ -s "$SUMS" ] || { echo NO_ARTIFACT_SUMS; return 1; }
  local f want got
  for f in bin/llama-bench bin/llama-perplexity dsp/libggml-htp-v79.so; do
    want=$(grep " $f\$" "$SUMS" | awk '{print $1}')
    case $f in dsp/*) src=$BLD/ggml/src/ggml-hexagon/libggml-htp-v79.so ;; *) src=$BLD/$f ;; esac
    got=$(lsha "$src")
    [ -n "$want" ] && [ "$got" = "$want" ] || { echo "LOCAL_SHA_BAD $f"; return 1; }
  done
  [ "$(lsha "$MODEL")" = "$MODEL_SHA" ] || { echo MODEL_SHA_LOCAL_BAD; return 1; }
  [ "$(lsha "$FIXTURE")" = "$FIXTURE_SHA" ] || { echo FIXTURE_SHA_LOCAL_BAD; return 1; }
  adbT 30 shell "mkdir -p $D/out $D/bin $D/dsp && rm -f $D/out/*" || return 1
  if [ "$(rsha $D/ship.gguf)" != "$MODEL_SHA" ]; then
    echo MODEL_PUSH; adbT 900 push "$MODEL" $D/ship.gguf || return 1
  else echo MODEL_PRESENT; fi
  [ "$(rsha $D/ship.gguf)" = "$MODEL_SHA" ] || { echo MODEL_SHA_REMOTE_BAD; return 1; }
  adbT 120 push "$BLD/bin/llama-bench" "$BLD/bin/llama-perplexity" $D/bin/ || return 1
  adbT 120 push "$BLD/ggml/src/ggml-hexagon/libggml-htp-v79.so" $D/dsp/ || return 1
  adbT 30 shell "chmod 755 $D/bin/*" || return 1
  adbT 60 push "$FIXTURE" $D/fixture.txt || return 1
  adbT 60 push "$HERE/sess.sh" $D/sess.sh && adbT 60 push "$HERE/smp.sh" $D/smp.sh || return 1
  for f in bin/llama-bench bin/llama-perplexity dsp/libggml-htp-v79.so; do
    want=$(grep " $f\$" "$SUMS" | awk '{print $1}')
    [ "$(rsha $D/$f)" = "$want" ] || { echo "REMOTE_SHA_BAD $f"; return 1; }
  done
  [ "$(rsha $D/fixture.txt)" = "$FIXTURE_SHA" ] || { echo FIXTURE_SHA_REMOTE_BAD; return 1; }
  echo PUSH_VERIFIED
  # Backend inventory: HTP0 must be listed; the static binary must start with system libs only.
  adbT 120 shell "cd $D && ADSP_LIBRARY_PATH=$D/dsp GGML_HEXAGON_NDEV=1 ./bin/llama-perplexity --list-devices 2>&1 | tail -20"
}

step_launch() {
  local dl="$1"
  case "$dl" in ''|*[!0-9]*) echo "need deadline epoch"; return 1 ;; esac
  # Detached: setsid + background; the alarm guards the known QDC trap where
  # `adb shell "cmd &"` blocks until cmd ends. The on-device process survives.
  adbT 20 shell "cd $D && setsid sh sess.sh $dl > $D/out/sess.out 2>&1 < /dev/null &"
  echo "launch_rc=$?"
  sleep 5
  adbT 20 shell "cat $D/out/markers.txt; ps -A -o PID,ARGS | grep -E 'sess.sh|smp.sh' | grep -v grep"
}

step_poll() {
  adbT 30 shell "tail -4 $D/out/markers.txt; ls $D/out/DONE 2>/dev/null; tail -1 $D/out/samples.txt"
}

# Atomic pull: tar on the device, one adb pull, verify the byte count. (QDC trap:
# `adb logcat -d` dumps and pulls of many small files can be truncated.)
step_pull() {
  local dst="$RAW/device-out"
  mkdir -p "$dst"
  adbT 120 shell "cd $D/out && rm -f ../out.tgz && tar czf ../out.tgz . && wc -c ../out.tgz && sha256sum ../out.tgz" || return 1
  adbT 300 pull "$D/out.tgz" "$RAW/out.tgz" || return 1
  ls -l "$RAW/out.tgz"; shasum -a 256 "$RAW/out.tgz"
  tar xzf "$RAW/out.tgz" -C "$dst" && ls "$dst" | wc -l
}

cmd="${1:-}"; shift || true
case "$cmd" in
  preflight|push|launch|poll|pull)
    { echo "== $cmd $(date -u +%FT%TZ) args=$*"; "step_$cmd" "$@"; rc=$?; echo "STEP_RC=$rc"; } 2>&1 | tee -a "$RAW/$cmd.log"
    ;;
  *) echo "usage: run.sh preflight|push|launch <deadline_epoch>|poll|pull"; exit 2 ;;
esac
