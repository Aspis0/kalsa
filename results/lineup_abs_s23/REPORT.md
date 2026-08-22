# lineup_abs_s23 — queue #6-lite (absolute product-card)

Cache-sweep half of #6 **DEFERRED**. Cpuset-gated harness: **working**. Binary `/proc/pid/cpuset` recorded. `bmoe-cli.CAMPAIGN` sha `1ca51420…`.

## Cpuset gate (the validity question)

adb/`run-as com.termux` on this unplugged Awake S23:

| who | nproc | bits | Cpus_allowed_list | cpuset | verdict |
|---|---:|---:|---|---|---|
| harness r1 | 6 | 8 | 0-7 | `/` | PASS (not background/moderate; bits≥6; nproc≥6) |
| binary r1 pid 15465 | (bits 8) | 8 | 0-7 | `/` | **OK** — not the historic `0-2`/`nproc=3` failure |

Jelly's `/top-app` `0-7` `nproc=8` is a different OEM path. Root cpuset `/` with `0-7` is **not** the restricted background class the F4.3-bis gate rejects. Evidence: `results/lineup_abs_s23/probes/marco_r1_BIN_cpuset.txt`.

## Marco1c (t4, k6, no drop) — DONE 3/3

Flags: `-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --temp 0 --chatml --no-think`. Model `Marco-Mini-Instruct-KEXP.gguf` 6385238848 B sha `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777` (KEXP aboard; the i1-Q4_K_M 10.5G pin is **not** on this device).

| rep | tok/s | n_gen | hit% | MiB/tok | TTFT s | batt | temp | binary cpuset | excluded |
|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1 | 8.206 | 122 (EOS; asked 512) | 44.3 | 61.35 | 10.627 | 54→54 | 31.3→32.1 | `/` 0-7 bits=8 | no |
| 2 | 8.199 | 122 | 44.3 | 61.35 | 9.419 | 54→53 | 31.4→33.2 | `/` 0-7 bits=8 | no |
| 3 | 8.037 | 122 | 44.3 | 61.35 | 9.476 | 53→53 | 31.6→31.7 | `/` 0-7 bits=8 | no |

**Median 8.199 t/s** (min 8.037, max 8.206, spread 0.169 = 2.1%). Brightness 128, Awake, unplugged, walt, all three binary cpuset gates OK. bmoe-cli stopped at EOS (122 tokens) — decode tok/s is still the product-card metric; this is not llama-bench tg512.

ALIVE card 8.82 t/s is a different provenance (and likely the missing i1-Q4_K_M GGUF). This session's validatable number for the **KEXP file that is actually on the S23** is **8.199 t/s median**.

## CalaQwen 35B KEXP (t4, k6d1.0 no-renorm) — DONE 3/3

Flags: `-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 1.0 --drop-no-renorm --temp 0 --chatml --no-think`. Model size 13416430592, cached sha `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a`. Drop 17.4% (9340/53760), cache hit 84.5%.

| rep | tok/s | n_gen | hit% | MiB/tok | TTFT s | batt | temp | binary cpuset | excluded |
|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1 | 7.288 | 224 | 84.5 | 14.22 | 19.309 | 53→52 | 31.8→33.6 | `/` 0-7 bits=8 | no |
| 2 | 6.810 | 224 | 84.5 | 14.22 | 19.931 | 52→51 | 32.7→35.0 | `/` 0-7 bits=8 | no |
| 3 | 6.776 | 224 | 84.5 | 14.22 | 19.944 | 51→50 | 34.4→36.8 | `/` 0-7 bits=8 | no |

**Median 6.810 t/s** (min 6.776, max 7.288, spread 0.512 = 7.5%). ALIVE card 5.86 was **k6d065**; this is the current default **k6d1.0 no-renorm**, so it is expected to be faster. All three binary cpuset gates OK.

## Mellum2 Q4_K_M (t2, k6d1.0) — DONE 3/3 (dedicated binary)

`bmoe-cli.CAMPAIGN` **cannot** load Mellum2 (`error: no MoE recipe for architecture 'mellum'`). That attempt is archived as `mellum_r1` and **excluded**. Counted cells used `$HOME/bin/mellum2/bmoe-cli` sha `0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c` with its own `.so` set. Model `/data/local/tmp/_gguf_keep/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf` sha `b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7` (8071293600 B).

Flags: `-t 2 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 1.0 --temp 0 --chatml --no-think`. Drop 12.6%, cache hit 88.7%.

| rep | tok/s | n_gen | hit% | MiB/tok | TTFT s | batt | temp | binary cpuset | excluded |
|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1 | 5.195 | 222 | 88.7 | 42.78 | 12.647 | 50→49 | 34.0→36.0 | `/` 0-7 bits=8 | no |
| 2 | 5.098 | 222 | 88.7 | 42.78 | 12.160 | 49→49 | 35.0→36.1 | `/` 0-7 bits=8 | no |
| 3 | 4.977 | 222 | 88.7 | 42.78 | 12.746 | 48→48 | 34.8→36.2 | `/` 0-7 bits=8 | no |

**Median 5.098 t/s** (min 4.977, max 5.195, spread 0.218 = 4.3%). ALIVE card 5.151 is within this spread. All three binary cpuset gates OK.

## Session close

Unplugged throughout. Brightness 128, screen Awake, walt. Battery **62% → 48%**. Floor 40% not approached. Cache-sweep half of #6 not attempted.

Product-card (median of 3 cpuset-gated reps, this device, this session):

| model | median t/s | spread | ALIVE card | notes |
|---|---:|---:|---:|---|
| Marco1c KEXP t4 | **8.199** | 8.037–8.206 | 8.82 | aboard file is KEXP, not i1-Q4_K_M |
| CalaQwen 35B t4 k6d1.0 no-renorm | **6.810** | 6.776–7.288 | 5.86 (k6d065) | current default, not the retired d=0.65 card |
| Mellum2 t2 k6d1.0 | **5.098** | 4.977–5.195 | 5.151 | dedicated mellum2 binary, not CAMPAIGN |
