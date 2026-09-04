# Cell #60 step 0 — static resolution of the cDSP abort in cell #59 (Mac-side, 0 QDC minutes)

Date: 2026-09-04 early morning. Input: cell #59 raw (qdc-8g2-npu-v73death-59/raw/),
kit-v6 `lib-fix/libggml-htp-v73.so` (the exact skel that ran; SHA in npu-kit-59 SHA256SUMS),
Hexagon toolchain 19.0.07 from the Docker image `ghcr.io/snapdragon-toolchain/arm64-android:v0.7`
(`/opt/hexagon/6.6.0.0/tools/HEXAGON_Tools/19.0.07/Tools/bin/hexagon-llvm-objdump`).

## What the #59 logcat already said (raw/logcat_exp_pp16_nohostbuf_sa802553.txt, `adsprpc` V lines)

```
Process "/frpc/f04342f0 llama-bench" crashed in thread "" because Application called qurt_exit()
Call trace :
[<00D26AFC>] qurt_exception_raise_nonfatal+0x1C:     (_rtld_anonymous)
[<00DA46AC>] raise+0xFC:     (fastrpc_shell_unsigned_3)
[<00D8AC80>] abort+0x8:     (fastrpc_shell_unsigned_3)
[<20203E58>] htp_iface_start+0x1348:     (./libggml-htp-v73.so)
```
followed on the host by `dspqueue_cpu.c:1018 error 0x2e (dspsignal_wait)` and
`dspqueue_notif_callback ... status 3` (PD crashed), then `ggml-hexagon.cpp:1552 dspqueue_read failed: 0x2e`.
So the host `0x2e` is the SYMPTOM of a DSP-side `abort()`; the fault is in the skel, not in
the host flush path and not in the DSP firmware. Same shape as the S23 F2b block
(`htp_iface_stop+0x12E8`, thread htp-main, different binary).

## Resolving `htp_iface_start+0x1348`

`hexagon-llvm-objdump -T` : `htp_iface_start` = 0x2b10, size 0x4ac (ends 0x2fbc). The offset
0x1348 lands at 0x3E58 — OUTSIDE the function: the crash reporter names the nearest exported
symbol; the code belongs to a static function (stripped). 0x3E58 is the return address of
`3e54: call abort@plt`. Disassembly of the cold block (`-d --start-address=0x3d90 --stop-address=0x3ed0`):

```
3e30: r1 = add(pc,##0x9f474)      ; -> 0xA32A8 ~ "/workspace/ggml/src/ggml-hexagon/htp/main.c" (strings -t x: a32a4)
3e3c: r3 = add(pc,##0x9f5de)      ; -> 0xA341E ~ "mmap failed : va %p fd %u size %u"           (strings -t x: a341a)
3e44: r2 = #0x2d9                 ; = 729 = __LINE__
3e48: memw(r29+#0x8) = r4         ; size
3e4c: call HAP_debug_v2@plt       ; FARF(ERROR, ...)
3e50: memw(r29+#0x0) = #-0x1      ; va = (void*)-1
3e54: call abort@plt              ; <- crash site, return addr 0x3e58
```
Six `abort@plt` calls sit in this block (0x3e08/0x3e2c/0x3e54/0x3e74/0x3ea0/0x3ec0) with line
constants 0x2d9=729, 0x2d2=722, 0x124=292: they are the cold tails of `mmap_buf()` (static
inline, instantiated more than once) and `vtcm_acquire()`.

**Verdict of step 0: the cDSP abort is `htp/main.c:729` — `mmap_buf()`: `HAP_mmap(NULL, b->size,
READ|WRITE, 0, b->fd, 0)` returned -1 for a weight buffer referenced by an op, and the v73 path has
no fallback but `abort()`.** The v75+ path (`#if __HVX_ARCH__ > 73`) uses `HAP_mmap2` instead
(introduced by upstream #21705 "improved Op queuing, buffer and cache management"). `HAP_mem.h`:
`HAP_mmap(void*, int len, ...)` (32-bit length, hence the 2 GB guard at :722) vs
`HAP_mmap2(void*, size_t len, ...)`.

## What the host log adds (raw/exp_pp16_nohostbuf_sa802553.err)

8 `HTP0 mapped buffer` lines, total 3.57 GiB: sizes 1028657152 ×2, 1019219968, 698355712,
33558528, 12326912, +2 small. `opt_mbuf` default = 1 GiB (`GGML_HEXAGON_MBUF`, in MiB).
All 16 layers' experts (`HTP0-REPACK model buffer size = 3600.02 MiB`) are on HTP0; the skel
maps each buffer lazily on first use (`mmap_buf`), never unmaps (no eviction; `HTP_MAX_MMAPS`=16
slots; a 17th buffer would silently stay unmapped -> garbage base -> the S23 q50 TLBMISS shape).

## Hypotheses to discriminate on-device (PREREG.md)

- H1 cumulative VA budget: the user PD on v73 is a 32-bit address space; ~3.7 GiB of
  mappings cannot fit; the N-th ~1 GiB `HAP_mmap` fails. Prediction: fewer expert layers on
  HTP (`-ngl 8`, ~1.8 GiB) survives with proof; smaller buffers at the same total (`MBUF=512`)
  still die.
- H2 per-mapping size limit below 1 GiB on this firmware: prediction: `MBUF=512` with all
  layers survives; `-ngl 8` (buffers still ~1 GiB) dies.
- H0 neither (flags/fd/firmware): both die -> back to "stack-bound", new finding.

## Repro commands (byte-exact)

```
cd ~/kalsa-qdc/npu-v79-cell/kit-v6/lib-fix
OD=/opt/hexagon/6.6.0.0/tools/HEXAGON_Tools/19.0.07/Tools/bin/hexagon-llvm-objdump
docker run --rm --platform linux/amd64 -v "$PWD:/k:ro" ghcr.io/snapdragon-toolchain/arm64-android:v0.7 sh -c "
 $OD -T /k/libggml-htp-v73.so | grep -E ' (htp_iface_start|abort)\$';
 $OD -d --start-address=0x3e30 --stop-address=0x3e58 /k/libggml-htp-v73.so;
 strings -t x /k/libggml-htp-v73.so | grep -E 'mmap failed|main.c'"
```
