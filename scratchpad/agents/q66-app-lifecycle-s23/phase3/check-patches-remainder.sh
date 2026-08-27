#!/bin/bash
cd /c/Users/gualt/llama-rn-pin
for f in ./scripts/patches/ggml.c.patch \
         ./scripts/patches/jinja-caps.cpp.patch \
         ./scripts/patches/jinja-value.cpp.patch \
         ./scripts/patches/llama-mmap.cpp.patch \
         ./scripts/patches/log.cpp.patch \
         ./scripts/patches/mtmd-audio.cpp.patch \
         ./scripts/patches/mtmd-helper.cpp.patch; do
  echo "==== $f"
  patch --dry-run --forward --batch -p0 -d ./cpp < "$f"; echo "forward=$?"
  patch --dry-run --reverse --batch -p0 -d ./cpp < "$f"; echo "reverse=$?"
done
