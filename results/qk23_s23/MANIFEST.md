# qk23 S23 — S1 storage + S2 dequant oracle

**Device:** SM_S911U Adreno 740, TLS `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (unplugged). `/data/local/tmp/s3oracle`. `s3base`/`s3fix`/`s3printf` untouched.

**Battery (first contact):** level **87%**, USB/AC powered false, temperature 27.2 °C. Not below 30%.

**Compiler:** E031.41.03.62.

## Binaries (PC == device)

| artifact | sha256 | bytes |
|---|---|---:|
| S1-fix `libggml-opencl.so` (roundtrip-only run) | `226bd6594fe9418058afc2cd4d33f45213b40743079afd2b79d97737d8d2c458` | 8197472 |
| S2 `libggml-opencl.so` (oracle+roundtrip run) | `0abd77a106632ffd45eb3ffdb4061c443a3f1aa3a4f7cbd7dbe6ad5410fe95e3` | 8241416 |
| S2 `test-opencl-moe-roundtrip` | `27ae6fa261f51ceefe2ebcbb0be717fdda7de23345c6ac4ed8b656b06e757054` | 143312 |

Env: `HOST_REPACK`/`DUMP_Q`/`GGML_OPENCL_ORACLE` unset. `GGML_OPENCL_LOG_WEIGHT_PATH=1`. Oracle run also `GGML_OPENCL_QK23_ORACLE=1`.

## S1 roundtrip (`roundtrip_s1.log`)

`DONE rc=0`. All `class=clean`, mismatch=0:

- Existing 8 `"as"` types (q4_0, q4_1, q5_0, q5_1, mxfp4, q4_K, q5_K, q6_K)
- q2_K / q3_K `"as"` 256×512×4 trans4-moe
- q3_K `"as"` **1792×64×4** (odd super-blocks)
- q2_K / q3_K `const00`
- q3_K `hmask16`
- `"weight"` q2_K, q3_K (generic, not SoA) + q4_0 dense controls

**Roundtrip does not certify convert layout** (convert∘restore identity). Storage-level: no Adreno miscompile/alignment fail on these fills.

## S2 oracle (`oracle_s2.log`)

`ORACLE_QK23` vs CPU `dequantize_row_q2_K` / `q3_K`. Launch `{16,1,1}`. ε = max(1e-6, 4*FLT_EPSILON*|cpu|). All lines `nfail=0,max_abs=0`:

- q2_K 256×512×4: E0/E1/E2/E4 (n_sb=1, no E3)
- q3_K 256×512×4: same + const00 + hmask16 (d=fp16 1.0)
- q3_K 1792×64×4: **sb=1 odd** and sb=6 last (E3+E4)

`DONE rc=0`. This **is** the layout/consumer unpack check.

`supports_op` still does not list Q2_K/Q3_K. No GEMV/GEMM compute kernels.

---

# S4 — supports_op flip + device battery (2026-08-21)

**Contact:** TLS only (`adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`). USB serial not attached. **Unplugged** (AC/USB/wireless powered false). Battery first S4 contact **85%**, 26.8 °C. Smoke **83%**, 34.0 °C after MUL_MAT. Not &lt;30%. MemAvailable before LFM 5040 MB, after 5399 MB (no ≥2 GB cliff).

**LFM gguf:** already at `/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf` (not under s3oracle). Device sha `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4` matches `results/oomwall_s23/MANIFEST.md`. **Not** Mellum2 `b04281c2…`. 1.8 G free — no re-push. `s3base`/`s3fix`/`s3printf` untouched.

## S4 binaries (PC == device)

| artifact | sha256 | bytes |
|---|---|---:|
| `libggml-opencl.so` | `ed60d804c490e5d3b2111b6e775a354f87ca3839cc72a089336568db1bf37fb0` | 8362880 |
| `libggml-base.so` | `fa7937e711d079bcef88def0d3c1792e9fe1499f783ece268609d0dc8ea08b0a` | 6103512 |
| `test-backend-ops` | `a1278b8e54608342b41a51d4ec6054b09fe85478609fc09a6431adcc96d6ae7f` | 10170440 |
| `test-opencl-moe-roundtrip` | `27ae6fa261f51ceefe2ebcbb0be717fdda7de23345c6ac4ed8b656b06e757054` | 143312 |
| noextra `libllama-bench-impl.so` | `d2030f23db3b4f62f6934c9de831050e71e87c7cfda6e5059d53099ec8b60346` | 4240160 |

Env: never `HOST_REPACK` / `DUMP_Q`. MUL_MAT_ID + LFM: `GGML_OPENCL_LOG_KERNELS=1`. Roundtrip+oracle: `LOG_WEIGHT_PATH=1` `QK23_ORACLE=1`.

## a. MUL_MAT_ID (`s4_mmid.out` / `.err`)

**399/399 PASS**, rc=0. Baseline 391 + 8 new Q2_K/Q3_K (all_types GEMM, other_types GEMV+GEMM, two m=96). Per-type OK:

| type | OK |
|---|---:|
| q4_K | 80 |
| q5_K | 4 |
| q6_K | 3 |
| q2_K | 4 |
| q3_K | 4 |
| q4_0 | 74 |
| q4_1 | 75 |
| q5_0 | 3 |
| q5_1 | 3 |
| q8_0 | 75 |
| mxfp4 | 74 |

m=96 poison both **OK**. LOG_KERNELS: `kernel_{gemv,gemm}_moe_q{2,3}_k_f32_ns` (and family). No `_ila`.

## b. No-regression

- MUL_MAT (`s4_mm.out`): **915/925**, 10 FAIL all `q6_K` dense flat `m=16` n=1..9 + repeat. Unchanged. rc=1 from known fails.
- Roundtrip (`s4_rt_oracle.out`): all `class=clean` mismatch=0. **Fill-mode labeling:** the strings `const00` / `hmask16` do **not** appear in S1/S2/S4 logs (`ROUNDTRIP_FILL` is printed once at startup with env unset → `resolved=lcg`). The fills **did** run: `main()` calls `run_with_fill(..., "const00")` twice then `hmask16` immediately after the 1792 odd case. Ordinal map (same in `roundtrip_s1.log`, `oracle_s2.log`, `s4_rt_oracle.out`): after `as q3_K 1792x64x4`, next `as q2_K 256x512x4` = const00, next `as q3_K 256x512x4` = const00, next `as q3_K 256x512x4` = hmask16. Labeled log: `s4_rt_fill.out`.
- Oracle (`s4_rt_oracle.err`): every pair `nfail=0 max_abs=0` including q3 `ne=1792x64x4` **sb=1**.

## c. LFM2.5-KEXP production smoke (`s4_lfm.out` / `.err`)

noextra impl, `-fa off -ngl 99 -t 4 -p 128 -n 64 -r 1`. Unplugged correctness smoke, not a speed cell.

- load OK, rc=0
- `n_gpu_layers=99`, **`n_cpu_moe=0`** (experts on GPU)
- `flash_attn=0`
- pp128 **60.26 t/s**, tg64 **15.09 t/s**
- LOG_KERNELS: `kernel_gemm_moe_q2_k_f32_ns`, `kernel_gemm_moe_q3_k_f32_ns`, `kernel_gemv_moe_q2_k_f32_ns`, `kernel_gemv_moe_q3_k_f32_ns` + router (`histogram/scan/fill/scatter/reorder_b`)

## d. Optional llama-completion (`s4_cli.out`)

64 tokens, `-ngl 99 -fa off --temp 0`. Prompt "The capital of France is" → think-block then **Paris**. Coherent. `--no-extra-bufts` not a completion flag (first attempt rc=1, retry without).

**LFM JSONL `build_commit`:** the smoke JSONL says `"build_commit": "c8f4fc05e"`. That string is baked into `libllama-bench-impl.so` (noextra `d2030f23…`) at **cmake configure time**. It is not the kernel tree. Authoritative pin for this smoke is `libggml-opencl.so` sha `ed60d804…` (S3+S4 kernels + `supports_op`). Do not treat the JSONL commit as the qk23 HEAD.

---

## Follow-up — GEMM m=96 n=4 (C3 close) (`s4_gemm96.out` / `.err`)

Unplugged, battery 81–82%, 30–33 °C. `test-backend-ops` `21d6110dc147adf249505a9808fc36075eb58b02e688366a112d02629c58bdb1`. opencl still `ed60d804…`.

**401/401 PASS**, rc=0. New cases (type-scoped, no m=96 on other types):

```
MUL_MAT_ID q2_K m=96 n=4 k=256 → OK
MUL_MAT_ID q3_K m=96 n=4 k=256 → OK
```

LOG_KERNELS includes `kernel_gemm_moe_q2_k_f32_ns` and `kernel_gemm_moe_q3_k_f32_ns`. C3 padding immunity now device-proven for **GEMV (n=1) and GEMM (n=4)** on m=96.

q2_K OK **5**, q3_K OK **5**. Other types unchanged vs 399.

## Follow-up — fill labels (`s4_rt_fill.out` / `.err`)

Harness now prints `fill=` on every `ROUNDTRIP` line. Device `test-opencl-moe-roundtrip` `bb557da8b1b4a7c3b8cc14c99762d18eeeb4f5662f1d272d0c14ee3a2af3f075`. `DONE rc=0`.

| fill | line (s4_rt_fill.out) | result |
|---|---|---|
| const00 q2_K as 256x512x4 | 25 | class=clean mismatch=0 |
| const00 q3_K as 256x512x4 | 27 | class=clean mismatch=0 |
| hmask16 q3_K as 256x512x4 | 29 | class=clean mismatch=0 |

Oracle: corresponding extra `nfail_all=0` blocks in `s4_rt_fill.err` (including the last q3 256x512x4 dump = hmask16).

## Follow-up — Angle B cleanup roundtrip (`s4_rt_cleanup.out` / `.err`)

After env save/restore + comment-only cvt.cl. `libggml-opencl.so` `50dd126d1a467b74c08ee6171c3d6586d0a1563d468a92c2c0406a37e98c6ac5`. `test-opencl-moe-roundtrip` `dfe2464cd4de49a518fc6e5c2c98f71230946868a4d242c234f4b9ef4c130afe`. PC==device. `DONE rc=0`. `fill=const00` / `fill=hmask16` class=clean. Oracle `nfail_all=0`.

**Tag:** `kalsakernel-v4` = `ec7235af687137bb85d8541b027e0c6a01583c1a`. Bundle `backups/kalsakernel-v4.bundle`.
