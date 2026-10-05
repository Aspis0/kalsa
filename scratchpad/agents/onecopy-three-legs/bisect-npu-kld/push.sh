#!/bin/zsh
# Push one bisect build (llama-perplexity + release v73 skel) to the S23 under $R/bisect/<tag> and check sha256.
#   push.sh <tag> <build-dir> [adb-serial]
set -euo pipefail
TAG=${1:?tag}; BD=${2:?build dir}; SER=${3:-192.168.1.152:35017}
D=/data/local/tmp/govhtp/bisect/$TAG
P=$BD/bin/llama-perplexity; S=$BD/ggml/src/ggml-hexagon/libggml-htp-v73.so
adb -s $SER shell "mkdir -p $D/bin $D/dsp-rel"
adb -s $SER push $P $D/bin/ > /dev/null
adb -s $SER push $S $D/dsp-rel/ > /dev/null
adb -s $SER push $(dirname $0)/run-kld-a.sh /data/local/tmp/govhtp/bisect/ > /dev/null
dev=$(adb -s $SER shell "sha256sum $D/bin/llama-perplexity $D/dsp-rel/libggml-htp-v73.so" | awk '{print $1}')
loc=$(shasum -a 256 $P $S | awk '{print $1}')
[ "$dev" = "$loc" ] && echo "SHA CHECK PASS $TAG $(echo $loc | cut -c1-12 | tr '\n' ' ')" || { echo "SHA MISMATCH $TAG" >&2; exit 1; }
