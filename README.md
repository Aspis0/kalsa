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

### Build llama.cpp mainline (Termux, ISA sicura)

**Non** usare `cmake` con `GGML_NATIVE` default ON su S23: abilita probe
`-mcpu=native+sve/sme` che generano SIGILL (tombstone CMakeScratch; dettaglio in
`reports/moe-f1-sigill.md`). Rebuild conservativo:

```bash
bash scripts/build_llama_termux.sh
# → pin b10244, GGML_NATIVE=OFF, -march=armv8.2-a+dotprod+i8mm+fp16
bash scripts/preflight_llama_isa.sh \
  --binary ~/src/llama.cpp/build-safe/bin/llama-cli \
  --build-dir ~/src/llama.cpp/build-safe
```

`run_bench.sh` invoca il preflight in modo **obbligatorio** sulle fasi F1–F4
(serve `CMakeCache` + `compile_commands.json` accanto al binario).
`PREFLIGHT_ISA=0` è un skip esplicito **UNSAFE** e viene **rifiutato** per le
fasi scientifiche. Build: `CMAKE_EXPORT_COMPILE_COMMANDS=ON`, `GGML_NATIVE=OFF`.

Regole d'oro (dettagli in PLAN.md §2): una variabile alla volta · ogni run una riga CSV ·
commit piccoli e frequenti qui, mai i GGUF · misure solo da telefono fisico, mai emulatore ·
mai misurare con USB collegato (= in carica).
