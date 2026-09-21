#!/usr/bin/env bash
# Fixture test for scripts/assert-engine-provenance.sh — no network, no npm, no
# installed engine, no node_modules.
#
# The gate derives REPO_ROOT from BASH_SOURCE, so this test copies the real gate
# into a throwaway repo root that holds a fixture lockfile and a fixture
# installed tree. `curl` and `npm` are PATH shims: the curl shim records the URL
# it was asked for and materialises a deterministic tarball from a staged tree,
# the npm shim packs the extracted tree back up. The gate's lockfile parsing,
# URL allow-list, sha extraction, fetch URL, manifest building and manifest diff
# all run for real; only the network and the packer are stubbed.
#
# Cases A and B are the regression this file exists for: the lock may name the
# fork as Aspis0/kalsa.rn or under its pre-rename name Aspis0/llama.rn, and
# either way the gate must fetch codeload.github.com/Aspis0/kalsa.rn.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GATE="$HERE/assert-engine-provenance.sh"
if [ ! -f "$GATE" ]; then
  echo "FAIL: missing $GATE"
  exit 1
fi

# node is not optional: the gate itself parses the lockfile with it.
for tool in node tar mktemp; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP: $tool is required, and the gate needs it too"
    exit 77
  fi
done

SHA=0f313bab464ef28a58a8b4b2a37a5d4c1968b54e
SHA12="${SHA:0:12}"
CANONICAL_URL="https://codeload.github.com/Aspis0/kalsa.rn/tar.gz/$SHA"
# Fixture engine sha, deliberately not the real one, and a decoy left under the
# pre-vendor path: the gate must report the vendor/VERSIONS value, never the
# decoy.
ENGINE_SHA=aaaa1111bbbb2222cccc3333dddd4444eeee5555
ENGINE12="${ENGINE_SHA:0:12}"
DECOY_SHA=9999999999999999999999999999999999999999

WORK="$(mktemp -d "${TMPDIR:-/tmp}/engine-provenance-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

pass=0
fail=0
ok() { echo "PASS: $1"; pass=$((pass + 1)); }
bad() { echo "FAIL: $1"; fail=$((fail + 1)); }

# ── fixture tree ────────────────────────────────────────────────────
# The gate refuses a comparison set under 100 files as implausible, so the
# fixture is 129 files: 9 named ones plus 120 generated.
make_tree() {
  local root="$1" i n
  mkdir -p "$root/vendor/OpenCL-Headers/CL" "$root/cpp" "$root/lib" \
    "$root/bin/arm64-v8a" "$root/android" "$root/ios" "$root/src"
  printf '{"name":"llama.rn","version":"0.13.0-rc.4"}\n' >"$root/package.json"
  printf 'LLAMA_CPP_COMMIT=%s\n' "$ENGINE_SHA" >"$root/vendor/VERSIONS"
  printf '%s\n' "$DECOY_SHA" >"$root/cpp/KALSALLAMA_SHA"
  printf 'int rnllama_main();\n' >"$root/cpp/rnllama.cpp"
  printf 'module.exports = { ready: true };\n' >"$root/lib/bridge.js"
  printf 'elf\n' >"$root/bin/arm64-v8a/libggml-htp.so"
  printf 'android { }\n' >"$root/android/build.gradle"
  printf "s.name = 'llama.rn'\n" >"$root/ios/llama-rn.podspec"
  printf '#define CL_VERSION_TARGET 300\n' >"$root/vendor/OpenCL-Headers/CL/cl.h"
  for ((i = 1; i <= 120; i++)); do
    printf -v n '%03d' "$i"
    printf 'export const f%s = %s;\n' "$n" "$i" >"$root/src/f$n.ts"
  done
}

# ── PATH shims ──────────────────────────────────────────────────────
mkdir -p "$WORK/shim" "$WORK/stage" "$WORK/tree"

cat >"$WORK/shim/curl" <<'SHIM'
#!/usr/bin/env bash
# Fixture curl: supports `curl -fsSL <url> -o <file>` only.
set -euo pipefail
url=""
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o | --output)
      out="$2"
      shift 2
      ;;
    http*)
      url="$1"
      shift
      ;;
    *) shift ;;
  esac
done
[ -n "$out" ] || { echo "fixture curl: no -o target" >&2; exit 1; }
[ -n "$url" ] || { echo "fixture curl: no URL" >&2; exit 1; }
printf '%s\n' "$url" >>"$CURL_LOG"
tar -czf "$out" -C "$FIXTURE_FORK_STAGE" "$FIXTURE_TARBALL_ROOT"
SHIM
chmod +x "$WORK/shim/curl"

cat >"$WORK/shim/npm" <<'SHIM'
#!/usr/bin/env bash
# Fixture npm: supports `npm pack --silent --pack-destination <dir>` only.
# PACKED_EXTRA=1 makes the packed tree differ from the installed one, which is
# how the divergence branch is exercised without a real engine.
set -euo pipefail
dest=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pack-destination)
      dest="$2"
      shift 2
      ;;
    *) shift ;;
  esac
done
[ -n "$dest" ] || { echo "fixture npm: --pack-destination required" >&2; exit 1; }
stage="$(mktemp -d)"
mkdir -p "$stage/package"
cp -R "$PWD/." "$stage/package/"
if [ "${PACKED_EXTRA:-0}" = "1" ]; then
  printf 'extra\n' >"$stage/package/EXTRA.txt"
fi
tar -czf "$dest/packed.tgz" -C "$stage" package
rm -rf "$stage"
SHIM
chmod +x "$WORK/shim/npm"

FIXTURE_FORK_STAGE="$WORK/stage"
FIXTURE_TARBALL_ROOT="kalsa.rn-$SHA"
CURL_LOG="$WORK/curl.log"
export FIXTURE_FORK_STAGE FIXTURE_TARBALL_ROOT CURL_LOG
make_tree "$WORK/stage/$FIXTURE_TARBALL_ROOT"
make_tree "$WORK/tree"

# ── fixture repo root: copy the real gate in, so REPO_ROOT is the fixture ──
FAKE="$WORK/repo"
mkdir -p "$FAKE/scripts" "$FAKE/node_modules"
cp "$GATE" "$FAKE/scripts/assert-engine-provenance.sh"
chmod +x "$FAKE/scripts/assert-engine-provenance.sh"
cp -R "$WORK/tree" "$FAKE/node_modules/llama.rn"

# run_gate <lock-json> <packed-extra>: sets $rc and leaves output in
# $WORK/out.txt / $WORK/err.txt.
rc=0
run_gate() {
  : >"$CURL_LOG"
  printf '%s\n' "$1" >"$FAKE/package-lock.json"
  PACKED_EXTRA="$2" PATH="$WORK/shim:$PATH" \
    bash "$FAKE/scripts/assert-engine-provenance.sh" \
    >"$WORK/out.txt" 2>"$WORK/err.txt"
  rc=$?
  return 0
}

lock() { # lock <url> -> npm-shaped lockfile JSON
  printf '{"packages":{"node_modules/llama.rn":{"resolved":"%s"}}}' "$1"
}

expect_fetched_canonical() { # expect_fetched_canonical <label>
  local got
  got="$(cat "$CURL_LOG")"
  if [ "$got" = "$CANONICAL_URL" ]; then
    ok "$1: fetched the canonical kalsa.rn tarball, exactly once"
  else
    bad "$1: expected one curl of $CANONICAL_URL, got '$got'"
  fi
}

# ── A: canonical lock ───────────────────────────────────────────────
run_gate "$(lock "git+ssh://git@github.com/Aspis0/kalsa.rn.git#$SHA")" 0
if [ "$rc" -eq 0 ]; then
  ok "canonical lock: exit 0"
else
  bad "canonical lock: exit $rc (stderr: $(head -3 "$WORK/err.txt" | tr '\n' ' '))"
fi
expect_fetched_canonical "canonical lock"
grep -q "lockfile pins Aspis0/kalsa.rn@$SHA12" "$WORK/out.txt" \
  && ok "canonical lock: note names kalsa.rn@$SHA12" \
  || bad "canonical lock: note missing (got: $(tr '\n' '|' <"$WORK/out.txt"))"
grep -qE "OK: [0-9]+ files match Aspis0/kalsa\.rn@$SHA12" "$WORK/out.txt" \
  && ok "canonical lock: manifest comparison reported OK" \
  || bad "canonical lock: no 'OK: N files match' line"
grep -q "engine inside it: kalsallama@$ENGINE12" "$WORK/out.txt" \
  && ok "canonical lock: engine sha read from vendor/VERSIONS" \
  || bad "canonical lock: engine sha not the vendor/VERSIONS value"
grep -q "$DECOY_SHA" "$WORK/out.txt" \
  && bad "canonical lock: reported the decoy cpp/KALSALLAMA_SHA" \
  || ok "canonical lock: pre-vendor cpp/KALSALLAMA_SHA ignored"

# ── B: legacy pre-rename lock ───────────────────────────────────────
run_gate "$(lock "git+ssh://git@github.com/Aspis0/llama.rn.git#$SHA")" 0
if [ "$rc" -eq 0 ]; then
  ok "legacy lock: accepted, exit 0"
else
  bad "legacy lock: exit $rc (stderr: $(head -3 "$WORK/err.txt" | tr '\n' ' '))"
fi
expect_fetched_canonical "legacy lock"
grep -q "lockfile pins Aspis0/kalsa.rn@$SHA12" "$WORK/out.txt" \
  && ok "legacy lock: still reported under the canonical name" \
  || bad "legacy lock: canonical note missing"
grep -qE "OK: [0-9]+ files match Aspis0/kalsa\.rn@$SHA12" "$WORK/out.txt" \
  && ok "legacy lock: manifest comparison reported OK" \
  || bad "legacy lock: no 'OK: N files match' line"

# ── C: divergent installed tree ─────────────────────────────────────
run_gate "$(lock "git+ssh://git@github.com/Aspis0/kalsa.rn.git#$SHA")" 1
if [ "$rc" -eq 1 ]; then
  ok "divergent tree: exit 1"
else
  bad "divergent tree: exit $rc, expected 1"
fi
grep -q "DIVERGENT: the installed engine is not Aspis0/kalsa.rn@$SHA12" "$WORK/err.txt" \
  && ok "divergent tree: names the canonical repo in the verdict" \
  || bad "divergent tree: verdict missing (got: $(tr '\n' '|' <"$WORK/err.txt"))"

# ── D: a foreign repository is refused ──────────────────────────────
run_gate "$(lock "https://github.com/Aspis0/kalsallama.git#$SHA")" 0
if [ "$rc" -eq 2 ]; then
  ok "foreign repo: exit 2"
else
  bad "foreign repo: exit $rc, expected 2"
fi
grep -q "does not come from Aspis0/kalsa.rn" "$WORK/err.txt" \
  && ok "foreign repo: fatal names the canonical repo" \
  || bad "foreign repo: fatal message missing"
if [ -s "$CURL_LOG" ]; then
  bad "foreign repo: fetched anyway ($(cat "$CURL_LOG"))"
else
  ok "foreign repo: nothing fetched"
fi

# ── E: canonical name, but no 40-hex commit ─────────────────────────
run_gate "$(lock "git+https://github.com/Aspis0/kalsa.rn.git#abc123")" 0
if [ "$rc" -eq 2 ]; then
  ok "short sha: exit 2"
else
  bad "short sha: exit $rc, expected 2"
fi
grep -q "no 40-hex commit" "$WORK/err.txt" \
  && ok "short sha: fatal names the missing commit" \
  || bad "short sha: fatal message missing"

rm -rf "$WORK"
echo ""
echo "=== $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
