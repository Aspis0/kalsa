#!/data/data/com.termux/files/usr/bin/bash
# Drop sweep on Marco-Mini-Instruct-KEXP (Marco1c) — Jelly Star, v2 harness.
#
# WHY RE-RUN A MODEL WE ALREADY SWEPT
# -----------------------------------
# results/dropsweep_jelly (2026-08-16) measured Marco at d = 0.0 / 0.3 / 0.65 / 1.0
# and its numbers stand, but it has two defects that matter now:
#
#   1. **No `--drop-no-renorm` arm.** M4 has since shown that the survivor rescale
#      is most of the quality cost of dropping (on Marco: d=1.0 costs +12.41% macro
#      bpb with the rescale on and +5.71% with it off), which makes
#      `d=1.0 + --drop-no-renorm` the candidate config for this model. Its SPEED on
#      Marco has never been measured. On CalaQwen the flag turned out to be
#      speed-neutral, but that is a different model and carrying it over by analogy
#      is exactly the shortcut this campaign keeps paying for.
#   2. **The cell's runs.csv on the device is unusable**: the v1 parser bug marked
#      all 11 runs `excluded=1`, and the figures we quote came from re-parsing the
#      per-token files offline. Nothing on the phone can be resumed or extended.
#
# So this re-runs Marco with the fixed harness and the fourth arm, giving Marco the
# same treatment CalaQwen just received (results/dropsweep_calaqwen_jelly, 12/12).
#
# THREADS: -t 2, matching the original Marco sweep and the pre-registered A/B, so
# the new numbers are comparable with the old ones. Thread count is a separate axis
# and is deliberately held constant here.
#
# WHAT THE OLD CELL FOUND, to be confirmed or overturned:
#   d=0.30  +5.0% MORE bytes, +17.4% slower than d=0.0
#   d=0.65  -10.7% bytes, still +10.0% slower
#   d=1.00  -68.5% bytes, -27.2% faster
# The 0.30 arm is dropped here: it was the clearest loser and the four slots are
# better spent on the no-renorm arm.
#
# PRE-DECLARED EXPECTATION: d=1.0 and d=1.0nr should be within a couple of percent
# of each other in s/tok (as on CalaQwen: +1.1% and -1.3%, sign flipping between
# thermally matched rounds). If they are NOT — if turning off the rescale costs
# real time on Marco — then the flag is not free everywhere and the recommendation
# has to become per-model on the speed axis too, not just on quality.
set -uo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"

export OUT="$HOME/experiments/results/dropsweep_marco_jelly"
export MODEL="$HOME/models/Marco-Mini-Instruct-KEXP.gguf"
export BIN="$HOME/bin/kernel_kf/bmoe-cli"
export DROPS="0.0 0.65 1.0 1.0nr"
export ROUNDS=3
export PASSES=3
export NGEN=200
export COOLDOWN=120
export BATT_FLOOR=45
export THREADS=2
export EXTRA_FLAGS="--n-expert-used 6"

mkdir -p "$OUT"
termux-api-start >/dev/null 2>&1
exec bash "$HOME/experiments/scripts/run_dropsweep_jelly.sh"
