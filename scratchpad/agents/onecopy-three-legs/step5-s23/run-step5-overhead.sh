# Step-5 governor overhead (S23, unplugged), one harness, one load: arm A = plain context over the J(1) one-copy
# list {HTP0, GPUOpenCL} (no governor) vs arm L forced NPU leg (one-copy governor), same env, same -t, 256 tokens,
# ABBA x2. Compare arm A's turn 0 (KV depth 512 -> 767) with arm L (single turn, same depth).
# Both arms run arm_env_shared (adds GGML_OP_OFFLOAD_MIN_BATCH=1 GGML_HEXAGON_ADMIT_OPS=7): a plain context gets no
# admission word from a governor, and the first run (overhead_report.txt, arm_env_legs) decoded arm A at 5.7 tok/s.
#   . /data/local/tmp/govhtp/step5-s23/run-step5-overhead.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step5-s23/env.sh
D=$R/step5-s23; REPORT=$D/overhead3_report.txt; B=$D/bin/governor-bench-3a7
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
rm -f $REPORT
echo "== overhead start $(date) binary $(sha256sum $B | cut -c1-12) [$(st)]" >> $REPORT
session_gates || { echo "SESSION ABORTED: preflight gates" >> $REPORT; return 1 2>/dev/null || exit 1; }
cd $D
n=0
for arm in A L L A A L L A; do
  n=$((n + 1)); input keyevent 224; wm dismiss-keyguard
  case $arm in
    A) arm_env_shared $B --arm A --dev HTP0,GPUOpenCL -m $M -t 5 -r 1 --gen 256 > $D/ovh3_${n}_A.log 2>&1 ;;
    L) arm_env_shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 256 --legs npu > $D/ovh3_${n}_L.log 2>&1 ;;
  esac
  echo "## $n arm=$arm exit=$? [$(st)]" >> $REPORT
  grep -E '^turn arm=A rep=0 turn=0|leg_summary' $D/ovh3_${n}_$arm.log | cut -c1-400 >> $REPORT
  skin=$(dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9]+).*/\1/p')
  [ -n "$skin" ] && [ "$skin" -ge $SKIN_STOP ] && { echo "STOP: skin $skin" >> $REPORT; break; }
  sleep 60
done
echo "== overhead end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
