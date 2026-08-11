# moe-calaqwen-scheda

**Mandato:** `mandates/calaqwen-sessione-s23.md` (v2 POST-AUDIT)  
**Device:** Galaxy S23 · **UNPLUGGED** tutta la sessione · batt 87%→79%  
**Config default A:** KEXP (`ac44e20c…`, size 13416430592) · CAMPAIGN `1ca51420…` ·  
`-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65 --temp 0 --chatml --no-think`  
**Guardrails device sha:** `18a44e1c…` (= commit `74bbb4d` content)  
**Artefatti:** `results/calaqwen_s23/` · driver `scripts/run_calaqwen_s23.sh`  
**Finestra:** 2026-08-11 ~00:59–01:20 EDT · STATUS **DONE**

---

## BLOCCO 1 — scheda prodotto

### Decode sostenuto (short, n_predict=512)

| rep | tok/s | n_gen | prefill t/s | hit% | drop% | MiB/tok | die med/p90/max | wall_s |
|-----|-------|-------|-------------|------|-------|---------|-----------------|--------|
| r1 | **5.487** | **199** | 11.7 | 75.9 | 5.1 | 40.36 | 85.9 / 89.5 / **91.6** | 57 |
| r2 | **4.846** | **199** | 9.9 | 75.9 | 5.1 | 40.36 | 70.9 / 73.7 / 74.5 | 65 |

- **n_gen reale = 199** (EOS greedy; non raggiungibile 512 — come predetto dal mandato).
- Mediana decode short: **~5.17 tok/s**.
- r1 termico alto (max 91.6°C) — vicino RescueParty; r2 più fresco.

### Decode lungo termico (prompt degenerato elenco)

| tok/s | n_gen | hit% | die max | wall |
|-------|-------|------|---------|------|
| 5.349 | **102** | 79.9 | 74.5 | 37 |

- **FAIL obiettivo ≥400 token:** EOS a 102. Cella utile solo come burst corto, **non** come finestra termica lunga.
- A verbale: serve prompt ancora più “anti-EOS” o sampling non-greedy se si vuole ≥400 (fuori scope binario pinnato senza `--ignore-eos`).

### Load cold (n=16 proxy)

| rep | wall_s | tok/s | die max |
|-----|--------|-------|---------|
| r1 | 26 | 4.63 | 85.9 |
| r2 | 26 | 4.44 | 83.5 |

Load+decode corto ~**26 s** wall (non isola pure load_s dal BMOE_DONE in questa harness).

### Conversazione 5 turni KV

| esito | dettaglio |
|-------|-----------|
| **PARZIALE / FAIL metro** | `turns.json` = `[]`, **0× BMOE_DONE** parsati da `--session` |
| rc processo | 0 |
| nota | protocollo session JSONL non ha emesso DONE leggibili (stesso sintomo del blocco N1). **TTFT multi-turno non citabile** da questa run. |

### Energia (metodologia D — flight 1 s, current µA / voltage mV)

| cella | E (J) | n_gen | J/token |
|-------|-------|-------|---------|
| sos_short_r1 | 90.5 | 199 | **0.455** |
| sos_short_r2 | 92.7 | 199 | **0.466** |
| sos_long_thermal | 42.8 | 102 | **0.420** |
| **mediana** | | | **0.455** (range 0.420–0.466) |

- `I_idle` mediano (idle pre/post) = **−430000 µA** (segno: device in scarica anche “idle” con schermo ON).
- Sanity mandato ~0.75–0.95 J/tok: valore misurato **più basso** — possibile bias idle/segno/finestre; **citabile come stima flight**, non come verità assoluta.
- **Non** da Δbatt% (1% troppo grossolano).

---

## BLOCCO 2 — decomposizione N1 v2

### Controllo decode one-shot

| cella | tok/s | n_gen | n_prompt | die max |
|-------|-------|-------|----------|---------|
| ctrl_decode1 | 5.513 | 64 | 114 | 91.6 |
| oneshot_p128 | 4.625 | 32 | 315 | 90.8 |

`t_decode1` grezzo (ctrl): ~5.5 tok/s → tempo/token ≈ **0.18 s**.

### Sweep session k ∈ {0,8,32,64,128,256} × 2 rep

| k | status | n_prompt | note |
|---|--------|----------|------|
| tutti | **SCARTATA** | `null` | `n_dones=0` — nessuno BMOE_DONE da `--session` |

**Fit `t_prefill = F + m·n_prompt`:** **INSUFFICIENT_DATA** (0 righe OK).

| verdetto N1 | |
|-------------|--|
| **NON CONCLUSIVO** | bug/protocollo session (nessun n_prompt misurato). **Non** riaprire MTP-spec su questi dati. **Non** epitaffio. Serve fix harness session + re-run B2. |

---

## BLOCCO 3 — cache bracket bidirezionale

Ordine interleaved: 2000→1500→2000→1750→2000→2300 · f45_1 · n=200 · **tutte n_gen=200 ≥100 (citabili)** · **zero abort**.

| cache MiB | rep | tok/s | hit% | MiB/tok | die max | rc |
|-----------|-----|-------|------|---------|---------|-----|
| **2000** | r1 | 4.051 | 79.7 | 31.68 | 72.5 | 0 |
| **1500** | r1 | **4.116** | 74.2 | 45.93 | 66.0 | 0 |
| **2000** | r2 | 4.050 | 79.7 | 31.68 | 66.8 | 0 |
| **1750** | r1 | 3.974 | 76.4 | 40.28 | 65.2 | 0 |
| **2000** | r3 | 4.076 | 79.7 | 31.68 | 66.4 | 0 |
| **2300** | r1 | 3.883 | 81.7 | 26.23 | 66.4 | 0 |

### Analisi vs control C2000

- Mediana C2000 tok/s = **4.059** (4.051 / 4.050 / 4.076).
- C1500: +1.4% (rumore; **MiB/tok peggiora** 32→46).
- C1750: −2.1%.
- C2300: −4.3% (entro ±6%; **non abort** — attesa audit “abort probabile” **falsificata** in questa finestra batt~80%, die fresco).

**Soglia ≥6% per candidato:** **nessuno**.  
**Esito:** **cache 2000 resta default.** 1500/1750 non pagano speed; 1500 costa più flash/tok. 2300 non migliora e non è necessario.

---

## Sintesi prodotto CalaQwen (default A, staccato)

| metrica | valore | confidenza |
|---------|--------|------------|
| Decode short med | **~5.2 tok/s** | alta (2 rep, n_gen=199) |
| Decode f45 n=200 @cache2000 | **~4.06 tok/s** | alta (3 rep interleaved) |
| n_gen sostenuto | **199** (EOS) | alta |
| PPL ref (grid k6d065) | **1.852** | da griglia KEXP (non re-misurata qui) |
| J/token stima flight | **~0.45** | media (segno idle / finestre) |
| KV 5-turn TTFT | **NON MISURABILE** questa run | session FAIL |
| N1 F, m | **NON MISURABILE** | session FAIL |
| Cache default | **2000 MiB conferma** | alta |

---

## Gap aperti (per gualt / prossima sessione)

1. **Fix `--session` harness** (BMOE_DONE / n_prompt) → re-run conv5 + N1 v2.
2. **Decode ≥400 termico:** prompt anti-EOS o policy sampling (senza `--ignore-eos`).
3. **Energia:** validare segno `current` idle vs load; eventuale clamp I−I_idle.
4. Screen restore: script ha loggato "screen restored"; `settings get` da SSH può fallire per permission Termux (non bloccante).

**STOP ai gate.** Adozione/default già A; questa run **conferma speed staccato e cache 2000**, **non** chiude N1/KV.
