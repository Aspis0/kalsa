# SPEED VERDICT — Marco1c on Jelly Star (ranking only)

**Date:** 2026-08-13  
**Device:** Unihertz Jelly Star (Helio G99, 8 GB) · Termux ssh `u0_a225@192.168.1.82:8022`  
**Question:** product cell for Marco1c (KEXP-1c) under campaign k6d065. Absolute tok/s **not product-citeable**; I/O regime is.  
**Status:** COMPLETE · 4/4 runs · UNPLUGGED entire session

---

## File identity

| id | path | size B | sha256 |
|---|---|---:|---|
| **Marco1c** | `~/models/Marco-Mini-Instruct-KEXP.gguf` | 6 385 238 848 | `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777` |
| Binary | `~/bin/bmoe-cli.JELLY` | — | `36b01966ba0f471d17f8fcb29ab49f64f760999c4256f612f959a7a0b178ce81` |

Retired Marco-Q4KM (`Marco-Mini-Instruct.i1-Q4_K_M.gguf`, 10 505 424 704 B, sha `a001d324…`) deleted on this device before the push. Log: `results/lineup_card/jelly_delete_marco_q4km.log`.

---

## Protocol

`-t 2 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65 --temp 0 --chatml --no-think`

- ABBA of the two campaign prompts (`p_fact` sha `b5301c32…`, `p_creative` sha `761db0d0…` — byte-identical to S23 phase-1 / Xiaomi).
- Order: fact → creative → creative → fact (same single-config ABBA as Xiaomi CalaQwen).
- n=200, cold fadvise (`~/bin/cold_model.sh`) every run.
- UNPLUGGED, batt floor 35%, battery-temp abort 45 °C.
- **MemAvailable guard** (NOT MemFree): abort if `< 300 MiB` sustained 60 s. Never fired. Start MemAvailable 5.75–5.68 GiB (`memavail_start_kib` 6 031 160 → 5 950 740); during-run samples ~2.95–3.02 GiB.

Battery: 74% → 72%. Peak battery temp 32.0 °C. No thermal wait, no plug, no RAM abort.

---

## Absolute numbers (medians, n=4)

| cell | decode tok/s | MiB/tok | hit% | TTFT s | load s |
|---|---:|---:|---:|---:|---:|
| **ARM_1C** | **3.642** | **51.58** | **53.4** | 8.65 | 2.61 |

Per-run:

| prompt | o | tok/s | MiB/tok | hit% | TTFT | load | n_gen | batt |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| fact | 1 | 3.594 | 52.68 | 52.3 | 9.633 | 3.114 | 200 | 74→73 |
| creative | 2 | 3.770 | 50.48 | 54.5 | 8.353 | 2.610 | 200 | 73→73 |
| creative | 3 | 3.690 | 50.48 | 54.5 | 8.379 | 2.618 | 200 | 73→72 |
| fact | 4 | 3.576 | 52.68 | 52.3 | 8.922 | 2.606 | 200 | 72→72 |

Median decode = (3.594 + 3.690) / 2 = **3.642**.  
Median MiB/tok = (50.48 + 52.68) / 2 = **51.58**.  
Median hit% = (52.3 + 54.5) / 2 = **53.4**.

I/O regime matches S23 Marco1c (51.50 MiB/tok / 53.45% hit) to the reported digit. Decode is ~2.4× slower than S23 8.819 — expected on G99, ranking-only.

---

## Artifacts

| path | content |
|---|---|
| `runs_speed.csv` | 4 data rows + header |
| `SPEED.master.log` | device master log |
| `logs/<cell>_<prompt>_oN/` | stdout / stderr / combo / cmdline / tail |
| `mem/<label>.csv` | MemFree+MemAvailable every 5 s |
| `prompts/` | byte-identical campaign prompts |
| `kexp1c.sha256` / `bin.sha256` | pins |
