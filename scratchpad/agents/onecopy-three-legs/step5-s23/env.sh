# step-5 env: step 4b's gates and paths, plus the one-model governor-bench arm L (FABLE Amendment F5).
# Source on the phone:  . /data/local/tmp/govhtp/step5-s23/env.sh
. /data/local/tmp/govhtp/step4b-s23/env.sh

D=$R/step5-s23
REPORT=$D/step5_report.txt
# The one-model load: shared weights (step-2 env) WITHOUT OPFILTER, so the HTP placement probe puts the Q4_0
# matrices in TILE32 by itself; admission is set by the one-model governor, not by the env.
arm_env_legs() {
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 "$@"
}
