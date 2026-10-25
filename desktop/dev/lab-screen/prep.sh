#!/bin/sh
# Lab-only: resized copies of the native shots for the width sweep (sips, aspect kept).
# usage: prep.sh   (reads /tmp/lab-screen/shots, writes /tmp/lab-screen/variants/<w>/)
set -u
src=/tmp/lab-screen/shots
for w in 1280 896; do
  mkdir -p "/tmp/lab-screen/variants/$w"
  for f in "$src"/*.png "$src"/*.jpg; do
    name=$(basename "$f")
    sips --resampleWidth "$w" "$f" --out "/tmp/lab-screen/variants/$w/$name" > /dev/null 2>&1 || { echo "FAILED $name at $w"; exit 1; }
  done
done
echo "OK variants written"
