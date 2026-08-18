# K4 N3/N4 waiter — ARMED

Armed: 2026-08-13T06:46:19-04:00
Device: S23 `u0_a344@192.168.1.152:8022`
Waiter pid: 21569 (`~/gdn_k2/k4split/logs/n3/waiter.pid`)
Status: `WAITER_ARMED`

Gate to start (all required):
- `plugged=UNPLUGGED` (will not measure on AC)
- battery ≥ 45%
- battery temp ≤ 35.0 °C

Window: 21600 s (6 h). If still plugged at expiry → `ARMED_EXPIRED`.

On unplug: `n3/run_n3n4.sh`
- N3 ABBA × `p_fact` + `p_creative`, n=200, cold fadvise, cache-1000 `--force-cache`, router pin on split
- N4 15 min/arm only if decode ≥1.10× **or** TTFT ≥1.5×

First poll: 100% / 29.5 °C / PLUGGED_AC
