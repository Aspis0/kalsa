#!/data/data/com.termux/files/usr/bin/bash
export HOME=/data/data/com.termux/files/home
export PREFIX=/data/data/com.termux/files/usr
export PATH=$PREFIX/bin:$PATH
OUT=$HOME/experiments/results/marco_phase1_speed_s23
# archive failed attempt
mkdir -p $OUT/archive_fail_nof
if [ -f $OUT/runs_speed.csv ]; then mv $OUT/runs_speed.csv $OUT/archive_fail_nof/; fi
if [ -d $OUT/logs ]; then mv $OUT/logs $OUT/archive_fail_nof/logs; fi
if [ -f $OUT/SPEED.master.log ]; then mv $OUT/SPEED.master.log $OUT/archive_fail_nof/; fi
mkdir -p $OUT/logs
sed -i 's/\r$//' $HOME/experiments/scripts/run_marco_speed_s23.sh
chmod +x $HOME/experiments/scripts/run_marco_speed_s23.sh
if [ -f $OUT/harness.pid ]; then kill $(cat $OUT/harness.pid) 2>/dev/null || true; fi
nohup bash $HOME/experiments/scripts/run_marco_speed_s23.sh >$OUT/nohup.out 2>&1 &
echo $! > $OUT/harness.pid
sleep 2
echo PID=$(cat $OUT/harness.pid)
head -20 $OUT/nohup.out
termux-battery-status