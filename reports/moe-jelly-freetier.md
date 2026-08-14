# MoE free-tier baseline — Unihertz Jelly Star (Helio G99)

**Status:** **DONE 2026-08-14** — 4B dense product **3.52 tok/s** llama-bench tg128 `-t 2` (median of 4 ABBA decode samples). Bottom of the free-tier ladder (below 2B 8.04 and LFM k4 10.60).  
**Date attempted:** 2026-08-11 (BLOCKED) · **closed:** 2026-08-14  
**Target:** `192.168.1.82:44395` · product `Jelly_Star` · serial `JELLYS0000053795`  
**Power:** UNPLUGGED 100% → 90%, battery temp 30.0 → 37.0 °C, `mWakefulness=Awake` every cell.

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

---

## 2026-08-14 close — Qwen3.5-4B dense llama-bench ABBA `-t 2`

Jelly reachable again (`adb` `192.168.1.82:44395`, ssh `:8022` `u0_a225`). Campaign binary **untouched**. Model pushed + sha-verified on device. ABBA ran UNPLUGGED.

Artefacts: `results/jelly_4b_baseline/` (runs.csv, battery_poll.log, SHA_RECORDS.txt, A1/A2/B1/B2 json+err, run_cell.sh).

### Inventory (TASK A, live)

| check | result |
|---|---|
| `adb` | `192.168.1.82:44395` device product `Jelly_Star` serial `JELLYS0000053795` |
| ssh | `u0_a225@192.168.1.82:8022` OK |
| `~/bin/bmoe-cli` | sha `36b01966ba0f471d17f8fcb29ab49f64f760999c4256f612f959a7a0b178ce81` **before and after MATCH** |
| `-t 2` | cpu_capacity 6×348 + 2×1024 (A55/A76) — unchanged campaign rule |
| battery / plugged / screen | 100% UNPLUGGED, 30.0 °C, `mWakefulness=Awake` at start |
| llama.cpp tree | **absent** (`~/llama.cpp` missing) |

### Model (TASK B)

| item | value |
|---|---|
| PC | `models/draft/Qwen3.5-4B-Q4_K_M.gguf` · 2 740 937 888 B |
| scp | `~/models/Qwen3.5-4B-Q4_K_M.gguf` (~196 s wireless) |
| sha256 PC + device | `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` **MATCH** |

### llama-bench (TASK C)

No on-device rebuild (would heat timed cells; Termux clang exists but PC is transfer-only tonight). Transferred existing NDK binary:

| item | value |
|---|---|
| path | `~/opt/llama-bench/llama-bench` (does **not** replace `~/bin/bmoe-cli`) |
| sha256 | `e9c25631134b697c5ccb32e73514ed46ce7f6c14173126d2cbd9eca39d392c56` |
| source | `build-android-opencl-cpufix` · llama.cpp `a92a51627` b9969 · Clang 18.0.2 · `-march=armv8.2-a+dotprod+fp16` |
| vs report pin | TASK C asked `5236140e5`. **Deviation:** used `a92a51627` (same fork, later). Dense Q4_K_M tg128 does not need the OpenCL Adreno path. |
| OpenCL | `ggml_opencl: platform IDs not available` (Mali). `-ngl 0`. JSON `backends: OpenCL` / `cpu_info: CPU` / `n_gpu_layers: 0`. |
| libc++ | NDK 27 `libc++_shared.so` next to the binary |

### ABBA (TASK D)

No named ABBA **anchor model** in this report (unlike G99 KEXP's A0). Did **2+2 cold reps** of the 4B itself: A=tg128, B=pp512, order A B A B. `cold_model.sh` / `fadv` before every cell. `llama-bench -ngl 0 -t 2 -r 2 -o json`.

| order | cell | test | samples_ts | avg | batt% | °C | screen | note |
|---|---|---|---|---|---|---|---|---|
| 1 | A1 | tg128 | 3.53205, 3.5317 | **3.532** | 98→97 | 31→32 | Awake | tight |
| 2 | B1 | pp512 | 5.00219, 5.00406 | **5.003** | 97→94 | 32→35 | Awake | tight |
| 3 | A2 | tg128 | 3.51559, **2.08774** | 2.802 | 94→93 | 35→36 | Awake | rep2 drop |
| 4 | B2 | pp512 | 3.93398, 3.84991 | 3.892 | 93→90 | 36→37 | Awake | ABBA drift |

**Product (decode median of 4 ABBA tg128 samples):**  
sorted 2.08774, 3.51559, 3.5317, 3.53205 → median **3.52 tok/s**.

Tight cluster (3/4 samples): **3.52–3.53**. A2-rep2 2.09 is session drift (RAM 7.3/7.6 GiB after the 2.55 GiB mmap, battery 36 °C, 15-min load ~23). B1→B2 5.00→3.89 is the same drift on prefill — ABBA did its job.

### Ladder vs 2B 8.04 and LFM k4 10.60

| rung | model | tok/s | harness | vs 4B |
|---|---|---|---|---|
| top | LFM2.5-8B-A1B Q4 k=4 | **10.60** | `bmoe-cli` n=200 `-t 2 -c 1024` (`moe-g99-freetier.md`) | 4B is 0.33× |
| mid | Qwen3.5-2B Q4_K_M | **8.04** | same bmoe-cli harness | 4B is 0.44× |
| **bottom** | **Qwen3.5-4B Q4_K_M** | **3.52** | **llama-bench tg128 `-t 2`** (this cell) | — |

**Verdict:** 4B dense is the **slowest free-tier rung on G99**. It does not replace 2B (8.04) and it does not approach LFM k4 (10.60). Physics check: 4.21 B / 1.88 B ≈ 2.24× the 2B; 8.04 / 2.24 ≈ 3.59 — measured 3.52. Bandwidth/compute scaling, not a surprise.

**Harness tag (do not ratio blindly):** 8.04 / 10.60 are `bmoe-cli` n=200; 3.52 is `llama-bench` tg128. Direction is not in doubt (4B cannot beat 2B on the same 2×A76). A same-harness bmoe-cli n=200 of the 4B was **not** run (report plan is llama-bench; battery 90% / 37 °C at close).

S23 comparison stays method-tagged: S23 F2.2c eval **8.90** and S23 llama-bench tg256 `-t 4` **8.38** (`moe-litert-product-classes.md`) vs this Jelly llama-bench tg128 `-t 2` **3.52**.

### Guards / deviations

- UNPLUGGED the whole block. Floor 35% / abort 43 °C never hit (min 90%, max 37.0 °C battery).
- `dumpsys power | grep mWakefulness=` = **Awake** on every cell + 5-min poll (`battery_poll.log`). `screen` column in `runs.csv`.
- S23 and Xiaomi not touched (`adb -s 192.168.1.82:44395` / ssh only).
- Campaign pin verified before transfer, before A1, and after B2.
- llama-bench commit `a92a51627` ≠ report `5236140e5` (transfer of existing NDK build; no on-device compile).
- No report-named ABBA anchor on device → 2+2 cold reps of the 4B.
- Screen-off timeout briefly written to 1800000 then restored to 2147483647 (was already infinite).
- `termux-wake-lock` not installed; screen stayed Awake anyway.

