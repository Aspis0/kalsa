# K4-SPLIT OVERNIGHT — CalaQwen trunk on GPU, experts on CPU (the split nobody has)

You are an autonomous overnight implementation agent. Goal: make **CalaQwen**
(KEXP 35B, arch `qwen35moe`, expert streaming from flash) run its **trunk**
(GDN layers + attention layers + shared expert + router + dense projections) on the
**Adreno GPU** while the **routed experts stay on CPU** — so the fork's
expert-streaming machinery (mmap + cache + expert-ready hook) keeps working untouched.
If this works, it is a world first: no published system runs a 35B-class flash-streamed
MoE hybrid with a GPU trunk on a phone.

Work in bounded milestones with kill-gates. If a milestone is blocked >45 min, write
`BLOCKED_<milestone>` with full evidence in STATUS.md and move on to what is still
doable. NEVER fabricate a number. Every measurement gets a raw log on disk.

## Repo / device / discipline

- Repo root: `C:\Users\gualt\Desktop\Kalsa\moe-experiments`
- Fork: `BigMoeOnEdge\third_party\llama.cpp` — branch **from `kalsa/opencl-q6k-dispatch-fix`
  @ `04c5d362a`** → new branch `kalsa/split-trunk-gpu`. Commit small and clean, English.
- Device: **S23 ONLY** (ssh `-p 8022 -i %USERPROFILE%\.ssh\moe_s23 u0_a344@192.168.1.152`).
  A 4B marathon may still be running when you start (`pgrep -f llama-cli`): WAIT for it
  to finish before any device work. Do NOT touch the Xiaomi (192.168.1.193) or the
  Jelly (192.168.1.82). Do NOT touch `~/experiments/` campaign dirs beyond reading;
  your device workspace is `~/gdn_k2/k4split/`.
- PC: a Marco requant job (another agent) may be running — cap builds at `-j4`, never
  kill anything, avoid saturating disk with extra downloads (everything you need is
  already on PC/device).
- Model on device: `Qwen3.6-35B-A3B-KEXP.gguf` (sha `ac44e20c…`) — it is the campaign
  model, already on the S23 (verify path + sha; it was used this morning for the
  speed gate). Campaign binary `bmoe-cli` sha `1ca51420…` is the CPU baseline binary.
  Your split binary comes from YOUR branch build (llama-cli/bmoe-cli target of the
  fork + parent engine if needed — study how `bmoe-cli` is built: `build-pc` scripts
  and the Android build precedent in `results/gdn_gpu_k2/BUILD_MANIFEST.md`).
- Battery rules: correctness/load tests MAY run plugged. ANY speed/thermal number:
  UNPLUGGED, batt ≥45%, temp guard 45°C battery. If the phone is plugged or low and
  the owner is asleep: arm a waiter (pattern: `results/gpu_sustained/wait_and_run.sh`)
  and continue with non-device work. It is ACCEPTABLE to end the night with speed
  arms armed-but-not-fired; it is NOT acceptable to measure plugged.

## Required reading (in this order, before any code)

1. `reports/moe-gdn-k0-op-inventory.md` — THE map: op coverage, recurrent-state
   allocation (states follow the layer's device), scheduler behavior (P1-P5 passes,
   synchronous OpenCL boundary copies), and **Q7: the expert-ready hook lives ONLY in
   CPU `mul_mat_id`** (ggml-cpu.c:1666) — the whole design exists to keep that true.
2. `reports/moe-gdn-k21-parity.md` + `moe-gdn-k22-fix.md` — Q6_K dispatch fix (your
   branch has it; dense KEXP tensors are Q5_K/Q6_K and NEED it).
3. `reports/moe-gdn-750.md` §correctness — the trunk op set is proven correct on
   A7X with `-fa off`. FLASH_ATTN is dead on A7X: always `-fa off`.
4. `reports/moe-mld-m1.md` — GEMV kernels are already at DRAM roof; do NOT attempt
   kernel rewrites in this task. The win here is PLACEMENT + freeing the CPU, not
   faster kernels.
5. `docs/moe-streaming.md` in BigMoeOnEdge + `core/src/moe/expert_stream_source.cpp`
   (hook registration ~line 1375) — the machinery you must not break.

## The design (binding)

- **Expert placement**: routed expert tensors (`ffn_*_exps`) must remain in CPU/mmap
  buffers so `mul_mat_id` runs on CPU and the hook fires. Two mechanisms, in order of
  preference — investigate in N0 and pick with evidence:
  (a) natural: KEXP experts are **Q2_K/Q3_K** — the OpenCL backend does NOT support
      those types for MUL_MAT_ID (K0 Q3 table) → `supports_op` false → scheduler
      leaves them on CPU automatically. Verify this actually happens with the
      streaming loader (the expert tensors may not even be normal backend buffers
      under `--moe-stream` — trace how they load).
  (b) explicit: `--override-tensor "ffn_.*_exps.*=CPU"` (the `-ot` mechanism used in
      K2.1) and/or a fork-side guard: under `--moe-stream`, force expert tensors +
      `mul_mat_id` nodes to CPU regardless of -ngl. If you need code for this, it is
      a SMALL patch in the fork (placement, not kernels).
- **Trunk placement**: `-ngl 99 -fa off` puts the 40 layers + output on GPU. Dense
  weights are Q5_K/Q6_K → MUL_MAT supported (with your branch's dispatch fix).
  Recurrent states follow layer device → GDN runs fully on GPU, no per-token state
  sync (K0 Q2). Attention: non-flash path (validated).
- **⚠ RAM BUDGET — the killer risk (8 GB phone)**: dense weights ~1.75 GiB will be
  COPIED into GPU (same DRAM via CL buffers) while `--dense-weights anon` also holds
  them CPU-side. Double residency = RescueParty (MemFree <100 MiB + die ~90°C = device
  reboot — campaign guardrail). In N0, trace whether the CPU-side dense copy is freed
  after GPU upload; if not, that is your first small patch (free/madvise after upload
  under a flag, e.g. `--dense-weights anon-gpu`). Monitor `/proc/meminfo` MemFree at
  every load test; ABORT any run if MemFree <300 MiB sustained. Expect total:
  dense-GPU 1.75 + cache 2000 MiB + KV (c=4096) + runtime ≈ 6-6.5 GiB. If it does not
  fit, reduce `--cache-mb` for the split cells (document the change — one variable at
  a time: then the CPU baseline must be re-run at the same cache-mb for fairness).
- **Config of record** (both arms unless RAM forces a change): campaign k6d065 =
  `-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap
  --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65`, `-fa off`,
  split arm adds `-ngl 99` (+ `-ot` if needed).

## Milestones

### N0 — Source recon + build (PC, no device). Kill-gate: BLOCKED_ARCH if the fork
cannot express the split at all.
- Trace `--moe-stream` × `-ngl` × `-ot` interplay in the fork (how expert tensors
  load, whether sched would try to place them on GPU, what happens to the hook).
- Decide mechanism (a)/(b), implement the minimal patch if needed (placement/free
  only — NO kernel work), build Android binary from your branch (`-j4`), sha256.
- Write `results/k4split/N0_DESIGN_NOTES.md`: the traced call chain with file:line,
  chosen mechanism, RAM budget table.

### N1 — Load + RAM smoke (device, PLUGGED OK). Kill-gate: RescueParty risk.
- Wait for the 4B marathon to finish. Push binary to `~/gdn_k2/k4split/`.
- Load KEXP with split config, `-n 8` tiny gen, ctx 512 first, then 4096.
- Record: load time, MemFree curve (sample every 5 s during load), graph splits count
  (GGML_SCHED_DEBUG=2 for ONE run, saved), which backend got which tensor class
  (from debug output), whether streaming stats (hit%, MiB/tok) still print.
- ABORT and mark BLOCKED_RAM if MemFree <300 MiB sustained — then retry once with
  `--cache-mb 1500`, and if still failing, `--cache-mb 1000`; document.

### N2 — Correctness (device, PLUGGED OK). Kill-gate: FAIL_CORRECTNESS.
- Greedy A/B, temp 0 seed 42, n=32, `-c 4096`, same prompt: CPU-only arm (campaign
  bmoe-cli or your branch with -ngl 0 — use YOUR binary both sides for a clean A/B)
  vs split arm. Token-identical required (fp reorder tolerance: if not identical,
  diff the first divergent token and investigate; a systematic early divergence =
  FAIL, stop speed work).
- Verify the hook is ALIVE in the split arm: streaming stats present and plausible
  (hit% within ±10 pt of the CPU arm on the same prompt, MiB/tok same ballpark).
  Hook dead = FAIL even if text is right.

### N3 — Speed burst (UNPLUGGED, batt ≥45%; waiter if needed). Pre-declared gate.
- ABBA × 2 prompts (byte-identical to this morning's speed gate prompts if readable
  from `results/marco_phase1/speed_s23/prompts/`), n=200, cold fadvise per run:
  ARM_CPU (`-ngl 0`) vs ARM_SPLIT (`-ngl 99 -fa off`), same binary, same config.
- Record decode t/s, prefill/TTFT, MiB/tok, hit%, batt/temp per run. CSV mandatory:
  `results/k4split/runs_speed.csv`.
- **Gate: split decode median ≥ 1.10× CPU** (modest and pre-declared: the trunk is
  roughly half the token time and GPU reads at best ~1.4× CPU bandwidth — a honest
  win here is 1.10-1.25×; do not oversell). Also report TTFT: prefill on GPU may win
  bigger (2.17× seen on dense 2B) — a TTFT win alone is a valid product result,
  flag it separately.
### N4 — ONLY if N3 gate PASS or TTFT ≥1.5×: sustained marathon (UNPLUGGED).
- 15 min ARM_CPU vs 15 min ARM_SPLIT, cooldown between (reuse
  `results/gpu_sustained/run_marathon.sh` pattern, adapted). The thermal thesis:
  split moves ~half the FLOPs+bytes to the GPU → CPU throttles less → sustained
  split may exceed burst ratio. Final-third comparison + temps + batt/1k tokens.

### N5 — Report + hygiene (PC).
- `reports/moe-k4-split.md`: design as-built (file:line for every patch), N0-N4
  tables, gate verdicts, RAM story, honest caveats, "what remains for product".
- `results/k4split/` complete; branch pushed... NO: branch stays local (no push,
  campaign policy). STATUS.md kept current after EVERY milestone (this is your
  resume anchor if the night dies).
- Update NOTHING in PLAN.md (the coordinator does that).

## Success definition (honest)

- MINIMUM viable night: N0+N1+N2 done with evidence (split loads, fits RAM, correct,
  hook alive). Speed arms armed for morning if battery/cable blocked.
- GOOD night: + N3 measured, whatever the verdict — a clean 0.95× is a real result.
- HISTORIC night: N3 ≥1.10× or TTFT ≥1.5×, + N4 showing the thermal dividend.

Never trade correctness for speed. Never measure plugged. Never let MemFree hit the
RescueParty zone. The S23 must be ALIVE in the morning.
