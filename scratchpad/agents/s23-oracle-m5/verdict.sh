#!/usr/bin/env bash
# usage: verdict.sh — R4 per group (cool / warm) and whether the R2 step set moves.
# Reads only the oracle/steps files campaign.sh already produced; oracle_logit.py is not re-run,
# so this is a report over the stored verdicts, never a second judgement.
set -u; . "$(dirname "$0")/env.sh"
vline() { grep -h "^oracle=" "$OUT/oracle-$1-vs-$2.txt"; }
steps_of() { sed -n 's/^R2-first steps: \[\(.*\)\]/[\1]/p' "$OUT/steps-$1-vs-$2.txt"; }
r1_of() { sed -n 's/^R1 steps: \[\(.*\)\]/[\1]/p' "$OUT/steps-$1-vs-$2.txt"; }

report_group() {  # LABEL prefix...
  local g=$1; shift
  echo "--- $g group"
  for p in "$@"; do
    local n; n=$(vline "${p}a" "${p}b")
    echo "pair $p  $n"
    echo "   R1 steps $(r1_of "${p}a" "${p}b")   R2-first steps $(steps_of "${p}a" "${p}b")"
  done
  # R4 (PREREG.md:26): mode TF needs 32 comparable steps on >= 2 same-turn pairs per board.
  local ok=0 p steps
  for p in "$@"; do steps=$(vline "${p}a" "${p}b" | sed -n 's/.*steps=\([0-9]*\).*/\1/p'); [ "$steps" = 32 ] && ok=$((ok+1)); done
  if [ "$ok" -ge 2 ]; then echo "R4($g): MET — $ok pairs with 32 comparable steps (>= 2)"
  else echo "R4($g): NOT MET — only $ok pair(s) with 32 comparable steps"; fi
}

report_group cool c1 c2
report_group warm w1 w2
echo "--- does the R2 step set move?"
for p in c1 c2; do echo "cool $p R2 $(steps_of "${p}a" "${p}b")"; done
for p in w1 w2; do echo "warm $p R2 $(steps_of "${p}a" "${p}b")"; done
c1s=$(steps_of c1a c1b); c2s=$(steps_of c2a c2b)
w1s=$(steps_of w1a w1b); w2s=$(steps_of w2a w2b)
if [ "$c1s" = "$w1s" ]; then echo "cool c1 R2 set == warm w1 R2 set: NO MOVEMENT between those pairs"
else echo "cool c1 R2 set != warm w1 R2 set: MOVEMENT"; echo "   only-in-cool-c1: $(comm -23 <(tr -d '[]' <<<"$c1s" | tr ',' '\n' | sort) <(tr -d '[]' <<<"$w1s" | tr ',' '\n' | sort) | paste -sd, -)"; echo "   only-in-warm-w1: $(comm -13 <(tr -d '[]' <<<"$c1s" | tr ',' '\n' | sort) <(tr -d '[]' <<<"$w1s" | tr ',' '\n' | sort) | paste -sd, -)"; fi
echo "R5 sanity (8 Elite known-good PASS + fault-injected FAIL): STILL UNMET — inherited, not run here"