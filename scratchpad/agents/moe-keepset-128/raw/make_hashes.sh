#!/bin/sh
# sha256 of every input and output artifact of this study; ~ paths like v3.
# Not hashed (self-referential): run_commands.txt (the hash step's own record is appended
# after hashing completes), source_hashes.txt, make_hashes.log.
set -e
RAW=~/Projects/kalsa-moe-experiments/scratchpad/agents/moe-keepset-128/raw
V3=~/Projects/kalsa-moe-experiments/scratchpad/agents/moe-expert-usage-v3/raw
RUNS=/tmp/moe-expert-usage-v3/runs
{
  echo "# moe-keepset-128 source hashes (sha256)"
  echo "# analysis data: per-segment router aggregates produced by the v3 instrumented run"
  shasum -a 256 $RUNS/full_segs.csv $RUNS/full_counts.bin $RUNS/full_mass.bin $RUNS/full_exit.txt
  echo "# corpus provenance (manifest carries the FLORES line blocks used for disjoint splits)"
  shasum -a 256 $V3/corpus/manifest.csv $V3/corpus/segments.txt $V3/corpus/code_sources.txt \
      $V3/corpus/gsm8k_math_used.jsonl
  echo "# v3 loaders (imported, not copied), RAZOR keep manifest, GGUF metadata dump"
  shasum -a 256 $V3/router_data.py $V3/kept_expert_indices.json $V3/model_metadata.json
  echo "# probe model (tensor shapes read with gguf-py from this file)"
  shasum -a 256 ~/kalsa-models/probe/qwen36-35b-a3b-q4/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf
  echo "# scripts of this study"
  shasum -a 256 $RAW/k128_common.py $RAW/check_leaky_anchor.py $RAW/run_uniform.py \
      $RAW/run_weighted.py $RAW/run_alloc.py $RAW/gguf_params.py $RAW/merge_table.py \
      $RAW/make_hashes.sh $RAW/run.sh
  echo "# outputs (CSVs and run logs)"
  shasum -a 256 $RAW/uniform_rows.csv $RAW/uniform_null.csv $RAW/weighted_sweep.csv \
      $RAW/alloc_retained.csv $RAW/alloc_counts.csv $RAW/model_sizes.csv $RAW/merged_curve.csv
  shasum -a 256 $RAW/check_leaky_anchor.log $RAW/run_uniform.log $RAW/run_weighted.log \
      $RAW/run_alloc.log $RAW/gguf_params.log $RAW/merge_table.log
  shasum -a 256 $RAW/../REPORT.md
} | sed "s|/Users/marco|~|" > $RAW/source_hashes.txt
echo "wrote $RAW/source_hashes.txt: $(grep -c . $RAW/source_hashes.txt) lines"
