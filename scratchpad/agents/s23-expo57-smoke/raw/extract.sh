#!/usr/bin/env bash
# Per-turn summary TSV for the layers_device proof.
# Columns: label prompt state plat_thermal lvl chunks actual_counts layers_counts
#          prefill_tok_s prompt_n n_common decode_tok_s npu_device dur_s
set -u
. /tmp/s23-smoke/env.sh
echo -e "label\tprompt\tthermal_state\tplat_thermal\tbat_lvl\tchunks\tactual_counts\tlayers_counts\tprefill_tok_s\tprompt_n\tn_common\tdecode_tok_s\tnpu_device\tdur_s"
for f in $OUT/proof-*-kalsa.txt; do
  label=$(basename $f -kalsa.txt)
  gov=$(grep "KALSA_GOVERNOR {" $f | tail -1 | sed 's/^.*KALSA_GOVERNOR //')
  tel=$(grep "KALSA_TELEMETRY " $f | tail -1 | sed 's/^.*KALSA_TELEMETRY //')
  kv=$(grep "KALSA_KVPREFIX" $f | tail -1 | sed 's/^.*KALSA_KVPREFIX //')
  case $label in *-l[0-9]) prompt=long;; *) prompt=short;; esac
  st=$(echo "$gov" | jq -r '.thermal_state // "?"')
  pt=$(echo "$gov" | jq -r '.platform_thermal_status // "?"')
  nd=$(echo "$gov" | jq -r '.npu_device // "null"')
  chunks=$(echo "$gov" | jq -r '.route_chunks | length')
  act=$(echo "$gov" | jq -r '[.route_chunks[].actual] | group_by(.) | map("\(.[0])x\(length)") | join(",")')
  lay=$(echo "$gov" | jq -r '[.route_chunks[].layers_device] | group_by(.) | map("\(.[0])x\(length)") | join(",")')
  pn=$(echo "$tel" | jq -r '.prompt_n // -1')
  pms=$(echo "$tel" | jq -r '.promptMs // -1')
  dps=$(echo "$tel" | jq -r '.predictedPerSecond // -1')
  nc=$(echo "$kv" | grep -oE "n_common=[0-9]+" | cut -d= -f2)
  lvl=$(grep "^  level" $OUT/$label-battery-pre.txt | grep -oE "[0-9]+" | head -1)
  pts="NA"
  if [ "$pn" != "-1" ] && awk "BEGIN{exit !($pms > 0)}" 2>/dev/null; then
    pts=$(awk "BEGIN{printf \"%.1f\", $pn/($pms/1000)}")
  fi
  dur="see-log"
  echo -e "$label\t$prompt\t$st\t$pt\t$lvl\t$chunks\t$act\t$lay\t$pts\t$pn\t${nc:-NA}\t$dps\t$nd\t$dur"
done
