#!/data/data/com.termux/files/usr/bin/bash
# Cache × drop interaction, Marco-Mini-KEXP on Jelly — cache 4000 MiB.
#
# THE QUESTION NOBODY ASKED FOR 11 DAYS
# --------------------------------------
# `--drop-cold-experts` can only drop an expert that is NOT resident
# (`router_hook.cpp:271` requires `route_miss`). So the cache size decides how much
# is droppable at all: a bigger cache means fewer misses, fewer drops, less saving.
# Every measurement in this campaign was taken at `--cache-mb 2000`, on every model.
#
# **That means the drop optimum we are about to ship is the optimum AT THAT CACHE,
# and we have never looked at any other row of the plane.**
#
# Evidence the interaction is real, from the sweeps already run: hit rate tracks
# how much gets dropped, exactly as the mechanism predicts.
#   Marco-Mini @2000: hit 50.2% (d=0) → 29.7% of routed slots dropped at d=1.0
#   CalaQwen   @2000: hit 75.5% (d=0) → ~17% dropped
#   LFM2.5     @2000: hit 93.5% (d=0) → 3.6% dropped, and the drop never pays
#
# DESIGN — deliberately minimal, because the 2000 row already exists
# -----------------------------------------------------------------
# Two arms only, the two that matter for the decision: `d=0.0` (no drop) and
# `d=1.0nr` (the candidate config). What is compared across cells is their RATIO,
# not absolute s/tok — a ratio measured within one cell is immune to the thermal
# offset between cells, which is why this is three separate cells rather than one
# long interleaved run.
#
# Known row, from results/dropsweep_marco_jelly (cache 2000, 3 rounds):
#   d=0.0    0.163 / 0.165 / 0.171   hit 50.2%   read 11803.1 MiB
#   d=1.0nr  0.124 / 0.127 / 0.123   hit 67.9%   read  3562.4 MiB   → -24.9%
#
# PRE-DECLARED EXPECTATION (written before the cell ran)
#   At 4000 MiB the hit rate at d=0 should rise well above 50%, fewer slots should
#   qualify as cold, `experts_dropped` should FALL, and the advantage of d=1.0nr
#   should SHRINK from -24.9%.
#   - If it shrinks a lot, the shipped drop level is cache-dependent and the two
#     knobs have to be tuned together, not one at a time.
#   - If it barely moves, the drop is robust to cache size and we can stop
#     worrying about the second dimension — also a useful answer.
#   - If it GROWS, the mechanism I derived is wrong and needs rebuilding.
#
# Marco is used rather than CalaQwen because it is 6 GB instead of 13.4, so a cell
# costs ~15 minutes and a few percent of battery instead of an hour and a half —
# and it is the model where the drop pays most (-24.9%), so any shrink is visible.
set -uo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"

export OUT="$HOME/experiments/results/cachesweep_marco_jelly_c4000"
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
