# F4 — BigMoeOnEdge 35B su S23 — chiusura 2026-08-06

## Cosa è stato fatto (vs piano)

- **F4.1 Build**: monorepo `b0c4e5b` + submodule `5236140e5`. Build on-device `build-bmoe` (`GGML_NATIVE=OFF`, `armv8.2-a+dotprod+i8mm+fp16`). Wrapper CXX per `platform_io.cpp` (stub ahwb: raise globale API 28 rompeva libc++). Headline usa `--dense-weights anon`.
- **F4.2 riga C**: 3+sent, cold=fadv, UNPLUGGED, cool 180s, T≤30, n_gen=64, flags PLAN (`--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4`). **INVALIDA a posteriori**: cpuset `/background` (3×A510). Vedi causa radice.
- **F4.3 cache/thread sweep**: 25 righe. **INVALIDO** stesso cpuset. Taglio C3-t5-pin (taskset 3-7) ha mostrato il salto 0.87→4.48 e svelato il confondente.
- **F4.3-bis top-app remeasure**: C-topapp (stessa config di C) + thread sweep parziale. **GATE PASS** su C-topapp.
- **Harness nproc fix** (commit `32871bd`): CSV `nproc`/`affinity_mask` da `/proc/<pid>/status` del binario (Cpus_allowed popcount + Cpus_allowed_list), non dalla shell. `gate_cpuset` in `run_f4.sh` (nproc≥6, rifiuta background/moderate). Celle F4.4-io5/cache3000/cache2500.
- **F4.4 I/O attack** (questo mandato, non K-quant di PLAN §F4.4): (1) t=3 + io-threads 5, (2) cache-mb 3000. Misura prima, report dopo. Floor batteria 40%/stop 42%.

## Punto più importante — righe PRE-TOPAPP non confrontabili

Le **29 righe** F4.2 (4) + F4.3 (25) sono state misurate in **cpuset:/background = CPU 0-2 A510 (3 core little)**. Colonne `nproc`/`affinity_mask` vuote (bug harness pre-fix). Notes marcate esplicitamente:

`PRE-TOPAPP 3-core non-confrontabile`

Elenco phase:

| phase | n | nproc colonna | note |
|---|---:|---|---|
| F4.2 | 4 | vuota | PRE-TOPAPP |
| F4.3 | 25 | vuota | PRE-TOPAPP |
| F4.3-bis | 6 | popolata (6–7) | top-app, confrontabile |
| F4.4 | 4 | popolata (3 o 8) | top-app salvo 1 demotion |

**Non confrontare** 0.96 tok/s (F4.2) o lo sweep F4.3 con C-topapp 5.06. Il gradino 0.94→0.82 delle ~12:20 non è deriva termica: è riavvio Termux via adb (reset cgroup/session).

## Causa radice (estesa)

1. Termux in **cpuset:/background** → mask tipica `0-2` (3× Cortex-A510).
2. `taskset -c 3-7` **non allarga** il cgroup: clippa solo dentro i core permessi, o (se la mask shell è già ampia) pinna i big; il salto C3-t5-pin (4.48) è stato il primo segnale.
3. **top-app** (schermo acceso, Termux in foreground) → nproc ≥6 (tipico 6–8, mask `3f`/`5f`/`df`/`ff`).
4. `nproc` della shell harness ≠ cpuset del binario se lmkd/OEM demuove a metà run: fix = leggere `/proc/<pid>/status` del bmoe-cli. Esempio F4.4 rep2: gate shell nproc=6, binario nproc=**3** mask=`07` → 1.24 tok/s (scartare dalla mediana).
5. Gradino termico falso: reboot/restart Termux, non T.

## Verdetto gate + riga C §9

Definizione PLAN: x = mediana warm best config; naive F3 ~0.10.

| | cold | warm (rep) | sent | mediana warm | hit | ttft_ms |
|---|---:|---:|---:|---:|---:|---:|
| **C-topapp** (t=4, io=4, cache=2000, top-app) | **5.06** | 5.02 / 5.08 | 4.97 | **5.02** | 56.9% | ~27.5k |

Drift sentinella: |4.97−5.02|/5.02 ≈ **1.0%** (<15%) → stage valido.

- x = **5.02 ≥ 3** → **PASS pieno** (anche ≥3× naive: 5.02 ≥ 0.30).
- Runtime `b0c4e5b`, model UD-IQ2_M 11.52 GiB, screen=on (confondente dichiarato).

### Scomposizione C-topapp (sentinella …-151408)

decode **0.201** s/tok = compute **0.116** + cache_mgmt **0.012** + flash_io **0.319** (overlap); **266 MiB/s**; mib_tok **84.73**; hit **56.9%**; RSS peak ~4.6 GB; ttft ~27.5 s.

**Collo di bottiglia = I/O** (flash_io ≈ 2.7× compute).

## F4.4 — attacco I/O

### Cella 1: F4.4-io5 (t=3, --io-threads 5, cache 2000, anon, overlap)

Stesso totale 8 “braccia”, 1 core spostato da compute a I/O.

| run_id | type | eval | nproc | mask | decode | compute | flash_io | MiB/s | note |
|---|---|---:|---:|---|---:|---:|---:|---:|---|
| …-154853 | cold | **4.85** | 8 | ff | 0.206 | 0.128 | 0.359 | 236 | OK |
| …-155713 | warm | 1.24 | **3** | **07** | 0.807 | 0.676 | 0.641 | 132 | **INVALID demotion** |
| …-160417 | warm | **4.83** | 8 | ff | 0.207 | 0.126 | 0.361 | 235 | OK |
| …-160907 | sent | **4.84** | 8 | ff | 0.207 | 0.127 | 0.357 | 237 | OK |

- Mediana warm **valida** (escluso nproc=3): **4.835** tok/s (4.83 / 4.84).
- Hit-rate **56.9%** invariato. RSS ~4.5–4.6 GB. ttft ~28–30 s.
- vs C-topapp 5.02: **−3.7%** (non guadagno).

**Lettura I/O**: flash_io **peggiora** 0.319 → **0.359** s/tok (+12.5%); throughput **266 → 236 MiB/s** (−11%). Compute sale 0.116 → 0.127 (meno thread compute). Spostare un core a io-threads **non** ha mosso il collo di bottiglia nella direzione utile: l’I/O path non scala con un worker in più su UFS 3.1 / questo packing.

### Cella 2: F4.4-cache3000 (t=4, cache-mb 3000)

- Avviata a batteria 44% (pre-cell ≥44). Gate OK T=29.4 lvl=43, binary nproc=8.
- Log `…-161628.log`: kill a metà `create_tensor` (~blk.38), **nessuna riga CSV**.
- Interpretazione: **limite RAM** (RSS atteso ~5.6 GB su 7.2; lmkd / morte sessione Termux). sshd riavviato; processo campagna sparito.
- **Non ripresa**: batteria 43% (floor stop 42); una cella incompleta vale meno del parziale documentato. cache2500 non tentata.

## Aperti

1. **ttft ~27.5 s** — ostacolo di prodotto (load+prefill); non attaccato da F4.4.
2. **Sostenuto**: F2 mostrava ~metà del burst a 10 min; ora anche schermo acceso (confondente top-app). F5 pressure/long-run ancora da fare.
3. **Hit-rate 56.9%** fermo a cache 2000: working set > budget o packing subottimale (266 vs fio ~413 MiB/s a 1 MiB).
4. **Demotion mid-run** a `/moderate` o background: gate pre-run non basta; nproc binario in CSV è obbligatorio per scartare.

## Raccomandazioni (ramo I/O)

| leva | stato | nota |
|---|---|---|
| Ripartizione core (t=3/io=5) | **misurata, no** | I/O peggiora; tenere t=4/io=4 |
| cache-mb 3000 | **lmkd mid-load** | limite RAM su 8GB; riprovare 2500 a batteria ≥80% |
| Expert packing | aperta | 84.7 MiB/tok; fio 1 MiB ~413 vs runtime 266 MiB/s |
| DirectIO | non misurato top-app | cella C2-dio era PRE-TOPAPP |
| Prefetch predittivo | F7–F8 | gate PASS pieno → F8 non obbligatorio ma utile per hit-rate |
| top-app enforcement | parziale | gate + CSV nproc; serve keep-alive foreground |

## Deviazioni / confondenti

- Schermo acceso costante (richiesto per top-app).
- F4.4 rep2 demotion: inclusa in CSV, **esclusa** da mediana.
- cache3000: morte processo, non FAIL CSV.
- Report precedente (0.96 STOP) **superato** da C-topapp; quel verdetto era artefatto cpuset.

## Prossima azione

- Ricarica telefono **≥80%**, **MAI misurare in carica**.
- Opzionale: F4.4-cache2500 (margine RAM) a batteria piena; poi PLAN F4.4 K-quant se ancora in scope.
- Non aprire F5 da questo agente. Quantizzazione non toccata.

## Commit harness rilevanti

| hash | messaggio |
|---|---|
| `32871bd` | Harness: nproc/affinity_mask dal contesto del binario (/proc/PID/status Cpus_allowed_list) |
| `0c17828` | Ri-prioritizzazione dopo il gate F4 |
| `1832451` | GATE F4 PASS 5.06 tok/s |
| `866d1cc` | 4.48 tok/s con i core giusti |
| `7f5ad50` | causa radice cpuset |

**Batteria fine sessione: 43% UNPLUGGED, T~30.9°C.**

DONE (F4.4 parziale: cella1 completa, cella2 interrotta RAM/sessione)
