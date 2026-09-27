# calibrate.sh — DEVICE CALIBRATION loop (audit2 NEW-1/NEW-2, owner decision:
# "stop guessing — this is what the phone runs first"). One responsibility:
# for each backend C/G/N ONCE: the proof run (-lv 5, few tokens) and a short
# measured run (n=16, same flags/verbosity as the production turn), with all
# stops live, NO heat rows, and a calibration report of the raw evidence the
# gates are made of.
#
# Outputs:
#   raw/<job>/calib/report.txt        per backend: proof status/tokens/counts
#                                     (execute-op, OpenCL assign/kernels) and
#                                     EVERY candidate fingerprint line family
#                                     from the measured log — fit, device,
#                                     system_info, buffer sizes, disabled.
#   raw/<job>/calib/<logs>            the pulled proof/turn logs per backend.
#   calib.ok (cell level)             htp_ops_floor_per_tok = 0.5 x measured
#                                     ops/token on the N proof; production
#                                     (d_run.sh) reads it as the NEW-1 floor
#                                     and keeps the prior 0.86 only until
#                                     this file exists.
# Deps provided by d_run.sh: cooldown_wait, start/stop_arm_poll, arm_load,
# arm_run, arm_parse_proof, arm_fingerprint, finish_stop, deadline_check,
# live_readings/hard_stops, log, write_end, RAW/CELL/JOB/DECODE_N, floor vars.

# Print every candidate fingerprint line of a measured log, family-tagged.
calib_candidates() {
  awk '
    /n_gpu_layers already set by user|failed to fit params/ { print "fit|" $0; next }
    /did not report memory/ { print "htpwarn|" $0; next }
    /using device|assigned to device|new session|default device|selected platform/ { print "device|" $0; next }
    /system_info:/ { print "sys|" $0; next }
    /model buffer size/ { print "buf|" $0; next }
    /offloaded [0-9]+\/[0-9]+ layers/ { print "off|" $0; next }
    /kernel set failed|device disabled/ { print "disabled|" $0; next }
  ' "$1" 2>/dev/null || true
}

calibrate_run() {
  local b tag line cands npu_ops="" npu_tokens=""
  local report="$RAW/calib/report.txt"
  mkdir -p "$RAW/calib"
  {
    printf 'qdc-heat-3way calibration job=%s utc=%s production_decode_n=%s short_n=16\n' \
      "$JOB" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$DECODE_N"
    printf 'htp_floor_prior_per_tok=%s (NEW-1: half of the lowest prior q57 1764/1024=1.72 ops/token; replaced by the measured pin below after this run)\n' "$HTP_FLOOR_PRIOR"
  } > "$report"
  log "CALIBRATE start (no heat rows; all stops live; report -> calib/report.txt)"
  for b in cpu gpu npu; do
    deadline_check
    tag="${JOB}-cal${b}"
    log "CALIB_START backend=$b tag=$tag"
    cd_rc=0
    cooldown_wait || cd_rc=$?
    [ "$cd_rc" -ne 2 ] || finish_stop
    start_arm_poll
    arm_load "$b" "$tag"
    if [ -f "$RAW/stop_request" ]; then stop_arm_poll; finish_stop; fi
    if [ "$ARM_LOAD_RC" -ne 0 ]; then
      log "CALIB_FAIL backend=$b load_rc=$ARM_LOAD_RC"
      stop_arm_poll
      write_end "calib_fail_load_$b"
      exit 3
    fi
    live_readings || true
    hard_stops || { stop_arm_poll; finish_stop; }
    arm_parse_proof "$tag" "$b"   # stats only: calibration reports gates, it does not apply them
    line=$(printf 'CALIB backend=%s phase=proof status=%s void=%s tokens=%s proof=%s fp=%s' \
      "$b" "$ARM_STATUS" "$ARM_VOID" "$PROOF_TOKENS" "$ARM_PROOF" "$ARM_PROOF_FP")
    log "$line"; printf '%s\n' "$line" >> "$report"
    if [ "$b" = npu ]; then
      npu_ops=$(printf '%s' "$ARM_PROOF" | sed -n 's/.*htp_ops=\([0-9][0-9]*\).*/\1/p')
      npu_tokens="$PROOF_TOKENS"
    fi
    # Short measured run: production flags/verbosity, n=16 — the candidate
    # lines below are exactly what production turns will contain.
    arm_run "$b" "$tag" 16
    if [ -f "$RAW/stop_request" ]; then stop_arm_poll; finish_stop; fi
    if [ "$ARM_RC" -ne 0 ]; then
      log "CALIB_FAIL backend=$b turn_rc=$ARM_RC"
      stop_arm_poll
      write_end "calib_fail_turn_$b"
      exit 3
    fi
    stop_arm_poll
    line=$(printf 'CALIB backend=%s phase=turn fp=%s' "$b" "$(arm_fingerprint "$RAW/$tag.log")")
    log "$line"; printf '%s\n' "$line" >> "$report"
    cands=$(calib_candidates "$RAW/$tag.log")
    if [ -n "$cands" ]; then
      printf '%s\n' "$cands" | sed "s/^/CALIB backend=$b cand=/" >> "$report"
    else
      printf 'CALIB backend=%s cand=NONE_AT_THIS_VERBOSITY\n' "$b" >> "$report"
    fi
    # Evidence lives under calib/ from here on.
    mv "$RAW/$tag".* "$RAW/calib/" 2>/dev/null || true
  done
  # NEW-1 pin: measured floor = half the observed ops/token on the N proof
  # (same 50% rationale as the prior). Without N numbers there is no pin and
  # calibration is a failure, not a maybe.
  if [ -z "$npu_ops" ] || [ -z "$npu_tokens" ] || [ "$npu_ops" -eq 0 ] 2>/dev/null || [ "$npu_tokens" -eq 0 ] 2>/dev/null; then
    log "CALIB_FAIL no NPU execute-op/token numbers (ops=${npu_ops:-na} tokens=${npu_tokens:-na})"
    write_end calib_fail_npu_proof
    exit 3
  fi
  local floor
  floor=$(awk -v o="$npu_ops" -v t="$npu_tokens" 'BEGIN{printf "%.4f", 0.5 * o / t}')
  {
    printf 'htp_ops_floor_per_tok=%s\n' "$floor"
    printf 'measured_npu_ops=%s\nmeasured_npu_tokens=%s\n' "$npu_ops" "$npu_tokens"
    printf 'calibrated_utc=%s\njob=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$JOB"
  } > "$CELL/calib.ok"
  log "CALIB_DONE floor_htp_ops_per_tok=$floor (measured $npu_ops ops / $npu_tokens tokens; pinned in calib.ok)"
  write_end calibrated
  exit 0
}
