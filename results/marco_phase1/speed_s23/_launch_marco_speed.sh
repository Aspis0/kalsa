#!/data/data/com.termux/files/usr/bin/bash
export HOME=/data/data/com.termux/files/home
export PREFIX=/data/data/com.termux/files/usr
export PATH=$PREFIX/bin:$PATH
export TMPDIR=$PREFIX/tmp
OUT=$HOME/experiments/results/marco_phase1_speed_s23
mkdir -p $OUT
if [ -f $OUT/harness.pid ]; then
  old=$(cat $OUT/harness.pid)
  kill $old 2>/dev/null || true
  sleep 1
fi
nohup bash $HOME/experiments/scripts/run_marco_speed_s23.sh >$OUT/nohup.out 2>&1 &
echo $! > $OUT/harness.pid
sleep 3
echo PID=$(cat $OUT/harness.pid)
head -40 $OUT/nohup.out
echo STATUS:
cat $OUT/STATUS.txt 2>/dev/null || true