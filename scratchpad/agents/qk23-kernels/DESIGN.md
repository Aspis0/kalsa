# q2_K / q3_K Adreno MoE kernels — design v3 (no code yet)

**Protocol version:** 3 (2026-08-21)

**Status:** DESIGN ONLY. v2 delta-audited ANOTHER-PASS (allocation/hoisting/citations RESOLVED). v3 is the second delta: restore strategy (M6 scoped), store-count, oracle spec, coverage, minors. No kernel code until this file's delta re-audit passes.

**HEAD pin:** `BigMoeOnEdge/third_party/llama.cpp` **`c8f4fc05e0768fea67e474f0d658700c394ffbbd`** (`c8f4fc05e opencl: add GGML_OPENCL_LOG_ALLOC=1 unbuffered allocation trace (oomwall)`). This **is** our working head, including the LOG_ALLOC commit. Every `file:line` below is re-read against that sha. A later bump without a citation pass invalidates the numbers.

**Payoff:** LFM2.5-KEXP experts are Q2_K+Q3_K (`results/oomwall_s23/_LFM2.5-8B-A1B-KEXP_tensors.txt`: 44× Q2_K + 22× Q3_K, expert_bytes **2675.8 MiB**). Today those stay on CPU (`supports_op` false). K2 unblocked q4_K/q5_K MoE on A740 (OLMoE exploratory: 2.17× burst / ~1.5× sustained vs CPU experts — **OLMoE**, not Mellum2). This chapter is the same medicine for the KEXP SKUs.

**Scope:** Adreno MoE `MUL_MAT_ID` only (`use_adreno_moe_kernels`). Dense `MUL_MAT` q2_K/q3_K is out of scope except as a trap (§1.3).

### Changelog

- **v3 (2026-08-21):** Luna ANOTHER-PASS. Owner arbitration: **M6 is CONVERT-ONLY** (SoA uint stores). Restore = kalsakernel-v1 (`eaec5d884`) scalar-uint private + `convert_uchar` per-byte stores. q2_K AoS 84 B (`%4==0`) MAY uint-store; q3_K 110 B (`%4==2`, odd blocks misaligned) MUST byte-store. qs restore: 16 word-assemblies (4 bytes gathered per uint), then words (q2) or bytes (q3). q3 hmask: 8 private uint then bytes; q3 scales: 3 private uint then bytes (no memset). Oracle: exact signature, `{16,1,1}` launch, per-type formula, host pairs including odd sb, ε from half→float. Coverage: `hmask[16]=0x01`, `const00`, k=1792 odd q3. Minors: restore staging release `:10661-10700`; `i01>=ne01` guard.
- **v2 (2026-08-21):** Luna IMPLEMENT-WITH-FIXES. (1) q3 parent **114 B/sb vs 110 B** AoS — `get_alloc_size` override, subbuffer ownership, destructor/pool, **+38.5 MiB** across 22 LFM q3 experts. (2) Exact convert/restore bijections for q2 qs, q3 qh pair-packing, q3 scales. (3) GEMV/GEMM pseudocode: signed `qhat`, `uint sc` not `uchar sc`, qh **uint only**, q2 **16 uint/sb** (v1 typo said 8), mask ABI end-to-end. (4) Loop restructured so `d`/`dmin` are genuinely hoisted per super-block. (5) Test plan: Q2_K/Q3_K MUL_MAT_ID **auto-execute** via `all_types`/`other_types`; q3 production shape `m=2048,k=1792`; signature classes; NMSE cite `:4276`; **dequant oracle** stage. (6) Citations re-pinned to `c8f4fc05`. §8 adds q3 parent, qh pairs, signed-offset, roundtrip-insufficiency, memory delta, `reorder_b` preconditions.
- **v1 (2026-08-21):** initial design. Superseded. Known v1 defects (do not re-litigate, they are fixed here): 8-uint typo; `uchar sc`; “uint or uchar” qh; unsigned `q-4`; d/dmin hoist claim vs copied q4 loop; “will not auto-fire”; reversed q3 test shape; missing 114-vs-110 alloc.

### Citation map

| short | full path under the pinned tree |
|---|---|
| `ggml-opencl.cpp` | `ggml/src/ggml-opencl/ggml-opencl.cpp` |
| `cvt.cl` / `gemv_moe_*.cl` / `gemm_moe_*.cl` / `moe_reorder_b.cl` | `ggml/src/ggml-opencl/kernels/` |
| `CMakeLists.txt` | `ggml/src/ggml-opencl/CMakeLists.txt` |
| `ggml-common.h` | `ggml/src/ggml-common.h` |
| `ggml-quants.c` | `ggml/src/ggml-quants.c` |
| `test-opencl-moe-roundtrip.cpp` | `tests/test-opencl-moe-roundtrip.cpp` |
| `test-backend-ops.cpp` | `tests/test-backend-ops.cpp` |

Compiler in scope: Adreno 740 **E031.41.03.62**.

---

## 1. Current state

### 1.1 `supports_op` — GPU does not take q2_K / q3_K

`ggml_backend_opencl_device_supports_op` in `ggml-opencl.cpp`.

**`GGML_OP_MUL_MAT` (dense)** `:7301-7324`. Admitted with F32 src1: F16, BF16, F32, Q1_0, Q4_0, then contiguous Q4_1 / Q5_0 / Q5_1 / MXFP4 / IQ4_NL / **Q4_K / Q5_K / Q6_K**, then Q8_0. **Q2_K and Q3_K absent.** Fallthrough `:7324` `return false`.

**`GGML_OP_MUL_MAT_ID` (MoE)** `:7325-7350`.

- General path `:7326-7332`: Q4_0 / Q8_0 / MXFP4 only.
- Adreno-shaped path `:7335-7348` inside `#ifdef GGML_OPENCL_USE_ADRENO_KERNELS`: Q4_1 / Q5_0 / Q5_1 / **Q4_K / Q5_K / Q6_K**, gated by `use_adreno_moe_kernels` plus contiguous F32 src1. **Q2_K and Q3_K absent.** Fallthrough `:7350` `return false`.

`use_adreno_moe_kernels` `:7041-7045` (type-agnostic):

```
(((strstr(name, "ffn") && strstr(name, "exps")) || strstr(name, "as")) && (ne[1] % 32 == 0))
```

`backend_ctx` is `GGML_UNUSED`. Admitting q2/q3 is a **list change** plus storage/kernels, not a gate rewrite. LFM expert shapes `[2048,1792,32]` / `[1792,2048,32]` (`_LFM2.5-8B-A1B-KEXP_tensors.txt:32-38`) have `ne[1]` 1792 or 2048, both `% 32 == 0`, names `ffn_*_exps` — the gate **would pass** the moment types are listed.

**v2 consequence (test plan):** listing the types is the enable. `test-backend-ops` **will then run** existing Q2_K/Q3_K MUL_MAT_ID cases (§7). `supports_op` is the last line of the implementation, not the first.

### 1.2 No kernels, no convert, no SoA extra

`ggml/src/ggml-opencl/kernels/`: **zero** hits for `q2_k` / `q3_k` / `Q2_K` / `Q3_K`. MoE ns kernels on disk: q4_0, q4_1, q5_0, q5_1, q4_k, q5_k, q6_k, mxfp4 (`CMakeLists.txt:117-135`).

`case GGML_TYPE_Q2_K` / `Q3_K` in `ggml-opencl.cpp` occur in the dense `mul_mv` switch (`:20074-20075`) only, **not** in `set_tensor`. No `convert_block_q2_k_*`. q4_K trans4-moe host is `:9473-9516`.

### 1.3 Dead / trap dispatch (dense — do not extend)

```
case GGML_TYPE_Q2_K:
case GGML_TYPE_Q3_K:
case GGML_TYPE_Q4_K: {
#ifdef GGML_OPENCL_SOA_Q
    kernel = backend_ctx->kernel_mul_mv_q4_K_f32_flat;
```

(`:20074-20078`). Q2/Q3 would run the q4_K-flat kernel on the wrong extras. Grid: Q2_K uses the Q4_0 formula (`:20370-20377`); Q3_K hits `:20393-20394` `GGML_ASSERT(false && "not implemented")`. **Do not enable dense `MUL_MAT` q2/q3.**

### 1.4 ILA

No `_ila` object for q2/q3 (no kernels). q4_K **does** have a precompiled ILA binary (`:4332-4337` → `kernel_gemm_moe_q4_k_f32_ns_bin`; dispatch `:22397-22399` prefers it and **skips mask args** `:22496-22506`). q6_K has no ILA (`:4395-4407`, `:22786`). **Clone q6_K GEMM wiring, not q4_K’s bin branch.**

---

## 2. Storage design

`QK_K = 256` (`ggml-common.h:89`). Super-block = 256 weights. Reference convert: `cvt.cl:1093-1148` `kernel_convert_block_q4_k_trans4_ns` (AoS → split `dst_q`/`dst_d`/`dst_dm`/`dst_s`, transposed so row `i01` is the unit stride). Host masks as `cl_uchar` args `:9481-9491`. Negative example **in tree**: `cvt.cl:1122-1123` `uchar * qv_bytes = (uchar *)qv` — q4_K shipped with it; q2/q3 **must not copy it**.

Index dance (copy, do not invent):

```
ne00_blk = ne00 / 256
src_blk_offset = i00 + i01 * ne00_blk + i02 * ne00_blk * ne01   // AoS
dst_blk_offset = i01 + i00 * ne01     + i02 * ne00_blk * ne01   // SoA, i01 unit stride
```

(`cvt.cl:1112-1114`).

### 2.1 `block_q2_K` (`ggml-common.h:298-309`)

| field | size | meaning |
|---|---|---|
| `scales[QK_K/16]` | 16 B | 16 groups × (lo nibble = scale, hi nibble = min). CPU: `dl = d*(sc&0xF)`, `ml = min*(sc>>4)` (`ggml-quants.c:978-984`) |
| `qs[QK_K/4]` | 64 B | 2 bits/weight, **interleaved** — **not** 16 consecutive weights per uint (§2.4.1) |
| `d`, `dmin` | 2× half | super-block scale and min scale |

`sizeof = 84` (`static_assert` `:309`). `x = dl * q - ml`, `q ∈ {0,1,2,3}`. **No** `get_scale_min_k4`.

**SoA extra `ggml_tensor_extra_cl_q2_K` (new, q4_K-shaped `:6674-6712`):** `d`, `dm`, `s` (16 uchar packed nibbles / sb), `q` (**16 uint = 64 B / sb**, not 8), optional `q_img`. Sum of planes = **84 B/sb = `ggml_nbytes`**. No parent expansion.

### 2.2 `block_q3_K` (`ggml-common.h:315-321`)

| field | size | meaning |
|---|---|---|
| `hmask[QK_K/8]` | 32 B | high bit of 3-bit quant. CPU: `q2 - ((hm & m) ? 0 : 4)` (`ggml-quants.c:1338`) |
| `qs[QK_K/4]` | 64 B | low 2 bits, **same interleave as q2 qs** |
| `scales[12]` | 12 B | 16× 6-bit scales packed |
| `d` | half | super-block scale; **no dmin**. `x = d * (scale-32) * qhat` |

`sizeof = 110` (`static_assert` `:321`). `offsetof(scales) = 32+64 = 96`, `% 4 == 0` (M5: three `uint` loads of the 12 B field are aligned).

**SoA extra `ggml_tensor_extra_cl_q3_K` (new, q5_K-shaped minus `dm`, `:6714-6770`):**

| plane | bytes / sb | notes |
|---|---:|---|
| `d` | 2 | half, transposed |
| `s` | **16** | **unpacked** 6-bit scales 0–63 as uchar (not 12) |
| `q` | 64 | 16 uint, same qs deinterleave as q2 |
| `qh` | 32 | 8 uint, pair-packed hmask (§2.4.2) |
| **sum** | **114** | **+4 vs AoS 110** |

optional `q_img` is an image view on `q`, not extra parent bytes.

### 2.3 q3 parent allocation (v1 blocker)

`ggml_backend_opencl_buffer_type_get_alloc_size` `:11147-11162` today:

```
size = ggml_nbytes(tensor)
if quantized: size += 4 * alignment    // carve slack, ≤5 components
```

q4_K set_tensor **asserts** `size_d+size_dm+size_s+size_q == ggml_nbytes` (`:9422`). That assert is correct for q2 (84=84) and **false** for unpacked q3 (114≠110).

Staging convert-src buffer stays `ggml_nbytes` (AoS). The **parent** `extra_orig->data_device` (pool allocation) must cover the SoA planes **plus** `align_to` gaps between subbuffers (`align_to` `:179-183`; `alignment` from `CL_DEVICE_MEM_BASE_ADDR_ALIGN` `:5949-5952`).

**`get_alloc_size` override (required):**

```
size = ggml_nbytes(tensor)
if ggml_is_quantized(type):
    size += 4 * dev_ctx->backend_ctx->alignment          // existing slack
if type == Q3_K && use_adreno_moe_kernels(ctx, tensor):
    n_sb = (ne[0]/256) * ne[1] * ne[2]                   // assert ne[0]%256==0
    size += n_sb * 4                                     // 16 B unpacked s vs 12 B packed
return size
```

Equivalent payload: `n_sb * 114 + 4*alignment`. Do **not** assert plane-sum == `ggml_nbytes` for q3; assert `size_d+size_s+size_q+size_qh == n_sb * 114`.

**Subbuffer carve** (same pattern as q4_K `:9435-9470` / q5_K `:9587+`). Order: `d`, `s`, `q`, `qh`. Each origin `align_to(prev+prev_size, alignment)`. Subbuffers are `clCreateSubBuffer` on `extra_orig->data_device`. Last end `origin_qh + size_qh` must be `<=` parent allocation. `GGML_OPENCL_LOG_ALLOC=1` (this HEAD) must log the expanded parent (`try.q3_k` / plane sizes).

**Ownership:**

- Parent blob: OpenCL buffer pool (`extra_orig`). Not owned by the typed extra.
- Planes: subbuffers. `ggml_tensor_extra_cl_q3_K::reset()` `clReleaseMemObject` each (clone q5_K `:6738-6769`). `q_img` released too if created.
- Staging `data_device` in set_tensor: created, written, convert reads it, then `clReleaseMemObject` (q4_K `:9499`).

**Pool / destructor:** clone q4_K/q5_K extras:

- `ggml_opencl_alloc_temp_tensor_extra_q2_K` / `_q3_K` (`:7759-7787` pattern): `new` or pop free-list, push `*_in_use`, `extra->reset()`.
- `ggml_backend_opencl_buffer_context::reset` `:7804-7867`: move `in_use` → free-list. Add q2/q3 vectors.
- destructor `:7604-7617`: `delete` every extra in both lists. Missing this = leak of `cl_mem` and C++ objects.
- vector members next to `:7892-7893`.

Non-MoE Q3_K on this buffer type (name gate fail): `get_alloc_size` does **not** add `n_sb*4`; `set_tensor` takes the generic path. LFM has **no** non-expert Q3_K (`_LFM2.5-8B-A1B-KEXP_tensors.txt:7`).

#### Memory budget — LFM2.5-KEXP q3 experts

All 22 Q3_K tensors are down-proj `[1792, 2048, 32]` (`_LFM2.5-8B-A1B-KEXP_tensors.txt:6,32-38`; `lfm2moe.expert_feed_forward_length=1792`, `embedding_length=2048`, `expert_count=32`, `block_count=24`, experts start at `blk.2` → 22 layers).

```
n_sb / tensor = (1792/256) * 2048 * 32 = 7 * 2048 * 32 = 458752
Δ / tensor    = 4 B * 458752 = 1,835,008 B = 1.75 MiB
Δ total       = 22 * 1.75 MiB = 38.5 MiB
```

**Write-down: +38.5 MiB** device memory for LFM2.5-KEXP q3 experts vs AoS/`ggml_nbytes`, before alignment slack (`22 * 4 * alignment`, typically tens of KiB). Experts today 2675.8 MiB → **~2714.3 MiB** SoA. Alignment slack is already charged for any quantized GPU tensor; the **new** cost is the 38.5 MiB. This is accepted. Unpacking in GEMV to avoid it is **rejected** (K2-class shuffle in the consumer).

q2 experts: 44 tensors, SoA 84=84, **+0 MiB** payload.

---

### 2.4 Exact bijections

Group index `g ∈ {0..15}` is the 16-weight sub-block in **CPU dequant order** (weights `16g .. 16g+15`). `k ∈ {0..15}` is the index inside the group. `i00,i01,i02` are convert work-item ids (`cvt.cl:1104-1106`).

CPU qs packing (quantize, `ggml-quants.c:1429-1432`) for a 128-weight half starting at weight `J ∈ {0,128}`:

```
qs[J/4 + l] = L[J+l] | (L[J+l+32]<<2) | (L[J+l+64]<<4) | (L[J+l+96]<<6)   // l=0..31
```

Dequant walks the same bytes with `shift = 0,2,4,6` (`:974-988`, `:1332-1349`). **Memcpy of `qs[64]` into 16 uint words is not this map.**

#### 2.4.1 q2/q3 qs — interleaved bytes ↔ 16 consecutive-weight uints

**Convert** (`qs[64]` uchar → `word[16]` uint). `mask_03` is a kernel arg.

```
// g = 0..15
half  = g >> 3                         // 0 = weights 0..127, 1 = 128..255
g8    = g & 7
j     = g8 >> 1                        // 0..3  (shift plane)
hi    = g8 & 1                         // 0 → qs[l], 1 → qs[16+l]
shift = j << 1                         // 0,2,4,6
byte_base = half*32 + hi*16            // 0,16,32,48
u = 0
for k = 0..15:
    q = ((uint)qs[byte_base + k] >> shift) & mask_03     // M2 shift-first
    u |= q << (2*k)                                      // k=0 in bits 0..1
word[g] = u
```

**SoA store** (16 uint/sb, v1 said 8 — **wrong**; 256×2 bit = 512 bit = 16 uint = 64 B):

```
base = i02 * ne00_blk * ne01 * 16 + i00 * ne01 * 16 + i01
for p = 0..15:
    dst_q[base + p * ne01] = word[p]
```

**Restore — 16 word-assemblies, then type-specific store (§2.4.5).** The inverse reconstructs one qs **byte** per `(half, hi, l)`. Adjacent reconstructed bytes are gathered four at a time into a **private `uint`** (shift-assemble; never a private `uchar[4]`). `qs[64]` is 16 groups of 4 bytes and **never crosses** a `hi`/`half` boundary (16 and 32 are multiples of 4) → **exactly 16 word-assemblies per super-block.**

```
for t = 0..15:                              // 16 assemblies, not 64 stores
    half = t >> 3                           // 8 words per 128-weight half
    hi   = (t >> 2) & 1                     // 4 words per 16-byte hi-plane
    l0   = (t & 3) << 2                     // 0,4,8,12
    uint w = 0
    for r = 0..3:                           // four adjacent bytes qs[4t .. 4t+3]
        l = l0 + r
        uint byte = 0
        for j = 0..3:
            g = half*8 + 2*j + hi
            q = (word[g] >> (2*l)) & mask_03
            byte |= q << (2*j)
        w |= byte << (8*r)                  // gather in private uint (M1)
    assembled_qs[t] = w                     // private uint[16]
```

Store of `assembled_qs[16]` is **not** the same for q2 and q3 — §2.4.5.

This qs **map** is shared by q2 and q3. The **store** is not.

#### 2.4.2 q3 qh — 32 hmask bytes → 8 uints, two 16-weight groups per uint

Quantize (`ggml-quants.c:1416-1428`): weight `j` → `hmask[j % 32]` bit `j / 32` (`m` cycles 0..31, then `hm <<= 1`). Dequant (`:1321, :1336-1347`) uses `hm[l]` / `hm[l+16]` with `m` shifting per `j`-step — same map. (The in-tree comment “1st 8 quants into bit 0” is stale; the loop puts **32** weights in bit 0.)

**Pair packing.** `p ∈ {0..7}` is both the hmask **bit index** and the uint index.

- `qh_word[p]` bits **0..15** (low half): group `g = 2p`     (even) — `hmask[k]` bit `p`, `k=0..15`
- `qh_word[p]` bits **16..31** (high half): group `g = 2p+1` (odd)  — `hmask[16+k]` bit `p`

Consumer selects half with `hi = g & 1`: `lane = hi << 4` (0 or 16). **No `0xFFFF` mask.**

**Convert:**

```
for p = 0..7:
    bit = p                                  // hmask bit-plane
    u = 0
    for k = 0..15:
        lo = ((uint)hmask[k]      >> bit) & mask_01
        hi = ((uint)hmask[16 + k] >> bit) & mask_01
        u |= lo << k
        u |= hi << (16 + k)
    qh_word[p] = u
```

**SoA store:**

```
base_h = i02 * ne00_blk * ne01 * 8 + i00 * ne01 * 8 + i01
for p = 0..7:
    dst_qh[base_h + p * ne01] = qh_word[p]
```

**Restore — 8 private uint words, then byte stores (q3 only; §2.4.5).** 32 hmask bytes = 8 groups of 4. Assemble in private `uint[8]`; do **not** store a byte per inner iteration.

```
uint assembled_hm[8]
for t = 0..7:
    uint w = 0
    for r = 0..3:
        b  = 4*t + r
        hi = b >> 4
        k  = b & 15
        uint byte = 0
        for p = 0..7:
            hm = (qh_word[p] >> ((hi << 4) + k)) & mask_01
            byte |= hm << p
        w |= byte << (8*r)
    assembled_hm[t] = w
// q3 MUST byte-store (110 B stride, §2.4.5):
for t = 0..7:
    for r = 0..3:
        hmask[4*t + r] = convert_uchar((assembled_hm[t] >> (8*r)) & mask_FF)
```

`mask_FF` is a restore kernel arg (`cl_uchar` `0xFF`). `convert_uchar` of an unmasked `uint>255` saturates — the mask is required (M3).

**Consumer (GEMV group `g`, weight `k`):**

```
p    = g >> 1
hi   = g & 1
lane = hi << 4                               // 0 = low 16, 16 = high 16
word = src0_qh[expert_qh_offset + (sb*8 + p)*ne01 + i01]
hm   = (word >> (lane + k)) & mask_01        // 0 or 1, uint
```

#### 2.4.3 q3 scales — 12 B packed → 16 B unpacked, convert-only

Pack (quantize `:1388-1398`); unpack used at `:1402-1404` (and the vector shuffle `:1323-1328` is equivalent). **GEMV never sees 12 B.**

Load 12 bytes from AoS `scales[]` as `uint b_j = (uint)scales[j]` (global uchar → uint immediately, M1). `mask_0F`, `mask_03` kernel args.

**Convert, `j = 0..15`:**

```
if (j < 8)
    lo4 = (b_j >> 0) & mask_0F               // scales[j] low nibble
else
    lo4 = (b_{j-8} >> 4) & mask_0F           // scales[j-8] high nibble
hi2 = (b_{8 + (j & 3)} >> (2*(j >> 2))) & mask_03
S[j] = lo4 | (hi2 << 4)                      // 0..63 in a uint
```

Store as 4 uints (16 B), M6:

```
s_base = ((i02 * ne01 + i01) * ne00_blk + i00) * 4
for t = 0..3:
    w  = S[4*t+0]
    w |= S[4*t+1] << 8
    w |= S[4*t+2] << 16
    w |= S[4*t+3] << 24
    dst_s_uint[s_base + t] = w
```

**Restore — 3 private uint words, then byte stores (q3; §2.4.5).** Inverse of `:1388-1398`. **No `memset`, no per-byte `|=` into a global `uchar[]`.** Accumulate in `uint s_w[3]` (12 B), then store bytes.

```
uint s_w[3] = {0, 0, 0}                      // private; 3 word-assemblies
for j = 0..15:
    uint l = S[j]                            // 0..63
    if (j < 8)
        s_w[j >> 2]       |= (l & mask_0F) << (8*(j & 3))
    else
        s_w[(j-8) >> 2]   |= ((l & mask_0F) << 4) << (8*((j-8) & 3))
    l >>= 4                                  // 2-bit high
    s_w[2] |= (l << (2*(j >> 2))) << (8*(j & 3))   // bytes 8..11
// 12 bytes, 3 words exactly:
for t = 0..2:
    for r = 0..3:
        scales[4*t + r] = convert_uchar((s_w[t] >> (8*r)) & mask_FF)
```

Do **not** `memcpy` onto `uint aux[4]` in OpenCL (`:1323` is a CPU overlay — M4 illegal on device).

**GEMV scale:** `uint sc = (uint)src0_s[s_index]; float dl = d * ((float)sc - scale_zero);` with `scale_zero = 32.0f` a **kernel float arg**. No 12-byte walk.

#### 2.4.4 q2 scales and d/dmin (no interleave)

**Convert:** `scales[16]` copied as 4 uint stores to SoA `s` (packed nibbles preserved). `d`/`dmin` (`ggml_half`) → `dst_d[dst_blk_offset]`, `dst_dm[dst_blk_offset]`.

**Restore:** 4 private uint copies of SoA `s`, then **uint stores** into AoS `scales[16]` (q2 MAY, §2.4.5). `d`/`dmin` half copies back.

q3 `d` only: convert `dst_d[dst_blk_offset] = b->d`; restore `b->d = src_d[src_blk_offset]` (half, 2-aligned even on odd q3 blocks).

#### 2.4.5 Restore strategy and M6 scope (v3 arbitration)

**M6 (“one uint store per word”) applies to CONVERT only.** Convert writes SoA planes (`dst_q` / `dst_qh` / `dst_s` as `uint*`, `dst_d` as `half*`) whose bases are `align_to(..., alignment)` subbuffers (`ggml-opencl.cpp:9438-9470`). Every plane origin is aligned by construction → uint stores are legal and required (M6).

**Restore writes raw AoS `block_q*_K`.** That is the kalsakernel-v1 restore idiom (`eaec5d884`, still in tree e.g. `cvt.cl:330-331`, `:1199-1200`): **scalar-uint private dataflow** (M1 — assemble in `uint`, never a private `uchar[]`) **+ per-byte stores via `convert_uchar`**. This is device-proven, not a compromise. Restore does **not** use M6 uint stores unless the AoS field is 4-aligned at **every** super-block, which is a per-type fact:

**q2_K stride = 84 B.** `84 % 4 = 0`. Super-block `i` starts at `84*i ≡ 0 (mod 4)`.

| field | offset in block | offset `% 4` | every-block alignment |
|---|---:|---:|---|
| `scales[16]` | 0 | 0 | always 4-aligned |
| `qs[64]` | 16 | 0 | always 4-aligned |
| `d`,`dmin` | 80 | 0 | always 4-aligned |

q2 restore **MAY** store the 16 assembled qs words as `uint` (`((global uint *)b->qs)[t] = assembled_qs[t]`), the 4 scale words as `uint`, and `d`/`dmin` as `half`. Byte stores via `convert_uchar` are also legal; uint is preferred on q2 (fewer stores, alignment holds).

**q3_K stride = 110 B.** `110 % 4 = 2`. Super-block `i` starts at `110*i ≡ 2*i (mod 4)`:

- `i` even → start `≡ 0 (mod 4)`
- `i` **odd** → start `≡ 2 (mod 4)`  ← **this is why k=1792 (7 sb) matters**

| field | offset in block | `offset % 4` | even `i` | odd `i` |
|---|---:|---:|---|---|
| `hmask[32]` | 0 | 0 | 4-aligned | **+2, not 4-aligned** |
| `qs[64]` | 32 | 0 | 4-aligned | **+2** |
| `scales[12]` | 96 | 0 | 4-aligned | **+2** |
| `d` (half) | 108 | 0 | 4-aligned | +2 (= natural half align) |

A `uint` store into `qs`/`hmask`/`scales` on an **odd** q3 block is an unaligned 4-byte write (M5) and a compiler-hazard. **q3 restore MUST use `convert_uchar` per-byte stores** for hmask, qs, and scales. `d` as `half` is 2-aligned on odd blocks — legal for `half`, not for `uint`.

qs store from the 16 assemblies of §2.4.1:

```
// q2 (MAY uint):
for t = 0..15:
    ((__global uint *)b->qs)[t] = assembled_qs[t]

// q3 (MUST bytes):
for t = 0..15:
    for r = 0..3:
        b->qs[4*t + r] = convert_uchar((assembled_qs[t] >> (8*r)) & mask_FF)
```

hmask / scales stores are in §2.4.2 / §2.4.3 (already byte-side).

Convert-side SoA is unaffected: q3 `q`/`qh`/`s` live in aligned subbuffers, M6 uint stores stay.

### 2.5 Restore twins

`kernel_restore_block_q2_k_trans4_ns` / `q3_k_trans4_ns` invert §2.4 with the stores of §2.4.5. Same `i00/i01/i02` ids and **`if (i01 >= ne01) return;`** as convert (`cvt.cl:1104-1108`, restore q4 `:1161-1167`). Roundtrip needs bit-exact AoS. q3 scale-pack bugs → `meta` mismatches; hmask → `qh`; qs plane → `qs`. Roundtrip **cannot** certify the consumer (§7.1b).

**Host restore staging** clones the q4_K MoE path `ggml-opencl.cpp:10661-10700`: one `clCreateBuffer(..., ggml_nbytes, ...)` staging, set args, enqueue, `clEnqueueReadBuffer` into the host pointer, **`clReleaseMemObject(data_device)`** (`:10700`). Do **not** copy the outer `:10661` allocation that the MoE branch at `:10670` shadows (that is an existing q4 leak-shaped double alloc). One staging, one release. Same for q2 and q3.

First-pass GEMV/GEMM read `global uint *` for `q`/`qh`. **Skip `q_img`** unless a later microbench needs it. q4_K GEMV binds buffer `extra->q` (`:22367`); GEMM binds `q_img` (`:22483`) at width `nelements/8` (`:9501-9508`). q2/q3 width if ever added: `nelements/16` (16 weights/uint), **not** `/8`.

---

## 3. Kernels

Four new files + convert/restore in `cvt.cl` (`clCreateKernel` next to `:1752-1757`). Embed in `CMakeLists.txt` next to `:126-131`.

| file | entry |
|---|---|
| `kernels/gemv_moe_q2_k_f32_ns.cl` | `kernel_gemv_moe_q2_k_f32_ns` |
| `kernels/gemm_moe_q2_k_f32_ns.cl` | `kernel_gemm_moe_q2_k_f32_ns` |
| `kernels/gemv_moe_q3_k_f32_ns.cl` | `kernel_gemv_moe_q3_k_f32_ns` |
| `kernels/gemm_moe_q3_k_f32_ns.cl` | `kernel_gemm_moe_q3_k_f32_ns` |

### 3.1 Geometry (copy q4_K MoE)

From `gemv_moe_q4_k_f32_ns.cl:5-8,46-66` and host `:22328-22351`:

- `QK_K 256`, `N_SIMDGROUP 4`, `SIMDGROUP_WIDTH 64`
- **`if (i01 >= ne01) return;`** in **every** new kernel (convert, restore, gemv, gemm, oracle). Convert template `cvt.cl:1108`; restore q4 `:1165`; GEMV q4 `:68-70`. The padded GEMV grid `((ne01+63)/64)*64` launches extra rows — the guard is load-bearing.
- `__attribute__((qcom_reqd_sub_group_size("half")))` on GEMV
- GEMV: `ne12==1`. Launch `global = { ((ne01+63)/64)*64, 4, ne20 }`, `local = {64, 4, 1}` (`:22348-22351`; `local_size` starts `{64,2,1}` then `[1]=4`).
- `src2` = expert ids, sub-buffer (`:22341-22345`).
- src1 activations: `image1d_buffer` F32 (`:22359-22362`), width `ne10*ne11*ne12/4` ⇒ **`ne00 % 4 == 0`** (true for all `k` multiple of 256).
- Reuse `moe_reorder_b` (`moe_reorder_b.cl:1-30`; host e.g. `:21598-21612`). Preconditions recorded in §8 / §3.1.1 — do not fork a second reorder.

GEMM tiles: `TILESIZE_K 16`, `TILESIZE_M 64`, `TILESIZE_N 32` (`gemm_moe_q4_k_f32_ns.cl:7-9`). First pass: **same tiles**. Clone **q6_K** GEMM dispatch (`:22786`), not q4_K ILA-bin.

#### 3.1.1 `reorder_b` preconditions (record, do not relax)

`moe_reorder_b.cl:17,26`: `K/4` indexing ⇒ `ne00 % 4 == 0`.

Host (`:21598-21599`, same assert at `:21825-21826`, `:22003-22004`):

```
unsigned short map_ratio = ne20 / ne11;
GGML_ASSERT((map_ratio == 1) || (map_ratio == ne20));
```

`n_tile_size = 32` (`:20463`). LFM and the auto-fired `test-backend-ops` shapes in §7 satisfy `ne00%4==0`. A future shape that breaks `map_ratio` asserts — out of scope; do not weaken the assert in this chapter.

Expert plane offsets (transposed layout):

```
n_sb = ne00 / 256
expert_d_offset  = expert_id * n_sb * ne01                         // half
expert_q_offset  = expert_id * (ne00 / 16) * ne01                  // 16 weights/uint
expert_qh_offset = expert_id * (ne00 / 32) * ne01                  // q3 only, 8 uint/sb
s_row            = (expert_id * ne01 + i01) * (n_sb * 16)          // uchar
```

### 3.2 Host / kernel mask-argument ABI

Every mask is a kernel argument. Host sets `cl_uchar` / `cl_float` like q4_K convert `:9481-9491` and GEMV `:22379-22385`. A hardcoded `0x0F` in new `.cl` is a review-blocking defect.

| kernel | arg | host | value | role |
|---|---|---|---|---|
| convert/restore q2 | `mask_03` | `cl_uchar` | `0x03` | qs 2-bit |
| gemv/gemm q2 | `mask_0F` | `cl_uchar` | `0x0F` | scale/min nibble |
| gemv/gemm q2 | `mask_03` | `cl_uchar` | `0x03` | qs 2-bit |
| convert/restore q3 | `mask_03` | `cl_uchar` | `0x03` | qs 2-bit **and** scale `hi2` |
| convert/restore q3 | `mask_0F` | `cl_uchar` | `0x0F` | scale `lo4` |
| convert/restore q3 | `mask_01` | `cl_uchar` | `0x01` | hmask bit |
| restore q3 | `mask_FF` | `cl_uchar` | `0xFF` | extract byte from assembled uint (`convert_uchar((w>>(8*r)) & mask_FF)`) |
| gemv/gemm q3 | `mask_03` | `cl_uchar` | `0x03` | qs |
| gemv/gemm q3 | `mask_01` | `cl_uchar` | `0x01` | qh bit |
| gemv/gemm q3 | `scale_zero` | `cl_float` | `32.0f` | unpacked scale bias |

No `kmask1`/`kmask2` (`0x03030303` / `0x0f0f0f0f`) in any q3 kernel — those stay on the CPU (`ggml-quants.c:1309-1310`). Convert uses the per-`j` formula (§2.4.3), not the `uint32 aux[4]` overlay.

Arg order for GEMV (clone q4_K `:47-61` then append masks after `ne01`/`ne11`): `src0_q, src0_d, src0_dm (q2 only), src0_s, src0_qh (q3 only), src1, src2, dst, offsetd, ne00, ne01, ne11, [masks…]`.

### 3.3 GEMV q2 — hoisted `d`/`dmin`, 16 uint/sb

v1 copied the q4 loop (`gemv_moe_q4_k_f32_ns.cl:86-93`) which **reloads** `d`/`dmin` every 32-weight sub-block (`sb = ib/8` inside the `ib` loop). That is **not** a hoist. v2 restructures: subgroups stride **super-blocks**; `d`/`dmin` live in `__private float` for the whole inner `g=0..15`.

```
// work-item: i01 = get_global_id(0), sgid = get_local_id(1), i20 = get_global_id(2)
// masks: mask_0F, mask_03  (args)
if (i01 >= ne01) return;

uint expert_id = src2[i20];
uint n_sb = ne00 / QK_K;
__private float sum = 0;

for (uint sb = sgid; sb < n_sb; sb += N_SIMDGROUP) {
    // HOIST — these two floats live here, reused for all 16 groups
    __private float d    = convert_float(src0_d [expert_d_offset  + sb*ne01 + i01]);
    __private float dmin = convert_float(src0_dm[expert_d_offset  + sb*ne01 + i01]);

    for (uint g = 0; g < 16; ++g) {
        uint sc = (uint) src0_s[s_row + sb*16 + g];          // M1: never uchar sc
        float dl = d    * convert_float(sc & mask_0F);
        float ml = dmin * convert_float((sc >> 4) & mask_0F);

        uint bits = src0_q[expert_q_offset + (sb*16 + g)*ne01 + i01];  // 16×2-bit

        uint y_off = (i20 % ne11) * ne00 / 4 + (sb*16 + g) * 4;       // 16 floats = 4 float4
        // 16 FMAs; activations via read_imagef like q4. Split 4×float4.
        for (uint k = 0; k < 16; ++k) {
            uint q = (bits >> (2*k)) & mask_03;
            // a[k] from the float4 corresponding to k
            sum += (dl * convert_float(q) - ml) * a_k;
        }
    }
}
// then the existing 4-subgroup local reduction (q4 :151-165)
```

`ne00=2048` → `n_sb=8` (divides 4 subgroups). `ne00=1792` → `n_sb=7` (uneven, legal).

### 3.4 GEMV q3 — signed `qhat`, uint qh, pair packing

Same grid and hoist (`d` only; no `dmin`).

```
for (uint sb = sgid; sb < n_sb; sb += N_SIMDGROUP) {
    __private float d = convert_float(src0_d[expert_d_offset + sb*ne01 + i01]);

    for (uint g = 0; g < 16; ++g) {
        uint sc = (uint) src0_s[s_row + sb*16 + g];          // unpacked 0..63
        float dl = d * (convert_float(sc) - scale_zero);     // scale_zero arg = 32.0f

        uint bits = src0_q[expert_q_offset + (sb*16 + g)*ne01 + i01];

        uint p    = g >> 1;
        uint hi   = g & 1;
        uint lane = hi << 4;                                 // 0 = low 16, 16 = high 16
        uint qh_w = src0_qh[expert_qh_offset + (sb*8 + p)*ne01 + i01];

        for (uint k = 0; k < 16; ++k) {
            uint q_u = (bits >> (2*k)) & mask_03;            // 0..3
            uint hm  = (qh_w >> (lane + k)) & mask_01;       // 0 or 1
            int qhat = (int)q_u;
            if (hm == 0) {
                qhat = (int)q_u - 4;                         // signed; NEVER uint q_u-4
            }
            sum += dl * convert_float(qhat) * a_k;
        }
    }
}
```

Equivalent signed form (also legal): `int qhat = (int)q_u - 4 + 4*(int)hm;`. Illegal: `uint qhat = q_u - 4`.

qh plane is **`uint` only**. No `uchar qh` private, no “uint or uchar” option (v1 ambiguity — **killed**).

### 3.5 GEMM

Same dequant into registers as §3.3/§3.4 (including hoist: load `d`/`dmin` once per super-block tile-K walk). Accumulate with the existing `dotx16_reduce8` pattern (`gemm_moe_q4_k_f32_ns.cl:56-70`). **Do not** copy `dequantize_q4_k` (`:50-52` literals `0x000F`…). Mask args always set; **no** `if (kernel_*_bin) skip masks`.

### 3.6 Not writing

- Dense `mul_mv_q2_K_f32_flat`. Leave `:20074-20078` untouched.
- `_ila` kernels / `kernel_*_ns_bin` for q2/q3.
- A fused q2+q3 kernel.
- q3 12-byte shuffle in GEMV/GEMM.

---

## 4. The medicine as law

Device-proven on Adreno 740 E031.41.03.62. Every new `.cl` line is checked against this list. A kernel that violates one item does not ship, even if `test-backend-ops` is green on a lucky build.

| # | rule | why (site) | honor here |
|---|---|---|---|
| M1 | Scalar **`uint` end-to-end in private.** No `uchar`/`ushort` private arrays for payload. | Byte-lane / trans4. | qs/hmask as `uint`. Scales: `uint sc = (uint)s[i];` — **never** `uchar sc` (v1 M1 violation in prose). |
| M2 | Shift first, then mask. | K2 / q4_0 nibble class. | `(bits >> (2*k)) & mask_03`, `(sc >> 4) & mask_0F`, `(qh >> (lane+k)) & mask_01`. |
| M3 | Every byte/bit mask is a **kernel argument**. | K2: `get_scale_min_k4` literals → 0/80+0/4; args → 80/80+4/4 (`k2-fix/REPORT.md`). Host: `:9481-9491`, `:22379-22385`. | ABI §3.2. No `0x0F`/`0x03`/`0x01`/`0x03030303` literals in new `.cl`. |
| M4 | No `as_ucharN` / `uchar *` overlay on private `uint`/`uint4`. | `cvt.cl:1122-1123` negative example. | Pack with shifts into `uint`, store `uint`. No CPU `memcpy(aux, scales, 12)` overlay on device. |
| M5 | No unaligned vector loads. | Alignment site. | `q`/`qh` are `uint*`. `scales[12]` at offset 96, aligned; convert uses scalar uchar→uint loads. |
| M6 | **CONVERT ONLY:** assemble a word in `uint`, store one `uint` per word into SoA. | M4+M1 on the convert write path; SoA subbuffers are `align_to`'d (`:9438-9470`). | Convert: `dst_q[base + p*ne01] = v` (16 qs words; q3 qh 8; s 4). **Restore is not M6** — §2.4.5. |

q4_K GEMV still contains literals in `q4_k_to_fp32_packed8` (`gemv_moe_q4_k_f32_ns.cl:33-43`). Those did not prevent K2 PASS after P1. M3 for **new** kernels is project law, not “every literal always fails.”

---

## 5. Dequant-cost awareness

CPU: `dequantize_row_q2_K` `ggml-quants.c:961-991`; `dequantize_row_q3_K` `:1305-1353`.

| | bytes / 256 w | groups | bits/w | scale traffic in SoA |
|---|---:|---:|---:|---|
| q2_K | 84 | 16 × 16 | 2.625 | 16 packed nibble pairs |
| q3_K | 110 AoS / **114 SoA** | 16 × 16 | 3.4375 | 16 unpacked uchar |
| q4_K | 144 | 8 × 32 | 4.5 | 8 × (6-bit scale, 6-bit min) via `get_scale_min_k4` |

**Amortization (now matched by §3.3/§3.4, not a wish):**

1. `d` / `dmin` loaded **once per super-block** into `__private float` at the top of the `sb` loop. They do not exist as reloads inside `g=0..15`.
2. One scale byte (q2) or one unpacked scale (q3) per group, then 16 FMAs.
3. qs bits once per group (`uint` × 16×2-bit).
4. q3: one `uint` qh word per **pair** of groups (reused for `g` and `g^1` if a later opt fuses the pair; first pass loads per `g`, still one word).
5. q3 12 B shuffle paid in convert.

Do not keep q3 scales packed in GEMV to save 4 B/sb. Four bytes × 458752 sb × 22 tensors = the 38.5 MiB we already accepted; a miscompiled shuffle is a 0/N fail.

Qualitative vs q4_K: GEMV n=1 is integer-bound. q2 will not be 1.7× faster just because it is smaller. First device microbench: MUL_MAT_ID q2_K vs q4_K same shape before any LFM claim.

---

## 6. Dispatch + `supports_op`

### 6.1 Landing order (hard)

Because §7.2 auto-executes Q2_K/Q3_K the moment `supports_op` is true:

1. extra structs + pool/dtor + **`get_alloc_size` q3 override** + convert/restore + roundtrip. `supports_op` still **false**.
2. Dequant **oracle** (§7.1b). Still false.
3. GEMV/GEMM `.cl` + embed + `clCreateKernel` + dispatch cases that **`return`** after enqueue (q4_K Adreno path returns `:22525`; missing `return` falls through the switch).
4. **Last:** add `GGML_TYPE_Q2_K` and `Q3_K` to `:7335-7348`.

Flipping `:7335-7348` first is either SIGABRT (`default: GGML_ASSERT` `:23174-23175`) or, once dispatch exists but is wrong, a wall of MUL_MAT_ID FAILs in `test-backend-ops`.

### 6.2 `supports_op`

Add Q2_K and Q3_K to the **same** Adreno list as Q4_K/Q5_K/Q6_K (`:7335-7348`). Body unchanged: `src1==F32 && use_adreno_moe_kernels(...) && contiguous`. Do **not** add them to `:7326-7332` or dense `:7313-7319`.

### 6.3 `set_tensor` / `get_tensor`

New cases next to q4_K trans4-moe (`:9473-9516`) and q5_K (`:9565+`). If `use_adreno_moe_kernels`: convert trans4-ns + split extra. Else: generic path.

q3: **no** `== ggml_nbytes` plane-sum assert; use `n_sb*114`. Staging write is still `ggml_nbytes`.

`get_tensor` restore twin (q4_K `:10657-10688`). Roundtrip depends on this.

### 6.4 `MUL_MAT_ID` compute

`switch (src0->type)` `:21471`. Add `case Q2_K` / `Q3_K` cloned from **Q6_K GEMM + Q4_K GEMV grid**, not Q4_K ILA. `ne12==1` → gemv, else gemm. Mask args after `ne01` like `:22379-22385`. Always set masks.

### 6.5 ILA / `use_adreno_moe_kernels`

No `_ila` for q2/q3. Gate unchanged (`:7041-7045`).

---

## 7. Test plan

### 7.1 Roundtrip — extend `tests/test-opencl-moe-roundtrip.cpp`

`get_block_layout` `:35-46` has Q4_0..Q6_K, **not** Q2_K/Q3_K. `main` `:342-349` runs `"as"` for those types.

| type | `block_size` | `qs_offset` | `qs_size` | `qh_offset` | `qh_size` | `trans4_nibbles` |
|---|---:|---:|---:|---:|---:|---|
| Q2_K | 84 | 16 | 64 | 0 | 0 | false |
| Q3_K | 110 | 32 | 64 | 0 | 32 | false |

Sizes from `ggml-common.h:309,321`. q3: hmask as `qh` so high-bit bugs are `qh_mis`; 12 B+`d` as `meta_mis`; 2-bit plane as `qs_mis`.

**Signature class names** (`:269-273`) are exactly:

`clean` / `odd_qs_hi_to_f` / `qh_or_mixed` / `other`

(printed fields include `qs_mismatch` / `qh_mismatch` / `meta_mismatch`; those are counts, not class names.) Expect `class=clean` after convert+restore. Also run `"weight"` (gate off) so non-expert q2/q3 are **not** SoA-converted (`:351-354` pattern).

**`const00` (harness already supports it, `:53-61`, parser `:84-88`):** for **each** of Q2_K and Q3_K, invoke `run_case(..., "as", type, ...)` with `GGML_OPENCL_ROUNDTRIP_FILL=const00` (every byte 0). Explicit per-type, not inferred from LCG. Expect `class=clean`.

**Odd q3 block index:** add
`run_case(backend, "as", GGML_TYPE_Q3_K, 1792, 64, 4)`.
`ne00=1792` → `ne00_blk=7` super-blocks. AoS index `src_blk_offset = i00 + i01*7 + i02*7*64`; `i00=1` is **odd**. Odd × 110 B ≡ 2 (mod 4) — this is the q3 restore misalignment case (§2.4.5). A 256-wide roundtrip (`ne00_blk=1`) never hits an odd block. **k=1792 already does; that is why this case exists.** Same 7-sb shape is reused by the oracle (§7.1b).

### 7.1b Dequant oracle (required; implementable spec)

Roundtrip-clean **cannot** catch a convert/restore pair that inverts mutually but lies to the consumer. That is how trans4 fooled us. The oracle runs the **GEMV unpack** (same expressions as §3.3/§3.4) on **one super-block** and diffs 256 floats against CPU `dequantize_row_q2_K` / `dequantize_row_q3_K` (`ggml-quants.c:961-991`, `:1305-1353`). Comment in GEMV **and** oracle: `ORACLE=GEMV unpack`. Divergence is a defect.

A ones-vector GEMV vs `sum(cpu)` is **not** a substitute (cancellations).

#### Kernel signatures (cvt.cl, test-facing)

Argument order: SoA buffers + `ne00`/`ne01` **identical to GEMV** (§3.2), then the scalar selectors, then `out256`, then masks. Offsets inside the kernel use the **same** `expert_*_offset` formulas as §3.1.

q2 (`kernel_dequant_row_q2_k_trans4_ns`):

```
__global uint  * src0_q,       // 0  GEMV
__global half  * src0_d,       // 1
__global half  * src0_dm,      // 2
__global uchar * src0_s,       // 3
int              ne00,         // 4
int              ne01,         // 5
int              i01,          // 6  row (host-chosen)
int              expert_id,    // 7
int              sb,           // 8  super-block index along K
__global float * out256,       // 9  256 floats, this super-block
uchar            mask_0F,      // 10
uchar            mask_03       // 11
```

q3 (`kernel_dequant_row_q3_k_trans4_ns`):

```
__global uint  * src0_q,       // 0
__global half  * src0_d,       // 1  (no dm)
__global uchar * src0_s,       // 2
__global uint  * src0_qh,      // 3
int              ne00,         // 4
int              ne01,         // 5
int              i01,          // 6
int              expert_id,    // 7
int              sb,           // 8
__global float * out256,       // 9
uchar            mask_03,      // 10
uchar            mask_01,      // 11
float            scale_zero    // 12  = 32.0f
```

Both: `if (i01 >= ne01) return;` and `if (sb >= ne00/256) return;`.

#### Launch geometry

Single work-group. **16 lanes = 16 weights in a group; each lane walks all 16 groups.**

```
global = {16, 1, 1}
local  = {16, 1, 1}
```

`k = get_local_id(0)` ∈ 0..15. For `g = 0..15` the lane writes `out256[16*g + k]`. No reduction, no image, no `src1`.

#### Per-type output expression (must match CPU)

Offsets (same as GEMV §3.1, one `sb`):

```
n_sb             = ne00 / 256
expert_d_offset  = expert_id * n_sb * ne01
expert_q_offset  = expert_id * (ne00 / 16) * ne01
expert_qh_offset = expert_id * (ne00 / 32) * ne01          // q3
s_row            = (expert_id * ne01 + i01) * (n_sb * 16)
```

**q2** — CPU `ggml-quants.c:978-980`: `dl = d*(sc&0xF)`, `ml = min*(sc>>4)`, `y = dl * q - ml`.

```
float d    = convert_float(src0_d [expert_d_offset + sb*ne01 + i01]);
float dmin = convert_float(src0_dm[expert_d_offset + sb*ne01 + i01]);
uint  sc   = (uint)src0_s[s_row + sb*16 + g];
float dl   = d    * convert_float(sc & mask_0F);           // sc_l
float ml   = dmin * convert_float((sc >> 4) & mask_0F);    // sc_m
uint  bits = src0_q[expert_q_offset + (sb*16 + g)*ne01 + i01];
uint  q    = (bits >> (2*k)) & mask_03;
out256[16*g + k] = dl * convert_float(q) - ml;
```

**q3** — CPU `:1336-1338`: `dl = d_all * (scales[is]-32)`, `y = dl * (q2 - ((hm&m)?0:4))`. High-bit convention: `hm==1` → keep `q`; `hm==0` → `q-4`.

```
float d  = convert_float(src0_d[expert_d_offset + sb*ne01 + i01]);
uint  sc = (uint)src0_s[s_row + sb*16 + g];                // unpacked 0..63
float dl = d * (convert_float(sc) - scale_zero);           // sc_signed = sc-32
uint  bits = src0_q[expert_q_offset + (sb*16 + g)*ne01 + i01];
uint  p    = g >> 1;
uint  hi   = g & 1;
uint  lane = hi << 4;
uint  qh_w = src0_qh[expert_qh_offset + (sb*8 + p)*ne01 + i01];
uint  q_u  = (bits >> (2*k)) & mask_03;
uint  hm   = (qh_w >> (lane + k)) & mask_01;               // 1 = high bit SET
int   qhat = (int)q_u;
if (hm == 0) qhat = (int)q_u - 4;                          // NEVER uint q_u-4
out256[16*g + k] = dl * convert_float(qhat);
```

#### Host

1. Tensor name `"as"`. Two shapes:
   - `{256, 32, 4}` — one sb, first/last row & expert.
   - `{1792, 64, 4}` — **7 sb** (odd `sb=1` exists; same reason as §7.1).
2. `ggml_backend_alloc` + `set_tensor` (convert to SoA). Staging of the oracle itself is a 256-float `clCreateBuffer`; enqueue; `clEnqueueReadBuffer`; **`clReleaseMemObject`** (same discipline as restore `:10700`).
3. CPU reference on the **same AoS super-block**:
   `block = (block_q*_K *)host_data + sb + i01 * n_sb + expert_id * n_sb * ne01`
   `dequantize_row_q*_K(block, cpu, 256)`.
4. Comparison: `max_i |gpu[i]-cpu[i]|`. Fail the pair if over ε.

**ε = 1e-6 absolute**, plus a relative floor `4*FLT_EPSILON*|cpu[i]|` (take the max of the two per element). Justification: IEEE binary16 → binary32 is **exact** for every finite half (`d`/`dmin`). Remaining ops are `f32 * small_int` (scale nibble 0–15, or `sc-32` in −32..31, `q`/`qhat` in −4..3). A 10-bit mantissa times an integer ≤32 is exact in f32’s 23-bit mantissa. Residual is FMA vs separate mul/sub and host vs device `convert_float` on the half; 1e-6 is far below a 1-bit packing error (q3 dropped high bit ⇒ `|err| ≥ 4|d|`, typically 10⁻²–10¹). `const00` (all-zero block) must be **exact 0**.

#### `(i01, expert_id, sb)` pairs (host must run all)

Let `n_sb = ne00/256`, `ne01`, `ne02`.

| id | i01 | expert_id | sb | why |
|---|---:|---:|---:|---|
| E0 | 0 | 0 | 0 | first row, first expert, first sb |
| E1 | ne01−1 | 0 | 0 | **last row** |
| E2 | 0 | ne02−1 | 0 | **last expert** |
| E3 | 0 | 0 | 1 | **odd super-block** (q3 110 B × odd ≡ 2 mod 4; qh pair across sb stride) |
| E4 | ne01−1 | ne02−1 | n_sb−1 | last of each axis |

E3 requires `n_sb ≥ 2`. The `{1792,64,4}` tensor has `n_sb=7`, so E3 is `sb=1` (odd) and E4 is `sb=6`. `{256,32,4}` has `n_sb=1` — run E0–E2,E4 only (`sb=0`); E3 lives on the 1792 tensor. **Skip E3 on n_sb=1 rather than skip the 1792 tensor.**

#### `hmask[16]=0x01` vector (R14)

On `{256,32,4}` Q3_K, **overwrite the host AoS** of one block `(i01=0, expert=0, sb=0)` to all-zero then `hmask[16] = 0x01` (and `d` a non-zero half, e.g. 1.0, so the scale is visible). Re-`set_tensor`. Run oracle E0.

CPU: `hmask[16] bit 0` is weight 16’s high bit (`ggml-quants.c:1416-1428`: weight `j` → `hmask[j%32]` bit `j/32`). Weight 16 = group `g=1` (odd), `k=0` → consumer must read the **high 16** of `qh_word[0]` (`lane=16`). If convert swapped halves, the bit lands in group `g=0` and `out256[16]` (g=1,k=0) misses the −4 vs 0 distinction: `|err| ≥ 4|d|`. This is the R14 discriminator. Expect `class` of a subsequent roundtrip on this block to still be `clean` (restore inverts) **and** oracle to match CPU — that split is the point.

### 7.2 `test-backend-ops` MUL_MAT_ID — **will auto-execute** (v1 claim retracted)

Q2_K and Q3_K are in:

- `all_types[]` `:7834-7848` (Q2_K, Q3_K at `:7841`)
- `other_types[]` `:7861-7874` (at `:7866`)

Instantiators that **already** build MUL_MAT_ID for every `all_types` / `other_types` entry:

```
// :8863-8865
for (ggml_type type_a : all_types)
    test_mul_mat_id(type_a, F32, 4, 2, false, 64, 16, 3*ggml_blck_size(type_a));
    // Q2_K/Q3_K: k = 3*256 = 768, m=64, n=16 → GEMM (ne12!=1)

// :8883-8891
for (type_a : other_types)  n_mats=4, n_used=2, m=512, k=256, n ∈ {1,32}
    // n=1 GEMV, n=32 GEMM, one super-block — sharp packing probe
```

`test_mul_mat_id::build_graph` names the expert tensor **`"as"`** (`:4303-4305`), `m` is 64 or 512, both `%32==0` → `use_adreno_moe_kernels` **passes**. The day `:7335-7348` lists Q2_K/Q3_K, OpenCL **runs** these cases. IQ2_XS ≠ Q2_K but that is irrelevant: Q2_K is already in the arrays.

The loop at `:9745-9758` is a **different** set (`{F32,F16,Q4_0,Q8_0,Q4_K,Q6_K,IQ2_XS}`) and still does not include Q2_K/Q3_K. Dedicated K2 cases `:8910-8918` are Q4_K/Q5_K only. Neither fact restores the v1 “will not auto-fire” claim.

**Therefore:** implement convert+oracle+kernels+dispatch **before** `supports_op`. First device run with `GGML_OPENCL_LOG_KERNELS=1` must print `kernel_{gemv,gemm}_moe_q{2,3}_k_f32_ns` on the auto-fired cases, not a CPU fallback.

**NMSE:** `test_mul_mat_id::max_nmse_err()` **`:4276-4277`** returns `5e-4`. (The generic op table `:7345-7356` is the same number for `GGML_OP_MUL_MAT_ID`; the class method is the cite.)

**Add** production-shaped cases (constructor is `(type, F32, n_mats, n_used, b, m, n, k)`):

```
// Q2_K gate/up: GGUF [2048, 1792, 32] → k=2048, m=1792
test_mul_mat_id(Q2_K, F32, 32, 4, false, 1792, 1, 2048)   // GEMV
test_mul_mat_id(Q2_K, F32, 32, 4, false, 1792, 8, 2048)   // GEMM-ish

// Q3_K down: GGUF [1792, 2048, 32] → k=1792, m=2048  (v1 reversed this)
test_mul_mat_id(Q3_K, F32, 32, 4, false, 2048, 1, 1792)
test_mul_mat_id(Q3_K, F32, 32, 4, false, 2048, 8, 1792)

// Mellum2-ish q2
test_mul_mat_id(Q2_K, F32, 64, 8, false, 896, 1, 2304)
```

### 7.3 Device ladder

1. Roundtrip `"as"` q2_K + q3_K → `class=clean` (LCG **and** `const00` per type). `"weight"` not SoA. Q3_K `ne00=1792` odd-block case.
2. **Oracle** §7.1b → ε as specified (1e-6 / 4 ulp). Pairs E0–E4 including odd `sb=1`. `hmask[16]=0x01` vector. If this fails, **do not** look at MUL_MAT_ID.
3. `test-backend-ops -o MUL_MAT_ID` on OpenCL **after** `supports_op` (auto-fired + dedicated). GEMV n=1 first. Expect N/N PASS. 0/N garbage after a clean oracle is a compute miscompile (K2-class), not storage.
4. LFM2.5-KEXP smoke: experts Q2_K+Q3_K. noextra impl, `-fa off`, modest `-ngl`, **no** `-ncmoe`. `GGML_OPENCL_LOG_ALLOC=1` on first load — parent sizes must show the q3 expansion. Abort on MemAvailable cliff ≥ 2 GB. Success = load + ≥16 tokens without SIGABRT/power-off.

Dense `MUL_MAT` q2/q3 is **not** in this ladder.

---

## 8. Risk register

**HEAD:** `c8f4fc05`. Compiler: E031.41.03.62.

A row is a **ship-blocker** unless marked residual.

### R1. Miscompile families (K2-class)

Literal-mask scale helpers, mask-then-shift, private `uchar*` alias (`cvt.cl:1122-1123`), unaligned `vload`. Mitigations: §2.4 convert-only q3 scales, §3.2 ABI, M1–M6. New site (oracle clean + MUL_MAT_ID 0/N): stop, K2-style oracle chapter; `-cl-opt-disable` on MoE aborted err=-6 (K2 E1). Dummy-arg vs literal discriminator is still **not run**.

### R2. Convert `uchar*` trap

Do not copy `cvt.cl:1122-1123`. Host mask args clone `:9481-9491`.

### R3. AoS qs/hmask vs consecutive SoA

Memcpy of `qs`/`hmask` + matching restore ⇒ roundtrip `clean` **and** GEMV/oracle fail. Discriminator is §7.1b, not §7.1. Formulas: §2.4.1–2.4.2.

### R4. ILA / precompiled binary

Clone q6_K GEMM, not `kernel_gemm_moe_q4_k_f32_ns_bin` (`:22397-22506`).

### R5. Dense `MUL_MAT` trap

`:20074-20078`, `:20393-20394`. Do not list Q2/Q3 in `:7313-7319`.

### R6. `supports_op` before kernels — worse in v2

Auto-fired cases (§7.2) make an early flip a full-suite failure, not a quiet CPU fallback. Landing order §6.1.

### R7. FLASH_ATTN `map.at` — residual

`ggml_cl_flash_attn` `:14884-14886` unguarded `fa.bm.at(dk_dv)` for `n_q>1`. `supports_op` admits `{64,64}` (`:7410-7415`). Mitigation: `-fa off` on llama-bench. Do not fix FA in this PR.

### R8. oomwall `use_extra_bufts` — residual

Default true `llama-model.cpp:2317`; llama-bench inherits `llama-bench.cpp:1181-1193`. ARM Q4_K repack `repack.cpp:4600-4614`. LFM smoke: noextra pin. Never export `HOST_REPACK`/`DUMP_Q`.

### R9. Vacuous PASS

Auto-fired cases **do** use name `"as"` (`:4303-4305`). Dedicated cases must too. First log: `GGML_OPENCL_LOG_KERNELS=1`.

### R10. `IMAGE1D_BUFFER` / extra layout

First pass: no `q_img`. If added: width `nelements/16`, not `/8`. q3 extra is **not** `ggml_tensor_extra_cl_q4_K` (no `dm`; has `qh`).

### R11. q3 `uint32` overlay on `uchar[12]`

CPU `:1323` `memcpy(aux, scales, 12)`. Illegal in `.cl`. Convert uses §2.4.3.

### R12. Scope / device

Dense q2/q3 out of scope. Mellum2 GPU-MoE speed is Track 1 after N≥10, not this chapter. 15.28 t/s is **OLMoE**. Device: S23 serial `R3CW406P8CV` / TLS `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`, not Jelly. `/data/local/tmp/s3oracle`. `s3base`/`s3fix`/`s3printf` UNTOUCHED.

### R13. q3 expanded-parent ownership (new)

If `get_alloc_size` is not overridden, subbuffer carve of 114 B/sb into a 110 B/sb parent **overlaps the next tensor in the pool** (the exact failure `:11150-11156` describes for q6_K scale slack). Symptoms: silent corruption, not a clean CL error. Must: override (`:11147`), drop the `== ggml_nbytes` assert, LOG_ALLOC the parent, dtor/pool coverage for the new extra type (`:7604-7617`, `:7759-7787`, `:7850-7863`). Forgetting the destructor loop leaks `cl_mem`. Staging remains `ggml_nbytes`; mixing staging size with parent size is a second overlap.

### R14. qh pair-packing (new)

8 uints, two groups per uint, **low 16 = even `g`, high 16 = odd `g`**, `lane = (g&1)<<4` (§2.4.2). Swapping halves is a silent `qhat` shift of 16. Discriminator is **`hmask[16]=0x01`** (odd/high half, weight 16, group `g=1`) — §7.1b. (`hmask[0]=0x01` only probes the **low** half / even `g`; it does **not** catch a swap.)

### R15. Signed-offset arithmetic (new)

`qhat = q-4` when `hm=0` and `q` is `uint` underflows to `0xFFFFFFFC`. Must be `int qhat = (int)q_u - 4` (§3.4). A test vector with many `hm=0` (quantize `L[j]≤3`) makes this fail hard; a vector with all high bits set hides it.

### R16. Roundtrip-insufficiency (new)

Convert ∘ restore = identity does **not** imply convert ∘ GEMV-unpack = `dequantize_row_*`. trans4 was this class. Oracle §7.1b is not optional. A PR that ships roundtrip+e2e without the dump kernel is rejected.

### R17. Production memory delta (new)

LFM2.5-KEXP q3 experts: **+38.5 MiB** (§2.3). Budget it in ram_guard / MemAvailable math. LOG_ALLOC must show it. Do not “save” it by unpacking in GEMV.

### R18. `reorder_b` preconditions (new)

`ne00 % 4 == 0` (`moe_reorder_b.cl:17`). `map_ratio = ne20/ne11 ∈ {1, ne20}` (`ggml-opencl.cpp:21598-21599`). `n_tile_size=32`. GEMV src1 image width `ne10*ne11*ne12/4` same `%4`. LFM 1792/2048 and `k=256/768` auto-cases are fine. Do not weaken the assert. GEMM path **must** call the existing reorder, not a fork.

### Review checklist (auditor)

Reject a kernel PR claiming this DESIGN if any of:

1. Q2_K/Q3_K in dense `MUL_MAT` `supports_op` `:7313-7319`, or `:20074` carries real traffic.
2. New `.cl` contains a numeric mask literal or a `get_scale_min_k4` / 12-byte shuffle in GEMV/GEMM.
3. Convert has `uchar *` overlay on private `uint` (`cvt.cl:1122` pattern).
4. Dispatch clones `kernel_gemm_moe_q4_k_f32_ns_bin` / skips mask args.
5. `supports_op` flipped before convert+oracle+kernels+`return`ing dispatch.
6. Roundtrip `"as"` not `class=clean`, or `"weight"` SoA-converted. Missing `const00` per type, or missing Q3_K `ne00=1792`.
7. No dequant oracle, oracle unpack ≠ GEMV unpack, missing E3 odd-sb pair, or missing `hmask[16]=0x01`.
8. `get_alloc_size` still `ggml_nbytes` for MoE Q3_K, or plane-sum asserted `== ggml_nbytes`.
9. q2 `q` plane treated as 8 uint/sb.
10. `uchar sc` or unsigned `q-4` in GEMV.
11. q3 test shape still `m=1792,k=2048` (that is q2 gate/up, not q3 down).
12. LFM smoke: stock extra_bufts llama-bench or `-fa on`.
13. New extra type missing from buffer dtor/pool.
14. Restore uses M6 uint stores on q3 (110 B, odd blocks +2). qs restore stores 64 times instead of 16 assemblies. Restore staging not released (`:10700`). Any new kernel missing `i01 >= ne01`.

**This DESIGN v3 is complete. No kernel code in this chapter.** Next: second delta re-audit of this file. Implementation only after that audit lands.

---
