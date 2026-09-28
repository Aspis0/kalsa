# DSpark on the Surface (CPU only) — measured, 2026-09-28

The M1 Max measurement and its correctness check live in
`DSPARK-M1MAX-2026-09-28.md` (commit 7a7d451e and a6cfec67). This is the same
A/B on the owner's other machine: does the official LFM2.5-2.6B-DSpark drafter
pay for the catalog's LFM2.5-2.6B Q8_0 row on a 4-core laptop CPU? Everything
here was measured on 2026-09-28 over SSH (`gualt@100.102.156.86`, Tailscale),
port 8190, scratch in `C:\Users\gualt\kalsa-dspark`. The installed Kalsa app
was **not running** (no kalsa/llama processes, no `server.state`); nothing
under the app's directories was touched, and the app's own incomplete engine
download (`runtime\archives\kalsa-server-v1.1.2-bin-win-cpu-x64.zip.part`, a
casualty of that network blocking dl.kalsa.io) was left as found.

## Verdict

**Marginal and prompt-dependent: yes on short English/code prompts (+9…+29%),
no on Italian expository and at 8k context (−1…−20%). Outputs byte-identical
at temp 0.** On a 16 GB machine the drafter also pushes memory into transient
paging during long-context work. Do not ship it for the CPU tier on this
evidence.

## Machine and identities

Surface Laptop 3: i7-1065G7 (4C/8T), 16 GB, Iris Plus (unused — CPU build),
Windows 11 10.0.26200.9457, corporate-managed.

| Thing | Value | Status |
|---|---|---|
| Engine | `%LOCALAPPDATA%\kalsa-brain\runtime\builds\cpu\llama-server.exe`, marker `.kalsa-build`: `runtime=llama-b10950-bin-win-cpu-x64.zip:36acf4d8…9b9`, `exe=55fc2a7d17fb1ed5b4b81da5c4b87b6c04e65c84bf0bac371a55d783ea07a457` — **upstream llama.cpp b10950 CPU packaging**, not the v1.1.2-named pin (`assets.rs` win-cpu row expects `kalsa-server-v1.1.2-bin-win-cpu-x64.zip`, sha256 `60b6cb68…`): this machine never got v1.1.2 because dl.kalsa.io is blocked; it runs the complete upstream b10950 archive it already had. The Mac's correctness check (fork ≡ upstream, byte-identical DSpark output) covers the substitution. | measured |
| Threads | from the app's own `runtime\tuning.txt`: `winner-threads=8` (candidates 4: 10.53, 8: 11.83) → `--threads 8 --threads-batch 8` | measured |
| Target GGUF | `LFM2.5-2.6B-Q8_0.gguf` downloaded from the catalog-pinned HF commit, sha256 `1e22128dfa128bdfb684da167e74e072d0a056baa7d06d9f280291e2839b0fc9` (certutil) — matches `manifest.rs:853-856`. Not present in the app's models dir (it holds gemma-4-E4B + stories260K only). | measured |
| Drafter GGUF | `LFM2.5-2.6B-DSpark-F16.gguf` from `LiquidAI/LFM2.5-2.6B-DSpark-GGUF`, 663,691,776 bytes, sha256 `e198962c08903f3ba29f0ce6bf8e17f5e60bf85ec2f8673e1e2aab03508937e5` — same file as the Mac run. | measured |
| Harness | same `bench.py` (stdlib only) and the same five prompts; Python 3.14.4 on the box. Long-context prompt tokenizes to 7,895 tokens (same as Mac). | measured |

## The exact argv

A (baseline) — the app's CPU launch argv shape (`crates/kalsa-launch/src/argv.rs`;
threads from tuning; deviations as on the Mac: `--parallel 1` for the isolated
stream, no slot-save path):

```
llama-server.exe --host 127.0.0.1 --port 8190 --model LFM2.5-2.6B-Q8_0.gguf
  --alias LFM2.5-2.6B-Q8_0 --threads 8 --threads-batch 8 --batch-size 2048
  --ubatch-size 512 --ctx-size 65536 --flash-attn on --cache-type-k q8_0
  --cache-type-v q8_0 --temp 0.1 --top-k 50 --repeat-penalty 1.1
  --sleep-idle-seconds 300 --no-webui --parallel 1 --cache-ram 6144
```

B = A plus exactly:

```
  --spec-type draft-dspark --spec-draft-model LFM2.5-2.6B-DSpark-F16.gguf
  --spec-draft-n-max 2 --spec-draft-n-min 0
  --spec-draft-threads 8 --spec-draft-threads-batch 8
```

No `--n-gpu-layers` (the app's `no-gpu-build` offload renders no flag). Note
the server-side sampling defaults (`--temp 0.1 --top-k 50 --repeat-penalty 1.1`)
apply to both arms identically; the greedy condition overrides only temperature
(0.0) and seed — same on both arms, so the A/B is fair, but greedy here is not
pure argmax (repeat-penalty 1.1 active), unlike the Mac doc's framing.

## n_max sweep (en_code, greedy, 1 rep each)

| n_max | tps | tokens/step | per-position rate |
|---|---|---|---|
| 1 | 18.3 | 1.78 | 0.77 |
| 2 | **18.5** | 2.34 | 0.66 |
| 3 | 18.2 | 2.76 | 0.58 |

All three within ~1.5% — on this CPU the drafter competes for the same cores
and the curve is flat where the Mac's peaked at 3. **n_max 2 chosen** (nominal
winner); 4 was not tested because 3 did not win. Caveat: the sweep servers
lacked the sampling-default flags, so their absolute tps is not comparable to
the arms' — the n choice is, the level is not.

## Results (median tok/s decode, min..max over 3 reps)

3 reps everywhere — nothing cut; the whole measurement fit the ~90 min cap.
tokens/step includes the bonus token (steps = draft_n / n_max, exact for the
one-block-per-step drafter); per-position rate = draft_n_accepted / draft_n.

| cond | prompt | A med | A min..max | B med | B min..max | speedup | B tok/step | B pos rate |
|---|---|---|---|---|---|---|---|---|
| greedy | it_short | 16.0 | 15.2..16.3 | 18.8 | 17.4..18.9 | **1.17x** | 2.22 | 0.60 |
| greedy | it_long | 14.0 | 13.8..14.7 | 11.8 | 11.0..11.8 | **0.84x** | 1.92 | 0.46 |
| greedy | en_short | 13.9 | 13.6..14.2 | 13.3 | 10.7..15.6 | **0.96x** | 2.50 | 0.73 |
| greedy | en_code | 13.4 | 13.2..13.9 | 14.6 | 14.1..14.7 | **1.09x** | 2.37 | 0.68 |
| greedy | long_ctx | 8.6 | 8.2..8.7 | 7.4 | 7.3..7.5 | **0.85x** | 2.30 | 0.65 |
| catalog | it_short | 12.7 | 12.5..12.8 | 14.0 | 13.9..14.1 | **1.10x** | 2.09 | 0.54 |
| catalog | it_long | 12.3 | 12.1..12.4 | 12.1 | 12.1..12.5 | **0.99x** | 1.94 | 0.47 |
| catalog | en_short | 12.5 | 12.0..12.7 | 16.1 | 15.9..16.1 | **1.29x** | 2.54 | 0.76 |
| catalog | en_code | 12.2 | 11.9..12.2 | 14.6 | 14.5..14.6 | **1.19x** | 2.32 | 0.66 |
| catalog | long_ctx | 8.8 | 8.8..9.0 | 7.1 | 6.8..7.2 | **0.80x** | 2.23 | 0.61 |

- Prefill is a wash (A 24 tok/s at 7.9k, B 24; short prompts 38–52 both arms).
- The en_short greedy B spread (10.7..15.6) is real and memory-caused: the
  low rep coincides with a 6.6k pages/sec burst at 20:51 (see below).
- Acceptance is NOT the CPU's problem — per-position rates (0.46–0.76) match
  the Mac's at the same widths. The gain is smaller because the target's
  verify step on 3 threads' worth of cores is only ~1.4–1.6x the single-token
  step, so 2.2–2.5 tokens/step buys less headroom than on Metal.

## Correctness at temp 0

**Byte-identical.** For all five prompts, the three A greedy reps are identical
to each other and B equals A exactly (string equality over reasoning + content).
Same as the Mac. (With the caveat above that "temp 0" here still carries the
server's repeat-penalty 1.1 — on both arms equally.)

## Memory (16 GB machine)

- Working set right after load: A 3.44 GB, B 4.71 GB (tasklist) — the drafter
  costs +1.27 GB. Per-run RSS sampling in the harness failed to parse
  (tasklist-CSV trailing-quote bug in my sampler), so peaks are the snapshot
  values plus the system counters below — the direction is unambiguous.
- System commit during arms (5s samples): A sat at ~14.0/17.7 GB (551 samples,
  min available 2.82 GB); B at ~15.1/17.7 GB (558 samples, **min available
  1.74 GB**). The app's own `--cache-ram 6144` reservation is part of that
  commit on both arms.
- Paging: A had 15 samples >100 pages/s (peak 17.8k) clustered on 7.9k-token
  prefills; B had 24 (peak **67.3k**), including during decode — the en_short
  outlier above. The machine does not thrash continuously, but with the
  drafter the 16 GB box has no headroom left.

## Notes and deviations

- Servers ran foreground over held-open SSH: `Start-Process`-detached children
  die silently on this box (first attempt), and killing the SSH session does
  NOT kill a foreground remote process — every bench server was stopped by its
  own PID (`Stop-Process`), the app's processes untouched throughout.
- The first A-arm attempt crashed client-side: Windows Python defaults to
  cp1252 and the Italian answer contains `₂` (H₂O); fixed by writing results
  UTF-8 and the arm rerun from scratch (the crashed run's 3 rows discarded).
- Windows PowerShell 5.1 lacks `Get-Date -AsUTC` (sampler fix); `find /c /v ""`
  over SSH miscounts (false "0 rows" scare mid-run — the file was fine).
- Scratch left in `C:\Users\gualt\kalsa-dspark` (models, results, logs,
  scripts); raw rows also mirrored to `/tmp/dspark/surface/` on the Mac.
