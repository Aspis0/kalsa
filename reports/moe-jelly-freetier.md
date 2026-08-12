# MoE free-tier baseline — Unihertz Jelly Star (Helio G99)

**Status:** **BLOCKED** — device unreachable (adb/sshd ports closed)  
**Date attempted:** 2026-08-11  
**Target:** `192.168.1.82:5555` · product expected `Jelly_Star` · serial known from prior lab: `JELLYS0000053795`  
**Power claim (user):** STACCATO, 100% battery — **not re-verified** (no shell)

Artefacts this attempt: `results/jelly/connect_fail_20260811_094202.log`, `results/jelly/push_qwen35-4b.log`, `results/jelly/SHA256SUMS.txt` (PC only).

---

## TASK A — Inventory on arrival

| check | result |
|---|---|
| `adb connect 192.168.1.82:5555` | **REFUSED** (WinErr 10061) |
| ICMP ping `192.168.1.82` | **OK** (~90 ms RTT, TTL 64) — host up |
| TCP ports (22, 8022, 5555/6, 5037, 55555 + wireless-debug sample) | **none open** |
| mDNS `_adb-tls-connect._tcp` | Jelly **absent** (only Xiaomi 14 / S23 seen earlier) |
| Termux / bmoe-cli / llama.cpp pin | **not probed** (no shell) |
| Battery / plugged / thermal zones | **not probed** |
| `cpu_capacity` → `-t N` | **not re-measured**; prior campaign rule for this G99: cores >50% max → **`-t 2`** (2×A76 pass; 6×A55 fail). Used in trial-marco T3. |

**Prior lab state (from `reports/moe-trial-marco-interim-jelly.md`, 2026-08-10/11, not re-confirmed today):**
- Termux + API + Boot installed
- `bmoe-cli` armv8.2-a+dotprod+fp16, sha `36b01966…`
- Models then: Marco i1-Q4_K_M + KEXP (not the dense free-tier 4B)

---

## TASK B — Model push

| item | value |
|---|---|
| PC path | `moe-experiments/models/draft/Qwen3.5-4B-Q4_K_M.gguf` |
| size | **2 740 937 888** B (~2.55 GiB) |
| sha256 (PC) | `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` |
| on-device sha256 | **not computed** |
| `adb push` → `~/models/` | **not started** |
| LFM2-8B-A1B on device | **unknown** (optional; skipped) |

HF download not needed — GGUF already on PC.

---

## TASK C — Build llama-bench

**Not started.** Cannot reach Termux to check `~/llama.cpp/build*/bin/llama-bench` or rebuild @ pin `5236140e5`.

---

## TASK D — Benchmark cells (ABBA, STACCATO, `-t 2`)

**Not run.** Planned cells (for resume):

| cell | cmd | metric |
|---|---|---|
| A | `llama-bench -m ~/models/Qwen3.5-4B-Q4_K_M.gguf -ngl 0 -t 2 -p 0 -n 128 -r 2` | tg128 |
| B | `llama-bench … -p 512 -n 0 -r 2` | pp512 |
| order | A, B, A, B | ABBA 2-rep |
| cold | fadvise / `cold_model.sh` before each cell | campaign discipline |
| guards | abort batt <30% or zone >90°C; pause >85°C sustained | STACCATO daily phone |

### Cell table (empty)

| order | cell | rep | tok/s | batt% | max_temp | note |
|---|---|---|---|---|---|---|
| — | A tg128 | — | — | — | — | blocked |
| — | B pp512 | — | — | — | — | blocked |

**Product line (decode median of 4 ABBA samples):**  
**Free tier su fascia media: N/A tok/s** — measurement not obtained.

---

## S23 comparison (campaign dense free-path)

| device | model | metric | value | source |
|---|---|---|---|---|
| **S23** (Snapdragon 8 Gen 2) | Qwen3.5-4B Q4_K_M | dense eval best (F2.2c, t=4 c=1024 kv=f16) | **8.90 tok/s** | `reports/moe-f2.md` |
| **S23** | same | F1 gate eval (t=4 c=512 warm short) | 4.30 tok/s | `reports/moe-f1.md` |
| **Jelly** G99 | same, `llama-bench` tg128 `-t 2` | free-tier product | **pending** | this report |

Protocol note: S23 product number is **llama-cli eval** under F2.2c, not identical to `llama-bench` tg128 ABBA. When Jelly numbers exist, cite both with method tags; do not ratio apples-to-oranges without noting harness difference.

MoE absolute tok/s on Jelly (trial-marco T3, not free-tier dense): KEXP k6d065 med **1.63** / Marco **1.17** — relative only, not product free-tier.

---

## Deviations

1. **BLOCKER:** Wireless adb/sshd dead on Jelly despite ICMP up — classic post-reboot / screen-off loss of wireless debug (same class of issue documented in `PLAN.md` for lab phones).
2. No live battery/thermal confirmation of user “100% STACCATO” claim.
3. LFM2 optional path not checked.
4. No fadvise cold executed.
5. No build log.

---

## Thermal / battery summary

| | start | end | pauses |
|---|---|---|---|
| battery % | claimed 100 (user) / **unverified** | — | none (no run) |
| max zone °C | — | — | — |
| plugged | claimed 0 | — | — |

---

## Resume checklist (user action required)

1. On Jelly: unlock → enable **Wireless debugging** (or `adb tcpip 5555` once over USB) and/or start Termux **sshd** on a known port.
2. Confirm IP still `192.168.1.82` (or report new IP/port).
3. Re-run this mandate from TASK A; PC model + sha already staged under `results/jelly/`.

**STOP.** No further work without device shell.
