# KERNEL K-E — i8mm as a heat/energy lever (not a speed lever)

**KE_NULL.** CPU-time/token −6.3% on `/proc` is a **n_gen confound** (dotprod greedy EOS at 144, i8mm at 177 — prefill amortized over more tokens). Engine decode cpu-s/token **+1.1%**. Compute s/tok **+2.7%**. Iavg **−1.0%**. Sustained late-rep wall **−9.6%**. Wall tok/s −2.4% (inside the −3% band). The S3b 389 vs 495 µs bench win did not survive the full model mix.

**Date:** 2026-08-14
**Device:** Galaxy S23 · Termux ssh `u0_a344@192.168.1.152:8022` · adb `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`
**A (dotprod):** Mellum2 cells = mellum2 pin `0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c`. CalaQwen = campaign pin `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`.
**B (i8mm):** `~/bin/kernel_ke/bmoe-cli` `590e72543b4640f2c1f266e883e72d044d5259d2b55ca7a0e08571117d13762b`
**Source:** BigMoeOnEdge `d987027` (mellum-recipe) + llama.cpp `e5605f3`. New tree `build-android-kernel-ke`. `-j 6`.
**ONLY cmake delta vs mellum2 pin:** `GGML_CPU_ARM_ARCH=armv8.6-a+dotprod+fp16+i8mm` (A is `armv8.2-a+dotprod+fp16`). `HAVE_MATMUL_INT8` Success.
**Campaign / mellum2 / kernel_s1 / kernel_s2 pins:** MATCH before push and after stop. Never written.
**Regime:** UNPLUGGED 97→89%. Peak 38.5 °C. Floor 45% / abort 43 °C never tripped. Screen **Awake** on every timed cell (host adb `mWakefulness` + `KEYCODE_WAKEUP`).

---

## Why A is not the campaign ELF on Mellum2

Campaign `1ca51420` is `d408e03`. Mellum2 streaming needs the `mellum` recipe row added in `d987027`. Without it `--moe-stream` cannot bind `ffn_{gate,up,down}_exps`. The mellum2 pin is that commit with campaign flags (dotprod, no i8mm). That is the only A/B that isolates the arch flag on Mellum2. CalaQwen already streams on the campaign ELF (`qwen35moe` recipe).

---

## What i8mm can and cannot do on this binary

`Session::open` sets `use_extra_bufts = false` (load-bearing for stream rebind). S3b's 388.69 vs 495.50 µs win is the **REPACK extra-buffer** `q4_K_8x8` path. That path does not run here.

`+i8mm` still defines `__ARM_FEATURE_MATMUL_INT8`. In `quants.c` the Q4_K / Q8_0 i8mm `vec_dot` is `nrc == 2` only. Stock `MUL_MAT_ID` decode is `nrc == 1`. Prefill GEMM may see nrc>1. So the on-model decode mix was expected to dilute — and it did, to noise.

---

## Protocol

UNPLUGGED. Floor 45%. Abort 43 °C. Screen from host adb `mWakefulness` (Termux `dumpsys power` is SELinux-empty). `termux-wake-lock` + `screen_off_timeout=7200000` during the window; restored to 1800000 after.

Per rep:

- wall tok/s, compute s/tok (bmoe stdout)
- CPU-time/token = Δ(utime+stime) `/proc/<pid>/stat` / n_gen (`CLK_TCK=100`). **Also** the engine's own `cpu-s/token over N threads` (decode only).
- battery: host adb `dumpsys battery` `current now` (mA) every 5 s + on-device samples. J = Σ |I_mA| · V_mV · dt / 1e6. J/token = J / n_gen
- temp start/end, screen column

Cells:

1. Mellum2 k6 d1.0 t2 n=200, 2 cold reps/binary, fadvise DONTNEED. Order **ABBA**.
2. Sustained: 6 back-to-back n=200, no fadvise, no cooldown, **contiguous per binary** (A6 then B6). ABBA would interleave and kill the throttle test.
3. CalaQwen k6d065 t4, 1+1 cold, battery permitted after (2).

Harness waited for UNPLUGGED (phone was on AC at push, 96%). First timed cell at 10:11:18.

---

## Class 1 — Mellum2 k6d10 t2, ABBA cold

Prompt `p_fact`. temp 0. `--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --chatml --no-think --drop-cold-experts 1.0 -t 2`. Screen Awake.

| cell | wall | compute | /proc cpu-s/tok | engine cpu-s/tok | J/tok | Iavg mA | n_gen | temp | screen |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| A r1 | 4.910 | 0.151 | 0.435 | 0.2815 | 1.138 | 882 | 144 | 28.7→30.7 | Awake |
| B r1 | 5.004 | 0.152 | 0.394 | 0.2766 | 1.020 | 867 | 177 | 30.7→30.7 | Awake |
| B r2 | 4.950 | 0.153 | 0.397 | 0.2781 | 1.083 | 889 | 177 | 30.7→32.7 | Awake |
| A r2 | 5.287 | 0.146 | 0.409 | 0.2671 | 1.067 | 892 | 144 | 32.7→32.7 | Awake |
| **A med** | **5.099** | **0.1485** | **0.422** | **0.274** | **1.102** | **887** | 144 | — | Awake |
| **B med** | **4.977** | **0.1525** | **0.395** | **0.277** | **1.051** | **878** | 177 | — | Awake |
| **Δ** | **−2.4%** | **+2.7%** | **−6.3%** | **+1.1%** | **−4.6%** | **−1.0%** | — | — | — |

A always stops at **144** tokens (EOS). B always at **177**. Texts diverge in the first paragraph (same class as S2 DETERMINISTIC_REORDER — i8mm vs dotprod summation order, not a race). `/proc` CPU-time and J/token divide by n_gen, so B looks cheaper because the same ~6 s prefill is spread over 23% more decode tokens. The engine's decode-only cpu-s/token (0.274 vs 0.277) and compute s/tok (0.1485 vs 0.1525) do not show an i8mm win. Iavg is the n_gen-free energy proxy: **−1.0%**, noise.

Hit 87.6% (A) / 88.6% (B). MiB/tok 39.20 / 39.11. Same streaming regime as S2 k6d10.

---

## Class 2 — sustained 6+6, no fadvise

Contiguous blocks. A first (starts cooler). The question: does i8mm's lower burn keep late reps faster/cooler?

| rep | A wall | A compute | A engine cpu | A Iavg | A temp | B wall | B compute | B engine cpu | B Iavg | B temp |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---|
| s1 | 5.040 | 0.150 | 0.2745 | 1067 | 32.7→34.7 | 4.980 | 0.150 | 0.2894 | 974 | 37.2→37.9 |
| s2 | 4.984 | 0.153 | 0.2787 | 1049 | 34.7→35.0 | 4.974 | 0.153 | 0.2931 | 912 | 37.9→37.9 |
| s3 | 5.041 | 0.151 | 0.2770 | 1060 | 35.0→35.0 | 4.528 | 0.165 | 0.3140 | 846 | 37.9→37.9 |
| s4 | 5.224 | 0.147 | 0.2695 | 1064 | 35.0→36.8 | 4.558 | 0.164 | 0.3060 | 822 | 37.9→37.7 |
| s5 | 5.118 | 0.148 | 0.2697 | 1064 | 36.8→37.2 | 4.703 | 0.158 | 0.2977 | 814 | 37.7→37.7 |
| s6 | 5.337 | 0.140 | 0.2689 | 1072 | 37.2→37.2 | 4.746 | 0.156 | 0.2965 | 802 | 37.7→38.0 |
| **late s5–s6** | **5.228** | — | — | — | — | **4.725** | — | — | — | — |

A does **not** throttle. Late A is the fastest A (5.337). Block rise **+4.5 °C** (32.7→37.2).

B starts the block already at 37.2 °C (A just finished). Late B **4.725 vs A's 5.228 = −9.6%**. Mid-block dip to 4.53. Engine cpu-s/token rises (0.289→0.314), the opposite of an efficiency dividend. Iavg falls 974→802 in lockstep with wall — less current because it is slower, not because the same work is cheaper. Block rise **+0.8 °C** (37.2→38.0). That is not a −2 °C i8mm win; B started 4.5 °C hotter and ended hotter than A ended.

**Answer to the owner question:** no. i8mm's "lower burn" does not keep late reps faster or cooler than dotprod.

---

## Class 3 — CalaQwen k6d065 t4, 1+1 cold (battery permitted)

Campaign ELF vs kernel_ke. Phone already at 38 °C / 90% after 16 Mellum2 cells. Screen Awake.

| | wall | compute | engine cpu-s/tok | flash s/tok | flash MiB/s | J/tok | Iavg | n_gen | temp |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| A campaign | **5.401** | 0.122 | 0.584 | 0.154 | 218 | 1.307 | 1060 | 200 | 38.0→38.0 |
| B i8mm | **1.704** | 0.475 | 1.599 | 0.363 | 96 | 2.044 | 696 | 200 | 38.0→38.5 |

A is in-band for a hot phone (product card 5.86 cold). B collapses on **both** compute and flash (96 vs 218 MiB/s). That is the Xiaomi-Doze / thermal-I/O signature, here after a long hot window, B last. **Not a clean i8mm datapoint.** Do not put 1.70 in a product table. Do not use it for the KE gate.

---

## Verdict

| gate | result | evidence |
|---|---|---|
| CPU-time/token −15%+ | **NO** | /proc −6.3% is n_gen amortization; engine decode **+1.1%**; compute **+2.7%** |
| J/token meaningful | **NO** | −4.6% same confound; Iavg **−1.0%** |
| late-rep sustained wall better | **NO** | −9.6% |
| temp delta −2 °C+ | **NO** | B ended 38.0 vs A 37.2 |
| wall tok/s no worse than −3% | yes (−2.4%) | does not save the gate |

**KE_NULL.** The bench said gate/up only. The model mix (and the fact that REPACK 8x8 never binds under `use_extra_bufts=false`) dilutes the 21% ID-cell win to **nothing measurable on decode**. Stated plainly: engine decode CPU-time/token **+1.1%**, compute **+2.7%**, Iavg **−1.0%**.

A later spike that wants a thermal lever has to actually run the 8x8 path (extra-buffer or a pack-at-cache-insert that does not break stream rebind). Compiling `+i8mm` onto the campaign-equivalent binary is not that lever.

---

## Hygiene

- Campaign pin MATCH before push, after install, after stop: `1ca51420…`. mellum2 `0ac612de…`, kernel_s1 `559bc59d…`, kernel_s2 `71f3556d…` never used as install targets.
- New files only under `~/bin/kernel_ke/` + wrapper `~/bin/bmoe-cli-kernel-ke`.
- Worktree `BigMoeOnEdge-kernel-ke` detached at `d987027`. Main `BigMoeOnEdge` left on `kalsa/kernel-s2-layer-fuse`.
- Jelly / Xiaomi not addressed. PC PPL not touched. Build `-j 6`.
- Timed cells UNPLUGGED. 97→89%, peak 38.5 °C. Screen Awake every row.
- `screen_off_timeout` restored to 1800000.

Artifacts: `results/kernel_ke/` (`runs.csv`, `master.log`, `logs/*/`, `bin.sha256`, `source_pins.txt`, `s23_battery_host.txt`, `s23_screen_host.txt`).

DONE
