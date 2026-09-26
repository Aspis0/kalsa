# kit.sh — push and verify everything the session needs on the device.
# One responsibility: the device holds a byte-verified kit, model, prompt and
# sampler, or the driver does not start. Each artifact is checked first and
# only (re)pushed when missing/mismatched, so a rerun on the same board is a
# few seconds of sha256 instead of a 1.59 GB push.
#
# Artifact identities come from npu-spec-verify/STEP0-V73-PREP.md (kit archive
# sha, engine f25f0c1c5) and qdc-heat-per-backend/PROMPT.meta (frozen prompt).

kit_file_sha() {
  # `|| true` inside the substitution: a missing file makes remote sha256sum
  # exit 1, and that "absent" answer is exactly the push trigger — it must
  # not trip set -e at the assignment.
  local out
  out=$(adbT 60 -s "$SER" shell "sha256sum $1" 2>/dev/null || true)
  printf '%s\n' "$out" | awk '{print $1; exit}'
}

# kit_ensure <host-file> <device-path> <expected-sha> <logname>
kit_ensure() {
  local host="$1" remote="$2" want="$3" got
  got=$(kit_file_sha "$remote")
  if [ "$got" = "$want" ]; then log "KIT_PRESENT $(basename "$remote")"; return 0; fi
  log "KIT_PUSH $(basename "$remote") sha_before=${got:-absent}"
  adbT 600 -s "$SER" push "$host" "$remote" >> "$RAW/${4}.log" 2>&1 || return 1
  got=$(kit_file_sha "$remote")
  [ "$got" = "$want" ] || { log "KIT_SHA_MISMATCH $(basename "$remote") got=${got:-absent}"; return 1; }
  return 0
}

kit_setup() {
  adbT 30 -s "$SER" shell "mkdir -p $D $HEAT_TMP && rm -f $HEAT_TMP/stop" >> "$RAW/setup.log" 2>&1 \
    || { log "MKDIR_FAIL"; return 1; }
  # Kit: SHA256SUMS lives in the archive root, so its presence+pass is the
  # unpacked-kit identity check (same trick as npu-spec-verify's d_run.sh).
  if ! adbT 60 -s "$SER" shell "cd $D && sha256sum -c SHA256SUMS" >> "$RAW/setup.log" 2>&1; then
    log "KIT_UNPACK_PUSH"
    adbT 600 -s "$SER" push "$KIT_TGZ" "$D/kit.tgz" >> "$RAW/setup.log" 2>&1 || { log "KIT_PUSH_FAIL"; return 1; }
    adbT 120 -s "$SER" shell "cd $D && tar -xzf kit.tgz && rm -f kit.tgz" >> "$RAW/setup.log" 2>&1 || { log "KIT_UNPACK_FAIL"; return 1; }
    adbT 60 -s "$SER" shell "cd $D && sha256sum -c SHA256SUMS" >> "$RAW/setup.log" 2>&1 || { log "KIT_CHECK_FAIL"; return 1; }
  fi
  kit_file_sha "$D/bin/llama-completion" > "$RAW/kit_completion_sha.txt" || true
  # Backend-name preflight: every later arm is keyed on these exact names
  # (`-dev GPUOpenCL`, `-dev HTP0`), so a kit whose list differs must stop the
  # session here, not void six arms one by one.
  if ! adbT 60 -s "$SER" shell "cd $D && export LD_LIBRARY_PATH=$D/lib && export ADSP_LIBRARY_PATH=$D/lib && export GGML_HEXAGON_NDEV=1 && export GGML_HEXAGON_VERBOSE=1 && ./bin/llama-completion --list-devices" > "$RAW/list_devices.txt" 2>&1; then
    log "LIST_DEVICES_CALL_FAIL"
    return 1
  fi
  if ! awk '/GPUOpenCL/{a=1} /HTP0: Hexagon/{b=1} END{exit !(a && b)}' "$RAW/list_devices.txt"; then
    log "DEVICE_LIST_FAIL need=GPUOpenCL+HTP0"
    return 1
  fi
  log "DEVICE_LIST_OK"
  kit_ensure "$MODEL" "$D/ship.gguf" "$MODEL_SHA" setup || { log "MODEL_SHA_FAIL"; return 1; }
  kit_ensure "$PROMPT_FILE" "$D/prompt.txt" "$PROMPT_SHA" setup || { log "PROMPT_SHA_FAIL"; return 1; }
  adbT 60 -s "$SER" push "$CELL/smp.sh" "$HEAT_TMP/smp.sh" >> "$RAW/setup.log" 2>&1 || { log "SMP_PUSH_FAIL"; return 1; }
  return 0
}
