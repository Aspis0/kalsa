# S23 hard-reset repro, round 2 (2026-10-08). Round 1 (run-reset-repro.sh): gb_gpu RESET again at window 46 (plugged,
# cool) with MemAvailable falling ~800 -> 411 MB during decode; gb_cpu cut by the skin stop at the same window
# (inconclusive); the two one-copy llama-bench steps were INVALID (my script: plain llama-bench cannot build the
# one-copy load - "token_embd_norm.weight landed in OpenCL"); lb_gpu (GPUOpenCL alone, ONE context, n_ctx 8960)
# survived past position 2048 with ~1.6 GB available. Working hypothesis: memory exhaustion is the precondition.
#   mem_ctl     governor-bench gpu leg --gen 2049 (n_ctx 2816, never reset): the MemAvailable series to compare
#   mem_squeeze the same SURVIVING config with an anonymous-memory hog holding HOG_MB, so MemAvailable sits where
#               the resetting run ended (~400 MB): a reset here = memory pressure is causal, not n_ctx itself
#   lb_npu      llama-bench HTP0 two-copy (no shared env), n_ctx 8960, FA off f16: the pre-one-copy NPU path
#   lb_npu_app  the same with the APP's KV config (FA on, K q8_0 / V q4_0)
#   gb_cpu2     the cpu leg again, from a cooler start (round 1 was cut by the skin stop at window 46)
# Same RESUMABLE state/zones/meminfo machinery as round 1 (its own files: repro2_*).
#   (nohup sh -c ". /data/local/tmp/govhtp/step5-s23/run-reset-repro2.sh" > /data/local/tmp/govhtp/step5-s23/repro2.out 2>&1 < /dev/null &)
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step5-s23/env.sh
D=$R/step5-s23; REPORT=$D/repro2_report.txt; STATE=$D/repro2_state.txt; GB=$D/bin/governor-bench-hw
LB=$D/repro/llama-bench; LB_DSP=$D/repro/dsp; SKIN_KILL=43; COOL_SKIN=33; CUT_S=300; HOG_MB=${HOG_MB:-1200}
grep -qE "^(end|reset) gb_gpu_4k " $D/repro_state.txt 2>/dev/null || { echo "REFUSED: repro round 1 has not ended"; return 1 2>/dev/null || exit 1; }
skin_now() { dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p'; }
mark() { echo "$1 $(date +%s)" >> $STATE; sync; }
touch $STATE
echo "== repro2 start $(date) boot $(cat /proc/sys/kernel/random/boot_id) gb $(sha256sum $GB | cut -c1-12) lb $(sha256sum $LB | cut -c1-12) [$(st)]" >> $REPORT
for s in $(sed -nE 's/^begin ([a-z0-9_]+) .*/\1/p' $STATE); do
  grep -q "^end $s " $STATE || grep -q "^reset $s " $STATE || { mark "reset $s"; echo "RESET during step $s (begin without end; previous boot)" >> $REPORT; }
done
pkill -f "tail -n 1" 2>/dev/null
sync

ZS=$D/repro2_zones.stop; sh $D/zone-logger.sh $D/repro2_zones.csv $ZS &
( while [ ! -e $ZS ]; do
    # who grows: system MemAvailable falls ~3 MB/s during decode at n_ctx 4864 and 8960 alike (round 1), so log the
    # bench's own RSS and the GPU driver's global page pool next to it
    p=$(pgrep -f '^/data/local/tmp/govhtp/step5-s23/(bin|repro)/' | head -1)  # not `timeout`, whose args match too
    rss=$([ -n "$p" ] && grep -E '^VmRSS' /proc/$p/status | tr -s ' ' | cut -d' ' -f2)
    echo "$(date +%s) $(grep -E '^(MemAvailable|MemFree|Unevictable|CmaFree|SwapFree)' /proc/meminfo | tr -s ' ' | tr '\n' ' ') bench_rss_kb=$rss kgsl_page_alloc=$(cat /sys/class/kgsl/kgsl/page_alloc) kgsl_mapped=$(cat /sys/class/kgsl/kgsl/mapped) kgsl_vmalloc=$(cat /sys/class/kgsl/kgsl/vmalloc)" >> $D/repro2_mem.txt
    sync
    s=$(skin_now); s=${s%.*}
    [ -n "$s" ] && [ "$s" -ge $SKIN_KILL ] && { pkill -f governor-bench; pkill -f repro/llama-bench; echo "SKIN KILL $s $(date +%s)" >> $REPORT; }
    input keyevent 224; wm dismiss-keyguard
    sleep 5
  done ) &

lb() {  # plain llama-bench, ONE context, n_ctx 8960, decode from depth 512
  ADSP_LIBRARY_PATH="$LB_DSP;$R/lib" timeout $CUT_S $LB -m $M -ngl 99 -t 5 -r 1 -p 0 -n 8448 -d 512 -v "$@"
}
gb() {
  ADSP_LIBRARY_PATH="$DSP_REL;$R/lib" arm_env_legs timeout $CUT_S $GB --arm L -m $M -t 5 -r 1 --hop 32 -v "$@"
}
hog_gb() {  # an anonymous-memory hog (toybox tail buffers a newline-free stream) held for the whole run; RANDOM bytes:
  # zero pages cost nothing in the S23's zram swap (same-filled pages), so a /dev/zero hog would press on nothing
  tr -d '\n' < /dev/urandom | head -c $((HOG_MB * 1048576)) | tail -n 1 > /dev/null &
  sleep 45
  echo "hog up: $(grep -E '^MemAvailable' /proc/meminfo)" >> $REPORT
  gb "$@"; rc=$?
  pkill -f "tail -n 1"
  return $rc
}
step() {  # name, then the command
  name=$1; shift
  grep -qE "^(end|reset) $name " $STATE && return 0
  waited=0
  while :; do
    s=$(skin_now); s=${s%.*}
    [ -n "$s" ] && [ "$s" -le $COOL_SKIN ] && break
    [ $waited -ge 1500 ] && { echo "cool wait gave up at skin $s" >> $REPORT; break; }
    sleep 30; waited=$((waited + 30))
  done
  echo "## $name start $(date +%s) after ${waited}s cool wait [$(st)]" >> $REPORT; sync
  mark "begin $name"
  "$@" > $D/repro2_$name.log 2>&1; rc=$?
  mark "end $name exit=$rc"
  echo "## $name exit=$rc (124 = cut by timeout: survived past the reset position) end $(date +%s) [$(st)]" >> $REPORT
  grep -E 'leg_total|tg8448|error|abort|GGML_ASSERT' $D/repro2_$name.log | tail -3 | cut -c1-240 >> $REPORT
  echo "windows: $(grep -c '^leg_window' $D/repro2_$name.log)" >> $REPORT
  sync
}
step mem_ctl     gb --legs gpu --gen 2049
step mem_squeeze hog_gb --legs gpu --gen 2049
step lb_npu      lb -dev HTP0 -fa 0 -ctk f16 -ctv f16
step lb_npu_app  lb -dev HTP0 -fa 1 -ctk q8_0 -ctv q4_0
COOL_SKIN=30
step gb_cpu2     gb --legs cpu --gen 8193
touch $ZS
echo "== repro2 end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE"
