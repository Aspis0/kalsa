R=/data/local/tmp/govhtp
D=$R/onecopy-rawdec2
O=$D/heat
mkdir -p $O
export LD_LIBRARY_PATH=$R/lib
export ADSP_LIBRARY_PATH="$D/dsp;$R/lib"
export GGML_HEXAGON_OPFUSION=0
M=/data/local/tmp/heat3way/ship.gguf
sample() { while [ ! -f $O/stop.flag ]; do b=$(dumpsys battery | grep 'Sending ACTION_BATTERY_CHANGED' | tail -1 | sed -nE 's/.*level:([0-9]+),.*ac:([a-z]+),.*usb:([a-z]+),.*temperature:([0-9]+),.*/\1 \2 \3 \4/p'); s=$(dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p'); t=$(dumpsys thermalservice | grep '^Thermal Status' | sed -nE 's/.*: ([0-9]+).*/\1/p'); echo "$(date +%s) $(cat $O/arm.cur 2>/dev/null) $b $s $t" >> $O/samples.txt; sleep 2; done; }
rm -f $O/samples.txt $O/stop.flag $O/summary.txt
echo idle > $O/arm.cur
sample &
SP=$!
run() { name=$1; shift; input keyevent 224; echo $name > $O/arm.cur; echo "== $name start $(date +%s)" >> $O/summary.txt; env "$@" $D/bin/llama-bench -m $M -p 0 -n 1024 -r 1 -t 5 -ngl 99 -dev HTP0 --load-mode none > $O/$name.log 2>&1; echo "== $name end $(date +%s) exit=$?" >> $O/summary.txt; grep tg1024 $O/$name.log >> $O/summary.txt; echo idle > $O/arm.cur; sleep 180; }
sleep 60
run npu1_A GGML_HEXAGON_RAW_HMX=1 GGML_HEXAGON_HOSTBUF=1
run cpu1_A GGML_HEXAGON_RAW_HMX=1 GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_RAW_DECODE=0
run npu2_A
run npu2_B
run cpu1_B GGML_HEXAGON_RAW_HMX=1 GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_RAW_DECODE=0
run npu1_B GGML_HEXAGON_RAW_HMX=1 GGML_HEXAGON_HOSTBUF=1
touch $O/stop.flag
wait $SP
echo DONE >> $O/summary.txt
