# SHA records — Xiaomi Task B (CalaQwen KEXP 35B)

Verified 2026-08-13 before ABBA. Workspace `/data/local/tmp/gdn_750/taskb/`.

## PC sources

| file | size | sha256 |
|---|---:|---|
| `results/xiaomi_ab/bmoe-cli.CAMPAIGN` | 402416 | `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` |
| `models/Qwen3.6-35B-A3B-KEXP.gguf` | 13416430592 | `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a` |
| `results/xiaomi_ab/prompts/p_fact.txt` | 361 | `b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd` |
| `results/xiaomi_ab/prompts/p_creative.txt` | 268 | `761db0d07cbc312acb35fb8c64894be83f38a3a7f0ba14e2100ef6a44a29c871` |
| `results/marco_phase1/speed_s23/prompts/p_fact.txt` | 361 | `b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd` MATCH |
| `results/marco_phase1/speed_s23/prompts/p_creative.txt` | 268 | `761db0d07cbc312acb35fb8c64894be83f38a3a7f0ba14e2100ef6a44a29c871` MATCH |
| `bmoe_libs/libggml-base.so.0.16.0` | 1792136 | `c61bd1321db163d4c545b6df0a570edb4a849de6aacb84104b345b1304a01e99` |
| `bmoe_libs/libggml-cpu.so.0.16.0` | 999528 | `ba1a7dee19a16059ae103ad300ecfed947cdf0b1d06197b1237fa96eb647db1d` |
| `bmoe_libs/libggml.so.0.16.0` | 82096 | `212505003ac910b1d8b2ce6a41e51d2219e3c41ce46c383c1047cccb19e21f8d` |
| `bmoe_libs/libllama-common.so.0.0.9965` | 6244696 | `939062a45741c32bcad2c3bf4004c6c421f6c39486c8d02daed0992431da5b5e` |
| `bmoe_libs/libllama.so.0.0.9965` | 3438704 | `96526746ffbaafaf773ed8f76dea3500390a20ba6866e068aeb090997852626a` |

## Device (verified)

| file | sha256 | note |
|---|---|---|
| `/data/local/tmp/gdn_750/taskb/bin/bmoe-cli` | `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` | MATCH after push; **does not run** — `libllama-common.so.0` needs `libssl.so.3` + `libcrypto.so.3` (not on Android 16 / houji) |
| `/data/local/tmp/gdn_750/taskb/bin/bmoe-cli.k4` | `b8b1c732064f5f1d8e0d6ba3f5257af51bfe3d40ccb71ecaad49911677c815ab` | documented static fallback; used for all measured cells |
| `/data/local/tmp/gdn_750/taskb/Qwen3.6-35B-A3B-KEXP.gguf` | `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a` | MATCH, sha256sum wall 14 s (file still in page cache after push) |

## SM8650 cpu_capacity (this unit)

`cpu0=379 cpu1=379 cpu2=923 cpu3=923 cpu4=923 cpu5=867 cpu6=867 cpu7=1024`
Max=1024, 50% threshold=512. Cores ≥512: cpu2–cpu7 → **`-t 6`**.
Two A520 (cpu0/cpu1, 379) excluded. Matches `reports/moe-gdn-750.md`.

## Primary vs reference

- Primary: `-t 6` (capacity rule)
- Reference: `-t 4` one run per prompt (S23-comparable)
