# q30 — Hexagon HTP smoke on Xiaomi 14 (retail v75)

**Timebox:** 12 min on-device; finished in ~1 min wall. Device free. No model.
**Device:** Xiaomi 14 houji, serial `adb-625689a2-9xEOfw._adb-tls-connect._tcp`
**Work dir:** `/data/local/tmp/kalsahtp` (left in place)
**S23:** not touched.

**Verdict: REGISTRA+DICHIARA**

Raw: `results/htp_smoke/xiaomi_v75/`

---

## Docs / env (q28 saved README + developer.md)

From `scratchpad/agents/q28-hexagon-sdk/upstream-docs/`:

- Backend name in test-backend-ops: **`HTP0`** (`-b HTP0 -o MUL_MAT`)
- `LD_LIBRARY_PATH` = CPU `.so` dir
- `ADSP_LIBRARY_PATH` = same dir so FastRPC finds **`libggml-htp-vNN.so`** (`file:///libggml-htp-v75.so?...&_dom=cdsp`)
- Also set `CDSP_LIBRARY_PATH` to the same (not in the snippet; FastRPC on CDSP)
- `GGML_HEXAGON_NDEV=1`
- `GGML_HEXAGON_HOSTBUF=1` required for MUL_MAT tests
- `GGML_HEXAGON_VERBOSE=1` for run 1

Used all of the above. `LD_LIBRARY_PATH` also includes `/vendor/lib64` for `libcdsprpc.so`.

---

## SHA (device vs MANIFEST)

Build: `build-android-hexagon`, upstream `3f545be`, MANIFEST 2026-08-22T17:19:57.

| file | sha256 (PC MANIFEST = device) |
|------|-------------------------------|
| test-backend-ops | `a254c6be99c5d9807b46091f53fc408023dfac5cb9aaf79305d457f1218ea6f4` |
| libggml-hexagon.so | `f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448` |
| libggml-htp-v75.so | `46d3ac923988f20b75d6d3489eea0e1432aa275aaff61c39253e170c17729182` |
| libggml.so | `2c7e4fe18df856f136dc6f899b50f33f3ea7103c563bb0aab0d587fe75a57ded` |
| libggml-base.so | `e5565847e40a510ea5a1b47ba713344d0d8a97e60f2f0b3f0278fe1a6dc9e5b4` |
| libggml-cpu.so | `65faaee251cdf01660427e1204df020eef827023f31998d45c9d6256fb0598af` |
| libllama.so | `1538010abebf249ddaccfa44e1c1d22b995c6174c5b62d434e471daa80a291ab` |

Match: **YES** (all listed). Also pushed NDK `libomp.so` + `libc++_shared.so` (not in MANIFEST).

---

## Battery

Unplugged. **70%**, 31.2 °C start = 31.2 °C end. Correctness session, not speed.

---

## Run 1 — registration

`test-backend-ops test -b HTP0 -o ADD`, wall **8.3 s**, rc=1 (ADD 73/75, 2 f16 FAIL — not the gate).

**FastRPC / DSP: SUCCESS. Protection domain was NOT denied.**

Verbatim header (`run1.err`):

```
ggml-hex: Loading driver libcdsprpc.so
ggml-hex: Hexagon backend (experimental) : allocating new registry : ndev 1
ggml-hex: Hexagon Arch version v75
ggml-hex: HTP0 allocating new session
ggml-hex: HTP0 hwinfo: threads 4, hvx 4, hmx 1, vtcm 8 MB
ggml-hex: HTP0 new session : session-id 0 domain-id 3 uri file:///libggml-htp-v75.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0 handle 0xb400006f5d021d90
```

`test-backend-ops` listing:

```
Testing 2 devices
Backend 1/2: HTP0
  Device description: Hexagon
  Device memory: 0 MB (0 MB free)
```

(memory printed 0 MB; session still opened.) ADD: 73/75 passed; 2 f16 cases FAIL (`ERR ~1.3e-7 > 1e-7`). CPU skipped.

No FastRPC/PD denial string in the log.

---

## Run 2 — MUL_MAT

`test-backend-ops test -b HTP0 -o MUL_MAT`, wall **35.4 s**, **completed** (no 10 min kill). rc=1.

| | n |
|--|--:|
| OK | **486** (all **f16** 275 + **f32** 211) |
| FAIL | **70** (q4_0 15, q4_1 14, q8_0 16, mxfp4 13, iq4_nl 12) |
| not supported | **1007** (bf16, q*_K, q5_0/1, iq2/3, …) |

Typical FAIL text (quantized, first q4_0):

```
[MUL_MAT] NaN at index 0 (HTP0=7.420369 CPU=nan)   MUL_MAT(type_a=q4_0,type_b=f32,m=16,n=1,k=256,...): FAIL
```

HTP0 often returns a finite number; CPU side of the compare is `nan`/`inf`. Also some `ERR = 1e11`. **Not** a FastRPC open failure — session already live; this is op-correctness vs CPU.

q2_K/q3_K/q4_K/q5_K/q6_K: **not supported** on HTP0 (skip), not FAIL.

No kill. Logs: `run2.out` 210186 B, `run2.err` 3.17 MB.

---

## Verdict

**REGISTRA+DICHIARA**

Retail Xiaomi 14 / SM8650 **v75** Hexagon CDSP:

1. `libcdsprpc.so` loads
2. Arch **v75** detected, skel `libggml-htp-v75.so` session `_dom=cdsp` **opens**
3. hwinfo: 4 threads, 4 HVX, 1 HMX, 8 MB VTCM
4. Backend name **HTP0** appears in `test-backend-ops`
5. Dense f16/f32 MUL_MAT **runs and many pass**; quantized MUL_MAT that HTP claims, **fail the CPU compare** (NaN on CPU side of the harness)

Firmware did **not** refuse the PD. Gate question “does Hexagon come up on a retail phone?” → **yes**.

No leftover `test-backend-ops`. Files remain in `/data/local/tmp/kalsahtp`.
