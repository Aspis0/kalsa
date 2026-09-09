# MANDATO — SPIKE GPU su Xiaomi 14 (v2 POST-AUDIT)

> v2 dopo audit ostile DeepSeek (2 BLOCKER + 6 MAJOR recepiti): modelli da
> scaricare e pinnare (l'IQ2_M di Marco NON esiste ancora), dump per-tensor
> obbligatorio (OpenCL ha ZERO kernel IQ2: offload silenziosamente nullo se i
> dense sono IQ2), aritmetica RAM dichiarata (cella C = OOM atteso), disciplina
> di misura S23-grade, build path specificato con fallback NDK.

**Device**: Xiaomi 14 (SM8650, Adreno 750 verified, ~11.4 GB RAM di cui ~7
liberi con HyperOS, Android 16). adb wireless `adb-625689a2-9xEOfw` @
192.168.1.193:34295 (pairing fatto; la porta RUOTA al reboot).
**Pin build: commit `5236140e5`** (il riferimento di campagna: ha backend
OpenCL, `-ncmoe` in llama-bench e la riga subgroup — NIENTE "master recente").

## S0 — setup e sopravvivenza (in carica OK)

1. **Inventario con checklist**: Termux presente? sshd? porta? spazio ≥15 GB?
   Termux:Boot? permessi storage? (nessun report della "sessione #1" esiste:
   verificare tutto, assumere niente).
2. **Sopravvivenza HyperOS (M2)**: whitelist batteria "senza restrizioni" per
   Termux, `termux-wake-lock`, Termux:Boot con sshd PER PRIMO; **ssh = canale
   unico di esecuzione** (adb solo pairing/push); `screen_off_timeout 1800000`
   a inizio sessione e RIPRISTINATO a fine.
3. **Build (M3)**: Termux on-device: `pkg install opencl-headers ocl-icd clinfo
   vulkan-headers vulkan-loader shaderc` (glslc è OBBLIGATORIO a build-time per
   Vulkan), `LD_LIBRARY_PATH=/vendor/lib64:$PREFIX/lib`; CMake:
   `GGML_OPENCL=ON` (build 1) / `GGML_VULKAN=ON` (build 2), `GGML_NATIVE=OFF`,
   `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16`, `LLAMA_CURL=OFF`.
   **Fallback dichiarato**: cross-build NDK dal PC (`scripts/build_bmoe_ndk.sh`
   esteso con i flag GPU) + push. Smoke `-ngl 1` su GGUF piccolo PRIMA di
   qualunque misura (valida il link runtime con libOpenCL vendor).
4. **Probe (m1)**: dal run smoke con `-ngl 1`, grep e trascrizione ESATTA di:
   `ggml_opencl: OpenCL driver:`, `ggml_opencl: vector subgroup broadcast
   support:`, `ggml_opencl: cl_qcom_subgroup_shuffle support:` (il flag è
   derivato dalla versione compiler E031≥47/DX≥17, non misurato).
   Probe zone termiche: lista `thermal_zone*/type`+temp, leggibilità da uid
   Termux; se SELinux blocca → proxy = temperatura batteria, dichiarato.
   Leggere `cpu_capacity` di tutti i core → regola campagna (≥50% del max) →
   **-t atteso 6**, fisso e identico su TUTTI gli arm.
5. **Modelli (B1/M4/m5) — scaricare/trasferire con sha256 a verbale:**
   - Llama-3.2-3B **Q4_K_M** (~2 GB): NON esiste su nessun device — download;
   - Llama-3.2-3B UD-IQ2_XXS: dal S23 (sha nota `71aae376…`);
   - **Marco `i1-IQ2_M` (~5.7 GB): DOWNLOAD (non è mai stato scaricato)**;
   - Qwen3.5-2B Q4: già su PC (`models/draft/`) — push.
   Trasferimenti ~8.7 GB via scp su Wi-Fi, sha verificato a destinazione.
6. **Dump per-tensor di Marco i1-IQ2_M (B1 — GATE)**: i tensori NON-expert
   devono essere in {Q4_K, Q5_K, Q6_K, F32, Q8_0} ⊆ supporto OpenCL. **Se i
   dense sono IQ2_*: S2 NON è interpretabile (zero kernel IQ2 nel backend,
   fallback CPU silenzioso) → STOP e riportare** (eventuale ripiego: nostra
   requant KEXP-style del dense — dossier, non improvvisazione).

**Disciplina di misura per S1-S3 (M1)**: UNPLUGGED verificato
(termux-battery-status), batteria ≥40% start / floor 30% con abort, die start
≤45 °C, PAUSA se die>85 sostenuto 60 s, ABORT >90; flight minimale 5 s
(die/MemFree/batt/plugged); **fadvise cold prima di OGNI run di timing**
(cold_model.sh + fadv portati dal S23); checkpoint batteria ≥45% prima di S2.
Solo llama-bench, invocazioni fisse: tg `-p 0 -n 128 -t 6 -r 2`, pp `-p 512
-n 0 -t 6`. **Ogni run = una riga in `results/gpu_xiaomi/runs.csv`.**

### S0.3-bis — FIX build Vulkan (post-primo-giro: shaderc coopmat2 cap 5447)

Il fallimento è build-time (shaderc Termux non conosce coopmat2 — che l'Adreno
NON supporta comunque: disabilitarla è a costo zero). NIENTE root. Due strade
in ordine:
1. **One-line**: ri-cmake con `-DGGML_VULKAN_COOPMAT2_GLSLC_SUPPORT=OFF` (e se
   serve anche `-DGGML_VULKAN_COOPMAT_GLSLC_SUPPORT=OFF`) — gli shader coopmat
   non vengono compilati. Verificare i nomi esatti delle option nel CMake del
   pin (`ggml/src/ggml-vulkan/CMakeLists.txt`) prima di usarli.
2. **Piano B**: cross-build NDK dal PC — gli shader si compilano sulla macchina
   di build col glslc desktop (Vulkan SDK recente), Termux non c'entra; push
   del binario.
Validazione: presenza del binario (NON fidarsi di BUILD_EXIT=0, bug noto del
wrapper) + smoke `-ngl 1` con la correttezza del protocollo S3.

## S1 — gate device-side (staccato): il 750 batte la CPU sul denso?

3B Q4_K_M, tg128 + pp512, CPU vs OpenCL `-ngl 99`, ABBA, 2 rep, cold, Δdie
start tra rep ≤5 °C. **Gate sulla mediana; tie-break: terza rep se il ratio
cade in 1.08-1.22×.** pp512 = informativo, NON entra nel gate.
| tg GPU/CPU | lettura |
|---|---|
| ≥ 1.15× | verde device-side → S2 (+1 cella sustained n=512 GPU per il regime termico) |
| 0.9-1.15× | giallo: S2 comunque (regime diverso) |
| < 0.9× | rosso anche su 750 → S2a di conferma e stop |

## S2 — Marco con split routed-CPU / resto-GPU (staccato)

**Aritmetica RAM dichiarata PRIMA (B2)**: doppia residenza host+device (upload
via clEnqueueWriteBuffer, nessun reclaim del mmap — PR #24156 non mergiata):
- **A** CPU-only: ~6.2-6.7 GB → sta;
- **B** `-ngl 99 --n-cpu-moe 999`: 5.7 host + ~1.2-2 device ≈ 7.2-7.7 GB vs ~7
  disponibili → **borderline**: pre-check MemAvailable ≥7.5 GB, monitor
  majflt/RSS, run abortito = cella FAIL (mai stima);
- **C** `-ngl 99` pieno: ~11.4 GB richiesti → **OOM ATTESO a priori** — si
  tenta 1 volta, l'abort è l'esito previsto, informativa se sopravvive.

A/B ABBA 2 rep (C dopo), tg128 + pp512. **Catturare il log `offloaded %d/%d
layers to GPU` + verbose per-tensor**: la prova di COSA sta sulla GPU è parte
del deliverable (nota m4: lo shared expert VA su GPU — la regex di ncmoe non
matcha `ffn_shexp` — dichiararlo nel report).
| tg B/A | conclusione |
|---|---|
| ≥ 1.2× | PORTA GPU APERTA per Marco su 750+ (dossier "GPU boost condizionale") |
| 1.05-1.2× | giallo: riportare pp (prefill-only value?) |
| ≤ 1.05× | chiusa anche su silicio verified — a verbale |

## S3 — ops ibride su Vulkan (esplorativo, solo se S1 non rosso)

Qwen3.5-2B (GDN) Q4, build Vulkan. **Protocollo correttezza (M6)**: stesso
prompt, seed fisso, temp 0, n=128, CPU vs Vulkan `-ngl 99`, `-fa` identico,
ABBA 2 rep. Metriche: posizione prima divergenza, **top-1 agreement ≥90% sui
primi 64 token**, assenza di loop degenerati, sanity PPL su slice fissa.
(La byte-identità cross-backend NON è attesa: ordine FP diverso.) Poi tg
CPU vs Vulkan. Informa il futuro GPU di CalaQwen, non decide nulla oggi.

## Deliverable

`reports/moe-spike-gpu-xiaomi.md`: probe (righe driver esatte), dump Marco,
runs.csv, tabelle S1/S2/S3 con die/batteria/majflt, log offload, verdetti per
gate. **STOP — i dossier prodotto sono di gualt.**
