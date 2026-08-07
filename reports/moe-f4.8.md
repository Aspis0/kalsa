# F4.8 — Metrologia in carica (byte / routing)

**Data:** 2026-08-06  
**Host:** Samsung S23 (SM-S911U), Termux SSH `u0_a344@192.168.1.152:8022`  
**Stato alimentazione:** PLUGGED_AC per tutto il mandato (inizio 19% / 29.1°C → fine 20% / 37.8°C)  
**Runtime:** `bmoe-cli` 0.19.0, commit build `b0c4e5b`, binario **non toccato** (mtime 2026-08-06 10:29, md5 `c2f4797eeaaf840cdb0b53fa37f35c58`)  
**Modello:** `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` size gate **11522702304 B** (10.731 GiB)  
**Config riferimento:** `--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 -t 4 -c 512 --temp 0`  
**LD_LIBRARY_PATH:** `~/src/BigMoeOnEdge/build-bmoe/bin` (+ `cli`)  
**Artefatti grezzi:** `results/f4.8/{m1a,iobench,traces,logs}/` (mirror da `~/experiments/results/f4.8/` sul telefono)

> **Nota metodologica:** questo mandato misura **conteggi di byte** e **sequenze di routing**, non tempi di prestazione. Nessuna riga tok/s di questo mandato entra in `runs.csv` come misura confrontabile. I tempi stampati dal binario servono solo come **tagli di fase** per la serie `/proc`.

---

## 1. Cella M1a — il loader legge tutto il file? (verdetto E1)

### Setup
- Cold page cache: `cold_model.sh` → `COLD_OK` (resident_after=0).
- `bmoe-cli -n 1`, prompt `short.txt`, config di riferimento.
- Monitor 200 ms su `/proc/<pid>/{io,status}` **prima** del attach (pgrep) fino a morte processo → `results/f4.8/m1a/proc_io_status.csv` (107 campioni utili).

### Timing binario (solo taglio fasi, non prestazione)
```
prefill: 102 tokens, 8.575 s | model load 19.563 s | TTFT 28.138 s
moe-stream: read 180.2 MiB (1 token gen)
bmoe: dense-weights=anon — 1664 MiB in 613 anon buffers
bmoe: dense-weights=anon — dropped 1662 MiB of now-unused mmap pages
```
Riga `BMOE_LOAD {...}`: **assente** in questo build (timing solo come `model load … s`).

### Regola di decisione (dichiarata prima)
| condizione | verdetto |
|---|---|
| `read_bytes(load) ≥ 8 GiB` | **E1 CONFERMATA** (il loader tocca quasi tutto il file) |
| `read_bytes(load) ≤ 3 GiB` | E1 MORTA (load già magro) |
| in mezzo | riportare, non concludere |

### Tabella per fase

Finestre tagliate con `model load = 19.563 s` e `prefill = 8.575 s` dal binario; campioni `/proc` nearest; fine decode = ultimo campione con VmRSS > 500 MiB (prima del teardown).

| fase | read_bytes (GiB) | rchar (GiB) | durata s | MiB/s (su read_bytes) | VmRSS fine |
|---|---:|---:|---:|---:|---:|
| **load** | **20.760** | **1.620** | 19.563 | 1086.7 | 2828 MiB |
| prefill | 4.550 | 4.546 | 8.575 | 543.4 | 3830 MiB |
| decode | 0.301 | 0.294 | 0.561 | 549.6 | 2011 MiB |

**Delta read_bytes − rchar (load): +19.14 GiB.**  
- `read_bytes` = traffico di blocco reale (page fault mmap + O_DIRECT).  
- `rchar` = byte passati da `read()` logiche (FileReader / pread).  
- In load: rchar ≈ **1.62 GiB** ≈ trunk dense anon dichiarato (1664 MiB); read_bytes ≈ **2× file** (20.76 vs 10.73 GiB).  
- In prefill/decode: delta ≈ 0 → il traffico è quasi tutto FileReader/O_DIRECT, non nuovi fault mmap.

### Timeline load (dettaglio)
| t (s da attach) | read_bytes | rchar | VmRSS | nota |
|---:|---:|---:|---:|---|
| 5.1 | 5.52 GiB | 0.01 GiB | 4158 MiB | fault mmap in salita |
| 9.0 | 10.31 GiB | 0.01 GiB | 4379 MiB | picco RSS imminente |
| 9.6 | ≥ file (10.77 GiB) | 0.01 GiB | ~4060 MiB | **tutto il file già faultato** |
| 12–15 | 13–17 GiB | 0.01 GiB | 1250–1677 MiB | drop mmap + seconda passata I/O |
| 17.5 | 19.3 GiB | >50 MiB | — | rchar sale (anon O_DIRECT dense) |
| 19.5 | 20.76 GiB | 1.62 GiB | 2828 MiB | fine load binario |

### Bonus VmHWM
- **VmHWM = 4 521 624 kB ≈ 4416 MiB** durante il load (picco RSS campionato 4398 MiB a t≈8.8 s).  
- Spiega perché `cache-mb 3000` muore in `create_tensor`: al picco load restano pochi GiB free su un device da 6.9 GiB totali (RSS load ~4.3 GiB + kernel + Termux + buffer compute 500 MiB + cache expert 3000 MiB non ci stanno).

### Verdetto E1
**E1 CONFERMATA.**  
`read_bytes(load) = 20.76 GiB ≥ 8 GiB` (e di fatto ≥ size del file intero entro ~9.6 s, con una seconda passata che porta il cumulato a ~2×).  
Il sospetto regge: il path di load **tocca i corpi degli esperti** (fault mmap sull’intero GGUF) e poi li rilascia (`dropped 1662 MiB of now-unused mmap pages`), mentre il trunk dense viene **riletto** via O_DIRECT in buffer anon. I ~19 s di load non sono “solo 1.7–2.5 GiB di trunk”: sono un passaggio sequenziale sull’intero file più la conversione/copia dense.

---

## 2. Cella M4 — `bmoe-iobench` (curva dimensione / coda / scatter)

### Build
- `cmake -DBMOE_BUILD_TOOLS=ON` + `ninja bmoe-iobench` **solo**.  
- Binario: `build-bmoe/tools/bmoe-iobench` (44 088 B).  
- `bmoe-cli` mtime/md5 invariati.

### Regola di decisione (dichiarata prima di guardare i numeri)
| rapporto mean(scatter1) / mean(scatter3) | verdetto |
|---|---|
| ≥ 1.25× | premio repack per-esperto: si costruisce |
| < 1.10× | nessun premio: D4/N3 archiviabili |
| in mezzo | riportare, decide Claude |

Ogni riga: `--seconds 5`, model = GGUF di progetto, mode = `direct`. Alternanza A/B/A/B su (a) e (d).

### Tabella grezza completa

#### (a) domanda principale — stesso byte totali, layout scatter 3 vs 1  
`--lanes 4 --slice-kb 942 --compute-load 4`

| run | scatter | MiB/s | lat_ms | reads | read_MiB |
|---|---:|---:|---:|---:|---:|
| a1 | 3 | 905.4 | 1.36 | 14676 | 4528.92 |
| a1 | 1 | 1150.8 | 3.19 | 6247 | 5758.95 |
| a2 | 3 | 912.3 | 1.35 | 14793 | 4565.03 |
| a2 | 1 | 1136.0 | 3.24 | 6167 | 5685.20 |

- mean scatter3 = **908.85 MiB/s**  
- mean scatter1 = **1143.4 MiB/s**  
- **ratio scatter1/scatter3 = 1.258×**

#### (b) scala dimensione → banda a QD4  
`--lanes 4 --scatter 1 --compute-load 4`

| slice-kb | MiB/s | lat_ms | reads | read_MiB |
|---:|---:|---:|---:|---:|
| 264 | 844.8 | 1.22 | 16388 | 4225.03 |
| 512 | 987.6 | 2.02 | 9881 | 4940.50 |
| 942 | 1204.2 | 3.05 | 6535 | 6024.45 |
| 2048 | 1369.3 | 5.83 | 3427 | 6854.00 |

Banda monotona crescente con la slice (nessun plateau sotto 2 MiB).

#### (c) dove satura la coda  
`--slice-kb 942 --scatter 1 --compute-load 4`

| lanes | MiB/s | lat_ms | reads | read_MiB |
|---:|---:|---:|---:|---:|
| 1 | 850.6 | 1.08 | 4614 | 4253.53 |
| 2 | 1184.2 | 1.55 | 6425 | 5923.05 |
| 4 | 868.4 | 4.23 | 4713 | 4344.80 |
| 8 | 1152.6 | 6.39 | 6258 | 5769.09 |

Nota: riga lanes=4 in (c) è **più bassa** delle (a)/(b) allo stesso setting (~868 vs ~1140–1200). Deriva termica/contesa sotto carico prolungato (telefono in carica, T salita a 32.9°C a fine suite). Il picco locale è a **2 lanes** in questa sequenza; 8 lanes recupera ma con latenza 6.4 ms. Non usare (c) lanes=4 come unica stima di QD4: preferire le medie di (a).

#### (d) controllo senza `--compute-load`

| run | scatter | MiB/s | lat_ms | reads | read_MiB |
|---|---:|---:|---:|---:|---:|
| d1 | 3 | 932.1 | 1.32 | 15108 | 4662.23 |
| d1 | 1 | 1113.6 | 3.31 | 6044 | 5571.81 |
| d2 | 3 | 884.4 | 1.40 | 14337 | 4424.31 |
| d2 | 1 | 1145.6 | 3.22 | 6216 | 5730.38 |

- mean noload scatter3 = **908.25**  
- mean noload scatter1 = **1129.6**  
- ratio noload = **1.244×**  
- costo contesa CPU (compute-load 4 vs 0): ≈ **nessuno** su queste medie (ratio load/noload ≈ 1.00–1.01). La contesa non è il termine dominante sulla banda O_DIRECT di FileReader in questo setting.

### Verdetto iobench
**ratio scatter1/scatter3 = 1.258 ≥ 1.25 → premio di layout presente: il repack per-esperto ha un caso da costruire.**  
Il rapporto noload (1.244) è appena sotto soglia ma coerente in direzione; la regola primaria del mandato è sulla condizione con `--compute-load 4` (quella del motore).  
D4/N3 **non** si archiviano su questa base.

---

## 3. Cella M5 — route-trace (raccolta grezza, non analisi)

Config: stessa del gate + `--route-trace PATH`; F4.5 con `--chatml --no-think`; `-n 32` (sequenze complete, non tempi).  
Directory: `results/f4.8/traces/` (= `~/experiments/results/f4.8/traces/` sul telefono).

| file | byte | token (prefill+gen) | eventi routing | note |
|---|---:|---:|---:|---|
| `short_bench.route.tsv` | 1 364 764 | 102+32=134 | **42 880** | prompt gate |
| `f45_1_esplicativo.route.tsv` | 1 553 142 | 121+32=153 | **48 960** | IT |
| `f45_2_scrittura.route.tsv` | 1 676 178 | 133+32=165 | **52 800** | IT |
| `f45_3_istruzioni.route.tsv` | 1 477 992 | 114+32=146 | **46 720** | IT |
| `f45_4_codice.route.tsv` | 1 835 642 | 148+32=180 | **57 600** | code |
| `f45_5_ragionamento.route.tsv` | 1 993 070 | 164+32=196 | **62 720** | IT |

Controllo aritmetico: eventi = `(prefill+gen) × 40 layer × 8 expert` (es. 134×40×8=42880). Formato leggibile.

Prime 3 righe di `short_bench.route.tsv` (dopo header commenti + CSV header):
```
# route_trace v1
# model=.../Qwen3.6-35B-A3B-UD-IQ2_M.gguf arch=qwen35moe n_layer=40 n_expert=256 n_expert_used=8
# layer=0 expert_bytes=942080 dense_bytes=29262592
turn,phase,step,layer,slot,expert,weight,residency,expert_bytes,dropped
0,0,0,0,0,112,0.259001,0,942080,0
0,0,0,0,1,106,0.164165,0,942080,0
0,0,0,0,2,238,0.159192,0,942080,0
```
Nessuna analisi di routing fatta sul telefono (per mandato).

---

## 4. Cosa NON dice questo mandato

1. **Nessun tempo è confrontabile** con i run UNPLUGGED di F4.x: il telefono era **PLUGGED_AC** per tutto (carica invalida i tempi, non i conteggi di byte né le sequenze).  
2. I tok/s stampati da stdout (es. 3.3–5.1) **non** vanno in `runs.csv` come prestazione; se qualcuno li copiasse andrebbero marcati `F4.8 IN-CARICA-NON-CONFRONTABILE`.  
3. Non abbiamo patchato i contatori del runtime (binario intatto).  
4. Non abbiamo modificato `PLAN.md` né file di goal.  
5. La riga (c) lanes=4 di iobench è rumorosa (deriva sotto suite lunga): il verdetto scatter si appoggia ad (a) A/B/A/B, non a (c).  
6. E1 dice *che* il load legge tutto il file; non dice *quale* pezzo di codice è il colpevole (mmap warm di llama vs path bmoe) — quello richiede lettura sorgente / patch contatori in un mandato successivo.

---

## 5. Fallimenti
Nessuna cella fallita. Tutte e tre complete, exit 0.  
Build tools: OK. Cold model: OK. Monitor M1a: 107 campioni. iobench: 16/16 righe. traces: 6/6 file.

---

## 6. Batteria / ambiente fine mandato
- plugged: **PLUGGED_AC**, status CHARGING  
- level: **20%** (inizio 19%)  
- temp: **37.8°C** (inizio 29.1°C; salita attesa sotto carico prolungato in carica)  
- nproc osservato: 7  
- bmoe-cli: non ricostruito

## 7. Gate / stop
Mandato F4.8 **completo**. Stop qui. Nessuna fase successiva aperta.  
Prossimi passi (per gualt / PLAN, non eseguiti qui): patch loader per evitare fault esperti al load; valutazione engineering del repack per-esperto alla luce di ratio 1.26×; analisi PC delle trace.
