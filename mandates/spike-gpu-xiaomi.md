# MANDATO — SPIKE GPU su Xiaomi 14 (Adreno 750 VERIFIED): la porta GPU sul silicio giusto

**Device**: Xiaomi 14 (SM8650 / 8 Gen 3, **Adreno 750 — nella lista "verified
devices" ufficiale di OPENCL.md**, driver V@0762.36.1 del 12/2025, ~11.4 GB RAM,
Android 16/HyperOS 3, ICD presente in /vendor/lib64). adb wireless:
`adb-625689a2-9xEOfw` @ 192.168.1.193:34295 (pairing già fatto dal coordinatore).

**La tesi**: la porta GPU fu chiusa sul S23 per il driver del 740 (niente subgroup
broadcast) e per le ops ibride mancanti. Il 750 verified elimina il veto
device-side; **Marco (`qwen3moe`, attention standard) non ha il veto arch-side**.
Se lo split "esperti CPU / resto GPU" paga qui, il tier veloce guadagna un boost
condizionale per device 750+ — e la strada verso i 20 tok/s si accorcia.

**Regole:** timing solo STACCATO; batteria floor 30%; niente harness di campagna
su questo device (è fresco): disciplina minima = die annotato, run corti, ABBA;
nulla del S23/Jelly si tocca; STOP ai gate; mai `complete_goal`.

## S0 — setup (in carica OK)

1. Termux + sshd sul Xiaomi se assenti (coordinarsi con gualt per
   l'installazione/autorizzazioni — il device era già stato usato come lab in
   sessione #1: verificare cosa c'è).
2. Build **vanilla** llama.cpp recente: una con `GGML_OPENCL=ON`, una con
   `GGML_VULKAN=ON` (due binari llama-bench/llama-cli separati). Annotare commit.
3. **Probe driver**: dal log OpenCL all'avvio, cercare la riga sul **subgroup
   broadcast support** (lo smoking gun del S23 era `false`): trascriverla.
   `clinfo` se disponibile: estensioni cl_qcom_* a verbale.
4. Modelli: Llama-3.2-3B Q4_K_M + IQ2_XXS (già sul S23: trasferire via PC) e
   **Marco IQ2_M 5.7 GB** (già su PC dal trial — sta in RAM qui). Thread: leggere
   `cpu_capacity` e applicare la regola di campagna (core forti ≥50% del max).

## S1 — gate device-side (staccato): il 750 batte la CPU sul denso?

llama-bench, 3B Q4_K_M: tg128 e pp512, CPU vs OpenCL `-ngl 99`, 2 rep ABBA, cold.
| esito tg | lettura |
|---|---|
| GPU ≥ 1.15× CPU | **verde device-side** — il 740 era il problema, non "la GPU su Android" |
| 0.9-1.15× | giallo: annotare e procedere comunque a S2 (lo split usa la GPU per la parte dense, il regime è diverso) |
| < 0.9× (replica del S23) | ROSSO anche su 750: porta GPU chiusa anche qui, STOP dopo S2a di conferma |

## S2 — il test che conta (staccato): Marco con split esperti-CPU / resto-GPU

Marco IQ2_M **in RAM** (niente streaming: test pulito), llama-bench o llama-cli:
- **A**: CPU-only (baseline, -t da regola);
- **B**: `-ngl 99 --n-cpu-moe 999` (tutti gli esperti MoE su CPU, dense+attention
  su GPU) — OpenCL;
- **C** (se VRAM/UMA regge): `-ngl 99` pieno — OpenCL;
- (rep 2, ABBA, tg128 + pp512, die annotato).

| esito | conclusione |
|---|---|
| B o C ≥ **1.2×** A su tg | **PORTA GPU APERTA per Marco su 750+**: dossier "GPU boost condizionale per device" per il tier veloce |
| 1.05-1.2× | GIALLO: utile solo su prefill? riportare pp e decidere |
| ≤ 1.05× | chiusa anche sul silicio verified: a verbale, fine (e la regola "quale silicio" incassa un'altra conferma) |

## S3 — esplorativo (solo se S1 non è ROSSO): le ops ibride su Vulkan

Un HYBRID piccolo (Qwen3.5-2B GDN, Q4 — scaricare) su build **Vulkan**:
correttezza PRIMA di tutto (output greedy vs CPU: se gibberish → Vulkan/Adreno
non maturo, annotare e stop S3), poi tg CPU vs Vulkan `-ngl 99`. Informa il
futuro GPU di **CalaQwen** (GDN ✅ solo su Vulkan), non decide nulla oggi.

## Deliverable

`reports/moe-spike-gpu-xiaomi.md`: probe driver (riga subgroup!), tabelle S1/S2/S3
con die e batteria, verdetti per gate. Artefatti `results/gpu_xiaomi/`.
**STOP — qualunque dossier prodotto è di gualt.**
