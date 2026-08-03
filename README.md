# moe-experiments — "Beyond Memory Capacity" (Kalsa, binario ricerca)

Repo sperimentale **dedicato e staccato dall'app Kalsa** (`../ai-chat`, fuori perimetro).
Obiettivo: eseguire Qwen3.6-35B-A3B (MoE, 11.5GB+ GGUF) su Galaxy S23 8GB via streaming
esperti da flash + cache predittiva. Il documento operativo completo è **[PLAN.md](PLAN.md)**.

Esecutore principale: **Grok** (goal pi) — punto d'ingresso: [GROK_GOAL.md](GROK_GOAL.md).

## Struttura

| Cartella | Contenuto |
|---|---|
| `scripts/` | script bash per Termux (setup, build, `run_bench.sh`, download) |
| `analysis/` | Python: parsing log → CSV → grafici, simulatore cache (F7) |
| `traces/` | trace di attivazione esperti raccolti sul telefono (F7.1) |
| `results/` | archivio canonico: `runs.csv` + log grezzi pullati dal telefono |
| `reports/` | report di fase `moe-f<N>.md` (template in PLAN.md §8.4) |

Regole d'oro (dettagli in PLAN.md §2): una variabile alla volta · ogni run una riga CSV ·
commit piccoli e frequenti qui, mai i GGUF · misure solo da telefono fisico, mai emulatore ·
mai misurare con USB collegato (= in carica).
