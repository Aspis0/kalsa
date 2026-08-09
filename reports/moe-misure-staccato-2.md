# Report — misure DA STACCATO parte 2 (celle 2–3–4, schermo sotto controllo)

**Stato:** **PARZIALE / final_rc≠0** — Cella 2 **misurata** (12/12 run con dati; f45@C3500 incompleta al dropout SSH). Celle 3–4 **SKIPPED** (nessun dato).  
**Data:** 2026-08-08  
**Mandato:** `mandates/misure-staccato-2.md`  
**Binario:** `bmoe-cli.CAMPAIGN` = DENSE2  
`sha256 cab204321d478931be1332f816fe5ed6a6fa26bde632dde45af9bf002fa0d6c8`  
**Pin:** solo CAMPAIGN, **niente** `ALLOW_UNPINNED`.  
**Harness:** `scripts/run_staccato2.sh` → `results/staccato2/` sul telefono + snapshot host.  
**Config base:** `-t 4 -c 4096 -n 200 --temp 0 --chatml --no-think --moe-stream --cache-mb <C> --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 8`

---

## Correzioni mandato (1–3)

| # | Correzione | Esito |
|---|---|---|
| 1 | `screen_off_timeout` | **Salvato** `1800000` (30 min) → **impostato** `7200000` (2 h) via adb wireless all’inizio. **Ripristino:** **PENDING** — S23 offline a fine sessione (né adb né ssh). File: `results/staccato2/screen_off_timeout.{orig,set,restore_status}`. **Azione gualt:** a telefono online, `adb shell settings put system screen_off_timeout 1800000`. |
| 2 | Preflight che aspetta / ri-promuove | Implementato: wake-lock + `REPROMOTE.request` + retry 30 s × max 600 s; FATAL solo dopo. Usato in sessione (nproc 3→6–8 con wake Termux). |
| 3 | STATUS onesto | **Niente winner inventato.** `decide_cache` / `decide_ubatch` → `NODATA` se assenti misure. Celle 3–4: **SKIPPED** con motivo. `final_rc≠0`. |

Flight recorder: avviato su telefono (`~/experiments/results/staccato2/flight.log`, campioni ~5 s). Host watch periodico: fragile (bash/PowerShell spawn); keep-alive principalmente via timeout 2 h + wake adb quando adb era up.

---

## Condizioni (finestra batteria)

| | start sessione (~20:05) | mid C3000 | last contact (~20:47) | fine host |
|---|---|---|---|---|
| plugged | **UNPLUGGED** | UNPLUGGED | UNPLUGGED | S23 offline |
| batteria % | **89–90** | ~81–84 | **~69–70** | — |
| batt temp °C | ~27–34 | ~38–42 | ~45–46 | — |
| die max osservato | — | — | **~90–92 °C** (C3500), sotto hard-stop 98 | — |
| nproc | 6–8 top-app (dopo promote) | 6–8 | 6–8 | — |

Prompt sha (verificati su telefono = host):

| prompt | sha256 |
|---|---|
| short | `197480d977685dc8bacec8c3eeaf81ab395ee33ccaf5737a4913149920c2f619` |
| f45_1_esplicativo | `bc5c1e584031aa57f53d47ecabe8139537fbd54c32421ce4ca9ef2204f55cbcf` |
| d1_long | `96629f53df322550008c4a42471bf373fe851a8c59bca738dbdceb86a8e37650` |

Cold cache: fadvise GGUF a inizio ogni tier C.

---

## CELLA 2 — cache 2000 / 3000 / 3500

2 prompt fissi × 2 rep, `n=200`, ubatch=512. Metriche: decode tok/s (`eval_tok_s`), hit, `memfree_min`, VmHWM, lmkd_delta.

### Tabella run (raw)

| label | C | eval tok/s | hit | memfree_min MiB | VmHWM MiB | lmkd | wall s | batt |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| C2000-short-r1 | 2000 | **4.792** | 74.1% | 13 | 3871 | 0 | 63 | 89→89 |
| C2000-short-r2 | 2000 | **4.628** | 74.1% | 56 | 3875 | 0 | 64 | 89→87 |
| C2000-f45-r1 | 2000 | **4.588** | 77.0% | 46 | 3877 | 0 | 66 | 87→87 |
| C2000-f45-r2 | 2000 | **4.275** | 77.0% | 30 | 3876 | 0 | 71 | 86→86 |
| C3000-short-r1 | 3000 | **1.823** | 82.2% | 15 | 4412 | 0 | 151 | 84→83 |
| C3000-short-r2 | 3000 | **1.651** | 82.2% | 46 | 4848 | 0 | 157 | 83→81 |
| C3000-f45-r1 | 3000 | **0.814** | 84.5% | 14 | 4829 | 0 | 282 | 81→78 |
| C3000-f45-r2 | 3000 | **4.348** | 84.5% | 54 | 4872 | 0 | 71 | 78→78 |
| C3500-short-r1 | 3500 | **1.136** | 84.8% | 13 | 5006 | 0 | ~load+gen | 77→74 |
| C3500-short-r2 | 3500 | **1.811** | 84.8% | 20 | 4543 | 0 | 154 | 73→? |
| C3500-f45-r1/r2 | 3500 | **mancanti** | — | — | — | — | — | harness interrotto / SSH drop |

Snapshot CSV host: `results/staccato2/cells_snapshot.csv`.  
Artefatti telefono (ultimo contatto): `~/experiments/results/staccato2/cella2/*.summary.txt` (10 summary; f45@3500 assenti).

### Mediane per C (decode tok/s, n=4 se completo)

| C | n run validi | med eval tok/s | min memfree_min | max lmkd | med hit (approx) |
|---:|---:|---:|---:|---:|---:|
| **2000** | **4** | **4.608** | **13** | **0** | ~74–77% |
| **3000** | **4** | **1.737** | **14** | **0** | ~82–84% |
| **3500** | **2** (solo short; f45 assenti) | **1.474** | **13** | **0** | ~84.8% |

*Mediana C2000:* sort 4.275, 4.588, 4.628, 4.792 → media interquart (4.588+4.628)/2 = **4.608**.  
*Mediana C3000:* 0.814, 1.651, 1.823, 4.348 → (1.651+1.823)/2 = **1.737**.  
*Mediana C3500 (solo 2 short):* (1.136+1.811)/2 = **1.474** — **non** base per adozione completa (mancano f45).

### Regola adozione (mandato)

Adottare C>2000 **solo se** tok/s mediano ≥ **+5%** vs 2000 **e** zero lmkd **e** `memfree_min` > **300 MiB**.

| confronto | gain vs 2000 | lmkd | memfree_min | ok? |
|---|---:|---:|---:|---|
| C3000 vs 2000 | 1.737/4.608 − 1 = **−62.3%** | 0 | 14 ≪ 300 | **NO** |
| C3500 vs 2000 | 1.474/4.608 − 1 = **−68.0%** (dati parziali) | 0 | 13 ≪ 300 | **NO** |

**Verdetto Cella 2 (evidenza numerica):** **non adottare C>2000**.  
- tok/s peggiora drasticamente a 3000/3500 (pressione RAM / thrashing: VmHWM 4.4–5.0 GiB, major faults alti su C3500 ~22k/token in un log).  
- `memfree_min` **mai** >300 MiB (range 13–56) su **tutti** i tier, incluso baseline 2000 — la soglia 300 MiB **non** è soddisfatta da nessuno; la regola di adozione C>2000 fallisce comunque su gain e su memfree.  
- lmkd_delta tool = 0 su run completati; un kill di harness è comunque avvenuto a C3000 al primo tentativo (OOM/pressione), poi ripreso con resume.  
- **winner_cache misurato = 2000** (baseline; non default cieco: C3000/C3500 **misurati** e **rigettati**).

Nota onesta: anche a C=2000 `memfree_min` è 13–56 MiB; è un segnale di campagna (pressione strutturale), non un pass/fail di adozione C>2000.

---

## CELLA 3 — ubatch 512 vs 2048

**SKIPPED cella3** — dipendenza da cache vincitrice ok (2000), ma **sessione interrotta** prima del lancio (S23 offline / harness non ha raggiunto C3 nel log host).  
**Nessuna riga c3- in cells.csv.**  
**winner_ubatch = NODATA** (non 512 inventato).  
In dubbio operativo resta 512 solo come *default di campagna preesistente*, **non** come verdetto di questa sessione.

---

## CELLA 4 — plateau n=512

**SKIPPED cella4** — nessun run plateau, nessuna `block_curve.csv`.  
Motivo: batteria/sessione e dropout rete prima di C3/C4; C4 solo se C2+C3 con winner misurati.

---

## runs.csv / bin_sha256

- Telefono: `~/experiments/results/staccato2/runs_added.csv` (almeno 4+ righe C2000 scritte early; altre append in sessioni resume).  
- Ogni riga nota: `bin_sha256=cab204321d478931be1332f816fe5ed6a6fa26bde632dde45af9bf002fa0d6c8`, phase `STACCATO2`.  
- Host: snapshot metriche in `results/staccato2/cells_snapshot.csv` (non sostituto di runs.csv telefono).  
- Pull completo telefono **bloccato** a fine sessione (SSH timeout).

---

## Incidenti operativi (trasparenza)

1. **OOM / kill harness** al primo C3000 (VmRSS→~3.9 GiB, MemFree→~60 MiB): ripreso con skip summary esistenti.  
2. **`termux-battery-status` hang** post-C3500-r1 → harness bloccato; recovery summary da stdout; fix timeout 5 s su `batt_fields` + `lmkd_count` 8 s.  
3. **Falso FATAL_BATT batt=-1** (API timeout, non batteria reale ~70%): fix preflight “unknown ≠ low”; ripresa C3500 f45 avviata (`---- single c2-C3500-f45…-r1`) poi **SSH/adb S23 persi**.  
4. **cpuset** a tratti `/` non `/top-app` ma nproc≥6 mantenuto con screen timeout 2 h.

---

## STATUS onesto (correzione 3)

```
DONE_PARTIAL
winner_cache=2000          # misurato; C3000/C3500 falliscono regola +5% e memfree
winner_ubatch=NODATA       # SKIPPED cella3
final_rc≠0
SKIPPED cella3 no_run_session_dropout
SKIPPED cella4 no_run_session_dropout
SKIPPED cella2_C3500_f45 incomplete (r1/r2 non in CSV host)
screen_off_timeout: saved=1800000 set=7200000 restore=PENDING (S23 offline)
```

---

## Artefatti

```
results/staccato2/          # host
  cells_snapshot.csv
  screen_off_timeout.orig|set|restore_status
  session_start.txt / session_end_host.txt
scripts/run_staccato2.sh    # harness parte 2 (resume, STATUS onesto, batt timeout)
scripts/staccato2_host_watch.ps1 / .sh
reports/moe-misure-staccato-2.md

telefono (ultimo contatto):
  ~/experiments/results/staccato2/
    STACCATO2.master.log, flight.log, cells.csv, runs_added.csv
    cella2/*.{summary,stdout,stderr,sampler}.txt|csv
    STATUS.txt (può contenere FATAL_BATT storico + resume)
```

---

## Sintesi per gualt (adozioni — decide gualt)

| cella | verdetto | adozione proposta da dati |
|---|---|---|
| 2 cache | **2000 vince regola** (3000/3500 tok/s −62%/−68%, memfree≪300) | **resta 2000** |
| 3 ubatch | **SKIPPED / NODATA** | **non decidere** da questa sessione |
| 4 plateau | **SKIPPED** | solo misura — da rifare |

**STOP al report.** Nessun `complete_goal`. Adozioni finali cache/ubatch le decide gualt.  
**Blocker aperto:** ripristinare `screen_off_timeout=1800000`; pull artefatti telefono quando S23 torna online; opzionale rifare solo C3500-f45 + C3 + C4 se servono dati completi (non necessari per respingere C>2000).

---

## Output atteso (≤300 parole)

**Cella 2:** med eval tok/s C2000=**4.608** (n=4), C3000=**1.737** (n=4, −62%), C3500=**1.474** (n=2 short, −68%); hit ~74→85%; memfree_min **13–56** MiB tutti i C; lmkd_delta tool 0. **Adozione C>2000: NO** (manca +5% e manca memfree>300). winner_cache=**2000** (misurato).  
**Cella 3:** **SKIPPED** — prefill 512 vs 2048 **NODATA**.  
**Cella 4:** **SKIPPED** — curva blocchi 64 assente.  
**screen_off_timeout:** salvato **1800000** → set **7200000**; ripristino **PENDING** (S23 offline a fine).  
**Batteria:** ~90% → ~70% UNPLUGGED; die fino ~90 °C.  
**bin_sha256:** `cab20432…d6c8` su run.  
**Commit:** da fare sul repo padre (report + script + snapshot); non GGUF/build.  
**Blocker:** telefono offline (ssh/adb); restore timeout; C3/C4 e f45@3500 incompleti.  
**final_rc≠0.** STOP.
