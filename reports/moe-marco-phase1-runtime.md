# moe-marco-phase1-runtime

**STATUS: PHASE 1 COMPLETE** — runtime transfer **SUFFICIENT**  
STOP — product cell (A2 vs A3 vs A1) left to owner. No auto-adopt. No requant.

Protocol: [`results/marco_phase1/PROTOCOL.md`](../results/marco_phase1/PROTOCOL.md)  
Verdict: [`results/marco_phase1/VERDICT.md`](../results/marco_phase1/VERDICT.md)  
Quality: 2026-08-11 16:18 → 2026-08-12 21:42 (PC `--ppl-decode`, resume after overnight shutdown)  
Speed: 2026-08-12 11:25–11:46 EDT · S23 unplugged · ABBA n=200 · bin `1ca51420…`

## Scope + protocol

Phase 1 isolates whether the KEXP campaign knobs **k + drop-cold** transfer onto Marco (`qwen3moe`, `models/Marco-Mini-Instruct.i1-Q4_K_M.gguf`, 10 505 424 704 B, sha `a001d324…`) **without touching the GGUF**. Quality is PC-only (`-t 8`); speed is device-only (S23 `-t 4`). Shared flags on every cell: `--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -c 4096`. Device decode also used `--temp 0 --chatml --no-think`. A0 (k=8, drop OFF) is the trial baseline, not re-run: sha match, IT from `ppl_it_v2` only. A1 = drop 0.65 at k=8; A2 = campaign clone k6d065; A3 = k=6 drop 0.50. A4 (k=5) was pre-declared conditional and was **not run**.

Gates were locked before the numbers. Fail-fast (IT v2 + EN): cell dies if either Δbpb > +0.05 vs A0. Full multi5 (en/es/fr/it-v2/zh): no language > +0.10, macro-5 Δbpb ≤ +0.04. Speed (ABBA A0 vs best cell, typically A2 — here A2, the campaign clone, not the smallest quality tax): decode median ≥ 1.15× **or** MiB/tok ≤ −20%; hit% is reported, with a “clear I/O win” bar around +15 pt. If quality A2 PASSes but speed does not move hit/MiB, PROTOCOL says Phase 1 is **INSUFFICIENT** and the next step is Fase 2 MarcoKEXP — not “raise the drop”.

## Quality

A0 anchors (`A0_baseline.json`; IT = `ppl_it_v2/marco`, **not** the literary 1.6377):

| lang | A0 bpb |
|------|-------:|
| en | 0.6051 |
| es | 0.6766 |
| fr | 0.7234 |
| it | **0.7501** (v2) |
| zh | 0.8834 |
| **macro-5** | **0.7277** |

### Fail-fast (IT v2 + EN, Δ ≤ +0.05)

| cell | k | drop | IT bpb | Δ IT | EN bpb | Δ EN | gate |
|------|--:|-----:|-------:|-----:|-------:|-----:|------|
| A1 | 8 | 0.65 | 0.7546 | +0.0045 | 0.6079 | +0.0028 | **PASS** |
| A2 | 6 | 0.65 | 0.7689 | +0.0188 | 0.6153 | +0.0102 | **PASS** |
| A3 | 6 | 0.50 | 0.7590 | +0.0089 | 0.6102 | +0.0051 | **PASS** |

Worst fail-fast cell is A2 IT (+0.0188), still well under +0.05. All three queued full multi5. Source: `runs_quality.csv` (`langs=it+en`).

### Full multi5 (per-lang Δ ≤ +0.10, macro Δ ≤ +0.04)

| lang | A0 | A1 | Δ A1 | A2 | Δ A2 | A3 | Δ A3 |
|------|---:|---:|-----:|---:|-----:|---:|-----:|
| en | 0.6051 | 0.6079 | +0.0028 | 0.6153 | +0.0102 | 0.6102 | +0.0051 |
| es | 0.6766 | 0.6788 | +0.0021 | 0.6892 | +0.0126 | 0.6825 | +0.0059 |
| fr | 0.7234 | 0.7260 | +0.0026 | 0.7392 | +0.0158 | 0.7332 | +0.0098 |
| it | 0.7501 | 0.7546 | +0.0045 | 0.7689 | +0.0188 | 0.7590 | +0.0089 |
| **zh** | 0.8834 | 0.8915 | +0.0081 | **0.9166** | **+0.0332** | 0.9011 | +0.0177 |
| **macro-5** | **0.7277** | **0.7317** | **+0.0040** | **0.7459** | **+0.0182** | **0.7372** | **+0.0095** |
| full gate | — | **PASS** | | **PASS** | | **PASS** | |

Every per-lang gate is PASS. No language is hidden in the macro: the worst single-lang hit is **A2 zh +0.0332** (VERDICT; csv 0.03324796), still 3× inside the +0.10 flag. zh is the worst language on every cell (A1 +0.0081 / A3 +0.0177 / A2 +0.0332).

| cell | role | macro | Δ macro vs A0 | vs +0.04 | vs +0.10 (worst lang) |
|------|------|------:|--------------:|----------|------------------------|
| A1 | drop-only k=8 | 0.7317 | **+0.0040** | PASS | zh +0.0081 PASS |
| A2 | k6d065 clone | 0.7459 | **+0.0182** | PASS | zh +0.0332 PASS |
| A3 | k=6 drop 0.50 | 0.7372 | **+0.0095** | PASS | zh +0.0177 PASS |

A2 is the largest quality tax and still inside both full gates. A3 halves that tax. A1 is almost free. These numbers only bound *quality* of k/drop — drop does not skip the matmul (PROTOCOL trap #3).

## Speed (S23, unplugged, ABBA)

16 runs: 4 A0 + 4 A2 (ABBA × fact + creative) + 8 same-session KEXP k6d065. Cold before every run. batt 100% → 96% (Marco) → 92% (KEXP). Peak 39.1 °C. `SESSION_SLOW` not flagged.

Medians (`SPEED_NOTES.md` table; `_stats.json` agrees, display rounding only):

| cell | n | decode tok/s | MiB/tok | hit% | TTFT s |
|------|--:|-------------:|--------:|-----:|-------:|
| **A0** (k=8 OFF) | 4 | **4.122** | **192.50** | **33.50** | 13.59 |
| **A2** (k6d065) | 4 | **5.371** | **126.21** | **36.65** | 12.64 |
| **KEXP k6d065** | 8 | **5.696** | **30.67** | **80.65** | 18.98 |

### Both speed gates

| gate | threshold | observed | verdict |
|------|-----------|----------|---------|
| decode median A2 vs A0 | ≥ **1.15×** | 5.371 / 4.122 = **1.303×** | **PASS** |
| MiB/tok median vs A0 | ≤ **−20%** | 126.2 vs 192.5 = **−34.4%** | **PASS** |
| Combined (OR) | either | **both** true | **PASS** |
| hit% (report) | clear I/O win ≈ +15 pt | **+3.15 pt** (VERDICT writes +3.2) | reported — **not** a clear cache win |

**Overall SPEED gate: PASS.** Transfer is a **speed** transfer, not a **cache-regime** transfer: hit only moved +3.2 pt (33.50 → 36.65). The I/O win vs A0 is the MiB/tok drop (−34%), not residency. vs same-session KEXP, Marco A2 is still cold (hit 36.7 vs 80.7; 126.2 vs 30.7 MiB/tok, ~4.1× more bytes per token). KEXP decode is only ~1.06× A2 (5.70 vs 5.37); TTFT is *worse* on KEXP (18.98 vs 12.64) — the KEXP gap is I/O, not tok/s.

### Jelly Star ranking (2026-08-12, unplugged, ABBA)

Same cells A0 vs A2, n=200, `-t 2`, io-threads 4, bin Jelly pin `36b01966…`. Absolute tok/s **not** product-citeable; ranking only.

| cell | n | decode tok/s | MiB/tok | hit% |
|------|--:|-------------:|--------:|-----:|
| A0 | 4 | 2.476 | 191.09 | 34.2 |
| A2 | 4 | 2.891 | 123.02 | 38.45 |

| gate | observed | verdict |
|------|----------|---------|
| decode ≥ 1.15× | **1.17×** | **PASS** |
| MiB/tok ≤ −20% | **−35.6%** | **PASS** |
| hit% | **+4.3 pt** | reported — still not +15 pt |

Same shape as S23: decode and MiB pass, hit barely moves. Ratio is smaller than S23 (1.17 vs 1.30) — flash-bound G99, as expected. Artefacts: `results/marco_phase1/speed_jelly/`.

## Verdict per PROTOCOL

Quality 3/3 full PASS + speed PASS on both levers → **runtime transfer is SUFFICIENT**.

Operational meaning: the KEXP k/drop pair **can be adopted on this Marco GGUF without requant**. A2 is a legal campaign clone (k=6 drop=0.65) on the existing `i1-Q4_K_M`. Phase 1 does not by itself pick the product cell — see next section.

Had speed failed to move hit **and** MiB, PROTOCOL would have called Phase 1 **INSUFFICIENT** and pointed at Fase 2 MarcoKEXP. Speed *did* move MiB (and decode). The remaining I/O-regime gap vs KEXP is a **different product**, not a reason to reopen the transfer gate.

## Product decision (open — owner)

No auto-adopt. Three legal quality cells; only A2 has a measured device speed.

| option | k / drop | quality cost (Δ macro / worst) | device speed | note |
|--------|----------|--------------------------------|--------------|------|
| **A2** | 6 / 0.65 | +0.0182 / zh +0.0332 | **measured**: 1.303× decode, −34.4% MiB/tok | campaign clone; worst-but-in-gate quality |
| **A3** | 6 / 0.50 | **+0.0095** / zh +0.0177 | **not measured** | halves A2’s quality tax; speed unknown |
| **A1** | 8 / 0.65 | **+0.0040** / zh +0.0081 | **not measured** | almost free quality; still k=8, so the k-cut is not in play |

A2 is the only cell that has earned the speed claim. Choosing A3 or A1 for product is a quality-vs-unmeasured-speed bet; PROTOCOL does not forbid it, and this report does not close it.

**Fase 2 MarcoKEXP (quantified, still open):** same-device, same session, KEXP k6d065 is 30.7 MiB/tok / hit 80.7% vs Marco A2 126.2 / 36.7. That is the cache-regime gap Phase 1 did **not** close. Decode is nearly tied (5.70 vs 5.37). The I/O figure (~4.1× fewer bytes off flash per token) is the one consistent with a battery / sustained-unplugged gap; the 1.06× tok/s is not. Phase 1 does not measure a battery-life hour delta; it only shows that the I/O regime is still KEXP’s, and that adopting k/drop on Marco does not buy that regime.

## Deviations & process

1. **Overnight PC shutdown, zero data loss.** At `2026-08-12T02:29:46` the parent died mid A1-full: `A1 full rc=1073807364` (`0x40010004`) then `A2 full rc=-1073741205` (`0xC000026B`). Logs do not name the cause; the pair is the usual Windows logoff/shutdown NTSTATUS set. Fail-fast for A1/A2/A3 was already on disk. A1-full had completed en+es; A2/A3 full had not started. Resume at `08:24:18` replayed only A1 missing langs (fr/it/zh, rc=0). A harness parse glitch then logged `A1 resume failed rc=` concatenated with the successful lang dump; a second idempotent resume at `12:23:38` saw A1 complete, wrote the A1 full rows, and ran A2 then A3. Grid DONE `21:42:09`. No completed row was recomputed as a new measurement; no completed row was lost.

2. **IT v2 metro (PROTOCOL trap #1).** A0 IT is `0.7501` from `ppl_it_v2/marco` (Wikipedia «Caffè», sha `498a5f3b…`). Literary Dante `1.6377` is recorded in `A0_baseline.json` as `invalid_do_not_use`. Every IT row in this trial used `corpus/multi5/it.txt`.

3. **Speed-side (S23), not quality-gate affecting.** Device waited on AC after the Marco push (50%→100%), then unplugged before any timed run. First harness attempt used `-f` (rejected by `bmoe-cli`); archived and re-ran. Some A0/A2 fact runs stopped at 191–195 tokens (EOS); decode rate taken from the fork summary. Unused `UD-Q2_K_XL` deleted on device to free space; KEXP kept.

4. **A4 not run.** PROTOCOL listed A4 (k=5 drop=0.65) only if A2 passed fail-fast. A2 passed; A4 was still not executed. Transfer verdict does not depend on it.

## STOP

Phase 1 explicitly did **not**:

- requantize Marco, download a Q8, or write a new GGUF
- patch the fork
- re-measure A0 quality (sha match + pinned IT v2)
- measure device speed for A1 or A3
- run A4
- compare quality against KEXP (PROTOCOL: GO is regression vs A0 Marco only)
- adopt a product default or rewrite harness defaults
- claim a cache-regime win (hit +3.2 pt is not one)
- claim a measured battery-hour delta vs KEXP

Artefacts: `results/marco_phase1/` (PROTOCOL, VERDICT, `runs_quality.csv`, `A{1,2,3}/full/*_full_summary.json`, `speed_s23/runs_speed.csv`, `speed_s23/SPEED_NOTES.md`) · logs `logs/marco_phase1_quality.log`, `logs/marco_phase1_resume.out.log`.
