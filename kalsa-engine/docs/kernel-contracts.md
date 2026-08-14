# Kernel contracts

The Kalsa Kernel library is a C/C++ layer with a stable ABI for streamed
quantized MoE. Each primitive ships with a contract: supported shapes and
quants, a correctness oracle, a fallback, and a perf budget per device
class. This file is the prose half; the machine-readable half of kernel #1
is [`core/kernel/contract_mul_mat_id.h`](../core/kernel/contract_mul_mat_id.h).

Runtime hooks (expert-ready, cache, prefetch) consume the kernel. They are
not the kernel. See [moe-streaming.md](moe-streaming.md).

## Kernel #1 — streamed `mul_mat_id`

**Champion implementation: stock llama.cpp `vec_dot`.** That is a valid
outcome. S1, S2, REPACK 8x4 lost; i8mm 8x8 won the op (1.27x) and the
token budget (+0.2-4%) but did not clear the 10% adoption gate. The
contract's first budget is that measured floor, not a hope.

The engine loads with `use_mmap=true, use_extra_bufts=false` so streamed
experts stay in native gguf layout. Stock and fused both hit `vec_dot` on
that path. A REPACK extra-buffer impl is not reachable under `--moe-stream`
without breaking the cache rebind.

### Supported shapes / quants

Taken from the S2 matcher's predicate list (`ggml_cpu_try_fuse_moe_ffn` on
the S2 pin — documented here, not reimplemented). Stock `vec_dot` is a
strict superset; a fused impl must declare which of these it covers.

Core 5-node decode sequence (production `build_moe_ffn`, one token):

```
MUL_MAT_ID   MUL_MAT_ID   GLU(SWIGLU, not swapped)   MUL_MAT_ID   MUL
```

All five `COMPUTE`-flagged. Gate/up share hidden and ids; down's second
source is the GLU; down shares ids. MUL weights are F32 with shape
`(1, k, 1)`. `ids->ne[1] == 1` (prefill stays stock). Gate/up are K-quants
with the same `vec_dot_type`. Down is any type that has a `vec_dot`.
Hidden is that `vec_dot_type` or F32 with `from_float`. Workspace must
fit one quantized hidden + `k * n_ff` scratch + quantized hidden_ff.

Optional reduce tail (the "+4"): `VIEW` columns of the MUL, `ADD`-reduce,
and for `k==1` a `CONT`. External uses of the fused span reject the match.

Contract test vectors (also in the header):

| name | n_expert / k / n | n_embd × n_ff | gate/up | down | fused legal |
|---|---|---|---|---|---|
| mellum-q4k-q8 | 64 / 8 / 1 | 2304 × 896 | Q4_K | Q8_0 | yes |
| mellum-q4k-q5 | 64 / 8 / 1 | 2304 × 896 | Q4_K | Q5_0 | yes |
| mellum-k1 | 64 / 1 / 1 | 2304 × 896 | Q4_K | Q8_0 | yes |
| mellum-k6 | 64 / 6 / 1 | 2304 × 896 | Q4_K | Q8_0 | yes |
| mellum-prefill-n2 | 64 / 8 / 2 | 2304 × 896 | Q4_K | Q8_0 | **no** |
| qwen3moe-class | 128 / 8 / 1 | 2048 × 768 | Q4_K | Q8_0 | yes |
| cheap-edge | 32 / 4 / 1 | 256 × 256 | Q4_K | Q8_0 | yes |

Mellum2 live tensors (K0): gate/up `[2304, 896, 64]` Q4_K, down `[896, 2304, 64]`
Q8_0×14 + Q5_0×14. Down cannot be Q4_K (`ne[0]=896` is not a multiple of
`QK_K=256`).

### Correctness oracle

- **NMSE ≤ 5e-4** against the `use_ref` / stock graph. Same bound as
  `test-backend-ops test -b CPU -o MOE_SWIGLU_ID` (S2 7/7 on device) and
  the K0 MUL_MAT_ID gate.
- **Greedy determinism.** `OFF==OFF` and `ON==ON` (byte-identical
  back-to-back greedy runs) is required. `ON==OFF` is **not**.
- **Documented `ON!=OFF` reorder class.** S2 fused vs stock is
  `DETERMINISTIC_REORDER`: NMSE in budget, a near-tie greedy argmax
  flipped at generation word 110 / character 677 on Mellum2 n=256. Treat
  ON and OFF transcripts as non-interchangeable at long n. Shipping a
  reorder-class impl also needs a PPL/quality gate. A race (`ON!=ON`) is
  a ship-blocker, not a reorder.

Fallback when a candidate rejects the match or fails the oracle: stock
`vec_dot`. There is no "no kernel" hole.

### Perf budget per device class

Floors to defend, not targets. Champion = stock `vec_dot`. **Screen
doctrine:** quote only `mWakefulness=Awake` cells for product numbers.
Dozing understates wall (SM8650 Marco t4 8.58 Dozing vs 10.57 Awake).

| device | geometry | t | k / drop | compute s/tok | wall tok/s | screen | source |
|---|---|---:|---|---:|---:|---|---|
| sd8gen2 | Mellum k6d10 | 2 | 6 / 1.0 | **0.148** | **5.151** | Awake | S2 Phase B, fused OFF |
| sd8gen2 | Mellum k6d065 | 2 | 6 / 0.65 | 0.163 | 3.837 | Awake | S2 Phase B, fused OFF |
| sd8gen2 | Marco1c k6d065 | 4 | 6 / 0.65 | — | 8.819 | Awake | `reports/lineup-card.md` (U-curve on this SoC is t2) |
| sd8gen2 | CalaQwen k6d065 | 4 | 6 / 0.65 | — | 5.696 | Awake | `reports/lineup-card.md`, `reports/moe-calaqwen-xiaomi.md` |
| sd8gen2 | dense 2B | 4 | — | — | 15.9 | — | `reports/moe-dense2.md` / `moe-mellum2-f1-s23.md` cell A; `-t 4` |
| sm8650 | Marco1c k6d065 | 4 | 6 / 0.65 | 0.041 | **10.574** | Awake | t4 screen-ON; Dozing t4 = 8.577 |
| sm8650 | Marco1c k6d065 | 6 | 6 / 0.65 | — | 4.101 | Awake | card cell; t6 oversubscribes |
| sm8650 | CalaQwen k6d065 | 6 | 6 / 0.65 | — | 2.55 | Awake | sustained throttle (cold 4.02) |
| g99 | LFM2.5 Q4_K_M resident | 2 | 4 / off | — | **10.60** | — | `reports/moe-g99-freetier.md`; ~11.0 GB/s; REAP k4 zero-fault 10.68 |
| g99 | LFM2.5 Q4_K_M | 2 | 2 / off | — | 14.38 | — | still under the 15 floor |
| g99 | Marco1c k6d065 | 2 | 6 / 0.65 | — | 3.642 | ranking-only | I/O matches flagships 51.5 / 53.5 |
| g99 | CalaQwen k6d065 | 2 | 6 / 0.65 | — | 1.63 | ranking-only | T3 prompts |

S2 fused-ON best compute on the same Mellum k6d10 t2 cell was **0.1585**
s/tok (slower than stock at every same-t pair). It is not a budget.

S3 honesty: REPACK 8x4 ID at t2 loses (948.9 vs 495.5 µs). i8mm 8x8 wins
the op (388.69 vs 495.50 µs, ×1.27) and the token-model is +0.2–4% —
under the 10% gate. Neither replaces the 0.148 floor.

Closed on this regime (do not reopen without new silicon or a new shape):
CPU speed hunting on SD8Gen2/t2/Mellum, GPU decode on A7X, cache-insert
repack, REPACK 8x4 streamed, compression-in-cache, sub-4-bit on weak
cores as a universal lever.

## Dispatcher

[`core/kernel/dispatch.{h,cpp}`](../core/kernel/dispatch.h) maps
`(SoC class, RAM budget, model geometry) → {threads, k, drop, impl}`.
The CLI peeks GGUF metadata (`general.architecture`, expert/embd/ffn
dims) before load so named-geometry rows can fire. `ram_mb` is detected
and logged but **not consulted** — the table cannot express RAM tiers
until the first-launch probe exists; until then the static U-curve row
wins. User/env flags (`-t`, `--n-expert-used` / `BMOE_N_EXPERT_USED`,
`--drop-cold-experts`) win over the row. A row that sets k or drop
**changes model output**; the CLI prints a warning.

Seeded U-curves:

| SoC | threads | notes |
|---|---:|---|
| sd8gen2 (SM8550) | 2 | t2 beats t4; Mellum geometry also sets k=6 drop=1.0 |
| sm8650 | 4 | t4 > t5 > t6 |
| g99 (MT6789) | 2 | 2×A76; LFM geometry also sets k=4 (the LFM2.5 default — a no-op on k) |
| host / unknown | 4 | engine defaults — config-equivalent to dispatch off |

Impl is always `stock_vec_dot` today. Alternative impls stay in the enum
so a later row can select them on other silicon (S1 fused won 2.58× at
t8; i8mm wins per-op).

`--kernel-dispatch` on `bmoe-cli` (default **off**) applies the row and
logs the decision to stderr. The first-launch micro-bench is a **hook +
stub** (`run_autobench_stub`, cache path `kalsa-kernel/dispatch-v1.json`).
It is not implemented and is not called from `resolve_dispatch`.

## CI packaging

[`tests/kernel_ci/`](../tests/kernel_ci/README.md) wraps the existing
oracles as one keyed suite. See [kernel-day-zero.md](kernel-day-zero.md)
for the commands.
