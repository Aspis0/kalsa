# AUDIT — Cell #42 (qdc-8elite-vl3b), hostile pass

**Verdetto: FIX** — nessuna evidenza di fabbricazione; l'aritmetica del REPORT si riproduce al centesimo dai raw; ma il REPORT contiene **una affermazione falsa sull'evidenza GPU per l'arm M**, **una colonna di hash non riproducibile**, e stringe di lacune d'archivio. Correzioni obbligatorie in fondo. Nessuna declassa della cella.

Letto integralmente: PREREG.md, REPORT.md, tutti i 9 vl_*.out + 9 .exit, 18 therm_*, model_push_793229.log, model_sha_local.txt, model_sha_device_793229.txt, provenance_793229.txt, opencl_banner_probe_793229.txt, test_image.jpg (hash), vl_smoke.log, vl_smoke4.log.

---

## 1. ARITMETICA

**F1 — CONFIRMED (positivo): tabella 9×6 riprodotta esattamente dai raw.**
Da ogni vl_*.out: encode da "mtmd batch encoding done in <N> ms"; eval_message/decode da KALSA_VL_TIMING. Tutti i 36 numeri della tabella REPORT coincidono (es. vl_C_1.out "encoding done in 3856 ms", "eval_message_ms=9449.4 decode_ms=4260.4"; vl_M_3.out "4007"/"5442.7"/"5644.9"). Prefill derivati e t/s ricalcolati: C1 5593.4/30.04, A3 1447.3/22.69, ecc. — tutto ok.

**F2 — CONFIRMED (positivo): mediane, margini, rapporti, somme, composizione — tutti riproducenti.**
- Mediane: C enc 3915 / prefill 5752.8 / 29.0678 t/s; A 6549 / 1445.6 / 22.6416; M 3927 / 1436.2 / 22.6753. = REPORT.
- Margini tie: encode (3927−3915)/3915 = **0.3065%** (=0.31%); prefill (1445.6−1436.2)/1436.2 = **0.6545%** (=0.65%); decode (29.0678−22.6753)/22.6753 = **28.20%** (=28%).
- Rapporti: 6549/3915 = **1.6728** (1.67×); 5752.8/1436.2 = **4.0056** (4.0×); 29.0678/22.6753 = **1.2820** (1.28×).
- Somme: C = 3915+5752.8+4403.5 = **14071.3**; A = 6549+1445.6+5653.3 = **13647.9**; M = 3927+1436.2+5644.9 = **11008.1**. = 14071/13648/11008.
- Composizione 3915+1436.2+4403.5 = **9754.7** (=9755); rapporti 11008.1/9754.7 = **1.1285**, 13647.9/9754.7 = **1.3991**, 14071.3/9754.7 = **1.4425** (=1.13×/1.40×/1.44×).

**F3 — CONFIRMED (positivo): upload rate, NESSUN errore MB-vs-MiB (lezione #41 non ripetuta).**
model_push_793229.log: "18.7 MB/s (1674454240 bytes in 85.619s)" e "18.7 MB/s (583109120 bytes in 29.679s)". Ricalcolo binario: 1674454240/85.619/1048576 = **18.65 MiB/s**; 583109120/29.679/1048576 = **18.74 MiB/s**. Il REPORT ("both 18.7 MiB/s") è corretto: adb stampa "MB/s" ma divide in binario. Totale 2.2576 GB ≈ "~2.26 GB" del prereg. Nessun difetto.

**F4 — CONFIRMED (positivo): la semantica di eval_message_ms regge da sola.** Sospetto che eval_message includa il decode (collasserebbe il 4.0× prefill)? REFUTATO per costruzione: vl_M_3.out eval_message=5442.7 < encode 4007 + decode 5644.9 = 9651.9 — impossibile se il decode fosse incluso. La derivazione prefill=eval_message−encode è internamente coerente in tutte le 9 righe.

**F5 — CONFIRMED (difetto, minerale): "M's encode matches C" è un filo ottimista.** M3 encode = 4007 (vl_M_3.out) è 1.2% sopra il max di C (3960, vl_C_3.out). Coerenza qualitativa vera ("matches" in senso lato), non identità. Cosmetico.

## 2. CONFORMITÀ AL PREREG+AMENDMENT-1

**F6 — CONFIRMED (positivo): ordine C A M / M A C / A M C provato dai mtime.** Epoch dei .out: C1 1788145293 < A1 …5356 < M1 …5459 < M2 …5522 < A2 …5573 < C2 …5610 < A3 …5675 < M3 …5723 < C3 …5760. Esattamente l'ordine prereg; il REPORT inoltre lista le righe in ordine di esecuzione, non raggruppate per arm — onesto.

**F7 — CONFIRMED (positivo): gate termico vivo, 18/18.** 9 pre + 9 post, ogni pre antecede il run corrispondente per mtime, max_hal_temp line presente in tutti i 18 (14×43.0, 1×43.8, 2×44.9, 1×46.5); tutti mStatus=0 e "Thermal Status: 0" (576 righe mStatus=0 totali). Max 46.5°C in therm_post_C3.txt riga 18 ("mValue=46.5, mName=CPU5, mStatus=0"). Gate (≤60.0, status ≤1) mai violato, nessun cooldown. = REPORT ("18/18 GATE_PASS, max 46.5, status 0").

**F8 — CONFIRMED (difetto): i flag fissi NON sono confermabili dai log.** Nessun vl_*.out contiene un echo degli argomenti. Unica conferma in-log: n_predict_requested=128 in tutte le 9 righe KALSA_VL_TIMING (→ `-n 128`). `-t 8`, `--temp 0`, `--seed 42`, `--ignore-eos`, `-ngl 0/99`, `--no-mmproj-offload`: nessuna traccia nei raw (il logger filtrato nasconde tutto). Il determinismo intra-arm (F13) è coerente con temp 0 ma non lo dimostra. Per prereg il REPORT avrebbe dovuto archiviare le righe di comando (o un echo argv). Diligenza insufficiente, non prova di violazione.

**F9 — CONFIRMED (positivo): exit preservati, 9/9 "0"** (tutti i .exit contengono "0"); verdetti derivati esattamente dalla regola pre-scritta (mediana di 3; winner solo se ≥5% sul runner-up; encode 0.31%→tie C/M; prefill 0.65%→tie M/A, GPU vs C 4.0×; decode 28%→winner C 1.28×). Nessun verdetto post-hoc.

## 3. DEVIAZIONE SULL'EVIDENZA GPU

**F10 — CONFIRMED (difetto, il più serio): il REPORT attribuisce a M righe warmup che M non ha.** REPORT: "A/M warmup lines naming `backend=OpenCL` and the OpenCL flash-attention warning". Fatto: `grep -c warmup` → vl_A_1.out: **45**, vl_M_1.out: **0** (idem M2/M3). I warmup OpenCL esistono SOLO in A (coerente: M mette il clip su CPU, quindi nessun warning OpenCL atteso — ma allora il REPORT non può citarli come evidenza per M). Come scritto, l'evidenza sostitutiva #1 è falsa per metà.

**F11 — CONFIRMED (positivo): per A l'evidenza in-log è reale e forte.** vl_A_1.out contiene verbatim: "WARNING: flash attention not supported by OpenCL, memory usage will increase" e "list of unsupported ops (backend=OpenCL):" (45 righe warmup; A2/A3 identiche). Queste stringhe sono emesse dal backend OpenCL vivo durante la run misurata — prova diretta nel binario misurato, superiore al banner richiesto dal prereg.

**F12 — CONFIRMED (positivo con riserva): il probe contiene il banner.** opencl_banner_probe_793229.txt: "ggml_opencl: selected platform: 'QUALCOMM Snapdragon(TM)'" + "device: 'QUALCOMM Adreno(TM) 830 (OpenCL 3.0…)'". Riserva ostile: il probe è llama-bench del kit #41, **binario diverso** dal mtmd-cli misurato; prova lo stack OpenCL dell'unità, non l'init del binario mtmd. Da solo non basta; combinato con F11 (stesso kit, stessa unità) e F13-fattuale, la catena regge.

**F13 — Giudizio sulla sostituzione: REGGE, senza declassa, ma va riscritta onestamente.** Per A: prova in-run diretta (F11) — la clausola prereg ("run without it is NOT a GPU run") è soddisfatta in sostanza oltre che in lettera. Per M: nessuna evidenza in-log; resta l'inferenza comportamentale (prefill/decode di M = 1436.2/22.68 vs A 1445.6/22.64, entrambe 4×/−28% lontane da C; il fallback silenzioso stile #40 riprodurrebbe C) + il probe (F12). Accettabile, ma il REPORT deve dire "A: prova diretta; M: prova indiretta comportamentale + probe" invece del falso "A/M".

## 4. TRASCRIZIONI E PROVENANCE

**F14 — CONFIRMED (difetto): la colonna "text sha (12)" NON si riproduce dai raw.** REPORT: C = `7ef972e97333`, A/M = `97022c5b3bc9`. Mio ricalcolo sha256 del testo generato (estratto tra la riga "encoding done" e KALSA_VL_TIMING): C = **bc12bdaeafa8…**, A/M = **717c884feb82…** (tutte e 9 le run). Ho provato 11 convenzioni di estrazione (testo nudo, ±newline, strip, +timing, intera coda del file): nessuna riproduce i valori pubblicati. Nessun file di hash in raw/ (prereg metrica 5 esige "sha256 of the generated text per run" — non archiviato). **I valori stampati nel REPORT non sono verificabili e appaiono errati.** Nota: la *conclusione* del probe di determinismo regge al 100% — identità intra-arm perfetta (bc12… ×3; 717c… ×6), A==M (stesso text tower GPU), C≠A/M — ma le cifre citate sono inventate o derivate da un artefatto non archiviato.

**F15 — CONFIRMED (positivo): hash modelli e immagine.** model_sha_local.txt == model_sha_device_793229.txt == prereg per entrambi (text 83c18dfb…f2f5f2; mmproj 8ba27050…6bbd43); shasum locale di test_image.jpg = 55e455a2dd398de36564527368eb4a7f8e3f27d6b50d0d00e42c83baa6cf4c04 = prereg.

**F16 — CONFIRMED (positivo): serial dentro provenance.** provenance_793229.txt riga 3: "eb49fb9d" (lezione #41 applicata); props "qti/sun/sun:16/BQ2A.260305.002-…", "SM8750", "16" = SM8750/Android 16 come dichiarato.

## 5. OMISSIONI / OVERCLAIM

**F17 — CONFIRMED (positivo): citazioni fedeli.** "WARNING: the CLIP graph uses unsupported operators by the backend", "list of unsupported ops (backend=OpenCL):", SOFT_MAX "f32, ne = [1024 1024 16 1]", "flash attention not supported by OpenCL" — tutte verbatim in vl_A_1/2/3.out. Nessuna distorsione; l'elenco REPORT (UPSCALE, SOFT_MAX, CONT, PERMUTE, RESHAPE, MUL_MAT f32) è sottinsieme onesto (omette MUL/ADD/NORM, presenti, ma senza vantaggio retorico).

**F18 — CONFIRMED (positivo): onestà delle parti deboli.** La composizione 9755 è etichettata "hypothetical" (= prereg, REPORT-only); i "tie" C/M e M/A sono dichiarati tali coi margini 0.31%/0.65% (<5%) — nessun vincitore mascherato; "GPU encode LOSES" è detto chiaramente; i limiti ("cannot say") sono riportati alla lettera dal prereg.

**F19 — PLAUSIBLE (difetto minore di etichettatura): A-degraded non applicato.** Il prereg: "if mmproj offload silently falls back to CPU, A is re-labeled 'A-degraded'". I log di A mostrano fallback op-level massiccio (16+ ops su CPU, ping-pong). Non è il fallback *silenzioso totale* contemplato (A non riproduce C), e il REPORT descrive la sostanza con onestà, ma la regola di rilabeling prevista non è stata né applicata né esplicitamente disapplicata con motivazione. Da chiarire.

**F20 — CONFIRMED (lacune d'archivio):** assenti da raw/: (a) il diff della patch da 10 righe (l'intera semantica di eval_message_ms riposa su codice non archiviato); (b) l'output "SHA256SUMS 3/3 OK on device" del kit; (c) il push del kit (model_push log copre solo i 2 GGUF); (d) gli exit code dei due smoke Mac (l'amendment dichiara "exit 0"); (e) i file di hash del determinismo (v. F14).

**F21 — CONFIRMED (positivo): smoke coerenti con l'amendment.** vl_smoke4.log contiene verbatim "KALSA_VL_TIMING eval_message_ms=4610.1 decode_ms=1395.7 n_predict_requested=32" come citato; descrizione 4/4 elementi (gradient, blue square, red circle, dashed line/bars) in entrambi gli smoke.

**F22 — REFUTED (sospetto scartato): tempering dell'ordine o delle tabelle.** Nessuna contraddizione trovata tra raw e REPORT su numeri, ordine, termici, exit, hash modelli. I difetti sono di *trascrizione/attribuzione* (F10, F14) e *diligenza archivistica* (F8, F20), non di sostanza.

---

## CORREZIONI OBBLIGATORIE (per l'APPLY in registry)

1. **Riscrivere l'evidenza GPU #1 del REPORT** (F10): le righe warmup backend=OpenCL esistono solo in vl_A_*.out; per M dichiarare l'evidenza come comportamentale (prefill/decode ≈ A, 4× vs C) + probe unit-level. Vietato attribuire a M righe che non ha.
2. **Correggere o riprovare la colonna text sha** (F14): pubblicare la regola di estrazione esatta e i valori corretti (ricalcolo auditor: C bc12bdaeafa8…, A/M 717c884feb82…), oppure rigenerare gli hash con artefatto archiviato in raw/.
3. **Archiviare gli artefatti mancanti** (F8, F20): righe di comando/argv delle 9 invocazioni, diff della patch mtmd-cli, output SHA256SUMS del kit, log push kit, exit degli smoke.
4. **Chiarire il punto A-degraded** (F19): una riga in REPORT che motivi perché il fallback op-level del clip non ricade nella clausola di rilabeling del prereg.

Nessuna delle correzioni tocca i numeri di misura, le mediane, i margini, la decision table o il verdetto della cella — che sono, contro ogni aspettativa ostile, tutti riproducibili al centesimo.
