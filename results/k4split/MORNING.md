# k4split — morning test card (S23 only)

**STOP — N3/N4 are forbidden.** N1 PASS, N2 **FAIL_CORRECTNESS**.
Read `N1N2_VERDICT.md` then `STATUS.md`. Do not run any timed cell.

What already ran (2026-08-13, S23, **PLUGGED_AC**, charging 34→66%):

- Binary pushed: `~/gdn_k2/k4split/bin/bmoe-cli` sha `b8b1c732…`
  (`LD_LIBRARY_PATH` **must** include `/vendor/lib64`).
- KEXP sha `ac44e20c…` size 13416430592.
- Config of record: k6d065 with **`--cache-mb 1000 --force-cache`**
  (2000 and 1500 ram-guard refuse).
- N1 ARM_B c512 + c4096 + one `GGML_SCHED_DEBUG=2` (82 splits): PASS.
- N2 greedy temp 0 seed 42 n=32: hook alive (44% vs 45% hit), but CPU
  text ≠ split text. A == B == AUTO. First diverge: `distinct` vs `smaller`.
- `bmoe-cli` has **no `-f`**. Use `-p "$(cat prompts/p_fact.txt)"`.
- MemFree dips to 14–90 MiB for ~20 s during OpenCL alloc then recovers.
  Do **not** kill on the first sample; 60 s sustained is the working rule.

Do not SSH Xiaomi (`192.168.1.193`) or Jelly (`192.168.1.82`). Do not
update `PLAN.md`. Do not `git push`. Do not write GGUFs.

Correctness / load: **PLUGGED OK** (already done).
Speed / thermal: **UNPLUGGED, batt ≥45%, battery temp guard 45 °C** — only
after someone clears FAIL_CORRECTNESS.
Abort any run if `/proc/meminfo` **MemFree < 300 MiB sustained (60 s)**.

---

## 0. SSH

From the PC (PowerShell):

```powershell
$KEY = "$env:USERPROFILE\.ssh\moe_s23"
$SSH = @("ssh","-p","8022","-i",$KEY,"u0_a344@192.168.1.152")
$SCP = @("scp","-P","8022","-i",$KEY)
& $SSH[0] $SSH[1..($SSH.Length-1)] "echo OK; whoami; date -Iseconds"
```

One-liner:

```
ssh -p 8022 -i %USERPROFILE%\.ssh\moe_s23 u0_a344@192.168.1.152
```

Device workspace: `~/gdn_k2/k4split/`
Do **not** write into `~/experiments/` campaign dirs beyond reading.

---

## 1. Wait for the 4B marathon (do not kill)

On the phone:

```bash
pgrep -af llama-cli || echo "NO_LLAMA_CLI"
pgrep -af bmoe-cli || echo "NO_BMOE_CLI"
```

If `llama-cli` is alive, **wait**. Poll; do not `kill`.

```bash
while pgrep -f llama-cli >/dev/null 2>&1; do
  echo "$(date -Iseconds) llama-cli still running — waiting"
  sleep 30
done
echo "CLEAR"
```

If something else holds `bmoe-cli` (campaign), wait for that too before
pushing into `~/gdn_k2/k4split/` (that dir is ours; still do not stomp a
live campaign process).

---

## 2. Finish the Android ELF if it is still missing

On the PC, check:

```powershell
Test-Path C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-android-opencl-k4split\cli\bmoe-cli
```

If `False`, resume **`-j4` only** (MarcoKEXP may still be using the machine):

```
C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\k4split\build_android.cmd
```

When the ELF exists:

```
powershell -File C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\k4split\stage_android.ps1
```

Record sha from `results/k4split/SHA256SUMS_android.txt`.
Expected DT_NEEDED (K2 set): `libm.so` `libdl.so` `libOpenCL.so`
`libc++_shared.so` `libc.so`. Vendor `libOpenCL.so` stays on the phone.

Do **not** use `results/gdn_gpu_k22b/bin/llama-cli` (sha `0b6be132…`) for
these arms — no `--moe-stream`, hook does not compose.

Push helper (documents + scp only; does **not** start inference):

```
powershell -File C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\k4split\run_n1_n2.ps1 -Push
```

Manual push:

```powershell
$KEY = "$env:USERPROFILE\.ssh\moe_s23"
$HOST = "u0_a344@192.168.1.152"
$BIN  = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\k4split\bin"
ssh -p 8022 -i $KEY $HOST "mkdir -p ~/gdn_k2/k4split/{bin,logs,prompts}"
scp -P 8022 -i $KEY `
  "$BIN\bmoe-cli" "$BIN\libc++_shared.so" `
  ${HOST}:~/gdn_k2/k4split/bin/
scp -P 8022 -i $KEY `
  "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\marco_phase1\speed_s23\prompts\p_fact.txt" `
  "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\marco_phase1\speed_s23\prompts\p_creative.txt" `
  ${HOST}:~/gdn_k2/k4split/prompts/
```

---

## 3. On-device pin checks (before any load)

```bash
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export WS="$HOME/gdn_k2/k4split"
export BIN="$WS/bin/bmoe-cli"
export LIB="$WS/bin"
export MODEL="$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf"
export LD_LIBRARY_PATH="$LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
mkdir -p "$WS/logs"

# binary
ls -l "$BIN" "$LIB/libc++_shared.so"
sha256sum "$BIN" "$LIB/libc++_shared.so" | tee "$WS/logs/bin.sha256"
"$BIN" --help | tee "$WS/logs/help.txt"
grep -E 'ngl|flash-attn|moe-cpu-experts|override-tensor|anon-gpu' "$WS/logs/help.txt"

# KEXP — path + size first (13 GiB sha takes minutes; still do it once)
ls -l "$MODEL"
stat -c '%s %n' "$MODEL"
# expected size 13416430592
# expected sha  ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a
# cached copy (if present, still re-hash once for this workspace):
#   $HOME/experiments/results/kexp_baseline/kexp.sha256
#   $HOME/experiments/models/kexp.sha256
sha256sum "$MODEL" | tee "$WS/logs/kexp.sha256"
```

KEXP must start with `ac44e20c` and size **13416430592**.
If the sha mismatches, **STOP** — do not load.

Optional campaign CPU pin (reference only; N2 uses **our** binary both sides):

```bash
CAMPAIGN="$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN"
sha256sum "$CAMPAIGN"
# expected 1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f
```

MemFree / batt snapshot:

```bash
awk '/MemFree:|MemAvailable:|MemTotal:/' /proc/meminfo | tee "$WS/logs/mem_pre.txt"
termux-battery-status 2>/dev/null | tee "$WS/logs/batt_pre.json" || true
```

If MemFree is already <300 MiB, do not load. Reboot / drop caches is a
human call, not a script default.

---

## 4. Shared flags

Campaign **k6d065** (both arms unless RAM forces a documented cache cut):

```
-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon \
  --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65
```

Always add `--flash-attn off` on A7X (default is already off; keep it
explicit). Always `-ngl 99` on the split arms.

```bash
K6D065="-t 4 --moe-stream --cache-mb 2000 --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65"
# ARM_A / ARM_B keep --dense-weights anon
# ARM_AUTO replaces it with --dense-weights anon-gpu
```

RAM fallback (one variable at a time; then re-run the CPU baseline at the
**same** `--cache-mb` for fairness):

1. `--cache-mb 1500`
2. `--cache-mb 1000 --force-cache`

---

## 5. MemFree sampler (second SSH, every load)

```bash
OUT="$HOME/gdn_k2/k4split/logs/memfree_$(date +%H%M%S).csv"
echo "iso,memfree_kib,memavail_kib" > "$OUT"
while true; do
  mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
  ma=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
  echo "$(date -Iseconds),$mf,$ma" >> "$OUT"
  # 300 MiB = 307200 KiB
  if [ "$mf" -lt 307200 ]; then
    echo "ABORT MemFree=${mf} KiB < 300 MiB" | tee -a "$OUT"
    # do not kill llama-cli / the 4B job; only our bmoe-cli
    pkill -f "$HOME/gdn_k2/k4split/bin/bmoe-cli" 2>/dev/null || true
  fi
  sleep 5
done
```

Sustained = several consecutive samples, not a single dip during a spike.

---

## 6. N1 — load smoke (PLUGGED OK)

Tiny prompt, `-n 8`. Ctx **512 first**, then **4096**. Use ARM_B for the
sched-debug run (explicit pin).

```bash
export WS="$HOME/gdn_k2/k4split"
export BIN="$WS/bin/bmoe-cli"
export LIB="$WS/bin"
export MODEL="$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf"
export LD_LIBRARY_PATH="$LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PROMPT="Say OK in one word."
K6D065="-t 4 --moe-stream --cache-mb 2000 --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65"

# 6a. ctx 512, n=8, ARM_B, no sched debug
"$BIN" -m "$MODEL" -p "$PROMPT" -n 8 -c 512 \
  $K6D065 --dense-weights anon \
  --ngl 99 --flash-attn off --moe-cpu-experts on \
  2> "$WS/logs/n1_c512_B.err" | tee "$WS/logs/n1_c512_B.out"

# 6b. ONE sched-debug run (ctx 512 is enough)
GGML_SCHED_DEBUG=2 "$BIN" -m "$MODEL" -p "$PROMPT" -n 8 -c 512 \
  $K6D065 --dense-weights anon \
  --ngl 99 --flash-attn off --moe-cpu-experts on \
  2> "$WS/logs/n1_sched_B.err" | tee "$WS/logs/n1_sched_B.out"

# 6c. ctx 4096, n=8, ARM_B
"$BIN" -m "$MODEL" -p "$PROMPT" -n 8 -c 4096 \
  $K6D065 --dense-weights anon \
  --ngl 99 --flash-attn off --moe-cpu-experts on \
  2> "$WS/logs/n1_c4096_B.err" | tee "$WS/logs/n1_c4096_B.out"
```

Pull these from the logs:

- load time
- `bmoe: placement …` line (`n_gpu_layers` / `flash_attn` / `moe_cpu_experts` / `pin_ffn_exps`)
- `bmoe: ram-guard …`
- `bmoe: dense-weights=… skipping N MiB already on GPU`
- `bmoe: routing tensor … copying ids/weights` (HostAlias — expected once)
- streaming stats still print (hit%, MiB/tok)
- graph split count (`GGML_SCHED_DEBUG=2`)
- which backend got trunk vs `ffn_*_exps`

Kill-gate: RescueParty risk / MemFree <300 MiB sustained → `BLOCKED_RAM`,
retry cache cuts above. Do not proceed to N2 on a dying phone.

---

## 7. N2 — correctness (PLUGGED OK)

Greedy, temp 0, seed 42, n=32, `-c 4096`, **same prompt file**, **same
binary**. Token-identical required (fp reorder: if not identical, stop at
the first divergent token; systematic early divergence = FAIL_CORRECTNESS,
no speed work).

Hook must be alive on every split arm: streaming stats present, hit%
within ±10 pt of ARM_CPU on this prompt, MiB/tok same ballpark. Hook dead
= FAIL even if the text is right.

Prompt = this morning's speed-gate fact prompt (byte-identical):

`$WS/prompts/p_fact.txt`

Same env as N1, plus:

```bash
export WS="$HOME/gdn_k2/k4split"
export BIN="$WS/bin/bmoe-cli"
export LIB="$WS/bin"
export MODEL="$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf"
export LD_LIBRARY_PATH="$LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
K6D065="-t 4 --moe-stream --cache-mb 2000 --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65"
```

### ARM_CPU (baseline, our binary, `-ngl 0`)

```bash
"$BIN" -m "$MODEL" -f "$WS/prompts/p_fact.txt" -n 32 -c 4096 \
  --temp 0 --seed 42 \
  $K6D065 --dense-weights anon \
  --ngl 0 --flash-attn off --moe-cpu-experts off \
  2> "$WS/logs/n2_CPU.err" | tee "$WS/logs/n2_CPU.out"
```

### ARM_A — Mechanism A (no pin)

```
--moe-stream …k6d065… --ngl 99 --flash-attn off --moe-cpu-experts off
```

(`--dense-weights anon` stays)

```bash
"$BIN" -m "$MODEL" -f "$WS/prompts/p_fact.txt" -n 32 -c 4096 \
  --temp 0 --seed 42 \
  $K6D065 --dense-weights anon \
  --ngl 99 --flash-attn off --moe-cpu-experts off \
  2> "$WS/logs/n2_A.err" | tee "$WS/logs/n2_A.out"
```

### ARM_B — Mechanism B (explicit pin)

```
same --moe-cpu-experts on
```

```bash
"$BIN" -m "$MODEL" -f "$WS/prompts/p_fact.txt" -n 32 -c 4096 \
  --temp 0 --seed 42 \
  $K6D065 --dense-weights anon \
  --ngl 99 --flash-attn off --moe-cpu-experts on \
  2> "$WS/logs/n2_B.err" | tee "$WS/logs/n2_B.out"
```

### ARM_AUTO — product default

```
same --moe-cpu-experts auto --dense-weights anon-gpu
```

```bash
"$BIN" -m "$MODEL" -f "$WS/prompts/p_fact.txt" -n 32 -c 4096 \
  --temp 0 --seed 42 \
  $K6D065 --dense-weights anon-gpu \
  --ngl 99 --flash-attn off --moe-cpu-experts auto \
  2> "$WS/logs/n2_AUTO.err" | tee "$WS/logs/n2_AUTO.out"
```

Compare:

```bash
# generated text only (strip banners if needed)
for a in CPU A B AUTO; do
  echo "==== $a ===="
  tail -n 20 "$WS/logs/n2_${a}.out"
  grep -E 'hit|MiB/tok|placement|ram-guard|skipping|routing tensor|expert' "$WS/logs/n2_${a}.err" | tail -n 40
done
```

---

## 8. N3 — speed (DO NOT RUN — FAIL_CORRECTNESS)

N2 failed token-identity. Mandate: no speed work. Commands below are
kept only so a later human does not have to reconstruct them **after**
someone explains `distinct` vs `smaller`.

Do **not** measure plugged. If the cable is in or batt <45%, do not arm.
Gate (pre-declared, only if N2 is later cleared): split decode median
≥ 1.10× CPU; TTFT ≥1.5× is a valid product result on its own.
**Must** use `--cache-mb 1000 --force-cache` (not 2000) so the CPU
baseline matches the split ram-guard.

ABBA × 2 prompts (`p_fact.txt`, `p_creative.txt`), n=200, cold fadvise per
run, same binary, same k6d065. CSV: `results/k4split/runs_speed.csv` after
pull. Battery temp guard 45 °C.

Unplug check:

```bash
termux-battery-status
# need: "plugged": "UNPLUGGED", "percentage": >= 45
```

If still plugged / low: do not arm a waiter unless you are staying with
the phone. Pattern if you do: `results/gpu_sustained/wait_and_run.sh`
(raise `START_MIN` is 60 there; k4split speed gate is **45**).

N3 command skeleton (only after the unplug check; ARM_CPU vs ARM_AUTO is
the product pair; A/B optional):

```bash
# fadvise the GGUF cold, then:
"$BIN" -m "$MODEL" -f "$WS/prompts/p_fact.txt" -n 200 -c 4096 \
  --temp 0 --seed 42 \
  $K6D065 --dense-weights anon \
  --ngl 0 --flash-attn off --moe-cpu-experts off
# then same with ARM_AUTO flags
```

N4 (15 min marathon) only if N3 PASS or TTFT ≥1.5×.

---

## 9. Pull

```powershell
$KEY = "$env:USERPROFILE\.ssh\moe_s23"
scp -P 8022 -i $KEY -r `
  u0_a344@192.168.1.152:~/gdn_k2/k4split/logs `
  C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\k4split\s23_logs
```

Update `results/k4split/STATUS.md` with the real numbers. Leave `PLAN.md`
alone.

---

## One-screen cheat sheet

```
DONE     N0 binaries + N1 PASS + N2 FAIL_CORRECTNESS
STOP     do not run N3/N4
PIN      KEXP sha ac44e20c… size 13416430592
         bmoe-cli sha b8b1c732…   LD_LIBRARY_PATH=$WS/bin:/vendor/lib64
CACHE    1000 --force-cache   (2000/1500 ram-guard refuse)
ABORT    MemFree < 300 MiB sustained 60s (15s is a false kill during alloc)
N1       PASS  c512+c4096 ARM_B, 82 splits, hook alive
N2       FAIL  A=B=AUTO; CPU diverges at "distinct" vs "smaller"
         hook alive 44% vs 45% hit, 72 vs 69 MiB/tok
NEXT     token/logit dump at first diverge — not speed
SPEED    forbidden until N2 is cleared; then UNPLUGGED batt>=45 only
```
