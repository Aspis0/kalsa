# ram NAME: sample the memory of the running llama-bench every 2 s until it exits, then append the
# per-column maximum to $REPORT (FABLE-DESIGN B4). Start it in the background right before the
# bench. dma-buf pages are not in Pss, so the comparable total is Pss_Anon + Pss_File + dmabuf;
# the three are reported apart because the LMK treats them differently (file pages are evictable).
# dma-buf bytes are summed once per buffer inode: one buffer can sit behind several fds.

dmabuf_list() {  # "inode bytes exporter" per distinct dma-buf of pid $1
  for f in /proc/$1/fdinfo/*; do
    exp=$(sed -nE 's/^exp_name:[[:space:]]*(.*)/\1/p' $f 2>/dev/null)
    [ -n "$exp" ] || continue
    sz=$(sed -nE 's/^size:[[:space:]]*([0-9]+).*/\1/p' $f)
    ino=$(stat -L -c %i /proc/$1/fd/${f##*/} 2>/dev/null)
    echo "${ino:-?} ${sz:-0} $exp"
  done | sort -u
}

ram() {
  name=$1; out=$D/ram_$name.txt; : > $out
  i=0; P=
  while [ -z "$P" ] && [ $i -lt 100 ]; do P=$(pidof llama-bench); sleep 0.2; i=$((i + 1)); done
  [ -n "$P" ] || { echo "ram $name: no llama-bench pid" >> $REPORT; return 1; }
  best=0
  while [ -d /proc/$P ]; do
    r=$(awk '/^(Rss|Pss_Anon|Pss_File|Pss_Shmem):/{v[$1]=$2} END{print v["Rss:"]+0, v["Pss_Anon:"]+0, v["Pss_File:"]+0, v["Pss_Shmem:"]+0}' /proc/$P/smaps_rollup 2>/dev/null)
    l=$(dmabuf_list $P)
    db=$(printf '%s\n' "$l" | awk '{s+=$2} END{print int(s/1024)}')
    [ -n "$r" ] && echo "$r $db" >> $out
    # keep the dma-buf list of the fullest sample: it shows the TILE32 split (each <= the cap)
    if [ "${db:-0}" -gt "$best" ]; then best=$db; printf '%s\n' "$l" > $D/ram_${name}_dmabufs.txt; fi
    sleep 2
  done
  # per-column maxima, and the total as the maximum of the per-sample sums (columns peak apart)
  awk -v n=$name '{for(i=1;i<=5;i++) if($i>m[i]) m[i]=$i; t=$2+$3+$5; if(t>mt) mt=t} END{printf "ram %s (kB max): Rss=%d Pss_Anon=%d Pss_File=%d Pss_Shmem=%d dmabuf=%d anon+file+dmabuf=%d samples=%d\n", n, m[1], m[2], m[3], m[4], m[5], mt, NR}' $out >> $REPORT
  echo "ram $name dmabufs (inode bytes exporter, top 6 by size): $(sort -k2 -n -r $D/ram_${name}_dmabufs.txt 2>/dev/null | head -6 | tr '\n' ';')" >> $REPORT
}
