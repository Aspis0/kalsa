# q53c — v73 dense/hybrid NPU lane: 8-chunk correctness datum, under thermal guard (PREREG)

**Status: LOCKED at commit time.** Owner authorization 25/08 night: "dopo il
watchdog puoi rifare i run NPU v73, ma statte attento". This cell replaces the
never-completed q53 lane 2 (32 chunks; two attempts ended in adb drops and a
thermal shutdown — see `../q53-v73-npu-correctness/INCIDENT_THERMAL.md`).

## Question
Over the SAME first 8 wikitext chunks (`-c 2048`, same corpus file sha
`173c87a5…`), is the Qwen3.5-4B-Q4_0 hybrid's perplexity on HTP0 (v73, whole
model on NPU) within the q53 gate of its CPU reference?

## Preconditions (all mandatory)
1. q56 thermal watchdog VALIDATED (test 1 kill path PASS, test 2 pass-through
   PASS) — no run without the guard attached to the binary pid.
2. Battery temperature ≤ 30.0 °C at start of every arm; battery level ≥ 45 %
   (unplugged; charging state must not be changed).
3. sha pins re-verified on device (skel libs, llama-perplexity, gguf
   `298fcb5f…`, corpus).

## Arms
**HTP arm — prefer the EXISTING datum, run only if absent.**
- If the device-side log of q53 lane-2 session 1
  (`/data/local/tmp/q53_v73_npu_correctness/lane2_qwen_htp_ppl.log` or the
  session-2 equivalent) contains a running-PPL line for chunk [8] → use that
  value as `PPL_HTP_8` (the tool prints the cumulative estimate over chunks
  1..n). Record which log/session it came from, and its execute-op proof.
  **No NPU run is performed in this case.**
- Else: ONE fresh HTP run, `--chunks 8`, same flags as q53 lane 2
  (`-ngl 99 -dev HTP0 -b 2048 -ub 1024 -c 2048 -fa on --load-mode none`, `-v`),
  under the guard with **tonight's stricter thresholds: WARN 38.0 °C, KILL
  41.0 °C**, wall cap 10 min (kill at cap). Any `dspqueue`/`INTERNAL-ERROR`/
  abort → record and STOP the cell (no retry). Guard kill → record and STOP.

**CPU-ref arm — always fresh**: `--chunks 8`, `-ngl 0`, same binary/corpus/
ctx/batch flags, under the guard (WARN 38 / KILL 41), wall cap 15 min.

## Metric and gate (characterization; 8 chunks ≠ q53's 32)
`r = PPL_HTP_8 / PPL_CPU_8 − 1`. Same letters as q53: PASS ≤ 2 %, GREY 2–5 %,
FAIL > 5 % or NaN. A PASS certifies the lane on 8 chunks only ("R6 8-chunk
datum"); R6 stays OFF in the router ledger regardless (thermal incident) —
this datum informs the upstream report and the ledger's evidence column, not a
lane flip.

## Consequence
- PASS/GREY/FAIL recorded in `REPORT.md` (numbers only) and banked in PLAN/
  ALIVE row 13 as "v73 dense/hybrid NPU: 8-chunk r = …".
- The value of this cell is also negative-space: if the HTP datum already
  exists on device, the lane-2 question is answered with ZERO additional NPU
  load on a device that just survived a thermal shutdown.

## Hygiene
As q53 + INCIDENT rules: guard on every arm, cpuset of the binary pid,
battery/temp/plugged declared start+end and MAX temp per arm in the manifest,
LF scripts, no model pushes, no deletions, adb reconnect ≤ 3 attempts.
Outputs: `RUN_LOG.md`, `manifest.json`, `raw/`, `REPORT.md`.
