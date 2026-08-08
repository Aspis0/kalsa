# Report — dense double-pass: memcpy delle pagine dense residenti + drop mmap esperti

**Stato:** G-D1 PASS 8/8 · G-D2 **PARZIALE** (Δread_bytes 0.81 GiB; rchar dimezzato ma non crollato a 0.03–0.1 GiB)  
**Data:** 2026-08-08  
**Mandato:** `mandates/dense-double-pass.md` (+ addendum flight recorder)  
**Diagnosi:** `reports/research/loader-prefault-diagnosis.md` — sezione *Fix secondario* (doppio passaggio dense: warm-up mmap + O_DIRECT in `read_anonymous`)

---

## 1. Commit (2 fix sul fork) + binario

| pezzo | hash | messaggio | file |
|---|---|---|---|
| Pezzo 1 | `f907200a18503b929de1b634d0707d854ac7a03a` | `feat(moe): memcpy resident dense pages instead of O_DIRECT re-read` | `core/src/moe/dense_weights.cpp` |
| Pezzo 2 | `313cde95bc0701ca2783b367fab72d68018240b7` | `feat(moe): drop orphan expert mmap pages after rebind` | `core/src/moe/expert_stream_source.cpp` |
| base | `2c675a5` | fix KV adottato (CAMPAIGN pin) | — |

**Pezzo 1 — `read_anonymous`:** se `tensor->data` punta ancora in un VMA del GGUF, pianifica la residenza *page-by-page* con `mincore` **prima** di allocare i buffer anon; memcpy delle run residenti, O_DIRECT **solo** sui buchi (nessun fallback globale). Log permanente:

```
bmoe: dense-anon: memcpy=<MiB> odirect=<MiB> ranges_fallback=<n>
```

**Pezzo 2 — dopo rebind esperti** (`expert_stream_source.cpp`, post slot/cache rebind, pre `dense_.init`): `MADV_DONTNEED` sulle range file-backed degli esperti (simmetrico a `drop_mmap_copies`). Log permanente:

```
bmoe: expert-mmap: dropped <MiB>
```

Decode **non toccato**. CAMPAIGN / PREFAULT **intatti**.

| binario | sha256 | note |
|---|---|---|
| `bmoe-cli.DENSE2` | `cab204321d478931be1332f816fe5ed6a6fa26bde632dde45af9bf002fa0d6c8` | gate G-D1/G-D2 |
| `bmoe-cli.CAMPAIGN` | `ede3ac7cc91af03da3fcee883c22c6b99d246ae0b0a5c9426674a09608b03178` | pin campagna, read-only |
| `bmoe-cli.PREFAULT` | `5c95cb5fe2cc97f3b7a0ae4245ccca4975236b2a29f1be393d9e33ca055f059d` | via di ritorno, intatto |

`ALLOW_UNPINNED=1` annotato su entrambi i gate (DENSE2 ≠ CAMPAIGN; gate, non misura di campagna).

---

## 2. Flight recorder (addendum)

Attivo per **tutta** la suite (G-D1 + G-D2), loop ~5 s, append + fsync per riga su  
`~/experiments/results/dense2/flight.log` (copiato in `results/dense2/flight.log`).

| | |
|---|---|
| suite_start | `2026-08-08T17:54:25-0400` (`start_epoch=1786226065.656`) |
| prima riga | `1786226044.872,2026-08-08T17:54:04-0400,41.7,3309604,100` |
| ultima riga (post G-D2) | `1786227445.295,2026-08-08T18:17:25-0400,41.8,3673148,100` |
| righe totali | 260 |
| boot inatteso | **nessuno** (flight continuo, suite completa senza interruzione) |

Colonne: `ts_epoch,ts_local,die_c,memfree_kb,batt_pct`. Batteria PLUGGED_AC 100 % per tutta la durata.

---

## 3. G-D1 — byte-identità 8/8 — **PASS**

Path `-p`, config G-A: `-t 4 -c 4096 -n 200|256 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 8`.  
Prompt sha verificati vs `results/f5.5/b/prompt_sha256.txt` **prima** del lancio. Ref: `results/f5.5/b/*-k8.gen.txt`.

| prompt | result | gen_sha == ref_sha | n_prompt | tokens |
|---|---|---|---:|---:|
| short | PASS | `9a3f4175…0cb3a008` | 114 | 200 |
| f45_1_esplicativo | PASS | `2424179f…a5915675` | 121 | 200 |
| f45_2_scrittura | PASS | `71216127…5616be13` | 133 | 139 |
| f45_3_istruzioni | PASS | `baadf7b3…7caaceb0` | 114 | 135 |
| f45_4_codice | PASS | `d9c57c56…0b621376` | 148 | 200 |
| f45_5_ragionamento | PASS | `9397d763…73e71741` | 164 | 165 |
| long_conversational_it | PASS | `64f6f2bd…be1f2d41` | 143 | 256 |
| d1_long | PASS | `50b17f32…d93c21c6` | 1318 | 256 |

**8/8 PASS.** Il decode legge lo stesso buffer anon (cambia solo *come* viene riempito). Artefatti: `results/dense2/gd1/`.

---

## 4. G-D2 — misura che decide — **PARZIALE**

Harness G3 collaudato (`scripts/run_gd2_dense2.sh`, confini = riga `bmoe: expert streaming ON`, sampler on-device ~200 ms). A/B **CAMPAIGN vs DENSE2**, cache fredda (`fadvise`) prima di ogni run, 2 ripetizioni per braccio (scarto <15 % → no 3ª). Telefono in carica: **conteggi citabili**, nessun timing citabile come conclusione.

### 4.1 Mediane (B2)

| metrica | CAMPAIGN (mediana) | DENSE2 (mediana) | Δ |
|---|---:|---:|---:|
| `read_bytes_at_load` | 10 932 715 520 (**10.18 GiB**) | 10 060 343 296 (**9.37 GiB**) | **−0.81 GiB** |
| `rchar_at_load` | 1 779 929 396.5 (**1.66 GiB**) | 897 977 331 (**0.84 GiB**) | **−0.82 GiB** |
| `VmHWM_at_load` | 2907.85 MiB | 2586.4 MiB | **−321 MiB** (migliora) |

### 4.2 Per run + strumentazione

| run | rb GiB | rchar GiB | VmHWM MiB | log dense-anon / expert-mmap |
|---|---:|---:|---:|---|
| CTRL_r1 | 10.20 | 1.67 | 3020.5 | (CAMPAIGN: no log dense-anon) |
| CTRL_r2 | 10.16 | 1.65 | 2795.2 | — |
| NEW_r1 | 9.34 | 0.83 | 2564.0 | `memcpy=840 odirect=824 ranges_fallback=671` · `expert-mmap: dropped 9313 MiB` |
| NEW_r2 | 9.40 | 0.85 | 2608.8 | `memcpy=790 odirect=873 ranges_fallback=673` · `expert-mmap: dropped 9313 MiB` |

### 4.3 Regole di decisione (mandato)

| regola | esito |
|---|---|
| Δread_bytes ≥ 1.3 GiB **e** rchar crollato **e** VmHWM non peggiorato → PASS | Δ = **0.81** → non ≥ 1.3 |
| Δ fra 0.5 e 1.3 GiB → **PARZIALE** | **sì** (0.81) |
| Δ < 0.5 o rchar invariato → STOP | no (rchar dimezzato) |
| VmHWM peggiora → STOP | no (migliora) |

**Verdetto: PARZIALE.**

### 4.4 Perché non PASS (diagnosi, non forzatura)

- **Pezzo 1 scatta**, ma solo su ~half del trunk denso: mediana `memcpy≈815 MiB` su 1664 MiB totali, `odirect≈850 MiB`, `ranges_fallback≈670` run non-residenti.
- **rchar** scende 1.66 → 0.84 GiB (−0.82), allineato al volume memcpy — **non** al target 0.03–0.1 GiB (che richiederebbe quasi tutto il dense da memcpy).
- **Causa del fallback:** al momento del piano `mincore` (dopo capture warm-up + drop 9313 MiB esperti), circa metà delle pagine dense **non è residente**. Con `mmap_prefetch=-1` (CAMPAIGN) il populate eager è spento; il warm-up faulta il dense, ma sotto pressione (alloc cache/slot, drop massivo, free RAM che crolla a decine di MiB in flight durante il load) parte del trunk è già reclaimata prima della conversione anon. Il piano page-by-page pre-alloc evita di *peggiorare* il quadro, ma non può copiare pagine già assenti.
- **Pezzo 2** funziona come dichiarato: `dropped 9313 MiB` stabile; riduce page cache orfana (VmHWM DENSE2 più basso di CAMPAIGN), non l’I/O già speso.
- **Nessun difetto di byte-identità:** G-D1 8/8 prova che i buchi O_DIRECT riempiono lo stesso buffer che CAMPAIGN riempiva interamente via flash.

---

## 5. Artefatti

| path | contenuto |
|---|---|
| `results/dense2/flight.log` | flight recorder intera suite |
| `results/dense2/suite_start.txt` | marker inizio |
| `results/dense2/gd1/` | G-D1 8/8 (gen, meta, stderr con log) |
| `results/dense2/gd2/VERDICT.txt` | verdetto G-D2 + per-run |
| `results/dense2/gd2/runs/*.summary.txt` | metriche + instr |
| `scripts/run_gd1_dense2.sh` / `run_gd2_dense2.sh` | harness usati |

---

## 6. Cosa **non** è stato fatto (per mandato)

- Nessun re-pin di CAMPAIGN (decide gualt).
- Nessun tocco a `../ai-chat`, `PLAN.md`, PREFAULT, decode path.
- Nessun `complete_goal`.
- Nessun commit di GGUF/build.

---

## 7. Follow-up suggeriti (fuori scope di questo mandato)

1. **Alzare la frazione residente al momento del piano:** posticipare il drop esperti *dopo* la conversione dense (o fare il drop solo delle range esperto *non* adiacenti al dense già faultato), oppure un touch esplicito delle sole dense ranges dopo il warm-up e prima del piano `mincore`.
2. **Misurare** se con drop esperti *dopo* dense il `memcpy` sale verso ~1664 MiB e rchar crolla a 0.03–0.1 GiB (firma target Pezzo 1).
3. Se gualt adotta comunque: re-pin DENSE2 → CAMPAIGN solo dopo eventuale 2ª passata che spinga Δread ≥ 1.3.

---

## 8. Sintesi operativa

| gate | esito |
|---|---|
| G-D1 byte-identità | **8/8 PASS** |
| G-D2 Δread / rchar / VmHWM | **PARZIALE** (Δ 0.81 GiB; rchar −50 %; VmHWM migliora) |
| Flight recorder | **attivo** (260 righe; ultima `18:17:25-0400 die=41.8C memfree≈3.5 GiB batt=100`) |
| Adozione | **non proposta come pin** finché Δ < 1.3; pezzi corretti e strumentati, effetto parziale per residenza incompleta al conversion time |

**STOP al report.**
