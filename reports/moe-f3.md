# F3 — Il muro (mmap naive 35B) — 2026-08-05

## Cosa è stato fatto (vs piano)

### Harness F3 — **COMPLETATO (PC + sync telefono pre-reboot)**
- `scripts/run_f3.sh`: grid runner fail-closed
  - model hard gate `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` size **11522702304** B
  - n_gen=32, ctx=512, kv=q8_0, threads=4, binary **solo** `build-safe/llama-cli` pin 67d5978
  - varianti: `default` → phase `F3`; `--numa distribute` → `F3-numa`; `--no-warmup` → `F3-nowarmup`
  - cooldown ≥180 s, cool ≤30.0°C, abs start ≤32°C, floor batteria 40% → **CHARGE_NEEDED exit 92** (niente attesa caricabatterie)
  - majflt_gate=50000 come covariata (in F3 atteso regime alto su tutte le run)
  - lmkd/OOM = dato valido (run_bench exit 1 + riga FAIL se presente)
  - no network, no broad pkill, flags column via `--flags`
- `scripts/start_f3.sh`: wrapper detached + `f3_state/F3.state` + console/pid per variante
- `scripts/test_f3.sh`: offline **15/15 PASS** (bash -n, size gate, cooldown/cool rejects, build/ refuse, no pkill/network, phase tags + flags)
- Flag support verificato sul pin 67d5978 **prima** di scrivere le varianti:
  - `--numa TYPE` (distribute|isolate|numactl) presente
  - `--warmup / --no-warmup` presente
  - scelta B2: `--numa distribute` (path NUMA → MADV_RANDOM su mapping modello)

### Pre-misura telefono (pre-reboot) — **OK**
| Check | Valore |
|---|---|
| SSH | `u0_a344@192.168.1.152:8022` OK |
| Model size | **11522702304** MATCH |
| Binary | `~/src/llama.cpp/build-safe/bin/llama-cli` pin **67d5978** |
| Battery | **93% UNPLUGGED** DISCHARGING |
| Temp | **27.8°C** (≤30.0 sentinel) |
| Residual campaign PID | nessuno (solo sshd + termux-api) |
| Uptime pre-reboot | 1d 12h 52m |
| Script sync | `run_f3.sh` + `start_f3.sh` su `~/experiments/scripts/` |

### Cold run variante default (riga B) — **NON ESEGUITO**
1. `adb reboot` emesso alle **2026-08-05T16:46:25-04:00** (wireless adb `adb-R3CW406P8CV-zyLM4b`, SM-S911U).
2. Telefono **risponde al ping** su 192.168.1.152 (TTL 64, RTT ~50–400 ms) → IP stabile, host vivo.
3. **Porta 8022 chiusa** (Connection refused) da ~16:47 fino a ≥17:08 (~21 min post-reboot).
4. **Wireless adb** non riappare (lista devices vuota; scan porte 5555 / 37000–37200 / 40000–40100 / 44000–44100: nessun listener).
5. Nessun touch fisico del telefono (regola operatore). Nessun retry infinito.
6. **STOP** per protocollo: timeout connettività post-reboot 15–20 min superato.

### Varianti non avviate
| Variante | Phase tag | Stato |
|---|---|---|
| default mmap | F3 | **non partita** (manca cold post-reboot) |
| `--numa distribute` | F3-numa | non partita |
| `--no-warmup` | F3-nowarmup | non partita |

## Numeri chiave (tabella, riferimenti a run_id)

| Voce | Valore | run_id / artefatto |
|---|---|---|
| Rows phase `F3` | **0** | — |
| Rows phase `F3-numa` | **0** | — |
| Rows phase `F3-nowarmup` | **0** | — |
| Median eval tok/s cold (B) | **n/d** | cold non eseguito |
| Median eval tok/s warm (B) | **n/d** | warm non eseguito |
| majflt_delta / token | **n/d** | — |
| lmkd / OOM events | **n/d** | — |
| Page-cache warm gain % | **n/d** | — |
| Battery end | **sconosciuta** (no SSH post-reboot; pre-reboot 93% UNPLUGGED) | pre: termux-battery-status 16:46 |

### Tabella §9 (celle F3)

| ID | Configurazione | tok/s cold | tok/s warm | hit-rate | majflt/tok | MB flash/tok | RAM peak | Note |
|---|---|---:|---:|---:|---:|---:|---:|---|
| B | 35B UD-IQ2_M, mainline mmap naive | — | — | n/a | — | — | — | **BLOCKED connettività post-reboot**; harness pronto |
| B2 | come B + --numa distribute | — | — | n/a | — | — | — | non avviata |

Celle non misurate = "—" (regola §8.2). Mai inventare numeri.

## Deviazioni / sorprese / bug
- **Termux:Boot non ha ripristinato sshd** entro 21 min nonostante ping OK e (premesse operatore) no screen lock. Possibili cause non verificate senza accesso: Termux non auto-avviato, Doze aggressivo post-boot, wireless debugging da ripaiare (porta mDNS cambia a ogni sessione — noto da campagna).
- `adb reboot` ha funzionato; recovery wireless adb **non** automatica (atteso senza re-pair).
- Carico pre-reboot: load average alto (10/6.9/6.1 al momento del reboot) ma **nessun** PID campagna residuo — solo rumore di sistema.
- Harness F3 non ha potuto produrre CSV rows: zero rischio di righe spurie.

## Verdetto gate: **BLOCKED(connettivita post-reboot)**

F3 è pura misura: non c’è FAIL scientifico possibile. Qui il gate è **bloccato operativamente** prima di qualsiasi run 35B. I numeri naive **non** sono ancora registrati → Gate F3 **non** chiuso PASS finché non c’è almeno una serie cold/warm default (riga B) su telefono raggiungibile.

Harness + test offline + preflight modello/binary/batteria = pronti. Manca solo connettività post-cold-boot.

## Prossima azione proposta
1. **Operatore**: sbloccare/riaprire Termux sul S23 (o verificare Termux:Boot), ripristinare sshd su :8022; se serve, re-pair wireless adb (dialog pairing code, porta mDNS nuova).
2. Verificare: `ssh … 'uptime; termux-battery-status; SIZE=$(stat -c %s ~/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf)'` → size 11522702304, UNPLUGGED, batteria **≥40%** (idealmente ricarica a **≥80%** prima di rifare F3 se scarica — regola §8.2; pre-reboot era 93%).
3. Se uptime è ancora “fresco” post-reboot e page cache non è stata riscaldata da altri job: lanciare subito  
   `bash ~/experiments/scripts/start_f3.sh --variant default --first-run-type cold`  
   Altrimenti: un altro `adb reboot` / cold cycle e ripartire da variante default.
4. Poi in sequenza (mai due varianti in parallelo): F3-numa (reboot+cold), F3-nowarmup se budget batteria.
5. Pull `runs.csv`, `f3_state/`, logs → `results/f3/`; riempire §9 B/B2; **non** aprire F4 finché F3 non ha numeri.

**Non avviato F4. Non toccati goal files. Telefono non toccato fisicamente.**
