# Source on the phone (adb shell): . /data/local/tmp/govhtp/onecopy-pair/env.sh
# Same recipe as s23-onecopy-abba-df538c50c/raw/env.sh; the binaries it runs are a PAIR (host binary +
# skel), so every arm names the directory both come from.
R=/data/local/tmp/govhtp
D=$R/onecopy-pair            # the new build (engine spike/onecopy-hmx-raw, this change)
OLD=$R/onecopy-abba          # df538c50c, already on the phone (sha256 in the ABBA report)
export LD_LIBRARY_PATH=$R/lib
M=/data/local/tmp/heat3way/ship.gguf
ONE="GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_RAW_HMX=1 GGML_HEXAGON_HOSTBUF=1"   # one copy, base env
TWO="GGML_HEXAGON_OPFUSION=0"                                                  # two copies

st() { dumpsys battery | grep 'Sending ACTION_BATTERY_CHANGED' | tail -1 | sed -nE 's/.*level:([0-9]+),.*ac:([a-z]+),.*usb:([a-z]+),.*wireless:([a-z]+),.*temperature:([0-9]+),.*/lvl=\1 ac=\2 usb=\3 wl=\4 batT=\5/p' | tr -d '\n'; sk=$(dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p'); echo -n " skin=$sk wake=$(dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2) thermal=$(dumpsys thermalservice | grep '^Thermal Status' | tail -1 | sed -nE 's/.*: ([0-9]+).*/\1/p') traced=$(getprop persist.traced.enable)"; }

# the session gate: battery temperature (tenths of a degree) at or below 33.0 before an arm starts
waitcool() { i=0; while [ $i -lt 20 ]; do t=$(dumpsys battery | grep -m1 'temperature' | sed -nE 's/.*temperature: ([0-9]+).*/\1/p'); [ "${t:-999}" -le 330 ] && return; sleep 30; i=$((i+1)); done; }

# runarm NAME BINDIR ENV...  : one tg128 / pp512 llama-bench arm, gates before and after, 90 s gap
runarm() { name=$1; bin=$2; shift; shift
  export ADSP_LIBRARY_PATH="$bin/dsp;$R/lib"
  waitcool; input keyevent 224; sleep 2
  echo "== $name start $(date +%s) [$(st)]" >> $D/speed.txt
  env "$@" toybox time -v $bin/bin/llama-bench -m $M -p 512 -n 128 -ub 512 -r 3 -t 5 -ngl 99 -dev HTP0 --load-mode none > $D/speed_$name.log 2>&1
  echo "exit=$?" >> $D/speed.txt
  grep -E 'pp512|tg128|Max RSS' $D/speed_$name.log >> $D/speed.txt
  grep -c -E 'dsp-error|NO-SUPPORT|CRASH|GGML_ABORT|Segmentation' $D/speed_$name.log | sed 's/^/errors=/' >> $D/speed.txt
  input keyevent 224; sleep 2
  echo "== $name after  $(date +%s) [$(st)]" >> $D/speed.txt
  sleep 90; }
