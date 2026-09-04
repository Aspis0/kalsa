# Upstream / public prior art on the v73 `dspqueue_read 0x2e` death (websearch, 2026-09-04)

Source: Websearch agent (codex/gpt-5.6-luna, read-only; no issue opened, nothing pushed).
Status of each claim: DELEGATE-REPORTED until marked VERIFIED by the orchestrator.

## ggml-org/llama.cpp (read-only)
- #26123 (open, 2026-07-25): 8 Gen 2 / v73 — "Full or partial Hexagon offload works correctly for
  a 1B model but crashes with `dspqueue_read failed: 0x0000002e` during actual graph compute …
  for both a 7B dense model and a 4B hybrid (Nemotron-H)". Same class as ours, no root cause.
- #22208 (closed/not planned, 2026-04-21): v73 Snapdragon X Elite, 0x2e or 0x72 at load.
- #18192 (closed, 2025-12-19): shape-specific v73 0x2e.
- #21705 (merged 2026-04-10): buffers mapped/unmapped on the fly by the NPU; "tested up to 30B MOEs".
- #21071 (merged 2026-04-16): the `__HVX_ARCH__ > 73` split, HAP_mmap2 for >73; "check to prevent
  mapping more than 2GB with HAP_mmap (which is unsupported)".
- #22487 (merged 2026-04-29): adds GGML_HEXAGON_VMEM / GGML_HEXAGON_MBUF; default vmem "around
  3.2GB", buffer 1GB.
- #26501 (merged 2026-08-27): multi-NPU overhaul, touches main.c mmap; NOT in our fork.
- #28202 (merged 2026-09-02): "Op batch buffers are now sorted by size to avoid address space
  fragmentation"; NOT in our fork.
- #22791 (discussion, unanswered, 2026-05-07): S23 SM-S911B Android 16 v73 logs.
- `mmap_buf`, `htp_iface`, `HTP_MAX_MMAPS`: nothing in prose.

## Qualcomm / AOSP
- qualcomm/fastrpc #137 (2025-01-30, closed/not planned): "Q6 cDSP only have 32-bit virtual
  address space, limited number of shared buffers can be mapped"; maintainer comment
  2025-04-17: "limited to 2GB on older devices and has been increased to 3GB on newer devices
  (8gen3)".
- Runtime FARF: AOSP external/fastrpc `HAP_farf.h` — `<process_name>.farf` file on the HLOS
  file system; `log_config.c` searches ADSP_LIBRARY_PATH, parses `0x%hx`; logcat tag `adsprpc`.
  Our driver writes `$D/lib-fix/llama-bench.farf` = `0x1F` (ADSP_LIBRARY_PATH=$D/lib-fix).
- haozixu/llama.cpp-npu README: "32-bit virtual address space … recommend models below 4B";
  cites fastrpc #137; documents `echo 0x1f > llama-cli.farf` + `adb logcat -s adsprpc`.

## What this changes for cell #60
The host assumes 3000 MiB of DSP VA on v73 (ggml-hexagon.cpp:4373) while Qualcomm states ~2 GB
for pre-8 Gen 3 parts → PREREG pre-run amendment 1 (arms B5 VMEM=1800, B6 VMEM=0 measured).
