#!/usr/bin/env bash
# usage: BOARD=x extract.sh > raw/$BOARD/all-rows.tsv — per-turn summary; prefill = prompt_n/(promptMs/1000), decode = predictedPerSecond (first round).
# text_tokens and n_common come from the FIRST KALSA_KVPREFIX line (the send itself). kill_after_s = watchdog KILL time minus Send time.
set -u; . "$(dirname "$0")/env.sh" 2>/dev/null || true
echo -e "board\tlabel\tkind\tprompt\ttext_tokens\tn_common\tplan_npu_lane\tplan_npu_fit\tplan_gpu_fit\tplan_avail_mib\tplan_avail_src\tgov_lines\tthermal_state\tchunks\tlayers_counts\tengine_prefill\tprefill_kv\tcache_k\tcache_v\tfailed\tprefill_tok_s\tprompt_n\tdecode_tok_s\ttokens_predicted\tskin_start\tskin_peak\tbatt_peak\tkill_after_s\tfallbacks\tcrash_lines\tlmk_lines\tcorrect"
for f in $OUT/*-kalsa.txt; do
  label=$(basename $f -kalsa.txt); P=$OUT/$label
  kind=$(cat $P-kind.txt 2>/dev/null || echo NA)
  case $label in *-long*) prompt=long;; *) prompt=short;; esac
  plan=$(grep "KALSA_GOVERNOR_PLAN " $f | tail -1 | sed 's/^.*KALSA_GOVERNOR_PLAN //')
  gov=$(grep "KALSA_GOVERNOR {" $f | tail -1 | sed 's/^.*KALSA_GOVERNOR //')
  ngov=$(grep -c "KALSA_GOVERNOR {" $f)
  tel=$(grep "KALSA_TELEMETRY " $f | head -1 | sed 's/^.*KALSA_TELEMETRY //')
  kv=$(sed '/KALSA_TELEMETRY /q' $f | grep "KALSA_KVPREFIX" | tail -1 | sed 's/^.*KALSA_KVPREFIX //')
  j() { echo "$1" | jq -r "$2" 2>/dev/null || echo "?"; }
  pl=$(j "$plan" '.npu_lane // "NA"'); pf=$(j "$plan" '.npu_fit // "NA"'); pg=$(j "$plan" '.gpu_fit // "NA"'); pa=$(j "$plan" '.available_mib // "NA"'); ps=$(j "$plan" '.available_src // "NA"')
  st=$(j "$gov" '.thermal_state // "NA"'); ch=$(j "$gov" '.route_chunks | length'); ly=$(j "$gov" '[.route_chunks[].layers_device] | group_by(.) | map("\(.[0])x\(length)") | join(",")')
  ep=$(j "$gov" '.engine_prefill // "NA"'); pkv=$(j "$gov" '.prefill_kv // "NA"'); ck=$(j "$gov" '.cache_type_k // "NA"'); cv=$(j "$gov" '.cache_type_v // "NA"'); fl=$(j "$gov" '.failed // "NA"')
  pn=$(j "$tel" '.prompt_n // -1'); pms=$(j "$tel" '.promptMs // -1'); dps=$(j "$tel" '.predictedPerSecond // -1'); tp=$(j "$tel" '.tokensPredicted // -1')
  tt=$(echo "$kv" | grep -oE "text_tokens=[0-9]+" | cut -d= -f2)
  nc=$(echo "$kv" | grep -oE "n_common=[0-9]+" | cut -d= -f2)
  pts=NA; awk "BEGIN{exit !(\"$pn\" > 0 && \"$pms\" > 0)}" 2>/dev/null && pts=$(awk "BEGIN{printf \"%.1f\", $pn/($pms/1000)}")
  s0=$(sed -n 's/.*skin_start=\([0-9.]*\).*/\1/p' $P-cool.txt 2>/dev/null)
  sp=$(awk '{for(i=1;i<=NF;i++) if ($i ~ /^skin=/) {split($i,a,"="); if (a[2]+0>m+0) m=a[2]+0}} END{if (m>0) printf "%.1f", m; else print "NA"}' $P-watchdog.txt 2>/dev/null)
  bp=$(awk '{for(i=1;i<=NF;i++) if ($i ~ /^batt=/) {split($i,a,"="); if (a[2]+0>m+0) m=a[2]+0}} END{if (m>0) printf "%.1f", m; else print "NA"}' $P-watchdog.txt 2>/dev/null)
  kl=$(sed -n 's/^\([0-9]*\) KILL.*/\1/p' $P-watchdog.txt 2>/dev/null | head -1); snd=$(cat $P-sendtime.txt 2>/dev/null)
  ka=NA; [ -n "$kl" ] && [ -n "$snd" ] && ka=$(( kl - snd ))
  fb=$(grep -cE "KALSA_GOVERNOR_FALLBACK|KALSA_GOVERNOR_RUNTIME_FALLBACK|KALSA_GOVERNOR_FAILED|KALSA_GPU_FALLBACK|Invalid" $f)
  cr=$(wc -l < $P-crash.txt 2>/dev/null | tr -d ' '); lm=$(wc -l < $P-lmk.txt 2>/dev/null | tr -d ' ')
  ans=$P-answer.txt; cor=NA
  if [ -s $ans ]; then
    if [ $prompt = long ]; then grep -q "The dominant factor" $ans && cor=yes || cor=no
    else n=$(sed -n '/^Thinking$/,$p' $ans | grep -v -e '^Thinking$' -e 'Show' -e '^Copy' -e '^Read aloud' | grep -oE '[.!?](\s|$)' | wc -l | tr -d ' '); cor="sent=$n"; fi
  fi
  echo -e "$BOARD\t$label\t$kind\t$prompt\t${tt:-NA}\t${nc:-NA}\t$pl\t$pf\t$pg\t$pa\t$ps\t$ngov\t$st\t$ch\t$ly\t$ep\t$pkv\t$ck\t$cv\t$fl\t$pts\t$pn\t$dps\t$tp\t${s0:-NA}\t$sp\t$bp\t$ka\t$fb\t$cr\t$lm\t$cor"
done
