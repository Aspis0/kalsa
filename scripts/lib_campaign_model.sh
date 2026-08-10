# shellcheck shell=bash
# Campaign model ? KEXP adopted 2026-08-10 (mandates/adopt-kexp.md).
# Source this file, then: MODEL="${MODEL:-$CAMPAIGN_MODEL}"
# IQ2_M remains on disk as historical reference; never delete without gualt ok.
CAMPAIGN_MODEL_BASENAME="Qwen3.6-35B-A3B-KEXP.gguf"
# phone primary location (scp target from 1c)
CAMPAIGN_MODEL="${CAMPAIGN_MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
# convenience symlink expected at ~/models/CAMPAIGN.gguf after adopt
CAMPAIGN_MODEL_LINK="${CAMPAIGN_MODEL_LINK:-$HOME/models/CAMPAIGN.gguf}"
HISTORICAL_IQ2M="${HISTORICAL_IQ2M:-$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf}"
export CAMPAIGN_MODEL_BASENAME CAMPAIGN_MODEL CAMPAIGN_MODEL_LINK HISTORICAL_IQ2M
