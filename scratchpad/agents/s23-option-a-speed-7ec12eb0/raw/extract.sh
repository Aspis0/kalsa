#!/usr/bin/env bash
# Per-turn summary TSV for the option-a speed run.
# Same tok/s computation as the baseline extract.sh (prefill = prompt_n /
# (promptMs/1000); decode = predictedPerSecond) with columns added for the
# option-a stats: engine_prefill, prefill_kv, cache types, attempt, failed,
# battery temp before, watchdog max temp.
set -u
. /tmp/s23-opta/env.sh
echo -e "label\tprompt\tthermal_state\tplat_thermal\tlvl\ttemp_pre_c\ttmax_c\tchunks\tactual_counts\tlayers_counts\tengine_prefill\tprefill_kv\tcache_k\tcache_v\tattempt\tfailed\tprefill_tok_s\tprompt_n\tn_common\tdecode_tok_s\tnpu_device\ttokens_predicted\tinterrupted"
for f in $OUT/opta-*-kalsa.txt; do
  label=$(basename $f -kalsa.txt)
  gov=$(grep "KALSA_GOVERNOR {" $f | tail -1 | sed 's/^.*KALSA_GOVERNOR //')
  tel=$(grep "KALSA_TELEMETRY " $f | tail -1 | sed 's/^.*KALSA_TELEMETRY //')
  kv=$(grep "KALSA_KVPREFIX" $f | tail -1 | sed 's/^.*KALSA_KVPREFIX //')
  case $label in *-l[0-9]) prompt=long;; *) prompt=short;; esac
  st=$(echo "$gov" | jq -r '.thermal_state // "?"')
  pt=$(echo "$gov" | jq -r '.platform_thermal_status // "?"')
  nd=$(echo "$gov" | jq -r '.npu_device // "null"')
  ep=$(echo "$gov" | jq -r '.engine_prefill // "?"')
  pkv=$(echo "$gov" | jq -r '.prefill_kv // "?"')
  ck=$(echo "$gov" | jq -r '.cache_type_k // "?"')
  cv=$(echo "$gov" | jq -r '.cache_type_v // "?"')
  att=$(echo "$gov" | jq -r '.attempt // "?"')
  fail=$(echo "$gov" | jq -r '.failed')
  chunks=$(echo "$gov" | jq -r '.route_chunks | length')
  act=$(echo "$gov" | jq -r '[.route_chunks[].actual] | group_by(.) | map("\(.[0])x\(length)") | join(",")')
  lay=$(echo "$gov" | jq -r '[.route_chunks[].layers_device] | group_by(.) | map("\(.[0])x\(length)") | join(",")')
  pn=$(echo "$tel" | jq -r '.prompt_n // -1')
  pms=$(echo "$tel" | jq -r '.promptMs // -1')
  dps=$(echo "$tel" | jq -r '.predictedPerSecond // -1')
  tp=$(echo "$tel" | jq -r '.tokensPredicted // -1')
  intr=$(echo "$tel" | jq -r '.interrupted')
  nc=$(echo "$kv" | grep -oE "n_common=[0-9]+" | cut -d= -f2)
  lvl=$(grep "^  level" $OUT/$label-battery-pre.txt | grep -oE "[0-9]+" | head -1)
  temp=$(grep "^  temperature" $OUT/$label-battery-pre.txt | grep -oE "[0-9]+" | head -1)
  tempc=$(awk "BEGIN{if (\"$temp\" != \"\") printf \"%.1f\", $temp/10; else print \"NA\"}")
  tmax=$(awk '{for(i=1;i<=NF;i++) if ($i ~ /^temp=/) {split($i,a,"="); if (a[2]+0 > m+0) m=a[2]+0}} END{if (m+0 > 0) printf "%.1f", m/10; else print "NA"}' $OUT/$label-watchdog.txt 2>/dev/null)
  pts="NA"
  if [ "$pn" != "-1" ] && awk "BEGIN{exit !($pms > 0)}" 2>/dev/null; then
    pts=$(awk "BEGIN{printf \"%.1f\", $pn/($pms/1000)}")
  fi
  echo -e "$label\t$prompt\t$st\t$pt\t$lvl\t$tempc\t$tmax\t$chunks\t$act\t$lay\t$ep\t$pkv\t$ck\t$cv\t$att\t$fail\t$pts\t$pn\t${nc:-NA}\t$dps\t$nd\t$tp\t$intr"
done
