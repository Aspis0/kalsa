# PREREG — qdc-8elite-cpu-day0 (locked before any number)

Date: 2026-08-28 evening. Owner away window starts 28/08. 10-day plan item: "QDC 8 Elite
first (kill-date day 4): E031 third column, decision table 8xx, NPU generation map".
This cell is the CPU slice of the 8xx datum (the owner note: "CPU Oryon … potrebbe
cambiare il verdetto" on the HVX/kernel decisions).

## Environment (pinned)
- Device: QDC interactive session, Snapdragon 8 Elite QRD8750 (SM8750, "Sun for arm64"),
  Android 16, 8 cores. adb via SSH tunnel (`ANDROID_ADB_SERVER_PORT=6037`, local port
  6037 — NEVER 5037, the local server owns the Jelly campaign). Lab device on rack
  power: **PLUGGED DECLARED** (no unplugged claims from QDC, per owner-away rule).
- Binaries: `~/kalsa-qdc/bin-a0cabca6b/` — llama-bench / llama-cli / test-backend-ops,
  arm64, android-28, CPU-only (GGML_OPENCL=OFF), sources = kalsallama main `a0cabca6b`
  (built at c750342f = main + CI yml only; SHA256SUMS in kit, BUILD_NOTE.txt).
- Model (speed): OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf, 4 213 513 024 B, from
  `~/kalsa-models/s23-backup-2026-08-27/` (byte-verified S23 pull) — sha256 to be
  recorded in manifest before first bench run; on-device size must match exactly.

## Cells, in order
1. **Correctness gate (no model): test-backend-ops** on CPU backend:
   `test-backend-ops test -o MUL_MAT` and `-o MUL_MAT_ID` (full sweep, includes our
   q2_K/q3_K repack paths on a brand-new CPU generation). PASS = 100% of supported ops;
   any FAIL = stop speed cells, report.
2. **Speed (plugged, declared): llama-bench** on OLMoE Q4_K_M, `-t 8` (all cores; a
   `-t 6` secondary if time allows), tg128 and pp512, `-r 3` each, N=3 invocations per
   config interleaved (bench-rebench, not one long run). No GPU arm exists in this kit.
3. Telemetry each run: `dumpsys battery` temp before/after, thermal status; q56-style
   watch (poll 10 s) — QDC rack device, expected cool, but recorded anyway.

## Comparators (read-only, banked)
- #20 S23: OLMoE tg128 CPU 27.685 t/s (A/GPU 20.034, A/C 0.724).
- The reading is Oryon-vs-S23-CPU on identical bytes and same-source binaries;
  plugged-vs-unplugged difference DECLARED as a caveat (S23 numbers were unplugged).

## Stop rules
- Session minutes cap ≤ 90 for this cell (of 997 free); model push counts inside.
- Transport loss: one reconnect cycle via a fresh Connect dialog; if the session dies,
  bank whatever complete runs exist, declare the rest.
- No other devices touched. Jelly untouchable. No prereg loosening without a written
  owner note.
