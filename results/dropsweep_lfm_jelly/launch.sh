#!/data/data/com.termux/files/usr/bin/bash
# Launcher for the LFM2.5 drop sweep on Jelly Star.
#
# SECOND MODEL FOR THE DROP NON-MONOTONICITY (pre-declared 2026-08-17)
# --------------------------------------------------------------------
# results/dropsweep_jelly found, on Marco-Mini-Instruct-KEXP (256 experts, k=6):
#   d=0.30  +5.0 % MORE bytes and +17.4 % slower than d=0.0
#   d=0.65  -10.7 % bytes but still +10.0 % slower
#   d=1.00  -68.5 % bytes and -27.2 % time
# i.e. small drop fractions are a net loss; only d=1.0 pays. The proposed
# mechanism is cache locality: dropping a slot re-points it at the top expert
# (router_hook.cpp:267-268), which perturbs WHICH experts are touched, and at low
# fractions that costs more in lost locality than it saves in reads.
#
# LFM2.5-8B-A1B-KEXP is the only other MoE on this device, and it is a good test
# precisely because it is NOT similar: lfm2moe, sigmoid gating, k=4 of 32 experts,
# 3.3 GB. With 32 experts and a 2000 MiB cache most of the expert working set is
# resident, so the locality mechanism has far less room to bite.
#
# PRE-DECLARED READING OF THE OUTCOME (written before the cell runs):
#   - Bytes rise at d=0.3 here too  -> the effect is implementation-level and the
#     shipped d=0.65 default is suspect on every model, CalaQwen included.
#   - Bytes flat/monotone here, non-monotone on Marco -> CONFIRMS the cache-
#     locality mechanism (it needs a working set that overflows the cache). The
#     Marco finding stands and stays scoped to large-expert-count models.
#   - Neither is a "failure". Both readings are informative; this is why the cell
#     is worth its battery.
#
# Measured pre-flight on 2026-08-17 (5-token smoke, not data):
#   d=0.0  read_MiB=183.0  experts_routed=0    experts_dropped=0
#   d=1.0  read_MiB= 99.1  experts_routed=440  experts_dropped=26
#   cold reset on this model drops 2706 MB -> the >=1000 MB gate is reachable.
#
# Native routing is used (no --n-expert-used). Forcing Marco's k=6 onto a model
# trained with k=4 would change the model, not the drop level under test.
set -uo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"

export OUT="$HOME/experiments/results/dropsweep_lfm_jelly"
export MODEL="$HOME/models/LFM2.5-8B-A1B-KEXP.gguf"
export BIN="$HOME/bin/kernel_kf/bmoe-cli"
export DROPS="0.0 0.3 0.65 1.0"
export ROUNDS=3
export PASSES=3
export NGEN=200
export COOLDOWN=120
export BATT_FLOOR=45
export EXTRA_FLAGS=""

mkdir -p "$OUT"
termux-api-start >/dev/null 2>&1
exec bash "$HOME/experiments/scripts/run_dropsweep_jelly.sh"
