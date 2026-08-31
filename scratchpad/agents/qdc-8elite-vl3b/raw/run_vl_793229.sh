#!/bin/sh
# VL cell - prereg 6642824d + AMENDMENT-1. Usage: sh run_vl.sh <ARM> <TAG>; ARM: C|A|M
KD=/data/local/tmp/kalsa
ARM="$1"; TAG="$2"
case "$ARM" in
  C) FLAGS="-ngl 0 --no-mmproj-offload" ;;
  A) FLAGS="-ngl 99" ;;
  M) FLAGS="-ngl 99 --no-mmproj-offload" ;;
  *) echo "bad arm"; exit 9 ;;
esac
export LD_LIBRARY_PATH=$KD
cd $KD
./llama-mtmd-cli -m $KD/vl3b.gguf --mmproj $KD/vl3b-mmproj.gguf --image $KD/test_image.jpg \
  -p "Describe the image in one sentence." -n 128 --temp 0 --seed 42 --ignore-eos -t 8 $FLAGS \
  > $KD/vl_${ARM}_${TAG}.out 2>&1
echo $? > $KD/vl_${ARM}_${TAG}.exit
