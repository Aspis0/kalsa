# dryrun-core.sh — happy path, registered orders, proof thresholds and
# fingerprint gates (sourced by dryrun.sh after dryrun-lib.sh).

echo "== fixture: six-arms (registered order CGNNGC, seeded stayon=1) =="
run_fixture six-arms CGNNGC seed_stayon
eq "six rc" 0 "$RC"
assert_end six exit_0
eq "six rows" 6 "$(rows)"
eq "six arm sequence" "cpu gpu npu npu gpu cpu" "$(awk -F'\t' 'NR>1 {printf "%s%s", sep, $2; sep=" "}' "$RAW/results.tsv" 2>/dev/null)"
eq "six pairs" "1 1 2 2 3 3" "$(awk -F'\t' 'NR>1 {printf "%s%s", sep, $1; sep=" "}' "$RAW/results.tsv" 2>/dev/null)"
eq "six all-OK" "" "$(all_ok)"
has "six perf-prefix A1" "I common_perf_print:" "$(cat "$RAW/dry-six-arms-t1cpu.log")"
has "six inload-parsed A8" "inload_ms=9876.50" "$(cat "$RAW/driver.log")"
eq "six prompt_n" 1018 "$(col 1 21)"
eq "six decode_runs" 126 "$(col 1 23)"
eq "six cpu prefill" 45000.00 "$(col 1 22)"
eq "six gpu prefill" 14000.00 "$(col 2 22)"
eq "six npu prefill" 18000.00 "$(col 3 22)"
has "six cpu proof" cpu_no_offload "$(col 1 25)"
has "six cpu fingerprint (placement)" "fp=buf=CPU off=0/33 thr=5" "$(col 1 25)"
has "six gpu proof assign" gpu_assigned_lines= "$(col 2 25)"
has "six gpu proof kernels" "kernels=" "$(col 2 25)"
has "six gpu fingerprint (placement)" "fp=buf=GPUOpenCL off=33/33 thr=5" "$(col 2 25)"
has "six npu proof arch" "arch=v73" "$(col 3 25)"
has "six npu proof ops" "htp_ops=1200" "$(col 3 25)"
has "six npu fingerprint (placement)" "fp=buf=HTP0 off=33/33 thr=5" "$(col 3 25)"
has "six npu scaled floor" "min=4" "$(col 3 25)"    # NEW-1: ceil(0.86 x 4 proof tokens)
eq "six skin_before" 33.5 "$(col 1 14)"
eq "six load_skin_before A8" 33.5 "$(col 1 11)"
eq "six load_skin_after A8" 33.5 "$(col 1 12)"
eq "six pagein_cold arm1" 1 "$(col 1 13)"
eq "six pagein_cold arm2" 0 "$(col 2 13)"
ne "six load_wall_s" na "$(col 1 10)"
eq "six samples.txt" yes "$([ -f "$RAW/samples.txt" ] && echo yes || echo no)"
eq "six list-devices" yes "$([ -f "$RAW/list_devices.txt" ] && echo yes || echo no)"
has "six sampler-paused A11 NEW-6" "SAMPLER_PAUSE_CONFIRMED" "$(cat "$RAW/driver.log")"
has "six sampler-resumed A11" "SAMPLER_RESUMED" "$(cat "$RAW/driver.log")"
has "six pgrep selftest NEW-4" "PGREP_SELFTEST_OK" "$(cat "$RAW/driver.log")"
has "six floor source (until calibrated)" "source=prior(no calib.ok" "$(cat "$RAW/driver.log")"
count_is "six single sampler header" 1 "H zones" "$RAW/samples.txt"
# 1 initial launch + one resume per measured turn (6 arms) — A-11 in action
count_is "six sampler launches" 7 "H sampler_start" "$RAW/samples.txt"
assert_restore six
eq "six stayon-restored" 1 "$(cat "$STATE/stay_on_while_plugged_in" 2>/dev/null || echo missing)"
assert_clean_shell six

echo "== fixture A-13: unregistered/odd orders are rejected =="
set +e
env ADB_BIN="$CELL/dryrun-adb.sh" ADB_PORT=5037 bash "$CELL/d_run.sh" dry-badorder CGN 20 >/dev/null 2>&1
eq "odd order CGN rejected" 2 "$?"
env ADB_BIN="$CELL/dryrun-adb.sh" ADB_PORT=5037 bash "$CELL/d_run.sh" dry-badorder CCCC 20 >/dev/null 2>&1
eq "unregistered pair CC rejected" 2 "$?"
set -e

echo "== fixture: missing HTP proof voids the N proof run (A6) =="
run_fixture no-htp NN DRY_NO_HTP_PROOF=1
eq "nohtp rc" 0 "$RC"
assert_end nohtp method_void_no_htp_proof
eq "nohtp rows" 1 "$(rows)"
eq "nohtp status" VOID "$(col 1 4)"
eq "nohtp void_reason" no_htp_proof "$(col 1 5)"
eq "nohtp backend" npu "$(col 1 2)"
assert_restore nohtp

echo "== fixture: execute-op below the SCALED floor voids the N proof run (NEW-1) =="
run_fixture htp-low NN DRY_HTP_OPS=2
eq "htplow rc" 0 "$RC"
eq "htplow rows" 1 "$(rows)"
eq "htplow void_reason" htp_ops_low "$(col 1 5)"
has "htplow scaled proof count" "htp_ops=2 min=4" "$(col 1 25)"
assert_end htplow method_void_htp_ops_low
assert_restore htp-low

echo "== fixture: missing GPU placement evidence voids the G proof run (A6) =="
run_fixture no-gpu GC DRY_NO_GPU_PROOF=1
eq "nogpu rc" 0 "$RC"
eq "nogpu rows" 1 "$(rows)"
eq "nogpu status" VOID "$(col 1 4)"
eq "nogpu void_reason" no_gpu_proof "$(col 1 5)"
assert_end nogpu method_void_no_gpu_proof
assert_restore nogpu

echo "== fixture: GPU kernel-dispatch below the 8 floor voids the G proof run (A6) =="
run_fixture gpu-exec-low GC DRY_GPU_KERNELS=3
eq "gpuex rc" 0 "$RC"
eq "gpuex rows" 1 "$(rows)"
eq "gpuex void_reason" gpu_exec_low "$(col 1 5)"
assert_end gpuex method_void_gpu_exec_low
assert_restore gpu-exec-low

echo "== fixture: kernel-build failure line voids the G proof run (A6) =="
run_fixture gpu-disabled GC DRY_GPU_DISABLED=1
eq "gpudis rc" 0 "$RC"
eq "gpudis rows" 1 "$(rows)"
eq "gpudis void_reason" gpu_disabled "$(col 1 5)"
assert_end gpudis method_void_gpu_disabled
assert_restore gpu-disabled

echo "== fixture: CPU placement proof absent in the proof run (A15) =="
run_fixture no-cpu CG DRY_NO_CPU_PROOF=1
eq "nocpu rc" 0 "$RC"
eq "nocpu rows" 1 "$(rows)"
eq "nocpu void_reason" no_cpu_proof "$(col 1 5)"
assert_end nocpu method_void_no_cpu_proof
assert_restore nocpu

echo "== fixture: turn PLACEMENT differs from the proof run -> backend_mismatch (NEW-3) =="
run_fixture backend-mismatch GC DRY_TURN_FP_BUF=CPU
eq "bfp rc" 0 "$RC"
eq "bfp rows" 1 "$(rows)"
eq "bfp void_reason" backend_mismatch "$(col 1 5)"
has "bfp turn says CPU" "fp_turn=buf=CPU" "$(col 1 25)"
has "bfp proof says GPUOpenCL" "fp_proof=buf=GPUOpenCL" "$(col 1 25)"
assert_end bfp method_void_backend_mismatch
assert_restore backend-mismatch

echo "== fixture: turn log without fingerprint -> no_fingerprint (fail closed) =="
run_fixture no-fingerprint GC DRY_TURN_NO_FP=1
eq "nfp rc" 0 "$RC"
eq "nfp rows" 1 "$(rows)"
eq "nfp void_reason" no_fingerprint "$(col 1 5)"
assert_end nfp method_void_no_fingerprint
assert_restore no-fingerprint

echo "== fixture: kernel-disable line in the TURN log voids it too (NEW-3) =="
run_fixture turn-disabled GC DRY_TURN_DISABLED=1
eq "tdis rc" 0 "$RC"
eq "tdis rows" 1 "$(rows)"
eq "tdis void_reason" turn_backend_disabled "$(col 1 5)"
assert_end tdis method_void_turn_backend_disabled
assert_restore turn-disabled

echo "== fixture: cooldown is a cap only (warm_start flagged, no cool-start gate) =="
run_fixture warm-start CG DRY_SKIN_AT=1 DRY_SKIN_AFTER=38 COOL_MAX_S=2
eq "warm rc" 0 "$RC"
assert_end warm exit_0
eq "warm rows" 2 "$(rows)"
eq "warm all-OK" "" "$(all_ok)"
eq "warm warm_start" 1 "$(col 1 6)"
eq "warm cooldown_s" 2 "$(col 1 7)"
eq "warm skin_before recorded" 38 "$(col 1 14)"
assert_restore warm

echo "== fixture: CALIBRATE=1 mode (proof + short run per backend, no heat rows) =="
run_fixture calibrate CGN CALIBRATE=1
eq "cal rc" 0 "$RC"
assert_end cal calibrated
eq "cal no heat rows" absent "$([ -f "$RAW/results.tsv" ] && echo present || echo absent)"
eq "cal report written" yes "$([ -f "$RAW/calib/report.txt" ] && echo yes || echo no)"
has "cal proof stats cpu" "CALIB backend=cpu phase=proof" "$(cat "$RAW/calib/report.txt")"
has "cal proof stats npu (ops+tokens)" "tokens=4 proof=htp_ops=1200" "$(cat "$RAW/calib/report.txt")"
has "cal turn fingerprint cpu" "CALIB backend=cpu phase=turn fp=buf=CPU off=0/33 thr=5" "$(cat "$RAW/calib/report.txt")"
has "cal candidate buffer line" "cand=buf|" "$(cat "$RAW/calib/report.txt")"
has "cal candidate fit line" "cand=fit|" "$(cat "$RAW/calib/report.txt")"
has "cal candidate device line" "cand=device|" "$(cat "$RAW/calib/report.txt")"
eq "cal logs moved into calib/" yes "$([ -f "$RAW/calib/dry-calibrate-calcpu.log" ] && echo yes || echo no)"
eq "cal floor pinned (0.5 x 1200/4)" "htp_ops_floor_per_tok=150.0000" "$(grep '^htp_ops_floor_per_tok=' "$CELL/calib.ok" 2>/dev/null)"
assert_restore cal

echo "== fixture: production reads the PINNED floor from calib.ok =="
run_fixture pinned-floor NN seed_calib_ok DRY_HTP_OPS=500
eq "pin rc" 0 "$RC"
assert_end pin method_void_htp_ops_low
eq "pin rows" 1 "$(rows)"
has "pin floor came from calib.ok" "source=calib.ok" "$(cat "$RAW/driver.log")"
has "pin scaled min=600" "htp_ops=500 min=600" "$(col 1 25)"
assert_restore pinned-floor

