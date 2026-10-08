# Proof of the S23 hard-reset cause: the EXACT resetting config (arm L, gpu leg, --gen 8193 -> n_ctx 8960, three leg
# contexts, FA off, f16 KV) on the FIXED bench (engine fbf33176c: arm L no longer keeps a 512 KB logits row per token).
# Expected: bench RssAnon flat after load, MemAvailable flat, no reset past window 46 (~1500 tokens); cut at CUT_S.
# Bench RSS/MemAvailable every 5 s and zones at 1 Hz, synced. Skin stop 43 (if it stops before window 60 the proof is
# not made: run it unplugged from a cool start).
#   (nohup sh -c ". /data/local/tmp/govhtp/step5-s23/run-reset-proof.sh" > /data/local/tmp/govhtp/step5-s23/proof.out 2>&1 < /dev/null &)
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step5-s23/env.sh
D=$R/step5-s23; REPORT=$D/proof_report.txt; B=$D/r3f/governor-bench; LOG=$D/proof_gb_gpu.log; CUT_S=300; SKIN_KILL=43
skin_now() { dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p'; }
rm -f $REPORT
echo "== proof start $(date) boot $(cat /proc/sys/kernel/random/boot_id) bench $(sha256sum $B | cut -c1-12) [$(st)]" >> $REPORT
ZS=$D/proof_zones.stop; sh $D/zone-logger.sh $D/proof_zones.csv $ZS &
( while [ ! -e $ZS ]; do
    p=$(pgrep -f '^/data/local/tmp/govhtp/step5-s23/r3f/' | head -1)
    echo "$(date +%s) $(grep -E '^MemAvailable' /proc/meminfo | tr -s ' ') $([ -n "$p" ] && grep -E '^(RssAnon|RssFile)' /proc/$p/status | tr -s ' \t' ' ' | tr '\n' ' ')" >> $D/proof_mem.txt
    sync
    s=$(skin_now); s=${s%.*}
    [ -n "$s" ] && [ "$s" -ge $SKIN_KILL ] && { pkill -f r3f/governor-bench; echo "SKIN KILL $s $(date +%s)" >> $REPORT; }
    input keyevent 224; wm dismiss-keyguard
    sleep 5
  done ) &
echo "## start $(date +%s) [$(st)]" >> $REPORT; sync
ADSP_LIBRARY_PATH="$D/r3/dsp;$R/lib" arm_env_legs timeout $CUT_S $B --arm L -m $M -t 5 -r 1 --hop 32 --legs gpu --gen 8193 -v > $LOG 2>&1
rc=$?
echo "## exit=$rc (124 = cut by timeout) end $(date +%s) windows=$(grep -c '^leg_window' $LOG) [$(st)]" >> $REPORT
touch $ZS
echo "== proof end $(date)" >> $REPORT
echo "SESSION COMPLETE"
