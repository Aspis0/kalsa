# MANDATO — DEEP RESEARCH WEB: split eterogeneo CPU+GPU (Adreno 740 / OpenCL) per lo streaming MoE

**Solo ricerca: zero codice, zero telefono, zero build.** Obiettivo: decidere se lo
"esperimento serio" (dense+attention su GPU Adreno, esperti streamati su CPU, overlap)
merita lo spike — e come disegnare lo spike per farlo fallire presto se deve fallire.

Contesto (dal PLAN, STATO CORRENTE): collo = CALCOLO a 1.39 GHz (ceiling termico, 41%
del picco); I/O esposto 20%; GEMM esperti ≈50% del calcolo, dense+attention l'altro
~50%. Device: Galaxy S23, Snapdragon 8 Gen 2, **Adreno 740**, 8 GB. Modello:
Qwen3.6-35B-A3B UD-IQ2_M, **ibrido attention+SSM (gated delta net)**, runtime = fork
BigMoeOnEdge di llama.cpp (base submodule `5236140e5`).

**Regole di ricerca:** ogni claim col suo URL; distinguere **[V]** (verificato alla
fonte primaria: repo/commit/doc ufficiale/paper) da **[S]** (stima/blog/sentito dire);
data di ogni fonte (il backend OpenCL evolve in fretta — privilegiare 2025-2026);
se una risposta non si trova, scrivere NON TROVATO, non riempire il buco.

## Le domande, in ordine di potere-di-veto (le prime possono uccidere tutto)

### K1 — Supporto quant del backend OpenCL di llama.cpp
Quali tipi quant supporta OGGI il backend OpenCL (matmul nativo, non fallback)?
In particolare: **le i-quants (IQ2_M/IQ2_XS/IQ3…) sono supportate?** Il nostro GGUF è
UD-IQ2_M *dinamico*: i tensori dense/attention potrebbero essere Q4_K/Q6_K (verificare
sul NOSTRO dump: `results/` gguf-dump di inizio campagna, tipi per-tensor dei layer
NON-expert). Se i tensori che vogliamo offloadare non sono supportati → morto o serve
requant del solo dense (possibile? a che costo?).

### K2 — Ops SSM/ibride sul backend OpenCL
Il modello è ibrido attention+**gated delta net**. Le ops SSM/GDN (`ssm_scan`,
delta-net, conv correlate) esistono nel backend OpenCL? Se no: il fallback CPU
per-layer che sync impone? C'è esperienza pubblica di modelli ibridi (Qwen3-Next,
Falcon-H, Jamba…) offloadati su OpenCL/Vulkan mobile? Questo è il killer più probabile.

### K3 — Split "esperti su CPU, resto su GPU" in llama.cpp mainline
Esiste e come funziona (`--n-cpu-moe` / `tensor_buft_override` / `-ot` regex)? Con MoE:
il router decide sul device giusto? Che sync per token impone lo split? È compatibile
concettualmente col nostro streaming (esperti = mmap/anon CPU-side del fork)?

### K4 — Zero-copy / memoria unificata su Adreno
Come gestisce il backend OpenCL i buffer su Adreno: `CL_MEM_ALLOC_HOST_PTR`,
estensioni Qualcomm (`cl_qcom_ext_host_ptr`, ION/dmabuf)? I pesi offloadati stanno in
memoria unificata (zero-copy) o vanno copiati? Con 8 GB totali e ~3.9 GiB già presi
dal nostro processo: quanto "costa" in RAM spostare ~1.5-2 GiB di dense su buffer GPU?

### K5 — Numeri Adreno 740 reali
Benchmark pubblicati di llama.cpp OpenCL su 8 Gen 2 / Adreno 740 (blog Qualcomm,
issue/discussion GitHub, paper): tok/s, confronto vs CPU dello stesso device, GEMM
GFLOPS raggiunti, e SOPRATTUTTO comportamento **sostenuto/termico** (il nostro
vantaggio sperato è spostare watt su silicio diverso — qualcuno l'ha misurato?).

### K6 — Prior art diretto: MoE streaming + GPU/NPU su smartphone
**PowerInfer-2** (fa esattamente hetero su 8 Gen 2 con esperti sparsi — cosa hanno
misurato, cosa è riproducibile, è open?), mllm, MNN-LLM, ExecuTorch, llama.cpp Vulkan
su Adreno (alternativa a OpenCL: stato e confronto). C'è qualcuno che ha già fatto
"esperti da flash su CPU + dense su GPU"? Se sì, che speedup ha visto?

### K7 — Fattibilità nel NOSTRO fork
Dal codice del fork (locale, `BigMoeOnEdge/`): il percorso streaming tocca solo i
tensori expert o assume tutto su CPU? Il punto di innesto per un backend GPU sul path
dense è circoscritto o lo streaming è intrecciato ovunque? (Lettura di architettura,
non implementazione.)

## Sintesi finale richiesta

1. **Tabella killer**: K1-K7 con verdetto VERDE / GIALLO / ROSSO + fonte.
2. **Stima onesta del potenziale**: dato ciò che si è trovato, il +30-50% del PLAN è
   sostenibile o va rivisto? (Con quale aritmetica.)
3. **Disegno dello spike raccomandato**: la sequenza più corta di test su device che
   fa fallire presto i ROSSI/GIALLI (es.: build backend OpenCL vanilla → GEMM bench
   sulle shape vere → prova -ot/n-cpu-moe su un MoE piccolo → solo alla fine il fork).
   Con soglie numeriche proposte per il GO/NO-GO dello spike.
4. Se il quadro è ROSSO in partenza: dirlo chiaro e proporre l'alternativa migliore
   (kernel IQ2? Vulkan? niente?) — non addolcire.

## Deliverable

`reports/research-adreno-opencl.md` con tutto sopra. Nessun altro file toccato.
**STOP al report — la decisione GO/NO-GO sullo spike è di gualt.**
