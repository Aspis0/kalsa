#!/bin/sh
# Run every analysis step of this study in order, logging real exit codes.
# Each step overwrites its own log; run_commands.txt records command + real exit code.
set -u
RAW=~/Projects/kalsa-moe-experiments/scratchpad/agents/moe-keepset-128/raw
cd "$RAW"
: > run_commands.txt
run() {
  desc="$1"; shift
  eval "$@" > /dev/null 2>&1
  code=$?
  echo "$desc :: EXIT=$code :: $*" >> run_commands.txt
  echo "$desc EXIT=$code"
}
run "anchor-leaky-repro"  "python3 check_leaky_anchor.py > check_leaky_anchor.log 2>&1"
run "uniform-comparators" "python3 run_uniform.py > run_uniform.log 2>&1"
run "weighted-sweep-A"    "python3 run_weighted.py > run_weighted.log 2>&1"
run "alloc-B-C"           "python3 run_alloc.py > run_alloc.log 2>&1"
run "gguf-params"         "python3 gguf_params.py > gguf_params.log 2>&1"
run "merge-table-D"       "python3 merge_table.py > merge_table.log 2>&1"
run "hashes"              "sh make_hashes.sh > make_hashes.log 2>&1"
