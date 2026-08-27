---
name: adreno-moe-two-defects
description: "Campagna kernel Adreno COMPLETA al 22/08: 4+1 difetti fixati e device-verificati (407/407), kernel q2/q3 inediti, Vulkan morto sui K-quant, e la decision table finale: CPU pura vince SEMPRE in velocità sui MoE small-active, GPU = cool-mode solo KEXP (−19%/−2.75°C), mezzo-offload mai, streaming: GPU irrilevante"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0e5e48cb-1b53-436f-a35a-c661b00ea052
  modified: 2026-08-23T06:09:14.078Z
---

**RISCRITTURA INTEGRALE (2026-08-19, confermata da audit forense indipendente,
`scratchpad/agents/evidence-audit/REPORT.md`). La versione precedente di questa memoria
("il difetto vincolante è nei consumer") era SBAGLIATA.**

**La verità stabilita:** i kernel di calcolo MoE Adreno (gemv/gemm) sono **corretti** —
catena di assoluzioni completa su S23/Adreno 740: oracolo (idiomi dequant verbatim, 0/296
mismatch), audit in-situ del kernel di produzione (dst == riferimento semantico stock a
~2e-6, 12/12 × 2 run), readback integro (DST_READBACK 12/12 clean).

**I "due difetti che si compensano" erano write e read dello STESSO storage SoA:**
1. **Convert (write)**: load `ushort8` disallineati — reale, fixato byte-wise in
   `9dc1ec0cb` (ma ATTENZIONE: il byte-wise viola il contratto; il fix probabilmente
   giusto era la variante **bitselect**, condannata dal giudice truccato).
2. **Restore (read, `kernel_restore_block_q4_0_trans4_ns`, cvt.cl:352-392)**: idioma
   `uint4→as_ushort8→uchar*` su registro privato, **miscompilato dal compilatore Adreno**
   (lo stesso difetto che il commento del convert a cvt.cl:330-333 dichiara). Firma:
   byte qs DISPARI `got=(want&0x0F)|0xF0`. Round-trip misurato: buffer host-repack
   PERFETTO torna corrotto (61440/294912 = 46.9% dei blocchi per offset).

**Perché il test bocciava tutto:** `test-backend-ops` costruisce il riferimento CPU
copiando i pesi DALLA GPU via `get_tensor` (compare_graph_backend → graph_copy →
tensor_copy, ggml-backend.cpp:2156/2041/487) → il restore rotto avvelena il giudice —
QUALUNQUE giudice (per questo il judge-swap con ggml-cpu pristine falliva uguale).
Quando write e read erano rotti in modo accoppiato, il danno si annullava in round-trip
(ERR 0.18); fixato solo il write, il read rotto avvelenava il giudice (ERR 0.45).
**Il −55% storico va riletto in questa chiave: era un artefatto del giudice.**

**Perché q6_K/q8_0 passavano:** il restore q6_K usa l'idioma sicuro (`uchar*` su ARRAY,
loop scalare); q8_0 non passa dal path trans4_ns. Il denso nemmeno.

**Perché la produzione non se n'è mai accorta** (da lettura codice, NON ancora dimostrato
sul motore BMoE): l'inferenza reale non chiama mai `get_tensor` sui pesi — il path rotto
lo esercita solo il protocollo del test. Upstream ha visto la famiglia di difetto e ha
messo un gate che esclude A6X/A7X interi ("for now") invece di fixare il restore.

**RETRIAL S23 ESEGUITO (19/08 notte, commit artefatti `890a775`): FIX VERIFICATO.**
Il restore riscritto shift/mask (commit `eaec5d884`, branch kalsa/kernel-s3-repack)
ribalta TUTTI e 5 i tipi MoE colpiti da FAIL a PASS (q4_0 74/74, q4_1 75/75, q5_0 3/3,
q5_1 3/3, mxfp4 74/74), zero regressioni (q8_0 75/75, q6_K 3/3, denso 915/925 invariato).
f1/f2 a due punti CHIUSO: l'anello giudice→ERR non è più inferito, è provato (byte
avvelenati→ERR ~0.43 in banda vicino al teorico 0.45058; puliti→PASS; restore contributore
unico). Modello quantitativo confermato: 61.440 = 65.536−4.096 esatto. Il −55% storico è
ri-etichettato: delta parziale intermedio a restore rotto; il fix completo è −100%.
**Falsificata (unica) la predizione bitselect→0:** il producer bytewise E quello bitselect
producono gli STESSI 65.536 byte fuori contratto (miscompile identico o difetto strutturale
del convert) — ma l'e2e passa lo stesso (auto-consistenza producer↔consumer da
caratterizzare off-device); q4_K/q5_K MUL_MAT_ID FAIL è un difetto compute K2 PRE-esistente,
separato. HOST_REPACK repackava SOLO q4_0 (gli altri tipi no — trappola da ricordare).

**MAX RECALL + PUZZLE RISOLTO (19/08 notte): in realtà i difetti sono TRE, e uno è ANCORA
APERTO.** Simulazione byte-esatta (maxrecall-puzzle): (1) convert-READ disallineato — fixato
byte-wise in 9dc1ec0cb; (2) restore-READ R, block-even — fixato shift/mask in eaec5d884;
(3) **convert-WRITE P — APERTO**: su A740 forza la nibble alta dei byte qs dispari a 0xF
quando il byte SORGENTE PARTNER (trasposto, quello che contribuisce quella nibble) ha
**bit7=1** — esperimento discriminante 4-fill su S23 (const40→0, constC0→131.072 TUTTI,
lcg29→57.344): polarità bit7-SET, firma da sign-extension char/uchar nel load comune alle
DUE forme producer. ⚠️ il "want<0x80" della prima simulazione era un proxy coincidente col
moltiplicatore 131 del pattern. ⚠️ L'e2e PASS è
auto-consistenza (giudice e GPU condividono lo stesso storage sporco), NON fedeltà ai pesi:
qualunque load path che accende il convert device su A740 corrompe ⅛ dei pesi in silenzio.
Il rapporto 1/2 nei conteggi è un artefatto del pattern LCG dell'harness, non del kernel.
I consumer NON riscritti (q4_1/q5_0/q5_1/q4_K, idioma mask-then-shift) sono PROVATI non
miscompilati (156 casi, deviazione = 900× soglia). Numeri cella 6 corretti in arbitrato:
media ERR 0.4158, 4/12 sotto banda.

**P UCCISO (20/08 notte, `f63746555` = tag kalsakernel-v2, bundle su
Aspis0/kalsa-moe-experiments).** Localizzazione: probe pair-fill (gate = bit7 del byte PARI
x0) + readback RAW dello storage (la SCRITTURA corrompeva, il restore era innocente; lo
smear cross-byte x0→termine-di-x1 è impossibile dall'espressione ⇒ il compilatore
rivettorizza le corsie byte in short-lane con shift aritmetici). Il tentativo #1 (forma
dell'espressione, 39a0b130f) ebbe ZERO effetto device — lezione: su Adreno non si cura
l'espressione, si cura la STRUTTURA. Fix #2: path qs dei 5 convert riscritto in uint
scalare end-to-end (widening immediato, mask `u`, un solo store uint per word) → raw 0,
roundtrip 0 su 4 fill × 5 tipi × 2 arm, e2e PASS ora weight-faithful. **La medicina Adreno
è UNA: uint scalare end-to-end, mai corsie uchar/short nel dataflow.**

**SMOKE DI PRODUZIONE: IMMUNE DIMOSTRATO (20/08).** Sul motore vero (bmoe-cli,
LFM2.5-KEXP, S23, --ngl 99): zero dispatch trans4/restore, zero path trans4-moe, output
64-token BYTE-IDENTICO tra .so guarito e .so tutto-rotto. Controllo positivo obbligato:
lo shim originale era CIECO sui kernel trans4 (enqueue site diverso) — esteso in
55f43a574 prima di certificare; senza controllo positivo la claim (a) era vacua.
Caveat: KEXP = esperti Q2_K+Q3_K, il gate trans4 non è attivabile per tipo con la lineup;
il fix è load-bearing per gpt-oss (MXFP4) e per i quant narrow su Adreno in generale.
**CAPITOLO TRANS4 CHIUSO.** Bundle kalsakernel-v2 (head 55f43a574) su
Aspis0/kalsa-moe-experiments.

**K2 CHIUSO (20/08 notte, `c1bb48d32` = tag kalsakernel-v3, bundle su
Aspis0/kalsa-moe-experiments, outer d265854e).** q4_K 0/80 + q5_K 0/4 su MUL_MAT_ID
(GEMV+GEMM, ERR 0.57–0.96, q6_K passa) = **quarto SITO di miscompilazione E031**
(causa radice distinta NON stabilita — mai dire "quarto difetto distinto"): le maschere
LETTERALI in `get_scale_min_k4`. Qualcomm nei kernel dense le passava già come argomenti
(dodge load-bearing) ma non l'aveva portato nei MoE. Fix: maschere come kernel args nei
4 kernel + guardia ILA sul GEMM q4_K (il binario `_ila` ha la firma vecchia a 13 arg).
Prova: trasformazione semanticamente identica → FAIL→PASS (H5 morta); trigger preciso
(letterali vs forma ABI) non isolato — dummy-arg test opzionale. Il null di P2
(shift-first) era NON-diagnostico: l'innocenza del mask-then-shift qui la prova
P1-da-solo 80/80+4/4. Verifica finale: MUL_MAT_ID 391/391 tutti i tipi, dense 915/925
invariato, roundtrip 0. ⚠️ `-cl-opt-disable` NON compila su E031 (err -6) nemmeno sui
programmi piccoli — il -O0 non è un esperimento praticabile su questo compiler.
Beneficiari: Mellum2 (Q4_K_M) e i MoE Q4_K_M/Q5_K standard del mondo reale; la lineup
KEXP NO (esperti Q2_K/Q3_K = fallback CPU by design, tronco dense).
Upstream a master (verificato 20/08): gate A6X/A7X ancora attivo, K2 ancora rotto,
nessuno dei nostri 4 fix superseded; #26476 (q6_K flat dense, scalare) = stessa
medicina applicata da Qualcomm a un caso puntuale, candidato cherry-pick per i 10
dense FAIL noti.

**POST-K2 (21/08): il path riparato VA IL DOPPIO.** Cella OLMoE-1B-7B Q4_K_M su S23
staccato (esplorativa, ABBA×2): esperti GPU vs CPU = **2.17× burst (27.5 vs 12.7 t/s),
~1.5× sustained (15.3 vs 10.3), e più fresco** (CPU-arm tocca 40.2°C, GPU no); full
offload ngl16 stabile. ⇒ su A740, quando il modello sta in RAM, GPU-esperti è candidato
DEFAULT, non solo valvola termica (idea gualt). Serve N≥10 pre-registrata per ship claim.

**⚠️ Trappola scoperta per strada (oomwall, 21/08): i power-off dell'S23 con Mellum2
NON erano la GPU** — è il **REPACK ARM di default** (use_extra_bufts=true, e llama-bench
NON ha il flag per spegnerlo): ~6.5GB di posix_memalign anonimi a scala Q4_K_M su 8GB →
kernel death, anche a -ngl 0. Coppia probante W4/W4c a una variabile. LFM2.5 immune
(q2_K/q3_K non hanno path repack NEON). Produzione strutturalmente immune
(use_extra_bufts=false cablato). Per bench su device 8GB: SEMPRE variante no-extra-bufts.
Bug separato: map::at FLASH_ATTN d_head=64 senza guardia (llama-bench -fa auto) → usare
-fa off nei bench GPU.

**QK23 CHIUSO (21/08 sera, `ec7235af` = tag kalsakernel-v4, outer b28d5759): i kernel
MoE q2_K/q3_K SCRITTI DA ZERO — upstream non li ha per NESSUNA GPU — e gli esperti
KEXP girano su GPU per la prima volta.** Metodo che ha funzionato (tenere): design
triple-audited PRIMA del codice (2 pass Luna + verifica formale) → storage con
biiezioni certificate da un ORACOLO di dequant contro il CPU reference (nfail=0,
max_abs=0 — la rete che al trans4 mancava: roundtrip pulito NON basta, convert e
restore possono invertirsi e mentire entrambi al consumer) → kernel barrier-safe →
supports_op PER ULTIMO (i test q2/q3 in all_types/other_types si auto-accendono al
flip). Verifica: MUL_MAT_ID 401/401 (baseline 391 intatta), smoke LFM2.5 n_cpu_moe=0
con tutti e 4 i kernel in dispatch (controllo positivo), tg64 15.09 = smoke di
funzione NON claim di velocità. ⚠️ 5° difetto LATENTE trovato da review (non device):
i cloni q4/q5/q6 fanno early-return PRIMA della barrier di work-group + OOB GEMM su
shape %32&&!%64 — dormiente perché ogni shape reale è %64; q2/q3 nascono immuni
(m=96 device-proven GEMV+GEMM); port di famiglia = capitolo separato, NON toccare il
baseline v3 mid-chapter. Restore AoS: M6 vale solo per il convert — il restore usa
uint-privato + convert_uchar byte store (q2 stride 84 %4==0 può word-store, q3 110
%4==2 DEVE byte-store).

**ONDATA 21-22/08 — quasi tutto CHIUSO (dettagli in PLAN/ALIVE, qui solo i fatti
non ovvi):**
- #26476 cherry-pickato (925/925), **5° difetto FIXATO e device-VERIFIED (407/407,
  m=96 in dispatch, ILA out)**, flag `-nr/--no-repack` in llama-bench + guardia FA,
  3 nit host (#17), cvt: commenti sì ma **port uniformità RESPINTO dall'audit**
  (equivalenza piena falsa + alias sopravvissuti = terzo stile; su codice
  device-proven un mezzo-port è peggio del debito — spec per rifarlo in
  cvt-hygiene-audit). Engine head `1882bf8cd`, bundle rolling in backups/.
- **SHIP OLMoE 1.553×** (prereg v1.2, N≥5) e **KEXP A/B 1.803** (prereg v1.2) —
  MA entrambi scopati A-vs-B (expert placement a pari ngl). **Arm C (CPU pura)
  vince SEMPRE**: KEXP 17.55 vs A 14.25 (refute pre-registrato del floor A/C
  1.20), OLMoE 27.69 vs 20.03 (ogni cella). Mezzo-offload B = SEMPRE il peggiore.
  "GPU default candidate" RITIRATO. Cool-mode reale solo KEXP (−2.75°C); OLMoE
  parità termica. Il valore dei kernel = rendere possibile A e dimezzare il costo
  della modalità fresca (senza kernel: −55%).
- **Vulkan su A740: ZERO K-quant eseguibili** (createComputePipeline ErrorUnknown
  → SIGABRT; supports_op mente) — OpenCL nostro = unico path GPU. Build Vulkan
  Android: deps vendorizzati in deps/vulkan-android (bonificati).
- **Streaming (same-harness #23)**: CPU 0.216 ≈ tronco-GPU 0.223 — GPU
  irrilevante; il 23× fino a 5.10 è la ricetta (MAI dividere cross-harness).
- **NPU HTP: bocciata con numero** (0.67 MiB di pesi caricati = non carica il
  modello); decode DRAM-bound, l'NPU non ha banda propria.

**Restano:** #16 Xiaomi/750 (imminente), #22 tabella A/B/C su Marco-KEXP 6.4G
(fit-gated), #6/5b cache sweep + enforcement gate cpuset, #7 gap kernel_kf, #24
governor termico CPU↔GPU (design), #25 rilettura proposte pazze d'archivio,
#8 pubblicazione (owner).

**Strumenti costruiti (env-gated, inerti di default, branch `kalsa/kernel-s3-repack`):**
`GGML_OPENCL_ORACLE`, `GGML_OPENCL_GEMV_AUDIT` (+GLUE_AUDIT+DST_READBACK),
`GGML_OPENCL_HOST_REPACK`, `GGML_OPENCL_DUMP_Q`, roundtrip harness
`tests/test-opencl-moe-roundtrip.cpp`. ⚠️ ORACLE parsa il valore ("0"=off);
HOST_REPACK/DUMP_Q sono presence-only (un "0" li ACCENDE).

**Disciplina che ha reso possibile la scoperta (tenere):** appaiare per nome del caso,
solo medie su n grande, sha del binario on-device prima di ogni run, review ostile a ogni
passo + audit forense finale claim-vs-artefatti.

**ONDATA 750 (#16, 22/08 sera, audit BANK-w-corrections):** su Xiaomi 14 /
Adreno 750, compilatore PIÙ NUOVO E031.45.02.25: **MUL_MAT_ID 407/407 — i
kernel trasferiscono su tutta la famiglia A7X**. Ma MUL_MAT dense 905/925: 20
FAIL deterministici f16/bf16×f32 batched **nr≠[1,1]** (k=1056/k_v=2112, path
upstream, non nostro) = ogni build E031 rompe cose diverse (attribuzione
compilatore: ipotesi forte non isolata). E il verdetto velocità del 740 NON
generalizza: **sul 750 parità decode CONFERMATA (A/C 0.992, N=5 protocollo
pulito) e prefill A=2.48×** (KEXP); B peggiore ovunque. **Fit-gate duro:
Marco-KEXP 6.4G full-GPU sul 750 = KERNEL REBOOT (mai ritentare); in RAM su
CPU fa 28.2 t/s = 3.4× l'S23 dove non sta in RAM → il fit domina tutto.**
Prefill dense: il 5.77× storico era baseline CPU debole → onesto 1.43×/2.62×
(GPU invariata, CPU head 4×). Gap harness da fixare: hash gguf ON-DEVICE mai
registrato in fase b/c.

**SECONDO GIUDICE AVVELENATO (22/08, backend Hexagon):** test-backend-ops sui
quant dà `CPU=nan` identico su v73 e v75 (44/70 fail) con HTP finito — consulto
Qwen: sospetto primario = **poisoning da buffer ARM-REPACK nel reference CPU**
(classe nota upstream, NON fast-math: l'accumulo dotprod/i8mm è intero). Lezione
generale ribadita: quando acceleratore e giudice divergono, INDAGARE PRIMA IL
GIUDICE (è la seconda volta: get_tensor su Adreno, buffer REPACK su Hexagon).
Esperimento discriminante: forzare il reference su plain-host buffer. E su Mali:
i kernel MUL_MAT_ID sono shuffle-free by construction → è il template per il
dense (ricetta 4 stadi in scratchpad/agents/consult-qwen-nan-mali/ANSWER.md).

**RISOLUZIONE (23/08, tutto device-verified + audit Luna):** Qwen aveva la classe
giusta ma il vettore sbagliato — NON era REPACK (Jelly CPU-only: 194/194 pass),
era il **memcpy dei tile del buffer HTP `is_host`** che avvelenava il reference
(PLAIN_HOST=1 → nan_scales tutti a 0, 0/70→34/70). E i 36 fail residui erano un
TERZO difetto di harness: **il kernel HMX non girava proprio** (contratto host/DSP
rotto su m%32, `INTERNAL-ERROR` loggato e IGNORATO → si confrontava il fill
random). Euristiche durevoli: (1) acceleratore vs giudice divergenti → indagare
PRIMA il giudice (tre conferme: get_tensor Adreno, tiled-memcpy Hexagon, HMX
never-ran); (2) **un ERR 10⁵× la soglia non è imprecisione: l'output non è il
calcolo — chiedersi se il kernel è mai partito e se gli errori vengono ingoiati**;
(3) i consulenti esterni azzeccano la classe, non il vettore: verificare nel
codice prima di costruire esperimenti sulla loro ipotesi. HTP mai colta in errore
di calcolo sui quant supportati; il difetto vero da fixare è l'error-swallowing
(`ggml-hexagon.cpp:1591`).

Vedi [[kalsa-engine-single-lineage]], [[never-push-to-upstream-bigmoe]],
[[cpuset-gate-every-harness]].
