# Report — Notte 9/8 BINARIO A (telefono): cache-down sweep

**Stato:** **COMPLETO** — C1500 4/4 run; C1000 **SKIPPED** (verdetto MIN_SANE_2000).  
**Data:** 2026-08-09 00:51–00:57 EDT  
**Mandato:** `mandates/notte-9ago.md` § BINARIO A  
**Binario:** `bmoe-cli.CAMPAIGN`  
`sha256 cab204321d478931be1332f816fe5ed6a6fa26bde632dde45af9bf002fa0d6c8`  
**Pin:** solo CAMPAIGN, **niente** `ALLOW_UNPINNED`.  
**Harness:** `scripts/run_cache_down_notte9.sh`  
**OUTDIR:** `results/notte9/cache_down/`  
**Baseline C2000 (Cella 2):** mediana decode tok/s = **4.608**  
**Config:** `-t 4 -c 4096 -n 200 --temp 0 --chatml --no-think --moe-stream --cache-mb <C> --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 8`  
**Prompt sha (verificati pre-lancio):**

| prompt | sha256 |
|---|---|
| short | `197480d977685dc8bacec8c3eeaf81ab395ee33ccaf5737a4913149920c2f619` |
| f45_1_esplicativo | `bc5c1e584031aa57f53d47ecabe8139537fbd54c32421ce4ca9ef2204f55cbcf` |

Cold: `fadvise` GGUF a inizio tier C1500 (`COLD_OK`).  
Guardrail: `lib_guardrails.sh` sourcato; **nessun** evento `GUARDRAIL,*` in flight.log.

---

## Preflight

| Voce | Esito |
|---|---|
| UNPLUGGED | sì (batt_start 45%, batt_end 41%) |
| die start | ≤55 °C (sotto 80) |
| nproc | 6–8 per tutta la sessione |
| screen_off_timeout | 1800000 → 7200000 → **ripristinato 1800000** (`screen_off_timeout.restore_status=OK`) |
| floor 30% | non toccato (fine a 41%) |

---

## C1500 — 4 run

| run | prompt | eval tok/s | hit | memfree_min MiB | VmHWM MiB | wall s | batt s→e |
|---|---|---:|---:|---:|---:|---:|---|
| r1 | short | **4.157** | 67.4% | 21 | 3379 | 68 | 45→44 |
| r2 | short | **3.853** | 67.4% | 20 | 3376 | 76 | 44→43 |
| r1 | f45_1 | **3.774** | 71.1% | 19 | 3380 | 78 | 43→42 |
| r2 | f45_1 | **3.982** | 71.1% | 48 | 3380 | 74 | 42→41 |

**Mediana C1500:** 3.9175 tok/s  
**Δ vs baseline 4.608:** **−14.985%** (< −10%)  
**Hit vs C2000:** short 67.4% (era 74.1%); f45_1 71.1% (era 77.0%) — cache più piccola → meno hit → meno tok/s.  
**VmHWM:** ~3380 MiB (C2000 era ~3870 MiB) → ~500 MiB headroom, ma al prezzo di −15% decode.

### Verdetto (regole mandato)

| regola | esito |
|---|---|
| entro −3% → candidato, valuta C1000 | no |
| −3%..−10% → trade-off a gualt | no |
| **< −10% → 2000 è il minimo sano** | **SÌ** |

**VERDICT = `MIN_SANE_2000`**  
**C1000 = SKIPPED** (verdetto non-candidato; nessun eroismo).  
Guardrail scattati: **nessuno**.  
Batteria fine: **41%** UNPLUGGED.

---

## Artefatti

```
results/notte9/cache_down/
  VERDICT.txt STATUS.txt SKIPPED.txt cells.csv runs_added.csv
  flight.log CACHE_DOWN.master.log batt_{start,end}.json
  prompt_sha256.txt prompts/
  screen_off_timeout.{orig,set,restored,restore_status}
  C1500/*.summary.txt *.sampler.csv *.stdout.log *.stderr.log
  C1000/   (vuoto — non tentato)
```

Righe anche in `~/experiments/results/runs.csv` (phase `NOTTE9-CACHE-DOWN`, `bin_sha256=cab20432…`).

---

## Nota harness

`run_type` CSV marcato `cold` per tutte e 4 le run (cold fadvise solo a inizio tier; r2 sono warm di fatto). Non ricalcolato: non cambia il verdetto. Cattura `VERDICT=$(verdict_c1500)` inizialmente inquinata da stdout multi-riga del tee — corretto post-hoc in `VERDICT.txt` / `STATUS.txt` (token = `MIN_SANE_2000`); fix one-liner nel harness per rerun futuri.

---

## Conclusione (pezzo A del report unico)

**2000 MB è il minimo sano di cache** per la config di campagna sul S23 con binario pinnato. Scendere a 1500 costa ~15% di decode tok/s e ~7 pp di expert_hit_rate; il guadagno di ~500 MiB di VmHWM non compensa. C1000 non eseguito. Nessun guardrail, nessun riavvio, screen timeout ripristinato.
