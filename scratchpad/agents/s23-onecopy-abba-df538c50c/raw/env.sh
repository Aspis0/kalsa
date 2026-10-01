R=/data/local/tmp/govhtp
D=$R/onecopy-abba
export LD_LIBRARY_PATH=$R/lib
export ADSP_LIBRARY_PATH="$D/dsp;$R/lib"
M=/data/local/tmp/heat3way/ship.gguf
st() { dumpsys battery | grep 'Sending ACTION_BATTERY_CHANGED' | tail -1 | sed -nE 's/.*level:([0-9]+),.*ac:([a-z]+),.*usb:([a-z]+),.*wireless:([a-z]+),.*temperature:([0-9]+),.*/lvl=\1 ac=\2 usb=\3 wl=\4 batT=\5/p' | tr -d '\n'; sk=$(dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p'); echo -n " skin=$sk wake=$(dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2) thermal=$(dumpsys thermalservice | grep '^Thermal Status' | tail -1 | sed -nE 's/.*: ([0-9]+).*/\1/p') traced=$(getprop persist.traced.enable)"; }
runarm() { name=$1; shift
  input keyevent 224; sleep 2
  echo "== $name start $(date +%s) [$(st)]" >> $D/speed.txt
  env "$@" toybox time -v $D/bin/llama-bench -m $M -p 512 -n 128 -ub 512 -r 3 -t 5 -ngl 99 -dev HTP0 --load-mode none $EXTRA > $D/speed_$name.log 2>&1
  EXTRA=""
  echo "exit=$?" >> $D/speed.txt
  grep -E 'pp512|tg128|Max RSS' $D/speed_$name.log >> $D/speed.txt
  input keyevent 224; sleep 2
  echo "== $name after  $(date +%s) [$(st)]" >> $D/speed.txt
  sleep 90; }
