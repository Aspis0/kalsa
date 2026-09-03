# REPORT — Cell #53: OpenCL picks A/B on HDK8550 (Snapdragon 8 Gen 2 / Adreno 740)

Date: 2026-09-03. QDC job 797850 (`sa801919`), device `300b45e6`, session
Running 06:43:58 → ended 07:07:58 CEST (verified Completed on the portal) =
**24 min billed** of the 1000 free 8 Gen 2 minutes. PREREG.md (incl.
Amendment 1) in this folder; raw evidence in raw/. All 10 arms ran once,
in order, exit=0 — the ABBA block is UNFRAGMENTED, so Amendment 1 does not
trigger.

## Device (raw/recon_sa801919.txt)

- SoC `SM8550` (recon line 2), platform `kalama`, Android 14 userdebug —
  the S23's SoC class. GPU: **Adreno 740** (OpenCL banner in every bench
  .out). RAM 11,548,288 kB. 8 core dirs: cpu0-2 @2.016, cpu3-6 @2.8032,
  cpu7 @3.1872 GHz → CPU_MASK `f0` (cpu4-7).
- Quirk recorded: `nproc` printed 6, but live probes during the session read
  `/sys/devices/system/cpu/online` = `0-7` and the shell's
  `Cpus_allowed_list` = `0-7` — all 8 cores online, mask valid; the nproc
  value is a toybox oddity on this image, not a cpuset restriction.

## Builds under test (both sha-verified on device, raw/kit_verify_sa801919.txt)

- **base** = a0cabca6b (fork tip), base-kit-53.tgz `385c80a5…`.
- **picks** = 12f6d9b6d = base + b7a5e926b (q4_K/q5_K flat-mv uint loads,
  A7x opt) + 8fe4bf8d3 (Adreno image-kernel OOB read fix) + 12f6d9b6d
  (generic-FA tile WAR race fix), picks-kit-53.tgz `5f8c6552…`.

## Q1 — correctness A/B: **NO REGRESSION, base ≡ picks on all three op families**

| op set | base | picks |
|---|---|---|
| MUL_MAT | 925/925 PASS | 925/925 PASS |
| MUL_MAT_ID | 407/407 PASS | 407/407 PASS |
| FLASH_ATTN_EXT | 229/229 PASS (supported subset) | 229/229 PASS |

(raw/tbo_{base,picks}_{mm,mmid,fa}_sa801919.out; every arm exit=0, 2/2
backends. The FA runs decline thousands of unsupported shapes honestly —
`not supported [OpenCL]` — and pass all 229 supported cases.)

**Bonus observation (recorded, PREREG #54-inherited item 4): FA compiles and
passes on the Adreno 740** — the 732's `sub_group_shuffle_xor` compile
failure (cell #52) is tier-specific, confirming the router needs a per-GPU
FA capability probe, not a per-vendor assumption.

## Q2 — perf A/B (LFM2.5-2.6B **Q4_K_M**, sha `02a8b7e1…`, same app-pinned HF
revision; llama-bench -ngl 99 -fa 0 -t 4 taskset f0 -p 512 -n 128 -r 3, ABBA)

| arm | pp512 t/s | tg128 t/s |
|---|---|---|
| bench_base_1 | 83.82 ± 0.74 | 16.04 ± 0.01 |
| bench_picks_1 | 84.78 ± 0.71 | 16.01 ± 0.01 |
| bench_picks_2 | 84.50 ± 0.50 | 16.03 ± 0.02 |
| bench_base_2 | 84.36 ± 0.55 | 16.04 ± 0.02 |
| **base mean** | **84.09** | **16.04** |
| **picks mean** | **84.64** | **16.02** |

Δ picks vs base: **pp512 +0.65 %, tg128 −0.12 %** — both far inside the ±3 %
PREREG band.

## Verdict (grid, binding)

**G1 fires, hygiene branch**: picks all-PASS, baseline all-PASS, perf within
±3 % → **TAKE the three picks as correctness/hygiene only — NO perf claim.**
The A7x q4_K uint-load optimization produces no measurable decode gain on
this 740 + 2.6B workload (possible reasons, not tested: the 2.6B decode may
not be mv-bound on the 740, or the win needs other shapes/tiers — a free
future check on the 8650/8635 now that minutes exist). The OOB-read fix and
the FA WAR-race fix are correctness patches; their value is not speed.

**The S23-class device gate for `kalsa/opencl-picks-2026-09` is CLEARED**:
the branch is device-validated on Adreno 740 without waiting for the physical
S23 (~7/09) or Samsung RTL. Merge decision (into which lineage, when) stays
with the owner.

## Thermal discipline

The HDK warms fast under census load: the first post-arm snapshot still
passed (45.0 °C / status 0, therm_post_tbo_base_mm), every later one failed
the #38 gate (up to 63.0 °C / status 3 after the picks MUL_MAT census,
raw/therm_post_tbo_picks_mm…). The first two PRE gates passed cold with zero
retries; the following **8** PRE gates each passed after exactly one 60 s
cooldown retry (8 retries total, 0 aborts). Bench arms therefore all started
from a gate-passing state; the ABBA order plus per-arm gating is what kept
the A/B fair on this board.

## Session accounting

Submitted 06:15:24, queued ~28 min (HDK starvation — during the wait a #54
folder for QRD8650 was prepared and a session wizard was attempted; its
Create clicks were swallowed by the portal, nothing was created, and the
approach was abandoned when 797850 entered Setup at ~06:43). Running
06:43:58 → 07:07:58 = 24 min billed. Remaining 8 Gen 2 budget ≈ 976 min.
Ops lesson 7 of cell #52 (JS clicks swallowed by portal dialogs; always
verify status after End/Cancel) was applied: this session's end is
portal-verified Completed.
