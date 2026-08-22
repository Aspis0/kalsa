#!/data/data/com.termux/files/usr/bin/bash
# Cache x drop covariate rerun, Marco-Mini-KEXP on Jelly — cache 4000 MiB.
# Replicates results/cachesweep_marco_jelly_c4000/launch.sh exactly, plus the
# F4.3-bis cpuset gate/covariates now in run_dropsweep_jelly.sh (commit 6a26036).
# New OUT dir: the original cell is complete (all labels excluded=0); resume
# against that CSV would STOP immediately.
set -uo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"

export OUT="$HOME/experiments/results/cachesweep_marco_jelly_c4000_cov"
export MODEL="$HOME/models/Marco-Mini-Instruct-KEXP.gguf"
export BIN="$HOME/bin/kernel_kf/bmoe-cli"
export DROPS="0.0 1.0nr"
export ROUNDS=3
export PASSES=3
export NGEN=200
export COOLDOWN=120
export BATT_FLOOR=45
export THREADS=2
export CACHE_MB=4000
export EXTRA_FLAGS="--n-expert-used 6"

mkdir -p "$OUT"
termux-api-start >/dev/null 2>&1
exec bash "$HOME/experiments/scripts/run_dropsweep_jelly.sh"
