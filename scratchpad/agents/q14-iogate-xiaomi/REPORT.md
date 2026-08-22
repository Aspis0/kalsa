# Gate #14 — expert packing I/O: seq vs random on Xiaomi UFS 4.0

**LABEL (mandatory):** this is the **UFS 4.0 / leading-indicator** datum. The **decision gate for streaming remains S23 / UFS 3.1** (occupied today). Do not treat Xiaomi numbers as the ship/no-ship call.

**Date:** 2026-08-22
**Device:** Xiaomi 14 ("houji"), UFS 4.0, serial `adb-625689a2-9xEOfw._adb-tls-connect._tcp`
**Hard timebox:** 1 hour. Finished in well under 50 min. Device free.
**Scope:** I/O only. **No GPU. No model execution.**

Status: **DONE**.

---

## Protocol

| Item | Value |
|------|-------|
| Block | **983040 B** = 240×4096 ≈ **0.9375 MiB** (4K-aligned stand-in for 0.94 MB expert) |
| Count | **2000** blocks (1,966,080,000 B ≈ 1.83 GiB window at file start) |
| SEQ | consecutive indices 0..1999 |
| RANDOM | **same 2000 indices**, Fisher-Yates shuffle, **seed=14** |
| Order | **S R S R S R** |
| I/O | `pread` + **`O_DIRECT`** (all 6 cells `odirect=1`, rc=0) |
| File | **read-only** (never written) |
| Threshold (UFS 3.1 gate, annotation only) | seq/random **>2×** = packing track pays |

Raw: `results/io_gate/xiaomi_ufs4/`

---

## Tool

`BigMoeOnEdge/tools/iobench.cpp` **not used**: it is a concurrent-lane / scatter duration sweep, not “2000 expert-sized blocks sequential vs shuffled permutation.” Wrote a 120-line C micro-tool instead (`iogate_ufs4.c`). Compiled with NDK `aarch64-linux-android29-clang -O2 -fPIE -pie`. libc-only PIE. Did not link llama.cpp / engine.

| Item | Value |
|------|-------|
| Source | `results/io_gate/xiaomi_ufs4/iogate_ufs4.c` |
| PC SHA256 | `0f4a936d7d11472fa69a2f97ced14e4cdc3d95b5b981ee88044601c1707cca48` (9768 B) |
| Device SHA256 | `0f4a936d7d11472fa69a2f97ced14e4cdc3d95b5b981ee88044601c1707cca48` **match** |
| On-device | `/data/local/tmp/kalsa16/iogate_ufs4` |

---

## File

| Item | Value |
|------|-------|
| Requested path | `/data/local/tmp/kalsa16/Marco-Mini-Instruct-KEXP.gguf` |
| Actual path | **`/data/local/tmp/gdn_750/taskb/Marco-Mini-Instruct-KEXP.gguf`** (requested path absent; did **not** copy or write) |
| Size | **6385238848** B |
| Writes | none |

---

## Environment

| Item | Value |
|------|-------|
| Plugged | **NO** — USB/AC/Wireless all false (I/O session; declared) |
| Battery | 79% → 79% |
| dumpsys temp | 32.9 °C → 32.9 °C |
| quiet_therm | 34152 → 34315 mC |
| gpuss-0 | 35100 → 37400 mC (idle GPU, not our workload) |
| Other device | S23 present on adb, **not touched** |

---

## Results

MB/s = bytes / sec / **1e6**. Window = 2000 × 983040 = 1,966,080,000 B every cell.

| cell | kind | sec | MB/s | MiB/s |
|------|------|----:|-----:|------:|
| 1 | S | 1.382 | 1422.490 | 1356.593 |
| 2 | R | 1.312 | 1498.825 | 1429.390 |
| 3 | S | 0.961 | 2046.336 | 1951.538 |
| 4 | R | 1.274 | 1542.932 | 1471.455 |
| 5 | S | 0.920 | 2137.251 | 2038.241 |
| 6 | R | 1.257 | 1563.520 | 1491.088 |

| | median MB/s (N=3, full precision display 3 dp) | values |
|--|-----------------------------------------------:|--------|
| SEQ | **2046.336** | 1422.490, 2046.336, 2137.251 |
| RANDOM | **1542.932** | 1498.825, 1542.932, 1563.520 |
| SEQ/RANDOM | **1.326×** | vs annotation **2×** |

First SEQ (1422) is the cold tail; later SEQ ~2.05–2.14 GB/s. RANDOM is tight (1.50–1.56). **Not dropped.**

**Annotation vs the UFS 3.1 >2× rule:** 1.326× **does not clear 2×** on this UFS 4.0 0.94 MB-block test. That is an indicator, **not** the streaming ship call.

Caveats (verbatim): 0.94 MB random is still a large I/O; UFS 4.0 + large-block shuffle of a 1.83 GiB prefix is not 4K QD1 random. `iobench` scatter/lanes not measured.

---

## Gaps

- Requested gguf path under `kalsa16/` does not exist; used the existing `gdn_750/taskb/` copy read-only.
- Optional on-device gguf sha skipped (read-only, size matched 6385238848 from session #16).
- No drop_caches (O_DIRECT).

---

## Outcome

UFS 4.0 leading indicator: seq median **2046 MB/s**, random median **1543 MB/s**, ratio **1.33×**. Packing prize looks **small** here relative to the 2× UFS 3.1 threshold. **Gate decision stays on S23/UFS 3.1.** Device free. No GPU. No gguf writes.
