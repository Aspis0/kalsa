# S23 hard-reset reproduction (owner authorised 2026-10-08). Two PMIC hard resets (reboot_reason 0x4) hit after
# exactly ~1504 generated tokens (window 46, KV position ~2016) of governor-bench arm L --gen 8193 (n_ctx 8960,
# FA off, f16 KV, one sustained leg), once on the npu leg and once on the gpu leg; --gen 2049 never reset.
# Steps (diagnose-hardreset-n2.md section 5), each a separator; each is cut by `timeout` well past position 2048:
#   gb_gpu      the exact config that reset (bench governor-bench-hw, gpu leg)       -> is it deterministic?
#   gb_cpu      same, cpu leg (the KV and attention never touch a device)             -> device or not?
#   lb_j1_fa0   llama-bench, one-copy J(1) load, ONE context, n_ctx 8960, FA off, f16  -> governor's 3 contexts or not?
#   lb_j1_app   same with the APP's KV config: FA on, K q8_0 / V q4_0                 -> can the app hit it?
#   lb_gpu      llama-bench, GPUOpenCL alone (no HTP import, no rpcmem), FA off, f16 -> HTP imports or not?
#   gb_gpu_4k   governor-bench gpu leg, --gen 4097 (n_ctx 4864)                       -> n_ctx threshold
# RESUMABLE: state lines are synced before and after every step; after a reset re-launch the script and it records
# the step that was running as RESET and continues with the next one. Zones at 1 Hz (zone-logger.sh) and meminfo
# every 5 s are synced, so the last seconds before a reset survive. Plugged or not: correctness/reset only, no speed.
#   (nohup sh -c ". /data/local/tmp/govhtp/step5-s23/run-reset-repro.sh" > /data/local/tmp/govhtp/step5-s23/repro.out 2>&1 < /dev/null &)
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step5-s23/env.sh
D=$R/step5-s23; REPORT=$D/repro_report.txt; STATE=$D/repro_state.txt; GB=$D/bin/governor-bench-hw
LB=$D/repro/llama-bench; LB_DSP=$D/repro/dsp; SKIN_KILL=43; COOL_SKIN=33; CUT_S=300
grep -q "== vcorner end" $D/vcorner_report.txt 2>/dev/null || { echo "REFUSED: the vcorner campaign has not ended"; return 1 2>/dev/null || exit 1; }
skin_now() { dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p'; }
mark() { echo "$1 $(date +%s)" >> $STATE; sync; }
touch $STATE
echo "== repro start $(date) boot $(cat /proc/sys/kernel/random/boot_id) reason $(getprop ro.boot.bootreason) gb $(sha256sum $GB | cut -c1-12) lb $(sha256sum $LB | cut -c1-12) [$(st)]" >> $REPORT
for s in $(sed -nE 's/^begin ([a-z0-9_]+) .*/\1/p' $STATE); do
  grep -q "^end $s " $STATE || grep -q "^reset $s " $STATE || { mark "reset $s"; echo "RESET during step $s (begin without end; previous boot)" >> $REPORT; }
done
sync

ZS=$D/repro_zones.stop; sh $D/zone-logger.sh $D/repro_zones.csv $ZS &
( while [ ! -e $ZS ]; do
    echo "$(date +%s) $(grep -E '^(MemAvailable|Shmem|Unevictable|CmaFree)' /proc/meminfo | tr -s ' ' | tr '\n' ' ') dmabuf_kb=$(cat /sys/kernel/dmabuf/total_pools_kb 2>/dev/null)" >> $D/repro_mem.txt
    sync
    s=$(skin_now); s=${s%.*}
    [ -n "$s" ] && [ "$s" -ge $SKIN_KILL ] && { pkill -f governor-bench; pkill -f repro/llama-bench; echo "SKIN KILL $s $(date +%s)" >> $REPORT; }
    input keyevent 224; wm dismiss-keyguard
    sleep 5
  done ) &

lb() {  # one context, the J(1) one-copy load unless the step overrides -dev
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 GGML_OP_OFFLOAD_MIN_BATCH=1 \
      GGML_HEXAGON_ADMIT_OPS=7 ADSP_LIBRARY_PATH="$LB_DSP;$R/lib" \
      timeout $CUT_S $LB -m $M -ngl 99 -t 5 -r 1 -p 0 -n 8448 -d 512 -v "$@"
}
gb() {
  ADSP_LIBRARY_PATH="$DSP_REL;$R/lib" arm_env_legs timeout $CUT_S $GB --arm L -m $M -t 5 -r 1 --hop 32 -v "$@"
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
  "$@" > $D/repro_$name.log 2>&1; rc=$?
  mark "end $name exit=$rc"
  echo "## $name exit=$rc (124 = cut by timeout: survived past the reset position) end $(date +%s) [$(st)]" >> $REPORT
  grep -E 'leg_total|leg_summary|tg8448|abort|error|GGML_ASSERT' $D/repro_$name.log | tail -4 | cut -c1-240 >> $REPORT
  echo "windows: $(grep -c '^leg_window' $D/repro_$name.log)" >> $REPORT
  sync
}
step gb_gpu    gb --legs gpu --gen 8193
step gb_cpu    gb --legs cpu --gen 8193
step lb_j1_fa0 lb -dev HTP0/GPUOpenCL -fa 0 -ctk f16 -ctv f16
step lb_j1_app lb -dev HTP0/GPUOpenCL -fa 1 -ctk q8_0 -ctv q4_0
step lb_gpu    lb -dev GPUOpenCL -fa 0 -ctk f16 -ctv f16
step gb_gpu_4k gb --legs gpu --gen 4097
touch $ZS
echo "== repro end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE"
