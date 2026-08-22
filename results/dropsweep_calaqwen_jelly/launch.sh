#!/data/data/com.termux/files/usr/bin/bash
# Drop sweep on the SHIPPED model — CalaQwen (Qwen3.6-35B-A3B-KEXP) on Jelly Star.
#
# WHY THIS IS THE CELL THAT DECIDES
# ---------------------------------
# Every speed number behind the drop lever was measured on a model we do not ship:
# Marco-Mini (results/dropsweep_jelly) and LFM2.5 (results/dropsweep_lfm_jelly).
# The quality curve is CalaQwen, the speed is not. This cell closes that gap on the
# model that actually ships, with the shipped CalaQwen config's own flags
# (-t 4, --n-expert-used 6) so the answer applies to the product, not to an analogue.
#
# Model verified on device 2026-08-17: sha256
#   ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a
# identical to the PC copy pinned in results/calaqwen_dropcurve/launch.ps1.
#
# THE FOURTH ARM, AND WHY IT IS HERE AND NOT IN A SEPARATE CELL
# -------------------------------------------------------------
# M4 (results/m4_renorm_ablation) found that ~70% of the quality cost of aggressive
# dropping comes from the survivor rescale, not from the drop: at d=1.0, macro bpb
# 0.7049 with renorm ON vs 0.6861 with it OFF. That makes `d=1.0 --drop-no-renorm`
# the leading candidate config. Its SPEED, however, has never been measured — it was
# only argued ("the flag does not change which experts are dropped, so bytes and
# time should be unchanged"). Arguing is not measuring, so it gets an arm.
# It sits inside the round-robin rather than appended after it: run last, thermal
# drift would land entirely on the one arm we most need to trust.
#
# PRE-DECLARED EXPECTATION (written before the cell ran)
# ------------------------------------------------------
# 5-token smoke on this device, 2026-08-17:
#   d=0.0  read_MiB=611.4  cache_hit=11.8%  experts_routed=0
#   d=1.0  read_MiB=306.2  cache_hit=11.3%  routed=1200 dropped=343 (28.6%)
#
# Cache hit ~12% is the lowest of any model tested (Marco-Mini 50.2%, LFM2.5 93.5%):
# on CalaQwen almost every expert is a cache miss, so the model is far more I/O-bound
# and the drop has the most room it has ever had.
#   - Expected: d=1.0 pays MORE here than the -27% measured on Marco-Mini, and the
#     fixed compute tax of arming the drop is repaid easily because stall dominates.
#   - If instead d=1.0 does NOT pay on CalaQwen, the rule derived last night ("the
#     drop pays only when it saves enough I/O to cover a fixed compute tax") is
#     wrong, and the whole speed story needs rebuilding.
#   - Refinement to record either way: the hit rate is an UPPER BOUND on the drop
#     rate, not a predictor. LFM2.5's 93.5% hit capped it tightly (6.5% possible,
#     3.6% observed), but CalaQwen's 11.8% hit leaves ~88% possible and only 28.6%
#     is dropped — here the weight threshold (drop_w < drop_frac/k), not residency,
#     is what binds.
#
# PROTOCOL: unchanged from the other two sweeps. Round-robin over the arms, 3 rounds,
# 200 tokens, verified-cold page cache before every run (>=1000 MB drop), UNPLUGGED,
# battery floor 45. Exploratory: no p-value, no pre-registration, no ship claim.
set -uo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"

export OUT="$HOME/experiments/results/dropsweep_calaqwen_jelly"
export MODEL="$HOME/models/Qwen3.6-35B-A3B-KEXP.gguf"
export BIN="$HOME/bin/kernel_kf/bmoe-cli"
# `1.0nr` = drop 1.0 with --drop-no-renorm (see the harness's suffix handling).
export DROPS="0.0 0.65 1.0 1.0nr"
export ROUNDS=3
export PASSES=3
export NGEN=200
export COOLDOWN=120
export BATT_FLOOR=45
# The shipped CalaQwen campaign config's own flags. -t 4, not the -t 2 the
# Marco-Mini sweep used: this cell must answer for the product as configured.
export THREADS=4
export EXTRA_FLAGS="--n-expert-used 6"

mkdir -p "$OUT"
termux-api-start >/dev/null 2>&1
exec bash "$HOME/experiments/scripts/run_dropsweep_jelly.sh"
