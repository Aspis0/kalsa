# MANDATO — PREP da PC (zero telefoni): MarcoKEXP-prep + LiteRT fail-fast-prep

Due preparazioni in parallelo, SOLO PC. Nessun telefono si tocca (S23 in
fix-session, Xiaomi stasera). Niente quantize, niente decisioni: solo mettere
in rampa. Se T2c boccia Marco, la parte A si butta (costo: banda).

## A — MarcoKEXP prep (il file che sblocca qualità+CPU+GPU, SE T2c passa)

1. **Sorgente**: individuare su HF il miglior sorgente alta-precisione di
   Marco-Mini-Instruct (Q8_0 GGUF di mradermacher static, o BF16 upstream
   ATH-MaaS/AIDC — preferire Q8_0 GGUF se esiste: pipeline identica a KEXP).
   Size+sha attesi a verbale, POI download (in `models/`, spazio verificato).
2. **imatrix**: mradermacher i1 espone la sua imatrix? Se sì scaricarla; se
   no, annotare che andrà ricalcolata (llama-imatrix su corpus multi5-disgiunto
   — come da lezione REAP: mai calibrare sul gate).
3. **Recipe**: generare `results/marcokexp/tensor_types.txt` dal dump Marco già
   in casa (`results/gpu_xiaomi/logs/marco_gguf_dump.txt` + gguf_types_only):
   dense/attention → q4_k o q5_k (COMPATIBILI OpenCL — è metà dello scopo),
   esperti gate/up → q2_k... ATTENZIONE: esperti Marco h=1024/int=768 e PPL
   diverse: la scelta bpw esperti va dichiarata con 2 opzioni (conservativa
   q3_k, aggressiva q2_k) e si deciderà col metro. `^output\.weight$` ancorato
   (lezione 1c).
4. **STOP prima della quantize.** Deliverable: sorgente scaricato+sha, recipe
   pronta, comando quantize scritto ma NON eseguito.

## B — LiteRT fail-fast prep (porta-740, F0 senza toccare il S23)

1. Individuare l'artefatto ESATTO da mettere sul S23: app demo LiteRT-LM /
   MediaPipe LLM Inference ufficiale (APK o sample buildabile) che giri su
   OpenCL Adreno, + il modello size-matched al confronto (Llama-3.2-3B o
   Gemma-2B nel formato .task/.litertlm richiesto). URL, size, sha, licenza.
2. Scaricare tutto su PC, pronto per sideload.
3. Scrivere il protocollo F1 eseguibile (1 pagina): come misurare il DECODE
   sustained ≥60 s nell'app (che metrica espone?), il gemello llama-bench CPU
   stesso device (comando esatto, -t 4, modello size-matched, sha), staccato,
   2 rep, gate ≥1.15×. Se l'app non espone tok/s misurabile → dirlo e proporre
   l'alternativa (LiteRT-LM CLI da shell? bench mode?).
4. STOP: l'esecuzione F0-F1 è un mandato successivo (S23 libero + gualt).

## Deliverable

`reports/moe-prep-marcokexp-litert.md`: A (sorgente+sha, recipe, comando
pronto), B (artefatti+sha, protocollo F1). Commit, NO push di file >100MB
(i modelli restano fuori git come sempre). **STOP.**
