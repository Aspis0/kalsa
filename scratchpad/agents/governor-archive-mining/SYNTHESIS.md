# Governor archive synthesis

**Revision 1:** Corrected DeepSeek citation findings; rewrote §4 for a per-turn `/bench route`
hook, warm-KV matching, token-normalized heat, and a confirmatory sample-size rule.

**Revision 2:** The valid S23 trace refuted my ≤0.2 °C/10 min drift prediction by 5.7× (+1.140 °C);
§4 now fits each arm locally and sizes tonight’s S23 heat run. Xiaomi is correctness-only.

Evidence cut: 2026-09-24. The three mining digests were used only as an index. Every measured
entry below was checked against its quoted archive line; “not measured” is a result, not an
estimate. Speed rows come from different models and harnesses unless explicitly paired. They are
not transferable between models or devices. `ΔT/process` includes whatever that source says it
includes; it is not silently relabelled as per-chunk heat. `J/token` is shown only when the source
has a measured energy value; ratios carry their original caveat.

## 1. Data sheet

Each row is device × backend × phase. A dash means that source does not provide a valid item for
that field. “Conditions” quotes the source; absent conditions are explicitly unknown.
Device labels: S23 = Adreno 740 / Hexagon v73 [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:513`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L513); Xiaomi 14 = Snapdragon 8 Gen 3 / Adreno 750 / Hexagon v75 [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:466`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L466); Jelly = Helio G99 / Mali-G57 [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:81`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L81); 8 Elite QDC = QRD8750 / Adreno 830 / Hexagon v79 [`ALIVE-2026-09-full.md:460,463`](../../../archived/ALIVE-2026-09-full.md#L460).

| Device / backend / phase | Measured speed | Heat (battery; SoC) | Energy | Conditions and source-line quotation |
|---|---:|---|---|---|
| **S23 / CPU / prefill** | 22 / 19 / 26 / 25 tok/s at 128 / 512 / 1024 / 2048 tokens | Whole-process battery ΔT +1.9 / +3.25 / +3.25 / +5.15 °C; SoC not reported | — | **25 Aug**, unplugged, 16 guarded q58 sweep runs; source does not name the model in this row. “CPU 1.9/3.25/3.25/5.15 … at n=128/512/1024/2048; t/s … CPU 22/19/26/25” [`PLAN-archive.md:9003`](../../../archived/PLAN-archive.md#L9003). The audit says these process deltas include model mmap and were n=2/cell [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:189-193`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L189). |
| **S23 / CPU / decode** | 17.553 tok/s (KEXP); 27.685 tok/s (OLMoE) | Peak 39.95 °C on KEXP; OLMoE parity with GPU, no per-chunk battery/SoC series | — | **22 Aug**, unplugged, preregistered cell; models differ. “C — all CPU … 17.55 … 27.69 … hottest on KEXP (40.0 peak)” [`ALIVE-2026-09-full.md:126-140,149-155`](../../../archived/ALIVE-2026-09-full.md#L126). |
| **S23 / GPU / prefill** | No valid in-app rate; CLI pp512 result exists in other campaign rows, not a verified governor turn | — | — | In-app GPU prefill on the 740 “was never measured in-app” [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:749`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L749). Do not substitute a different model/harness. |
| **S23 / GPU / decode** | 14.252 tok/s (KEXP); 20.034 tok/s (OLMoE) | KEXP peak 37.20 °C, CPU peak 39.95 °C: GPU −2.75 °C; OLMoE GPU peak −0.45 °C vs CPU | — | **22 Aug**, unplugged, preregistered cells, models differ. “A — all GPU | 14.25 … 20.03 … KEXP −2.75°C … OLMoE −0.45°C” [`ALIVE-2026-09-full.md:126-140,149-155`](../../../archived/ALIVE-2026-09-full.md#L149). |
| **S23 / NPU / prefill** | 75 / 127 / 105 / 88 tok/s at 128 / 512 / 1024 / 2048 | Whole-process battery ΔT +0.5 / 0.0 / +1.1 / +2.2 °C; SoC not measured in this table | — | **25 Aug**, unplugged, 16/16 guarded q58 runs, NPU/CPU/CPU/NPU by size. “ΔT per processo NPU 0.5/0.0/1.1/2.2 … t/s NPU 75/127/105/88” [`PLAN-archive.md:9003`](../../../archived/PLAN-archive.md#L9003). Process delta is not isolated chunk heat. |
| **S23 / NPU / decode** | No banked product decode rate | — | — | The S23 record says `-ngl 8 tg128` ran but supplies no rate there; v73 expert/NPU paths later failed or were kept off. “`-ngl 8 tg128` VIVE … PRIMO decode NPU v73 mai registrato” [`ALIVE-2026-09-full.md:480`](../../../archived/ALIVE-2026-09-full.md#L480); sustained v73 NPU was disabled after failure/thermal incident [`ALIVE-2026-09-full.md:448`](../../../archived/ALIVE-2026-09-full.md#L448). |
| **Xiaomi 14 / CPU / prefill** | 58.7 tok/s pp128 (Qwen3.5-2B); 51.9 tok/s pp512 (Qwen3.5-4B HTP comparison); 51.9 is the matched comparator for that latter cell | 2B pp512 battery +1.1 °C; pp1024 +2.8 °C; pp2048 +3.6 °C, SoC pp2048 +19.3 °C | — | pp128 rerun **18 Aug**, interleaved; separate heat cell, unplugged, 2B, same evening. “CPU pp128 … media 58.7”; “2B pp512 CPU 27,9→29,0 (+1,1)”; “pp2048 CPU … +3,6 … 47,8→67,1 (+19,3)” [`PLAN-archive.md:6007-6013`](../../../archived/PLAN-archive.md#L6007), [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:467-478`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L467). Thermal block says “same evening, unplugged”; it does not give an exact date/model name beyond “2B”. |
| **Xiaomi 14 / CPU / decode** | 24.28 tok/s exploratory KEXP; 24.338 median in the later paired record is only recoverable from the audited report, not the cited archive line | — | — | **22 Aug**, exploratory N=3, Doze: “A tg 24.47 … C 24.28”; later N=5 all Awake confirms “A/C decode 0.992” [`PLAN-archive.md:8873-8878`](../../../archived/PLAN-archive.md#L8873), [`PLAN-archive.md:8884-8888`](../../../archived/PLAN-archive.md#L8884). No matched heat cell. |
| **Xiaomi 14 / GPU / prefill** | 186.6 tok/s pp128 (Qwen3.5-2B); ratio to rerun CPU = 3.18× | 2B pp512 battery +0.0 °C; pp1024 −0.3 °C; pp2048 +0.1 °C, SoC pp2048 +1.4 °C | — | Speed **18 Aug**, interleaved. Heat block unplugged, same-evening 2B; thermal status not stated. “GPU pp128 … media 186.6”; “Rapporto vero … 3.18×” [`PLAN-archive.md:6007-6013`](../../../archived/PLAN-archive.md#L6007). “GPU pp512 … 29,0→29,0 (0,0)”; “pp2048 … +0,1 … SoC … +1,4” [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:467-478`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L467). |
| **Xiaomi 14 / GPU / decode** | 24.47 tok/s exploratory KEXP; clean paired record reports A/C = 0.992, not absolute t/s in the cited line | — | — | **22 Aug**, exploratory N=3, Doze: “A tg 24.47”; later **N=5, all Awake** “A/C decode 0.992” [`PLAN-archive.md:8873-8878`](../../../archived/PLAN-archive.md#L8873), [`PLAN-archive.md:8884-8888`](../../../archived/PLAN-archive.md#L8884). No matched heat cell. |
| **Xiaomi 14 / NPU / prefill** | 165.4 tok/s pp512 vs CPU 51.9 (Qwen3.5-4B Q4_0); separate Marco-B′ Q8_0 trunk 27.84 vs 19.12 tok/s | No isolated NPU ΔT exists. The often repeated +1.3 °C is whole-cell rise, not NPU | Marco-B′: 0.561 vs 0.652 J/token, NPU/CPU = 0.86×; single matched-work charge-counter measurement, includes load/init | Qwen cell **23 Aug**, unplugged 100%, 3 reps; Marco-B′ **24 Aug**, unplugged, exploratory. “pp512 HTP mediana 165.4 … vs CPU … 51.9”; “J/token HTP 0.561 vs CPU 0.652 = 0.86×” [`PLAN-archive.md:9002-9003`](../../../archived/PLAN-archive.md#L9002). Audit: +1.3 was “34.2−32.9” for whole cell; per-leg HTP ≈+0.4 total and CPU +0.9 [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:898-903`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L898). |
| **Xiaomi 14 / NPU / decode** | 4.47 tok/s vs CPU 11.94; ratio 0.374× | — | — | **23 Aug**, unplugged 68→66%, exploratory. “HTP 4.09/4.85 t/s … vs CPU 11.94 → decode NPU = 0.37× CPU” [`PLAN-archive.md:9004`](../../../archived/PLAN-archive.md#L9004); exact medians 4.47/11.94 confirmed by audit [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:950`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L950). |
| **Jelly / CPU / prefill** | 3.6 tok/s at ~4096 prompt tokens (LFM2.5-2.6B Q4_K_M) | No paired per-chunk battery/SoC delta | — | **16 Sep**, unplugged, CLI, two invocations; screen/thermal status not stated. “run 1 cold cache 890 s wall, `[ Prompt: 3.6 t/s ]`”; 5.0 tok/s at 66 tokens falls to 3.6 at ~4096 [`ALIVE-2026-09-full.md:5557-5561`](../../../archived/ALIVE-2026-09-full.md#L5557). |
| **Jelly / CPU / decode** | 3.52 tok/s (Qwen3.5-4B Q4_K_M, tg128) | — | — | **14 Aug**, unplugged 100→90%, screen Awake; llama-bench ABBA, `-t 2`. “product 3.52 tok/s tg128” [`PLAN-archive.md:9426`](../../../archived/PLAN-archive.md#L9426). Different model from prefill row. |
| **Jelly / GPU / prefill** | No product tok/s | — | — | **22 Aug**, gate 4 declared plugged. The generic OpenCL cases were slower than CPU; no product GGUF was benchmarked. “GPU < CPU su TUTTI i 20 casi … max 0.962×”; the same line says product-path quantized runs were unavailable [`PLAN-archive.md:8999`](../../../archived/PLAN-archive.md#L8999). |
| **Jelly / GPU / decode** | No product tok/s | — | — | Same **plugged** generic gate; not a product decode measurement. Mali G57 GPU is parked by owner decision [`PLAN-archive.md:8999`](../../../archived/PLAN-archive.md#L8999), [`ALIVE-2026-09-full.md:3914-3915`](../../../archived/ALIVE-2026-09-full.md#L3914). |
| **Jelly / NPU / prefill** | No in-app/product measurement | — | — | No NPU path or comparable NPU cell in the cited device evidence; streaming-MoE NPU was a no-go on this 8 GB/UFS 2.2 case [`ALIVE-2026-09-full.md:448`](../../../archived/ALIVE-2026-09-full.md#L448). |
| **Jelly / NPU / decode** | Not measured | — | — | No HTP/NPU decode cell is recorded for Jelly in the cited archive; do not infer it from Qualcomm rows. |
| **8 Elite QDC / CPU / prefill** | 107.4 tok/s pp512 (Marco-KEXP 17.25B Q4_K) | Live-HAL gate was ≤44 °C/status 0 before each invocation; no per-arm battery/SoC ΔT | — | **30 Aug**, ABBA, r=3. “C(CPU ngl0) pp512 107.4” [`ALIVE-2026-09-full.md:460`](../../../archived/ALIVE-2026-09-full.md#L460). |
| **8 Elite QDC / CPU / decode** | 60.7 tok/s tg128 (same KEXP); LFM2.5-8B CPU 13.95/13.46 tok/s in separate cell | Gate only; no per-arm ΔT | — | **30 Aug**, KEXP ABBA r=3, live-HAL gate; “tg128 60.7”. Separate **30 Aug** 8B cell reports CPU decode 13.95/13.46 [`ALIVE-2026-09-full.md:460-461`](../../../archived/ALIVE-2026-09-full.md#L460). |
| **8 Elite QDC / GPU / prefill** | 274.5 tok/s pp512 (Marco-KEXP 17.25B Q4_K) | Gate only; no per-arm ΔT | — | **30 Aug** llama-bench ABBA r=3, “A(GPU ngl99) pp512 274.5” [`ALIVE-2026-09-full.md:460`](../../../archived/ALIVE-2026-09-full.md#L460). |
| **8 Elite QDC / GPU / decode** | 48.9 tok/s tg128 KEXP; 28.20/28.37 tok/s LFM2.5-8B (separate model) | Gate only; no per-arm ΔT | — | **30 Aug**, KEXP ABBA r=3; “tg128 48.9”; separate 8B row reports GPU 28.20/28.37 [`ALIVE-2026-09-full.md:460-461`](../../../archived/ALIVE-2026-09-full.md#L460). |
| **8 Elite QDC / NPU / prefill** | 1512.2 tok/s pp512 vs CPU 211.1, ship model LFM2.5-2.6B QAD-Q4_0; exploratory, not routing verdict | Thermal gate was deviated from; pre/post rose 57.6→61.5/63.0 °C in the cited record; no paired battery/SoC per-chunk ΔT | — | **31 Aug**, exploratory N-C-C-N. “N pp512 1512.2 … C pp512 211.1”; “well under gate retracted … post-C 61.5/63.0” [`ALIVE-2026-09-full.md:463`](../../../archived/ALIVE-2026-09-full.md#L463). |
| **8 Elite QDC / NPU / decode** | 23.47 tok/s vs CPU 38.49 (same exploratory ship-model cell) | Same thermal-gate deviation; no per-chunk ΔT | — | **31 Aug**, exploratory N-C-C-N. “tg 23.47 … C … tg 38.49” [`ALIVE-2026-09-full.md:463`](../../../archived/ALIVE-2026-09-full.md#L463). |

**Energy coverage:** these sources do not provide a valid per-device × model × backend × phase
J/token grid. The S23’s older “1.0–1.4 J/token” is a whole-system estimate at 5 tok/s, screen
included, not a backend comparison: “≈ 1.0-1.4 J/token” [`PLAN-archive.md:3553-3558`](../../../archived/PLAN-archive.md#L3553). The charge-counter S23 NPU comparison is explicitly inconclusive, “5.3× spread … do not cite” [`ALIVE-2026-09-full.md:448`](../../../archived/ALIVE-2026-09-full.md#L448). Do not fill missing cells with that estimate.

### Refuted, retracted, or void: never cite as live

- **Xiaomi dense GPU prefill 5.77×**: ratio retired as a weak CPU baseline; corrected rerun is 3.18×. Source: “5.77× era un artefatto della BASELINE CPU” [`PLAN-archive.md:6003-6013`](../../../archived/PLAN-archive.md#L6003).
- **S23 GPU prefill 1.29×**: cold-outlier artifact; honest result 1.12% in that K-G comparison. Source: “K-G’s 1.29× was a 740 cold-outlier artifact, honest 1.12 %” [`ALIVE-2026-09-full.md:328`](../../../archived/ALIVE-2026-09-full.md#L328).
- **Xiaomi NPU ΔT +1.3 °C**: whole mixed cell rise, not attributable to NPU; use no per-engine NPU heat value until remeasured [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:898-903`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L898).
- **Xiaomi 4B heat deltas as cited**: citation pointed to a contaminated/wrong-night artifact; exclude those six values [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:912-917`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L912).
- **Xiaomi “10 repetitions per decode direction”**: false; the audit says two interleaved pairs. The prefill 3.18× survives [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:919-924`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L919).
- **S23 “17,5→14,8 tok/s” sustained claim**: do not use as live data. The audit line says its cited artifact has CPU `12.2→10.2` and GPU `8.2→8.2`, while `"parte a 17,5 tok/s e scende a 14,8"` is “not in that artifact … and I found no source”; its unverified ledger repeats the missing campaign citation [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:957,1044`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L957).
- **Jelly GPU tok/s**: do not cite an LLM rate from the plugged generic-kernel gate; product q4_K/q4_0 path did not run [`PLAN-archive.md:8999`](../../../archived/PLAN-archive.md#L8999).
- **S23 energy 6 J/token / 0.455 J/token**: withdrawn or unit-mismatched, never live [`PLAN-archive.md:957,1057,3558`](../../../archived/PLAN-archive.md#L957).
- **QDC 8 Elite “all runs thermally clean”**: #43 explicitly retracts “well under gate”; its NPU thermal gate was not applied as preregistered [`ALIVE-2026-09-full.md:463`](../../../archived/ALIVE-2026-09-full.md#L463).

## 2. What the governor gets wrong today

1. **One S23 table is being used as if it priced every engine and device.** The checked-in rows are
   `{1.9, 3.25, 3.25, 5.15} °C` for token classes `{128,512,1024,2048}`. The audit traces them to
   q58 S23/v73, n=2, whole-process deltas including model mmap; the sweep was NPU-focused, and
   the policy has no device branch [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:185-193`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L185).
   The source row labels the CPU-reference deltas, but those values do **not** measure GPU or NPU
   per-chunk heat, do not isolate model load, and do not calibrate Xiaomi, Jelly, or v79. The
   current policy applies the same `k_cpu_delta_c` in admission regardless of requested engine
   [`llama-governor-policy.cpp:14-15,220-225`](/Users/marco/Projects/kalsallama-wt-oom/src/llama-governor-policy.cpp:14).
2. **Battery-only control can be badly behind the silicon.** The policy’s temperature helper reads
   `batt_temp_tenths_c` only [`llama-governor-policy.cpp:23-25`](/Users/marco/Projects/kalsallama-wt-oom/src/llama-governor-policy.cpp:23).
   The archive measured a 92.0 °C CPU die while the gate sensor stayed ≤30 °C: “t≈40 92.0 °C” and
   “sensore che segnava ≤30 °C mentre il silicio stava a novanta” [`PLAN-archive.md:2935-2948`](../../../archived/PLAN-archive.md#L2935).
   In a separate chat trace, AP temperature fell 55.7→46.4 °C in 25 s while battery continued
   rising; the diary explicitly calls it lag [`PLAN-2026-09-full.md:2138-2141`](../../../archived/PLAN-2026-09-full.md#L2138).
3. **39.5 °C is not a measured safe product ceiling.** It is `k_warn_c 40.0 − 0.5`, and the
   40/43 °C warn/kill pair came from the q58 harness guard, then was promoted into policy
   [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:195-196,933`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L195).
4. **The policy’s thermal admission and route are misaligned with measured heat.** Xiaomi 2B pp2048
   CPU raised the SoC by +19.3 °C; GPU raised it +1.4 °C. The CPU battery rise was +3.6 °C vs
   GPU +0.1 °C [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:467-478`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L467).
   This is the strongest direct evidence against “hot → CPU prefill.” It is one model/workload and
   one Xiaomi cell, so it justifies a new measurement, not a universal GPU rule.
5. **“Wait → CPU prefill” is an old observed behavior, not today’s code or a sound cooling rule.**
   Old v0 app evidence says Wait routed a whole turn to CPU [`ALIVE-2026-09-full.md:485`](../../../archived/ALIVE-2026-09-full.md#L485), and an earlier product finding said Wait should degrade to CPU [`ALIVE-2026-09-full.md:2835-2838`](../../../archived/ALIVE-2026-09-full.md#L2835). The current runtime instead logs “no safe prefill chunk … pausing” and returns `-2`; only an explicit `CPUFallback` proceeds on CPU [`llama-governor-runtime.cpp:77-91`](/Users/marco/Projects/kalsallama-wt-oom/src/llama-governor-runtime.cpp:77). Current policy says its row deltas are “unmeasured defaults” and admits with the battery-derived temperature [`llama-governor-policy.cpp:220-225`](/Users/marco/Projects/kalsallama-wt-oom/src/llama-governor-policy.cpp:220). Given the Xiaomi SoC comparison, the owner is right to reject an automatic hot-to-CPU switch. A hard pause also fails “app works always” if it strands a turn; the supported cooling route must be a measured, correct cooler engine, with an explicit user-visible wait only when every safe route is exhausted.
6. **The present APK/engine route is CPU+GPU, not tri-engine.** Binding loader sets `prefill_params.n_gpu_layers=99` and `decode_params.n_gpu_layers=0` [`rn-llama.cpp:71-82`](/Users/marco/Projects/llama.rn-kalsa/cpp/rn-llama.cpp:71). The governor policy selector returns CPU, GPU, or GPU_COOLMODE; it does not select NPU [`llama-governor-policy.cpp:165-188`](/Users/marco/Projects/kalsallama-wt-oom/src/llama-governor-policy.cpp:165). The Sep 24 fixed-APK functional report confirms CPU/GPU prefill route markers and CPU decode, but was charging and is route evidence only [`xiaomi-governor-night/REPORT.md:47-51,78-85`](../xiaomi-governor-night/REPORT.md:47). No HTP/NPU route is demonstrated, so the proposed NPU arm is excluded.

## 3. Gaps blocking a per-device × model × backend router

- **In-app, per-chunk heat by backend**, with model load excluded and paired battery + SoC/skin traces;
  the archived plan itself says isolated Xiaomi ΔT at 128/512/1024/2048 by engine is missing
  [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:725-727`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L725).
- **Runtime route proof and correctness on each phone.** The 740 in-app GPU prefill is unmeasured;
  the Xiaomi governor probe previously aborted during OpenCL load; current product NPU routing is
  absent [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:749`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L749), [`PLAN-2026-09-full.md:1578`](../../../archived/PLAN-2026-09-full.md#L1578).
- **CPU↔GPU↔NPU handover and reload cost under a live chat.** Archive: “Costo per handover
  CPU↔HTP: NOT FOUND” [`PLAN-archive.md:6157-6158`](../../../archived/PLAN-archive.md#L6157). Existing 8 Elite GPU↔CPU commits are measured but model/turn dependent (26–29 ms in #38) [`ALIVE-2026-09-full.md:458`](../../../archived/ALIVE-2026-09-full.md#L458).
- **Cool-down curve while app stays open and the user composes.** Existing idle cooldowns do not
  establish a keyboard-open curve or a policy that preserves model/KV without rewarming. Battery
  lag after stopping work is measured [`PLAN-2026-09-full.md:2138-2141`](../../../archived/PLAN-2026-09-full.md#L2138); idle-dispose can force reload after 180 s while thermal cooldowns span 300–360 s [`ALIVE-2026-09-full.md:6060-6074`](../../../archived/ALIVE-2026-09-full.md#L6060).
- **Thermal-zone inventory per retail handset without root.** The archive verifies Qualcomm sysfs
  glob `/sys/class/thermal/thermal_zone*/{type,temp}` and labels `cpu-*`, `gpuss-*`, `nspss-*`
  readable without special permissions on the S23-class setup [`PLAN-archive.md:3729-3739`](../../../archived/PLAN-archive.md#L3729). Exact Xiaomi zone indices/labels and Jelly zones are not established by that line. Read battery via `adb shell dumpsys battery` (battery temperature is recorded in tenths of °C in device evidence); use app `BatteryManager` for production. Do not assume Xiaomi has the same thermal-zone labels until enumerated.
- **Per-backend energy**: the one Xiaomi NPU J/token ratio is single-replica, whole-process, and
  charge-counter based; S23 charge-counter energy spread was 5.3× on identical work and was
  withdrawn [`PLAN-archive.md:9003`](../../../archived/PLAN-archive.md#L9003), [`ALIVE-2026-09-full.md:448`](../../../archived/ALIVE-2026-09-full.md#L448).
- **Temperature calibration and battery/plugged branch.** No equal-work plugged/unplugged pair
  exists; never benchmark plugged under the project rule [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:728`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L728).

## 4. Revision 2 preregistration: S23 heat, Xiaomi correctness only

**Tonight’s predictions (frozen before arms).** S23 GPU will have lower °C/1k-token SoC rise than
CPU, but this is only a direction hypothesis: Xiaomi’s +19.3/+1.4 °C comparison was Qwen3.5-2B,
not this LFM2.5-2.6B model [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:467-478`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L467).
GPU may take longer; equal raw end temperatures are not predicted. Battery is expected to rise
after compute. S23 idle drift was +1.140 °C/10 min (SD 0.380 °C, range 1.3 °C); SoC/skin also rose
[`REPORT.md:71-73,77-116`](../sensor-inventory/REPORT.md#L71). My ≤0.2 °C prediction was wrong 5.7×.

### Route hook and evidence joins

There is no current per-turn CPU/GPU switch: the engine has a GPU force and the app supplies a
load-time plan. Do not restart between arms. Tonight requires the in-build dev hook
`/bench route cpu|gpu`; it must set the next prefill route without unloading model or KV. The hook
must not bypass safety. If the APK lacks it or its logs below, stop before measurement.

For every measured turn, emit/join these records by the exact `turnId`:

- `KALSA_GOVERNOR`: `turnId`, forced `route_mode`, existing `engine_prefill`, `prefill_ms`,
  `prefill_chunks`, and **one route fact per executed chunk** in
  `route_chunks:[{index,requested,actual,tokens,prefill_ms,forced}]`; also `route_push`, `route_mismatch`,
  `route_chunks_truncated`, `attempt`, and paused state. Existing fields:
  [`LlamaService.ts:1763-1784`](/Users/marco/Projects/kalsa/src/engine/LlamaService.ts:1763).
- `KALSA_TELEMETRY`: same `turnId`, `tokensEvaluated`, `promptMs`, `promptN` (serialized as
  `prompt_n`) [`turnTelemetry.ts:128-139,220-228`](/Users/marco/Projects/kalsa/src/engine/turnTelemetry.ts:128).
- `KALSA_WINDOW`: same `turnId`, `nPast` immediately before the measured turn
  [`AppShell.tsx:6524-6534`](/Users/marco/Projects/kalsa/src/app/AppShell.tsx:6524). Retain
  `KALSA_KVREUSE` (`n_past`, `prompt`, `n_common`) when emitted.

### S23 arm plan and driver steps

1. Use only the new APK artifact with the hook; record its path/hash. Preflight before every S23
   session: inspect `adsprpcd`/`cdsprpcd` CPU and `/proc` ticks; if spinning, do not measure.
   Verify unplugged, Awake, Kalsa foreground, thermal status 0, battery ≥25%; initial target is
   about 92%. Set/verify screen timeout `2147483647` ms (previously unset; restore by deleting the
   override after the run) [`REPORT.md:64,69-71`](../sensor-inventory/REPORT.md#L64).
2. Install with `adb -s <S23> install -r <APK>` only. Never uninstall or clear data. Load
   **LFM2.5-2.6B QAD-Q4_0** once. Create one deterministic warm prefix and capture its KV checkpoint
   at `nPast=K`; restore the same checkpoint for each arm without reloading the model. If `nPast`
   cannot be made identical, stop: that turn is not a matched arm.
3. Freeze two prompt files from this exact filler cycle:
   `amber cedar cobalt dahlia ember flint glacier harbor indigo juniper kelp lilac marble nectar
   opal pebble quartz river silver thistle`. Use the real LFM tokenizer and chat template; repeat
   the cycle and trim its final tokens until the fully rendered user turn (including role markers
   and assistant prefix) adds exactly **512** or **1024** tokens after K. Save body, token IDs and
   hash; send these same files in both arms. Warm-up/calibration is not data.
4. Accept token count only if `promptN` and `tokensEvaluated - nPast` each equal target ±2; retain
   actual values. Send the same fixed greedy turn with the same output cap in both arms. If the APK
   cannot hold that cap fixed, the heat comparison is exploratory and must report generated-token
   counts. No 128-token arm tonight: it costs 16 more turns at n=8 and its smaller raw signal is
   poorly resolved by the measured 0.1 °C battery step.
5. Run **512 and 1024 new tokens × CPU/GPU × 8 matched pairs** (32 arms); before every send issue
   `/bench route cpu` or `/bench route gpu` as the assigned arm, then block each size in
   randomized ABBA/BAAB order, four pairs each order. Before **every arm**, idle 120 s at 1 Hz with
   model/KV resident, then fit ordinary least squares `T(t)=a+bt` to that arm’s 120 samples.
   Start only at thermal status 0 and with battery within ±2.0 °C of its pair’s first-arm start.
   If cooldown cannot restore this band within 20 min, stop that pair; do not substitute data.
6. After each arm, sample through completion +60 s. Cool with screen on, Awake and app foreground;
   enforce the ±2 °C paired-start band before its mate. Never charge. After every 20 minutes of
   cumulative inference load, take a 20-minute no-inference cool-down and then recheck the gates.
   Hard stop at thermal status ≥3, battery temperature ≥44.0 °C, battery ≤25%, charging detected,
   app background/screen not Awake, or device/driver loss. Do not resume that session after a hard
   stop.
7. Invalidate the turn and its pair if `route_push != applied`, `route_mismatch != false`,
   `route_chunks_truncated == true`, `attempt > 1`, paused/failed/fallback, no exact `turnId` join,
   missing per-chunk route fact, actual route differs from forced route, `nPast` differs from K,
   prompt count is out of tolerance, or not Awake/foreground at the turn check. Log invalid rows;
   do not silently replace them. Any model unload/reload during a measured pair invalidates it.

### Sensors, endpoints, and feasible n

Read battery at 1 Hz from `dumpsys battery` (`temperature` in tenths °C) and map readable sysfs
`type` labels at session start; convert their millidegree `temp` values to °C. Exact S23 sources are
[`raw/s23-inventory.txt:56-57,76-77,146-147,236-237,472-473,493-503`](../sensor-inventory/raw/s23-inventory.txt#L56).
Primary set: max of `cpu-0-*` and `cpu-1-*` (report both label-group maxima; no architecture
inference), max `gpuss-0..7`, max `nspss-0..3`, HAL `SKIN`, and battery. Skin is HAL-only; do not
substitute AP for CPU. The idle SDs justify keeping GPU/NSP/skin/battery (0.477–0.512/0.477–0.504/
0.367/0.380 °C); CPU group maxima are noisy (0.655 and 1.568 °C), so report both and use the
noisier CPU group conservatively [`REPORT.md:77-113`](../sensor-inventory/REPORT.md#L77). The
reported SD includes the common +1.14 °C/10 min trend, not stationary noise by itself.

For each sensor fit the 120-s pre-arm OLS line and extrapolate it through the turn and 60-s tail.
At each sample use excess `x(t)=observed−(a+bt)`. Report: (1) primary peak `1000×max(x)/new
prompt tokens` in °C/1k tokens; (2) turn-end excess `x(end)/prefill_ms×1000` in °C/s of compute;
(3) positive trapezoid AUC of x during the fixed 60-s post-completion window in °C·s. Router heat cost uses
metric 1 because it scales with requested work; latency stays separate. Metrics 2 and 3 expose
rate and delayed burden. CPU/GPU may differ by ~3× in runtime: never compare unnormalised rise
alone; use each arm’s own baseline slope and `prefill_ms`.

Planning power proxy (two-sided α=.05, 80%, independent arm errors):
`MDE(n)=2.80×√2×SD/√n`. With the observed full-window battery SD 0.380 °C, n=4/8/12 pairs
detect about 0.752/0.532/0.434 °C raw (1.47/1.04/0.85 °C per 1k at 512 tokens; half those
per-1k values at 1024). At n=8, corresponding rough raw MDEs are skin 0.514 °C, GPU 0.717 °C,
NSP 0.705 °C, CPU label-group 0 0.917 °C and group 1 2.195 °C, using the SDs above. These are
planning estimates, not guarantees: the full-window SD includes trend and is not the post-regression
residual SD; slope uncertainty and paired correlation were not measured. Estimate them from tonight’s
120-s windows. Eight pairs/cell is exploratory;
effects below the resulting empirical MDE cannot change routing. It is not a confirmatory claim.

Fit: 32 arms × (120-s baseline + 60-s tail) = 96 min minimum, plus inference, pair cool-downs,
and any mandatory 20-min break. The observed idle battery fell 93→92% in 10 min; at that rate,
the 96 min of windows costs roughly 10 percentage points, leaving about 57 points from a 92%
start to the hard 25% floor for compute and extra cooling. This is a budget estimate only; the
live 25% gate wins. Omitting 128 tokens cuts 16 arms and 48 min of windows; it leaves no short-
chunk heat calibration. If the full two-size design reaches a stop gate or cannot meet pairing,
keep completed cells exploratory and do not switch router policy.

**Device rules (verbatim):**

> screen always on (Awake, Kalsa in foreground, checked per turn, or the turn is INVALID); no uninstall or clear data (`install -r` only); on the Xiaomi touch nothing outside `com.kalsa.app`, never lock, keep ≥5 GB free, cool down every 20 minutes of load; before every S23 session check `adsprpcd`/`cdsprpcd` and do not measure if they are spinning.

### Xiaomi 14 correctness-only checklist tonight (on charger)

- Correctness only: record no speed, heat or energy numbers. Do not run thermal arms while charging.
- Confirm ≥5 GB free; touch only `com.kalsa.app`, never lock, keep screen on/Awake/foreground.
- Install the same hook APK with `install -r`; issue `/bench route cpu`, send one frozen prompt,
  then `/bench route gpu` and resend it. Join by `turnId`; every chunk’s requested/actual route
  must match the forced mode with no truncation, mismatch, pause or retry.
- Compare greedy output token IDs exactly across CPU and GPU. Then wait for idle model unload, send
  the same prompt once more, and verify Kalsa answers and logs the route facts after reload.
- Xiaomi inventory names differ (`gpuss-*`, `nsphvx-*`, `nsphmx-*`, battery; skin is HAL)
  [`raw/xiaomi-inventory.txt:85-95,145,380,550`](../sensor-inventory/raw/xiaomi-inventory.txt#L85).
  They are not thermal evidence tonight.

## 5. Router sketch (design, not code)

**Inputs**

- Device identity: SoC/GPU/NPU generation, driver/build, RAM and backend availability.
- Work state: phase, model + quant, new prefill tokens after KV reuse, chunk-size class, context,
  cache residency, correctness certification, fit, and route/handover cost.
- Thermal state: battery temperature and slope plus max CPU/SoC zone and readable GPU/NPU zones;
  thermal status is a hard guard, not the sole predictor. Include plug state, battery level,
  screen state, app foreground, and whether the user is composing.

**Calibration table** (one row per `device × model/quant × backend × phase × chunk-size × context
state × plug/screen state`; no generic defaults presented as data): tok/s, paired Δbattery °C/chunk,
paired ΔSoC °C/chunk, cooling curve, J/token with method/uncertainty, correctness, fit, handover
time, and confidence/sample count. A cell with no measurement is unavailable, not extrapolated.

**Behavior**

- While the user types and no response is requested: do no inference or character-by-character
  prefill. Preserve a loaded model/KV when safe; collect idle-cooling samples with the app in
  foreground. The archive calls incremental typeahead dead because a 527-token incremental prompt
  took 67 s vs 64 s from zero [`PLAN-archive.md:9425`](../../../archived/PLAN-archive.md#L9425).
- On Send: choose the fastest correct route under the accepted heat budget for this exact table
  cell. During a long response, re-evaluate only at phase/chunk boundaries, with hysteresis and a
  measured handover cost. CPU is not the automatic hot fallback; prefer a proven cooler GPU/NPU
  prefill lane when its correctness and heat data exist.
- If every route hits the hard thermal stop, keep the request and UI responsive, pause compute,
  communicate the wait, and resume the same turn after measured recovery. “App always works” means
  no silent abort, lost prompt, or context reset; it cannot mean continuing compute through an
  unsafe stop. Measure resume and retained-KV behavior before building this path.

**Threshold ledger**

| Threshold / behavior | Status |
|---|---|
| Current policy deltas 1.9 / 3.25 / 3.25 / 5.15 °C | **MEASURED inputs, invalid universal use**: q58 whole-process S23 rows; not per-backend/per-device calibration [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:185-193`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L185). |
| Current 40.0 °C warn, 39.5 °C limit, 43.0 °C kill | **MEASURED source, PLACEHOLDER product meaning**: q58 harness guard `--warn-tenths 400 --kill-tenths 430`; limit is warn minus 0.5 [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:195-196`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L195). |
| User typing idle window, dwell/hysteresis, cooling target | **PLACEHOLDER** until keyboard-open idle curves, retained-KV reload cost, and UI resume are measured. Existing governor has 10-minute dwell, but that is not evidence of optimal user behavior [`llama-governor-policy.cpp:7-8`](/Users/marco/Projects/kalsallama-wt-oom/src/llama-governor-policy.cpp:7). |
| Stop at status ≥3, battery ≥44.0 °C; battery floor 25%; start status 0 and within ±2 °C; cooldown every 20 minutes | **Protocol PLACEHOLDER/owner constraints**, not router-calibration results. |
| Accepted decode floor; permissible J/token overhead; minimum confidence/sample count | **PLACEHOLDER**: no owner-approved product floor or valid per-backend energy table in cited evidence. |

## 6. Digest errors and source-level corrections

- The Xiaomi NPU `+1.3 °C` digest claim does not hold as a per-engine claim: the audit derives the
  whole mixed cell as `34.2−32.9`; per-leg HTP is about `+0.4` total and CPU `+0.9` [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:898-903`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L898).
- The digest’s 4B Xiaomi thermal row cites a different/contaminated file; the audit says its
  numbers came from another file and next-morning run [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:912-917`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L912).
- Any digest phrasing of the 18 Aug Xiaomi decode as ten reps per direction is wrong: the audit
  identifies **two interleaved pairs**. The prefill ratio was independently corrected and stands
  at 3.18× [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:919-924`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L919).
- The digest’s `17.5→14.8 tok/s` sustained S23 line is not supported by its cited source; audit
  found no artifact for it [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:957`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L957).
- The claim “Thermal Status 0 in every archived sample” is refuted by the plan audit: it found
  28 status-3 samples, plus status 1 and 2 samples [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:905-910`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L905).
- A digest can say the numeric q58 CPU deltas were measured, but must not call them a per-chunk
  GPU/NPU heat price: the exact audit says whole-process including mmap, n=2, and no policy device
  branch [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:189-193`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L189).
- `cpu7=1824000` and `gpubusy≈7.5%` are not supported by the cited audited plan’s artefacts;
  it explicitly marks those claims unverifiable there [`GOVERNOR-DEVICE-PLAN-2026-09-audited.md:1041-1042`](../../../archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md#L1041).
- Digest statements that the governor has already been switched on in production conflict with
  current living docs: governor remains off by default and a recent device smoke refused runtime
  engagement [`PLAN.md`](../../../PLAN.md), [`docs/ALIVE.md`](../../../docs/ALIVE.md).
