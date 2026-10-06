# J(1) profiling: where the +20 ms/token of the GPU lm_head goes (kernel vs memory vs HTP->GPU sync).
# OpenCL-profiling llama-bench (GGML_OPENCL_PROFILING=ON, built from the branch under test) with the release skel of the same tree.
#   H = shared mode, HTP0 then GPUOpenCL, -ts 1/0: lm_head on the plain kernel over the HOST-W import.
#   (The O arm was dropped 2026-10-05: in GPU-only mode the tied output stays on the CPU, so it timed nothing.)
# Each arm writes cl_profiling.csv + cl_trace.json in its own dir; tg only, short, correctness of timing only.
#   . /data/local/tmp/govhtp/step4b-s23/run-prof.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step4b-s23/env.sh
. "$D/proofs.sh"
P=$R/prof
REPORT=$P/prof_report.txt
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
rm -rf $P/H $P/O; mkdir -p $P/H; rm -f $REPORT
echo "== J(1) profiling start $(date) [$(st)]" >> $REPORT
echo "binary: $(sha256sum $P/llama-bench | cut -c1-12) skel: $(sha256sum $DSP_REL/libggml-htp-v73.so | cut -c1-12)" >> $REPORT
session_gates || { echo "SESSION ABORTED: preflight gates" >> $REPORT; exit 1; }

cd $P/H && arm_env_shared $P/llama-bench -m $M -p 0 -n 32 -r 1 -t 5 -ngl 99 -dev HTP0/GPUOpenCL -ts 1/0 > bench.log 2>&1
echo "H: exit=$? tg=$(grep -oE 'tg32 *\| *[0-9.]+' bench.log | grep -oE '[0-9.]+$') rows=$(wc -l < cl_profiling.csv) [$(st)]" >> $REPORT
echo "== J(1) profiling end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
