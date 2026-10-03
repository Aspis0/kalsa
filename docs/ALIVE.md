> Archived full history: archived/ALIVE-2026-09-full.md (7773 lines, mixed IT/EN, frozen 2026-09-20).

# Kalsa: ALIVE (living measured state)

Owner decision 2026-09-09 (recorded at `archived/PLAN-2026-09-full.md:1`): two living documents
only, `PLAN.md` and this one. The full diary
(every dated cell, table row and verdict to 2026-09-20) is in
`archived/ALIVE-2026-09-full.md`. This file keeps only the short measured state and the pointers
to the records.

## Headline (2026-09-23, overnight): the regime a user can trigger, and no arm had measured

The biggest finding of the project so far: at `ne1` 2..8 all 148 q4_K dense tensors run through
the `_cok` kernel (`gemm_noshuffle_q4_k_f32.cl`), whose operands AND accumulator are in **half**
- the last unfixed pair - and that regime reads **0.304543 median KLD / 66.198 % same-top**.
Every arm before tonight ran at batch 1 or 256, so this path had **never been covered**. Record:
`scratchpad/agents/s23-kld-740-q4-0/REPORT.md` sections **31b** and **34**.

| regime | trigger (what a user does) | kernels used by the 148 q4_K tensors | median KLD | same top | gate |
|---|---|---|---|---|---|
| b256 default (ship `1577495b9`) | prefill piece = full ubatch (common case) | main noshuffle GEMM: f32 product, float operand | **0.005412** | **93.982 %** | FAIL both, but close |
| b1 (decode shape) | every generated token | GEMV family: f32 operand, no quantiser, no transpose | **0.006012** | **93.138 %** | FAIL both |
| **b8 `_cok` (the trap)** | prefill piece in **2..8 tokens** -> `prompt_length mod 256 in [2,8]` at app ubatch=256 | `_cok`: HALF operand + HALF accumulator (never fixed) | **0.304543** | **66.198 %** | **catastrophic FAIL** |

**No row can be read without its trigger** - the guard, adopted with the table: a table whose
rows cannot be read without their trigger is a table that will eventually be misquoted. Both
ends are true of different prompts: ~94 % same-top for a prompt that is a clean multiple of 256
(or a 1-token tail), 66 % for a prompt whose tail lands in 2..8. This is the only number of the
night that describes what a USER experiences.

Trigger mechanics: the app's ubatch is **256** (`deviceTuning.ts:730-731`), so any prefill whose
final chunk is 2..8 tokens runs that whole last chunk through the kernel. Frequency, from
**606 archived real turn-records** (`product-suite/**`, S23/Jelly/Xiaomi): **31 (5.1 %)** land
there (ubatch-override 512: 3.8 %), clustered at prompt lengths **516-519** (mod 256 = 4-7; one
20-turn session sat entirely there) plus 771, 1285/1286, 2822, 4103 - prompts just past a 256
multiple, which a growing multi-turn chat produces constantly. Caveats as the measuring agent
stated them: record-level count (deduped per-turn <= 5.1 %, **not exactly computable from those
files**), laboratory sessions rather than field traffic, and it assumes `llama_decode`'s ubatch
split. What would settle it exactly: per-turn `n_prompt` with unique turn ids - named, not
fudged. The fix-verification pair is pre-registered before the binary exists (section 35): the
control must reproduce 0.304543 exactly or the pair is void; complete fix <= ~0.0065.

**Status (2026-09-23): this defect is FIXED and AUDITED, and NOT YET SHIPPABLE.** Branch
`kalsa-opencl-cok-fp32` at `319b53937` (one commit above the shipping tip `1577495b9`): the
control reproduced 0.304543 / 66.198 % exactly, the treatment read **0.006890 / 93.138 %** -
44x lower KLD, 99.51 % of the gap closed, **partial** by the pre-registered line (0.00039 over
0.0065); price +8.3436 % on a b8-only worst case, 0 % in decode. The independent audit refuses
shipment until the app-shaped verification runs
(`scratchpad/agents/cok-accumulator-audit/REPORT.md`). Detail: the overnight diary entry below.

## How to read this file

Each row names what is proven and the artefact that proves it. Nothing here is a summary of a
summary: where the record is a dated document, this file points at the document and does not
restate its numbers. Numbers that move under concurrent work are not copied here; the command or
document that produced them is named instead.

## Proven, with the record

| what | record |
|---|---|
| The app's `main` is `335f9c8d` (2026-09-28): it pins `llama.rn@3d2fff25` (the JSI fix that copies the NPU stats fields before the closure; base `4e0837f8`) -> engine `kalsallama@45f097b74`, with `native/kalsallama.pin` matching and `scripts/assert-engine-provenance.sh` at exit 0 (`1121 files match`, `kalsallama@45f097b74eb6 == native/kalsallama.pin`). The NPU lane landed on main **default OFF** (`2fb5ee4a`; bench key `kalsa.bench.npu_lane auto/on/off`); device APK CI `36434636903` is building and the step-5 device soak is pending. The 2026-09-23 chain (`d69b4ce`, binding `5b966218`, engine `1577495b9`, all suites green) is history. Origin keeps `main`, `ux-2026-09-21` (`fb3239b`) and the desktop line `brain`. `remote-brain` is retired as the tag `archive/remote-brain` (`ce71e78cd`); other retired branches are `archive/<name>` tags | `scratchpad/agents/app-branch-cleanup/REPORT.md`; `scratchpad/agents/app-ci-setup-android/`; `scratchpad/agents/remote-brain-port/` (RECON, STEP1/2, AUDIT-STEP1, AUDIT-STEP2-luna/-deepseek; open follow-ups in STEP2.md) |
| The binding's jest was not dead code. The binding's `node_modules` had been installed with pnpm, while CI and the lockfile use `npm ci`. After `npm ci`, 12/12 pass | `scratchpad/agents/binding-jest-dead/REPORT.md` |
| History (superseded 2026-09-22): the app shipped `llama.rn@0f313bab` → `kalsallama` `8537d097c` (`b11010-merge`), with the q4_K MoE OpenCL mask fix inside it | `PLAN.md`, "The q4_K MoE OpenCL fix is in the shipped engine"; `vendor/VERSIONS` at `0f313bab` |
| The migration to upstream's `vendor/` layout: the measured upstream bump, the gates, the repaired consumers | `analysis/FORK-VENDOR-MIGRATION.md` |
| ciswire char-3-gram retrieval: recall, KV and prefill behaviour, and device thermal on S23 and Jelly | `analysis/CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md` |
| Xiaomi/Qwen: the fit-gate vision refusal, the ciswire char-vs-token overflow, and what did run | `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md` |
| The governor KV session contract (deferred commit, watermark, invariants) | `analysis/README-governor-kv-contract.md`; the `file:line` pins in its header are stale, so re-pin before quoting |
| How to run the Qwen `<think>` replay probe | `analysis/README-qwen-think-replay.md` |
| The governor device plan, rewritten in English on 2026-09-20, and the audited Italian body | `analysis/GOVERNOR-DEVICE-PLAN.md`; `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md`; re-verification at `scratchpad/agents/governor-audit-recheck/REPORT.md` |
| Per-cell preregistration, raw evidence and reports | `scratchpad/agents/<cell>/` |
| The 2026-09-22 GPU numerics verdict: the fp16 activation scale as the cause of the 57x divergence, the shipped default, the `-b 1` floor, the KV term, the parity batteries, the regime table and the Z2 matrix void | `scratchpad/agents/s23-kld-740-q4-0/REPORT.md` (sections 17-35) |
| The prefill stall reproduced on the shipped build, with a full raw logcat | `scratchpad/agents/jelly-rerun/REPORT.md` (sections 11-16) |
| The delivery chain verified end to end: release tag, vendored tree byte-compared, app pin, provenance gate that can fail | `scratchpad/agents/{release-prep,release-audit,phone-line-prep,phone-line-audit,phone-engine-v2,phone-engine-v2-audit,binding-prep,binding-audit,app-landing,landing-check-fix}/REPORT.md` |
| The day's second refuted hypothesis (activation quantiser as the common residual) and its pre-registered falsifiers | `scratchpad/agents/quant-alignment/REPORT.md` |
| The governor trend question, CLOSED: producer, two reviews, and the wrong-fire replay (inert at production cadence, unproven - not safe) | `scratchpad/agents/governor-trend/REPORT.md` (rounds 1-4, harness `replay-wrongfire.cjs`); `governor-trend-numeric/REPORT.md`; `governor-trend-audit/REPORT.md` |
| The Meter decision: owner's rule, the 1 %/5 % bar, the pre-registration, and the soundness finding | `scratchpad/agents/s23-kld-740-q4-0/REPORT.md` sec. 30; `scratchpad/agents/governor-meter-recon/REPORT.md` sec. 5 and THE RANKING |
| Desktop speed numbers: the provenance verdict (CPU-only / GPU-capable / NOT ATTRIBUTABLE), the load-condition finding, and the profile-validity test matrix | `scratchpad/agents/governor-desktop-net/REPORT.md` |
| The tail fix: `_cok` accumulator (measured, then the independent audit's refusal), the K-order ablation for its residual, the build-provenance stamp, and the pre-registered morning queue | `scratchpad/agents/cok-accumulator/REPORT.md`; `scratchpad/agents/cok-accumulator-audit/REPORT.md`; `scratchpad/agents/cok-residual/REPORT.md`; `scratchpad/agents/build-provenance/REPORT.md`; `scratchpad/agents/s23-kld-740-q4-0/REPORT.md` sec. 35-37 |
| The governor ENGAGES on the S23: plan `gpu_fit=Fit`, GPU prefill / CPU decode, commit in ms, `route_push=applied` - plus the measured blind spot (Android status 3 while `thermal_state:FAST`) | `scratchpad/agents/s23-governor-lfm-long/REPORT.md` (commit `8c0e38e0`; "Manual governor smoke"; raw `raw/manual-smoke/`, `raw/baseline-before-thermal-20260927/`) |
| Per-backend heat measured on both chips: NPU coolest, CPU prefill never cooler, no NPU skin crossover in 12 back-to-back prefills, 8 Elite NPU decode 27 % cooler/token at -25 % speed | `scratchpad/agents/s23-heat-arms-engine/REPORT.md` (`147b0351`), `qdc-8elite-heat-arms/REPORT.md` (`335fc965`), `qdc-8elite-hopping-heat/REPORT.md` (`a6ec6507`) |
| One-copy CPU + NPU: S23 P5 is numerically correct; 8 Elite raw path is memory-efficient but slow and flat-only | `hexagon-onecopy-rawq4/REPORT.md` (`9a2fb2376`); `qdc-8elite-onecopy-cost/REPORT.md` (`9ac6ebc7`); governor design `4d606e4f`, `5a94d88c`, `df4a18d1`, `7ac42dec` |
| Iroh pairing and invite-by-link beta rollout, including `install_id` and public Worker reachability | app commits `aba67977`, `9922f2e7`; reachability commands and HTTP 200 results for both endpoints (2026-09-28): `scratchpad/agents/pair-worker-reachability/2026-09-28.txt` |
| Measurement method and rules for the lab | `PLAN.md`; `README.md` in this repo |
| The engine release pipeline and the manifest contract | this file, "Engine release pipeline"; current position in `PLAN.md` |

## Standing cautions

- The governor plan was re-verified and rewritten on 2026-09-20. It states its sourcing rule and
  applies it: every number carries an artefact citation or an explicit UNSOURCED label. The audited
  Italian body is archived byte-for-byte and is not a current source.
- The `README-governor-kv-contract.md` line pins were written against older trees and no longer
  match the current commits; re-pin before quoting a `file:line`.
- A device number is only as good as the phone state it was read in. The archived diary carries
  the per-run provenance, including the thermal and DSP-daemon caveats that travel with every S23
  number.
- Two limbs of 2026-09-22 remain OPEN: the MAGNITUDE of the KV term (the two reference orientations
  disagree by 3.2x; the full-corpus matched reference is queued), and the THERMAL limb of the
  prefill stall (both rerun runs sat at `ThrottlingStatus: SEVERE` where the originals ran NONE).
  Governor engagement is confirmed on the S23, but its blind spot remains: one long turn reached
  Android SEVERE while the battery-only engine classifier stayed FAST. The measured heat arms
  and 2026-09-28 owner direction are in "2026-09-26/28" below.
- A timing ratio is incomplete without the screen state of BOTH arms: with the screen off
  Android parks CPUs, the device's `screen_off_timeout` is 30000 ms, and the f32 route's
  published 68.42 was a Dozing number (screen ON it reads 71.98). Every bracket now records
  `mWakefulness`; a KLD number that ever moves with screen state outranks the queue
  (`scratchpad/agents/s23-kld-740-q4-0/REPORT.md` sec. 33).
- A published number without its **load condition** cannot be re-examined later: only the A/B and
  the panel records carry load, so the load-follows signature cannot be applied to anything else
  retroactively (`scratchpad/agents/governor-desktop-net/REPORT.md` sec. 3.3). Numbers we publish
  carry their load alongside the time, from here.
- A coder's refspec is a proposal, not a decision: the shipping line (`kalsa-phone-v1-1-1`)
  moves only when the audit's checklist is cleared, and a branch that holds a candidate fix is a
  different object from the line that ships. On 2026-09-23 a push block targeted the shipping
  ref; what ran created `kalsa-opencl-cok-korder` as a new ref instead, and the phone ref was
  verified unmoved at `1577495b9` afterwards (`scratchpad/agents/cok-residual/REPORT.md` sec. 9,
  re-verified with `git ls-remote`).
- On a lane-on load (`kalsa.bench.npu_lane=on`) the governor's per-chunk `"actual"` and the
  per-turn `engine_prefill` label do NOT name the executing device: the S23 run of 2026-10-01
  logged `"actual":"gpu"` 303 times and never `npu` while HTP0 was the only model device
  (`scratchpad/agents/s23-governor-npu-gpu-cpu/AUDIT-r1.md`, re-checked on disk). Until the
  telemetry fix lands (owner 2026-10-01), read the device from the load (`devices=`, HTP buffer
  lines) and the speed, never from the label. That run's headline in-app ratio, NPU ~1.2-1.5x
  GPU prefill, stands only as an ordering; its report is being corrected.
- In-app NPU prefill keeps the KV cache in host memory (`no_kv_offload`, because the shipped V cache is
  q4_0 and HTP cannot write it), which runs attention on the CPU. Measured on QDC 8 Elite (v79) on
  2026-10-01, the cost grows with context: with KV on host, a 128-token chunk takes 236 → 927 ms from
  depth 512 to 3100; with KV on HTP it takes 101 → 122 ms (`scratchpad/agents/htp-kv-attention/`).
  Any in-app NPU speed number is therefore context-dependent; quote it with its depth. Not yet
  repeated on the S23 (v73).

## Phone speed table (on-device only, every number with its source)

Built 2026-09-29 from a lab-wide extraction; every row below was re-read by the coordinator on
its source line. Rows are comparable only inside one row (same kit, same run); across rows the
tool, prompt length, threads and build differ. Not included: numbers without device + model +
backend in the same report, VOID/REFUTED runs, simulator/desktop numbers, published figures.

**Ship model LFM2.5-2.6B QAD-Q4_0** (sha `a247afd6…`; `ship.gguf` in the heat kits is this file)

| device (SoC) | run | prefill CPU / GPU / NPU | decode CPU / GPU / NPU | source |
|---|---|---|---|---|
| Galaxy S23 (8 Gen 2, v73) | heat arms, ~962-tok prompt | 97.12 / 138.44 / **653.98** tok/s | 22.41 (t5) / — / — | `scratchpad/agents/s23-heat-arms-engine/REPORT.md:86-88,97` |
| Galaxy S23 | backend hopping, tg256 median | — | 22.13 / 14.03 / 22.09 tok/s | `scratchpad/agents/s23-backend-hopping-heat/REPORT.md:12-14` |
| Galaxy S23 | 3-way control, kit `f25f0c1c5`, 1010-tok prompt, tg126 | 10,389.45 / 7,326.37 / **1,558.10** ms | 21.14 / 11.18 / 12.96 tok/s | `scratchpad/agents/xiaomi14-3way/REPORT.md:16-19` |
| Xiaomi 14 (8 Gen 3, v75) | 3-way, kit `f25f0c1c5`, 1010-tok, tg126 / tg256 | 7,542.59 / 6,855.27 / **1,447.97** ms | 27.53 / 13.26 / 16.24 (tg126); **29.21** / 15.49 / 23.33 (tg256) | `scratchpad/agents/xiaomi14-3way/REPORT.md:16-20` |
| 8 Elite QRD8750 (v79) | heat arms, ~962-tok | 197.9 / 290.0 / **1,046.4** tok/s | — | `scratchpad/agents/qdc-8elite-heat-arms/REPORT.md:25-27` |
| 8 Elite QRD8750 | hopping heat, tg256 | — | **39.0** / 30.3 / 29.1 tok/s | `scratchpad/agents/qdc-8elite-hopping-heat/REPORT.md:79-81` |
| 8 Elite QRD8750 | NPU v79 cell, pp512 / tg128 | 211.1 / — / **1,512.2** tok/s | 38.49 / — / 23.47 tok/s | `scratchpad/agents/qdc-8elite-npu-v79/REPORT.md:93` |
| 8 Gen 3 QRD8650 | build `5c3979438`, -t 4 taskset f0, pp512 / tg128 | 16.26 / **284.18** / — tok/s | 11.56 / **23.42** / — tok/s | `scratchpad/agents/qdc-8g3-govbench-55/REPORT.md:47-48` |
| 7+ Gen 3 QRD7675 | build `5c3979438`, same flags | 13.77 / **151.78** / — tok/s | 10.27 / **17.26** / — tok/s | `scratchpad/agents/qdc-7pg3-govbench-52/REPORT.md:53-54` |

Reading: NPU prefill is 3.6x (8 Elite) to 4.7x (S23, Xiaomi 14) the GPU wherever both ran; CPU decode is the fastest decode on
every Snapdragon measured in 2026-09 builds (NPU equals it only on the S23 tg256). The QRD rows
come from an August build whose CPU prefill (16 tok/s) is far below the September kits (~134 tok/s
on the same 8 Gen 3 SoC): compare them only with each other.

**Other models (one run each; flags differ per campaign)**

| device | model | run | prefill | decode | source |
|---|---|---|---|---|---|
| Galaxy S23 | Qwen3.5-2B Q4_K_M | llama-cli `bin_fix2`, 490-tok prompt, tg128 | CPU 39.01 / GPU 101.44 tok/s | CPU 8.13 / GPU 5.26 tok/s | `reports/moe-s23-idle-ideas.md:110-113` |
| Galaxy S23 | Qwen3.6-35B-A3B KEXP (MoE, streamed) | n=200, CPU vs GPU-trunk split | — | CPU **2.901** / split 2.025 tok/s | `reports/moe-k4-split.md:305-311` |
| Jelly Star (Helio G99, Mali) | Qwen3.5-2B Q4_K_M | CPU, -t 2, n=200 | — | 8.04 tok/s | `reports/moe-g99-freetier.md:64` |
| Jelly Star | LFM2.5-8B-A1B Q4_K_M (MoE) | CPU, -t 2, experts k=4 / 3 / 2 | — | 10.60 / 12.28 / 14.38 tok/s | `reports/moe-g99-freetier.md:65-67` |
| Jelly Star | LFM2.5-8B-A1B KEXP / REAP-50 | CPU, k=4 | — | KEXP 8.83; REAP-50 10.68 tok/s | `reports/moe-g99-freetier.md:232-233` |
| 8 Elite QRD8750 | Marco-Mini-Instruct KEXP Q4_K_M | build `5c3979438`, pp512 / tg128 | GPU 274.24 / CPU 107.84 tok/s | GPU 48.83 / CPU 61.16 tok/s | `scratchpad/agents/qdc-8elite-speed-kexp/REPORT.md:36-37` |

Gaps: no NPU numbers for any model other than the ship model; no Jelly GPU (Mali path not
measured, `archive-gpu-cells/REPORT.md:510-512`). The raw extraction (56 rows, with its errors) is
not kept in the lab; this table is the curated result.

## Ling-3.0-tiny: Chinese only (owner, 2026-10-01)

**Owner decision: Ling-3.0-tiny is not offered for the European and American languages (EN, IT,
ES, FR); it stays a candidate for Chinese only.** It is in no app catalog today.

Measured on the M1 Max (official Q4_K_M, sha256 `246d67d4…`, fork Metal build 9f3c2e069, 94–99
tok/s), 13 hard questions in IT/FR/ZH/ES (`analysis/ling-probe-2026-10-01/REPORT.md`):
- Thinking on (the model's default): 4/13 answers empty, all 4096 tokens spent reasoning; 3 of
  them Italian (`quiz-out.json`).
- Thinking off: Italian confidently wrong (grammar of "gli/le", Dante Inferno V hallucinated,
  train problem mis-set) (`nothink.txt`). Chinese 3/3 correct; arithmetic correct in every
  language; French law and the Spanish poem wrong.
- Lenovo (RTX 4050, all layers on the GPU at 64k): 99 tok/s, TTFT 0.76 s; owner Italian quiz 45/54
  vs Gemma E4B 49 (kalsa-brain `docs/LAB-LENOVO-2026-10-01.md`).

If it ever ships for Chinese: thinking capped or off, and an empty answer counts as a failure.

## Closed workstreams

### 2026-09-21 (21/09, night) — KV-cache workstream closed; vision pivots to LFM2.5-VL

**The KV-cache workstream is CLOSED for this cycle.** Bug #2 (ciswire budgets the window in
CHARACTERS, and the ceiling-slide projected `chars/3`) is **fixed and merged to the LOCAL app
main**: `ff6a7c0` (call-site wiring in `AppShell.tsx` — the char/token ratio is MEASURED from the
real syncs, `(pinnedWindowChars-currentTurnChars)/(nPast-systemPromptTokens)`, with NO await and
TOCTOU-safe, monotonic: it slides only BEFORE, never after) on top of `24c2e3e` (the pure machinery
in `windowProfile.ts`). The feature branches were deleted; main is a single line; **no push**.
Hostile GLM audit: monotonicity PROVEN (no overflow regression), TOCTOU clean, the harness's
telemetry parser inert to the new fields; tsc plus 48/48 jest green, verified on disk.

**KV reuse + prefill on Qwen is DEMONSTRATED** (whole-prefix; turn 3 = 3865/6257 tokens reused)
before the thermal abort (44.1 °C at turn 3). Honest correction: prose measures ~1.53 chars/token
on the Qwen tokenizer (not 3.9), so `prose@5000` at n_ctx 16384 was mis-calibrated *and* thermally
non-viable; Qwen 4B on Xiaomi stays a mess (fit-gate + norepack + thermals).

**Pivot (owner): LFM2.5-VL for vision on the Xiaomi**, in place of Qwen 4B. Websearch: LFM2.5-VL
exists in 450M/1.6B/3B (there is NO ~2.6B VL: the "2.6B" is only the LM backbone of the 3B, and the
closest to the idea is LFM2.5-VL-1.6B), official LiquidAI GGUF + mmproj, and llama.cpp mtmd support
is already MERGED (PR #15347, vision LFM2-VL, plus #19454, tiling LFM2.5-VL). Residual gate: verify
that our fork's pin includes those PRs (kalsa-63). **Bug #1 (lazy vision)** stays relevant with the
VL too.

Record: `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md` §8.

### 2026-09-22 (22/09) — GPU numerics: cause found; the stall reproduces on the shipped build; the chain verified end to end

**The fp16 activation scale was the cause of the 57x divergence.** A/B on the S23
(`scratchpad/agents/s23-kld-740-q4-0/REPORT.md` sec. 22): the fp16 control reproduces stock
**bitwise** (0.394993 / 63.892 %); the fp32-scale arm collapses to **0.005412 / 93.982 %** at
**76.44 t/s** - better on both gate limbs than the f32 route (0.006954 / 92.913 % at 68.42) and
faster than stock, so the f32 route's -9.9 % prefill cost is recovered. Confirmed in the shipped
default form, no env var at all, sec. 23: **0.005412 / 93.982 % / 76.36 t/s**. Gate: still FAIL
both limbs, but by the smallest margins measured (KLD 8 % over, same-top 1.0 pp short). The build
that carries it is engine `1577495b9` (`scratchpad/agents/phone-engine-v2/REPORT.md`; audited in
`phone-engine-v2-audit/REPORT.md`).

**The `-b 1` floor probe closed two axes** (same report, sec. 17). At batch 1, stock and full
precision are **bitwise identical: 0.006012 / 93.138 %, FAIL both limbs**. As recorded there: the
acceptance gate (<= 0.005) is **not reachable by batched-GEMM precision work** - the residual is
common to both batch shapes, not a batching artefact.

**The KV term: measured, magnitude OPEN** (sec. 24, 26). At the app's shipped KV configuration
(`q8_0` key / `q4_0` value, `-fa on`) the shipped engine reads **0.010268 / 92.126 %** full corpus
and **0.011096 / 92.717 %** reduced corpus - about **twice** the kernel-side error (0.005412).

| term | full corpus (n=1778) | reduced corpus, 4 chunks (n=508) |
|---|---|---|
| shipped KV cell (`q8_0`/`q4_0`, `-fa on`) | **0.010268 / 92.126 %** | **0.011096 / 92.717 %** |
| kernel-side reference point (D1 default / B' f16-fa-off) | 0.005412 / 93.982 % | 0.005426 / 94.882 % |
| isolated GPU-side KV term | **+0.001493** | **+0.004754** |
| flash-attention term | +0.003363 (conflated with a mixed reference) | **+0.000916** (matched) |

The isolated term is therefore **+0.0015 to +0.0048 depending on reference orientation** - the two
corpora disagree by **3.2x** - so the magnitude is **not yet settled**, and the full-corpus matched
reference (`cpu-f16faon`, killed under charge once) is **queued** (sec. 24's missing cell). What
both corpora do support: the pure flash-attention term is small (**+0.0009**, matched), and the
GPU-side KV penalty is real and positive in both orientations. Reduced-corpus numbers are
decomposition-only (n=508) and do not go in the same column as the 14-chunk tables (sec. 26 banner).

**The owner's question is answered: the arm differences are adverbs, not facts** (sec. 18-20):

| battery | result |
|---|---|
| 6 realistic prompts, 15 arms | every pair diverges textually (first diff at char 19-386); **material divergences: 0** (P1 all arms "Canberra"; P4 the same tool call) |
| 10 memory facts, CPU vs GPU | differ **10/10**; rows where one arm is right and the other wrong: **0** (reverse case: 0); final answers emitted in budget **0/10** |
| safety, 6 categories x CPU/GPU x t0/t0.7 = 24 arms | complied **0/24** - parity holds on all 6 categories at both temperatures; **4 pre-answer cells flagged RELEASE BLOCKER CANDIDATE** (S1_t07, S4_t0, S6_t0, S6_t07) |

Truncation caveat that governs both batteries: the reasoning template consumes the token budget,
so classes describe pre-answer reasoning intent, not final replies; a budget-up re-run (n>=160) is
required before acting on the safety marking - owner's call.

**The stall reproduces on the configuration we ship** (`scratchpad/agents/jelly-rerun/REPORT.md`,
sec. 11-16). On APK `d3c66bdb` (engine `1577495b9`): `KALSA_STALL
{"gapMs":0,"tokens":0,"turnId":"1","reason":"prefill","tokPerSec":31.755...}` at **+1175.04 s**
after `KALSA_THINKING` (original: +739 s), same form, zero tokens, persisted notice `entro 1175 s`.
For the first time a **full raw logcat** exists: **zero native/RNLlama lines across 19.6 minutes** -
a silent stall, not a crash (closing meter-close's unproven blank-window item for this run). Run B
COMPLETED (+213.30 s, 75 tokens, answer `4`) but **two variables moved** (seeded EMA *and* warm KV,
`nPast:11875`, only 761 new prompt tokens), so **"the EMA fixed it" is not supported** (sec. 13).
Both runs ran thermally throttled (`ThrottlingStatus: SEVERE` x69, skin 47 C) where the originals
ran NONE - **the thermal limb is untested** (sec. 16); the cool-state repeat is the cheapest next
measurement and was not set up because the APK is not debuggable (D1: no `run-as`, no energy CSV).

**The instrument lesson of the day, twice - one disease: work that exists in exactly one place.**

1. The Meter arms itself by writing a flag into the app's private storage, which needs `run-as`,
   which needs a **debuggable** app. That flag lived as a **one-line hand edit** (`debuggable true`)
   inside `android/app/build.gradle` - a file that is gitignored and regenerated by
   `expo prebuild` - so a clean prebuild deleted it, and with it the ability to measure energy on
   the release artefact. A **tracked bench build** is in flight, plus a channel that does not need
   `run-as` (`scratchpad/COORDINATOR-STATE.md`, "Results of 2026-09-22").
2. An APK whose hash was cited in a report (`fbfe131f...`, sec. 3) was deleted by the 2026-09-21
   cache cleanup and exists nowhere this Mac can see (all 50 APKs hashed, 0 matches, sec. 8).
   **Rule adopted: an artefact whose hash is cited must be archived before any cleanup touches
   build output.** Honoured the same night: the shipped APK was archived to
   `~/kalsa-local-artifacts/` before install (jelly-rerun sec. 11).

**The day's second refuted hypothesis - the activation quantiser as the common residual**
(`scratchpad/agents/quant-alignment/REPORT.md`, sec. 0). The hypothesis: the ~0.005-0.006 residual
common to both batch shapes is carried by the GPU's activation quantiser. Refuted, and the reasons
are the record:

1. **At batch 1 the quantiser never executes.** All seven `kernel_quant_a_q8_1` dispatch sites are
closed for this model at `ne1==1` (q6_K needs `ne1 > 8` at `ggml-opencl.cpp:23090`; q4_K dp4a is
X2E-only; q4_0 defaults false; the rest are off or in dead MoE branches). The b1 GEMVs read
`CL_FLOAT` activation images - f32 end to end. **A component absent in one shape cannot be the
term common to both**, which was the whole inference; the bitwise stock==full at b1 proves only
that the selector is inert at that shape.
2. **Where the quantiser does run, its sign helps**: at b256, removing it (the f32 route) costs
**+0.001542** (0.005412 -> 0.006954). It cannot carry the +0.005 that is there.
3. **What survives**: the residual is plausibly **weight-side** - the fp16
`half4 dequantized_weights` in the K-quant kernels (`gemm_noshuffle_q4_k_f32.cl:63`) and the gemv
`d*sv` half sub-scale. Present in both shapes, and **never measured on q4_K/q6_K anywhere** (the
older Adreno work tested it only for q4_0). The reference-side Q8_K floor is the other survivor,
and it can only be attacked by *adding* CPU-matching quantisation to paths that have none.
4. **Pre-registered falsifiers, written before anything is built** (sec. 3): an instrumented b1 run
must report `quant_a=0`; the env-only q4_K dp4a forcing probe at b256 must land >= ~0.0085 under
the old hypothesis (< +0.002 kills it); a Q8_K-matched build must move >= -0.0005; a b1 arm with
harness-proven bitwise CPU-matched activation codes must stay >= 0.0055 to falsify the floor and
hand the lead to the weight side. Two anomalies kept open, not smoothed: b1 and b256 were scored
against **different references** (PPL 27.0660 vs 27.2114), and the **+0.001542** where the f32
route is *worse* than the int8 route is unexplained.

The pattern, kept: **a hypothesis is only useful if the number that would kill it is written
before the measurement.**

**The delivery chain moved, and it is verified end to end for the first time:**

| link | value | record |
|---|---|---|
| release tag | `kalsa-server-v1.1.1` on engine `a7d2cec79` (= `main` `833cde99b` + the governor pair) | `scratchpad/agents/release-prep/REPORT.md`; independent audit 6/6 in `release-audit/REPORT.md`; tag object `0f1b3bec...` read from the remote in `phone-engine-v2-audit/REPORT.md` sec. 7 |
| artifact | published to R2, manifest names the tag object and the commit, run `35762258094` | manifest read back by `kalsa-brain` `dev/results/concurrency-two-devices/results.json` |
| binding | `kalsarn-governor-engine` = `5b966218`; vendored tree proven byte-identical to the engine archive plus the repo's 20 patches, by comparison | `scratchpad/agents/binding-prep/REPORT.md` round 2 sec. 2 (VERIFY_OK; independent audit of round 1: `binding-audit/REPORT.md`) |
| app | branch `engine-pin-kalsallama` = `e206a945`; provenance gate enforced and now **able to fail**: breaking the pin exits 2 with both shas printed | `scratchpad/agents/app-landing/REPORT.md` R2; `landing-check-fix/REPORT.md` (suite 37 passed / 0 failed) |

Two honest caveats, stated rather than smoothed:

- The CI run triggered by that push **failed before reaching the gate**
  (`android-actions/setup-android@v3` cannot fetch the removed `tools` package), so CI-enforced
  provenance does not exist yet - only the place where it should stand (`scratchpad/COORDINATOR-STATE.md`,
  "Chain state").
- Jest is **dead** in the binding's environment: 12/12 suites fail inside react-native 0.72's jest
  setup on node 26, pre-existing on the pristine base - that layer has no test net
  (`scratchpad/agents/binding-audit/REPORT.md` item 5).

**The desk's panel number (other workstream) - three runs, one row.** The desk answered the
discrepancy plainly: **not a transcription - three different runs of the same measurement**, all
three now registered. Two devices decoding on one `kalsa-server-v1.1.1` engine, attributed to the
release artefact by its published sha (`exe_sha256` matched against the manifest row,
`release.status = matched`):

| run | commit | per device | aggregate | A2/A | load floor (1m) |
|---|---|---|---|---|---|
| 1 | `5b9b98f` | 0.7546 (**69.17 alone / 52.20 each t/s**) | **1.5093** | 1.0105 | ~4-6 |
| 2 | `fe14e78` | 0.7302 | **1.4604** | 0.9982 | ~2 |
| 3 | `34de14f` | 0.7336 | **1.4672** | 1.0037 | 4.08 |

**The panel row is run 3**, and the reason is not recency: it has the tightest drift control
(1.0037 against 1.0105) and its provenance travels as **fields inside `results.json`** rather than
in prose - a debt the desk declared and the following session paid. Two things that must sit next
to the figure, because a reader following only the path cannot see them:

1. **Run 3 overwrote the same file.** `dev/results/concurrency-two-devices/results.json` now holds
   run 3; run 1's `results.json` survives **only in git history, at commit `5b9b98f`**. Wherever
   this path is cited it must cite the commit too - otherwise two different figures attributed to
   one path read as a transcription error, which is exactly the confusion this round untangled.
2. **The three runs agree within 3 %** (1.4604 / 1.4672 / 1.5093), per-device between 0.73 and
   0.75: the spread between runs is **the floor, not the measurement**. So the figure is never
   written as a constant - it is read with the artefact label and the load alongside.

Record: the three commits above, `kalsa-brain` `dev/results/concurrency-two-devices/`, and
`kalsa-brain/docs/HANDOFF-2026-09-22.md` sec. 4.

**The four desk commits: recorded local-only, then pushed the same day - correction kept
visible.** The panel row labelled with the release (`1f22bb7`), the provenance fields inside the
artefact (`fe14e78`), and the two tasks recorded as decided-and-not-implemented, now implemented
locally - `Stopping` (`6efec90`) and the `Stopped` invariant with its proof (`f1df191`,
`ae78761`, `f9d8861`) - sat LOCAL-ONLY pending an owner decision: `origin/brain` at `cac9068`,
the session's handoff saying plainly "no push was authorized". That state was real while it
lasted, and it is kept on purpose rather than erased: it was the fourth candidate of the day for
**work that exists in one place only**, the same disease as the two process lessons above.

**Corrected 2026-09-22: the desk pushed.** `cac9068..3660706  brain -> brain`, exit 0, the
fast-forward re-verified an instant before pushing (remote still `cac9068`, 0 behind / 14 ahead),
working tree clean before and after, local `HEAD` equal to the remote sha. The remote now reads
`refs/heads/brain = 3660706793dad68f0ac85366ab09805cb6ddb733`, confirmed independently with
`git ls-remote`. The state changed; the reason it was flagged does not: one-place work bit this
project three times today, and this was the fourth candidate until the push closed the window.

### 2026-09-23 (overnight from 22/09) — method correction, a voided matrix, the governor question closed

The regime table - the biggest finding - is at the TOP of this file ("Headline"), because it is
the number a reader must hit first: `scratchpad/agents/s23-kld-740-q4-0/REPORT.md` sec. 31b and
34. The rest of the night:

**Screen-state method correction (sec. 33).** With the screen ON (`mWakefulness=Awake`), the
shipped default reads **76.39 +/- 0.17 t/s** - inside the dozing band 76.36-76.44, confirmed
_equal_ - but the f32 route reads **71.98 +/- 0.07**, i.e. **+5.2 %** over the published 68.42.
The default-vs-f32 gap therefore narrows from **-11.7 %** (both Dozing) to **-6.1 %** (both
Awake). The device's `screen_off_timeout` is 30000 ms, which is why every earlier timing was
taken dozing. Rule recorded: **every future ratio must state the screen state of both arms** -
every bracket now carries `mWakefulness`, a timing number without its screen state is
incomplete, and a KLD number that ever moves with screen state outranks the queue. Older
timings are marked "screen state not recorded", not retro-fitted. A number measured in a state
the product is never used in is a number we would have had to withdraw.

**The Z2 attribution matrix was annulled by its own gate (sec. 32).** The gating control was
pre-registered to reproduce Z2 exactly (**5.103422 / 12.373 %**; any deviation -> the whole
matrix VOID) and read **5.635640 / 9.280 %**: VOID, as written, reported as a build finding and
not absorbed. The corrected control (criteria written before it ran) read **0.005454 / 94.488
%** - far outside the salvage band - so **the matrix stays VOID for cross-binary attribution,
and that is the finding**: `e64352ac1` moved the UNSET default at the q4_K site to fp32, so the
new binary can no longer reach the state Z2 measured. A companion arm replicated an earlier one
**byte-equal** (**0.005615 / 94.263 %**, inside the new binary - a free replication). What
survives, within one binary: forced q4_K-dp4a with both scales fp32 reads 0.005454-0.005615,
ship-default neighbourhood - **a -99.9 % collapse of the destruction** (5.635640 -> 0.005615).
Honest summary of that path: **fp16 `da` at the q4_K site is the destroyer, fp16 `sa` adds about
half on top, and with both gone the numbers are ordinary.** Open on this thread: the forced
config's speed (not ordered); the explicit-fp16 arms re-arm cliffs (mechanistic reading,
flagged post-hoc in the report).

**The governor: trend producer landed, attacked twice, then the question closed.** Producer
`7921719` + review fixes `ed55f7d` (app-only: the `trend_c_per_min` pipe now has a producer and
the raw platform thermal state rides to the JSI boundary, where the pinned binding drops it -
SEVERE cannot reach an engine decision app-only; 95 suites / 1243 tests; push UNRUN -
`scratchpad/agents/governor-trend/REPORT.md`). Two attacks: the post-hoc review (arithmetic
confirmed, the gap-anchoring defect REFUTED, mutation killed 7 of 13 trend tests -
`governor-trend-audit/REPORT.md`) and the numeric review (`governor-trend-numeric/REPORT.md`,
586 lines, including the replay that verified the coder's fail-before evidence). What it
measured that nobody had looked at: the sampler's real poll gaps are **280.65 / 292.33 / 274.77
s** - about **two samples per five-minute window** - so a 60 s burst is diluted by **4.7x** the
threshold, and a session whose battery rose **7.2 C** never reported above **0.75 C/min**, half
the threshold. The engine consults the field only inside a **1.0 C band**: a trend fire buys at
most **40 s**, a wrong fire costs **>= 600 s** of COOLMODE - **200:1**. **The field is
effectively inert at the current cadence, which fails safe**, and the real lever is **a
temperature feed on the poll path**, not the trace interval (the 1 Hz trace has no temperature
column).

**The closing replay - recorded as a conclusion, not an open item** (same report, round 4;
harness `replay-wrongfire.cjs` + `replay-out.txt` kept on disk). The estimator under test is
the REAL `governorTrend.ts` (sha256 `2769fc2c11c948ab0775c52619862c08a90a07f33fdb3d8f63e551f943afab63`);
the decision side is an **explicitly declared re-implementation of one rule** at the pin
(`k_trend` L13, thresholds `h:45-52`, unplugged band `[38.5, 39.5)` from L44, LOWBAT L128,
trend line L140-143) - the engine never ran, and the report says so in its first section, not
in a footnote; the TRUE/FALSE yardstick is the author's and is stated as such. Corpus **75
sessions / 8871 rows loaded, 71 replayed**, from named sources with named exclusions. At the
**production cadence** (the 280 s poll grid the map measured): **15 in-band opportunities, 0
flips**. At **dense** cadence: **122 opportunities, 2 flips, 1 classifiable - and that one was
a FALSE fire** (38.6 C, trend 1.98, every gate passing; twelve seconds later the reading is
37.1 C; the absolute gate would still have arrived **1216 s later**, against the at-most 40 s a
trend fire can buy and the >= 600 s a wrong COOLMODE costs).

**The state of this question, as the closing sentence: at the production cadence the feature
is inert on the archived corpus, and therefore unproven - not safe.** Beside it, the sharpest
methodological line of the night: **the file count is not the sample** - the missing quantity
is named as *in-band time at poll cadence with a recorded outcome*. Consequences, all three
recorded: (a) the trend producer is **not to be shipped as an escalation trigger** on this
evidence - the code is reviewed and honest, the value unproven; (b) the real lever remains **a
temperature feed at a higher rate on the poll path**, whose cost is what the Meter experiment on
the phone is measuring; (c) **the replay harness stays on disk** so the question is re-asked
when the corpus grows, instead of being re-argued.

**Two traps - the day's disease in a new place.** (a) A worktree (`kalsa-wt-gov-trend`) whose
`node_modules` was a **symlink** to another checkout (created to avoid a 7.7 GB install): the
provenance gate reads `$REPO_ROOT/node_modules/llama.rn`, and a path traverses an intermediate
symlink, so the gate would have verified **a different tree's installation, invisibly** - a
green from a gate that read another tree is the "most expensive kind of green"
(`scratchpad/COORDINATOR-STATE.md`, sixth lesson). Fixed by a real copy from the tree with the
same pin (directory dated 2026-09-23 00:53) and **re-verified by running the gate** in this
pass: `lockfile pins Aspis0/kalsa.rn@5b966218eadb`, `1119 files match Aspis0/kalsa.rn@5b966218eadb`,
`engine inside it: kalsallama@1577495b9209 == native/kalsallama.pin`, exit 0, tree clean
afterwards. (b) The shared checkout's "dirty" files turned out to be **byte-identical to commit
`1068eb03d`** (`git diff --quiet 1068eb03d -- .` empty for tracked files -
`scratchpad/agents/build-with-fixes/REPORT.md` sec. 2.4): nothing at risk, but a reader of that
tree sees line numbers matching a commit that is neither `main` nor the shipped line - which is
why `scratchpad/agents/shared-term/REPORT.md` sec. 0 takes every line number from a `git show
HEAD:` blob, and why the desk's lesson is two-part attribution: **which commit AND which tree**,
with a third verdict for numbers with neither: NOT ATTRIBUTABLE (`COORDINATOR-STATE.md`,
seventh lesson).

**The Meter decision: rule, bar, pre-registration, soundness (part of the record, not the
news).** Owner's rule (`s23-kld-740-q4-0/REPORT.md` sec. 30): nearly zero consumption -> release
APK, governor leans on it; real consumption -> development builds only. The quantified bar the
Explorer derived (`governor-meter-recon/REPORT.md`, THE RANKING item 2), against the measured
turn draw of **1,045 mA**: **1 % = ~10.5 mA (0.17 mAh/min) is cheap enough; 5 % = ~52 mA is
self-defeating** - and no measurement of the Kotlin sampler's own consumption exists anywhere
on disk, which is the number the phone is measuring. The pre-registration is on disk before the
measurement (sec. 30): **<= +5 % per turn = release-ready** (and within 3x the std-dev of the
matched idle windows), **>= +15 % = dev-only** (between = dev), and **> 10 % divergence between
the CSV and the phone's charge counter = a finding that outranks the queue**. The honest
soundness finding (`governor-meter-recon/REPORT.md` sec. 5): **energy helps as post-hoc
evidence, as a session budget and for residency, and is unsound as within-turn control** - it
lags the decision it would guide. The tracked debuggable mechanism itself was proven the same
night: the `KALSA_DEBUGGABLE` gate in `app.config.js` and `plugins/withDebuggableRelease.js`
both exist at `e206a94`, and CI builds a debuggable release when the gate is 1
(`scratchpad/agents/bench-apk/REPORT.md`) - today's APK carries no `debuggable` attribute
because the gate was 0.

**Desktop provenance audit: CLOSED, as a verdict** (`scratchpad/agents/governor-desktop-net/REPORT.md`
sec. 3; sweep = **228 REPORT.md files, 87 carrying speed lines - 4 desktop, 83 device or
third-party** - plus `analysis/`, `PLAN.md` and this file checked line by line). The criterion is
**CPU-only or GPU-capable**, with three verdict words that must not share a meaning:
GPU-capable / CPU-only / NOT ATTRIBUTABLE. No reconstruction from dates or from today's tree:

| desktop number | verdict, as recorded |
|---|---|
| Panel (69.17 / 52.20 / 1.5093 ...) | **fully attributable: contains the fix, GPU-capable** - the manifest ties tag -> commit `a7d2cec79` -> `exe_sha256 327fb363`, with `backend: metal` and a CI build |
| Slot-save (1495.0 tok/s prefill, 71.33 decode) | the dylib is Metal-capable (re-checked by `otool` on that exact artefact: one Metal reference), but the command line records **no `--n-gpu-layers`** - **the lane is not attributable**; label it as such rather than guessing |
| A/B pair, fork arm (7.853 / 14.552 ms/token) | **CPU-only build** - CMake cache (all four backends OFF) and `otool` (zero Metal refs) run today; the binary's mtime (15:23) predates the 15:24-15:29 dirty edits, so that set survives **by luck, not by construction** |
| A/B pair, release arm (0.490) | GPU-capable by its own single-flag control (0.488 vs 9.860, one flag, one engine), but its **artefact path and tree are NOT ATTRIBUTABLE** |
| Apple-silicon figure (0.94 / 0.61) | upstream commit `e02b477` - **third-party, NOT ATTRIBUTABLE**, ours neither to label nor to withdraw |

**The one-sentence verdict: none of our published desktop numbers except the A/B fork arm was
measured on a CPU-only build; that pair already carries the explanation and needs a CPU-only
label rather than withdrawal; and the two unknowns are written NOT ATTRIBUTABLE rather than
guessed.**

And a finding about our own records, kept beside it: only the A/B and the panel record their
**load condition**, so for everything else the load-follows signature **cannot be applied
retroactively** - hence the standing caution added above: numbers we publish should carry their
load condition, or they cannot be re-examined later.

**Desktop net: a test-only matrix over the profile-validity gate** (same report, sec. 2).
`test_profile_validity_matrix()` inside the existing `tests/test-governor-v02-router.cpp`: **11
rows asserting validity AND state AND lane AND the admission consequence** (probe prompt 1900
tokens, the A/B's own size), +37 check call sites, no new test file. **Proven to bite:**
removing the gate line `profile.t_idle_c > 0.0f` produces **13 failures, ten of them from the new
matrix** (the other three are the fix's own pins), and the suite is green again with the code
right (ctest 1/1). Test-only by construction - the worktree sits at `a7d2cec79` with only
`M tests/test-governor-v02-router.cpp` - so **it does not move the tagged release; it hardens the
next one.** The four surprises its author reported instead of smoothing: (1) **invalid means
admission is closed**, not merely not-rationed - a refused profile returns Abort at policy level,
and at runtime `admit_prefill` maps that to a permanent `fail()` ("accelerator admission is
closed"); (2) at realistic temperatures the pre-fix and post-fix admission outcomes coincide,
so the Abort assertions alone would not catch a regression - the teeth are the validity return,
the `Invalid`-vs-`CRITICAL` identity, and the recovery row; (3) **NaN and infinity were already
covered before the fix** (`isfinite` predates it) - kept as matrix completeness, not as
regression detectors; (4) **41.9 C gives Wait while 42.0 gives Abort** - two refusals a tenth of
a degree apart (pause and recoverable, vs latching).

**The tail defect is fixed, measured, audited - and not yet shippable.** Commit
`319b539377605f6c572e234b28678b74bd78deb5` on branch `kalsa-opencl-cok-fp32`, one commit above
the shipping tip `1577495b9`: the `ne1` 2..8 `_cok` path's accumulator becomes `float8` and its
product `convert_float8(B) * (float)dq` - the shape the batch-256 kernel already uses - with
corrected behaviour the **default** and the old behaviour behind `KALSA_COK_ACC=fp16`. The
phone pair, pre-registered in sec. 35 before the binary existed, results in sec. 36.1:

| arm | prediction (written before) | result | verdict |
|---|---|---|---|
| control (`KALSA_COK_ACC=fp16`) | exact 0.304543 / 66.198 % or the pair is void | **0.304543 / 66.198 % - EXACT** | **gate PASSED** |
| treatment (default) | complete fix if <= 0.0065; else partial + report the gap fraction | **0.006890 / 93.138 %** | **PARTIAL** - 44x lower KLD, +26.9 pp same-top, **99.51 % of the b8-vs-b256 gap closed**, 0.00039 above the line, 0.00148 above ship default |
| price at ne1=8 | <=5 % none / 5-10 % notable / >10 % significant | **+8.3436 %** (16.30 -> 17.66 s/pass) | notable - and 2.3x the coder's static +3.6 % bound; measured wins |

**The price:** +8.3436 % on a b8-only workload (the worst case: every chunk is 8 tokens),
**0 % in decode** (`ne1 == 1` takes the GEMV branch; the fix lives in the else path), and the
audit's *estimate* of about **0.235 %** for a 3,080-token prefill - flagged as a
cross-measurement estimate, not a measurement. Provenance detail worth keeping: the old path was
**fast-and-wrong** (GPU perplexity 32.55 against the reference's 27.21) and the fixed path is
**slower-and-correct** (24.44). The phone recorded PARTIAL rather than rounding up: 0.006890
clears 0.0065 by 0.00039 the wrong way, and a 99.5 % closure that misses the registered line is
still a partial-fix decision, not an automatic land.

**And the audit refused to ship it - the refusal belongs to the record**
(`scratchpad/agents/cok-accumulator-audit/REPORT.md`, 250 lines, independent reviewer):

- **CONFIRMED:** the numbers reproduce from the archived logs; the arithmetic closes 99.5059 %
  of the gap, so "partial" is honest; the selector truth table and the stale-ship-cache
  protection check out.
- **REFUTED - two literal claims of the author:** the default's IR diff is not wholly inside the
  `_cok` body - it adds one compiler-emitted module-scope declaration
  (`convert_float8(<8 x float>)`); and the cache explanation was wrong - control init does NOT
  compile both selector variants eagerly (the host builds one program; the treatment's cache hit
  came from a pre-existing matching key).
- **NOT VERIFIED:** the residual **+0.001478 above the ship default is not established as a
  floor**; the named next ablation is the **K-split accumulation order** (`_cok` reduces eight
  subgroup partials while the large-batch kernel walks K through four f32 accumulators in a
  different order) - candidate, not cause.
- Provenance was established **by triangulation** (the control reproduces the broken metrics
  bitwise; the cache keys carry/deny the F16 define; source dispatch; the result moving to
  0.006890) because the WARN line the author wrote **never appeared in the stderr captures** -
  a logging defect, recorded, arm identity still adequate.
- **Why it is not shippable:** the pair ran on a model, KV configuration and attention setting
  **different from the app's** - the app ships `q8_0`/`q4_0` KV with flash attention `auto`, and
  the verification used neither. Shipping protocol, recorded as a checklist: (1) an app-shaped
  accuracy and tail-speed run plus a decode check; (2) an explicit decision on the partial
  threshold and the residual; (3) each pin verified against the exact reviewed SHA; (4) the APK
  built and hashed from that chain; (5) that same APK installed; (6) its runtime arm and cache
  identity captured with a measured result. The artefact to clear is the final APK, not the
  separately measured `llama-perplexity`.

**The build now records which tree it came from** (`scratchpad/agents/build-provenance/REPORT.md`):
branch `kalsa-build-provenance` at `91ac75c35`, based on the release line - **pushed**,
re-verified read-only by this cell (`refs/heads/kalsa-build-provenance = 91ac75c35...`). At
build time it writes, **twice** - into the binary so `strings` reads it, and into a JSON for the
publisher to fold into the manifest: the full commit, the ref or literal `detached`, **`dirty`
plus the list of touched paths** (capped at 50, with `dirty_paths_omitted` counting what was
dropped), **`source_sha256` of the source archive** (`git archive HEAD | sha256`, cached by
commit), the build number, a UTC timestamp and the toolchain line. Cost **+0.25 s per build**;
three states tested (clean -> `dirty:false`; touched file -> path listed, with `JSON == BINARY`
over five alternating touch/restore flips; **no git -> every field `unknown` and the build still
succeeds**), and the three ctest rows were proven to fail against sabotaged generators. Two
formulations from the exchange, kept because they are about remedies rather than bugs: **every
duplication needs its own coherence check, or the duplication *is* the defect** (the field is
written twice, and the JSON==BINARY agreement over the flips is what makes that a strength);
**a declared limit is not a missed limit** (the cap carries the count of what it dropped). Its
stated limit, next to the field rather than buried: the stamp says whether the tree was clean at
a commit, **not** that the sources correspond byte-for-byte to the linked binary - a stale
`target/` (or `build/`) is invisible to it, and **the build id in `--version` remains the other
half**.

**The queue, so the morning starts with a queue instead of a question.** The phone sits at
**21 %**, unplugged, everything intact (archived `raw/state-pre-37.txt`) - below the floor, so
nothing starts until it charges. Behind the charge, in the owner's order: (1) the **Meter**experiment (owner's rule, the 1,045 mA bar, pre-registration already on disk, sec. 30; its
arms did not run tonight - stopped at the 22 % arm boundary); (2) the **app-shaped
verification** of the tail fix (sec. 37, three sets: tail accuracy against the app's KV
reference, a decode zero check at `-b 1`, and the tail speed in the app's configuration, plus a
b256 anchor so the real-prefill penalty is derived from measured numbers rather than the
estimate); (3) whatever the K-split accumulator-order coder produces. Sec. 37 earns its line for
how it is written: it **names its own weakest assumption in advance** - that the
b8-equals-b256 reference identity was proven only at f16 with attention off, so at the app's
configuration it is an *assumption*, and the first suspect if the control misbehaves.

**The residual's next ablation exists and is built** (`scratchpad/agents/cok-residual/REPORT.md`).
The coder identified the difference behind the +0.001478 the audit left NOT VERIFIED, and it is a
clean one: in `gemm_noshuffle_q4_k_f32.cl` the batch-256 reference walks **K serially inside one
work-item** (`:70`, f32 accumulators at `:61`, no K reduction in `:145-177`), while the `_cok`
path **strides K across 8 subgroups** (`:438`) and then **sums subgroup partials** (`:494-505`) -
so the effective order is `[0,8,16,...]+[1,9,...]+...` instead of `0,1,2,...`, and
floating-point addition is not associative. That is the candidate for the residual. It is ablated
behind the same selector pattern - default = serial, i.e. the b256 order; previous behaviour
behind `KALSA_COK_KORDER=split`; and `KALSA_COK_ACC=fp16` stays pinned to the old behaviour so
the pre-registered control is still one env value - with **dispatch, args and launch geometry
untouched**. The control evidence is the strongest form: the new build with `KSPLIT` produces IR
**byte-identical to the shipping `1577495b9`**, and with `fp16` **byte-identical to
`319b53937`'s treatment kernel** (both `cmp -s` rc=0). Branch `kalsa-opencl-cok-korder`, commit
**`7965f43e0`**, build **11203**, binary sha256
**`6ff4124b4c8a6449cca7e880556f94a3a2d90cb233151411d0439664e328c747`**, seven standing targets
`0 0 77 77 0 0 0`. And **the prediction is already on disk, timestamped before the build** (sec. 3,
2026-09-23 03:25 EDT): the phone pair should land at or below the ~0.0054 neighbourhood; if it
sits on 0.006890 the residual is something else and **we stop** rather than attempt a third time.
Caveats fixed in advance: "neighbourhood of 0.0054", not "exactly" (the b1-vs-b256 0.0006-class
difference remains on this engine), and the serial default makes the `_cok` kernel 1-of-8
subgroups active, so the phone's b8 speed pair is the pre-declared price gate.

**The process point, which is the part worth writing down.** The coder's push command targeted
**`refs/heads/kalsa-phone-v1-1-1`** - the shipping line. That is a **refspec out of habit** from
earlier tasks, and it is exactly the move that must not happen: the audit has not cleared
shipping, so a branch that merely *contains* a candidate fix must not be moved onto the line the
phone runs. What actually happened: the branch was pushed as a **new ref**
(`refs/heads/kalsa-opencl-cok-korder`, verified by `git ls-remote`), and `kalsa-phone-v1-1-1`
was **verified unmoved at `1577495b9`** afterwards (re-verified by this cell). The rule,
recorded because it will recur on every future fix: **a coder's refspec is a proposal, not a
decision - the shipping line moves only when the audit's checklist is cleared, and the branch
that holds a candidate is a *different object* from the line that ships.**

### 2026-09-24/25 — governor thresholds and routing, route-switch KV, NPU verify, S23 DSP spin

- **Governor lines are now the owner's, not the harness's.** `k_warn_c` 40 / `k_kill_c` 43 were the q56
  harness guard (WARN 40 / KILL 43), never an owner decision. Owner 2026-09-25: pause 43 C, kill 44 C;
  admission projection ceiling 42.5; critical_enter = kill in BOTH profiles (the plugged
  `min(idle+7, cap)` fired at 42 C for a 35 C idle). Engine `kalsa-phone-v1-1-8` `f25f0c1c5`, binding
  `88b2b57e`, app `0509f8c8`; luna + deepseek SHIP. Owner-accepted risk: a floor chunk from 42.99
  projects 44.9 on the 1.9 C delta, and kill is a sticky governor failure for the session.
- **Route-switch KV defect (fixed in `47f18811c`, v1-1-7):** after a GPU prewarm, a CPU-route prefill ran
  on an empty decode context (answer computed without system prompt or history), then the next GPU
  turn was rejected and the runtime fell back with the governor OFF. Fix: CPU-route catch-up commit and
  `commit_side` trims a destination that is ahead. Verified on the S23 smoke
  (`scratchpad/agents/route-switch-kv/`, `s23-heat-cpu-vs-gpu-v2/`).
- **App: the governor is disabled whenever an mmproj is loaded** (`src/engine/LlamaService.ts:2439`,
  `!options.mmprojPath`). Qwen3.5-4B (recommended on high-tier boards) never runs under the governor;
  `bench:route` reports `skipped`. Found on QDC QRD8650, session 845086
  (`scratchpad/agents/qdc-heat-per-backend/REPORT.md`). Owner decision 2026-09-25: mmproj stays out of the governor until a governor vision lane exists; heat arms on LFM2.5-2.6B.
- **Per-backend heat tables: n = 0 (2026-09-24/25 state; measured 09-27/28 - see "2026-09-26/28" below).** Every S23 and QDC attempt of 24-25/09 ended before a valid arm
  (DSP spin, tools left ON, a cold-start gate, account/tab problems, the mmproj defect above). What
  survives is the method: device-side 1 Hz sampler (median 1.06 s), tools OFF, a new-token target
  (1024 +-5%), validity = `route_requested`/`route_push=applied`/`route_mismatch=false`, no cool-start
  gate (owner). CPU prefill of 1,116 new tokens on the S23 with the DSP spinning took 68.3 s.
- **NPU as speculative-decode verifier: killed on speed on v79** (QRD8750, session 845063, kit build
  `4c7101af4`, LFM2.5-2.6B-QAD-Q4_0, d1920, `scratchpad/agents/npu-spec-verify/REPORT.md`):

  | ms per call | K=1 | K=2 | K=4 | K=8 | K=16 | K4/K1 |
  |---|---|---|---|---|---|---|
  | CPU | 28.8 | 38.8 | 35.7 | 57.9 | 92.2 | 1.24 |
  | NPU `-nkvo` | 39.4 | 43.1 | 71.6 | 74.4 | 97.4 | 1.82 |
  | NPU KV on HTP | 50.9 | 59.0 | 97.1 | 79.9 | 81.0 | 1.91 |

  Gate (NPU <= 1.5x AND CPU >= 2.5x) fails on both sides. Break-even acceptance for NPU verify ~0.79-0.84
  vs measured 0.26-0.30. The CPU verifies K=4 for 1.24x one step on the ship model: the old "verify =
  K x compute" closure (Qwen3.5-4B / MoE) does not transfer. v73 (S23) not yet measured.
- **S23 DSP spin: cause and likely fix.** Cause: Perfetto `traced_perf` profiling signal (Samsung
  perfmond). `debug.perfmond.default.perfetto=0` did NOT help (spin back after 63 min). `setprop
  persist.traced.enable 0` stops traced/traced_probes/traced_perf and survives reboot: daemons at 0% on
  every 10-min poll through 7630 s uptime (the spin used to return at ~4046 s); idle drain ~2%/h vs
  ~17%/h. Revert: `setprop persist.traced.enable 1`. `scratchpad/agents/s23-dsp-spin-web/`.
- **Windows server release:** v1.1.1 could not be built portably on Windows (bmoe linked a ggml-cpu
  symbol directly, LNK2019 under `GGML_BACKEND_DL`); fixed via the CPU backend's `get_proc_address`
  and released as v1.1.2 (see "Engine release pipeline").

### 2026-09-26/28 - the governor on the S23, heat per backend, the NPU lane on main

**The governor runs in the app.** On the TLS S23 the load emitted
`KALSA_GOVERNOR_PLAN {"gpu_fit":"Fit", ...}` and the manual smoke ran three turns with
`engine_prefill=GPU`, `engine_decode=CPU`, `route_push=applied`, `route_mismatch=null`,
per-chunk `actual:"gpu"`, and commit in milliseconds (`commit_ms` 5.388 / 6.01 / 10.65).
**And the blind spot is measured:** turn 3 (`prompt_n=981`, 587 words) took battery
**33.6 -> 41.6 C** and Android thermal status **0 -> 3 (SEVERE)** while the governor kept
logging `thermal_state:"FAST"` - the classifier reads the battery only
(`kalsallama llama-governor-policy.cpp`, `classify` at `:83-94`). The 27/09 baseline campaign
hit the same wall: the status-3 abort stopped it after one submitted prompt. Record:
`scratchpad/agents/s23-governor-lfm-long/REPORT.md` (commit `8c0e38e0`), raw `raw/manual-smoke/` and
`raw/baseline-before-thermal-20260927/`.

**Heat per backend - the "n = 0" above is superseded.** Three cells ran:
`scratchpad/agents/s23-heat-arms-engine/` (`147b0351`),
`qdc-8elite-heat-arms/` (`335fc965`), `qdc-8elite-hopping-heat/` (`a6ec6507`).

- **NPU is the coolest prefill on both chips.** S23 battery area per 1k tokens (NPU/GPU/CPU)
  is **6.45 / 24.17 / 44.59 °C·s**; the NPU is 73.3 % below OpenCL and 85.5 % below CPU
  (skin area 66 % below OpenCL). The 8 Elite first arms measured skin area **21.2 / 45.5 / 52.3
  °C·s per prefill** (NPU/GPU/CPU); its sustained follow-up measured **23 / 79 / 75 °C·s** in
  the same order. Both QDC runs use the same 8 Elite and skin °C·s per prefill metric, but the
  protocols differ: initial arms versus 12 back-to-back sustained prefills, so they are not a
  like-for-like pair. Prefill speed rows: S23 9,905.57 / 6,948.76 / 1,470.99 ms (CPU/GPU/NPU; 97.12 / 138.44 /
  653.98 tok/s); 8 Elite 4,861 / 3,317 / 919 ms (197.9 / 290.0 / 1,046.4 tok/s). Sources:
  S23 report `147b0351`, QDC first arms `335fc965`, sustained QDC `a6ec6507`.
- **CPU prefill is hottest** in both devices' measured area metrics. Fewer S23 decode threads
  show no clear thermal benefit: battery-area medians overlap by 1–3 %, while skin area rises as
  threads fall (`147b0351`, D-t5/t3/t2).
- **8 Elite decode:** NPU **0.229 °C·s/token at 29.1 tok/s**, CPU **0.315 at 39.0 tok/s**, GPU
  **0.326 at 30.3 tok/s**. NPU is coolest per token; GPU is hotter per token than CPU and 22 %
  slower (`a6ec6507`, §B).
- **No NPU heat crossover in 12 back-to-back prefills** (same cell, §A).
- **Fewer decode threads show no clear benefit on the S23** (battery medians overlap within
  1-3 %, skin rises as threads fall: D-t5/t3/t2 = 22.41 / 18.49 / 15.16 tok/s).
- `s23-backend-hopping-heat/REPORT.md` (28/09): S23 tg256 decode CPU 22.13 / OpenCL 14.03 / HTP 22.09 tok/s,
  battery 0.20 / 0.43 / 0.14 C·s per token; CPU and HTP ranges overlap - a direction, not a proven gap.

**Owner direction (2026-09-28; decisions in `PLAN.md`, "Verified state, 2026-09-28"):** CPU is
out of prefill; NPU first and GPU when the NPU is hot; decode hops CPU <-> NPU <-> GPU by heat; never
truncate reasoning silently; persistent SEVERE needs a sustainable slow rate, not a pause - the
pause is only an emergency brake, so the platform-pause implementation (app `19368426`) is
**held**. The lever map `governor-thermal-ladder/LEVERS.md` (`3e00ccea`) keeps every lever
except its "MODERATE -> CPU prefill" rung, which the heat data **refutes**.

**NPU prefill: validated in the CLI, wired in code - not in any app APK yet.** The spike
(`scratchpad/agents/governor-htp-prefill-spike/REPORT.md`, commit `e69ff684`) gave an EQUIVALENT three-prompt
handoff verdict vs OpenCL (mean agreement 99.306 %, mean KLD 0.000853797 inside OpenCL's
0.000706-0.000956 range; identical commit bytes; 1,089 `HTP0 execute-op MUL_MAT` lines). The
chain: engine `feat/governor-npu-prefill` `45f097b74`; binding `4e0837f8` then `3d2fff25`
(the first device APK build failed because the JSI lambda captured `ctx` implicitly - the fix
copies the fields before the closure); app `origin/main` `2fb5ee4a` then **`335f9c8d` (pin
bump, provenance exit 0)**. The lane is **default OFF** on main, the bench key
`kalsa.bench.npu_lane = auto | on | off` drives A/B, device APK CI `36434636903` is building,
and the **step-5 device soak is pending**. 2026-09-30: no CI APK has ever carried the Hexagon host
backend (app CI has no Hexagon SDK: "building CPU-only"; the S23 lane degrades with
`htp-device-missing`); fixed and pushed 30/09 evening: binding `b4a13d9a` (lane off never sees HTP, one DSP session)
+ app `c26ba8bc` (SDK sha256-pinned, QAIC stubs, APK assertion), recon and audit in `app-ci-hexagon-recon/`. APK
`36763920662` green, Hexagon verified in the lib (first APK ever with it); S23 NPU-lane check next. S23 check 30/09 night
FAILED: with the lane on the governor's prefill context puts the V cache in an HTP0 buffer and the load aborts on
SET_ROWS (`s23-npu-lane-c26ba8bc/REPORT.md`). Fixed in binding `17446ac4`/`c8471449` (prefill KV on host), app
`aea90427` (pin + `npu_lane` in the plan log), APK run `36786856764`; the S23 re-check must also show whether HTP
prefill with CPU attention still beats OpenCL. Lane stays default off. Re-check 2026-10-01: no abort, but the lane-on load hangs
forever on the first HTP prefill (dspqueue response timeout loop, battery burn, no fallback); lane off passes. Cause
confirmed by a skel swap on the S23: the APK ships DSP skels committed 2026-09-17 from a pre-protocol-change source,
the host speaks upstream's new batch protocol. Fix: skels built from the same tree + a skew gate, a bounded wait with
GPU fallback, and an HTP health check at lane init. Design and steps:
`governor-npu-prefill/DESIGN.md` (`2ac99cd5`).
Binding fix round 2 (`fa8d83ef`) failed its hostile audit (stamp is a claimed pin, not a source fingerprint;
partial skel set; ungated example APK; fallback data race); fix round 3 running, then push, app pin, S23 governor
run NPU/GPU/CPU (owner 2026-10-01: S23 unplugged and ready).
Round 3 pushed: binding `6c9b16ed` (source-fingerprint skel gate; audit r3 leftovers judged non-blocking, follow-up
queued). App pin + installed-skel check in progress. kalsa-server v1.1.4 mac CPU path SIGILLs on M1 (i8mm baked in
by the native build); v1.1.5 fix (CPU variants) in progress.
v1.1.5 batches every desktop engine fix (owner); the tag waits for the Lenovo re-check of a suspected Vulkan MoE
decode regression (Ling-3.0-tiny -35 %, unconfirmed). MoE expert-usage v3 done (audit running): a Kalsa-calibrated
keep-set retains far more than RAZOR's; 160/256 is the candidate sweet spot (owner).
Kalsa MoE design (Fable 5.1, PLAN.md gate-probe entry): REAP + 7-domain calibration at 128/layer, two quant
artifacts (PC ~10.7 GB, phone ~8.7 GB) vs 160@IQ3_S and unpruned IQ2 at equal GB; one pod $15-25, owner budget pending.
Owner 2026-10-01: session split - coordinator 818369e6 does ONLY the MoE prune (phase 0 running: calibration v2
GLM 35e363c7, evals GLM b23995c6); a new session takes governor/NPU/GPU/binding/app/S23/engine releases from
`scratchpad/HANDOVER-GOVERNOR-2026-10-01.md`.
MoE keep-set-128 analysis audited (mimo 65e08f45): usable with caveats; allocation gain 0.3-1.1 pp, one unsourced
Jaccard withdrawn, hash-step hygiene gap recorded; conclusion unchanged (128 trades against 160, never dominates).
Phase 0b evals (HumanEval+, FLORES chrF++/wrong-language, GSM8K-IT, gate fixes) committed by GLM b23995c6; audit running.
Phase 0b audit (space-bunny f6956458): 4 blockers (fail-open stop rule, gameable HumanEval+, pod budgets, FLORES
truncation); fix round GLM 6857fe92. Fable plan audit: approve REAP-128 with changes (chat-templated calibration, loop +
knowledge stop rules, keep a pruned MTP head, conditional healing); realistic total $65-90.
**Kalsa MoE prune PARKED by the owner 2026-10-01** until after the alpha (cost); resume from
`scratchpad/agents/kalsa-moe-design-fable/PARKED.md`. The two running agents finish and commit; nothing else runs.
**iOS started 2026-10-01 (owner; session 818369e6, macOS first):** recon `scratchpad/agents/ios-readiness/` - RN UI
and model/picker flows portable; blockers: the binding's `ios/rnllama.xcframework` holds only Info.plist (enable the
vendored source build with Metal), the declared Apple thermal module does not exist; iroh pairing and share-in are
Android-only. No Xcode on the Mac yet, no Apple Developer account, no lab iPhone. Apple Foundation Models lists all
five languages (iPhone 15 Pro+); one community test has MLX ahead of llama.cpp on iPhone 17 Pro.
iOS first-build prep on local app branch `ios/first-build` `ffd5867c` (worktree `~/Projects/kalsa-ios`, not pushed):
llama.rn source build with Metal via a Podfile plugin (embeds generated at pod install, Android CI untouched), iOS
RAM/chip/thermal/jetsam-headroom paths, Swift modules fixed; two hostile audits; waits for Xcode. Next:
`scratchpad/agents/ios-readiness/NEXT.md`.
iOS 2026-10-02: first compile done - simulator and device (arm64) BUILD SUCCEEDED with Metal (34 embedded libraries),
app branch `ios/first-build` `5d58e12a` (x86_64 simulator slice excluded). Two binding-side fixes needed and recorded for
the binding owner in `ios-readiness/BINDING-PATCHES.md` (a FATTN_SMEM loop in kalsa.rn's vendor overlay - not in
kalsallama; an arm-only file compiled for x86_64), audited (`AUDIT-first-compile.md`). Not yet launched.
iOS first run 2026-10-02: Kalsa launches on the iOS 27 simulator and loads LFM2.5-2.6B (CPU in the simulator);
generation not yet run. Needed an Expo SDK 57 patch-line bump that also changes Android behaviour (audit
`ios-readiness/AUDIT-first-run.md`): stays on the local branch until the app-chain owner validates Android.
Owner 2026-10-02: "Aggiorna expo". Expo SDK 57 patch-line bump landed on app main `7ddf39ad` (base 101c2bdd; audited
`ios-readiness/AUDIT-expo57-bump.md`: no blockers, Android double-settle change unreachable from Kalsa's modules).
APK run 36979390863; S23 smoke handed to session 1d714246 with the audit checklist.
Security 2026-10-02: the app ships pdf.js 3.11.174 (assets) on user PDFs - CVE-2024-4367 reachable. Mitigation on local
branch expo57-bump `b5b59cca` + fix round `14349b63` (isEvalSupported:false, CSP meta with a runtime self-probe,
navigation gate, no incognito); audited (`ios-readiness/AUDIT-pdfjs-cve.md`). NOT pushed: needs a device check first
(PDF extraction still works, csp=true logged, A/B page timings vs 7ddf39ad - the PostScript interpreter is slower).
Real fix = pdf.js >= 4.2.67 migration. CJK PDFs with non-embedded CMaps were already broken (no packaged cmaps).
iOS/deps 2026-10-02 later: SDK 58 beta trial builds and loads on the simulator but is NO-GO for main (rc RN 0.88, new
peer conflicts, fingerprint change; `ios-readiness/AUDIT-sdk58-trial.md`). pdf.js 5.7.284 upgrade committed locally
`749f3591` (audit + S23 PDF check pending). iOS UIScene launch crash = old build before `enableSceneSupport` (on main).
Owner 2026-10-02: PDF cmaps = Simplified + Traditional Chinese only; Japanese/Korean deferred (~1.1 MB), noted in PLAN
for a remote future.
iOS on Mac 2026-10-02: Release build runs as an iPad app on the M1 Max, no UIScene crash, LFM2.5 31/31 layers on Metal,
decode 31 tok/s (suspiciously low, to check vs llama-bench).
pdf.js 5.7 on the S23 2026-10-02: FAIL (WebView dies right after start on every PDF); not landed, diagnosis parked.
Owner 2026-10-02: iOS engine = llama.cpp on Metal; Apple Foundation Models as an optional extra; MLX only if measured
clearly faster. Mac measurement running.
iOS landed on app main d6d0f425 (2026-10-02): builds from the pin with no hand patches, Android unchanged (audited).
iOS engine 2026-10-02: llama.cpp ~= MLX on LFM2.5 (128 vs 121 tok/s); app's 31 tok/s = mixed q8_0/q4_0 KV on Metal
(q8_0/q8_0 gives 97). Apple FM untested: Apple Intelligence off on the Mac.
Owner rule 2026-10-02: fix P0/P1 (+P2 hitting users/perf), log the rest in scratchpad/BACKLOG-LOW-PRIORITY.md.
iOS KV q8_0/q8_0 default landed on app main ee8b5f25 (2026-10-02); one max-recall review per work from now on.
iOS iroh desktop link landed on app main c4cd72ab (2026-10-02); end-to-end with a Brain pending.
iOS 2026-10-02 night: governor-default-ON dropped iOS to CPU, fixed c7bee6db (31/31 Metal); iroh invite must pair
without a door address (desktop contract) - phone fix in progress.
Doorless iroh pairing landed on app main f4f3696c (2026-10-03): scan/tap pairs over iroh with nothing to type.
iOS sim <-> Mac Brain over iroh 2026-10-03: LIVE PASS - paired (owner Allow) and one chat answered by the Brain, all roads iroh.
iOS threads 2026-10-03: with full Metal offload 1/2/4 threads give the same decode (118/123/122 tok/s, Mac) - no change.
Apple FM 2026-10-03: 4k context, ~35-46 tok/s, weaker IT/ES/ZH and multi-turn than needed -> optional fallback at most.
S23 2026-10-01: the governor runs prefill on NPU, GPU and CPU in the app (APK 07476dae), all arms PASS, AUTO
picks NPU; NPU 171 vs GPU 115 vs CPU 22 tok/s prefill on short prompts; heat is the limit. Audit pending.

**One-copy CPU + NPU: correct on S23, slow as built on 8 Elite.** The raw-Q4_0 layout fix passes
S23 P5 at mean KLD **0.002750** (`hexagon-onecopy-rawq4`, run on engine `c939a135d` carrying layout
fix `9a2fb2376`; design record
`4d606e4f` / `5a94d88c` / `df4a18d1` / `7ac42dec`). QDC session **853723**, report `9ac6ebc7`,
measured 512-token prefill at **1,782 tok/s** for two-copy HMX, **57.8** for two-copy flat, and
**37.3** for one-copy. The raw path is flat-only because the DSP refuses raw weights on HMX. CPU
decode tg128 measured **38.3 tok/s** repacked, **34.6** no-repack, and **22.6** with raw `-HOST`
rpcmem weights. Memory was **1,526 vs 3,448 MiB** across separate processes, about **1.9 GiB saved**.
The v79 flat kernel KLD was **0.0193** for both layouts; HMX KLD is unmeasured. These 8 Elite
results do not transfer to the S23 (`scratchpad/agents/qdc-8elite-onecopy-cost/REPORT.md`).

**Kalsa MoE for PC + 16 GB (2026-09-30):** after the $0 Mac probe the REAP pod was dropped; a one-shot quality gate
probe runs on Runpod (cap $10: LFM, RAZOR-19B, Qwen3.5-4B, Qwen3.6 top-k 4 and k2=16, Qwen3.5-2B), results in the
private HF dataset `Kalsa-ai/kalsa-gate-probe-results`; PLAN.md "Owner decision 2026-09-29" has the arms.
Retry 2026-09-30 evening with every arm (owner): A40 pod at $0.49/h, stages one by one, chain only after the LFM
arm's results land; spend capped at ~$9.6 of the $10.
Result 2026-10-01 (9 arms, $6.82): the RAZOR-19 prune lost Italian (bpb 1.46, LFM-level) while unpruned Qwen3.6 is
far better than LFM in every language (IT 0.58 vs 1.48); GSM8K is cap-confounded. Owner picks the next MoE lane.
Cause of the RAZOR language loss: first router probe was INVALID (strided-view misread, uniform 32x counts); re-run
with a fixed reader done; audit: instrument correct, design too weak (one article per language, IT not different
from a random half). Proper study (parallel corpus, code, math, sacrifice languages, held-out) running. Kalsa
languages: IT/FR/ES/EN/ZH (owner). PLAN.md gate-probe entry.
`results/gate_probe_a40_2026-10-01/REPORT.md`.

**Engine single line (2026-09-30 night, owner):** `main` of the fork is the only engine line for phone and desktop;
feat/governor-platform-status merges into it, then upstream b11304 (conflicts: take upstream, replay our commits).
The fork was pruned to 3 branches + archive tags; going public is parked. PLAN.md "Engine: one line + upstream".
Done 2026-10-01: engine main `61c909481` pushed (2 branches left), release tag kalsa-server-v1.1.4 pushed (v1.1.3
skipped), and the 47 upstream workflows that burned the fork's free minutes are disabled (kalsa-server + check-vendor
remain). v1.1.4 is published (R2 + HF, digests verified) and the pins went to kalsa-brain.

**Governor plan (2026-09-30, owner: follow it):** `scratchpad/agents/governor-plan-fable/PLAN.md` (lab
`32d65d53`), summarised in PLAN.md "Governor plan to follow". Today the governor sees battery temperature and
platform status only once per completion (never during generation); MODERATE and SEVERE collapse into one state;
LOWBAT falls back to CPU prefill; admission deltas are unmeasured and uniform. Milestone 1 on the S23
(`governor-m1-current/REPORT.md`, audit applied): the in-app current is live at 1 Hz (99.7-100 % of rows change);
GPU vs CPU prefill mean current differs by ~242 mA but no idle window was sampled, so the separation test is untested.
Whole-phone energy per 1k prefill tokens ~54 vs ~224 J mostly follows duration, not proven backend energy. Next: idle
window + incremental energy; NPU arm once the APK carries Hexagon. Correction: `s23-backend-hopping-heat` has a REPORT (28/09),
where CPU and HTP decode heat ranges overlap, so "NPU decode wins on S23" is plausible, not proven.

**Governor one-copy is gated on speed.** Design: lab commits `4d606e4f`, `5a94d88c`, `df4a18d1`,
`7ac42dec`. Engine branch `feat/governor-onecopy` is not pushed: S1 `1d39fd0dd` + `49676fd7a`;
S2 `a11e03a1f` + `c889b4658` + `b39a45be7`. Host tests pass with the ship GGUF; the Hexagon object
is syntax-checked only, and device census is owed. S3+ lane steps are **ON HOLD** until one-copy is
fast. Owner decision: keep the GPU lane on every device, with its flag OFF where NPU is better.

The GPU one-copy spike (`spike/onecopy-gpu-rawq4`, base `133cef802`, four review fixes `5e6b66e86`;
lab `scratchpad/agents/onecopy-gpu/`) imports one dma-buf through OpenCL for raw-Q4_0 GEMM. Review:
**SHIP for an S23 correctness run after the four fixes**. After the import fix (`4ff4f729c`) the
probe imports and small shapes are correct; on the full model the GPU looked stalled. Diagnosis
(engine `0285aae40`, lab `1ecbcbfe`): most likely **slow, not hung** - raw GEMM **4.75 GFLOPS** vs
~**437** for the normal path (~92x), ~9 min per pass; the import did happen (INFO hidden by the log
threshold; wrapper now uses `-v`). Next: rerun with the `--model-shapes` probe and a 20-min wait. The HMX-on-raw reader works on the S23 (`scratchpad/agents/onecopy-hmx-numerics/REPORT.md`; engine
`spike/onecopy-hmx-raw`, pushed at `cc9c541f2`). Automatic placement (`4eb2618fb`, no `-ot`) with
`GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_RAW_HMX=1 --load-mode none -ngl 99 -dev HTP0`: pp512 **851.5**
tok/s one-copy vs **876.4** two-copy, KLD **0.000892**. Buffers: HTP0-HOST 1,306 MiB (shared with the
CPU), HTP0 220 MiB, CPU 205 MiB; `token_embd` lands on HTP, cause under recon. Guard `f8ee54d37` +
`e71421fd9`: under mmap the loader moves these weights to plain CPU memory; the backend now refuses
them instead of crashing, the loader warns once, and the run falls back to CPU (pp128 **37.9** vs
**622** without mmap). So one-copy needs no-mmap loading in the app: owner decision, RAM and
load-time numbers owed on the S23. Open: CPU decode on raw Q4_0 is **0.62-0.64** of the repacked path
on the S23 (tg128, interleaved); a multi-row raw gemv (`spike/onecopy-cpu-gemv` `1dd83c245`) moved it
only ~4 %, so the cause is being split on the Mac. Governor S3+ stays on hold until decode is fixed.
2026-09-30 (S23): NPU decode on the shared copy now runs - raw Q4_0 HVX matvec on the DSP, **11.82** tok/s
tg128 on `c5a218321`; after the audit fixes `cc9c541f2` only one uncooled sample (10.98 +- 0.45), clean
speed unmeasured. Same aggregate KLD as two copies to printed precision (not logit-by-logit); two copies
**22.2**, one-copy CPU **10.63**. The raw->tile conversion was the cost: the raw-row matvec `974a31e79`
(no per-token conversion) reaches **15.51** tok/s on the S23 (69 % of two copies, CPU 12.79), KLD 0.004608 (better
than two copies' 0.005313). Target 19-23 not met; the sim says compute is on par with tiled, so the remaining gap is
likely the host-buffer memory path (hypothesis). Audit fixes `ceb89bedc` (sim-verified, not yet audited or pushed)
add env probes to split memory vs compute in one S23 session.
Hostile audit of `ceb89bedc` (2026-09-30, `onecopy-hmx-numerics/AUDIT-ceb89bedc.md`): default path safe, but
the probes can silently measure the wrong thing (RAW_LOCAL a no-op under HOSTBUF, probe value never logged, a VTCM
fallback to flat keeps the probe). Those gates are fixed before the S23 session. The auditor's lead hypothesis is
the raw DMA row stride `18*n_k`, not 128-byte aligned on the ffn matvecs; the probe arm `=2` decides.
Gates fixed and pushed in `df538c50c`; its audit showed RAW_LOCAL cannot split the memory path (same rpcmem heap
as the host buffer), so the S23 session runs PROBE=1/2/4 and HOSTBUF_UNCACHED only.
S23 ABBA 2026-10-01: skip-dot reaches two-copy speed (22.50 vs 22.10) while no-weight-DMA does not move (15.64 vs
15.58): the one-copy gap is the raw dot kernel, not memory. Next is a VTCM relayout for the dot.
Heat per decoded token on the same weights (n = 2 per arm, descriptive): speed-matched A pair (12.27 vs
12.21 tok/s) DSP skin **0.58** vs CPU **0.88** C·s/token (-35 %), battery -13 %; A+B means mix unequal speeds
(CPU-B 9.60). The area includes load, warmup and a 120 s idle tail. Two copies **0.28** at 21.5 tok/s.
Tied embedding shared with the CPU copy (`048603398`): CLI peak RSS (`toybox time -v`) **-204 MiB** (no
mmap) / **-225 MiB** (mmap), CPU decode speed unchanged; S23 output quality with the plain-Q6_K lm_head
and the app memory path are not measured yet.

**App and pairing - main, all reviewed** (every sha below verified an ancestor of
`origin/main`):

- **Perf:** the log flood is fixed by level-gating the `KALSA_NATIVE` mirror (`2256a110`:
  WARN/ERROR always, INFO behind `bench:nativelog`), and transcript re-render by isolating
  rendering (`af1498fa`).
- **Served-model adoption:** `93f29b8e` - dedupe and trim served ids at the source, clear the
  stored id on pairing, keep the id out of every log line.
- **iroh:** pairing now passes on Jelly (APK/app `aba67977`); the earlier start failure was
  `startBridge` resolving a non-marshallable `MobileBridge` (`2641144c`), and dial outcomes are
  logged (`022e14e5`).
- **Invite-by-link:** phone `9922f2e7`, Worker `kalsa-pair` `ea245988`, live since **2026-09-27**
  (version `5f5ea8c9`, routes `kalsa.io/pair*` + `/.well-known/assetlinks.json`;
  it carries the existing v3 QR payload and desk-side Allow remains mandatory). Public reachability
  was rechecked on 2026-09-28; both GET commands and their HTTP 200 results are recorded in
  `scratchpad/agents/pair-worker-reachability/2026-09-28.txt`.
- **install_id per desk:** `aba67977`.
- **Campaign harness:** screen-ON per turn, fail-closed readings and the log-based readiness
  gate (`018bc514`); both quoted and unquoted `KALSA_` log wire forms (`2a5e8952`); tool-round
  capture with its quiet window and the 10-minute per-round bound (`bef8219d`, `0f0808b6`).
- **Beta debt (owner decision, 2026-09-28):** the owner accepts the `assetlinks.json` debug-key
  risk for the family-only alpha. Before beta, create our private release signing key (also needed
  for Play), publish its SHA-256 in the Worker's `assetlinks.json`, and add a CI gate that fails if
  the file names the public React Native debug key (`FA:C6:17:…:3B:9C`).
- **Beta debt (owner decision, 2026-09-28):** the device APK for `335f9c8d` is **179.8 MB**
  (SHA-256 `eee75d1f…47a5`). Coordinator `unzip -l` breakdown: seven CPU-feature engine variants,
  **83.3 MB** total (`librnllama*.so` about **10.7 MB** each; only one loads at runtime); dex
  **34.8 MB** (not minified); other native libraries **30.6 MB**; iroh **11.1 MB**; assets
  **7.3 MB**; Hexagon skels **2.8 MB**. Before beta, keep 2–3 engine variants, strip native debug
  symbols in user builds, enable R8 for release, and ship an Android App Bundle on Play. Target
  **under 70 MB** is an estimate, not measured. Separately, a link overwrites the saved desk before
  confirmation; the owner declined one-tap confirm for the alpha (family-only users).

## Engine release pipeline (`kalsa-server`)

The macOS engine binary. How it works and how to do it again; current position, decisions and the
open items are in `PLAN.md`, "Engine release: current position and next steps".

### Source and release identity

| item | value |
|---|---|
| Source of truth | `Aspis0/kalsallama` (private) |
| Release branch | `kalsa-release-v1-1-1`, tip `a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1` (= `main` `833cde99b` + the two governor commits) |
| Phone branch | `kalsa-phone-v1-1-1`, tip `1577495b92096fca572f57a35b71607bacac85d5` (release tip + four GPU picks + the q8-scale pick + the dp4a default flip) |
| Release tag (current) | `kalsa-server-v1.1.1`, annotated; tag object `0f1b3bec7342ddd5624dc474c760a0b38bc80b5b`; commit `a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1` |
| Release tag (previous) | `kalsa-server-v1.1.0`, annotated; tag object `c105c218236799f2f651517f5a0aeabcf4a8d8a1`, commit `2a290390d67311b580ef398fd545e6d060b39897` (cut from `b11010-merge`, then the release line) |
| Release tag (before) | `kalsa-server-v1.0.0`, annotated; tag object `d30c8d475d5eb47a544304ba592138d066bbc2e3`, commit `4ccef2f85dbc27e095e11ffcbad4628be9961790` |

The tags are IMMUTABLE: never moved, never forced, never re-created. A tag is a
snapshot of the release path, not of the code: the workflow file inside a tag is frozen, which
is why a rebuild of an existing tag is done by dispatching with `release_tag` against the branch
it was cut from (v1.0.0/v1.1.0: `b11010-merge`; v1.1.1: `kalsa-release-v1-1-1`). For v1.1.0 the
tagged tree already carries the current workflow, so the tag push itself publishes - v1.1.1 was
published the same way, by run `35762258094`.

### Published state, v1.1.2 (published 2026-09-25) — current, first Windows build

Read back from the published `https://dl.kalsa.io/kalsa-server/v1.1.2/manifest.json`; kalsa-brain-90
re-downloaded and re-hashed all three archives (sizes and sha256 match). Supersedes v1.1.1.

| platform / backend | archive | bytes | sha256 | exe_sha256 |
|---|---|---|---|---|
| macos-arm64 / metal | `kalsa-server-v1.1.2-bin-macos-arm64.tar.gz` | 11207047 | `691943209c6461ade1faa5fd67fd6725c9e0007aa9792f0a7bd7d7c408cb6961` | `327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde` |
| win-cpu-x64 / cpu | `kalsa-server-v1.1.2-bin-win-cpu-x64.zip` | 13762007 | `60b6cb686c58a8006c8889264b83163a9023e041611631d201aaed43f5ff57cc` | `a859190549212fae578e5c7298d0d9c9779c2f9f982a14291e9a5fd2a0e9d673` |
| win-vulkan-x64 / vulkan | `kalsa-server-v1.1.2-bin-win-vulkan-x64.zip` | 26491005 | `24f0a98293e2ed6c5003f1b64837eadc12ff034f876706db3bfdbc8cb85c245e` | `6e3c87144c9763f7d604483f63f9920b310121237a4c69e11ed6b16aac3b3e12` |

- Tag object / commit: `80d9f8b7a1cf510efb2bc0ef2d54d388cdb10f69` / `5102686dd58cd39e235682868e7ba1fb0a1e8ad0`
  (fork `main`, which includes `833cde99b` "server: stamp the cache namespace on a restored slot").
  Run `36191270775`, `built_at 2026-09-25T21:30:43Z`, all four jobs green.
- Windows: `GGML_NATIVE=OFF`, `GGML_BACKEND_DL=ON`, `GGML_CPU_ALL_VARIANTS=ON` (variants x64, sse42,
  sandybridge, haswell, skylakex, cannonlake, cascadelake, icelake, alderlake); the vulkan zip also
  carries the CPU variants (no upstream-style merge step). The `x-kalsa-slot` inlet lives in
  `llama-server-impl.dll` (mac: `libllama-server-impl.dylib`). The MSVC runtime is NOT shipped (same as
  upstream zips): the target needs the VC++ redistributable.
- Workflow `kalsa-server.yml` gained `platforms` and `publish` dispatch inputs and a per-platform
  manifest merge that preserves other platforms' rows. Known debt: `inputs.publish != 'false'` is wrong
  for a typed boolean; ~700 duplicated lines between the mac and windows jobs; `cancel-in-progress`;
  `R2_ENDPOINT` passed in argv.

### Published state, v1.1.1 (published 2026-09-22)

v1.1.1 was current until 2026-09-25 (superseded by v1.1.2). Its identity was read back consumer-side from the published manifest, not from
the run log: `kalsa-brain` `dev/results/concurrency-two-devices/results.json` (fetched
2026-09-22T22:48:07Z, manifest sha256
`55d8128c05a985f54f7cb87a7cc99a89c640542d0619f4ae3cbf9ac1ec87f450`), with the matching method
recorded in `kalsa-brain/docs/HANDOFF-2026-09-22.md` sec. 4.

| check | v1.1.1 |
|---|---|
| Home | `https://dl.kalsa.io/kalsa-server/v1.1.1` |
| Archive | `kalsa-server-v1.1.1-bin-macos-arm64.tar.gz` |
| Archive sha256 (`pack_sha256`) | `a90d88a1650367c6821f70e625a4ff2d43744d5986580c206434381a732075a7` |
| Tag object / commit | `0f1b3bec7342ddd5624dc474c760a0b38bc80b5b` / `a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1` |
| Producing run | run `35762258094`, `built_at 2026-09-22T17:50:26Z` |
| Platform / backend | `macos-arm64` / `metal` (from the manifest, never from the host) |
| `exe_sha256` | `327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde` - the same launcher hash as v1.0.0 and v1.1.0, trap 1 below behaving exactly as recorded |
| Engine version string | `version: 0.4.1-dev (build 11195, commit a7d2cec79)` |
| Verification | executed binary hashed against the manifest row: `release.status = matched` |
| Archive size | not carried in this file |

### Published state, 2026-09-21 (v1.1.0 was current then; v1.0.0 stays available)

Both versions serve HTTP 200 anonymously and were verified consumer-side by downloading from the
public URL, not by reading the run log.

| check | v1.1.0 (current) | v1.0.0 |
|---|---|---|
| Home | `https://dl.kalsa.io/kalsa-server/v1.1.0` | `https://dl.kalsa.io/kalsa-server/v1.0.0` |
| Archive | `kalsa-server-v1.1.0-bin-macos-arm64.tar.gz` | `kalsa-server-v1.0.0-bin-macos-arm64.tar.gz` |
| Archive size | 11205316 bytes | 11203439 bytes |
| Archive sha256 | `9ee5d9f5199475844c99ac93272d429711b2f58d2a7c5d652c7495a391c5f034` | `3fe62ebfe7fd9ddd21fa8857f68f2c34bfc8557fb1811b54f89012260c5c88a7` |
| `.sha256` sibling | agrees | agrees |
| Archive top directory | `kalsa-server-v1.1.0` | `kalsa-server-v1.0.0` |
| Producing run | run `35565687271` | run `35549848243` |
| Cached slot inlet in the shipped dylib | yes | no |

Shape is the same in both: no `default.metallib`, no `ggml-tensor.metallib`, no `kernels/`
entries; the metallib is embedded in `libggml-metal.*.dylib`; the manifest records
`backend: metal`.

The archive holds **58 tar entries: 1 directory plus 57 file entries**, and the file entries are
**41 regular files** (40 Mach-O binaries — the executables and their dylibs — plus `LICENSE`) and
**16 symlinks** (the unversioned and `.0` aliases of the versioned dylibs). v1.0.0 measures the
same 58/1-57/41/16. These are MEASURED counts: an earlier report of "57 entries, 56 files" was a
transcription error, and pinning a transcribed count is how a bundler comes to reject a correct
archive. Every Mach-O's dependency resolves through `@rpath`, `@loader_path` or a system path.

### Where the code actually lives (two traps found on 2026-09-21)

1. **`exe_sha256` cannot tell two versions apart.** `kalsa-server` is a thin LAUNCHER and is
   byte-identical in v1.0.0, v1.1.0 and v1.1.1, so the manifest's `exe_sha256` is the same
   (`327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde`) in all three (the v1.1.1
   value read back from its published manifest). The server
   implementation is `libllama-server-impl.dylib`, and that DID change
   (`d7491bbf96d895c7a3680cfe710e3cf12f57ca240b20b4ee51ea0f19a01742fc` at v1.0.0 →
   `4b7d69fbb8505bb06a5a3b713bafe0d614883361c7d3ad0c4b5137e5809773fd` at v1.1.0). Version
   identity is therefore the ARCHIVE sha256 (or `tag_object`/`commit`), never `exe_sha256`. The
   desktop's first-launch marker re-check stays as a secondary integrity check on the launcher
   only.
2. **The port header literal in the binary is LOWERCASE.** The wire header is `X-Kalsa-Slot`
   (HTTP header names are case-insensitive) but the compiled key is `x-kalsa-slot`, because the
   code lowercases the received name before matching (`tools/server/server-context.cpp:4538`;
   the salt one is `x-kalsa-cache-salt` at line 4504). So a display of presence must be
   case-insensitive or lowercase: `strings -a <top>/libllama-server-impl.dylib | grep -c
   'x-kalsa-slot'` returns 1 for v1.1.0 and 0 for v1.0.0. A capitalised grep returns 0 on a GOOD
   build, which is the worst class of check: one that fails the correct artifact.

### Workflow

`.github/workflows/kalsa-server.yml`, self-contained. No workflow artifacts and no caches; job
permissions are read-only, so the path needs no write access to the repository.

| trigger | behaviour |
|---|---|
| `workflow_dispatch` | input `release_tag` (required); release-only |
| `push` to `b11010-merge` | branch build, no publish |
| `push` on tags `kalsa-server-*` | tag build |

macOS job steps, in order:

1. Checkout `refs/tags/<tag>`.
2. Assert `HEAD == $(git rev-parse refs/tags/<tag>^{commit})`.
3. Build the web UI INSIDE the job: `actions/setup-node@v6`, node 24, `npm ci` and `npm run build`
   in `tools/ui`.
4. cmake with `-DLLAMA_USE_PREBUILT_UI=OFF`, so the UI can never be fetched from Hugging Face.
5. Rename the binary to `kalsa-server` (the CMake target stays `llama-server`).
6. Pack TWICE and compare the two sha256 values.
7. Verify every Mach-O's `@rpath` closure inside the archive.
8. Run `kalsa-server --version`; probe `/health`.
9. Publish.

### Publish target and immutability

- Cloudflare R2 bucket `kalsa-downloads`, prefix `kalsa-server/v<version>/`, three objects: the
  `.tar.gz`, its `.sha256`, and `manifest.json`.
- Public URL:
  `https://dl.kalsa.io/kalsa-server/v1.0.0/kalsa-server-v1.0.0-bin-macos-arm64.tar.gz`.
- Secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`
  (= `https://8a991014729a52a958cef2c5cbf0de50.r2.cloudflarestorage.com`) are passed ONLY as
  environment variables, never as command-line arguments. The token is scoped to the single bucket
  `kalsa-downloads` only: object read/head plus write, plus listing for the advisory check, and NO
  repository permission of any kind. The `head-object` gate needs the read/head permission; without
  it every check aborts.
- Before upload the step checks that the version prefix is empty and refuses to publish if anything
  is there, unless the `force` dispatch input is true (which prints a loud warning that every pinned
  URL will start serving different bytes). `force` never bypasses a FAILED check.
- The existence check does NOT list. Three traps make list-based checks unusable here: `aws s3 ls`
  exits NONZERO on an empty prefix (aws/aws-cli#5544); a JMESPath `Contents[]` projection prints the
  literal string `None` for an absent array; and Cloudflare R2's `ListObjectsV2` omits `KeyCount`,
  unlike AWS. The decision therefore comes from three `head-object` calls on the exact keys: a clean
  `404`/`NoSuchKey` means absent, exit 0 means present, and any other failure aborts and is never
  bypassed by `force`. R2 documents a missing key as HTTP 404 / `NoSuchKey` / error 10007
  (`https://developers.cloudflare.com/r2/api/error-codes/`).
- After upload a recount asserts all three objects exist and that the archive size equals the local
  one.

### Cache behaviour

Cloudflare's cache stores HTTP 404 responses automatically for a domain with caching enabled, and
an overwritten object keeps being served in its OLD form until TTL expiry or an explicit purge.
Source: `https://developers.cloudflare.com/r2/reference/consistency/`.

Measured on `dl.kalsa.io`: a request to a not-yet-published path returns `cf-cache-status:
DYNAMIC`, so the 404 is NOT cached and no path is poisoned today. The publish step checks the bucket
through the S3 API, which bypasses the cache entirely; a client-side 404 must therefore be
re-checked with a cache-busting query before it is believed.

### Releasing a new version

Push an annotated tag `kalsa-server-vX.Y.Z`; the tag trigger builds, verifies and publishes, and
the tag's own workflow file is what runs. To rebuild or republish an EXISTING tag (whose workflow
file is frozen), dispatch against the branch instead:

```
gh workflow run kalsa-server.yml --ref b11010-merge -f release_tag=kalsa-server-vX.Y.Z
```

v1.1.0 was published by the first path (run `35565687271`, `trigger: push on a tag`); v1.0.0 by the
second (run `35549848243`, `trigger: workflow_dispatch with release_tag`); v1.1.1 by run
`35762258094` (run id from its own manifest). Before any tag: the branch
must have a GREEN `push` run at the commit being tagged, because a branch run exercises build, pack,
reproducibility and verification without touching the bucket.

### Manifest contract (the desktop consumes this)

One manifest per version, published at
`https://dl.kalsa.io/kalsa-server/v<version>/manifest.json`. It holds a LIST of artifacts because
platforms and backends will grow; today it holds exactly one entry. All values are computed in the
run, never typed by hand.

```json
{
  "version": "v1.1.0",
  "tag": "kalsa-server-v1.1.0",
  "tag_object": "c105c218236799f2f651517f5a0aeabcf4a8d8a1",
  "commit": "2a290390d67311b580ef398fd545e6d060b39897",
  "ref": "refs/tags/kalsa-server-v1.1.0",
  "trigger": "push on a tag",
  "run_url": "https://github.com/Aspis0/kalsallama/actions/runs/35565687271",
  "built_at": "2026-09-21T05:49:19Z",
  "reproducible": true,
  "pack_sha256": "9ee5d9f5199475844c99ac93272d429711b2f58d2a7c5d652c7495a391c5f034",
  "artifacts": [
    {
      "platform": "macos-arm64",
      "backend": "metal",
      "home": "https://dl.kalsa.io/kalsa-server/v1.1.0",
      "file": "kalsa-server-v1.1.0-bin-macos-arm64.tar.gz",
      "url": "https://dl.kalsa.io/kalsa-server/v1.1.0/kalsa-server-v1.1.0-bin-macos-arm64.tar.gz",
      "format": "tar.gz",
      "top_dir": "kalsa-server-v1.1.0",
      "exe": "kalsa-server",
      "size_bytes": 11205316,
      "sha256": "9ee5d9f5199475844c99ac93272d429711b2f58d2a7c5d652c7495a391c5f034",
      "exe_sha256": "327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde"
    }
  ]
}
```

v1.0.0's manifest differs only in the version, tag, tag object, commit, trigger, run URL,
`built_at`, the `v1.0.0` home/file/url/top_dir, `size_bytes` 11203439 and `sha256`
`3fe62ebf…88a7`.

v1.1.1's manifest follows the same contract; its fields as read back are in "Published state,
v1.1.1" above (tag object, commit, run, `pack_sha256`, platform, backend, and the unchanged
launcher `exe_sha256`).

Notes:

- `exe` exists because the shipped binary is `kalsa-server` while the CMake target remains
  `llama-server`.
- The filename carries no backend because it is part of the desktop contract. A uniqueness
  invariant asserts that no two matrix entries share an architecture. If a future backend needs the
  same architecture, the filename must gain a backend suffix and the manifest must change in the
  same commit.
- A fresh CI build of the same tag does NOT reproduce an earlier archive byte-for-byte: the UI
  assets are rebuilt and the archive size and digest change. The manifest published with each
  artefact is therefore the authoritative record for THAT object; never read a digest as a claim
  about a different build. Note the asymmetry: the ARCHIVE differs between two builds, while the
  launcher executable hash does not change even between DIFFERENT versions (see "Where the code
  actually lives" above), so the executable hash is neither a version nor a build identifier.
- The release path has exactly one build-time network fetch, the BoringSSL `FetchContent` clone in
  `vendor/cpp-httplib/CMakeLists.txt:45-68`. It is inherited unchanged from the v1.0.0 path and is
  a build-time fetch in a pipeline the desktop does not run; it is recorded here and was
deliberately NOT changed in the v1.1.0 tag.

## The full diary

`archived/ALIVE-2026-09-full.md`, 7773 lines, English narrative with Italian table rows, frozen
2026-09-20. Read it from the tail. `archived/PLAN-2026-09-full.md` holds the matching plan
history.
