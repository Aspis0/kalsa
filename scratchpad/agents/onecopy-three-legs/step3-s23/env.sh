# step-3 env (FABLE-DESIGN Amendment C): step 2's env, arms and gates, re-pointed at this build; the two-copy
# placement reference is now the step-2 build (93fb3c097). Source on the phone:
#   . /data/local/tmp/govhtp/step3-s23/env.sh
. /data/local/tmp/govhtp/step2-s23/env.sh

OLD_BIN=$D/bin                     # step-2 build 93fb3c097
D=$R/step3-s23
REPORT=$D/step3_report.txt
FARF_FILE=$D/dsp/llama-bench.farf
DSP_REL=$D/dsp-rel
# C1 reuses token_embd for the tied output, so HOST is back to the norms/conv weights (~15 MiB measured in step 2
# as 219.75 - 205.08); anything bigger means a duplicate or a matrix that missed TILE32.
HOST_MAX_MIB=16
