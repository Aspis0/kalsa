# q31 — S23 session: UFS 3.1 packing gate + HTP v73 + 4B prefill

**Target:** Galaxy S23 (SM-S911U / dm1q / Adreno 740 / UFS 3.1 / Hexagon **v73**)
**Serial:** `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`
**Do not touch:** Xiaomi (`adb-625689a2-9xEOfw…`), Jelly (`192.168.1.82:35785`). Present on `adb devices`, unused.
**Budget:** ~60 min, three phases. Battery floor **40%**. Plugged/unplugged declared in every table.

Status: **IN PROGRESS** — Phase 1 DONE (gate closed). Phase 2 DONE (PD granted + CPU=nan isolated). Phase 3 next.

---

## Battery at session start

| Item | Value |
|------|-------|
| Device | S23 `SM_S911U` / `dm1q` |
| Plugged | **NO** — AC=false USB=false Wireless=false Dock=false |
| Level | **83%** |
| Temp | 26.8 °C (`temperature: 268`) |
| Status | 3 (discharging) |
| Floor | 40% — OK to proceed |

Raw: `results/io_gate/s23_ufs31/batt_pre.txt`

`df /data`: **6.2G free** (PLAN said ~21G — that is stale).

---

## Phase 1 — expert-packing I/O gate on UFS 3.1

Raw: `results/io_gate/s23_ufs31/`

Status: **DONE. GATE CLOSED.**

Xiaomi UFS 4.0 reference: seq/random **1.33×**. This S23 number **is the decision gate**.

### Protocol (exact replica of Xiaomi)

| Item | Value |
|------|-------|
| Block | **983040 B** = 240×4096 |
| Count | **2000** blocks (1,966,080,000 B) |
| SEQ | consecutive indices 0..1999 |
| RANDOM | same 2000 indices, Fisher-Yates, **seed=14** |
| Order | **S R S R S R** |
| I/O | `pread` + **`O_DIRECT`** (all 6 cells `odirect=1`, rc=0) |
| File | **read-only** (never written) |
| Threshold | seq/random **>2×** = packing track alive |

### Tool

| Item | Value |
|------|-------|
| Source | `results/io_gate/xiaomi_ufs4/iogate_ufs4.c` (copied to `s23_ufs31/`) |
| Compile | NDK `aarch64-linux-android29-clang -O2 -fPIE -pie` (this session) |
| PC SHA256 | `0f4a936d7d11472fa69a2f97ced14e4cdc3d95b5b981ee88044601c1707cca48` (9768 B) |
| Device SHA256 | **match** |
| On-device | `/data/local/tmp/kalsaio/iogate_ufs4` |

### File

| Item | Value |
|------|-------|
| Path | `/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf` |
| Size | **3326160384** B |
| Device SHA256 | `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4` |
| Writes | none |

### Environment

| Item | Value |
|------|-------|
| Plugged | **NO** — USB/AC/Wireless all false |
| Battery | 83% → 83% |
| dumpsys temp | 26.8 °C → 26.9 °C |
| Other devices | Xiaomi + Jelly listed, **not touched** |

### Results

MB/s = bytes / sec / **1e6**. Window = 2000 × 983040 = 1,966,080,000 B every cell.

| cell | kind | sec | MB/s | MiB/s | rc | plugged |
|------|------|----:|-----:|------:|---:|---------|
| 1 | S | 4.780 | 411.284 | 392.231 | 0 | NO |
| 2 | R | 4.511 | 435.851 | 415.660 | 0 | NO |
| 3 | S | 4.343 | 452.654 | 431.684 | 0 | NO |
| 4 | R | 4.835 | 406.625 | 387.788 | 0 | NO |
| 5 | S | 4.570 | 430.223 | 410.293 | 0 | NO |
| 6 | R | 5.292 | 371.546 | 354.334 | 0 | NO |

| metric | S23 UFS 3.1 | Xiaomi UFS 4.0 |
|--------|-------------|----------------|
| seq median MB/s | **430.223** | 2046.336 |
| rand median MB/s | **406.625** | 1542.932 |
| **seq/rand** | **1.058×** | 1.326× |
| threshold | 2.0 | 2.0 |
| **clears 2×** | **NO** | NO |

**Gate decision:** packing track **closed** on the decision device. UFS 3.1 at 0.94 MB blocks is seq≈rand (first seq cell was even *slower* than first rand). The 4.0 1.33× leading indicator was not a UFS-generation artifact that would flip on 3.1 — 3.1 is **more** sequential-random equal, not less.

---

## Phase 2 — HTP v73 retail + CPU-NaN isolation

Raw: `results/htp_smoke/s23_v73/`

Status: **DONE. REGISTRA+DICHIARA.** OneUI retail **grants** the PD on S23 v73 (same as Xiaomi v75). Quantized MUL_MAT FAILs with `CPU=nan` **on both devices** — harness CPU judge, not HTP.

### SHA vs MANIFEST (`build-android-hexagon`, upstream `3f545be`)

| file | sha256 PC = device |
|------|---------------------|
| test-backend-ops | `a254c6be…8ea6f4` |
| llama-bench | `5db18906…d38507` |
| libggml-hexagon.so | `f06aa309…dea6448` |
| libggml.so | `2c7e4fe1…a57ded` |
| libggml-base.so | `e5565847…dc9e5b4` |
| libggml-cpu.so | `65faaee2…fb0598af` |
| libllama.so | `1538010a…0a291ab` |
| **libggml-htp-v73.so** | `c8f9d14a…125edd5` |

Match: **YES**. v75 **not** pushed. On-device: `/data/local/tmp/kalsahtp`. NDK `libomp.so` + `libc++_shared.so` also pushed (not in MANIFEST).

Env (same as q30): `LD_LIBRARY_PATH=/data/local/tmp/kalsahtp:/vendor/lib64:/system/vendor/lib64:/system/lib64`, `ADSP_LIBRARY_PATH`=`CDSP_LIBRARY_PATH`=`/data/local/tmp/kalsahtp`, `GGML_HEXAGON_NDEV=1`, `GGML_HEXAGON_HOSTBUF=1`, `GGML_HEXAGON_VERBOSE=1`.

### Battery (phase 2)

| Item | Value |
|------|-------|
| Plugged | **NO** |
| Level | 83% |
| Temp | 26.5 °C at run1 start |

### Registration (run1 ADD)

Wall ~30 s, rc=1. **PD GRANTED.**

Verbatim hwinfo (`results/htp_smoke/s23_v73/hwinfo.txt` / `run1.err`):

```
ggml-hex: Loading driver libcdsprpc.so
ggml-hex: forcing ndev to 1 for SoCs archs lower than v75.
ggml-hex: Hexagon backend (experimental) : allocating new registry : ndev 1
ggml-hex: Hexagon Arch version v73
ggml-hex: HTP0 allocating new session
ggml-hex: failed to get URI for session 0 : error 0x14. Falling back to single session URI: file:///libggml-htp-v73.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp
ggml-hex: HTP0 hwinfo: threads 4, hvx 4, hmx 1, vtcm 8 MB
ggml-hex: HTP0 new session : session-id 0 domain-id 3 uri file:///libggml-htp-v73.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp handle 0xb400007484212d40
```

`test-backend-ops` listing: Backend HTP0 / Device description: Hexagon / Device memory: 0 MB. ADD **74/75** (1 f16 FAIL `ERR = 1.36e-7 > 1e-7`). Xiaomi was 73/75.

Note vs Xiaomi: S23 logs `forcing ndev to 1 for SoCs archs lower than v75` and URI error `0x14` (no `_session=0`). Session still opens. No PD-denied string.

### MUL_MAT (run2) vs Xiaomi v75

Wall 138 s, rc=1, completed. Counts **identical** to Xiaomi `results/htp_smoke/xiaomi_v75/run2.out`:

| | S23 v73 | Xiaomi v75 |
|--|--------:|----------:|
| OK | **486** (f16 275 + f32 211) | 486 |
| FAIL | **70** (q4_0 15, q4_1 14, q8_0 16, mxfp4 13, iq4_nl 12) | 70 |
| not supported | **1007** | 1007 |
| tests passed | 486/556 | 486/556 |

First FAIL dumps (S23, ANSI stripped) — HTP0 finite, **CPU=nan**:

```
[MUL_MAT] NaN at index 2 (HTP0=4.324828 CPU=-nan)   MUL_MAT(type_a=q4_0,type_b=f32,m=16,n=1,k=256,...): FAIL
[MUL_MAT] ERR = 1888759149.959026337 > 0.000500000   MUL_MAT(type_a=q4_0,type_b=f32,m=16,n=2,k=256,...): FAIL
[MUL_MAT] NaN at index 3 (HTP0=3.152467 CPU=-nan)   MUL_MAT(type_a=q4_0,type_b=f32,m=16,n=3,k=256,...): FAIL
[MUL_MAT] NaN at index 7 (HTP0=5.422234 CPU=nan)   MUL_MAT(type_a=q4_0,type_b=f32,m=16,n=4,k=256,...): FAIL
```

`fail_cpu_nan=44` of 70 FAILs (rest huge ERR). Isolation: **same build, same CPU=nan on two SoCs** → giudice CPU del harness, non HTP.

---

## Phase 3 — Qwen3.5-4B pp512 HTP vs CPU

Status: **pending** (starting now). Battery 83% > 40%. Space: 6.2G free; 4B GGUF ~2.3G — fits.

---

## Gaps

- PLAN `df ~21G` is stale; 6.2G free.
- Phase 3 not started at this write.

---

## Outcome

Phase 1: **1.058× < 2× — packing closed.**
Phase 2: **PD granted on OneUI retail v73. CPU=nan isolated as harness.**

