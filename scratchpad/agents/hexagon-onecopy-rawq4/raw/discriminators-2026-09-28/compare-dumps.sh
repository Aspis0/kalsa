#!/bin/sh
# First tensor whose exact hash differs between two llama-eval-callback dumps
# (engine c939a135d prints "hash = " after each tensor). Usage: compare-dumps.sh A.log B.log
set -eu
pairs() { awk '/^common_debug_cb_eval: /{ name = $2 } / hash = /{ print ++n, name, $3 }' "$1"; }
pairs "$1" > /tmp/compare-dumps.a
pairs "$2" > /tmp/compare-dumps.b
echo "tensors: $(wc -l < /tmp/compare-dumps.a) vs $(wc -l < /tmp/compare-dumps.b)"
if cmp -s /tmp/compare-dumps.a /tmp/compare-dumps.b; then
    echo "IDENTICAL: every tensor hash matches"
else
    echo "FIRST DIFFERENCE (index name hash):"
    diff /tmp/compare-dumps.a /tmp/compare-dumps.b | grep '^[<>]' | head -2
fi
