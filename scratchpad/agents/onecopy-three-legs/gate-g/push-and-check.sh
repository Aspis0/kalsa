#!/bin/zsh
# Push the gate-G artifact trio (binaries + v73 skel) and the two device scripts to the S23,
# then verify the on-device sha256 against the local files. Run from the Mac:
#   ~/Projects/kalsa-moe-experiments/scratchpad/agents/onecopy-three-legs/gate-g/push-and-check.sh [adb-serial]
# Nothing is run on the phone by this script - the session is run-gate-g.sh, launched by hand.
set -euo pipefail

SER=${1:-adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp}
LAB=$(cd "$(dirname "$0")" && pwd)
B=~/Projects/kalsallama-gov-onecopy/build-gateg
REL=${REL_SKEL:?set REL_SKEL to the release libggml-htp-v73.so}
ADB() { adb -s "$SER" "$@"; }
D=/data/local/tmp/govhtp/gate-g

for f in $B/bin/llama-bench $B/bin/llama-perplexity $B/ggml/src/ggml-hexagon/libggml-htp-v73.so; do
  [ -f "$f" ] || { echo "missing artifact: $f" >&2; exit 1; }
done

ADB shell "mkdir -p $D/bin $D/dsp $D/dsp-rel"
ADB push $B/bin/llama-bench $B/bin/llama-perplexity $D/bin/
ADB push $B/ggml/src/ggml-hexagon/libggml-htp-v73.so $D/dsp/
ADB push $REL $D/dsp-rel/
ADB push $LAB/env.sh $LAB/run-gate-g.sh $D/

echo "== device sha256"
dev=$(ADB shell "sha256sum $D/bin/llama-bench $D/bin/llama-perplexity $D/dsp/libggml-htp-v73.so $D/dsp-rel/libggml-htp-v73.so")
printf '%s\n' "$dev"
echo "== local sha256"
loc=$(shasum -a 256 $B/bin/llama-bench $B/bin/llama-perplexity $B/ggml/src/ggml-hexagon/libggml-htp-v73.so $REL | awk '{print $1}')
printf '%s\n' "$loc"

# compare as sorted hash lists: any difference aborts before the session
if ! diff <(printf '%s\n' "$dev" | awk '{print $1}' | sort) \
          <(printf '%s\n' "$loc" | sort) > /dev/null; then
  echo "SHA MISMATCH - do not run the session" >&2
  exit 1
fi
echo "SHA CHECK PASS"
