# lineup_abs_s23 — queue #6-lite (absolute product-card numbers)

Cache-sweep half of #6 is **DEFERRED** (not attempted).

Date: 2026-08-22
Serial: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`
Device: S23 / SM-S911U / Adreno 740. UNPLUGGED. Screen-on, brightness 128.
Harness: Termux `one_cell_lineup.sh` wrapping `bmoe-cli.CAMPAIGN` with the F4.3-bis cpuset gate (`exit 93` on harness if nproc<6 or cpuset path contains background/system-background/moderate or affinity popcount<6). **BINARY** `/proc/<pid>/cpuset` + `Cpus_allowed_list` recorded per cell. PC-side adb `run-as com.termux` only. No SIGTERM.

## Binary pin

| artifact | sha256 |
|---|---|
| bmoe-cli.CAMPAIGN | `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` |
| bin/mellum2/bmoe-cli (Mellum2 cells only) | `0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c` |

CAMPAIGN is the lineup pin for Marco and CalaQwen. It has **no** mellum architecture recipe; Mellum2 counted cells used the dedicated `bin/mellum2/bmoe-cli` (recorded, not mixed into CAMPAIGN rows).

## Models aboard (presence check 2026-08-22)

| model | path (Termux) | size | sha | status |
|---|---|---:|---|---|
| Marco1c KEXP | `$HOME/models/Marco-Mini-Instruct-KEXP.gguf` | 6385238848 | `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777` | DONE 3/3 |
| CalaQwen 35B KEXP | `$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf` | 13416430592 | `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a` (cached) | DONE 3/3 |
| Mellum2 Q4_K_M | `/data/local/tmp/_gguf_keep/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf` | 8071293600 | `b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7` | DONE 3/3 (mellum2 binary) |

Note: the older Marco `Marco-Mini-Instruct.i1-Q4_K_M.gguf` (10.5G, sha `a001d324…`) is **not** on this device. This session measures the **KEXP** Marco1c that is aboard.

## Flags (shipped lineup configs)

- **Marco1c:** `-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --temp 0 --chatml --no-think` (no drop; ALIVE: Marco ships without drop). `-n 512` requested; bmoe-cli may stop at EOS.
- **CalaQwen:** `-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 1.0 --drop-no-renorm` (current default per ALIVE).
- **Mellum2:** `-t 2 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 1.0 --temp 0 --chatml --no-think`.

Per model: 3 repetitions of the same cell with cooldown (35.0 °C / 10 min warm-start). Not back-to-back. Battery floor 40% at model start = session end (no recharge).

## Cpuset validity

Prior S23 lineup rows were unverifiable (`0-2`, `nproc=3`). This session's gate evidence is per-cell `probes/<tag>_BIN_cpuset.txt`. A cell without that file, or with `why` other than OK, is not counted.
