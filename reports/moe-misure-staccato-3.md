# Report — misure DA STACCATO parte 3 (celle 3–4, guardrail attivi)

**Stato:** **COMPLETO / final_rc=0** — Cella 3 **4/4 run**; Cella 4 **plateau n=512** completato.  
**Data:** 2026-08-09  
**Mandato:** ripresa celle 3–4 post `moe-reboot2.md` (go gualt) + regole `misure-staccato-2.md` / `misure-staccato.md`  
**Binario:** `bmoe-cli.CAMPAIGN`  
`sha256 cab204321d478931be1332f816fe5ed6a6fa26bde632dde45af9bf002fa0d6c8`  
**Pin:** solo CAMPAIGN, **niente** `ALLOW_UNPINNED`.  
**Harness:** `scripts/run_staccato2.sh` con `OUTDIR=…/staccato3`, `--from-cella3 --win-cache 2000`, `CELLA4_UBATCH=512`  
**Guardrail:** `scripts/lib_guardrails.sh` (e0c9bc3) sourcato; log `GUARDRAIL,*` → flight.log  
**Config base:** `-t 4 -c 4096 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch <U> --n-expert-used 8`

---

## Correzioni / preflight

| # | Voce | Esito |
|---|---|---|
| 1 | `screen_off_timeout` | salvato **1800000** → set **7200000** (2 h); a fine sessione **ripristinato 1800000** (`results/staccato3/screen_off_timeout.*`) |
| 2 | nproc / top-app | pre-lancio nproc=3 `/moderate` → promote adb + wake-lock → nproc **6–8** `/top-app` per tutta la sessione |
| 3 | UNPLUGGED | verificato pre ogni cella; nessuna riga con PLUGGED |
| 4 | Guardrail | lib presente sul telefono (6.7 KB); sampler `run_single` + C4 chiama `guardrail_tick` / `guardrail_apply_to_pid` |
| 5 | n_gen C3 | harness allineato a **256** (era 64) |
| 6 | C4 ubatch | forzato **512** via `CELLA4_UBATCH` (mandato: plateau con ubatch 512, non winner dinamico se diverso) |

Prompt sha (verificati):

| prompt | sha256 |
|---|---|
| d1_long | `96629f53df322550008c4a42471bf373fe851a8c59bca738dbdceb86a8e37650` |
| short | `197480d977685dc8bacec8c3eeaf81ab395ee33ccaf5737a4913149920c2f619` |
| plateau_n512 | `644e141cea80b9e349c178ea5b69e49651001ac6ae03d5bdea30f08aea723222` |

Cold cache: fadvise GGUF a inizio ogni lato / ogni rep C3 e a inizio C4.

---

## Finestra batteria

| | start (~00:27) | post C3 (~00:42) | fine C4 (~00:45) |
|---|---|---|---|
| plugged | **UNPLUGGED** | UNPLUGGED | UNPLUGGED |
| batteria % | **56** | **47** | **45** |
| batt temp °C | 26.1 | 39.5 | 40.7 |
| die max (flight) | — | **90.8** (C3 prefill) | **81.8** (C4 load) |
| nproc | 6–8 | 6–8 | 6–8 |

Sessione ~17 min wall (00:27:51 → 00:45:01). Batteria mai &lt;30% → **nessuno SKIP**.

---

## CELLA 3 — ubatch 512 vs 2048 (cache 2000, d1_long 1318 tok, n=256, 2 rep)

### Tabella run

| label | ubatch | prefill tok/s | prefill_s | eval tok/s | memfree_min MiB | VmHWM MiB | lmkd | wall s | batt | die_s→e |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| c3-ub512-r1 | 512 | **12.4** | 106.0 | 5.211 | **13** | 3910 | 0 | 166 | 56→53 | 47.4→64.4 |
| c3-ub512-r2 | 512 | **10.8** | 122.2 | 4.307 | **53** | 3913 | 0 | 192 | 53→51 | 53.5→63.6 |
| c3-ub2048-r1 | 2048 | **10.3** | 127.4 | 3.816 | **64** | 4072 | 0 | 207 | 51→49 | 48.6→57.1 |
| c3-ub2048-r2 | 2048 | **9.3** | 141.1 | 3.737 | **52** | 4056 | 0 | 221 | 49→47 | 49.0→56.7 |

Compute buffer (stderr): ubatch 512 → **~501 MiB**; ubatch 2048 → **~2004 MiB** (costo noto ~2 GiB).

### Mediane e regola adozione

| ubatch | n | med prefill tok/s | min memfree_min | max lmkd |
|---:|---:|---:|---:|---:|
| **512** | 2 | **11.6** | **13** | 0 |
| **2048** | 2 | **9.8** | **52** | 0 |

```
gain 2048 vs 512 = 9.8/11.6 − 1 = −15.52%
ok = (gain≥+10%) ∧ (lmkd=0) ∧ (memfree_min>300)  →  False
winner_ubatch = 512
```

**Verdetto Cella 3 (regola fissa):** **NON adottare 2048**.  
- prefill **peggiora** (~−15.5%), non +10%.  
- `memfree_min` **mai** &gt;300 MiB (13–64).  
- lmkd_delta = 0 su tutti i run.  
- In dubbio / regola: **resta 512**.  
Adozione finale decide gualt; i dati dicono 512.

Sampler C3 (0.5 s): die max 91.6 °C su ub512-r1, max streak die&gt;88 ≈ **15.5 s** (&lt; hold 60 s) → **nessun PAUSE_THERMAL**. MemFree&lt;100 MiB streak max ≈ 1 s → **nessun ABORT_MEM**.

---

## CELLA 4 — plateau n=512 (cache 2000, ubatch 512)

| | valore |
|---|---|
| wall | **151 s** |
| prefill tok/s | 9.2 |
| eval tok/s (globale) | **4.001** |
| hit | 83.8% |
| batt | 47→45 |
| rc | 0 |
| bin_sha256 | cab20432…d6c8 |

### Curva tok/s per blocco di 64 (+ die)

| block_end | dtok | dt_s | tok/s | die °C |
|---:|---:|---:|---:|---:|
| 64 | 67 | 38.74 | **1.73** | 62.0 |
| 128 | 61 | 15.72 | **3.88** | 68.1 |
| 192 | 64 | 15.39 | **4.16** | 67.2 |
| 256 | 66 | 15.59 | **4.24** | 68.1 |
| 320 | 64 | 15.65 | **4.09** | 68.9 |
| 384 | 68 | 18.86 | **3.61** | 67.6 |
| 448 | 66 | 15.62 | **4.23** | 70.9 |
| 512 | 55 | 13.47 | **4.08** | 68.9 |

**Nota blocco 64:** include ~23 s di prefill (primo token generato a +23.1 s) → tok/s artificiosamente basso. **Decode puro (blocchi 128–512):** stabilizzazione **~3.6–4.2 tok/s**, mediana di blocco ≈ **4.09**.

**Throttling da staccato:** in questa finestra **non** c’è collasso termico.  
- die decode medio ≈ **68.1 °C**, max sampler C4 **81.8 °C** (load), max in decode **71.7 °C** — sotto soglia 88.  
- nessuna discesa progressiva tok/s lungo i 512 token; plateau piatto ~4 tok/s.  
- un blocco 384 un po’ più lento (3.61) senza trend.

File: `results/staccato3/phone/cella4/block_curve.csv`, `plateau.sampler.csv`.

---

## Guardrail — scatti

| evento | conteggio in flight.log |
|---|---|
| `GUARDRAIL,*,THERMAL_PAUSE*` | **0** |
| `GUARDRAIL,*,ABORT_MEM` | **0** |
| `GUARDRAIL,*,HARD_STOP_DIE` | **0** |
| `*.KILL.txt` | assenti |

**Attivi sì, scattati no.**  
Osservazione onesta: il flight recorder (~7 s) ha 14 sample consecutivi con die&gt;88 (~98 s nominali) durante C3, ma il **sampler del guardrail (0.5 s)** misura streak max **~15.5 s** — picchi interrotti sotto i 60 s di hold. MemFree scende spesso sotto 100 MiB a tratti, mai sostenuto 10 s. I guardrail hanno funzionato come da soglie; non hanno dovuto abortire.

---

## runs.csv / bin_sha256

5 righe in `results/staccato3/phone/runs_added.csv` (e append host `results/runs.csv`):

| run_id (prefisso) | phase | n_gen | ubatch | prompt_tok_s | eval_tok_s | bin_sha256 |
|---|---|---:|---:|---:|---:|---|
| staccato-c3-ub512-r1-… | STACCATO2 | 256 | 512 | 12.4 | 5.211 | cab20432…d6c8 |
| staccato-c3-ub512-r2-… | STACCATO2 | 256 | 512 | 10.8 | 4.307 | cab20432…d6c8 |
| staccato-c3-ub2048-r1-… | STACCATO2 | 256 | 2048 | 10.3 | 3.816 | cab20432…d6c8 |
| staccato-c3-ub2048-r2-… | STACCATO2 | 256 | 2048 | 9.3 | 3.737 | cab20432…d6c8 |
| staccato-c4-plateau-… | STACCATO2-C4 | 512 | 512 | 9.2 | 4.001 | cab20432…d6c8 |

`cells.csv` host mirror: `results/staccato3/cells.csv`.

---

## STATUS onesto

```
DONE 2026-08-09T00:45:01-0400
winner_cache=2000          # da Cella 2 (misurata, non inventata)
winner_ubatch=512          # misurato; gain 2048 = −15.52%, regola fallisce
bin_sha256=cab204321d478931be1332f816fe5ed6a6fa26bde632dde45af9bf002fa0d6c8
final_rc=0
SKIPPED cella1 out_of_scope_staccato2
screen_off_timeout: saved=1800000 set=7200000 restore=1800000 OK
guardrail_events=0
```

---

## Artefatti

```
results/staccato3/
  phone/                 # pull completo telefono
    STACCATO2.master.log, flight.log, cells.csv, runs_added.csv, STATUS.txt
    cella3/*.{summary,sampler,stdout,stderr}.txt|csv + decision.log + winner_ubatch.txt
    cella4/{block_curve.csv,summary.txt,plateau.*}
    prompts/plateau_n512.txt, batt_{start,end}.json
  screen_off_timeout.{orig,set,restored,restore_status}
  cells.csv, runs_added.csv, flight.log, block_curve.csv, decision.log (mirror)
scripts/run_staccato2.sh # n_gen C3=256, propaga 96/97, CELLA4_UBATCH
scripts/staccato3_host_watch.ps1
reports/moe-misure-staccato-3.md
```

---

## Sintesi per gualt (adozioni — decide gualt)

| cella | verdetto dati | adozione proposta |
|---|---|---|
| 3 ubatch | med prefill 512=**11.6**, 2048=**9.8** (−15.5%); memfree 13–64; lmkd 0 | **resta 512** (regola: no +10%, no memfree&gt;300) |
| 4 plateau | decode ~**4.0 tok/s** stabile; die decode ~68 °C; no throttle hard | solo misura — **nessuna decisione** |

**STOP al report.** Nessun `complete_goal`. Non toccati: `PLAN.md`, `../ai-chat`, binario CAMPAIGN.

### Output atteso (≤300 parole)

**Cella 3:** med prefill 512=**11.6** tok/s (n=2), 2048=**9.8** (−15.5%); memfree_min **13–64** MiB; lmkd **0**. **Adozione 2048: NO** → winner_ubatch=**512**.  
**Cella 4:** blocco 64 include prefill (1.73 tok/s); decode 128–512 stabilizzato **~3.6–4.2** (eval globale **4.00**); die decode ~68 °C, max C4 81.8 — **nessun throttling da staccato osservato**.  
**Guardrail:** attivi, **0 scatti** (streak die&gt;88 max ~15.5 s &lt; 60 s hold).  
**Batteria:** 56%→45% UNPLUGGED.  
**screen_off_timeout:** 7200000 sessione → **ripristinato 1800000**.  
**bin_sha256:** cab20432…d6c8 su tutte le 5 righe.  
**Blocker:** nessuno. final_rc=**0**. STOP.
