#!/data/data/com.termux/files/usr/bin/bash
# Cache x drop covariate rerun, Marco-Mini-KEXP on Jelly — cache 2000 MiB.
# Replicates results/dropsweep_marco_jelly/launch.sh (the original cache-2000
# row cited by ALIVE.md): DROPS="0.0 0.65 1.0 1.0nr", ROUNDS=3, THREADS=2.
# CACHE_MB was implicit there (harness default 2000); set explicitly here so
# the rerun cannot pick up a different default. New OUT dir: original CSV is
# complete, resume would STOP immediately.
set -uo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"

export OUT="$HOME/experiments/results/cachesweep_marco_jelly_c2000_cov"
export MODEL="$HOME/models/Marco-Mini-Instruct-KEXP.gguf"
export BIN="$HOME/bin/kernel_kf/bmoe-cli"
export DROPS="0.0 0.65 1.0 1.0nr"
export ROUNDS=3
export PASSES=3
export NGEN=200
export COOLDOWN=120
export BATT_FLOOR=45
export THREADS=2
export CACHE_MB=2000
export EXTRA_FLAGS="--n-expert-used 6"

mkdir -p "$OUT"
termux-api-start >/dev/null 2>&1
exec bash "$HOME/experiments/scripts/run_dropsweep_jelly.sh"
