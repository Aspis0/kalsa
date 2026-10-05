# step-4b env: step 4's arms and gates re-pointed at the step-4b build (8ccc5ffae). Source on the phone:
#   . /data/local/tmp/govhtp/step4b-s23/env.sh
. /data/local/tmp/govhtp/step4-s23/env.sh

D=$R/step4b-s23
REPORT=$D/step4b_report.txt
FARF_FILE=$D/dsp/llama-bench.farf
DSP_REL=$D/dsp-rel
SKIN_STOP=44                       # owner's kill line, degrees C

# After the main merge llama-bench dropped -nr for --repack <0|1> (llama-bench.cpp:912; -nr printed the usage and
# exited 1, session 10:08); the common parser keeps -nr (common/arg.cpp:2438), so only the bench flags change.
ARM_G_BENCH_FLAGS="-ngl 99 -dev HTP0/GPUOpenCL -ts 1/0 --repack 0 -nkvo 1 $CTILE_OT"
