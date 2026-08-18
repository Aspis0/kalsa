#!/data/data/com.termux/files/usr/bin/bash
# Cache × drop interaction, Marco-Mini-KEXP on Galaxy S23 — cache 4000 MiB.
#
# REPLICATION of the Jelly cache×drop reversal on Snapdragon 8 Gen 2.
# Same binary as Jelly (sha 77a94640a56a9043, in ~/bin/kernel_kf_jelly/),
# same model, same two arms. High-cache row — on Jelly this is where the
# drop reversed and became a net tax.
#
# Jelly reference (same binary, same model, same arms):
#   cache 1500: hit 39.5% at d=0 → d=1.0nr is −25% (faster)
#   cache 2000: hit 50.2% at d=0 → d=1.0nr is −25% (faster)
#   cache 4000: hit 76.8% at d=0 → d=1.0nr is +15% (slower)
#   Absolute best on Jelly: cache 4000 with no drop (0.113 s/tok).
#
# Ratios are within-round. Phone must be UNPLUGGED.
set -uo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"

export OUT="$HOME/experiments/results/cachesweep_marco_s23_c4000"
export MODEL="$HOME/models/Marco-Mini-Instruct-KEXP.gguf"
export BIN="$HOME/bin/kernel_kf_jelly/bmoe-cli"
export DROPS="0.0 1.0nr"
export ROUNDS=3
export PASSES=3
export NGEN=200
export COOLDOWN=120
export BATT_FLOOR=45
export THREADS=2
export CACHE_MB=4000
export EXTRA_FLAGS="--n-expert-used 6"
export PROMPT="$HOME/experiments/results/mellum2_f1_s23/p_fact.txt"

mkdir -p "$OUT"
termux-api-start >/dev/null 2>&1
exec bash "$HOME/experiments/scripts/run_dropsweep_jelly.sh"
