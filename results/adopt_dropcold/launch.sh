#!/data/data/com.termux/files/usr/bin/bash
export PREFIX=/data/data/com.termux/files/usr
export PATH=$PREFIX/bin:$PATH
export HOME=/data/data/com.termux/files/home
cd $HOME/experiments/results/adopt_dropcold
termux-wake-lock >/dev/null 2>&1 || true
nohup bash $HOME/experiments/scripts/run_adopt_dropcold_final.sh > nohup.out 2>&1 &
echo $! > runner.pid
echo launched:$(cat runner.pid)
