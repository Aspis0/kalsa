# T3 trial-marco — Jelly Star (interim archive)

**Status:** DONE (2026-08-10 evening local)  
**Device:** Unihertz Jelly Star · Helio G99 · 8 GB · Termux  
**Binary pin (Jelly, separate from S23 CAMPAIGN):**  
`36b01966ba0f471d17f8fcb29ab49f64f760999c4256f612f959a7a0b178ce81`  
**Config gate:** KEXP = **k=6 + drop 0.65** (`k6d065`); Marco = drop OFF, k=model default  
**Threads:** `-t 2` · cache 2000 · dense anon · overlap · cold via `fadv`/`cold_model.sh`  
**Power:** unplugged entire run · finished ~51% battery · screen kept on  

## Gate T3 (Marco ≥ 1.3× KEXP median n=200)

| tag | n | median tok/s | mean tok/s | vals |
|---|---|---|---|---|
| A KEXP k6d065 | 4 | **1.6305** | 1.660 | 1.593, 1.487, 1.891, 1.668 |
| B Marco | 4 | **1.172** | 1.169 | 1.153, 1.17, 1.179, 1.174 |

- **ratio Marco/KEXP = 0.719×**
- **gate_1_3x = FAIL**

Sustained Marco n=512: **1.183 tok/s**, MiB/tok ~189.6, hit ~33.7% (same I/O regime).

## I/O diagnosis (why Marco loses)

| | KEXP | Marco |
|---|---|---|
| MiB/tok (typical) | ~31–53 | ~187–190 |
| cache hit | ~72–82% | ~34–35% |

Flash-bound on Jelly: fewer active params ≠ fewer flash bytes when experts thrash a 2 GB cache.

## Files

- `t3_runs.csv` — one row per run  
- `t3_summary.json` — medians + gate  
- `T3.master.log` — harness timeline  
- `A_*.log` / `B_*.log` — raw bmoe-cli  
- Partial pre-correction (k8+d065) archived on device as `t3_partial_k8d065_*` (not gate)

## Not yet in this commit

- Full `reports/moe-trial-marco.md` (needs PC quality k6d065 + T2c)
- KEXP multi5 **k6d065** baseline (queued on PC)
- Marco multi5 full 5 langs + Qwen3.5-4B

See also: `../device/` (T0/T1), `../KEXP_CONFIG.md`, `../STATUS.md`.
