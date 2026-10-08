# Cell #66 — one-copy CPU / NPU / GPU legs on QDC Snapdragon 8 Elite (correctness)

Plugged QDC device: correctness only, speeds indicative.

## Device

- Portal device: Snapdragon® 8 Elite, Mobile Reference Design, QRD8750 | Android 16 (SM8750)
- `ro.soc.model`: SM8750
- `ro.product.model`: Sun for arm64
- `ro.build.fingerprint`: qti/sun/sun:16/BQ2A.260305.002-BP2A.250705.008/eng.lnxbui:userdebug/test-keys
- Hexagon arch (from arms): v79, DMA64 disabled; OpenCL: Adreno(TM) 830, driver `OpenCL 3.0 QUALCOMM build: 0800.70 Compiler E031.47.18.47`
- MemTotal: 15519768 kB (from `raw/recon_sa881443.txt`)
- Battery temperature at every arm header: `batT=420`; no `WATCHDOG:` line in the report

## Job

- QDC interactive session id: 877374 (tunnel host sa881443, adb serial 57dd7911)
- Minutes requested: 75 entered in the "Maximum Minutes Per Device" field. The portal timer showed 119m18s remaining about 2 minutes after start, i.e. a 120-minute window. Portal "Total Minutes Used": Pending at last read.
- Session: Running 10/08/26 1:42:03 PM, ended 10/08/26 1:55:18 PM by End Session (portal status: Completed)
- Legs script run: `== legs start Thu Oct  8 10:44:49 PDT 2026` to `== legs end Thu Oct  8 10:54:13 PDT 2026`

## Per arm

| arm | exit | kld line (verbatim) | self-check PASS lines |
|---|---|---|---|
| G | 0 | none (reference arm; writes `twocopy.gbl`) | 0 |
| L | 0 | `kld arm=L ref=/data/local/tmp/kalsa66/twocopy.gbl vocab=128000 tokens=256 compared=256 diverged=0 mean=0.000049 max=0.001143 kld_max=0.010000 status=PASS` | 167 |
| L-npu | 0 | `kld arm=L ref=/data/local/tmp/kalsa66/twocopy.gbl vocab=128000 tokens=128 compared=128 diverged=0 mean=0.000115 max=0.001730 kld_max=0.010000 status=PASS` | 167 |
| L-gpu | 0 | `kld arm=L ref=/data/local/tmp/kalsa66/twocopy.gbl vocab=128000 tokens=128 compared=128 diverged=0 mean=0.000010 max=0.000108 kld_max=0.010000 status=PASS` | 167 |
| L-gpu2 | 0 | `kld arm=L ref=/data/local/tmp/kalsa66/twocopy.gbl vocab=128000 tokens=128 compared=128 diverged=0 mean=0.000010 max=0.000108 kld_max=0.010000 status=PASS` | 167 |
| L-cpu | 0 | `kld arm=L ref=/data/local/tmp/kalsa66/twocopy.gbl vocab=128000 tokens=128 compared=128 diverged=0 mean=0.000012 max=0.000168 kld_max=0.010000 status=PASS` | 167 |
| A-gpu | 0 | `kld arm=A ref=/data/local/tmp/kalsa66/twocopy.gbl vocab=128000 tokens=128 compared=128 diverged=0 mean=0.000010 max=0.000114 kld_max=0.010000 status=PASS` | 0 |
| A-j1 | 0 | `kld arm=A ref=/data/local/tmp/kalsa66/twocopy.gbl vocab=128000 tokens=128 compared=128 diverged=0 mean=0.000115 max=0.001730 kld_max=0.010000 status=PASS` | 1 |
| V-gpu | 0 | `kld arm=L ref=/data/local/tmp/kalsa66/twocopy.gbl vocab=128000 tokens=128 compared=128 diverged=0 mean=0.000010 max=0.000108 kld_max=0.010000 status=PASS` | 167 |

## Verify

`V-gpu verify: lines=4000 worst_rel=2.285e-05`

## Errors / aborts

No `GGML_ABORT`, `error`, `refus`, `FAIL`, or `WATCHDOG` line in `raw/legs_report_sa881443.txt`.

## Raw

`raw/recon_sa881443.txt`, `raw/kit_verify_sa881443.txt`, `raw/legs_report_sa881443.txt`, and per-arm logs `raw/{G,L,L-npu,L-gpu,L-gpu2,L-cpu,A-gpu,A-j1,V-gpu}_sa881443.log`. Nothing committed.
