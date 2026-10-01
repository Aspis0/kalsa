#!/usr/bin/env bash
# Emit a TSV row per turn from $OUT/<label>-kalsa.txt extracts.
# Columns: label prefill_engine decode_engine prompt_n prefill_tok_s decode_tok_s ttft_ms
#          npu_device npu_fallback fallback_line governor_lines
set -u
. /tmp/s23-gov/env.sh
echo -e "label\tprefill_engine\tdecode_engine\tprompt_n\tprefill_tok_s\tdecode_tok_s\tttft_ms\tnpu_device\tnpu_fallback\tfallback_line\tgovernor_lines"
for f in $OUT/*-kalsa.txt; do
  label=$(basename $f -kalsa.txt)
  gov=$(grep "KALSA_GOVERNOR {" $f | tail -1 | sed 's/^.*KALSA_GOVERNOR //')
  tel=$(grep "KALSA_TELEMETRY " $f | tail -1 | sed 's/^.*KALSA_TELEMETRY //')
  fb=$(grep -c "KALSA_GOVERNOR_FALLBACK" $f)
  ngov=$(grep -c "KALSA_GOVERNOR {" $f)
  pe=$(echo "$gov" | jq -r '.engine_prefill // "NONE"' 2>/dev/null)
  de=$(echo "$gov" | jq -r '.engine_decode // "NONE"' 2>/dev/null)
  nd=$(echo "$gov" | jq -r '.npu_device // "null"' 2>/dev/null)
  nf=$(echo "$gov" | jq -r '.npu_fallback // "null"' 2>/dev/null)
  pn=$(echo "$tel" | jq -r '.prompt_n // -1' 2>/dev/null)
  pms=$(echo "$tel" | jq -r '.promptMs // -1' 2>/dev/null)
  dps=$(echo "$tel" | jq -r '.predictedPerSecond // -1' 2>/dev/null)
  pts="NA"
  if [ "$pn" != "-1" ] && [ "$pms" != "-1" ] && [ "$pms" != "null" ] && awk "BEGIN{exit !($pms > 0)}" 2>/dev/null; then
    pts=$(awk "BEGIN{printf \"%.1f\", $pn/($pms/1000)}")
  fi
  echo -e "$label\t$pe\t$de\t$pn\t$pts\t$dps\t$pms\t$nd\t$nf\t$fb\t$ngov"
done
