# DEFECT-P LOCALIZATION PROBE (S23)

**Session:** 2026-08-19/20 (localization probe after the shift-first helper fix had zero device effect).
**Repo root:** `C:\Users\gualt\Desktop\Kalsa\moe-experiments`.
**Submodule `BigMoeOnEdge/third_party/llama.cpp`:** branch `kalsa/kernel-s3-repack`; probe commit `bb05e4a0b` (parent `39a0b130f` = the fix). **NO push.**
**Fix under test (FROZEN):** `libggml-opencl.so` sha256 = `69d6d862bd37955bd6edffcc167b59895beec45ede58659945d92b13266d1732` — **must NOT change** (cvt.cl and ggml-opencl.cpp frozen; verify before every run).
**Test exe (NEW):** `test-opencl-moe-roundtrip` = `1e50038be1d264aaccd7d80e9c90b9af9ed1aac78e3eff3a81d128ea64a4d0e1` (adds `pairEEOO` fill mode; raw SoA readback exercised via the existing `GGML_OPENCL_DUMP_Q` backend hook — ggml-opencl.cpp NOT modified).
**Discipline:** adb shell from PC only; `MSYS_NO_PATHCONV=1`; sha256 on-device `.so` before every run (= `69d6d862…`); one process per cell; HOST_REPACK/DUMP_Q/ORACLE presence-only; no git push; report incremental.
**Device:** Galaxy S23 SM-S911U / kalama / Adreno 740, serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. Dir `/data/local/tmp/s3oracle` (recreated fresh; `s3base`/`s3fix`/`s3printf` untouched).
**Logs:** `results/oracle_consumer_s23/defectP_probe/`.

## Motivation (from defectP-fix-verify)

The shift-first rewrite of `trans4_pack_hi`/`trans4_pack_lo` (commit `39a0b130f`) changed the **only code that differs between the bytewise and bitselect arms**, yet the device round-trip was **byte-identical to pre-fix** in both arms. Therefore P lives in the **shared** x0/x1 LOAD or hi-word STORE/assembly — not the pack expressions. Signature hint: `got = (want&0x0F)|0xF0 ≡ want|0xF0` — an OR with 0xF0 during word assembly.

## Step 1 — pairEEOO fill: which qs byte's bit7 gates the corruption?

`pairEEOO`: per block, qs even byte (x0) = EE, qs odd byte (x1) = OO; non-qs = 0x40. q4_0 "as" has 131,072 odd-qs candidates. With a uniform pair fill the gate is either ALL-on (131,072) or ALL-off (0) — clean binary discrimination.

| combo | fill | even(x0) bit7 | odd(x1) bit7 | EVEN-gate pred | ODD-gate pred | EITHER pred |
|---|---|---|---|---|---|---|
| 1 | pair0040 | clear (0x00) | clear (0x40) | 0 | 0 | 0 |
| 2 | pair8040 | **set** (0x80) | clear (0x40) | 131,072 | 0 | 131,072 |
| 3 | pair00C0 | clear (0x00) | **set** (0xC0) | 0 | 131,072 | 131,072 |
| 4 | pair80C0 | **set** (0x80) | **set** (0xC0) | 131,072 | 131,072 | 131,072 |

Decision key: pair8040 dirty → EVEN (or either); pair00C0 dirty → ODD (or either); both dirty → EITHER.

## Step 2 — RAW SoA readback (WRITE vs READ discrimination)

Via `GGML_OPENCL_DUMP_Q=1` (existing backend hook at ggml-opencl.cpp:8498, q4_0-only): after the convert kernel writes `extra->q`, the backend `clEnqueueReadBuffer`s the raw trans4 SoA words and compares against a host-computed contract reference `((x0 & 0xF0) >> 4) | (x1 & 0xF0)`, logging `KALSA_SPLIT low/hi wrong` + `KALSA_DUMP_Q MISMATCH N/total` or `MATCHES (producer is correct)`.
- **raw dirty (bad>0, esp. bad_hi>0)** → convert **WRITE** corrupts the raw storage.
- **raw clean (bad=0) but round-trip dirty** → the **RESTORE READ** of GPU-converted buffers corrupts (then also record cl buffer offsets/alignment of both storages).

Run under lcg default + the most-informative pair combo from step 1.

---

## Results (filled incrementally)

_(appended below)_

## Step 1 results — pairEEOO sweep, q4_0 bytewise (pre-run .so sha = 69d6d862 each)

| combo | fill | E(x0) | O(x1) | q4_0 mismatch | class | mismatch_bit7clear | clean_odd_bit7set | got (odd qs) |
|---|---|---|---|---|---|---|---|---|
| 1 | pair0040 | 0x00 (b7 clear) | 0x40 (b7 clear) | **0** | clean | 0 | 0 | — |
| 2 | pair8040 | 0x80 (b7 **set**) | 0x40 (b7 clear) | **131,072** | odd_qs_hi_to_f | 131,072 | 0 | 0x40 → 0xF0 |
| 3 | pair00C0 | 0x00 (b7 clear) | 0xC0 (b7 **set**) | **0** | clean | 0 | 131,072 | — |
| 4 | pair80C0 | 0x80 (b7 **set**) | 0xC0 (b7 **set**) | **131,072** | odd_qs_hi_to_f | 0 | 0 | 0xC0 → 0xF0 |

WANT/GOT blk0 (pair8040): `40 40 80 40 80 40...` → `40 40 80 f0 80 f0...` (even qs 0x80 unchanged; odd qs 0x40 → 0xF0). off_mis = odd-qs positions [3,5,7,9,11,13,15,17] × 16,384 = 131,072. pair80C0: want `40 40 80 c0...` → got `40 40 80 f0...` (0xC0 → 0xF0).

**Verdict (decision key): pair8040 DIRTY + pair00C0 CLEAN → EVEN gates.** The corruption fires iff bit7 of the **EVEN partner byte x0** (the even qs byte, qs[2k]) is SET. This **confirms the defectP corrected model** (maxrecall-puzzle Task 4: trigger = bit7 of even partner x0, not the same-position odd byte). The same-position odd-byte bit7 is only a proxy: pair8040 (odd=0x40, b7 clear) still fires 131,072 (all mismatches have odd-b7 clear → mismatch_bit7clear=131,072); pair00C0 (odd=0xC0, b7 set) is CLEAN (clean_odd_bit7set=131,072) even though the odd byte has bit7 set — proving the odd byte's bit7 does NOT gate. got = `(want_odd & 0x0F) | 0xF0` exactly.

Most-informative combo for step 2 = **pair8040** (even-b7 set, odd-b7 clear — isolates the even gate, got=0xF0).

## Step 2 results — RAW SoA readback (GGML_OPENCL_DUMP_Q=1), bytewise (pre-run .so sha = 69d6d862 each)

The existing backend hook (ggml-opencl.cpp:8498, q4_0-only, **NOT modified**) reads back `extra->q` (the raw trans4 SoA words the convert kernel wrote) and compares against a host-computed contract reference `((x0 & 0xF0) >> 4) | (x1 & 0xF0)`, logging `KALSA_SPLIT low/hi words wrong` + `KALSA_DUMP_Q MISMATCH bad/total first@N got=.. want=..`.

| run | fill | KALSA_SPLIT (lo / hi wrong) | KALSA_DUMP_Q raw | first got / want | roundtrip q4_0 |
|---|---|---|---|---|---|
| 2a | lcg | **0 / 18,688** | MISMATCH 18,688/65,536 (28.5%) first@1025 | got=`fdfdfcfc` want=`5d5d5c4c` | 65,536 |
| 2b | pair8040 | **0 / 32,768** | MISMATCH 32,768/65,536 (50.0%) first@1024 | got=`f8f8f8f8` want=`48484848` | 131,072 |

**Raw storage is DIRTY in both runs — exclusively in HIGH-nibble words** (bad_lo = 0, bad_hi = 18,688 / 32,768). The raw `got` bytes carry the **exact defect signature `got = (want & 0x0F) | 0xF0`**:
- pair8040: want hi-word byte = `0x48` (lo nibble 0x8 = x0=0x80's high nibble; hi nibble 0x4 = x1=0x40's high nibble) → got = `0xF8` (lo nibble 0x8 preserved; hi nibble forced to 0xF). `(0x48 & 0x0F)|0xF0 = 0xF8` ✓.
- lcg: want = `5d 5d 5c 4c` → got = `fd fd fc fc`; each byte `(b & 0x0F)|0xF0` ✓.

**WRITE-vs-READ discrimination: convert WRITE corrupts.** The raw trans4 SoA storage the convert kernel wrote is already wrong (hi-word byte's high nibble forced to 0xF when x0's bit7 is set) — so the restore READ is **innocent**: it faithfully inverts the (already-dirty) storage to the (dirty) AoS, producing the round-trip `got=(want&0x0F)|0xF0`. The raw-clean-but-roundtrip-dirty (RESTORE READ) case did **not** occur, so the buffer-offset/alignment recording clause (task step 2) is **moot**.

**Count consistency (pair8040):** 32,768 wrong hi-words × 4 bytes = 131,072 wrong hi-word bytes → 131,072 round-trip mismatches. Exact (all even qs = 0x80 → all hi-word bytes wrong). lcg's 18,688 wrong hi-words (57% of 32,768 hi-words) reflects LCG-structured correlation of x0-bit7 within each 4-byte word (consecutive even-qs values differ by 6 mod 256, so bit7 is not independent across the 4 pairs in a word) — consistent with the even-bit7 gate; the 65,536 round-trip count = 65,536 wrong hi-word bytes (half of 131,072), matching the even-bit7-set fraction.

## One-line localization

**P is in: convert WRITE.**

The defect lives in the **producer (`kernel_convert_block_*_trans4_ns`) WRITE path** — specifically the hi-word byte store/assembly that ORs `0xF0` into the high nibble when bit7 of the even partner byte x0 is set (`got = (want & 0x0F) | 0xF0` in the raw trans4 SoA). The shift-first helper rewrite (commit 39a0b130) had zero effect because the corruption is **not** in the `trans4_pack_hi` mask-then-shift expression (the lo nibble of the hi-word byte is computed correctly; the `x1 & 0xF0` high-nibble term is the part being forced to 0xF0, gated by x0's bit7 — a cross-byte effect impossible from the pack expression alone, pointing to the shared x0/x1 LOAD or the hi-word STORE/assembly). The restore READ-of-GPU-buffers is **innocent** (raw storage is already dirty; HOST_REPACK round-trip=0 because the host producer writes contract-correct storage; e2e PASS is self-consistency on the same dirty storage).

## Does this contradict the standing hypotheses?

**No — it confirms them and sharpens the site.** The defectP corrected model (maxrecall-puzzle Task 4: trigger = bit7 of even partner x0 SET) is **confirmed** by step 1 (EVEN gates, exactly). The convert-vs-restore split is **resolved** by step 2 (WRITE corrupts; raw dirty). The only update to the model: the residual after the helper fix is the shared LOAD of x0 (sign-extension into the hi nibble) or the hi-word STORE/assembly (OR-with-0xF0) — NOT the pack expression. Designed next step (single-pair probe + convert-buffer dump vs CPU ref + feed pre-transposed ref into gemv) is the follow-up to separate LOAD-sign-extension from STORE-OR; not run here.

## Discipline / chain-of-custody

- `cvt.cl` and `ggml-opencl.cpp` **NOT modified** (frozen); on-device `libggml-opencl.so` == `69d6d862…` verified pre-run on every cell (step1 ×4, step2 ×2). New test exe `1e50038b…` (commit `bb05e4a0b`, pair-fill + DUMP_Q orchestration). No git push.
- HOST_REPACK/DUMP_Q presence-only; DUMP_Q set only for step 2 (inline, unset after); ORACLE never set. CVT_VARIANT=bytewise throughout (step 1+2); bitselect not re-run (bytewise already localizes to the shared WRITE, common to both arms).
- Logs: `results/oracle_consumer_s23/defectP_probe/step1_pair*_bytewise.log`, `step2_*_dumpq.log`.
