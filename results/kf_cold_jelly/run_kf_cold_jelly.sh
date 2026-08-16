#!/data/data/com.termux/files/usr/bin/bash
# run_kf_cold_jelly.sh — outer wrapper for the registered K-F COLD cell.
# Sets the registered env and execs the harness. Do not change arms/flags.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"

HERE="$(cd "$(dirname "$0")" && pwd)"

export OUTDIR="${OUTDIR:-$HOME/experiments/results/kf_cold_jelly}"
export BINARY="${BINARY:-$HOME/bin/kernel_kf/bmoe-cli}"
export CAMPAIGN_BIN="${CAMPAIGN_BIN:-$HOME/bin/bmoe-cli.JELLY}"
export MODEL="${MODEL:-$HOME/models/Marco-Mini-Instruct-KEXP.gguf}"
export N_GEN="${N_GEN:-200}"
export BLOCK_PLAN="${BLOCK_PLAN:-OFF ON:4 ON:4 OFF OFF ON:4 ON:4 OFF OFF ON:4 ON:4 OFF OFF ON:4 ON:4 OFF OFF ON:4 ON:4 OFF OFF ON:4 ON:4 OFF}"

mkdir -p "$OUTDIR/logs"
exec bash "$HERE/run_kf_reality_jelly.sh"
