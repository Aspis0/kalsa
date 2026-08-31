#!/bin/sh
# Governor 8B cell — prereg 166f9ccf. On device: sh run_gov.sh <ARM> <TAG>
# ARM: A|C|G. LD_LIBRARY_PATH = kit dir ONLY (never /vendor/lib64 — #40 trap).
KD=/data/local/tmp/kalsa
ARM="$1"; TAG="$2"
case "$ARM" in A|C|G) ;; *) echo "bad arm"; exit 9 ;; esac
export LD_LIBRARY_PATH=$KD
cd $KD
./governor-bench --arm $ARM -m $KD/lfm8b.gguf -r 3 > $KD/gov_${ARM}_${TAG}.out 2>&1
echo $? > $KD/gov_${ARM}_${TAG}.exit
