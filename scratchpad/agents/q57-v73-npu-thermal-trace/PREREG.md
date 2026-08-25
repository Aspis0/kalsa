# q57 — v73 hybrid-on-NPU under thermal guard: intra-run thermal trace + HTP_8 replication (PREREG)

**Status: LOCKED at commit time.** Owner 25/08: "galaxy s23 scollegato, 100%,
fresco. vai delega, rivalidazione guard e run npu v73". Runs ONLY after the
q56 guard passes its 4-test re-validation matrix on this device today.

## Questions
1. What does the battery-temperature curve look like DURING the workload that
   preceded the thermal shutdown (Qwen3.5-4B-Q4_0 entirely on HTP0, perplexity
   `-b 2048 -ub 1024 -c 2048`), bounded to 8 chunks / 10 min under the guard?
2. Does the HTP running PPL at chunk [8] replicate the recovered value 7.4314
   (n=2)?
3. (optional, short) Per unit of prefill work, is the NPU cooler or hotter
   than the CPU? llama-bench pp512 HTP vs CPU on the same model, each with the
   guard's 10-s trace, 2 reps each.

## Arms (all under the guard; device unplugged, declared)
| arm | command | guard | cap |
|---|---|---|---|
| A HTP-PPL-8 | q53 lane-2 flags, `-ngl 99 -dev HTP0`, `--chunks 8`, `-v` | WARN 40.0 / **KILL 41.0 °C** | 10 min wall (kill at cap) |
| B (optional) pp512 HTP | `llama-bench -p 512 -n 0 -r 2 -ngl 99 -dev HTP0`, q46 env | WARN 40 / KILL 41 | 5 min |
| C (optional) pp512 CPU | same, `-ngl 0` | WARN 40 / KILL 43 | 5 min |

Preconditions per arm: temp ≤ 30.0 °C at start, battery ≥ 45 %. Any
`dspqueue`/`INTERNAL-ERROR`/abort → record, STOP the cell (no retry). Guard
kill → record the curve, STOP the cell. B/C run only if A finished (completed
or guard-killed) and the device is back ≤ 30 °C with ≥ 50 % battery.

## Outputs (numbers only)
- Thermal trace CSV per arm (epoch, tenths, level) + MAX temp, time-to-40 °C,
  slope °C/min over the first 5 minutes.
- `PPL_HTP_8` (A) and delta vs 7.4314 (%). Not a gate; replication record.
- B/C: pp512 t/s (exploratory, not a ship number) + MAX temp + °C rise per
  512-token pass.

## Consequence
Evidence rows for the router ledger (R6 stays OFF — incident) and for the
upstream report's device-health note; the thermal slope becomes the number
behind the "10-min cap" rule (keep, tighten, or relax — owner decision).

## Hygiene
As q53 + INCIDENT rules: guard armed before the workload (guard-first
supervisor), cpuset of the binary pid, battery/temp/plugged start+end,
LF scripts, no model pushes, no deletions, adb reconnect ≤ 3 × 90 s.
