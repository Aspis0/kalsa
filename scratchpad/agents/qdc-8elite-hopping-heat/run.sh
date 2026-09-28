#!/bin/bash
# Host driver for qdc-8elite-hopping-heat (copied from qdc-8elite-heat-arms). One step per invocation, so the
# operator reads each result before the next (on-disk state, not stdout):
#   run.sh preflight | push | launch <deadline_epoch> | poll | pull
# adb talks ONLY to the QDC tunnel on port 6037 (never 5037: the local
# server owns the lab phones). Every step logs to raw/<step>.log with rc.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
RAW=$HERE/raw
D=/data/local/tmp/h8h
KIT_TGZ=$HOME/kalsa-qdc/qdc-8elite-heat-arms/kit-8e.tgz
KIT_SHA=8a9a5ce2e541aff55e766af138785b69bf63db1776ed39f10a6617c57868050e
MODEL=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
PROMPT=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-thermal-ladder/raw/protocol-v2/prompt-v2.txt
PROMPT_SHA=f516905dd5a86926279b3bf08999539557aee3af6467c84a9df99a9323d4ba0a
export ANDROID_ADB_SERVER_PORT=6037
mkdir -p "$RAW"

# adbT <secs> <args...>: adb with a hard alarm (macOS has no `timeout`).
adbT() { local t="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$t" adb "$@"; }
rsha() { adbT 120 shell "sha256sum $1 2>/dev/null" | awk '{print $1}'; }

step_preflight() {
  adbT 20 devices -l
  adbT 20 shell 'id; getprop ro.soc.model; getprop ro.product.model; getprop ro.build.version.release; nproc; df -h /data | tail -1'
  adbT 30 shell 'dumpsys thermalservice | sed -n "/Current temperatures from HAL/,/Current cooling devices from HAL/p" | grep -i "mName=skin"; dumpsys thermalservice | grep -m1 "Thermal Status"'
  adbT 20 shell 'dumpsys battery | grep -E "level|temperature|powered|voltage"; dumpsys power | grep -E "mWakefulness=|mStayOn="'
  adbT 20 shell 'for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type)=$(cat $z/temp)"; done | grep -E "^(cpu|gpuss|nsp)" | head -40'
  adbT 20 shell 'ps -A | grep -E "llama|bench" || echo no_llama; which awk timeout pkill setsid'
}

step_push() {
  [ "$(shasum -a 256 "$KIT_TGZ" | awk '{print $1}')" = "$KIT_SHA" ] || { echo KIT_SHA_LOCAL_BAD; return 1; }
  [ "$(shasum -a 256 "$PROMPT" | awk '{print $1}')" = "$PROMPT_SHA" ] || { echo PROMPT_SHA_LOCAL_BAD; return 1; }
  adbT 30 shell "mkdir -p $D/out && rm -f $D/out/*" || return 1
  if [ "$(rsha $D/ship.gguf)" != "$MODEL_SHA" ]; then
    echo MODEL_PUSH; adbT 900 push "$MODEL" $D/ship.gguf || return 1
  else echo MODEL_PRESENT; fi
  [ "$(rsha $D/ship.gguf)" = "$MODEL_SHA" ] || { echo MODEL_SHA_REMOTE_BAD; return 1; }
  adbT 120 push "$KIT_TGZ" $D/kit-8e.tgz || return 1
  adbT 60 shell "cd $D && tar xzf kit-8e.tgz && sha256sum -c SHA256SUMS && chmod 755 bin/*" || return 1
  adbT 60 push "$PROMPT" $D/prompt.txt || return 1
  [ "$(rsha $D/prompt.txt)" = "$PROMPT_SHA" ] || { echo PROMPT_SHA_REMOTE_BAD; return 1; }
  adbT 60 push "$HERE/sess.sh" $D/sess.sh && adbT 60 push "$HERE/smp.sh" $D/smp.sh || return 1
  # Backend inventory: HTP0 and GPUOpenCL must both be listed.
  adbT 120 shell "cd $D && LD_LIBRARY_PATH=$D/lib ADSP_LIBRARY_PATH=$D/lib GGML_HEXAGON_NDEV=1 ./bin/llama-completion --list-devices 2>&1 | tail -20"
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

step_pull() {
  local dst="$RAW/device-out"
  mkdir -p "$dst"
  adbT 300 pull "$D/out/." "$dst/" || return 1
  ls -la "$dst" | tail -40
}

cmd="${1:-}"; shift || true
case "$cmd" in
  preflight|push|launch|poll|pull)
    { echo "== $cmd $(date -u +%FT%TZ) args=$*"; "step_$cmd" "$@"; rc=$?; echo "STEP_RC=$rc"; } 2>&1 | tee -a "$RAW/$cmd.log"
    ;;
  *) echo "usage: run.sh preflight|push|launch <deadline_epoch>|poll|pull"; exit 2 ;;
esac
