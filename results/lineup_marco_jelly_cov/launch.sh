#!/data/data/com.termux/files/usr/bin/bash
# Lineup provenance cell — Marco1c SHIPPED config on Jelly, covariate harness.
#
# Card being replaced: 3.64 t/s (t2, ranking) from
# results/lineup_card/jelly_1c/SPEED_VERDICT.md (2026-08-13), which was
# k6 d=0.65 cache-mb 2000 on this same binary. Marco now ships NO drop.
#
# Flags, cited (not guessed):
#   d=0.0            ALIVE.md:581 PLAN.md "Marco ships no drop"
#   -t 2             lineup card ALIVE.md:546 and SPEED_VERDICT.md:23
#   --cache-mb 2000  SPEED_VERDICT.md:23 / cmdline.txt:16-17 (the card AND
#                    campaign default PLAN.md:3374). Cache 4000 is a later
#                    Jelly-optimum finding, not what the card or the campaign
#                    default flag string uses.
#   --n-expert-used 6 SPEED_VERDICT.md:23 / cmdline.txt:11-12
#   binary            $HOME/bin/bmoe-cli.JELLY sha 36b01966… (SPEED_VERDICT.md:15)
#                     NOT kernel_kf/77a94640 — that is the cache-sweep pin;
#                     the lineup does not rest on it.
#   prompt            p_fact.txt sha b5301c32… (same file the card's fact arm used)
#   BATT_FLOOR=35    SPEED_VERDICT.md:28 (lineup protocol). Start is 46 %.
#   3 rounds of one arm, cold, unplugged — dropsweep pairing against drift.
#                    The card used 4-run ABBA of two prompts; this cell is
#                    3 cold rounds of p_fact so every row is the same prompt
#                    and the harness stays unmodified.
set -uo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"

export OUT="$HOME/experiments/results/lineup_marco_jelly_cov"
export MODEL="$HOME/models/Marco-Mini-Instruct-KEXP.gguf"
export BIN="$HOME/bin/bmoe-cli.JELLY"
export PROMPT="$HOME/experiments/results/kf_cold_jelly/prompts/p_fact.txt"
export DROPS="0.0"
export ROUNDS=3
export PASSES=3
export NGEN=200
export COOLDOWN=120
export BATT_FLOOR=35
export THREADS=2
export CACHE_MB=2000
export EXTRA_FLAGS="--n-expert-used 6"

mkdir -p "$OUT"
termux-api-start >/dev/null 2>&1
exec bash "$HOME/experiments/scripts/run_dropsweep_jelly.sh"
