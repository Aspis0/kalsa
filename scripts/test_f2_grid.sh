#!/usr/bin/env bash
# =============================================================================
# test_f2_grid.sh — offline tests for F2 grid resume safety (no phone, no models)
#
# Checks:
#   1) bash -n on F2 runners/starters
#   2) legacy starters hard-refuse
#   3) run_f2_grid rejects cooldown<180, cool>30, legacy phase, old binary tree
#   4) no pkill in compliant starters
#   5) no network download commands in F2 scripts
#   6) median/count helpers prefer last-REPS + low-majflt (via embedded awk mirror)
#
# Uso (repo root):
#   bash scripts/test_f2_grid.sh
# =============================================================================

set -o pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GRID="$SCRIPT_DIR/run_f2_grid.sh"
PASS_N=0
FAIL_N=0

pass() { echo "PASS  $1"; PASS_N=$((PASS_N + 1)); }
fail() { echo "FAIL  $1"; [ -n "${2:-}" ] && echo "      $2"; FAIL_N=$((FAIL_N + 1)); }

echo "=== 1) bash -n syntax ==="
for f in \
  run_f2_grid.sh run_f2_thermal.sh \
  start_f2_2c.sh start_f2_3c.sh start_f2_2_resume.sh start_f2_3.sh
do
  if bash -n "$SCRIPT_DIR/$f" 2>/tmp/tfg_syn.err; then
    pass "bash -n $f"
  else
    fail "bash -n $f" "$(cat /tmp/tfg_syn.err 2>/dev/null | head -5)"
  fi
done

echo "=== 2) legacy starters refuse ==="
out="$(bash "$SCRIPT_DIR/start_f2_2_resume.sh" 2>&1)"; ec=$?
if [ "$ec" -eq 3 ] && printf '%s' "$out" | grep -q 'retired\|F2.2c\|noncompliant'; then
  pass "start_f2_2_resume.sh refuses (exit $ec)"
else
  fail "start_f2_2_resume.sh refuse" "ec=$ec out=$out"
fi
out="$(bash "$SCRIPT_DIR/start_f2_3.sh" 2>&1)"; ec=$?
if [ "$ec" -eq 3 ] && printf '%s' "$out" | grep -q 'retired\|F2.3c\|noncompliant'; then
  pass "start_f2_3.sh refuses (exit $ec)"
else
  fail "start_f2_3.sh refuse" "ec=$ec out=$out"
fi

echo "=== 3) run_f2_grid safety rejects ==="
TMP="$(mktemp -d "${TMPDIR:-/tmp}/test_f2_grid.XXXXXX")"
# fake model file + fake build-safe binary path structure
mkdir -p "$TMP/build-safe/bin" "$TMP/build/bin" "$TMP/models"
echo fake >"$TMP/models/Qwen3.5-4B-Q4_K_M.gguf"
echo fake >"$TMP/models/LFM2-8B-A1B-Q4_K_M.gguf"
: >"$TMP/build-safe/bin/llama-cli"
chmod +x "$TMP/build-safe/bin/llama-cli" 2>/dev/null || true
: >"$TMP/build/bin/llama-cli"
chmod +x "$TMP/build/bin/llama-cli" 2>/dev/null || true
# minimal run_bench stub so missing-harness is not the first error
echo '#!/usr/bin/env bash' >"$TMP/run_bench.sh"
echo 'exit 0' >>"$TMP/run_bench.sh"
chmod +x "$TMP/run_bench.sh"

run_grid() {
  # args after --
  RUN_BENCH="$TMP/run_bench.sh" bash "$GRID" "$@" 2>"$TMP/err" >/dev/null
}

# cooldown too low
run_grid --model "$TMP/models/Qwen3.5-4B-Q4_K_M.gguf" --phase F2.2c \
  --binary "$TMP/build-safe/bin/llama-cli" --cooldown 20
ec=$?
if [ "$ec" -eq 3 ] && grep -q 'cooldown' "$TMP/err"; then
  pass "reject cooldown 20"
else
  fail "reject cooldown 20" "ec=$ec $(head -3 "$TMP/err")"
fi

# cool temp too high (bypass attempt)
run_grid --model "$TMP/models/Qwen3.5-4B-Q4_K_M.gguf" --phase F2.2c \
  --binary "$TMP/build-safe/bin/llama-cli" --cooldown 180 --max-cool-temp 32
ec=$?
if [ "$ec" -eq 3 ] && grep -qi 'cool-temp\|30.0' "$TMP/err"; then
  pass "reject max-cool-temp 32"
else
  fail "reject max-cool-temp 32" "ec=$ec $(head -3 "$TMP/err")"
fi

# legacy phase
run_grid --model "$TMP/models/Qwen3.5-4B-Q4_K_M.gguf" --phase F2.2 \
  --binary "$TMP/build-safe/bin/llama-cli" --cooldown 180
ec=$?
if [ "$ec" -eq 3 ] && grep -qi 'refused\|legacy\|F2.2c' "$TMP/err"; then
  pass "reject phase F2.2"
else
  fail "reject phase F2.2" "ec=$ec $(head -3 "$TMP/err")"
fi

run_grid --model "$TMP/models/LFM2-8B-A1B-Q4_K_M.gguf" --phase F2.3 \
  --binary "$TMP/build-safe/bin/llama-cli" --cooldown 180
ec=$?
if [ "$ec" -eq 3 ] && grep -qi 'refused\|legacy\|F2.3c' "$TMP/err"; then
  pass "reject phase F2.3"
else
  fail "reject phase F2.3" "ec=$ec $(head -3 "$TMP/err")"
fi

# old build tree
run_grid --model "$TMP/models/Qwen3.5-4B-Q4_K_M.gguf" --phase F2.2c \
  --binary "$TMP/build/bin/llama-cli" --cooldown 180
ec=$?
if [ "$ec" -eq 6 ] && grep -qi 'build' "$TMP/err"; then
  pass "reject binary build/bin"
else
  fail "reject binary build/bin" "ec=$ec $(head -3 "$TMP/err")"
fi

# F2.3c wrong size (fake file size != 5044779712)
run_grid --model "$TMP/models/LFM2-8B-A1B-Q4_K_M.gguf" --phase F2.3c \
  --binary "$TMP/build-safe/bin/llama-cli" --cooldown 180
ec=$?
if [ "$ec" -eq 3 ] && grep -qi 'size\|5044779712' "$TMP/err"; then
  pass "reject F2.3c wrong model size"
else
  fail "reject F2.3c wrong model size" "ec=$ec $(head -3 "$TMP/err")"
fi

# missing model
run_grid --model "$TMP/models/nope.gguf" --phase F2.2c \
  --binary "$TMP/build-safe/bin/llama-cli" --cooldown 180
ec=$?
if [ "$ec" -eq 3 ]; then
  pass "reject missing model"
else
  fail "reject missing model" "ec=$ec $(head -3 "$TMP/err")"
fi

echo "=== 4) compliant starters: no live pkill ==="
# Strip comments before matching so doc lines like "No broad pkill" do not fail.
live_pkill() {
  # remove full-line comments and trailing comments, then look for pkill/killall tokens
  sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' "$1" | grep -nE '(^|[[:space:]])(pkill|killall)([[:space:]]|$)' || true
}
for f in start_f2_2c.sh start_f2_3c.sh; do
  hits="$(live_pkill "$SCRIPT_DIR/$f")"
  if [ -n "$hits" ]; then
    fail "$f contains live pkill/killall" "$hits"
  else
    pass "$f no live pkill/killall"
  fi
done
hits_res="$(live_pkill "$SCRIPT_DIR/start_f2_2_resume.sh"; live_pkill "$SCRIPT_DIR/start_f2_3.sh")"
if [ -n "$hits_res" ]; then
  fail "retired starters still execute pkill" "$hits_res"
else
  pass "retired starters have no live pkill"
fi

echo "=== 5) no network download in F2 scripts ==="
if grep -nE 'curl |wget |huggingface|hf download|git clone' \
  "$SCRIPT_DIR/run_f2_grid.sh" "$SCRIPT_DIR/run_f2_thermal.sh" \
  "$SCRIPT_DIR/start_f2_2c.sh" "$SCRIPT_DIR/start_f2_3c.sh" \
  "$SCRIPT_DIR/start_f2_2_resume.sh" "$SCRIPT_DIR/start_f2_3.sh" \
  >/tmp/tfg_net.err 2>/dev/null; then
  fail "network download pattern found" "$(cat /tmp/tfg_net.err)"
else
  pass "no curl/wget/hf download in F2 scripts"
fi

echo "=== 6) median last-REPS + low-majflt (awk contract) ==="
# Mirror of median_eval_for_config logic (must stay in sync with run_f2_grid.sh)
CSV="$TMP/runs.csv"
cat >"$CSV" <<'CSV'
run_id,date,phase,model,quant,file_gb,runtime,runtime_commit,flags,threads,n_ctx,kv_type,n_gen,run_type,prompt_id,prompt_tok_s,eval_tok_s,ttft_ms,majflt_delta,minflt_delta,read_bytes_delta,vmrss_peak_mb,memfree_min_mb,batt_temp_start,batt_temp_end,expert_hit_rate,notes
a,d,F2.2c,m.gguf,Q4,2.7,mainline,c,,5,1024,q8_0,128,warm,short,1,1.00,,100000,0,0,0,0,29,29,,old_high
b,d,F2.2c,m.gguf,Q4,2.7,mainline,c,,5,1024,q8_0,128,warm,short,1,2.00,,100000,0,0,0,0,29,29,,old_high
c,d,F2.2c,m.gguf,Q4,2.7,mainline,c,,5,1024,q8_0,128,warm,short,1,3.00,,100000,0,0,0,0,29,29,,old_high
d,d,F2.2c,m.gguf,Q4,2.7,mainline,c,,5,1024,q8_0,128,warm,short,1,9.00,,100,0,0,0,0,29,29,,new_low
e,d,F2.2c,m.gguf,Q4,2.7,mainline,c,,5,1024,q8_0,128,warm,short,1,8.00,,200,0,0,0,0,29,29,,new_low
f,d,F2.2c,m.gguf,Q4,2.7,mainline,c,,5,1024,q8_0,128,warm,short,1,7.00,,300,0,0,0,0,29,29,,new_low
CSV
med="$(awk -F, -v phase="F2.2c" -v model="m.gguf" -v t="5" -v c="1024" -v k="q8_0" \
  -v mjmax="50000" -v reps="3" '
  NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
  $h["phase"]==phase && $h["model"]==model && $h["threads"]==t && $h["n_ctx"]==c && $h["kv_type"]==k && $h["run_type"]=="warm" {
    v=$h["eval_tok_s"]; mj=$h["majflt_delta"]
    if (v!="" && v+0==v) { n_all++; a_all[n_all]=v+0; m_all[n_all]=(mj==""?-1:mj+0) }
  }
  function med(arr, n,    i,j,x) {
    if (n==0) return ""
    for(i=1;i<=n;i++) for(j=i+1;j<=n;j++) if(arr[j]<arr[i]){x=arr[i];arr[i]=arr[j];arr[j]=x}
    if (n%2) return sprintf("%.2f", arr[int(n/2)+1])
    return sprintf("%.2f", (arr[n/2]+arr[n/2+1])/2)
  }
  END {
    if (n_all==0) { print ""; exit }
    start = n_all - reps + 1; if (start < 1) start = 1
    n_batch=0; n_low=0
    for (i=start;i<=n_all;i++) {
      n_batch++; b_all[n_batch]=a_all[i]
      if (m_all[i]>=0 && m_all[i]<=mjmax+0) { n_low++; b_low[n_low]=a_all[i] }
    }
    if (n_low>0) print med(b_low, n_low); else print med(b_all, n_batch)
  }
' "$CSV")"
# last 3 are 9,8,7 all low-majflt → median 8.00
if [ "$med" = "8.00" ]; then
  pass "median last-REPS low-majflt = 8.00 (got $med)"
else
  fail "median last-REPS low-majflt" "expected 8.00 got '$med'"
fi

# count rows for config
cnt="$(awk -F, -v phase="F2.2c" -v model="m.gguf" -v t="5" -v c="1024" -v k="q8_0" '
  NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
  $h["phase"]==phase && $h["model"]==model && $h["threads"]==t && $h["n_ctx"]==c && $h["kv_type"]==k && $h["run_type"]=="warm" {n++}
  END{print n+0}
' "$CSV")"
if [ "$cnt" = "6" ]; then
  pass "count_rows = 6"
else
  fail "count_rows" "expected 6 got $cnt"
fi

# legacy phase rows must not count toward F2.2c
echo 'x,d,F2.2,m.gguf,Q4,2.7,mainline,c,,5,1024,q8_0,128,warm,short,1,99.00,,10,0,0,0,0,29,29,,legacy' >>"$CSV"
cnt2="$(awk -F, -v phase="F2.2c" -v model="m.gguf" -v t="5" -v c="1024" -v k="q8_0" '
  NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
  $h["phase"]==phase && $h["model"]==model && $h["threads"]==t && $h["n_ctx"]==c && $h["kv_type"]==k && $h["run_type"]=="warm" {n++}
  END{print n+0}
' "$CSV")"
if [ "$cnt2" = "6" ]; then
  pass "legacy F2.2 rows do not count for F2.2c skip"
else
  fail "legacy isolation" "expected 6 got $cnt2"
fi

# declared start defaults present in grid script
if grep -q 'BEST_T=5' "$GRID" && grep -q 'BEST_C=1024' "$GRID"; then
  pass "declared start BEST_T=5 BEST_C=1024 in grid"
else
  fail "declared start defaults missing in grid"
fi

rm -rf "$TMP"

echo
echo "=== summary: PASS=$PASS_N FAIL=$FAIL_N ==="
if [ "$FAIL_N" -gt 0 ]; then
  exit 1
fi
exit 0
