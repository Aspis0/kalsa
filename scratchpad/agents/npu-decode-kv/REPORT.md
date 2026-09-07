# REPORT — NPU decode: is host-KV the cause?

Job **808386**, QRD8650 / SM8650 / Hexagon **v75**, Android, SSH-only.
Session name `kalsa-npu-decode-kv`. Started 09/07/26 10:52:29 AM,
**Ended On 09/07/26 11:00:10 AM**, Session Status **Completed**.
Device wall ~8 min (push 115 s + four arms). **Session is closed.**
Not the 8 Elite; v75 skel was present (step 0 PASS).

PREREG written 2026-09-07T14:46:30Z, before any number of this cell.
Kit `npu-kit-153fdbafd.tgz` sha `e7ff4cd8…`. Model on-device sha
`a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`
matches the lock (`raw/ondevice_sha.txt`). All four arms `EXIT=0`.

## Ceiling (P0)

```
ggml-hex: HTP0 buffer mapping failed : domain_id 3 size 268435456 fd 25 error 0x00000001
ggml-hex: HTP0 measured max vmem 3489660928
```

N = 3,489,660,928 B = **3328 MiB = 3.25 GiB**. The failed mapping is
exactly 256 MiB (`268435456`).

Pre-registered ceiling readings:
- Owner 4 GB (32-bit) hypothesis **REFUTED** (3328 ∉ [3500, 4096] MiB).
- Qualcomm 8gen3 ~3 GB claim **REFUTED by letter** (3328 ∉ [2800, 3200] MiB;
  128 MiB above the top of that band). The number sits 128 MiB above the
  backend default 3200 MiB, which is not itself a measurement.

1.48 GiB weights + 32 MiB KV ≈ 1.51 GiB ≪ 3328 MiB → C was predicted
to map. It did.

## Speed table (`tg128 @ d1920`, n_ctx=2048, r=3)

| arm | KV proof | engine proof | tg128 t/s | EXIT |
|-----|----------|--------------|-----------|------|
| A CPU `-ngl 0` | `CPU KV buffer size = 32.00 MiB` (2048 cells, 8 layers) | 0 `execute-op`; all 31 layers `assigned to device CPU` | **17.68 ± 4.17** | 0 |
| B NPU `-nkvo 1` | `CPU KV buffer size = 32.00 MiB` | `Hexagon Arch version v75`; 137467 `execute-op`; ngl 99; table `nkvo=1` `dev=HTP0` | **15.08 ± 0.55** | 0 |
| C NPU no `-nkvo` | `HTP0 KV buffer size = 32.00 MiB`; layers 2,5,9,13,17,21,24,27 `dev = HTP0` | `Hexagon Arch version v75`; 163827 `execute-op`; 3096 `execute-op FLASH_ATTN` on HTP0 | **13.37 ± 0.25** | 0 |

Quoted table rows (`raw/{A,B,C}.log`):

```
| lfm2 2.6B Q4_0 | 1.48 GiB | 2.70 B | OpenCL,HTP |  0 | ... | tg128 @ d1920 | 17.68 ± 4.17 |
| lfm2 2.6B Q4_0 | 1.48 GiB | 2.70 B | OpenCL,HTP | 99 | nkvo 1 | HTP0 | tg128 @ d1920 | 15.08 ± 0.55 |
| lfm2 2.6B Q4_0 | 1.48 GiB | 2.70 B | OpenCL,HTP | 99 | HTP0 | tg128 @ d1920 | 13.37 ± 0.25 |
```

The backends column prints `OpenCL,HTP` on A too — ignore it (PREREG).
A has zero HTP execute-ops. B/C have them. No silent CPU fallback.

C FLASH_ATTN on the DSP (not on B):

```
ggml-hex: HTP0 execute-op FLASH_ATTN_EXT|... x cache_k_l2 ... x cache_v_l2 ...|HTP0 x HTP0 x HTP0 x HTP0 -> HTP0|hvx ...
```

B's only `flash_attn` hit is `llama_context: flash_attn = enabled`.
Attention with host-KV stayed on the CPU.

Ratios from the printed means:
- C/A = 13.37/17.68 = **0.756**
- C/B = 13.37/15.08 = **0.887**  (|C/B−1| = 0.113)
- B/A = 15.08/17.68 = **0.853**

## Pre-registered readings applied

1. **C fails to allocate** — does not fire. C mapped 32.00 MiB on HTP0.
2. **C/A ≥ 1.0** — does not fire (0.756). NPU decode with DSP-KV does
   **not** become a live routing option.
3. **0.90 ≤ C/B ≤ 1.10** — does not fire by letter (0.887 < 0.90).
   Miss is 1.3 percentage points, **on the slow side of B**.
4. **C/B ≥ 1.15 AND C/A < 1.0** — does not fire (C/B is 0.887, not ≥ 1.15).
5. B is not METHOD-VOID (137k execute-ops, v75, CPU KV as requested).
6. NPU graph ran (not NPU-GRAPH-FAIL).

No named speed verdict fires by letter. I am not widening the 10% band
after seeing the number. The **mechanism answer is still unambiguous**:
moving KV onto the DSP did not recover decode. It made decode **slower**
than the host-KV NPU arm, and both NPU arms lose to CPU.

Closest reading in spirit: **KV-NOT-THE-CAUSE**. The product reading
**KV-WAS-THE-BLOCKER** is REFUTED. NPU decode loses intrinsically on
this model/graph at ctx 2048, with or without `-nkvo`.

## What surprised me

C is slower than B *because* KV-on-DSP actually moved flash-attn onto
HTP (`execute-op FLASH_ATTN` × 3096, hvx, `cache_k_l*`/`cache_v_l*` on HTP0).
B kept attention on the CPU (host KV) and was 15.08 vs C's 13.37.
The original "handicap" is not a handicap on this graph: host-KV NPU
decode is the *faster* of the two NPU arms.

A's ±4.17 (24% of the mean) is a weak CPU reference; B and C stdevs
are tight (0.55, 0.25). C/B does not rest on A's noisy mean.

## Thermal (declared deviation)

PREREG bound the #38 gate (HAL max ≤ 60 °C and Thermal Status ≤ 1)
before each arm. `d_run.sh` snapshotted and **did not skip**. Status
was 0 on every dump; HAL max was already over 60 before A
(`therm_pre_A.txt` CPU7 65.2 °C) and 89.9 °C before B and C. post_A
CPU3/4/5 hit 95.0 °C `mStatus=3`. Battery 25.0 and nsp0/nsp1
43.6/43.2 °C are **bit-identical across every snapshot** — frozen
stubs, not used. B vs C ran at the same CPU7=89.9 pre-temp; that
pair is still a same-session mechanism comparison. C/A is the
weaker ratio (A thermally dirty).

## Commands actually run

Env on device: `LD_LIBRARY_PATH=$D/lib ADSP_LIBRARY_PATH=$D/lib
GGML_HEXAGON_NDEV=1 GGML_HEXAGON_VERBOSE=1`. Never `/vendor/lib64`.
`$D=/data/local/tmp/kalsa-npu-decode-kv`.

```
P0: GGML_HEXAGON_VMEM=0 ./bin/llama-bench -m $D/ship.gguf --device HTP0 -ngl 99 --mmap 0 -p 0 -n 1 -r 1 --no-warmup -v
A:  ./bin/llama-bench -m $D/ship.gguf --mmap 0 --poll 1000 -t 8 -ub 1024 -fa 1 -p 0 -n 128 -d 1920 -r 3 -v -ngl 0
B:  ...same... --device HTP0 -ngl 99 -nkvo 1
C:  ...same... --device HTP0 -ngl 99
```

Raw logs: `scratchpad/agents/npu-decode-kv/raw/{P0,A,B,C}.log`.
B.log 75 MB / C.log 86 MB are the verbose execute-op dumps.

## Non-claims

Not comparable to OLMoE's banked 0.63× (different model). Not an
energy number. Not a correctness/PPL number. Not an app number.
Cell #43's v79 ship-model tg is not a substitute for C; this cell
is the KV-placement isolation that #43 did not do.
