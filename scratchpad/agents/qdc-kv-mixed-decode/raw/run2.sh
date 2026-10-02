#!/system/bin/sh
# KV mixed-type decode cells. Usage: run.sh <cpumask> <skin_zone_path>
D=/data/local/tmp/kvmix
MASK=$1; SKIN=$2
M=$D/model.gguf
cd $D || exit 9
export LD_LIBRARY_PATH=$D
OUT=$D/out; mkdir -p $OUT
temp() { echo "skin=$(cat $SKIN) batt=$(dumpsys battery | grep -m1 'temperature' | tr -d ' ')"; }
START=$3
echo "round2_restart start_skin=$START cap=120s" >> $OUT/temps.txt
cool() {
  n=0
  while [ $(( $(cat $SKIN) - START )) -gt 5000 ] && [ $n -lt 8 ]; do sleep 15; n=$((n+1)); done
  echo "cool_wait_s=$((n*15))"
}
cell() { # name ctk ctv fa depths
  c=$(cool); t=$(temp)
  echo "$1 $c $t $(date +%s)" >> $OUT/temps.txt
  taskset $MASK ./llama-bench -m $M -t 4 -p 0 -n 128 -d $5 -r 3 -fa $4 -ctk $2 -ctv $3 -o json \
    > $OUT/$1.json 2> $OUT/$1.err
  echo "$1 rc=$? end=$(date +%s)" >> $OUT/temps.txt
}
for R in 2; do
  cell r${R}_A q8_0 q4_0 1 0,2048
  cell r${R}_B q8_0 q8_0 1 0,2048
  cell r${R}_C f16 f16 1 0,2048
  cell r${R}_D q4_0 q4_0 1 0,2048
done
cell ctl_A_fa0 q8_0 q4_0 0 2048
cell ctl_B_fa0 q8_0 q8_0 0 2048
echo done > $OUT/EXIT
