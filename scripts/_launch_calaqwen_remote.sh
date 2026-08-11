#!/data/data/com.termux/files/usr/bin/bash
export PREFIX=/data/data/com.termux/files/usr
export PATH=$PREFIX/bin:$PATH
export HOME=/data/data/com.termux/files/home
export TMPDIR=$PREFIX/tmp
mkdir -p $HOME/experiments/results/calaqwen_s23
sed -i 's/\r$//' $HOME/experiments/scripts/run_calaqwen_s23.sh 2>/dev/null || true
chmod +x $HOME/experiments/scripts/run_calaqwen_s23.sh
nohup bash $HOME/experiments/scripts/run_calaqwen_s23.sh >$HOME/experiments/results/calaqwen_s23/nohup.out 2>&1 &
echo $! > $HOME/experiments/results/calaqwen_s23/calaqwen.pid
sleep 2
echo PID=$(cat $HOME/experiments/results/calaqwen_s23/calaqwen.pid)
if ps -p $(cat $HOME/experiments/results/calaqwen_s23/calaqwen.pid) >/dev/null 2>&1; then echo ALIVE; else echo DEAD; fi
if [ -f $HOME/experiments/results/calaqwen_s23/CALAQWEN.master.log ]; then
  head -40 $HOME/experiments/results/calaqwen_s23/CALAQWEN.master.log
else
  head -40 $HOME/experiments/results/calaqwen_s23/nohup.out
fi
