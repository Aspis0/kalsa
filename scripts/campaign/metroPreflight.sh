#!/usr/bin/env bash
# Shared Metro provenance gate. Callers must set OUT and CAMPAIGN_ROOT and
# source the campaign libraries that provide log/die.

campaign_metro_preflight() {
  local evidence_dir gate_rc=0 recorded_evidence failure_hint
  evidence_dir=$(mktemp -d "$OUT/.metro-preflight.XXXXXX") || die "could not create Metro gate evidence directory"
  if [ -n "${CAMPAIGN_APK_PATH:-}" ]; then
    failure_hint="set CAMPAIGN_APK_PATH to the APK installed on the phone"
    node "$CAMPAIGN_ROOT/jsProvenance.mjs" --apk "$CAMPAIGN_APK_PATH" --evidence-dir "$evidence_dir" \
      >"$evidence_dir/stdout.txt" 2>"$evidence_dir/stderr.txt" || gate_rc=$?
  else
    failure_hint="set CAMPAIGN_METRO_BUNDLE_URL to the exact Android debug URL"
    node "$CAMPAIGN_ROOT/metroGate.mjs" --evidence-dir "$evidence_dir" \
      >"$evidence_dir/stdout.txt" 2>"$evidence_dir/stderr.txt" || gate_rc=$?
  fi
  printf '%s\n' "$gate_rc" > "$evidence_dir/exit-status.txt"
  recorded_evidence=$(sed -n 's/^metro gate evidence=//p' "$evidence_dir/stdout.txt" | tail -n 1 || true)
  printf '%s\n' "${recorded_evidence:-$evidence_dir}" >> "$OUT/metro-gate-evidence.txt"
  [ "$gate_rc" -eq 0 ] || die "JavaScript provenance gate failed before any device operation; $failure_hint; evidence=$evidence_dir"
  log "JavaScript provenance gate passed; evidence=$evidence_dir"
}
