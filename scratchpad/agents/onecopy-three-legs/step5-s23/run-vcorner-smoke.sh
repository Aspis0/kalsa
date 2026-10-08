# S23 smoke (unplugged, 128 tokens each, 60 s apart): does GGML_HEXAGON_VCORNER change NPU-leg decode speed?
. /data/local/tmp/govhtp/step5-s23/env.sh
V=/data/local/tmp/govhtp/vcorner; B=$V/bin/governor-bench; OUT=$V/smoke_report.txt
export ADSP_LIBRARY_PATH="$V/dsp-rel;$R/lib"
rm -f $OUT; cd $V
for c in MAX SVS,MAX NOM,MAX MAX; do
  input keyevent 224; wm dismiss-keyguard
  arm_env_legs env GGML_HEXAGON_VCORNER=$c $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 129 --legs npu -v > $V/smoke_$c.log 2>&1
  echo "## $c exit=$? skin=$(dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p')" >> $OUT
  grep -E 'lab vcorner|leg_summary' $V/smoke_$c.log | cut -c1-160 >> $OUT
  sleep 60
done
echo "== end" >> $OUT
