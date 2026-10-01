#!/usr/bin/env bash
# Arm x prompt medians from the per-turn rows parse.sh emits.
set -u
. /tmp/s23-gov/env.sh
bash /tmp/s23-gov/parse.sh > $OUT/all-rows.tsv
awk -F'\t' 'NR>1 && $4 != "-1" {
  split($1, a, "-"); arm=a[1]; p=(substr(a[2],1,1)=="s") ? "short" : "long";
  k = arm "/" p; n[k]++;
  c = n[k];
  pts[k "," c] = ($5=="NA") ? 0 : $5;
  dps[k "," c] = $6; ttft[k "," c] = $7;
}
END {
  print "arm\tprompt\tn\tmed_prefill_tok_s\tmed_decode_tok_s\tmed_ttft_ms";
  for (k in n) {
    c = n[k];
    printf "%s\t%s\t%d\t%.1f\t%.2f\t%.0f\n", substr(k,1,index(k,"/")-1), substr(k,index(k,"/")+1), c, med(pts,k,c), med(dps,k,c), med(ttft,k,c);
  }
}
function med(A, k, c,   i,j,t,ki,kj,tmp,m) {
  for (i=1;i<=c;i++) tmp[i]=A[k "," i];
  for (i=1;i<c;i++) for (j=i+1;j<=c;j++) { ki=k "," j; kj=k "," i; if (tmp[j]<tmp[i]) { t=tmp[i]; tmp[i]=tmp[j]; tmp[j]=t } }
  m = int(c/2);
  return (c%2==1) ? tmp[m+1] : (tmp[m]+tmp[m+1])/2;
}' $OUT/all-rows.tsv | sort
