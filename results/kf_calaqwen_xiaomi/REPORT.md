# kf_calaqwen_xiaomi — does 35B push residual stall over the K-F pay threshold?

**Question**: Marco cold on this phone left only 8.7% overlap-stall (fast UFS +
`--overlap` absorbs ~53 MiB/token). CalaQwen is the 13.4 GB qwen35moe; does
its residual stall share cross the ~20-25% band where K-F starts paying?
**Answer: NO.** Cold OFF stall share is **6.0%** (replicate 5.3%) — *below*
Marco, not above. The 2×-bytes/token premise is false on this config:
CalaQwen streams **34.34 MiB/token**, not ~100. K-F ON vs the matched cold
OFF pair is **−7%** wall (787 vs 849 ms/tok) — exploratory, one clean pair,
no stats claim. Same product map as tonight's Marco cell: K-F is a
slow-flash cold-start accelerator, not a 35B fast-flash win.

KF binary **loaded qwen35moe** (`print_info: arch = qwen35moe`). Campaign
fallback was not used.

## Config

- Device: Xiaomi 14 (23127PN0CG / houji), wireless adb
  `adb-625689a2-9xEOfw._adb-tls-connect._tcp` (IP 192.168.1.193; port had
  rotated off 46397 → 34545). UNPLUGGED. `svc power stayon true` during the
  cell, restored false at the end.
- Binary: `/data/local/tmp/kf_general/bin/bmoe-cli` (ad104222 + libs,
  LD_LIBRARY_PATH=that dir). fadv from the same dir.
- Model: `/data/local/tmp/gdn_750/taskb/Qwen3.6-35B-A3B-KEXP.gguf`
  (size=13416430592).
- Prompt: `/data/local/tmp/kf_general/p_fact.txt`.
- Flags: `-n 150 --temp 0 -c 4096 --ubatch 512 -t 4 --moe-stream
  --cache-mb 2000 --dense-weights anon --overlap --io-threads 4
  --n-expert-used 6 --drop-cold-experts 0.65`
  ON extra: `--kf-prefetch --kf-prefetch-width 4`.
- Validity (same hardened rules as `results/kf_cold_xiaomi/`): parsed
  generation ms/tok + wall>40s + >20KB; max 3 tries. All 5 blocks DONE on
  try=1.
- Driver: `run_cala_stall_probe.sh`. Raw stdouts: `out/*.txt`.

## Per-block table

| block | arm | ms/tok | tok/s | MiB/tok | stall s/tok | stall share | wall | note |
|---|---|---:|---:|---:|---:|---:|---:|---|
| a1_warmup_OFF | OFF | 479 | 2.088 | 34.34 | 0.076 | 15.9% | 96s | discard; KF load OK |
| a2_cold_OFF | OFF | 849 | 1.178 | 34.34 | 0.051 | **6.0%** | 149s | THE number; fadv 328k→0 pages |
| a3_cold_ON | ON | 787 | 1.270 | 39.79 | 0.024 | 3.0% | 140s | KF precision 83.3%, late 5% |
| a4_cold_OFF | OFF | 866 | 1.155 | 34.34 | 0.046 | 5.3% | 151s | OFF replicate |
| a5_cold_ON | ON | 540 | 1.852 | 63.66 | 0.055 | 10.2% | 103s | regime shift — do not pair |

Stall share = `moe-overlap stall` / `moe-stream decode`.

## Verdict

`CALAQWEN_STALL(share=6.0% cold)`
`KF_ON_35B(delta=-7% vs OFF cold)`

- a2 is the pre-registered "THE number". a4 (5.3%) is the stability
  replicate. Mean cold-OFF share **5.65%**, far under the 20-25% pay band.
- Clean ON/OFF pair is a3 vs a2: 787 / 849 = **−7.3%**. a3 vs a4 = −9.1%.
  K-F telemetry on a3 is healthy (precision 83.3%, late 5%, max-inflight=4)
  and it did cut stall 0.051 → 0.024 s/tok — there is just almost no stall
  left to remove, and decode is compute-bound (0.79–0.81 s/tok compute on
  the slow-regime OFF cells).
- a5 is a mid-cell governor/thermal flip (same pattern as tonight's Marco
  c05→c06: slow ~850 ms/tok → fast ~540). It also over-fetched (63.66 vs
  34.34 MiB/tok). Discarded from the delta.

## Why the 35B did not cross the threshold

1. **Bytes/token is not 2× Marco.** Campaign card already had CalaQwen at
   ~30–33 MiB/tok / ~80% hit; this cell repeats **34.34 MiB/tok**. Marco
   cold tonight was 53.12. CalaQwen streams *less* flash per token, not more.
2. **Cold decode inflates the denominator.** a2 compute 0.789 vs warmup
   0.395 — stall seconds actually *drop* (0.076 → 0.051) while decode
   nearly doubles, so share falls 15.9% → 6.0%. Same mechanism as Marco
   (warm 19–21% vs cold 8.7%).
3. Warm (a1) 15.9% is the highest share in the cell and still under 20%.

## Caveats (exploratory — no stats claims)

- n=150, 2 OFF + 2 ON cold points. Pair 2 (a4/a5) is contaminated.
- UNPLUGGED 77% → 74%, battery temperature 29.9 → 36.0 °C. Floor 30% not
  hit. No thermal wait (threshold 38.0 °C).
- No `--chatml --no-think`: Qwen3.6 emitted a `<think>` preamble. Token
  mix is not the card-cell mix. Stall share is an IO/compute ratio, not a
  card-speed claim.
- Wireless serial was the mDNS handle; TCP port 46397 was dead (new port
  34545). Same phone, 78% unplugged as briefed (77% at first dumpsys).

Data: `out/*.txt`, `STATUS.txt`, `run_cala_stall_probe.sh`.
