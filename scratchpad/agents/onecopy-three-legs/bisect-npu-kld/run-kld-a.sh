# Bisect of the two-copy NPU KLD regression (0.0053 before the engine main merge, 0.0450 after): one KLD of arm A
# (today's two-copy NPU, no env) for the build in $R/bisect/<tag>/{bin,dsp-rel}. Same fixture, base logits and
# args as steps 1-4b's A arm. Correctness only: may run plugged.
#   sh /data/local/tmp/govhtp/bisect/run-kld-a.sh <tag>
. /data/local/tmp/govhtp/step1-s23/env.sh
T=${1:?tag}
B=$R/bisect/$T
REPORT=$R/bisect/report.txt
SKIN_STOP=44
sk=$(dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p')
awk -v s="${sk:-99}" -v m="$SKIN_STOP" 'BEGIN { exit !(s < m) }' || { echo "$T: SKIN STOP ${sk:-unknown}" | tee -a $REPORT; exit 1; }
export ADSP_LIBRARY_PATH="$B/dsp-rel;$R/lib"
input keyevent 224; sleep 2
echo "== $T kld start $(date +%s) bin=$(sha256sum $B/bin/llama-perplexity | cut -c1-12) skel=$(sha256sum $B/dsp-rel/libggml-htp-v73.so | cut -c1-12) [$(st)]" >> $REPORT
$B/bin/llama-perplexity -m $M $KLD_ARGS > $B/kld_A.log 2>&1
rc=$?
echo "$T: exit=$rc $(grep -E 'Mean PPL\(Q\) |Mean +KLD|Same top p' $B/kld_A.log | tr -s ' ' | tr '\n' ';') errors=$(grep -c -E "$ERRPAT" $B/kld_A.log) [$(st)]" >> $REPORT
tail -1 $REPORT
