#!/bin/sh
# sha256 of every input corpus, the instrument, the binary, and every output artifact.
# Paths are written with ~ instead of the absolute home prefix.
set -e
RAW=~/Projects/kalsa-moe-experiments/scratchpad/agents/moe-expert-usage-v3/raw
RUNS=/tmp/moe-expert-usage-v3/runs
OUT=$RAW/source_hashes.txt
{
  echo "# moe-expert-usage-v3 source hashes (sha256)"
  echo "# model"
  shasum -a 256 ~/kalsa-models/probe/qwen36-35b-a3b-q4/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf
  echo "# RAZOR survivor manifest and config (copied from razor-italian-loss/raw)"
  shasum -a 256 $RAW/kept_expert_indices.json $RAW/razor_config.json
  echo "# instrument (source copy, diff vs engine commit 61c9094811cb200fd475491f18f594fbde77634b, binary)"
  shasum -a 256 $RAW/instrument/eval-callback.cpp $RAW/instrument/instrument_v3.diff
  shasum -a 256 /tmp/razor-italian-loss/build-cpu/bin/llama-eval-callback
  echo "# corpus downloads (kept under /tmp)"
  shasum -a 256 /tmp/moe-expert-usage-v3/flores200_dataset.tar.gz /tmp/moe-expert-usage-v3/gsm8k_train.parquet
  echo "# corpus provenance copies and segment corpus"
  shasum -a 256 $RAW/corpus/flores/*
  shasum -a 256 $RAW/corpus/segments.txt $RAW/corpus/manifest.csv
  shasum -a 256 $RAW/corpus/gsm8k_math_used.jsonl $RAW/corpus/code_sources.txt
  echo "# code corpus source files (python stdlib + engine checkout at the pinned commit)"
  shasum -a 256 $(cat $RAW/corpus/code_sources.txt)
  echo "# run artifacts (logs, segments csv, binary router dumps, aggregate csv)"
  shasum -a 256 $RUNS/full.log $RUNS/full_segs.csv $RUNS/full_counts.bin $RUNS/full_mass.bin \
      $RUNS/full_agg.csv $RUNS/full_exit.txt
  echo "# smoke and calibration runs (not analysis data)"
  shasum -a 256 $RUNS/smoke.log $RUNS/smoke_segs.csv $RUNS/smoke_counts.bin $RUNS/smoke_mass.bin \
      $RUNS/smoke_agg.csv $RUNS/ab_ub256.log $RUNS/ab_ub512.log
  echo "# scripts and analysis outputs"
  shasum -a 256 $RAW/build_corpus.py $RAW/router_data.py $RAW/analyze_usage.py \
      $RAW/razor_check.py $RAW/validate_outputs.py $RAW/summarize.py $RAW/make_hashes.sh
  shasum -a 256 $RAW/curve_retained_mass.csv $RAW/random_null.csv $RAW/sacrifice_dominated.csv \
      $RAW/topk_overlap.csv $RAW/razor_check.csv $RAW/razor_per_layer.csv \
      $RAW/run_commands.txt $RAW/analysis.log $RAW/analysis_razor.log $RAW/validator.log
  shasum -a 256 $RAW/summary.txt $RAW/model_metadata.json $RAW/model_load.log
} | sed "s|/Users/marco|~|" > $OUT
echo "wrote $OUT: $(grep -c . $OUT) lines"
