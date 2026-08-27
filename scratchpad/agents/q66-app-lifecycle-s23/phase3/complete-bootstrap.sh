#!/bin/bash
set -e
cd /c/Users/gualt/llama-rn-pin
for patch_file in ./scripts/patches/*.patch; do
  if patch --dry-run --forward --batch -p0 -d ./cpp < "$patch_file" >/dev/null 2>&1; then
    echo "APPLY:$patch_file"
    patch -p0 -d ./cpp < "$patch_file"
  elif patch --dry-run --reverse --batch -p0 -d ./cpp < "$patch_file" >/dev/null 2>&1; then
    echo "SKIP_ALREADY_PRESENT:$patch_file"
  else
    echo "PATCH_FAIL:$patch_file" >&2
    exit 1
  fi
done
rm -f ./cpp/*.orig
rm -f ./cpp/**/*.orig
rm -f ./cpp/**/*/*.orig
cd third_party/llama.cpp
BUILD_NUMBER=$(git rev-list --count HEAD)
BUILD_COMMIT=$(git rev-parse --short=7 HEAD)
cd ../..
printf "export const BUILD_NUMBER = '%s'\nexport const BUILD_COMMIT = '%s'\n" "$BUILD_NUMBER" "$BUILD_COMMIT" > src/version.ts
sed -e "s|@LLAMA_BUILD_NUMBER@|$BUILD_NUMBER|g" \
    -e "s|@LLAMA_BUILD_COMMIT@|$BUILD_COMMIT|g" \
    -e 's|@BUILD_COMPILER@|unknown|g' \
    -e 's|@BUILD_TARGET@|unknown|g' \
    third_party/llama.cpp/common/build-info.cpp.in > cpp/common/build-info.cpp
