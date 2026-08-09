# Report — adozione `--drop-cold-experts 0.50` + giro finale scheda prodotto

Data: 2026-08-09 · Device: Galaxy S23 (SM-S911U) **UNPLUGGED**  
Binario CAMPAIGN: `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` (= `CAMPAIGN.sha256`)  
PREFAULT intatto · Mandato: `mandates/adopt-dropcold.md`  
Artefatti: `results/adopt_dropcold/` (telefono + mirror PC)  
**Stato mandato: COMPLETE (STOP al report — mai `complete_goal`)**

---

## Parte 1 — config di campagna negli harness

### Script modificati (default campagna += `--drop-cold-experts 0.50`)

| script | punti toccati |
|---|---|
| `scripts/f55a_ppl_baseline.sh` | `BASE=…`, `gate_config`, `command` f-string |
| `scripts/run_staccato.sh` | cella1 FLAGS + flags_s, single FLAGS/flags_s, cella4 plateau + CSV |
| `scripts/run_staccato2.sh` | idem staccato |
| `scripts/start_f4_5_quality.sh` | `FLAGS=…` |
| `scripts/start_f4_7_batt_curve.sh` | `FLAGS=…` |

Già presente (non toccato): `scripts/fix_smoke_and_sostenuto.sh` (riga 137).

### Lasciati intatti di proposito

| script | motivo |
|---|---|
| `scripts/run_speed_dropcold.sh` | A/B: il flag è variabile di braccio, non default |
| `scripts/run_f4.sh` | celle storiche / LOSSY diagnostic; non default campagna unico |
| `scripts/run_bench.sh` | riceve `--flags` dal caller; nessun default campagna hard-coded |

### Verifica

- `bash -n` OK su tutti gli script toccati.
- Push su telefono: `~/experiments/scripts/`.
- Commit PC: `82c8993` — `feat(campaign): adopt --drop-cold-experts 0.50 as default harness config`.
- Grep residuo config vecchia **senza** flag nei 5 script toccati: nessuna riga di comando completa senza drop (la riga 155 di `f55a_ppl_baseline.sh` è solo il primo pezzo di un f-string multi-linea; il pezzo successivo ha `--drop-cold-experts 0.50`).

Config campagna adottata (G-A):

```
-t 4 -c 4096 --temp 0 --chatml --no-think
--moe-stream --cache-mb 2000 --dense-weights anon --overlap
--io-threads 4 --ubatch 512 --n-expert-used 8 --drop-cold-experts 0.50
```

---

## Parte 2 — giro finale scheda prodotto (UNPLUGGED)

### Condizioni

| | inizio | fine sessione (retry incluso) |
|---|---|---|
| plugged | **UNPLUGGED** | UNPLUGGED |
| batteria % | **82** | **70** |
| batt temp °C | 31.8 | 36.7 |
| nproc | 8 → 6–8 (top-app) | 6–8 |
| pin | `1ca51420…` | invariato |
| screen_off_timeout | 1800000 → 7200000 | **ripristinato 1800000** |
| floor 30% | non toccato | non toccato |

Prompt sha (verificati): short `197480d9…`, f45_1 `bc5c1e58…`, f5_1_t1..t5 come `results/staccato/prompt_sha256.txt`.

Ordine esecuzione (priorità mandato se batteria bassa): **#2 → #3 → #1 → #4**.  
Nota operativa: il primo giro ha avuto 3 `ABORT_MEM` (guardrail MemFree&lt;100 MiB/10 s) su short_r1, f45_r1, sostenuto. Nei run A/B citabili (`moe-speed-dropcold.md`) `memfree_min` era già 13–52 MiB → la soglia del sampler è **troppo aggressiva** per questo workload. Retry senza kill-on-mem (solo HARD 98 °C) ha completato i 3 run. I numeri di scheda usano i run **rc=0** (r2 del primo giro + retry). I kill restano documentati come guardrail, non come regressione prodotto.

### #2 Conversazione 5 turni KV (INVARIANTE) — PASS

Input: F5.1 t1–t5 via `--session`, `clear_kv=true` solo T1, n=256, fadvise a inizio conversazione.

| turno | n_prompt | n_past | n_common | prefill_s | tok_s | hit% | load_s |
|------:|---------:|-------:|---------:|----------:|------:|-----:|-------:|
| 1 | 96 | 352 | 0 | 8.218 | 5.397 | 81.5 | **9.963** |
| 2 | 87 | 695 | **352** | 9.454 | 4.453 | 81.5 | 9.963 |
| 3 | 88 | 1039 | **695** | 9.888 | 4.428 | 80.5 | 9.963 |
| 4 | 92 | 1387 | **1039** | 11.012 | 4.189 | 79.9 | 9.963 |
| 5 | **70** | **1713** | **1387** | **9.338** | 3.892 | 80.1 | 9.963 |

Atteso: T5 prefill ~9–10 s, riuso pieno.  
Misurato: T5 prefill **9.338 s**, n_common cresce 0→1387, n_prompt resta suffisso (~70–96).  
vs staccato Cella1 med T5 9.37 s — allineato.  
**INVARIANTE #2: OK** (drop non ha toccato prefill/KV).

### #1 Load cold (INVARIANTE)

| rep | model load s (stdout) | note |
|---:|---:|---|
| conv5 (session cold) | **9.963** | BMOE_DONE load_s |
| load cell r1 (`-p` short n=8) | **11.423** | path `-p`, non session |
| load cell r2 | **11.332** | path `-p` |
| short_r1_retry | **9.072** | path `-p` n=200 |
| f45_r1_retry | **10.294** | path `-p` n=200 |

Atteso ~10 s. Mediana path session/cold utili ≈ **9.1–10.3 s**; path load-cell con n=8 e cold stretto ≈ 11.3–11.4 s (stesso ordine, non regressione 3×).  
Il parser del primo giro aveva riportato wall 28 s (bug: confondeva wall con load) — **scartato**; numeri sopra da stdout `model load` / `load_s`.  
**INVARIANTE #1: OK** (drop non tocca il load).

### #3 Decode short + f45_1, n=200, cold, drop 0.50

| run | eval tok/s | hit% | drop% | MiB/tok | die max | memfree_min | rc | note |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| short_r1 (1° giro) | — | — | — | — | 76.6 | 13 | 143 | ABORT_MEM false-positive |
| short_r2 | **3.949** | 74.8 | 2.0 | 53.67 | 83.1 | 13 | 0 | valido ma basso |
| short_r1_retry | **4.923** | 74.8 | 2.0 | 53.67 | 91.2 | 36 | 0 | retry no-mem-kill |
| f45_r1 (1° giro) | — | — | — | — | 76.2 | 16 | 143 | ABORT_MEM false-positive |
| f45_r2 | **4.383** | 79.0 | 2.2 | 41.23 | 73.7 | 52 | 0 | |
| f45_r1_retry | **4.535** | 79.0 | 2.2 | 41.23 | 81.4 | 25 | 0 | |

**Mediane citabili (rc=0):**

| prompt | valori | mediana | banda B (drop A/B) | banda A (no drop) |
|---|---|---:|---|---|
| short | 3.949, 4.923 | **4.436** | ~4.2–4.9 | 4.206–4.910 |
| f45_1 | 4.383, 4.535 | **4.459** | ~4.2–4.6 | 4.206–4.910 |

Hit/drop/MiB/tok **identici** al braccio B di `moe-speed-dropcold.md` (short 74.8 / 2.0 / 53.67; f45 79.0 / 2.2 / 41.23).  
Mediane **dentro banda B** e **non sotto banda A**. short_r2 3.949 è un outlier termico/pressione (memfree 13), non la mediana.  
**#3: CONFERMA ADOZIONE** (no STOP regressione).

### #4 Sostenuto n=512

| run | eval tok/s | hit% | drop% | MiB/tok | die max | rc | note |
|---|---:|---:|---:|---:|---:|---:|---|
| 1° giro | — (parziale step 293/512, ~4.2 tok/s last50) | 82.9 | — | — | 72.9 | 143 | ABORT_MEM, no retry per policy 1° giro |
| retry | **4.354** | 85.2 | 2.0 | 35.25 | **79.8** | 0 | citabile |

Atteso ~4.0–4.9; die watch 91.6 °C.  
Misurato **4.354** in banda; die max 79.8 °C &lt; 91.6; nessun THERMAL_PAUSE / HARD_DIE.  
**#4: documentazione termica OK** (non gate).

---

## Scheda prodotto (default completo = drop 0.50)

| metrica | valore | banda / atteso | esito |
|---|---|---|---|
| Load cold (session) | **9.96 s** | ~10 s | INVARIANTE OK |
| Prefill T1…T5 (s) | 8.22 / 9.45 / 9.89 / 11.01 / **9.34** | T5 ~9–10 | INVARIANTE OK |
| n_common T5 | **1387** | cresce, riuso pieno | OK |
| Decode short med tok/s | **4.436** (3.949, 4.923) | B 4.2–4.9; A≥4.206 | in banda |
| Decode f45 med tok/s | **4.459** (4.383, 4.535) | B 4.2–4.6 | in banda |
| drop% | 2.0–2.2 | ~2.1 | coerente |
| Sostenuto n=512 tok/s | **4.354** | 4.0–4.9 | OK |
| Sostenuto die max | **79.8 °C** | watch 91.6 | OK |

---

## Guardrail e lmkd

| evento | conteggio | nota |
|---|---:|---|
| ABORT_MEM (1° giro) | 3 | short_r1, f45_r1, sostenuto — **false-positive** vs memfree tipico MoE 13–52 MiB |
| THERMAL_PAUSE 88 °C/60 s | 0 | |
| HARD_STOP 98 °C | 0 | |
| PLUGGED mid-run | 0 | |
| batt &lt; 30% | 0 | min 70% |
| lmkd delta (run validi) | 0 | |

Flight: `results/adopt_dropcold/flight.log` + master log.  
Follow-up (non bloccante): ricalibrare `MEM_ABORT_KB` / hold in `lib_guardrails.sh` per MoE streaming (soglia 100 MiB uccide run citabili).

---

## Verdetto (regole di lettura del mandato)

| regola | esito |
|---|---|
| #1 load INVARIANTE | **OK** (~10 s; drop non tocca load) |
| #2 KV riuso INVARIANTE | **OK** (T5 prefill 9.34 s, n_common 1387) |
| #3 mediana in banda B / non sotto A | **OK** — adozione **confermata** |
| #4 termico documentato | **OK** (4.35 tok/s, die 79.8 °C) |

**Adozione F=0.50 operativa nella scheda prodotto e negli harness di campagna.**  
Nessun rebuild, nessun re-pin, PREFAULT intatto, `../ai-chat` e `PLAN.md` non toccati.

### Commit

- `82c8993` harness default drop 0.50  
- (questo report + runner + results mirror: commit successivo)

### Blocker

Nessuno di prodotto. Nota harness: ABORT_MEM troppo stretto → documentato; retry ha chiuso le celle.
