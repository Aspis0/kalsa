#!/data/data/com.termux/files/usr/bin/bash
# Cache × drop interaction, Marco-Mini-KEXP on Jelly — cache 1000 MiB.
#
# THE LOW-RAM ROW — and it is the one that decides the cheap phones
# -----------------------------------------------------------------
# Owner's point (2026-08-18): 4 GB of cache might be affordable on an 8 GB phone,
# but on a **6 GB phone** it does not exist at all — Android keeps a large share
# and other apps compete, so an app realistically gets 2-3 GB. Since cache size and
# drop level interact, the shipped config cannot be one config: it has to depend on
# how much RAM the device can actually give up.
#
# What the two rows already measured say (Marco-Mini, 200 tokens, cold, unplugged):
#
#   cache 2000: hit 50.2% at d=0 → d=1.0nr is **-24.9% (much faster)**
#   cache 4000: hit 76.8% at d=0 → d=1.0nr is **+87% (much SLOWER)**   [round 1]
#
# The advantage did not merely shrink with a bigger cache, it **reversed**. That is
# the mechanism at its extreme: with a high hit rate you are no longer waiting on
# flash, so the drop's fixed compute tax has nothing left to repay.
#
# PRE-DECLARED EXPECTATION for this cell (written before it ran)
#   At 1000 MiB the hit rate at d=0 should fall well below 50%, more slots should
#   qualify as cold, and the drop should pay **MORE than the -24.9% measured at
#   2000** — because there is more stall to remove and the same tax to pay.
#   - If it does, we have a three-point rule, not an anecdote: pick the cache from
#     the device's RAM budget, then pick the drop from the resulting hit rate.
#   - If the advantage does NOT grow at 1000, the story is not monotone in cache
#     size and the mechanism needs another look.
#   - Watch also whether d=0.0 gets dramatically slower here: if a small cache
#     hurts more than the drop helps, the honest product answer for a 6 GB phone
#     may be "this model does not fit", not "tune the knobs".
#
# Same two arms as the other rows so the ratios are comparable: d=0.0 and the
# candidate d=1.0 + --drop-no-renorm. Ratios within a cell are immune to the
# thermal offset between cells, which is why these are separate cells.
set -uo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"

export OUT="$HOME/experiments/results/cachesweep_marco_jelly_c1500"
export MODEL="$HOME/models/Marco-Mini-Instruct-KEXP.gguf"
export BIN="$HOME/bin/kernel_kf/bmoe-cli"
export DROPS="0.0 1.0nr"
export ROUNDS=3
export PASSES=3
export NGEN=200
export COOLDOWN=120
export BATT_FLOOR=45
export THREADS=2
export CACHE_MB=1500
export EXTRA_FLAGS="--n-expert-used 6"

mkdir -p "$OUT"
termux-api-start >/dev/null 2>&1
exec bash "$HOME/experiments/scripts/run_dropsweep_jelly.sh"
