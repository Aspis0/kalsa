# step-2 env (FABLE-DESIGN Amendment B): step-1's gates, model, fixtures and NPU bench/KLD args,
# re-pointed at this build's directory. Source on the phone in ONE adb shell:
#   . /data/local/tmp/govhtp/step2-s23/env.sh
. /data/local/tmp/govhtp/step1-s23/env.sh

OLD_BIN=$D/bin                     # step-1 build e9d7a9f45: the two-copy placement reference
D=$R/step2-s23
REPORT=$D/step2_report.txt
FARF_FILE=$D/dsp/llama-bench.farf
DSP_REL=$D/dsp-rel

# Arm S = shared mode as the app will run it, no -ot: HOSTBUF + HOSTBUF_REPACK are the env seed of
# the setter (B1), so the extra bufts read {TILE32, HOST} and the probe places Q4_0 matmuls in
# TILE32 and the rest in HOST (B2). MBUF=832 is the S23 OpenCL import cap rounded down to 64 MiB
# (B3), which splits the tiles in two buffers. OFFLOAD_MIN_BATCH=1 + ADMIT_OPS=7 write the same
# admission word the app writes per NPU-leg context in step 5; without them every op whose weight
# sits in HOST falls to the CPU at batch 1 (the 198-split trap).
arm_env_shared() {
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 \
      GGML_OP_OFFLOAD_MIN_BATCH=1 GGML_HEXAGON_ADMIT_OPS=7 "$@"
}
ARM_S_ENV="arm_env_shared"
CAP_BYTES=$((832 * 1024 * 1024))
# The HOST buffer holds the f32 norms/conv weights (~15 MiB). Session 1 (01:00) measured 219.75 MiB: the tied
# output (LFM2 has no output.weight, so output is a TENSOR_DUPLICATED token_embd, 205 MiB) lands in HOST as a second
# copy while token_embd stays in CPU - the duplicate FABLE-DESIGN Amendment C1 removes in step 3. Until then the gate
# allows that one duplicate; anything above means a matrix missed TILE32.
HOST_MAX_MIB=230
