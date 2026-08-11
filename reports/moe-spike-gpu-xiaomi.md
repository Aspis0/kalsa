# MoE GPU spike — Xiaomi 14 (Adreno 750) — FASE 0 + S0 deliverable

Mandato: `mandates/spike-gpu-xiaomi.md` · FASE 0 (read-only research) + S0 (setup + build + probe + models + dump)
Data: 2026-08-11 · Stato: **B1 gate = STOP · S2/S3 bloccati · S1 pendente smoke reale Termux**
Verdict: lo spike **non prosegue** oltre B1. Lo STOP è il risultato corretto. S1 non è stato ancora tentato (probe m1 OpenCL invalido sotto `run-as` — vedi §6).

## 0. TL;DR

| tappa | esito |
|---|---|
| S0a setup Termux + pacchetti | ✅ (Termux app+boot+api installati; openssl recuperato; tutti i pacchetti GPU/build presenti) |
| S0b survival HyperOS | ✅ (wake-lock, whitelist, appops OK; screen_off_timeout ripristinato a 60s) |
| S0c build OpenCL @ pin 5236140e5 | ✅ `llama-bench` pronto |
| S0c build Vulkan | ❌ shaderc coopmat2 capability 5447 |
| S0d probe m1 (driver + subgroup) | ⚠️ invalido (SELinux `runas_app`) — serve smoke reale Termux |
| S0e modelli (4/4 con sha256) | ✅ tutti scaricati, sha verificati |
| S0f gate B1 (dump per-tensor Marco) | 🛑 **STOP** — dense IQ2_S/IQ3_S → S2 ininterpretabile |
| S1 (3B CPU vs OpenCL) | pendente — richiede m1 valido in contesto Termux reale |
| S2 (Marco split GPU) | 🛑 **bloccato** finché dense non viene requantizzato in Q4–Q8 |
| S3 (Vulkan Qwen 3.5-2B) | 🛑 **bloccato** dalla build Vulkan fallita |

**Batteria**: 89% → 82% (no abort, floor 40% mai toccato). **Termico**: peak 84.4°C (sotto soglia 85°C/5min; steer orchestrator over-conservativo a 84°C → pause, ripresa a 49.1°C con `-j4`).

## 1. Setup

### Device
Xiaomi 14 (SM8650, Adreno 750), ~11.4 GB RAM, ~7 liberi, Android 16 / SDK 36 / HyperOS V816, adb wireless `adb-625689a2-9xEOfw._adb-tls-connect._tcp` (porta TLS).

### Pin build engine
Commit `5236140e5` (riferimento di campagna: backend OpenCL, `-ncmoe` in llama-bench, riga subgroup — NON "master recent"). Source: clone di llama.cpp @ quel commit in `$HOME/llama.cpp`.

### Pacchetti (tutti `ii`)
openssl recuperato via `dpkg --force-confdef --force-confold --configure -a` (era `iU` per prompt interattivo su openssl.cnf). Installati: `git 2.55.0`, `cmake 4.4.2`, `ninja 1.13.2`, `clang 21.1.8`, `opencl-headers 2026.05.29`, `ocl-icd 2.3.5`, `clinfo 3.0.25.02.14`, `vulkan-headers 1.4.359`, `vulkan-loader 0.0.3`, `shaderc 2026.3`, `glslang 16.5.0`, `spirv-headers 1.4.357.0`, `python 3.14.6`, `openssh 10.4p1`.

## 2. Survival (HyperOS)

| azione | esito |
|---|---|
| `cmd appops set com.termux RUN_IN_BACKGROUND allow` | ✅ `RUN_IN_BACKGROUND: allow` |
| `dumpsys deviceidle whitelist +com.termux` | ✅ `Added: com.termux` (senza root) |
| `termux-wake-lock` | ✅ |
| `settings put system screen_off_timeout` | settato a `1800000` (30 min) dall'agente durante S0; **ripristinato a `60000` (60s) dall'orchestrator** per uso giornaliero |
| storage perms | `POST_NOTIFICATIONS granted=true`; SELinux `runas_app` blocca `/sdcard` |

Inventario onesto (vedi `results/gpu_xiaomi/inventory_checklist.txt`): `Termux:Boot` APK presente ma disabilitato, `sshd` binario presente ma non in esecuzione (run-as deviation), disco 339 GB liberi, `Termux:API` APK 0.53.0 installato ma `dpkg termux-api` assente → `TERMUX_API_VERSION=NA`.

## 3. Termico

Snapshot completo: `results/gpu_xiaomi/logs/thermal_zones_snapshot.txt` (102 zone leggibili da Termux uid `u0_a649`).

| momento | Tmax (°C) |
|---|---|
| S0 start | 33.9 |
| OpenCL build (peak) | **84.4** (registrato `max=84400`) |
| dopo pause (cool) | 71.9 |
| ripresa `-j4` | 49.1 |
| S0 end (B1 gate) | 34.6 |

**Nessun superamento** di 85°C sostenuto per >5min né di 90°C istantaneo. Lo steer dell'orchestrator a 84°C è stato over-conservativo (regola rilassata dall'utente: 85°C/5min OK). Una sola pausa; ripresa con `-j4` (thermal load dimezzato).

## 4. Build OpenCL ✅

CMake:
```
cmake -B build-opencl -G Ninja \
  -DGGML_OPENCL=ON -DGGML_VULKAN=OFF -DGGML_NATIVE=OFF \
  -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16 -DLLAMA_CURL=OFF \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_OPENCL_USE_ADRENO_KERNELS=ON
```
**Flag corretto**: `GGML_OPENCL_USE_ADRENO_KERNELS` (NON `USE_ADRENO` come ipotizzato dall'agente nel report preliminare — verificato da `build_opencl.log:55` "OpenCL will use matmul kernels optimized for Adreno"). Compilato con successo dopo 1 pausa termica.

Binario: `~/llama.cpp/build-opencl/bin/llama-bench` presente.

## 5. Build Vulkan ❌

```
shaderc: Invalid capability operand: 5447 on coopmat2 flash_attn shaders
```
Il bug è nel compilatore GLSL (`shaderc`) sulla famiglia coopmat2 (cooperative matrix 2 — Adreno 730/740). Non è un flag CMake errato. Possibili fix futuri: pin shaderc a versione più vecchia, disabilitare i shader coopmat2 nel backend Vulkan (se esposto da llama.cpp), o aspettare un aggiornamento di shaderc upstream. Per lo spike corrente: **nessun binario Vulkan prodotto**.

**Caveat**: il wrapper di build registra `BUILD_EXIT=0` anche quando Ninja fallisce (falso successo). Lo stato reale va verificato dalla presenza di `bin/llama-bench-vulkan` (assente).

## 6. Probe m1 — INVALID (gate failure, deviation elevated)

Il probe è stato eseguito via `run-as com.termux` (deviazione dall'ssh del mandato — motivata: giornaliero, niente root, ssh setup pesante). Sotto `runas_app`, SELinux blocca `clGetPlatformIDs` di OpenCL. Output ottenuto:
```
ggml_opencl: platform IDs not available.
```
Le righe richieste dal mandato **NON sono mai state stampate**:
- `ggml_opencl: OpenCL driver:`
- `ggml_opencl: vector subgroup broadcast support:`
- `ggml_opencl: cl_qcom_subgroup_shuffle support:`

Il probe `run-as` **NON è valido come evidenza del device** (contesto SELinux sbagliato). Per ottenere le righe reali serve un contesto Termux reale: l'utente deve aprire l'app Termux sul telefono ed eseguire il smoke (la sessione utente dell'app gira come `untrusted_app_27`, non `runas_app`). Lo smoke dura ~10-15s:
```bash
LD_LIBRARY_PATH=/vendor/lib64:/data/data/com.termux/files/usr/lib \
  $HOME/llama.cpp/build-opencl/bin/llama-bench \
  -m $HOME/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf -ngl 1 -p 0 -n 8 \
  2>&1 | tee $HOME/opencl_smoke_real.log
```
Quando disponibile, `adb pull $HOME/opencl_smoke_real.log`. **Lo smoke è gate per decidere se S1 ha senso**: senza un probe valido, il gate S1 (3B CPU vs OpenCL) non può essere aperto (i risultati sarebbero privi di senso).

**Deviation elevata da "deviation" a "gate failure"**: `run-as` non basta per il probe OpenCL.

## 7. CPU capacities → `-t 6`

```
cpu0=379 cpu1=379 cpu2=923 cpu3=923 cpu4=923 cpu5=867 cpu6=867 cpu7=1024
```
max=1024, threshold (50%) = 512. Core >512: cpu2,3,4,5,6,7 → **6 core → n_threads = 6** (confermato G99-style). Layout: 2+3+2+1 (little/mid/mid-high/prime).

## 8. Modelli (tutti su device, sha256 verificati)

| file | bytes | sha256 |
|---|---:|---|
| `Llama-3.2-3B-Instruct-Q4_K_M.gguf` | 2.019 GB | `6c99cc00ae910f6a532a80022cb4bc1939094527a089c29294b841c0bd87f74d` |
| `Llama-3.2-3B-Instruct-UD-IQ2_XXS.gguf` | 1.047 GB | `71aae376aa27117203ae4311aba8733408a7caf437a7367da8067017f1e8a25d` ✓ (match S23) |
| **`Marco-Mini-Instruct.i1-IQ2_M.gguf`** | **5.696 GB** | `c902bfcbec4a1c08dc57eb42dffca8de8dd84e058785ebda004e9537a4fe5b1e` |
| `Qwen3.5-2B-Q4_K_M.gguf` | 1.281 GB | `aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223` |

Path: `$HOME/models/`. `SHA256SUMS.txt` scritto. Il Marco tensor structure è coerente con un MoE a 28 layer (verificato nel dump).

## 9. Gate B1 — **STOP** (per-tensor dump)

Comando dump adattato: il path `gguf-py/scripts/gguf_dump.py` del mandato non esiste al pin `5236140e5`; lo stock `gguf-py/gguf/scripts/gguf_dump.py` (sha `d8b8fc28…`) richiede numpy e fallisce in `run-as` (anche `/sdcard` negato). Soluzione operativa: script senza dipendenze (`logs/gguf_types_only.py`, sha `465fd717…`), eseguito in `run-as` con output in pipe:
```
python3 $HOME/logs/gguf_types_only.py $HOME/models/Marco-Mini-Instruct.i1-IQ2_M.gguf
```
EXIT=0, conteggi **coerenti** con il dump originale (`logs/marco_gguf_dump.txt`): nessuna discrepanza. Provenance documentata in `logs/marco_dump_command.sh` (comando esatto + python 3.14.6 + sha del tool + exit code).

### Conteggi non-expert (verificati, coerenti col dump originale)
| type | n |
|---|---:|
| F32 | 141 |
| **IQ2_S** | **56** |
| **IQ3_S** | **28** |
| Q4_K | 28 |
| Q5_K | 1 |

Esempio rappresentativo:
```
NONEXP F32      [1024]  output_norm.weight
NONEXP Q5_K     [1024, 151936]  token_embd.weight
NONEXP IQ2_S    [1024, 1024]   blk.0.attn_k.weight
NONEXP IQ3_S    [2048, 1024]   blk.0.attn_output.weight
NONEXP IQ2_S    [1024, 2048]   blk.0.attn_q.weight
NONEXP Q4_K     [1024, 1024]   blk.0.attn_v.weight
```

### Conteggi expert
| type | n |
|---|---:|
| IQ2_S | 81 |
| IQ3_S | 3 |

### Verdict gate (ristretto, vedi §10)
**Set consentito (risolto dopo review)**: `{Q4_K, Q5_K, Q6_K, F32}` — Q8_0 rimosso perché `build_opencl.log:430` documenta "TODO: implement ... Q8_0 support" nel backend OpenCL a questo pin; i tipi extra BF16/F16 visti dal dump tool sono type-map entries, non del set del mandato.

**BAD_TYPES**: `[IQ2_S, IQ3_S]`. Dense attention = IQ2_S (q,k per ogni layer) + IQ3_S (output per ogni layer). L'OpenCL backend di llama.cpp a questo pin **non ha kernel IQ2/IQ3** → offload silenziosamente nullo → fallback CPU non dichiarato → **S2 ininterpretabile**.

**Verdict**: 🛑 **STOP**. S2 (Marco split routed-CPU / resto-GPU) **non può essere tentato** finché il modello non viene requantizzato con dense in Q4–Q8. Possibili interventi (futuri, richiedono GPU): requant KEXP-style del dense (dossier a parte, non di questo spike), oppure modello con dense non i-quant.

## 10. Deviazioni (riassunto onesto)

1. **ssh non usato** — `run-as com.termux` via adb. Motivazione: giornaliero, no root, setup sshd pesante + gestione chiavi. Documentato come "gate failure" sul probe m1 (vedi §6), non solo deviazione.
2. **Probe m1 OpenCL invalido** — SELinux `runas_app` blocca platform init. Smoke reale richiesto.
3. **Vulkan build fallita** — shaderc coopmat2 capability 5447. Non è un flag CMake errato.
4. **BUILD_EXIT=0 unreliable** — wrapper di build bug noto: BUILD_EXIT=0 anche quando Ninja fallisce. Validare sempre via presenza del binario.
5. **Dump tool adattato** — il path `gguf-py/scripts/gguf_dump.py` del mandato non esiste al pin; usato `gguf-py/gguf/scripts/...` + script senza dipendenze (numpy non disponibile in `run-as`). Conteggi confermati coerenti.
6. **Thermal steer over-conservativo** — steer orchestrator a 84°C (regola rilassata utente: 85°C/5min OK). Una sola pausa, ripresa a 49.1°C con `-j4`.
7. **screen_off_timeout** — agente impostato 1800000 (30min) per disciplina del mandato; orchestrator **ripristinato a 60000 (60s)** per uso giornaliero.

## 11. Restore verificato

Output `results/gpu_xiaomi/restore_verified.txt`:
```
settings get system screen_off_timeout      → 60000  (orchestrator-restored)
cmd appops get com.termux RUN_IN_BACKGROUND → allow
dumpsys deviceidle whitelist | grep termux   → com.termux
```
Termux:Boot APK presente ma non abilitato (invariato). sshd binario presente ma non in esecuzione (invariato). Nessuna modifica irreversibile al telefono oltre l'installazione dei 3 APK Termux (rimovibili), il prefix Termux sotto `$HOME` e `$PREFIX`, e i modelli scaricati in `$HOME/models/` (~10 GB totali, rimovibili).

## 12. STOP — Decisione finale

Per il **mandato (S2/S3 bloccati dal gate B1)**:
- 🛑 **S2 (Marco split GPU)**: NON eseguito. Dense attention IQ2_S/IQ3_S → OpenCL silent CPU fallback → S2 non interpretabile. Per tentare S2 serve requant del dense in Q4–Q8 (dossier separato).
- 🛑 **S3 (Vulkan Qwen 3.5-2B)**: NON eseguito. Build Vulkan fallita su shaderc coopmat2. Per tentare S3 serve fix del build (pin shaderc vecchio o flag di disabilitazione shader coopmat2 nel backend Vulkan).

Per **S1 (3B Q4_K_M CPU vs OpenCL)**:
- ⏸️ **Pendente** — richiede il probe m1 OpenCL valido in contesto Termux reale (vedi §6). Lo smoke reale dura ~15s e deve essere eseguito dall'utente aprendo l'app Termux sul telefono. Il comando è nel §6.

## 13. Artifacts (`moe-experiments/results/gpu_xiaomi/`)

```
S0_REPORT.md                        (working report agente, fixato dopo review)
marco_dump_command.sh               (provenance dump)
marco_dump_v2.txt, marco_dump_v2.err  (dump reprovveniente con EXIT)
gguf_types_only.py                  (dump tool no-deps usato)
restore_verified.txt                (verifica restore screen/appops/whitelist)
inventory_checklist.txt             (Termux:Boot, sshd, Termux:API, TERMUX_API_VERSION)
disk_space.txt, termux_info.txt     (snapshot Termux e disco)
thermal_zones_snapshot.txt          (102 zone termiche)
build_opencl.log                    (cmake + build OpenCL)
build_vulkan.log                    (cmake + build Vulkan + BUILD_EXIT=0 bug noto)
thermal_opencl.log                  (peak 84.4°C, pause/ripresa)
downloads.log, dl_models.log        (fetch + sha256)
sha256_models.txt, SHA256SUMS.txt   (manifest modelli)
runs.csv                            (placeholder: nessuna run di timing in S0)
```

## 14. Conclusione

Lo spike S0 stabilisce la fattibilità del setup on-device (Termux + build OpenCL + 4 modelli con sha) e **ferma B1**: il modello premium candidato (Marco i1-IQ2_M) ha dense attention i-quant che l'OpenCL backend al pin `5236140e5` non sa caricare → la porta GPU è **chiusa** per questo modello senza requant. Vulkan build rotto (shaderc coopmat2). S1 pendente dal smoke reale Termux. S2/S3 bloccati.

**I dossier prodotto sono di gualt.**
