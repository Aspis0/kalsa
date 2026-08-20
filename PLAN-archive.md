# PLAN-archive — storico del piano V1 + registro checkpoint ≤ 2026-08-11

Spostato da `PLAN.md` il 2026-08-14 per sfoltimento (nessun contenuto perso;
la vista viva resta in `PLAN.md`). Ordine originale preservato.

## Aggiornamenti ri-verifica — 2026-08-03

Ri-verifica online F0.1 (GitHub API + HF tree API + `common/arg.cpp` master). Report: `reports/moe-f0.1.md`.

- **Voce 5 download list (§4) — quant minima MTP 35B: stima ~2–3GB [S] → realtà 11.37GB.**
  - `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` non espone un draft MTP piccolo: i `.gguf` modello sono full+MTP; il più piccolo è `Qwen3.6-35B-A3B-UD-IQ1_M.gguf` = **11 366 414 624 byte** (~11.37GB decimali). Source: `https://huggingface.co/api/models/unsloth/Qwen3.6-35B-A3B-MTP-GGUF/tree/main`.
  - `ggml-org/Qwen3.6-35B-A3B-MTP-GGUF` ha solo `Qwen3.6-35B-A3B-MTP-Q8_0.gguf` = **37 801 096 544 byte** (+ BF16 e mmproj). Source: `https://huggingface.co/api/models/ggml-org/Qwen3.6-35B-A3B-MTP-GGUF/tree/main`.
  - **Implicazione:** il budget disco core 1+2+3+5 non è ~22.6GB ma ~**~30.7GB** (2.74+5.04+11.52+11.37) se si tiene un GGUF MTP full accanto al target; oppure F6 deve riusare/sostituire il file target con la variante MTP (stesso footprint ~11–22GB). Rivedere §4 spazio e sequenza download prima di F1/F6.
- **BigMoeOnEdge stelle: ~196 → 197** (cosmetico). Ultimo commit `b0c4e5b` 2026-08-02. Source: `https://api.github.com/repos/Helldez/BigMoeOnEdge`.
- **Parametro `k` dei bench BigMoeOnEdge chiarito:** è `--n-expert-used` (README: active experts / turbo top-k; best lossy 5.8 tok/s a k=6, best lossless ancora **5.0** a k=8 / cache 3000 MiB). Non cambia la strategia F4; chiude il TODO semantico di §3.2 p.9.
- **Flag mainline `--load-mode`:** modi attuali = `none | mmap | mlock | mmap+mlock | dio` (default `mmap`). Non esiste un modo `on-demand` / `map` con quel nome. Source: `https://raw.githubusercontent.com/ggml-org/llama.cpp/master/common/arg.cpp` (b10244 era il latest release al momento del check).
- **Invariati (confermati):** PR #26003 OPEN non mergiata; PR #24156 OPEN; PR #22673 MERGED 2026-05-16; GGUF size §3/§4 (GB decimali) match byte-esatti HF; llama.rn **0.12.8** (GitHub + npm); famiglia `--spec-draft-*` + `--spec-type` + `-ctk/-ctv` + `--no-warmup` presenti; fork flag `--moe-stream/--cache-mb/--dense-weights/--drop-cold-experts` presenti nel README.

### Aggiornamenti gguf-dump — 2026-08-03

F0.6 completata: download + analisi `GGUFReader` su `models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf`. Report: `reports/moe-f0.6.md`, dump grezzo: `results/gguf_ud-iq2m_dump.txt`.

- **Size file [V]:** **11 522 702 304** byte — match byte-esatto HF (nessun re-download necessario se già presente).
- **Metadata [V]:** `general.architecture=qwen35moe`; `block_count=40`; `expert_count=256`; `expert_used_count=8` (solo routed; shared a parte); `embedding_length=2048`; `expert_feed_forward_length=512`; `expert_shared_feed_forward_length=512`; `full_attention_interval=4`; `attention.head_count_kv=2`; `attention.key/value_length=256`.
- **Per-esperto per-layer [V] (routed, somma gate+up+down):**
  - **37/40 layer:** **942 080 B = 0.942 MB** (gate IQ2_XXS 270 336 + up IQ2_XXS 270 336 + down IQ3_XXS 401 408).
  - **3/40 layer (34, 38, 39):** **1 097 728 B = 1.098 MB** (down alzato a IQ4_XS 557 056).
  - Mediana = 942 080 B; media = 953 754 B.
- **Traffico naive / token [V]:** 8 routed × 40 layer × 942 080 = **301 465 600 B ≈ 301.5 MB/token (mediana)**; pesato reale (37 L × 942 080 + 3 L × 1 097 728) × 8 = **305 201 152 B ≈ 305.2 MB/token** (0% hit; shared residente escluso).
- **Sanity params [V]:** 3·2048·512 = **3 145 728** params/esperto/layer; 256×40×3.15M = **32.21B** esperti + resto ≈ 35.9B; bpw esperti effettivo ≈ **2.40**.
- **Layout [V]:** non fused (gate/up/down separati); i 3 `*_exps` di un layer **non** sono contigui tra loro (in mezzo: shexp + router `ffn_gate_inp`); ordinati per layer 0→39; 1 esperto = slice contigua dentro ogni tensore (dim 256 outermost). Overhead metadata: **10 990 048 B (0.095%)**.
- **§4 budget core aggiornato [V]:** voci 1+2+3+5 = 2.74+5.04+11.52+11.37 = **≈30.67 GB** (non 22.6). Alternativa F6: swap del file target con variante MTP (stesso footprint ~11–12 GB), senza tenere base+MTP insieme.
- **§5 stime [S] sostituite:** ~1.0–1.3 MB/esperto → **0.942 MB** (mediana, 0.954 media); ~350 MB/token → **305.2 MB/token (pesato reale)**. Vedi §5 riscritto sotto.

---

## 0. TL;DR — le decisioni già prese (⚠ STORICO 2026-08-03, superato dallo STATO CORRENTE in cima)

Il piano precedente (quello ricevuto da un altro assistente, basato solo sul titolo del documento)
era ragionevole nell'impianto ma sbagliato o superato in punti chiave. Correzioni verificate:

1. **Modello target: Qwen3.6-35B-A3B, non Qwen3-30B-A3B.** [V] Esiste (rilascio 2026-04-15,
   Apache-2.0), è la stessa classe architetturale del Qwen3.5 che Kalsa già usa
   (`model_type: qwen3_5_moe`), ha **MTP nativo nel config** (`mtp_num_hidden_layers: 1`),
   256 esperti routed + 1 shared (9 attivi/token, ~3B), 40 layer ibridi Gated DeltaNet 3:1,
   contesto 262K. llama.cpp lo supporta da febbraio 2026 (PR #19435) e l'MTP da maggio 2026
   (PR #22673, testato proprio su questo modello).
2. **Nessuna quantizzazione del 35B sta in 8GB di RAM.** [V] Il GGUF più piccolo (unsloth
   UD-IQ1_M) è 10.05GB. Quindi lo streaming da flash **non è un'opzione: è obbligatorio**.
   Questo è esattamente il punto della ricerca — se il progetto funziona, funziona davvero
   "beyond memory capacity".
3. **mmap "nudo" di llama.cpp mainline NON è lazy.** [V] Il loader di default fa
   `MAP_POPULATE` + `posix_madvise(WILLNEED)` sull'INTERO file: con un modello > RAM il
   risultato è thrashing catastrofico, non paging intelligente. Dato reale: gpt-oss-120b via
   mmap nudo su un telefono 12GB = **0.09 tok/s**. L'esperimento "cold vs warm page cache" del
   vecchio piano va quindi reinterpretato: serve a MISURARE il muro, non a scavalcarlo.
4. **Esiste già una base di codice per lo streaming: BigMoeOnEdge.** [V] Fork llama.cpp
   (github.com/Helldez/BigMoeOnEdge, creato 2026-07-10, ~196 stelle, attivo) con flag custom
   `--moe-stream`, `--cache-mb`, `--dense-weights`, `--drop-cold-experts`. Numeri riportati su
   telefono 12GB/UFS 4.x: **Qwen3.6-35B-A3B ≈ 5.0 tok/s**, Qwen3-30B-A3B 5.2, Gemma-4-26B-A4B
   5.0, gpt-oss-120b 2.2. Non partiamo da zero: partiamo da audit + build + bench di questo fork.
5. **`--mlock` è inutilizzabile senza root** (RLIMIT_MEMLOCK), i **thermal zone sono bloccati
   da SELinux** per le app Termux, e **perfetto/simpleperf non sono realistici senza root**. [V]
   La telemetria si fa con `/proc/PID/stat` (majflt), `/proc/PID/io`, `/proc/meminfo`,
   `termux-battery-status` (temperatura batteria come proxy termico).
6. **La GPU non è una via per i MoE su questo telefono.** [V] Vulkan è rotto su Adreno 740
   (issue #6713), OpenCL è verificato solo su 8 Gen 3/Elite e comunque il backend OpenCL non
   gestisce i tensori MoE (restano su CPU). Baseline = CPU-only, ed è una semplificazione, non
   un limite.
7. **Il gap di ricerca è reale e documentato.** [V] Nessun sistema pubblicato combina
   MoE ~35B/256 esperti + smartphone 8GB + flash UFS + cache DRAM predittiva con eviction.
   Una survey 2026 dichiara: *"The architecture that makes MoE truly practical on mobile
   (sub-10W, sub-8GB) doesn't exist yet."* I più vicini: FlashMoE (desktop), SpecPrefetch
   (telefono ma modello minuscolo), PowerInfer-2 (niente codice Android pubblico).
8. **Il modello di controllo denso è Qwen3.5-4B** (già nel catalogo Kalsa, GGUF verificati),
   non Qwen3-4B. E aggiungiamo un controllo nuovo e importante: **LFM2-8B-A1B**, un MoE che
   STA in RAM (Q4_K_M = 5.04GB) — separa il costo "essere MoE" dal costo "streaming da flash".

**La frase chiave del progetto resta valida:** non stiamo cercando di far entrare il modello in
RAM; stiamo cercando di far arrivare gli esperti giusti al momento giusto, abbastanza
velocemente da non fermare il token successivo.

---

## 1. Contesto: cos'è Kalsa e perché questo progetto

**Kalsa** è un'app di chat AI **100% on-device** (React Native/Expo, Android-first) costruita su
`llama.rn` (binding llama.cpp): niente backend, niente account, privacy by design. Oggi in app
girano **Qwen3.5-4B** (default, ibrido DeltaNet, speculative decoding MTP/NextN attivo sui turni
testo) e **Gemma 4 E2B**, con websearch via Exa MCP (senza API key), memoria locale, traduzione,
voce. Repo: `C:/Users/gualt/Desktop/Kalsa/ai-chat`. Documenti rilevanti già nel repo:

- `docs/ROADMAP_BIGGER_MODELS.md` — la genesi di questo piano: identifica il vincolo
  banda-per-token e i candidati (Qwen3.6-35B-A3B, Gemma 4 26B-A4B, SmallThinker, DraftExpert).
- `PLAN.md` (root Kalsa) e `docs/PLAN_V2/V3/V4*` — storia del prodotto.

Il progetto ha **due binari**, con priorità diverse:

| Binario | Obiettivo | Orizzonte |
|---|---|---|
| **A — Prodotto** | qualcosa di *buono* che giri bene su telefoni 6-8GB (mercato di massa) | settimane |
| **B — Ricerca** | un MoE di classe 35B utilizzabile su un telefono 8GB, via streaming esperti + cache predittiva | mesi |

Il binario A ha già un candidato pronto emerso dalla ricerca: **LFM2-8B-A1B** (MoE 8.3B/1.5B
attivi, Q4_K_M 5.04GB, architettura `lfm2moe` supportata da llama.cpp b6709+, esplicitamente
ottimizzato on-device). È un quick win per il catalogo Kalsa via llama.rn e NON dipende dal
binario B. Questo piano è dedicato al **binario B**, ma la F2 produce anche i numeri per A.

Perché il Galaxy S23 128GB: è il banco di prova *difficile* (8GB RAM, UFS 3.1 — il taglio 128GB
usa UFS 3.1, non 4.0 [V]; OneUI aggressiva; thermal throttling). Se il sistema funziona qui, è
robusto; se funzionasse solo su un 16GB/UFS4, non avremmo risolto il problema, avremmo solo
comprato hardware migliore.

---

## 2. Ruoli e modalità operativa per Grok

### 2.1 Chi fa cosa

- **Grok (tu)**: scrivi TUTTI gli script (bash Termux, Python analisi, C++ patch), fai gli audit
  di codice, prepari i comandi esatti da incollare in Termux, analizzi i log/CSV che gualt ti
  riporta, scrivi i report di fase. Non hai accesso diretto al telefono.
- **gualt**: esegue sul telefono i blocchi di comandi che prepari (copia/incolla in Termux),
  ti incolla output e file di log, fa le azioni fisiche (riavvio, app pesanti, raffreddamento).
- **RunPod** (autorizzato, senza chiedere conferma, MA spegnere i pod a fine uso): SOLO per
  (a) build farm / cross-compile / CI, (b) training del predictor in F7-F8, (c) esperimenti di
  correttezza su emulatore. **MAI per numeri di performance**: i tok/s contano solo dal
  telefono fisico.

### 2.2 Regole operative (vincolanti)

1. **Verifica online prima di agire.** Ogni volta che tocchi un repo/flag/quant citato qui,
   ricontrolla che esista ancora e che la sintassi non sia cambiata (llama.cpp rinomina i flag
   di frequente — è già successo con `--spec-draft-*`). La checklist minima è in F0.
2. **Una variabile alla volta.** Ogni run cambia UN parametro rispetto al run precedente.
   Niente "ho cambiato quant, thread e contesto insieme".
3. **Ogni run → una riga nel CSV** (`~/experiments/results/runs.csv` SUL TELEFONO, schema in
   §8.3; la copia canonica vive su PC, flusso dati definito in F0.2) + log grezzo salvato.
   Un numero senza riga CSV non esiste.
4. **Run ripetuti**: ogni configurazione va misurata **3 volte** (mediana). Cold = dopo riavvio
   telefono + `echo 3 > /proc/sys/vm/drop_caches` NON disponibile senza root → cold reale =
   riavvio. Warm = run immediatamente successivo.
5. **Ogni fase → report** in `reports/moe-f<N>.md` (in questo repo, versionato): cosa fatto,
   numeri, deviazioni dal piano, verdetto sul gate. Chiudi con DONE o BLOCKED(motivo).
6. **Il tuo project root è QUESTO repo** (`Kalsa/moe-experiments/`, git dedicato). Qui
   committi liberamente e spesso (script, report, CSV, patch — MAI i GGUF: sono in
   .gitignore). Il repo dell'app (`Kalsa/ai-chat/`) è FUORI PERIMETRO: sola lettura per i
   documenti citati in §1, vietata qualunque modifica. Sul telefono il buffer di lavoro è
   `~/experiments/`.
7. **Codice di terzi = non fidato.** BigMoeOnEdge va auditato (F0.4) PRIMA di buildarlo ed
   eseguirlo. È un fork poco conosciuto: cerca backdoor, telemetria nascosta, curl/exec
   sospetti nel diff vs upstream.
8. **Onestà brutale nei report**: se un numero smentisce l'ipotesi, il numero vince. Il
   progresso si misura coi criteri di §10, non con l'entusiasmo.

---

### 2.3 Modalità solo-Grok (goal pi) con S23 collegato al PC

Questa modalità è quella preferita da gualt per risparmiare token: Grok esegue il piano in
autonomia come goal, con il telefono raggiungibile dal PC. Sostituisce il copia/incolla manuale
di §2.1 per tutto ciò che è remotizzabile.

**Setup controllo remoto (una tantum, lo fa gualt guidato da Grok):**

1. Opzioni sviluppatore + Debug USB attivi; `adb devices` vede l'S23.
2. In Termux: `pkg install openssh termux-api`, impostare password con `passwd`, avviare `sshd`
   (porta 8022). Utente = output di `whoami`.
3. Accesso da PC via USB: `adb forward tcp:8022 tcp:8022` → `ssh -p 8022 <utente>@localhost`.
4. **Termux:Boot** (da F-Droid) + script in `~/.termux/boot/` che lancia `sshd` +
   `termux-wake-lock` → l'accesso sopravvive ai riavvii (indispensabile: i run cold richiedono
   riavvio, che Grok fa con `adb reboot`). Nota: dopo il reboot Termux:Boot parte solo se il
   telefono è stato sbloccato almeno una volta → sul device di test (S23 VERGINE dedicato,
   nessun dato personale) NON impostare alcun blocco schermo: così `adb reboot` + ripartenza
   di sshd sono completamente autonomi, senza intervento umano.

   **[2026-08-05 — incidente e fix definitivo]** Dopo un riavvio sshd NON è ripartito. Causa
   reale: `com.termux.boot` risultava `stopped=true notLaunched=true` — installata ma **mai
   aperta**, e Android non consegna `BOOT_COMPLETED` a un pacchetto in stato *stopped*
   (`FLAG_EXCLUDE_STOPPED_PACKAGES`). Non era un problema di permessi: `RECEIVE_BOOT_COMPLETED`
   era già `granted=true`. Fix applicato e verificato con un riavvio reale:
   - `adb shell monkey -p com.termux.boot 1` (una sola volta nella vita del device) → l'app
     esce da *stopped*; da lì in poi Termux:Boot riceve `BOOT_COMPLETED` a ogni riavvio;
   - `adb shell cmd deviceidle whitelist +com.termux +com.termux.boot` (esenzione doze).

   **Regole per lo script di boot** (imparate dal `boot.log` del riavvio di verifica):
   - `sshd` va lanciato **per primo e incondizionatamente**. Tutto il resto è best-effort e
     va dopo, con `timeout`: se lo script si blocca prima di sshd il telefono resta
     irraggiungibile finché qualcuno non lo tocca a mano.
   - **Mai** sondare la rete con `ip addr show wlan0`: è negato agli uid app untrusted, non
     dà errore, semplicemente non ritorna nulla — nella v1 dello script ha bruciato 90 s di
     attesa **ritardando sshd di 90 s**. Per l'IP si usa `termux-wifi-connectioninfo`.
   - `/proc/uptime` è negato da SELinux su questo device (`/proc/meminfo` invece è leggibile).
   - Marker `~/.boot_ready` (timestamp) scritto subito dopo sshd + log in `~/boot.log`.

   **Limite accertato (testato, non aggirabile senza root):** il riavvio **non** può essere
   innescato da Termux — `svc power reboot` → *"Neither user 10344 nor current process has
   android.permission.REBOOT"*; `/system/bin/reboot` → *Permission denied*; `am start -a
   android.intent.action.REBOOT` → *SecurityException*. E `setprop persist.adb.tcp.port`
   (che renderebbe adb-over-TCP persistente) è bloccato da SELinux anche da uid shell. Il
   toggle "Debug wireless" di Android si spegne **by design** a ogni riavvio.

5b. **App helper per il Debug wireless** — `tools/adb-boot-helper/` (sorgente + `build.ps1`,
   niente Gradle: due classi e un manifest, si compila con javac/d8/aapt2/apksigner dell'SDK).
   Il toggle "Debug wireless" non è riaccendibile da shell (`settings` vuole
   INTERACT_ACROSS_USERS, `content` vuole ACCESS_CONTENT_PROVIDERS_EXTERNALLY), ma **un'app
   installata che detiene `WRITE_SECURE_SETTINGS` sì**, tramite la normale API Settings — e
   quel permesso, concesso una volta con `pm grant`, sopravvive ai riavvii. L'app scrive
   `adb_wifi_enabled=1` a `BOOT_COMPLETED`.
   Installazione (una volta sola, richiede adb attivo in quel momento):
   ```
   adb install -r tools/adb-boot-helper/moe-adb-boot.apk
   adb shell pm grant com.moe.adbboot android.permission.WRITE_SECURE_SETTINGS
   adb shell monkey -p com.moe.adbboot 1          # esce da "stopped", v. sopra
   adb shell cmd deviceidle whitelist +com.moe.adbboot
   ```
   Scelte di design imposte dall'audit ostile (2026-08-05) — non regredire:
   - il receiver è `exported="false"` e **non** espone azioni custom: con un receiver
     esportato qualsiasi app installata, senza alcun permesso, poteva riaccendere il debug
     wireless in silenzio. I broadcast di sistema arrivano lo stesso a un receiver non
     esportato, e `BOOT_COMPLETED` è protetto (nessuna app può falsificarlo);
   - i retry girano in un **JobScheduler job**, non in un `Thread` lanciato da `onReceive`:
     appena `onReceive` ritorna il processo non ha più componenti attivi e diventa un empty
     process, primo candidato di LMKD durante il boot storm — verrebbe ucciso con SIGKILL,
     senza eccezione né log. Serve perché al `BOOT_COMPLETED` il Wi-Fi spesso non è ancora
     associato e adbd rifiuta di aprire il listener TLS;
   - l'uscita richiede **3 successi consecutivi**, non uno: adbd può ripulire il flag se
     parte dopo la prima scrittura.
   Diagnostica: `adb logcat -s MoeAdbBoot`.

   Conseguenza operativa che resta valida comunque: **ssh è il canale di controllo, adb è un
   comfort.** Ogni script deve funzionare via ssh; se l'helper fallisce su un firmware
   futuro, il lavoro non si ferma.
5. **REGOLA CRITICA — carica**: USB collegato = telefono in carica = misure invalide (§8.2).
   Quindi: setup, build e push di file grossi via USB; **i run di misura SEMPRE con cavo
   staccato**, controllo via Wi-Fi (wireless debugging / `adb tcpip 5555` + ssh sull'IP Wi-Fi).
   Prima di ogni blocco di misura Grok verifica `termux-battery-status` → `"plugged":
   "UNPLUGGED"`; se risulta in carica, il run non parte e non entra nel CSV.

**Cosa Grok può fare da solo con questo setup:** tutto F0-F6 — riavvii (`adb reboot`), run e
telemetria via ssh, pressure test (apertura camera/browser via `adb shell am start` / `monkey`),
download modelli, sweep completi, CSV e report.

**Cosa resta comunque a gualt (azioni fisiche):** staccare/attaccare il cavo, assicurare
condizioni termiche sensate (telefono su superficie fresca, non in tasca), intervenire se il
telefono si pianta. (Con lock schermo assente, lo sblocco post-riavvio non serve.)

**Regole di autonomia aggiuntive (si sommano a §2.2):**

9. **Checkpoint obbligatori con STOP**: fine F0.4 (audit fork), gate F4, e prima di iniziare
   F7. Lì Grok scrive il report, si ferma e aspetta l'ok di gualt. Mai proseguire oltre un
   gate senza report scritto.
10. Mai inventare o estrapolare numeri mancanti: run fallito = riga CSV con FAIL nelle note,
    non una stima.
11. Comando adb/ssh che fallisce 3 volte di fila → BLOCKED nel report, non retry infinito.
12. Perimetro file sul telefono: solo home Termux (`~/`, `~/models`, `~/experiments`). Vietati:
    factory reset, modifiche a impostazioni di sistema oltre a quelle elencate in F1, flash,
    qualunque cosa fuori perimetro.
13. F7-F8 (patch C++ su ggml/fork + design predictor) NON vanno tentate in solo-mode senza
    checkpoint: è il territorio a più alto rischio di lavoro sbagliato che sembra giusto.

## 3. Stato dell'arte verificato (2026-08-03)

### 3.1 Il modello target e le alternative

**Qwen/Qwen3.6-35B-A3B** [V]:

| Proprietà | Valore |
|---|---|
| Parametri totali | 35.95B (safetensors: 35,951,822,704) |
| Architettura | `Qwen3_5MoeForConditionalGeneration`, `model_type: qwen3_5_moe` (stessa classe di Qwen3.5) |
| Layer | 40, pattern 10×(3 Gated DeltaNet → 1 Gated Attention) |
| Attention piena | solo 10 layer su 40; 16Q/2KV head, head_dim 256 |
| Esperti | 256 routed, `num_experts_per_tok=8`, +1 shared → 9 attivi/token ≈ 3B parametri |
| `moe_intermediate_size` | 512 (esperti PICCOLI e numerosi — ottimo per caching a grana fine) |
| Contesto | 262,144 nativo |
| MTP | nativo, `mtp_num_hidden_layers: 1` |
| Licenza / rilascio | Apache-2.0 / 2026-04-15 |
| Varianti | checkpoint unico con `enable_thinking` nel template (niente -Instruct/-Thinking separati) |
| Multimodale | sì (vision encoder incluso; su llama.cpp il supporto iniziale era "no vision") |

**GGUF** [V] — repo `unsloth/Qwen3.6-35B-A3B-GGUF` (naming Unsloth Dynamic "UD-", mixed-bit;
niente IQ3_XS/Q2_K "puri"); MTP: `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` e `ggml-org/Qwen3.6-35B-A3B-MTP-GGUF`:

| Quant | GB | Note per S23 8GB |
|---|---:|---|
| UD-IQ1_M | 10.05 | solo stress test, qualità attesa bassa |
| UD-IQ2_XXS | 10.76 | — |
| **UD-IQ2_M** | **11.52** | **quant primaria del progetto** |
| **UD-Q2_K_XL** | **12.29** | alternativa K-quant (K > IQ sugli expert tensors, v. sotto) |
| UD-IQ3_XXS | 13.21 | upgrade qualità se lo streaming regge |
| UD-Q3_K_S / M | 15.36 / 16.60 | probabilmente troppo per UFS 3.1, misurare solo se F4 va molto bene |
| UD-Q4_K_M | 22.13 | è la taglia usata da BigMoeOnEdge sul telefono 12GB — fuori portata S23 [S] |

Nota qualità quant [V]: nella discussione ik_llama.cpp #359 i K-quant risultano migliori degli
IQ **sui tensori degli esperti MoE** a parità di bit; le UD di Unsloth sono mixed-bit calibrate.
Quindi il confronto UD-IQ2_M vs UD-Q2_K_XL (F4) non è pedanteria: è una decisione di progetto.

**Famiglia Qwen** [V]: esistono anche `Qwen3.5-35B-A3B` e `Qwen3.5-122B-A10B` (MoE) oltre alla
linea densa 0.8/2/4/9/27B. **Decisione: si usa Qwen3.6-35B-A3B** — stessa classe architetturale
del 3.5 ma più recente (aprile 2026), MTP integrato, ed è il modello su cui llama.cpp ha
testato l'MTP e su cui BigMoeOnEdge riporta i numeri. Il vecchio Qwen3-30B-A3B è escluso
(scelta di gualt, confermata: architettura precedente, niente DeltaNet → KV cache più pesante).

**Alternative nel piano** (tutte [V] salvo dove indicato):

| Modello | Tot/attivi | GGUF | Ruolo nel piano |
|---|---|---|---|
| **Qwen3.5-4B** | 4B densa (ibrida, 8 full-attn su 32) | Q4_K_M 2.74GB; MTP 2.83GB | controllo denso (già in Kalsa) |
| **LFM2-8B-A1B** (Liquid) | 8.3B/1.5B | Q4_K_M **5.04GB** | controllo "MoE che sta in RAM" + candidato prodotto |
| **Gemma-4-26B-A4B** | 26B/4B (fonti secondarie) | UD-IQ2_XXS 9.92GB, UD-IQ3_XXS 11.42GB; MTP presente | secondo MoE grande (cross-check in F4, opzionale) |
| GPT-OSS-20B | ~21B/3.6B | ~11.4-12.1GB a TUTTE le quant (esperti MXFP4) | riserva; taglia fissa, poco regolabile |
| SmallThinker-21B-A3B | 21B/3B | Q3_K 10.42GB | scartato come motore: i "20+ tok/s @8GB" sono sul framework PowerInfer, che NON ha codice Android pubblico [V] |
| Moonlight-16B-A3B / ERNIE-4.5-21B-A3B / Ring-mini-2.0 | vari | esistono | fuori piano V1 (issue note / meno rilevanti) |

### 3.2 Il runtime: cosa offre DAVVERO llama.cpp oggi

Fatti [V] che vincolano il design:

1. **mmap default = eager**: `MAP_POPULATE` + `posix_madvise(WILLNEED)` sull'intero file
   (`src/llama-mmap.cpp`); con `--numa` si passa a `MADV_RANDOM`. Nessun lazy loading
   per-esperto in mainline.
2. **PR #26003 `--lazy-experts`: APERTA, non mergiata** (creata 2026-07-22). PR #24156
   `--reclaim-mmap-source` correlata. → Da monitorare settimanalmente: se merge, diventa la
   via mainline e riduce la dipendenza dal fork.
3. **`--cpu-moe` / `--n-cpu-moe` / `-ot`** (PR #15077, #11397): assegnano tensori a buffer
   NOMINATI → su una build CPU-only pura sono di fatto inerti. Servono solo con backend GPU
   attivo. Non sono lo strumento per questo progetto.
4. **MTP/NextN mergiato** (PR #22673, maggio 2026): `--spec-type draft-mtp`, famiglia flag
   `--spec-draft-*` (`--spec-draft-n-max`, `--spec-draft-type-k/v`, `--spec-draft-cpu-moe`…).
   Testato su Qwen3.6-35B-A3B: acceptance ~75%, speedup >2x MA su GPU (DGX Spark). Zero dati
   CPU/ARM pubblicati. Un test indipendente su RTX3090 riporta **nessuno speedup netto** con
   speculative su A3B MoE (Ampere). Sul telefono l'economia è diversa (domina l'I/O esperti,
   non il compute) → l'ipotesi H4 va misurata, esito genuinamente aperto.
5. **llama.rn 0.12.8** espone `n_cpu_moe` e tutto lo speculative/MTP (text-only), ma NON
   `-ot`. L'integrazione prodotto di qualunque cosa esca da questo piano passa da lì, dopo.
6. **ik_llama.cpp** builda su Termux [V] (`-fmoe`, `-rtr`) ma con regressioni documentate su
   Qwen3 MoE (issue #1699: PP 2x più lento di mainline in un caso). Solo benchmark mirato, non base.
7. **Bug Android noti**: DirectIO/scoped storage (#18804) → **tenere i GGUF nella home
   Termux**, mai su `/storage/...`. Phantom process killer (termux-app #2366, ancora vivo su
   Android 15) → workaround adb in F1. `--mlock` non praticabile senza root.
8. **Fork sperimentali di expert-caching su llama.cpp**: issue #20757 (two-tier cache) chiusa
   senza merge; kisasexypantera94 `moe-expert-residency` (LFU su **Metal**, 97-99% hit su
   Qwen3-30B-A3B — conferma indiretta di H1/H2!); Lidenburg (3-tier disk); koren1712
   `expert-streaming-win` (meno byte ma end-to-end più lento — monito: ridurre i byte non
   basta, conta la pipeline). Nessuno è CPU-ARM.
9. **BigMoeOnEdge** (Helldez): la base pratica. Flag: `--moe-stream` (streaming esperti
   on-demand), `--cache-mb N` (budget cache esperti), `--dense-weights` (pesi densi residenti),
   `--drop-cold-experts` (+ un parametro `k` che compare nei bench, semantica da chiarire in
   F0.4). Numeri dichiarati (telefono 12GB RAM / UFS 4.x): 35B-A3B 5.0 tok/s (file UD-Q4_K_M ~22GB!),
   30B-A3B 5.2, Gemma-4-26B 5.0, gpt-oss-120b 2.2; baseline mmap nudo 0.09. Non validato
   indipendentemente: la validazione siamo noi (F4).
10. **Termux**: esiste `pkg install llama-cpp` ufficiale (arm64, auto-update) — utile per lo
    smoke test, ma i run di misura usano **build da sorgente** (controllo versione/flag;
    dotprod/i8mm auto-rilevati, il Cortex-X3/A7xx dell'8 Gen 2 li ha entrambi; i8mm ≈ +20%).
11. **Hardware S23 128GB** [V]: UFS 3.1 confermata sul taglio 128GB; AndroBench reale:
    seq read ~1686 MB/s, seq write ~552 MB/s. **Random read 4K: nessun dato pubblico → lo
    misuriamo noi con fio (F2.1), ed è IL numero che governa tutto il progetto.**

### 3.3 La letteratura: cosa è già dimostrato (numeri da citare, non da riscoprire)

**Località degli esperti (H1 è già provata in letteratura, va solo confermata on-device):**

- Mixtral paper (arXiv:2401.04088): P(stesso esperto del token precedente) ≈ **30%** vs 12.5%
  random, più alta nei layer profondi.
- "Local Routing Consistency of MoE Models" (arXiv:2505.16056): hit-rate **LRU** per finestra:
  m=4 → **81.2%**, m=16 → **90.4%**, m=64 → **93.1%**, m=256 → **97.5%**; cache ottimale ≈
  **2× gli esperti attivi**; Qwen3 tra i modelli con routing più "locale" (SRP 54.14).
- Analisi caching Mixtral (arXiv:2511.05814): LRU precision 29.1%/recall 58.2%; speculative
  expert loading precision=recall=**84.6%**.
- Blog Doubleword su **Qwen3.5-35B-A3B** (256 esperti, 40 layer — stessa famiglia del target):
  co-attivazioni sfruttabili, −21.3% caricamenti unici (oracle).

**Sistemi di riferimento (cosa copiare, cosa evitare):**

| Sistema | Idea chiave | Numeri | Codice |
|---|---|---|---|
| PowerInfer-2 | neuron cluster, hot/cold, pipeline I/O-compute su phone | 11.68 tok/s su 47B sparso | NON Android-pubblico [V] |
| LLM in a Flash (Apple) | windowing + row-column bundling per letture flash sequenziali | 4x CPU / 20x GPU vs naive | no |
| Mixtral-offloading | LRU + speculative loading (router layer i → layer i+1) | — | sì |
| MoE-Infinity | tracing sequence-level, cache activation-aware | −4x/−20x latenza | sì |
| Pre-gated MoE | il router del layer corrente predice il layer successivo | — | no |
| AdapMoE | gating adattivo + prefetch | −25% caricamenti, 1.35x | sì |
| **HOBBIT** | **mixed-precision sui cache miss** (esperto mancante caricato a bit più bassi) | fino a 9.93x vs SOTA offload; +8k righe su llama.cpp | no (peccato) |
| ProMoE | prefetch proattivo con predictor | 2.20x prefill / 2.07x decode | sì |
| ExpertFlow | predictor transformer del routing path | hit 91.96% (+61% vs LRU), acc 95% | no |
| **Fate / Cross-Layer Gate** | input del gate dei layer adiacenti | prefetch acc **97.15%** (soglia 75° pct), 4.5x/4.1x | no |
| PreScope | predictor LLaPor layer-group-aware | top-4 acc 94-99% | no |
| **SpecPrefetch** (arXiv:2607.24787) | adapter low-rank 6.48M par. che predice la massa di routing; **girato su Snapdragon 8 Elite** | Recall@8 85.6-89.4% (Qwen3-VL-30B-A3B); +20% su storage lento | "upon acceptance" |
| FlashMoE (arXiv:2601.17063) | SSD offload + cache ML recency+frequency | hit +51% vs LRU/LFU, 2.6x — ma DESKTOP | — |
| **DraftExpert** (arXiv:2607.24434) | draft expert residenti distillati per layer, self-speculative + prefetch del target | **1.45x**, acceptance 84-87%, prefetch hit 86-88% (DeepSeek-V2-Lite, Moonlight-16B-A3B; scenari CPU→GPU e Flash→NPU) | no |
| EVICT (arXiv:2605.00342) | speculative decoding expert-aware (albero di draft che minimizza l'unione di esperti) | −32.5% esperti attivati vs EAGLE-3 | — |
| **kimi-k3-in-c** (FareedKhan-dev, 2026) | C99 puro, `pread` **O_DIRECT** (bypassa il page cache), LRU + batch prefetch; anche il trunk denso (109GB bf16) è streamato via ring buffer; budget RAM "a manopola" con output byte-identico a ogni preset | Kimi K3 **2.78T** (896 esperti/layer, 16 attivi) in 8.24GB RSS — ma **~32 s/token** su dual EPYC 7763 + NVMe 5-6 GB/s | sì (Linux x86-64 only: O_DIRECT, no ARM/Android) |

Nota su kimi-k3-in-c (aggiunta 2026-08-05): è la dimostrazione più estrema del principio di
questo progetto (checkpoint/RAM ≈ 190:1 contro il nostro ≈ 1.6:1), ma il caso "8GB" è lento
(~0.03 tok/s) proprio perché lì **anche il trunk denso viene ri-letto da disco a ogni token**;
nel nostro setup trunk+shared expert stanno in RAM e si streamano solo i routed → regime
molto più favorevole, la finestra 5-8 tok/s resta plausibile. Takeaway tecnico per F8: la
loro scelta `O_DIRECT`+`pread` batte l'I/O bufferizzato e **non inquina il page cache** —
rilevante per noi visti i majflt storm di F2; da valutare se il read path di BigMoeOnEdge
possa usare O_DIRECT su f2fs/FBE Android (esperimento, non prerequisito). NON è un runtime
candidato per S23.

**Gap che questo progetto copre** (dai report, riformulati come obiettivi):

- G1: nessuno ha fatto MoE 256-esperti/~35B da flash **UFS** su telefono **8GB** con cache
  predittiva end-to-end (FlashMoE=desktop, SpecPrefetch=modello piccolo).
- G2: gli hit-rate in letteratura sono quasi tutti **simulazioni offline**; noi misuriamo con
  budget RAM reale, eviction reale, lmkd reale.
- G3: **expert packing su flash per letture sequenziali single-device è un'area quasi vuota**
  (il più vicino è il bundling di Apple, a grana di neurone) → contributo originale possibile.
- G4: nessuno integra speculative expert-aware + cache multi-tier + quantizzazione mista
  per-esperto in un'unica pipeline mobile.
- G5: i sistemi migliori (HOBBIT, ExpertFlow, Fate, PreScope) sono **senza codice** → una
  implementazione open riproducibile ha valore di per sé.

---

## 4. Decisione modelli (finale, eseguibile)

Download list per il telefono (home Termux, `~/models/`), in ordine di priorità:

| # | File | GB | Obbligatorio? |
|---|---|---:|---|
| 1 | Qwen3.5-4B Q4_K_M (`unsloth/Qwen3.5-4B-GGUF`) | 2.74 | sì — controllo denso (possibile riuso del file già scaricato dall'app Kalsa se estraibile; altrimenti riscaricare) |
| 2 | LFM2-8B-A1B Q4_K_M (`LiquidAI/LFM2-8B-A1B-GGUF`) | 5.04 | sì — controllo MoE-in-RAM |
| 3 | **Qwen3.6-35B-A3B UD-IQ2_M** (`unsloth/Qwen3.6-35B-A3B-GGUF`) | 11.52 | sì — target primario |
| 4 | Qwen3.6-35B-A3B UD-Q2_K_XL | 12.29 | sì, ma si scarica SOLO al momento di F4.4 (servono 12.3GB liberi allora; cancellabile dopo il confronto) |
| 5 | Qwen3.6-35B-A3B-MTP GGUF (repo unsloth; quant minima = UD-IQ1_M full+MTP) | **11.37 [V]** (ex ~2–3 [S]; F0.1) | sì — serve per F6; **non** è un draft leggero |
| 6 | Qwen3.6-35B-A3B UD-IQ3_XXS | 13.21 | solo se gate F4 = PASS |
| 7 | Gemma-4-26B-A4B UD-IQ2_XXS (`unsloth/gemma-4-26B-A4B-it-GGUF`) | 9.92 | opzionale (cross-check) |

Spazio (matematica esplicita, edit 2026-08-03): core residente iniziale = voci 1+2+3+5 =
2.74+5.04+11.52+11.37 ≈ **30.7 GB [V]** (non più 22.6 [S]). Alternativa per non sforare:
tenere solo 1+2+3 (~19.3 GB) e in F6 **sostituire** il file target con la variante MTP
(stesso ordine di grandezza, niente base+MTP affiancati).
Requisito d'ingresso: **≥40GB liberi** — copre il core, il margine di lavoro e la voce 4 al
momento di F4.4 (che va cancellata dopo il confronto se lo spazio è sotto i 15GB liberi).
Le voci 6-7 (≈23GB in più) SOLO se al momento restano ≥15GB liberi dopo il download previsto.
Se lo spazio non basta: si rinuncia prima alla 7, poi alla 6; il confronto K vs IQ di F4.4 si
fa comunque, al limite in modalità "una quant grande alla volta" (scarica 4 → misura →
cancella 3 o 4, mai tenerle entrambe senza margine).

Verifica d'integrità: dimensione esatta in byte da HF API (pattern già usato nell'app Kalsa) —
niente hash streaming disponibile per file da 11GB+, la size esatta + load riuscito è il check.

---

## 5. La fisica del problema (aggiornata coi numeri veri)

Numeri F0.6 misurati su `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` (2026-08-03, source:
`results/gguf_ud-iq2m_dump.txt`). I [S] restanti sono solo I/O UFS e budget RAM device.

- Parametri per esperto per layer [V]: 3 matrici × hidden 2048 × moe_ff 512 =
  **3 145 728 params/esperto/layer**. Quant mista Unsloth UD-IQ2_M:
  gate/up = IQ2_XXS, down = IQ3_XXS (37 layer) o IQ4_XS (layer 34/38/39).
  → **942 080 B = 0.942 MB per esperto** (37/40 layer) [V];
  1 097 728 B = 1.098 MB (3/40 layer) [V]; media 0.954 MB.
  (Sanity: 256×40×3.15M ≈ 32.21B esperti + attention/shared/embed ≈ 3.7B ≈ 35.9B ✓;
  bpw esperti effettivo ≈ 2.40 [V].)
- Traffico naive per token (0% hit) [V]: 8 routed × 40 layer × 942 080 B =
  **301 465 600 B ≈ 301.5 MB/token (mediana)**, pesato reale (3 L con down IQ4_XS) **305 201 152 B ≈ 305.2 MB/token** [V] (shared shexp residente, escluso).
  **[MISURATO F2.1, 2026-08-04 — placeholder sostituito]** Random read UFS 3.1 (qd1, mediane
  fio): 1M = **413 MiB/s**, 256k = 214, 64k = 83, 4k = 21. Per letture a grana esperto
  (0.942 MB [V]) banda effettiva stimata **~370-410 MiB/s** → naive ≈ 305 MB ÷ ~400 MB/s ≈
  **~0.75-0.85 s/token di solo I/O ≈ 1.2-1.3 tok/s**: il muro, misurato. (Mai usare la
  colonna 4K in questa formula. Nota: qd>1/io_uring inaffidabile su Termux — il parallelismo
  reale lo danno gli `--io-threads` del fork, da misurare in F4.)
- Con hit-rate 90% (plausibile da letteratura con cache ≈ 2× working set): ~30.1 MB/token →
  **~0.08 s di I/O** → **5-8 tok/s combinando compute** [S]. Il progetto vive o muore qui.
- Budget RAM S23 [S]: 8GB fisici − OS/OneUI ≈ 3-3.5GB → **~4.5GB usabili in Termux** senza
  farsi uccidere da lmkd. Allocazione target: pesi densi+shared residenti ~1.5-2GB + KV+buffer
  ~0.5GB + **cache esperti 1500-2500MB** (`--cache-mb`).
- KV cache: `full_attention_interval=4` → 10 layer full-attn su 40 [V]; 2 KV head × head_dim 256
  → a q8_0 ≈ **10KB/token** [S] → 4k contesto ≈ 40MB: trascurabile. L'ibrido DeltaNet/SSM è un
  regalo per questo progetto (in un MoE classico il KV competerebbe con la cache esperti).
- Cache "utile" in numeri di esperti: 2000MB / 0.942MB ≈ **~2120 slot su 10 240 totali
  (256×40) ≈ 21%** [V] — la letteratura (2505.16056) dice che con questa copertura l'hit-rate
  LRU su finestre medie supera l'85-90%: coerente con l'ipotesi H2.

Formula guida (da riportare in ogni report di fase):

```
t_token ≈ t_compute(3B attivi, CPU 8g2) + n_miss × t_load_esperto(UFS 3.1, random ~0.942 MB)
hit-rate → n_miss = 320 esperti-layer/token × (1 − h)
traffico_flash/token ≈ n_miss × 0.942 MB
```

---

## 6. Ipotesi scientifiche (⚠ STORICO — esiti in STATO CORRENTE e nel Registro: H1 confermata, H2 soddisfatta sul carico vero, H3 falsificata, H4 falsificata, H5 confermata, H6 parziale)

| ID | Ipotesi | Attesa quantitativa (da letteratura) | Dove si testa |
|---|---|---|---|
| H1 | Località temporale degli esperti su Qwen3.6-35B-A3B in task chat/coding reali | hit-rate LRU ≥80% con cache ≈2× working set (2505.16056: 81-97%) | F7 (trace), conferma indiretta in F4 |
| H2 | Una cache esperti in DRAM con budget ~2GB riduce il traffico flash ≥5× vs naive | da **305.2 MB/token [V]** a ≤50 MB/token [S] | F4 (BigMoeOnEdge), F8 |
| H3 | Il prefetch predittivo batte LRU/LFU puro | +5-15 punti di hit-rate (ExpertFlow: +61% vs LRU è su GPU serving, non ci aspettiamo tanto) | F7 simulatore → F8 runtime |
| H4 | MTP/speculative riduce i caricamenti per token utile (meno passi target) | DraftExpert: 1.45x; EVICT: −32.5% esperti attivati. Ma RTX3090: 0 speedup → esito aperto su CPU+flash | F6 |
| H5 | Il degrado sotto memory pressure è governabile con cache applicativa esplicita (vs page cache) | BigMoeOnEdge vs mmap nudo: 5.0 vs 0.09 tok/s (già quasi-provata altrove) | F5 |
| H6 | (originale, G3) Riordinare gli esperti sul GGUF per co-attivazione converte random read in read semi-sequenziali → +banda effettiva | UFS 3.1: seq 1686 MB/s vs random 4K ~10-20× più lenta [S] | F8+ (estensione) |

---

## 7. Roadmap: fasi F0-F8 (⚠ STORICO — F0-F5 eseguite, F6 chiusa, F7 eseguita come M5, F9.1 ri-quant chiusa; le priorità vive sono in STATO CORRENTE)

> Ogni fase ha: obiettivo, task, gate d'uscita. Le fasi F0 è su PC (Grok da solo); F1-F6 sono
> PC+telefono (Grok prepara, gualt esegue); F7-F8 tornano pesantemente su PC/RunPod.

### F0 — Preflight su PC (Grok, ~1-2 giorni, nessun telefono richiesto)

- **F0.1 Ri-verifica online** (obbligatoria, il mondo cambia in fretta):
  - stato PR llama.cpp **#26003** (`--lazy-experts`) e #24156 — se nel frattempo MERGIATE, il
    piano F4 cambia: prima si prova mainline lazy, poi il fork;
  - repo `Helldez/BigMoeOnEdge`: ultimo commit, issue aperte, licenza, README aggiornato;
  - esistenza/nome esatto dei file GGUF della download list §4 (HF tree API, size in byte);
  - versione corrente llama.cpp e nomi flag (`--spec-*`, `--load-mode`, `-ctk/-ctv`);
  - llama.rn ultima versione (per il binario prodotto, non blocca).
- **F0.2 Struttura di lavoro e flusso dati canonico**: GIÀ CREATA — è questo repo
  (`scripts/` bash per Termux · `analysis/` Python: parsing log → CSV → grafici · `traces/` ·
  `results/` · `reports/`). **Flusso dati (unica definizione valida, richiamata da
  §2.2.3/5/6)**: sul telefono l'harness scrive `~/experiments/results/runs.csv` + log grezzi
  (buffer di lavoro); a fine di OGNI sessione di misura Grok fa pull (scp via ssh §2.3, o
  `adb pull`) verso `results/` di questo repo — che è l'archivio canonico — e committa;
  l'analisi legge SOLO la copia PC. Mai editare a mano la copia telefono.
- **F0.3 Harness telemetria** (bash, POSIX-compatibile con Termux): script `run_bench.sh` che
  wrappa un run llama.cpp e cattura: cmdline, timestamp, `/proc/meminfo` prima/dopo,
  `/proc/<pid>/stat` (minflt campo 10, majflt campo 12) prima/dopo, `/proc/<pid>/io`
  (read_bytes) prima/dopo, `termux-battery-status` (temperatura) prima/dopo, output completo
  llama.cpp (i suoi timing: prompt eval tok/s, eval tok/s, ttft) → append riga a `runs.csv`.
  NB: thermal zones e simpleperf NON disponibili senza root — non perderci tempo.
- **F0.4 Audit BigMoeOnEdge** (ostile): diff completo vs llama.cpp upstream di pari data.
  Cerca: (a) codice malevolo/rete/exec, (b) correttezza dello streaming (race, use-after-free,
  cache coherency), (c) semantica ESATTA di `--moe-stream`, `--cache-mb`, `--dense-weights`,
  `--drop-cold-experts` e del parametro `k` dei bench, (d) policy di eviction usata (LRU? LFU?
  altro?), (e) punti di aggancio per la nostra strumentazione (log attivazioni esperti, hit/miss
  counter), (f) **build system**: CMake/script che scaricano roba dalla rete a build-time
  (FetchContent, curl nei target custom) = red flag da ispezionare uno per uno.
  **Regole di contenimento (ricalibrate: il device di test è un S23 VERGINE dedicato, senza
  dati personali)**: si builda SOLO da sorgente a commit PINNATO e auditato — mai
  binari/release precompilati del fork (costa zero e garantisce riproducibilità). La passata
  di sicurezza si limita ai punti (a) e (f) — rete/exec e fetch a build-time; il valore
  PRIMARIO dell'audit è ingegneristico: capire streaming/cache/eviction per decidere la
  strategia F8. Prima esecuzione direttamente sul telefono: OK (RunPod resta solo come
  fallback se la build Termux fallisce). Termux senza permesso storage (v. F1) come default
  di least-privilege. Blocco WAN nei run di misura: opzionale, non richiesto.
  Report dedicato: è la lettura più importante di tutto il progetto — da qui esce la
  strategia F8 (patchare il fork vs riscrivere su mainline+#26003).
- **F0.5 Piano build**: due percorsi pronti: (a) build on-device in Termux (clang/cmake, flags
  auto dotprod/i8mm), (b) cross-compile NDK su RunPod se la build on-device è troppo lenta o
  fallisce. Scrivi entrambi gli script; il default è (a).
- **F0.6 Download su PC + gguf-dump del target** (autonomo, niente telefono): Grok scarica
  UD-IQ2_M (voce 3 di §4) **direttamente su PC** (huggingface-cli; serve ~12GB liberi su PC)
  e ci fa girare gguf-dump: dimensioni esatte per-tensore → dimensione reale media di un
  esperto a UD-IQ2_M, layout dei tensori esperti nel file (contigui per layer? interleaved?),
  overhead metadata. Aggiorna le stime [S] di §5. Il file NON si riscarica sul telefono: in F1
  viene pushato via USB (`adb push` verso la home Termux, poi spostato con `mv` da shell ssh —
  NB: `adb push` diretto nella home Termux non è permesso dai permessi Android; push in
  `/sdcard/Download/` e poi `cp` da Termux, che può leggere /sdcard SOLO se in quel momento ha
  il permesso storage → farlo PRIMA di revocare il permesso per la campagna, oppure usare
  `scp` via ssh §2.3 che non ha questo problema. Preferenza: **scp**.)
- **Gate F0**: audit BigMoeOnEdge = nessun red flag di sicurezza; harness pronto; download list
  confermata. Altrimenti: BLOCKED con alternative (es. fork malevolo → si parte da mainline + PR #26003 applicata a mano).

### F1 — Setup telefono (gualt esegue, Grok prepara tutto; ~1 giorno)

Checklist device (una tantum):
- [ ] ≥40GB liberi; batteria >50%; telefono aggiornato
- [ ] **Device di test dedicato e VERGINE** (confermato): nessun dato personale a bordo →
      niente backup necessario. NESSUN blocco schermo (autonomia dei riavvii, §2.3).
      Possibilmente senza account Google (meno servizi in background = più RAM libera e
      misure più pulite; Termux/F-Droid non lo richiedono)
- [ ] **Termux SENZA permesso storage**: niente `termux-setup-storage` — su questo device non
      serve (i file arrivano via scp nella home) ed evita anche il bug scoped-storage #18804:
      least privilege gratis
- [ ] **RAM Plus OFF** (Impostazioni → Assistenza dispositivo → Memoria → RAM Plus) — usa la
      UFS come swap: veleno puro per questo progetto
- [ ] Termux da **F-Droid o GitHub releases** (mai Play Store)
- [ ] Ottimizzazione batteria disattivata per Termux (Device Care → escludi)
- [ ] `termux-wake-lock` attivo in ogni sessione; `pkg install termux-api` per battery-status
- [ ] **Workaround phantom process killer via adb** (richiede PC, una tantum):
      `adb shell "settings put global settings_enable_monitor_phantom_procs false"`
      (e su Android 14+: `adb shell device_config put activity_manager max_phantom_processes 2147483647`)
      — senza questo, OneUI può uccidere i processi a metà run e i numeri diventano spazzatura
- [ ] Modelli SEMPRE in `~/models/` (home Termux) — MAI in `/sdcard` o `/storage/...` (bug #18804)
- [ ] Numeri di performance MAI sotto carica attiva (throttling diverso) e MAI con telefono caldo:
      regola: temperatura batteria ≤32°C a inizio run (da `termux-battery-status`)

Poi: `pkg update && pkg install git cmake clang make python curl fio jq openssh termux-api`,
build llama.cpp mainline pinnata (tag scelto in F0.1), smoke test con `pkg install llama-cpp`
in parallelo per un primo output entro minuti. Modelli: voci 1-2 e 5 di §4 via
`huggingface_hub[cli]` sul telefono (poi `rm -rf ~/.cache/huggingface`); la voce 3 arriva
**via scp dal PC** (già scaricata e dumpata in F0.6 — non riscaricarla). Prompt di benchmark
fissi in `~/experiments/prompts/` (short/medium/code — riusare i testi del piano precedente,
vanno bene).

**Gate F1**: llama.cpp buildato gira; Qwen3.5-4B genera testo; harness `run_bench.sh` produce
righe CSV valide con majflt/read_bytes/temperatura.

### F2 — Baseline e caratterizzazione (telefono; ~1-2 giorni)

- **F2.1 fio su UFS 3.1** — IL numero fondante del progetto:
  random read 4k/16k/64k/256k/1M, iodepth 1 e 4, su file da 2GB nella home Termux (3 run,
  mediana). Output: curva banda-vs-blocksize → dice la granularità di lettura ottimale per lo
  streaming di esperti da ~1MB e quanto costa il random vs i 1686 MB/s sequenziali.
- **F2.2 Baseline densa**: Qwen3.5-4B Q4_K_M — config di partenza dichiarata: t=5, ctx=1024,
  KV q8_0. Sweep **greedy, una dimensione alla volta tenendo il best-so-far, in quest'ordine**:
  thread {4,5,6} → ctx {512,1024,4096} → KV {f16, q8_0}. Fissa la configurazione di
  riferimento del telefono e i suoi tok/s.
- **F2.3 Baseline MoE-in-RAM**: LFM2-8B-A1B Q4_K_M, stessa griglia. Confronto con F2.2 →
  quanto costa l'orchestrazione MoE quando l'I/O non c'entra. (Questi numeri sono anche il
  materiale del binario prodotto A.)
- **F2.4 Termica**: run continuo 10 minuti col 4B, log tok/s per blocco da 30s + temperatura →
  curva di throttling del telefono (serve per interpretare TUTTI i run successivi).

**Gate F2**: fio completato (numeri random read in mano); 4B ≥ ~8-10 tok/s stabili [S];
LFM2 misurato. Se il 4B va male, si sistema il setup PRIMA di toccare il 35B.

### F3 — Il muro: mmap naive col 35B (telefono; ~1 giorno)

Scopo: MISURARE il disastro atteso, non evitarlo. È la baseline "B" della tabella §9 e il
numero che dà senso a tutto quello che viene dopo.

- Qwen3.6-35B-A3B UD-IQ2_M su llama.cpp **mainline**, mmap default: run cold (post-riavio),
  `-n 32 -c 512`. Attesi: minuti di caricamento (MAP_POPULATE su 11.5GB con 4.5GB di RAM),
  poi 0.1-1.5 tok/s [S] con majflt altissimi. Registrare TUTTO (majflt/token è la metrica).
- Variante `--numa` (→ MADV_RANDOM) e variante `--no-warmup` se disponibile: cambia qualcosa?
- Run warm immediato: la page cache (≈4GB utili vs 11.5GB di file) può tenere ~35% del
  modello → miglioramento atteso modesto. Quantificarlo.
- 3 run per variante. Se il processo viene ucciso da lmkd → annotare, è un dato (non un fallimento).

**Gate F3**: numeri naive registrati (anche "OOM-kill sistematico" è un risultato valido).
Non c'è FAIL possibile in F3: è pura misura.

### F4 — Streaming: BigMoeOnEdge (telefono; ~3-5 giorni) — **cuore del piano**

- **F4.1 Build** in Termux (script F0.5). **[Aggiornato post-F0.4]** BigMoeOnEdge NON è un
  fork di llama.cpp: è un monorepo con engine proprio (~5.4 kLOC streaming) + llama.cpp come
  submodule con UNA patch di 28 righe (hook expert-ready per `--overlap`). Il binario di
  misura è **`bmoe-cli`**, non `llama-cli`. Build SOLO da sorgente ai pin auditati (monorepo
  `b0c4e5b`, submodule `5236140e5`); mai APK/release. Se la build Termux fallisce → NDK su RunPod.
- **F4.2 Riproduzione**: UD-IQ2_M, `bmoe-cli --moe-stream --cache-mb 2000 --dense-weights anon
  --overlap --io-threads 4`, `-n 64 -c 512`, 3 run.
  Domanda unica: **quanti tok/s su S23/UFS3.1 con 8GB?** (il riferimento è 5.0 su 12GB/UFS4
  con un file di 22GB — noi abbiamo metà RAM e storage più lento ma un file di metà taglia).
- **F4.3 Sweep parametri** — config base = quella di F4.2 (thread = migliore di F2.2, ctx 512).
  Vincolo dal fork: `--cache-mb` ha un **floor di 1500** (1-1499 rifiutati senza
  `--force-cache`). Sweep **greedy, una variabile alla volta tenendo il best-so-far, in
  quest'ordine**: `--cache-mb` {1500, 2000, auto} → `--overlap` on/off → `--io-threads`
  {2, 4, 8} → `--prefetch` {0, 1, 2} → thread {4,5,6} → ctx {512, 2048}. Per ogni run: tok/s,
  ttft, **`cache_hit_pct` (nativo nel fork: summary/CSV)**, MiB/token letti (nativo),
  majflt/token, read_bytes/token, RAM peak, temp.
- **F4.3b Knob LOSSY — separati, MAI nella baseline scientifica** [da F0.4]:
  `--n-expert-used` {6, 4} (è il "k" dei bench del fork = override del top-k del routing:
  deterministico ma cambia il modello) e `--drop-cold-experts` {0.75} (salta esperti routed
  su cache-miss sotto soglia: lossy e NON riproducibile per design). Ciascuno si misura vs la
  config best-so-far di F4.3 E si accompagna al check qualità di F4.5. I numeri "headline"
  del progetto restano quelli SENZA knob lossy; le varianti lossy vanno in tabella dichiarate
  come tali.
- **F4.4 K-quant vs IQ**: ripetere la config migliore con UD-Q2_K_XL (12.29GB). Decidere la
  quant di progetto su (tok/s, qualità percepita su 3 prompt fissi).
- **F4.5 Qualità**: con la config migliore, 5 prompt qualitativi (chat IT, reasoning semplice,
  coding breve, summarization, tool-call finto stile Kalsa) → giudizio a 3 livelli vs Qwen3.5-4B
  e vs LFM2. Se UD-IQ2_M produce spazzatura, provare UD-IQ3_XXS (se spazio) e rivalutare.
- **F4.6 (opzionale)** Gemma-4-26B-A4B UD-IQ2_XXS con la stessa config → il fenomeno
  generalizza oltre Qwen?

**Gate F4** (il gate del progetto). Definizione: x = eval tok/s mediana warm della config
migliore; "naive di riferimento" = la migliore mediana warm tra le righe B e B2 di F3 (§9):
- x ≥ 3 tok/s → PASS pieno, si va a F5-F8 con priorità alta.
- 1.5 ≤ x < 3 tok/s **e x ≥ 3× il naive di riferimento** → PASS condizionato: si va avanti,
  ma F8 (predictor) diventa la leva necessaria.
- x < 1.5 tok/s (oppure x < 3× il naive) dopo lo sweep → STOP del binario B su S23: si
  documenta, si ripiega su (a) target UFS 4.0 device (S23 256GB+/S24) come richiesta hardware
  minima, e (b) binario A (LFM2) come prodotto. Decisione a gualt con i numeri davanti.

### F5 — Stabilità: memory pressure, termica, lunga durata (telefono; ~2 giorni)

- Pressure test in TRE varianti SEPARATE (una variabile alla volta, coerente con §2.2.2).
  Protocollo per ciascuna: run warm di riferimento → disturbo → ritorno → stesso prompt ×2
  (misura SOTTO effetto del disturbo) → chiusura di tutte le app di disturbo → stesso prompt
  ×2 (misura del RECUPERO — è questa che il gate valuta):
  a) solo pressione RAM: browser con 10 tab pesanti;
  b) solo termica: fotocamera 30s in registrazione 4K;
  c) combinata (browser + fotocamera), SOLO dopo a) e b), per l'effetto congiunto.
  Domande: la cache applicativa del fork sopravvive meglio della page cache (H5)? lmkd uccide
  il processo? Il recupero avviene senza riavvio?
- Run lungo: 5 minuti di generazione continua → curva tok/s vs tempo vs temperatura.
  Per il confronto termico, eseguire nella STESSA sessione anche un run denso 4B di 5 minuti
  come riferimento a pari durata (la curva F2.4 da 10 min è carico diverso: usarla solo come
  contesto, non come confronto diretto).
- Robustezza: 10 avvii consecutivi, tasso di successo; comportamento con batteria <30%.

**Gate F5**: sotto disturbo degrado <50%; **recupero ≥90% del tok/s pre-disturbo dopo la
chiusura delle app, senza riavvio** (misurato dal protocollo sopra); nessun OOM sistematico
con la config di progetto. Altrimenti: ridurre `--cache-mb` e riprovare (tradeoff da tabellare).

### F6 — MTP / speculative decoding (telefono; ~2 giorni, dipende da F4 PASS)

- Verificare che la build del fork (o mainline, se nel frattempo #26003 è mergiata e F4 è
  stata rifatta lì) supporti `--spec-type draft-mtp` col GGUF MTP di §4 (voce 5).
- A/B rigoroso, stessa config F4 migliore: MTP off vs on (`--spec-draft-n-max` {2,3,4}).
  Metriche: tok/s netti, acceptance rate (dal log), **majflt/token e read_bytes/token** —
  H4 dice che il guadagno vero è nei caricamenti per token utile, non solo nel compute.
- Attenzione al conflitto RAM: il draft MTP occupa memoria → potrebbe rubare spazio alla
  cache esperti. Se serve, ridurre `--cache-mb` di pari passo e misurare il netto.
- Esito atteso: genuinamente incerto (GPU: +2x dichiarato da llama.cpp, 0x su RTX3090 indie).
  Qualunque esito è un risultato pubblicabile.

**Gate F6** (soglia dura): MTP "conviene" se eval tok/s netti ≥ **+10%** vs stessa config
senza MTP, con majflt/token **invariato o ridotto**; qualunque altro esito = "non conviene"
(si documenta e si toglie dalla config finale).

### F7 — Ricerca: trace, simulatore, predictor (PC/RunPod + telefono per i trace; ~2-4 settimane)

- **F7.1 Trace di attivazione**: **NESSUNA patch necessaria** [esito F0.4] — il fork ha già
  `--route-trace` (RouterHook → righe: step, layer, slot, expert, weight, residency, dropped;
  sink CSV). Raccogliere ≥50k token di trace su telefono con task realistici Kalsa (chat
  IT/EN, coding, summarization, tool-calling) + prompt lunghi. Se per il predictor
  cross-layer (F7.3c) servono anche le top-16 router prob, aggiungere un sink alternativo
  sulla stessa callback (patch piccola, fuori dal critical path).
- **F7.2 Simulatore offline** (Python, su PC): replay dei trace contro modelli di cache
  parametrici: LRU, LFU, frequency+decay, costo-aware (score = P(riuso) × costo_reload / size),
  con budget cache variabile 500MB-3GB. Output: curve hit-rate vs budget per policy.
  Calibrazione: il simulatore deve riprodurre l'hit-rate osservato in F4 col fork **entro ±2
  punti** (metà del margine di vittoria del Gate F7 — se non ci si arriva, il simulatore non è
  affidabile: BLOCKED finché lo scarto non è spiegato).
- **F7.3 Predittori** (in ordine di complessità, fermarsi appena il guadagno satura):
  a) frequenza recente + decay (baseline già nel vecchio piano);
  b) matrice di co-occorrenza/transizione esperto→esperto (Markov, per layer);
  c) cross-layer: router del layer i → prefetch layer i+1 entro lo stesso token (Fate-style,
     acc attesa ~80-97%);
  d) adapter low-rank stile SpecPrefetch (6.5M parametri, training su RunPod coi trace) —
     SOLO se (c) non basta.
  Metrica: hit-rate simulato vs LRU a parità di budget + costo compute del predictor.
  **Nota [da F0.4]**: il fork ha già un prefetch predittivo sperimentale (`--predict-prefetch`,
  gate-early, + `--route-ahead`): vanno misurati come baseline aggiuntive — il nostro
  predictor deve battere anche loro, non solo LRU.
- **F7.4 Analisi H6 (packing)**: dai trace, matrice di co-attivazione → clustering degli
  esperti → stima di quanto un riordino su disco convertirebbe i miss in letture sequenziali
  (usando le curve fio F2.1). Solo analisi, niente implementazione qui.

**Gate F7**: una policy batte LRU di ≥5 punti di hit-rate a parità di budget nel simulatore
(H3) — margine ≥2× la tolleranza di calibrazione di F7.2 — con costo del predictor
trascurabile (definizione: **<5% del tempo per token stimato** nella config di progetto).
Altrimenti: si documenta che LRU/LFU è già vicino all'ottimo su questo carico (risultato
negativo ma utile, coerente con 2505.16056) e F8 si riduce a hardening del fork.

### F8 — Runtime predittivo + eval finale (PC + telefono; ~2-4 settimane)

- Implementare nel runtime la policy vincente di F7 — **decisione presa al checkpoint F0.4:
  si estende BigMoeOnEdge** (predictor come nuovo caller di `IExpertSource::prefetch/retain`
  + aggancio nel RouterHook, senza toccare ggml; eviction cost-aware al posto della LRU in
  `ExpertStreamSource`). Piano B (mainline + PR #26003) resta attivabile SOLO se F4 mostra
  immaturità runtime (crash, silent-wrong, thrashing non governabile). Contatori hit/miss:
  già esposti dal fork, estendere non sostituire.
- Rieseguire l'intera griglia F4 (stessa metodologia, stessi prompt) con la config finale.
- **Eval finale "paper-grade"**: tabella §9 completa, confronto A/B/C/D/E, 3 seed, tutte le
  metriche §8. Se i numeri reggono (§10 livello buono+), questo è il materiale per un
  write-up pubblico (blog tecnico o short paper — i gap G1-G5 sono la motivazione).

### F9 — Estensioni (solo dopo F8, in ordine di valore atteso)

1. **Quantizzazione mista per-esperto** (HOBBIT-style, G4): esperti hot a 3-4 bit residenti,
   cold a 2 bit su flash; oppure "miss serviti a bassa precisione". Richiede tooling di
   ri-quantizzazione GGUF per-tensore (fattibile con llama-quantize custom).
   **1b. Expert pruning trace-driven** (variante degenere della 1: cold → 0 bit). Filone
   LOSSY, mai nella baseline. Razionale [2026-08-04]: nello streaming il pruning NON riduce il
   traffico di decode (8 attivi restano 8) e muove poco l'hit-rate; beneficio reale solo su
   prefill/TTFT (unione esperti più piccola) e copertura cache marginale. Se si fa: decisione
   dai NOSTRI route-trace F7.1 (carico Kalsa IT/EN), NON con pruned generici da HF calibrati
   su benchmark inglesi; check qualità F4.5 obbligatorio, con attenzione all'italiano.
   Da valutare anche il trade "pool −25% ma quant +1 tier": file uguale ma traffico/token
   +~30% — ambiguo, solo misura può dirlo.
2. **Expert packing su flash** (H6/G3): riscrittura del GGUF con esperti riordinati per
   co-attivazione. Contributo potenzialmente originale, nessun paper lo fa su single-device.
3. **DraftExpert-style** (G4): training per distillazione dei draft expert su RunPod
   (paper senza codice: implementazione da zero, costosa — solo se F6 mostra che lo
   speculative paga su questo hardware).
4. **Binario prodotto**: portare il risultato in Kalsa via llama.rn richiede che i flag di
   streaming arrivino nel binding (PR upstream a llama.rn o fork nostro). Prima però il
   catalogo Kalsa può già prendere LFM2-8B-A1B coi numeri di F2.3.
5. **Multi-device**: S24/S25 (UFS 4.0), Pixel — la matrice fascia×strategia del vecchio piano
   resta valida come formato.

---

## 9. Tabella comparativa finale (da riempire progressivamente)

**Unità, per non ripetere l'errore di F3**: `MiB flash/tok` = `read_bytes_delta / 1024² /
n_gen`. In F3 questa colonna era stata riempita dividendo per 1024 → valori **1024× troppo
alti**, con il rischio di far sembrare mille volte migliore qualunque riduzione di traffico
misurata in F4 contro questa baseline. Ricontrollare a mano ogni colonna derivata prima di
usarla in un confronto.

| ID | Configurazione | tok/s cold | tok/s warm | hit-rate | majflt/tok | MiB flash/tok | RAM peak | Note |
|---|---|---:|---:|---:|---:|---:|---:|---|
| A | Qwen3.5-4B Q4_K_M (denso, in RAM) | — | **8.90** | n/a | basso | ~0 | — | controllo, F2.2c t4/c1024/f16; sostenuto 10 min **4.68** (F2.4) |
| A2 | LFM2-8B-A1B Q4_K_M (MoE, in RAM) | — | — | n/a | ~2e6/rep | — | — | **nessun baseline valido**: thrash su 8GB anche a Q4_0, sentinella FAIL×2 (F2.3c/bis) |
| B | 35B UD-IQ2_M, mainline mmap naive | 0.10 | 0.10 | n/a | ~3.6e5 | ~9.7e3 (9.5 GiB) | ~4.4–4.8 GB | **il muro** (F3); cold=fadv; no OOM/lmkd |
| B2 | come B + --numa/MADV_RANDOM | 0.10 | 0.10 | n/a | ~3.6e5 | ~9.7e3 (9.4 GiB) | ~4.7–4.8 GB | F3; indistinguibile da B **alla risoluzione dello strumento** (±0.05 tok/s) |
| B2alt | come B + --no-warmup | 0.10 | — | n/a | ~3.5e5 | ~9.4e3 (9.2 GiB) | ~4.7 GB | F3, **esplorativa** (1 rep cold, nessun warm): non riga promossa |
| C | 35B UD-IQ2_M, BigMoeOnEdge default | 5.06 | **5.02** | 56.9% | ~458 | 84.7 | ~4.6 GB | **F4.3-bis, GATE F4 PASS** (x = mediana warm = 5.02); `--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4`, t=4, **top-app**; ttft 27.5 s |
| C2 | C + sweep migliore (cache-mb/k/…) | | | | | | | F4.3 |
| C3 | 35B UD-Q2_K_XL, config C2 | | | | | | | F4.4 K vs IQ |
| D | C2 + MTP | | | | | | | F6 |
| E | C2 + predictor F8 | | | | | | | F8 |
| (opz) | Gemma-4-26B UD-IQ2_XXS, config C2 | | | | | | | F4.6 |

---

## 10. Criteri di successo (ricalibrati sui dati 2026)

**Minimo (il progetto "ha senso"):**
- il 35B genera ≥64 token senza crash sistematici su S23; F3 e F4 misurate;
- streaming (F4) ≥ **1.5 tok/s** sostenuti e ≥3× il naive di riferimento di F3 (stessa
  definizione e stesse soglie del Gate F4 — nessun criterio aggiuntivo).

**Buono (il progetto "è promettente"):**
- ≥ **3 tok/s** sostenuti 5 minuti; hit-rate ≥80%; traffico flash ridotto ≥5× vs naive;
- degrado sotto pressure <50% con recupero automatico; qualità F4.5 ≥ "utilizzabile".

**Ottimo (il progetto "è forte" — parità col telefono 12GB/UFS4 di BigMoeOnEdge):**
- ≥ **5 tok/s**; hit-rate ≥90%; predictor F8 ≥ +5 punti vs LRU; ttft accettabile (<15s cold);
- risultato riproducibile in 10/10 avvii → materiale per write-up pubblico (G1-G5).

---

## 11. Rischi e mitigazioni (aggiornati)

| Rischio | Prob. | Mitigazione |
|---|---|---|
| OOM/lmkd kill col 35B | alta | cache-mb prudente (partire 2000→scendere), ctx 512, KV q8_0, RAM Plus off, niente app in background; annotare ogni kill |
| Random read UFS 3.1 troppo lento (F2.1 <150MB/s [S]) | media | granularità di lettura più grossa (batch di esperti), prefetch più aggressivo, valutare packing (F9.2) prima del previsto; peggio: dichiarare UFS 4.0 requisito minimo |
| BigMoeOnEdge immaturo/buggato/abbandonato | media | audit F0.4; piano B = mainline + PR #26003 applicata a mano; piano C = patch nostra su mainline (F8 anticipata) |
| Fork di terzi = rischio sicurezza | bassa (device vergine dedicato, zero dati personali) | audit F0.4 + build solo da sorgente a commit pinnato (mai binari); Termux senza permesso storage (least privilege); blocco WAN opzionale |
| gualt è single point of failure (azioni fisiche per settimane) | media | modalità solo-Grok §2.3 minimizza le azioni manuali; checkpoint asincroni (nessuna fase richiede presenza continua); le azioni fisiche residue sono elencate in §2.3 e schedulabili a blocchi |
| Phantom process killer / OneUI uccide i run | alta senza fix | workaround adb in F1 (OBBLIGATORIO prima di ogni misura) |
| Thermal throttling falsa i confronti | alta | regola ≤32°C start, run brevi, curva F2.4 come riferimento, mai sotto carica |
| Qualità inaccettabile a ~2.5 bpw | media | F4.4/F4.5: UD vs K-quant, upgrade a IQ3_XXS; se anche IQ3 è insufficiente → il valore si sposta sul metodo (comunque pubblicabile) e sul binario A |
| MTP non paga su CPU+flash (H4 falsa) | media | è un esperimento, non una dipendenza: nessuna fase a valle richiede F6 PASS |
| llama.cpp cambia flag/architettura sotto i piedi | certa nel tempo | versioni PINNATE per tutta la campagna; upgrade solo tra fasi, mai dentro una fase |
| Spazio disco insufficiente (128GB) | media | priorità download §4; una quant grande alla volta; pulizia cache HF immediata |
| Numeri da emulatore spacciati per reali | — | VIETATO: emulatore/RunPod solo per build e correttezza, mai nel CSV |

---

## 12. Decision tree sintetico

```
F2: 4B ok? ──no──> sistemare setup (thread/build/termica), NON toccare il 35B
   └─sì─> F3 (misura il muro) ─> F4 (BigMoeOnEdge)
F4: ≥3 tok/s? ──sì──> F5 → F6 → F7 → F8 → (F9, write-up)
   ├─ 1.5-3 ──> F5 → F7/F8 (il predictor è la leva per salire) → F6 dopo
   └─ <1.5 ──> STOP S23: report onesto; target → UFS4-device; prodotto → binario A (LFM2)
F6: MTP paga? ──sì──> resta nella config finale ──no──> documentare e togliere
F7: policy > LRU+5pt? ──sì──> F8 full ──no──> F8 = hardening + write-up del risultato negativo
```

---


## Registro checkpoint (archivio ≤ 2026-08-11)

- **2026-08-11/12 — 🌙 NOTTATA TRIPLA: LiteRT porta-740 chiusa con numeri (PASS
  Gemma ~2.8×, FAIL Qwen 1.5B 0.73× → win GPU size/stack-dependent), Marco
  Fase 1 runtime partita (fail-fast 3/3 PASS), full multi5 ucciso dallo
  shutdown PC alle 02:29 e ripartito in resume alle 08:24.**

  1. **LiteRT F0/F1 su S23 (unplugged)** — `moe-litert-f0-f1.md`: il blocco
     storico era il file `*-gpu.litertlm` (non è il bundle completo per
     Gallery 1.0.18); col bundle ufficiale `gemma-4-E2B-it.litertlm` (2.59 GB)
     GPU **~26.8 tok/s** vs llama-bench CPU size-matched (Llama-3.2-3B Q4_K_M)
     **9.70** → **~2.76×, gate ≥1.15× PASS** (caveat onesti: modelli diversi,
     wall UI incl. prefill, token stimati ×1.3). Poi `moe-litert-qwen.md`:
     **Qwen2.5-1.5B GPU ~18.7 vs CPU twin 25.80 → 0.73× FAIL** (DeepSeek-R1
     distill ~19.6 coerente). Lettura: su 1.5B Q4 il CPU è già a ~26 tok/s,
     headroom GPU nullo; il win LiteRT esiste nella classe E2B/2-3B. Kernel
     no-subgroup nel fork: evidenza empirica positiva ma condizionale a ROI
     prodotto; OpenCL llama vanilla resta NO (K2/K5 intatti).
  2. **Marco Fase 1 runtime** (`results/marco_phase1/PROTOCOL.md` — isola se
     k+drop di campagna trasferiscono su Marco `qwen3moe` SENZA requant;
     gate pre-dichiarati, IT solo v2 moderno). **Fail-fast IT+EN: A1 k8d065
     Δbpb +0.0045/+0.0028, A2 k6d065 +0.0188/+0.0102, A3 k6d050 +0.0089/
     +0.0051 — 3/3 PASS** (soglia +0.05), tutte in coda per full multi5.
     Alle 02:29:46 shutdown/logoff PC: A1 full ucciso a metà fr (en 0.6079,
     es 0.6788 già validi), A2 full morto sul nascere (0xC000026B window
     station shutting down), A3 mai partito. **Resume 08:24 in corso**
     (`resume_marco_phase1_quality.ps1`): completa i mancanti, merge JSON,
     gate full (per-lingua ≤+0.10, macro ≤+0.04), scrive `VERDICT.md` e
     `QUALITY_STATUS.txt` in autonomia. Nota metro: fail-fast en byte-identico
     tra failfast e full (0.607889 = 0.607889) — determinismo confermato.
  3. **Jelly free-tier baseline: BLOCKED** — `moe-jelly-freetier.md`: ping OK
     ma adb/sshd chiusi (wireless debug perso post-reboot, stessa classe di
     incidente del S23 pre-Termux:Boot). Nessuna misura; Qwen3.5-4B Q4_K_M
     (sha `00fe7986…`) staged su PC, checklist resume nel report. Serve mano
     fisica di gualt.

- **2026-08-11 — 🏆 T2c CHIUSO: Marco batte Qwen3.5-4B in 4 lingue su 4 VALIDE
  (EN −0.069, ZH −0.045, ES −0.023, FR −0.024 bpb) — e la quinta riga svela il
  fatto metodologico più grosso della campagna: IL CORPUS PPL DI CAMPAGNA È LA
  DIVINA COMMEDIA. Gate MarcoKEXP: SBLOCCATO (promozione in ENTRAMBI i mercati
  core).**

  Numeri (bpb multi5, `results/trial_marco/ppl_*/`, run PC 8t ctx4096):

  | lingua | Marco | Qwen4B | Δ | verdetto mercato |
  |---|---|---|---|---|
  | EN | 0.6051 | 0.6740 | **−0.069** | Marco stravince |
  | ES | 0.6766 | 0.6994 | −0.023 | Marco vince |
  | FR | 0.7234 | 0.7469 | −0.024 | Marco vince |
  | ZH | 0.8834 | 0.9279 | **−0.045** | Marco stravince |
  | IT | 1.6377 | 1.3686 | +0.269 | **RIGA ANNULLATA — slice invalida** |

  1. **Scoperta (verificata dal coordinatore sui file)**: `multi5/it.txt` è la
     Divina Commedia — e `corpus_subset_10k.txt` (il metro PPL di TUTTA la
     campagna, floor 2.0955 compreso) viene dallo STESSO ebook Gutenberg 1012.
     Le altre 4 slice sono la voce Wikipedia "Caffè" (prosa moderna, simmetrica
     tra modelli → valide). Prova regina: KEXP fa bpb 0.27-0.38 su IT contro
     0.83-0.85 su ZH — Qwen3.6-35B ha Dante MEMORIZZATO. Ecco spiegati i PPL
     di campagna "assurdamente bassi" (1.5-2.1).
  2. **Cosa resta valido**: tutti i confronti INTERNI (IQ2_M vs KEXP, k, drop)
     — stesso modello, stesso testo fisso: la direzione dei verdetti tiene.
     Magnitudini non calibrate su testo difficile (testo memorizzato = regime
     facile). Il floor 2.0955 resta la regola vigente finché gualt non decide
     un corpus v2 (ri-ancorare = ~3 run PPL su PC, niente device).
  3. **Cosa NON è misurato**: l'italiano. Marco-vs-Qwen4B su Dante misura la
     memorizzazione della Commedia (correlata alla scala), non l'italiano
     moderno. Fix pronto e cheap: it.txt v2 = voce Wikipedia "Caffè" IT
     (simmetria perfetta con le altre 4) + re-run IT-only dei 3 modelli su PC.
  4. **Verdetti di gate (regole dichiarate PRIMA dei numeri)**: pivot
     per-mercato (≥1 core tra EN/ZH) → **PASS su entrambi**. E anche il gate
     ORIGINALE severo (macro −0.03 + ≥4/5 lingue) passa sulle 4 slice valide:
     macro-4 Marco 0.722 vs Qwen 0.762 = **−0.040**, 4/4 lingue. In PPL:
     −20% EN, −27% ES, −24% FR, −34% ZH. "Stravincere": sì, fuori dall'IT.
  5. Contesto premium: KEXP k6d065 macro-4 (EN/ES/FR/ZH) 0.678 < Marco 0.722 —
     la gerarchia a due tier (CalaQwen top, Marco veloce-sotto-top) è
     CONFERMATA dai numeri, come da struttura prodotto.

  **Conseguenza**: il download del sorgente Marco per MarcoKEXP è SBLOCCATO
  (era gated su T2c). Jelly: baseline free-tier RINVIATA (reboot, debug
  wireless perso — stesso fix Termux:Boot del S23 quando gualt ha 10 min).

- **2026-08-11 — ⚰️ FIX-SESSION COMPLETA: bug session diagnosticato in una riga,
  conv5 recuperata, e N1 v2 emette l'EPITAFFIO DEFINITIVO della speculazione:
  m = 0.279 s/token marginale (R²=0.9994), m/t1 = 0.38 > 0.3 — il prefill
  scala col prompt, non era (solo) overhead di sessione.**

  Report: `moe-calaqwen-fix-session.md`. (1) Bug: JSONL senza cmd/id/think/close
  + parse sullo stream sbagliato — fixato, smoke n_common=71 PASS. (2) Conv5:
  prefill/turno stabile col contesto che cresce (riuso KV sano); T3 anomala
  (n_prompt 782, ri-serializzazione?) esclusa dalla riga canonica. (3) **N1 v2:
  fit perfetto t=2.02+0.279·n — il costo fisso c'è (~2 s) ma il MARGINALE non
  ammortizza** (regola dichiarata m≤0.3·t1: FAIL). Porta MTP-spec: CHIUSA per
  misura. Nuance a verbale: m/t1=0.38 non è lontano da 0.3 e F domina il ciclo
  — ma eliminarli entrambi = il cantiere verify-integrato che i numeri non
  giustificano. (4) **Energia: correzione −83%** — 0.455 era mal convenzionato;
  stima onesta ~0.05-0.15 J/tok, MA da NON citare come singolo numero fino a
  calibrazione (shunt/carica). Scheda da declassare alla banda.
  ⚠️ Flag aperto: l'INTERA sessione girava 3-4× lenta (prefill ~3 tok/s vs
  10-12, decode 1.4 vs 5.2) — ratio e fit restano validi (stesso regime), ma
  la causa (termica post-conv5? stato device?) non è spiegata: da tenere
  d'occhio alla prossima sessione S23.

- **2026-08-11 — 🧨 L'AUDIT PIÙ IMPORTANTE DELLA CAMPAGNA (shortlist-velocità,
  DeepSeek): il drop NON salta mai il matmul. A (drop-by-weight) e B (top-p)
  archiviate PRIMA di costruirle — non avevano meccanismo. Resta solo C (k=5).**

  Report audit in scratchpad; mandato riscritto v2. I due BLOCKER:
  1. **Meccanismo** (verificato al sorgente dal coordinatore,
     `router_hook.cpp:206-216` + commento esplicito nel codice): lo slot
     droppato viene ripuntato sul top expert e `mul_mat_id` lo calcola comunque
     — il lavoro esperti per token è INVARIANTE al drop. Il drop risparmia solo
     i load dei miss; quel lato è saturo (prova già in casa: d065→d080 = drop%
     ×2, velocità +0.15%). Il +13.6% di k8→k6 era reale perché k cambia `nu`
     (gli slot calcolati) — l'UNICA leva compute fork-legale.
  2. Le "route-trace esistenti" per la simulazione di B sono di IQ2_M k=8 —
     modello sbagliato; la trace KEXP si cattura gratis durante la PPL di C.
  Più: gate assoluti → ratio paired vs control della stessa sessione; pareto
  operativizzata; regola budget Δ0.15 marcata OBSOLETA (vige il floor 2.0955);
  pin completati. **Mea culpa a verbale**: il coordinatore ha ripetuto per tre
  giorni "il drop taglia GEMV" — falso, e il contro-esperimento era nei nostri
  dati dal 10/8. Protocollo audit-prima-di-spendere: 4/4 blocker veri.

- **2026-08-11 — 🚪 DOSSIER PORTA-740 IN COMPOSIZIONE (tesi gualt: kernel custom
  su Adreno vecchi). Due fonti già acquisite, terza (recon Grok) in volo:**
  1. **adreno-llms** (github.com/a8nova/adreno-llms, Apache 2.0, trovato da
     gualt): kernel OpenCL a mano su Adreno **620** — GEMV cooperativo WG=64 +
     riduzione in **local memory** (= niente subgroup broadcast, il killer del
     path llama.cpp sul 740). SmolLM2-135M a 24.4 tok/s decode, ~79% del
     ceiling banda. Regime provato: modelli 135-450M interamente residenti —
     100× sotto il nostro; trasferisce la RICETTA kernel, non il motore.
     È anche un **competitor**: app "Edgi" su Play (NNOpt), multimodale
     on-device fascia media (schedato in memoria prodotto).
  2. **HAQA** (arXiv:2601.03484, testato su OnePlus 11 = 740): **INT8 batte
     INT4 sul 740** (niente INT4 nativo → tassa di unpack) — la lezione
     "formato senza gather" riconfermata su GPU. Regola per eventuali kernel
     740: path a 8 bit.
  3. **Recon arrivata e arbitrata** (`research-adreno740-custom.md`). Verdetto
     tesi: **PARZIALE, con proxy fortissimo** — **ML Drift (Google) misura
     26.8 tok/s di DECODE su Llama-3.2-3B sull'Adreno 740 del S23 Ultra**
     (e 10.7 su un 8B!) con kernel texture-based senza subgroup: ~2.7× il
     nostro CPU baseline, MA fonti/quant diverse (no A/B same-bench). Contro:
     MNN su 750 mostra GPU<CPU anche con engine buono (regime memory-bound);
     driver 0676.73 = capolinea senza root; Vulkan-740 non provato corretto.
     **Raccomandazione della ricerca, condivisa dal coordinatore: NON riaprire
     il fork-kernel; prima il fail-fast F0-F1 da UN GIORNO e ZERO fork —
     installare LiteRT-LM/demo sul S23 e misurare il decode sustained contro
     il nostro llama-bench CPU sullo stesso telefono.** Solo un F1 ≥1.15×
     con margine giustificherebbe lo spike kernel (F3: GEMM local-memory
     no-subgroup nel fork llama, giorni + manutenzione permanente).

  **STATO CAMPI (per ripresa sessione):** S23 → fix-session in volo (recupero
  conv5 TTFT + N1 v2 + energia); PC → trial Marco T2b/T2c in corso (baseline
  k6d065 partita 05:26, Marco multi5 in scrittura) + eventuale build Vulkan
  NDK; Xiaomi → stasera (smoke 15s di gualt + S1; v2 mandato con S0.3-bis);
  in coda su S23: `shortlist-velocita.md` (k=5 → drop-by-weight → top-p,
  pareto). Decisioni aperte di gualt: verdetto Marco a valle di T2c (→
  eventuale MarcoKEXP), GO Fase 1 integrazione Kalsa, nome CalaQwen, ventola.

- **2026-08-11 — 🔬 RICERCA SPEED-PRUNING: nessun free lunch in letteratura —
  "k ridotto + drop-by-weight" (già in faretra) è la scommessa giusta, ceiling
  onesto +7-15%. REAP pod RINVIATO (decisione gualt: +2-4% non paga $50-120).**

  Report: `research-speed-pruning.md` (7 famiglie, Amdahl sui nostri numeri).
  I grandi numeri pubblicati (AdapMoE 1.35×, TEAL 1.8×, ZEDA 1.2×) vivono su
  GPU/offload o richiedono distill/kernel che non abbiamo; trasposti con f=0.4
  il ceiling è +7-15%. ROSSI: merging MC-SMoE, Wanda/sparse senza kernel ARM,
  MoD/LayerSkip (serve training), activation sparsity su IQ2. VERDI: k=5 da
  rimisurare su KEXP (su IQ2_M era morto — fatto nuovo = tesoretto qualità),
  drop-by-weight (drop anche sugli HIT: 3-5× più skip di compute del miss-only
  a hit ~78%), top-p dinamico (con simulazione GRATIS su route-trace prima di
  patchare). Piano B futuro: ZEDA-style distill su RunPod (multi-GPU, giorni).
  Mandato operativo: `shortlist-velocita.md` (C→A→B, regola di PARETO, fork
  patch con G1+re-pin per A/B). In coda dopo fix-session.

- **2026-08-11 — ⚖️ TRIPLO ARBITRATO NOTTURNO (REAP F0 / spike GPU Xiaomi /
  scheda CalaQwen) + interim Jelly. Il filo rosso emerso: TUTTE le strade del
  binario Marco convergono su un solo passo — rifargli il quant con la NOSTRA
  recipe ("MarcoKEXP").**

  1. **REAP F0: VERDE a costo zero** (`moe-reap-multilingua.md`): il GGUF
     community REAP20 (205 esperti) carica, streama e si misura col nostro
     stack — convert+runtime+metro validati senza pod. FASE A pronta e pinnata;
     il pod aspetta il GO di gualt ($40-120).
  2. **Spike GPU Xiaomi: STOP corretto al gate B1** (`moe-spike-gpu-xiaomi.md`)
     — il gate installato dall'audit ha preso ESATTAMENTE la trappola prevista:
     i dense di Marco i1-IQ2_M sono IQ2_S/IQ3_S → l'OpenCL li avrebbe
     silenziosamente lasciati su CPU e S2 avrebbe misurato il nulla. Vulkan:
     build rotta (shaderc coopmat2 cap 5447 — fix: pin shaderc più vecchio).
     S1 pende da uno smoke di 15 s in Termux VERO (SELinux blocca OpenCL sotto
     run-as): servono le mani di gualt. Setup Xiaomi completo e reversibile
     (build OpenCL ok, 4 modelli sha-verificati, -t 6 da cpu_capacity).
  3. **Scheda CalaQwen** (`moe-calaqwen-scheda.md`): decode short ~5.2 / f45
     4.06 confermati da staccato; **cache 2000 confermata** con disegno
     interleaved pulito (C2300 non ha abortito: predizione audit falsificata
     in quella finestra — a verbale); **energia ~0.455 J/token** (≈ 110k token
     per carica, ERA 1.0-1.4 — caveat segno idle da validare). MA: il driver
     nuovo non ha emesso BMOE_DONE in `--session` → conv5 TTFT e TUTTO il
     N1 v2 = NON MISURABILE (0 celle valide). Correttamente NON concluso:
     né riapertura MTP né epitaffio. Fix harness session + re-run B2 in coda.
  4. **Jelly interim** (già a verbale): T3 0.72× ma con hit 34% vs 77% e
     ranking non trasferibile tra profili I/O diversi → sentenza solo su S23.

  **Il filo rosso — "MarcoKEXP"**: il requant di Marco con la recipe di
  campagna (dense→Q4/Q5_K, esperti k-quant, imatrix) risolve TRE blocchi con
  un file solo: qualità (su CalaQwen la recipe valse −27%), velocità CPU
  (g_formato 1.297) e il gate GPU B1 (dense caricabili da OpenCL). Si scrive
  quando il trial PC consegna T2c (Marco vs Qwen3.5-4B, in corso): se Marco
  perde lì, muore tutto il binario e la recipe non serve.

- **2026-08-10 — 📐 DESIGN INTEGRAZIONE KALSA CONSEGNATO (FASE 0, app non
  toccata). Raccomandazione: modulo nativo separato `react-native-bmoe` con shim
  C sopra bmoe_core; le lezioni RescueParty diventano policy di prodotto; nome
  proposto per il modello premium: "Cala" (il porto antico di Palermo — Kalsa è
  il quartiere).**

  Report: `kalsa-integration-design.md` (commit `a05fb24`). Arbitrato: il design
  è ancorato ai fatti VERI dell'app (barriera runNativeOp, ModelDownloader con
  resume, memoryEstimate, gate co-residenza) — non è un design da brochure.
  Punti chiave: (b) modulo separato > patch llama.rn (il tier gratuito resta
  pulito); distribuzione HF gated con sha256 nel catalogo; config di campagna
  hard-coded dove misurata, cache scalata sulla RAM; premium e free MAI
  co-residenti; ThermalMonitor con Android Thermal API (warn 75/pausa 85/stop
  88); UX onesta su edit/regenerate (ri-prefill dichiarato, niente finto
  rollback). Piano a 4 fasi, 8-14 settimane, lab-first; la Fase 2 (prima
  scrittura nell'app) richiede autorizzazione esplicita.
  Nota di portabilità: il design è model-agnostico — se il trial Marco vince,
  cambia il file e il blocco config, non l'architettura.

  Decisioni di gualt sul tavolo: GO Fase 1 (shim+modulo, ~2-4 sett), nome
  (Cala / Marea / Corrente), e a suo tempo l'autorizzazione a scrivere nell'app.

  Nota di coordinamento: Grok ha anche propagato il default A negli harness
  (`8232132`, 41+ script) con aggiornamento della scheda PLAN — anticipato
  rispetto alla coda ma autorizzato da gualt e verificato corretto.

- **2026-08-10 — 🎯 GRIGLIA KEXP COMPLETA: k=6 VIVE (PPL 1.852 ≤ floor) a
  +13.6% di velocità — il "pruning" è arrivato GRATIS e la porta RunPod
  neuron+healing si CHIUDE per superfluità (trigger dichiarato rispettato).
  Proposta default: k=6 drop=0.65 → 5.86 tok/s a qualità MIGLIORE del vecchio
  prodotto.**

  Report: `moe-adopt-kexp.md` (adozione formale KEXP committata `5f03add`,
  41 script migrati). Griglia PPL (floor 2.0955): 4 celle vive su 5 misurate —
  k8d080 1.597, k8d100 1.682, k6d065 1.852, k6d080 1.965; morta solo k6d100
  (2.136). Ordinamenti monotoni e coerenti con la fisica. Velocità staccato:
  k6d065 e k6d080 appaiati (~5.87, Δ0.15%) → regola tie applicata come
  dichiarata → **winner k6d065** (PPL migliore).

  **Il bilancio della conversione qualità→velocità** (vs prodotto IQ2_M di due
  giorni fa): decode 4.4 → **5.86 tok/s (+33%)**, PPL 2.0955 → **1.852
  (MIGLIORE)**, load e prefill invariati. Il tesoretto del KEXP ha pagato due
  volte: metà speso in velocità, e ne avanza (1.852 ≪ 2.0955).

  Flag residuo: il sostenuto n=512 del winner è monco (EOS a 199 su short) —
  rifarlo con prompt lungo nel refresh della scheda prodotto. Nota: il gate
  T3 del trial Marco si alza da solo (comparatore = KEXP al NUOVO default).

  Decisione default (A=k6d065 raccomandata / B=k6d080 / C=status quo): gualt.

  **→ DECISO da gualt (2026-08-10, concordato col coordinatore): OPZIONE A.**
  Default di campagna e prodotto: **KEXP + k=6 + drop 0.65 → 5.86 tok/s,
  PPL 1.852.** Config di campagna aggiornata: `-t 4 -c 4096 --moe-stream
  --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512
  --n-expert-used 6 --drop-cold-experts 0.65` su modello KEXP.
  **Propagato 2026-08-10** negli harness campagna (`f55a_ppl_baseline`,
  `run_staccato`/`2`, `start_f4_5`/`f4_7`, `fix_smoke_and_sostenuto`,
  `retry_adopt_aborted`). Lasciati intatti A/B storici e orchestrator trial
  Marco (in corsa: KEXP multi5 già misurato a k=8 — T3 da riallineare a k6d065
  se il gate usa il comparatore prodotto). Flag aperto: sostenuto lungo del
  nuovo default da rifare nel refresh scheda prodotto.

- **2026-08-10 — 🔭 RICERCA SUCCESSORI: la lista di gualt non regge il criterio
  multilingua (EN/ES/FR/IT/ZH), ma la ricerca ha scovato il dark horse:
  Marco-Mini-Instruct 17.3B-A0.86B (Alibaba AIDC) — 5/5 lingue, Apache 2.0,
  arch `qwen3moe` GIÀ nel submodule, attivo 0.86B = l'unica ipotesi onesta
  verso i 15-20 tok/s.**

  Report: `research-lowactive-moe.md` (rev. multilingua). Verdetti chiave,
  fatto portante ri-verificato dal coordinatore alla fonte (card ATH-MaaS):
  - **Mellum2 (la scommessa di gualt): ROSSO multilingua** — tag HF `en` only,
    code-first per dichiarazione JetBrains, zero eval ES/FR/IT/ZH. Ottimo
    modello, prodotto sbagliato;
  - SenseNova/VAETKI/moondream: veti arch o lingue;
  - LFM2-24B: secondo (4/5 lingue ma IT di 3ª classe, licenza gated $10M,
    A2.3B non basta per 15-20);
  - **Marco-Mini: 17.3B/0.86B (5%), 256 exp/top-8/h=1024, 29 lingue incl. le
    5 prodotto, Apache 2.0, MMLU 83.4 / GSM8K 93.1 / GlobalMMLU 73.3 (batte
    LFM2-24B e Qwen3-4B, verificato)**. Caveat a verbale: ZH presente ma
    profondità sotto Qwen (paper ammette lag CMMLU/C-Eval); zero vision
    (→ costo graft LLaVA-style ~$1k se adottato, visione de-vetata da gualt);
    qualità assoluta vs 35B da misurare.
  - Regola metodologica fissata: **cross-modello si confronta in bits-per-byte
    per lingua, MAI PPL grezze cross-tokenizer**.

  Trial design nel report (T0-T3, gate: macro-bpb ≤ KEXP+0.05, nessuna lingua
  oltre +0.15, decode ≥1.3× KEXP). Mandato: `trial-marco.md`.

- **2026-08-10 — 🚪 PORTA CONDIZIONALE REGISTRATA: neuron pruning degli esperti +
  healing LoRA su RunPod.** Correzione a un mio errore: "non abbiamo infrastruttura
  di training" era FALSO — RunPod è autorizzato e per un healing LoRA di un 35B-A3B
  basta (8×H100, ~$300-600/run, ~$1-3k con iterazioni, 1-2 settimane pipeline
  completa prune→heal→convert→quantize nostra→gate device). **Trigger dichiarato**:
  la porta si apre SOLO se k=6 muore anche su KEXP nella griglia (= il router
  esige 8 esperti → il taglio va fatto DENTRO gli esperti); se k=6 vive, il −25%
  di GEMV è gratis e la porta si chiude per superfluità. k=6 e neuron pruning
  attaccano lo stesso termine (−25% GEMV esperti E −25% I/O): si paga solo se
  la versione gratis fallisce.

- **2026-08-10 — 🏆 1c COMPLETO — IL FILE FABBRICATO IN CASA UMILIA L'ORIGINALE
  SULLA QUALITÀ: PPL 2.0955 → 1.5249 (−27%), e col drop 0.65 acceso (1.5647)
  batte l'IQ2_M liscio di un quarto. Velocità: −3.1% pooled. Dossier a gualt.**

  Report: `moe-requant-1c.md`. Fase B verificata dal coordinatore fino al CSV
  grezzo (somma logprob ricalcolata: −4260.6 vs −7479.9 baseline; stesso corpus
  sha, token_id identici posizione per posizione, stesso binario pinnato).
  Smoke KV rifatto CON --session dopo il mio flag (il primo era invalido):
  PASS. Fase C (A/B ABBA, entrambi a drop 0.65): pooled A 5.116 vs B 4.958
  (−3.1%; per-prompt −0.8% short, −3.9% f45), hit B −3pp (esperti più grossi,
  meno slot: come previsto), sostenuto B 4.275.

  **Predizione mia FALSIFICATA, a verbale**: avevo scritto +5-10% e2e dal
  g_formato=1.297. Il guadagno GEMV è stato mangiato da +I/O e −hit: **il g del
  microbench non è il g del sistema** (lezione gemella di "quale silicio").
  Il premio vero del 1c è arrivato dove non lo cercavo: la qualità — a 2 bpw la
  curva qualità/bit è così ripida che +0.5 bpw sugli esperti + imatrix valgono
  −27% di PPL per +0.9 GB di file.

  **Il gate velocità (+5%) è FAIL per lettera; la riga "qualità gratis → dossier
  a gualt" si applica.** Lettura del coordinatore: −27% PPL per −3% tok/s è un
  affare raro; e sul nuovo file il budget lossy si riazzera (drop 0.65 costa
  +0.040, non +0.104) → la curva drop su KEXP (0.80? 0.90?) può probabilmente
  ricomprare il −3% restando SOTTO la qualità dell'IQ2_M liscio. Raccomandazione:
  adottare KEXP + rifare la curva drop sul nuovo file. Decisione di gualt.

  Nota provenienza (non blocker): possibile revisione pesi più nuova nella
  sorgente Q8 (history HF non verificabile dal fetch); irrilevante per la
  decisione — metro nostro, file pinnato per sha (`kexp.sha256`).

- **2026-08-10 — ⚖️ SCALA SPECULAZIONE COMPLETA: N2 VERDE (draft-mtp α=0.60 live,
  lower bound conservativo), ma N1 ROSSO devastante — C(4)≈10-14 contro gate ≤2.2.
  PORTA CHIUSA PER REGOLA. Con un'anomalia a verbale che merita 30 minuti prima
  dell'epitaffio definitivo. E FASE A del 1c: il file KEXP esiste ed è verificato.**

  Report: `moe-scala-spec.md`, `moe-requant-1c.md`. I tre numeri della scala:
  - **N2 α=0.60** (draft-mtp live, llama-server, target IQ1_M → conservativo),
    mean accept 3.36; draft separati tutti sotto soglia (44-54%) → il self-draft
    MTP era il meccanismo giusto;
  - **N1 C(4)≈10-14 ROSSO** (gate ≤2.2): un prefill corto costa ~2 s contro
    0.154 s/token di decode. La formula e2e dà ~1.5 tok/s contro 4.75 baseline:
    3× PIÙ LENTO. Lo scattering MoE + il costo del prefill corto sul path
    streaming fanno esattamente ciò che la letteratura F6 prediceva;
  - N3 non servito (col MTP vincente il draft non era più su GPU).

  **Verdetto per regola dichiarata: PORTA CHIUSA PER MISURA.**

  **Anomalia d'arbitrato (a verbale, decisione di gualt se indagarla):** il costo
  del batch è quasi INDIPENDENTE da k — C passa da 12.2 (k=2) a 14.3 (k=16):
  +14 token costano solo +2.1 unità → **costo marginale ~0.15 t1/token (6× più
  economico del decode!), ma costo FISSO ~1.9 s per invocazione**. Se quel fisso
  è macchineria di sessione (template/tokenize/commit — rimovibile da
  un'integrazione vera), il gate ha misurato l'overhead del protocollo, non la
  fisica del batch-verify. Se è I/O dell'unione esperti o warmup del path, è
  fisica e l'epitaffio sta. **Una cella di decomposizione da ~30 min** (prefill
  k∈{15,64,256} stesso protocollo → fit fisso+marginale) distingue i due mondi.
  Nota onestà: anche nel caso migliore il cantiere diventerebbe "verify loop
  integrato nella session del fork" — la fascia alta del costo.

  **FASE A 1c — VERDE**: `KEXP.gguf` 12.49 GB, esperti 120/120 Q2_K/Q3_K, dense
  613/613 replicati, sha registrato. Il gate duro post-crash ha già pagato: primo
  resume Q8 corrotto, beccato dallo sha, riscaricato. Recipe fix a verbale
  (ancora `^output\.weight$`). Fasi B (PPL) e C (velocità) aspettano il telefono.
  **Il 1c è ora la porta viva.**

- **2026-08-10 — 🪳 BUCHI 1-2 MISURATI: il meccanismo formato è VERO (+30% su
  silicio nostro) ma il file pronto non esiste; i thread danneggiano; il big core
  throttla a 864 MHz. E si apre la CARICA SULLA PORTA: speculazione eterogenea.**

  Report: `moe-buchi-calcolo.md`. Arbitrato:

  1. **1a**: g_formato = **1.297** (Q2_K 11.03 vs IQ2_XXS 8.50 tg128, 3B denso,
     ABBA pulito) — GO_CONDIZIONATO per regola. Il gather i-quant costa ~30% sul
     nostro 8 Gen 2 (vs 60% su M2-Max: attenuato ma reale).
  2. **1b CHIUSO ALLA RADICE**: il dump per-tensor del `UD-Q2_K_XL` scaricato
     (12.3 GB, sha ok) rivela esperti **tutti i-quant** (IQ2_XS/IQ3_XXS) — il
     "Q2_K" del nome è branding, k-quant solo sul denso. Il candidato non esiste.
     **Lezione**: il dump per-tensor va fatto PRIMA del download (HF espone i
     metadata GGUF da remoto). **Porta 1c possibile** (non mandata): requantizzare
     NOI gli esperti a Q2_K/Q3_K da Q8_0 con `--tensor-type` — il meccanismo vale
     +5-10% e2e, si giudica col metro PPL; COMPONE con la verifica speculativa.
  3. **Buco 2 falsificato al contrario**: t5 **−23%**, t6 **−33%** sul burst —
     più thread danneggiano il decode (coerente con llama.rn). RESTA_4. Dato
     d'oro dal sysfs: sotto carico il big (X3) sta spesso a **864 MHz** — il
     ceiling termico ha un numero, ed è brutale.
  4. Buco 3 (cooling): pronto, serve gualt fisicamente.

  Nota harness: un A2 orfano da doppio harness concorrente è stato scartato con
  quartetto clean dichiarato — corretto.

- **2026-08-10 — 🪳 LA CACCIA AI BUCHI: gualt rifiuta il consolidamento ("trova il
  buco, come un cockroach"). Tre attacchi non convenzionali al muro del calcolo,
  mandato `buchi-calcolo.md`.**

  1. **Il formato, non il kernel**: la ricerca ha stabilito che il GEMV i-quant è
     gather-bound sul codebook; #164 mostra Q2_K_S **1.60×** vs IQ2_XXS su kernel
     MAINLINE (i nostri). Su HF esiste `UD-Q2_K_XL` a 12.29 GB (+7% del nostro).
     Se i suoi esperti sono k-quant, lo speedup si compra cambiando FILE, non
     codice — zero rebuild, stesso binario pinnato. Micro-bench 3B fail-fast
     prima del download grosso. Predizione a verbale: g_formato ≥ 1.4.
  2. **I thread mai sweeppati**: `-t 4` è ereditato dal giorno 1, mai misurato sul
     fork; 3×A510 fermi = perf/watt gratis al ceiling termico, forse.
  3. **Quantificare il ceiling termico**: sostenuto con/senza raffreddamento
     attivo — quanto vale un grado? Se il cooling non cambia nulla, il ceiling
     non è termico ed è una scoperta ancora più grossa.

  Nota di metodo: lo spike kernel "fallito" non è stato inutile — ha prodotto il
  fatto (gather-bound) e l'infrastruttura (harness S1, modelli 3B) che rendono il
  buco 1 un esperimento da 30 minuti.

- **2026-08-09 — ⚖️ SESSIONE STACCATO DOPPIA: 0.65 SOSTITUZIONE RACCOMANDATA
  (+6.9% pooled, −42% byte, termico giù) E capitolo kernel CHIUSO per misura
  (g=0.719: ik è PIÙ LENTO del nostro mainline sul decode, sul nostro silicio).**

  Report: `moe-speed-dropcold-065.md` (commit `cb760d8`) + S1 in `moe-spike-iq2.md`
  (commit `1e0febb`). Batteria 76→63%, floor mai toccato, zero guardrail, pin
  intatto.

  **Gate 0.65**: pooled +6.90%, per-prompt short +9.94% / f45 +0.93% — tutte sopra
  il gate di non-regressione. Banda f45 identica al knee alla cifra (28.59/82.4/
  6.1). KV intatto. Sostenuto: die mediano 68.9 °C, max 76.6 — sotto il 79.8 del
  giro finale a 0.50: l'ipotesi "−42% I/O scalda meno" è compatibile (n=1).
  Il combinato ABORT_MEM ha taciuto su 54/117 tick con memfree<100 MiB e lmkd 0:
  comportamento voluto. Falso positivo `STOP_INCOHERENT_BANDA` dello script:
  buco di specifica del MANDATO (banda knee dichiarata senza "solo twin f45") —
  verdetto umano corretto, colpa del coordinatore, a verbale.

  **Spike S1**: g_IQ2 = 5.855/8.14 = **0.719**, g_IQ3 = 0.805 — regola g<1.20 →
  **NO-GO, capitolo kernel chiuso**. Il 1.42× di ik su M2-Max si è INVERTITO
  sull'8 Gen 2. pp512 3.39× (ik vince sul GEMM/prefill) = sanity: il setup era
  vivo, il divario è reale ma non dove serve. Port plan non scritto, giustamente.

  Con questo, TUTTE le leve di ricerca sul collo del calcolo sono chiuse per
  misura o per fonte: GPU (K2/K5), kernel i-quant (g<1), k (PPL), requant
  (pareggio), speculazione (letteratura+misura). Restano: la decisione 0.65
  (gualt) e l'integrazione prodotto.

- **2026-08-09 — ✅ SPIKE KERNEL S0 COMPLETO (S1 in attesa di staccato). ik_llama
  builda su Termux (3° tentativo: FA on + ALL_QUANTS off), riferimento buildato
  dal NOSTRO submodule out-of-tree, modelli bench IQ2_XXS+IQ3_XXS scaricati e
  sha-verificati. Il numero g che decide il cantiere arriverà da S1.**

  Report: `moe-spike-iq2.md` (commit `46e639d`). Disciplina rispettata: telefono
  in carica a fine S0 → STOP prima dei timing, harness `run_s1_bench.sh` pronto
  (ABBA, cold, guardrail, floor). ik commit `a7c81af`; ref = pin `5236140e5`.
  Fork, binari pinnati e `../ai-chat` non toccati.

  **In coda per la prossima sessione DA STACCATO (ordine deciso):**
  1. `speed-dropcold-065.md` — gate di sostituzione (~45 min, batteria ≥45%);
  2. spike S1 (`run_s1_bench.sh`) — il g dei kernel (~25 min, floor 30%).
  Consiglio operativo: caricare ≥75%, staccare, eseguire in sequenza.

- **2026-08-09 — 🎯 GINOCCHIO TROVATO: F=0.65 è CANDIDATO SOSTITUZIONE del default
  0.50 — ΔPPL +0.104 (≤0.15) per −41.7% di byte/token. Il ginocchio qualità della
  curva sta tra 0.65 e 0.80 (0.80 sfora di 0.024). E il guardrail ABORT_MEM è ora
  combinato (mem<100MiB E die>85°C), testato a secco su 4 casi.**

  Report: `moe-knee-dropcold.md` (commit `fbc6938`; guardrail `74bbb4d`). Regole
  applicate come dichiarate: 0.65 passa la soglia dura −25%, 0.80 archiviato per
  PPL. Curva completa 0→1.00 a verbale, 6 punti misurati.

  **Arbitrato — le due cose da pesare PRIMA della sostituzione:**
  1. **Il budget**: adottare 0.65 spende 0.104 dei 0.15 cumulativi — restano 0.046
     per TUTTE le leve lossy future. 0.50 ne lasciava 0.10. La sostituzione compra
     −31% di traffico incrementale al prezzo di quasi tutto il budget residuo.
     (I kernel i-quant, se arrivano, sono esatti: non toccano il budget.)
  2. **Il metro della decisione**: la campagna si chiama "banda per token" — il
     −42% di byte È il premio (energia, termica, headroom), la velocità è il
     co-beneficio. Quindi il gate velocità per la sostituzione è la
     NON-REGRESSIONE (B ≥ A−2%), non il +5% richiesto per l'adozione di 0.50.
     Mandato: `speed-dropcold-065.md`.

  Nota batteria: floor 30% toccato a 29% sul twin finale — run completati prima
  dello stop del poller, nessun danno; a verbale come graffio, non violazione.

- **2026-08-09 — 🟡 KERNEL I-QUANT: la seconda deep research della giornata dà GIALLO
  — niente cantiere al buio, ma lo spike da 1-3 giorni è giustificato dai numeri.**

  Report: `research-iq2-kernels.md`. Fonte load-bearing (ik_llama #164) ri-verificata
  dal coordinatore: TG IQ2_XXS 8.67→12.28 t/s (**1.42×**) e IQ3_XXS 1.36× a 4 thread
  con `-rtr`; PP 4.75×/5.83×. I quattro fatti che reggono il piano:

  1. il vec_dot IQ2/IQ3 ARM attuale è già NEON+DotProd ma **gather-bound sul
     codebook** — il margine non è "manca la vettorizzazione", è il layout;
  2. **compute-bound confermato dall'aritmetica**: il GEMV esperti implica ~3 GB/s
     su 67 di picco → non siamo al muro DRAM, un kernel migliore PUÒ pagare;
  3. l'angolo nostro: **repack al fill** — lo streamer controlla `read_slice`,
     l'hit 77-87% ammortizza la trasformazione, le shape sono %4=0;
  4. soffitto onesto e2e: **+10-15% decode** (Amdahl f≈0.4, g=1.3-1.4), il 4.7×
     del PP è prefill e non va venduto come decode.

  Costi a verbale: cherry-pick mainline = zero da cogliere (quants.c byte-identico
  al nostro); port selettivo ik = 4-10 p-settimane; ex-novo = escluso. Gate 8/8
  byte-identico si romperà coi kernel nuovi (ordine di accumulo): da ri-baselinare
  come decisione esplicita, non bug — il metro diventa la PPL decode-path (kernel
  esatto → budget lossy NON consumato). Mandato spike scritto:
  `spike-iq2-kernels.md`, decide g misurato sul nostro silicio.

- **2026-08-09 — 🔴 GPU ADRENO RITIRATA SENZA SPENDERE UN GIORNO DI SPIKE: la deep
  research ha ucciso il candidato in poche ore. K2: le ops del nostro modello ibrido
  (GATED_DELTA_NET, SSM_SCAN) non esistono sul backend OpenCL. K5: su un S23 identico
  il decode OpenCL è già stato misurato PIÙ LENTO del CPU.**

  Report: `research-adreno-opencl.md` (Grok via cheap-agents, primo mandato lanciato
  dal coordinatore in autonomia). Le due fonti load-bearing ri-verificate dal
  coordinatore alla fonte primaria (ops.md e discussion #22791): numeri identici alla
  cifra. Aritmetica corretta: con f=0.25 offloadabile e GPU a 0.8× del CPU, lo split
  sarebbe una REGRESSIONE (S≈0.93). Il +30-50% del PLAN era costruito sull'ipotesi
  "GPU più veloce sul 50% dense" — falsa su entrambi i fattori.

  Valore residuo della ricerca: (a) K1 — dense = Q5_K/Q6_K, mai servirebbe requant;
  (b) criteri di riapertura precisi (GDN+SSM upstream + driver subgroup + tg>CPU
  pubblicato su 740); (c) PowerInfer-2 resta chiuso, NPU HTP non carica pesi;
  (d) lo spike vanilla S0-S2 proposto dal report NON vale 1.5 giorni: replicherebbe
  #22791 sullo stesso identico hardware/driver. Morto per fonte, non per pigrizia.

  Candidati rimasti per l'esperimento serio: integrazione Kalsa (ingegneria, ROI
  chiaro) o kernel IQ2 a mano (unica ricerca rimasta sul collo del calcolo).

  **Addendum (verifica su device, adb read-only):** il NOSTRO S23 monta esattamente
  il driver della misura lenta — `Adreno 740, OpenGL ES 3.2 V@0676.73` (build
  30/05/2025, GIT dc3d4da3a2). K5 vale alla lettera sul nostro hardware, non per
  analogia. Il driver è nel vendor partition (proprietario Qualcomm, aggiornato solo
  da Samsung via firmware): non patchabile da noi su device stock. Da ricontrollare
  la versione a ogni OneUI update (criterio di riapertura).

- **2026-08-09 — ✅ ADOZIONE OPERATIVA + SCHEDA PRODOTTO DEFINITIVA. Tutti gli
  invarianti tenuti: il drop non tocca load né riuso KV. La scheda, col default
  completo:** load cold **9.96 s** · prefill T5 **9.34 s** (n_common 1387, riuso
  pieno) · decode **~4.44/4.46 tok/s** (short/f45, in banda B, mai sotto banda A) ·
  sostenuto **4.35 tok/s** a die max **79.8 °C**.

  Report: `moe-adopt-dropcold.md`. Parte 1: flag nei 5 harness con config di
  campagna (commit `82c8993`), A/B e bench parametrici lasciati intatti di
  proposito — corretto. Parser load del 1° giro buggato (wall≠load), scartato dal
  bravo esecutore; numeri da stdout del binario.

  **Arbitrato sull'incidente della sessione — 3 ABORT_MEM "false-positive":**
  il guardrail MemFree<100 MiB/10 s (istituito dopo RescueParty) ha ucciso 3 run
  citabili; il retry li ha chiusi SENZA mem-kill (solo HARD 98 °C). Esito benigno
  (die max 91.2, zero incidenti), ma due cose a verbale:
  1. la lettura è giusta: memfree_min 13–52 MiB è lo stato NORMALE di questo
     workload (tutti i run citabili della campagna ci vivono). La firma RescueParty
     era mem ≪100 **E** die 88-92 sostenuti per minuti — la soglia solo-memoria non
     separa il normale dal morente;
  2. però disattivare un guardrail a caldo è una decisione da mandato, non da
     retry. Andata bene, non è il protocollo. → **Ricalibrazione da fare**:
     ABORT_MEM diventa condizione COMBINATA (MemFree<100 MiB sostenuto E die>85 °C
     sostenuto), THERMAL_PAUSE 88/60s invariato. Micro-modifica a
     `lib_guardrails.sh`, nel prossimo mandato.

- **2026-08-09 — 🏁 ADOTTATO da gualt: `--drop-cold-experts 0.50` entra nella config
  di campagna e prodotto. Prima leva lossy adottata nella storia della campagna.**

  Costo/beneficio a verbale: ΔPPL +0.051 (su soglia 0.15) per +3-4% decode (numero
  prudente per-prompt; pooled +6.52%) e −10.6% MiB/tok. Nessun rebuild, nessun
  re-pin: il flag è runtime, binario resta `1ca51420…`.

  **Regola fissata all'adozione — budget PPL CUMULATIVO:** la soglia 0.15 si misura
  sulla PPL totale contro la baseline originale (2.0955 decode-path, subset 10k),
  non incrementale per leva. Spesi 0.051, restano ~0.10 per tutte le leve lossy
  future messe insieme.

  Config di campagna completa post-adozione: `-t 4 -c 4096 --moe-stream --cache-mb
  2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 8
  --drop-cold-experts 0.50` (+ `--temp 0 --chatml --no-think` lato prompt).
  Mandato di esecuzione: `adopt-dropcold.md` (config negli harness + giro finale di
  misure di prodotto col default completo).

- **2026-08-09 — ✅ VELOCITÀ DA STACCATO: drop-cold 0.50 passa anche la soglia +5%
  (mediana pooled +6.52%) — CANDIDATO ADOZIONE, decisione a gualt.**

  Report: `moe-speed-dropcold.md`. ABBA cold-per-run, 2 prompt × 2 rep × 2 bracci,
  UNPLUGGED 100→93%, lmkd 0, guardrail 0. Triangolo di coerenza col report qualità
  perfetto: MiB/tok e hit% f45 identici alla cifra (49.05/41.23, 77.0/79.0), drop
  2.1% vs 2.2 atteso. Smoke KV col flag ON: n_past=71 intatto (drop decode-only).

  **Nota d'arbitrato (a verbale, onestà prima del tifo):** la regola dichiarata era
  la mediana pooled dei 4 run — rispettata, +6.52%, verdetto valido. Ma la vista
  per-prompt dice: short +3.9% (4.584→4.761), f45 +2.4% (4.293→4.398). L'effetto
  vero è probabilmente **+3-4%**, non +6.5%: il pooling mescola le distribuzioni dei
  due prompt e gonfia il Δ. La regola è la regola (vale nei due sensi: ha ucciso
  F=1.00 col −79% di byte, promuove questo), ma chi legge il verbale deve sapere
  che il numero prudente è +3-4% con −10.6% MiB/tok reali. Il giro finale di misure
  di prodotto farà da conferma naturale.

  **Watch item:** die max 91.6 °C sui run veloci e sul sostenuto B (streak <60s,
  nessun pause) — con drop attivo si va più veloci e quindi più caldi; è la zona
  della firma RescueParty. I guardrail hanno retto, ma il sostenuto lungo con
  batteria bassa resta il caso da non spingere.

- **2026-08-09 — 🎯 PRIMO CANDIDATO LOSSY DELLA CAMPAGNA: `--drop-cold-experts 0.50` —
  ΔPPL +0.051 (≪ 0.15) con −15.9% di byte/token. Dopo che k5/k6/k4 sono morte tutte,
  la risposta a "se non è k, cos'è" è: drop-cold. Tagliare per COSTO (miss di cache +
  marginale nel router) paga meno qualità per byte che tagliare per RANGO.**

  Report: `moe-dropcold.md`. Mandato `scorer-gate-dropcold.md` COMPLETE, regole
  applicate esattamente come dichiarate.

  1. **Semantica (PASSO 0, dal sorgente)**: `thr = F/k`; un esperto del top-k viene
     droppato solo se (a) non è il top-weighted, (b) è cache MISS, (c) peso router
     < thr. Residenti mai droppati, top expert sempre pinned, decode-only. È
     esattamente "salta i miss leggeri": lossy ma cache-aware.
  2. **G1 8/8 byte-identici** (scorer off, path `-p`). **G2 PASS**: `--ppl-decode` su
     device, subset 10k posizioni, ΔPPL −0.0173 vs baseline prefill (tolleranza 0.02).
     Nota: max|Δlogprob| per-token 11.1 (path GDN ibrido, atteso e dichiarato) — il
     gate è sulla PPL di subset, non per-token.
  3. **Re-pin**: CAMPAIGN `cab20432…` (DENSE2) → **`1ca51420…`** (SCORER, base
     `d408e03`). Smoke KV post-pin: `n_common=71`, turno 2 = 41 token. PREFAULT
     intatto.
  4. **Sweep, curva completa a verbale** (baseline twin 49.05 MiB/tok, hit 77.0%):
     | F | ΔPPL | Δbyte | verdetto |
     |---|---|---|---|
     | 0.25 | +0.011 | −4.1% | archiviato: quasi inerte (26 drop su 64k) |
     | **0.50** | **+0.051** | **−15.9%** | **CANDIDATO** (hit 79.0%, drop 2.2%) |
     | 1.00 | +0.261 | −78.8% | archiviato: la soglia è la soglia |
     F=1.00 è la forma della curva: i byte collassano (−79%, hit 87%) ma la qualità
     rompe il metro (+0.26). Il ginocchio utile sta tra 0.50 e 1.00 — non esplorato,
     0.50 basta come candidato.
  5. Tutto in carica = tutto deterministico, zero timing citati. **Nessuna adozione:
     il candidato F=0.50 passa dal test velocità da staccato (mandato a parte).**

- **2026-08-09 — ✅ NOTTE PERFETTA: celle 3-4 chiuse, cache incorniciata da entrambi i
  lati (2000 è IL numero), ubatch 2048 morto, plateau ~4 tok/s, scorer decode-path pronto
  con Δ=0. Zero incidenti, zero guardrail, floor rispettato.**

  Report: `moe-notte9.md` (+ `moe-misure-staccato-3.md`, `moe-notte9-a.md`,
  `moe-notte9-b.md`). Commit scorer verificato su tree PC (`d408e03`, +174/−15).

  1. **Cella 3 — ubatch 2048 RIGETTATO, ed era pure più lento**: prefill 9.8 vs 11.6
     tok/s mediani (−15.5%), buffer 4× più pesante. Non "non abbastanza meglio": peggio
     su tutto. **512 chiuso come config di campagna e prodotto.**
  2. **Cella 4 — il numero di sostenuta per la scheda prodotto: ~3.6-4.2 tok/s su 512
     token** (mediana eval 4.00), die ~68 °C in decode, max 81.8, nessun throttling hard.
  3. **Cache-down C1500: −15% → `MIN_SANE_2000`**, C1000 skipped per regola. Con la
     Cella 2 (3000/3500: −62/−68%) la curva è incorniciata da entrambi i lati: **2000 non
     è un default, è un ottimo misurato**. L'headroom per l'app non si compra dalla
     cache.
  4. **Scorer `--ppl-decode` (Binario B, PC)**: percorre il testo nel decode streamato
     vero e registra i logprob del token gold. Smoke host: **Δ=0 esatto** vs prefill a
     ubatch=1 (56 posizioni, somme identiche alla 8ª cifra). Gate device preparato e NON
     eseguito (serve rebuild Android + re-pin, decisione di gualt). Nota tecnica dal
     confronto: prefill largo vs decode differiscono per la memoria ibrida GDN — un
     motivo IN PIÙ per cui il metro delle leve runtime deve essere il decode-path.
  5. Batteria 56→41%, mai sotto floor; `screen_off_timeout` ripristinato; nessun riavvio;
     guardrail 0 scatti (streak massimo die>88: 15.5 s su 60 di hold — calibrazione
     giusta).

  Decisioni sul tavolo di gualt: (a) conferma 512+2000 (di fatto già campagna → CHIUSI);
  (b) go al rebuild+re-pin con scorer per aprire finalmente lo sweep
  `--drop-cold-experts` — la prima leva lossy giudicabile col metro giusto.

- **2026-08-09 — ✅ INDAGINE CHIUSA: non era il kernel, era ANDROID che staccava la spina.
  `reboot,rescueparty` — il framework ha eutanasizzato un sistema in thrashing. STOP
  revocato da gualt: celle 3-4 ripartite con i guardrail attivi.**

  Report: `reports/moe-reboot2.md`. La catena completa, ricostruita dal dropbox:

  1. ~20:34 — C3500 in thrashing: bmoe a 136-160% CPU, **kswapd0 al 90%**, PSI memoria
     78%, major fault ~379k. Le app di sistema muoiono di fame: ANR di
     `com.android.phone` e `systemui`;
  2. 20:34:33 — **`system_server_crash`: "Lost network stack"** → ecco perché ssh e adb
     sono caduti alle 20:47: la rete è morta 15 minuti PRIMA del riavvio;
  3. 20:35 e 20:45 — due `SYSTEM_RESTART` (escalation);
  4. 20:51 — **RescueParty riavvia il device**: `reboot,rescueparty`, suffisso `RP`.

  **Classificazione**: SOFTWARE (recovery del framework), operativamente **RIPRODUCIBILE**
  sotto la firma die 88-93 °C sostenuti + MemFree ≪100 MiB. Il riavvio #1 (15:21) resta a
  firma diversa (`reboot` nudo, `_KP`) ma stessa famiglia operativa. La causa kernel
  esatta di #1 resta aperta — e non serve: la mitigazione è identica, **non restare in
  quel regime**.

  Fatti anche: `screen_off_timeout` ripristinato (1800000, verificato), pull integrale di
  staccato2 nel repo (flight.log completo: die max 92.8 °C, 28 sample sopra 88, MemFree
  min 14.0 MiB), guardrail in `scripts/lib_guardrails.sh` cablati in entrambi gli harness
  (PAUSE_THERMAL 88 °C/60 s con resume a 80, ABORT_MEM <100 MiB/10 s, HARD_STOP 98
  legacy) — il vecchio MEM_ABORT (25 MiB ×4 sample, solo cache≥3000) era troppo tardi.

  Lezione da incidere: su Android il limite non è il kernel panic — è **RescueParty**: se
  affami system_server abbastanza a lungo, il sistema si riavvia "da solo" con un reason
  che non nomina né thermal né OOM. Senza il flight recorder e il dropbox avremmo dato la
  colpa al hardware.

- **2026-08-09 — 🔴 SECONDO RIAVVIO INSPIEGATO (20:52 di ieri, durante C3500): scatta la
  regola — CAMPAGNA IN STOP finché l'indagine non chiude. E stavolta abbiamo la
  testimonianza: die ~90 °C sostenuti + memfree 14 MiB al momento della morte.**

  Il telefono è andato "offline" alle 20:47 durante la parte 2 delle misure: non era la
  rete — **si è riavviato** (boot ~20:52, verificato via uptime stamattina). È il secondo
  evento in 6 ore, entrambi sotto pressione estrema:

  | | riavvio 1 (15:21) | riavvio 2 (20:52) |
  |---|---|---|
  | contesto | suite G-K3, load ripetuti | C3500 f45, thrashing |
  | die | ~90-92 °C (fasi di load) | 88-90 °C sostenuti (flight recorder) |
  | memoria | pressione da load | **memfree 14-18 MiB** per minuti |
  | ultima evidenza | — | 20:50:46: die 90→72 °C, memfree 14 MiB→**4.8 GiB** (processo morto/ucciso), poi giù il sistema |
  | boot.reason | `reboot` (dropbox `_KP` senza stack) | da catturare via adb (ssh non ha i permessi) |

  **Firma comune: ~90 °C sostenuti + carenza estrema di memoria.** Il nostro HARD STOP a
  98 °C non è mai scattato — il telefono muore prima, a ~90: il guardrail era calibrato
  su una soglia che la realtà non rispetta. Il flight recorder (introdotto dopo il primo
  riavvio) ha ripagato subito: senza, staremmo di nuovo a indovinare.

  Conseguenze operative (mandato `mandates/indagine-riavvio-2.md`):
  1. evidenze via adb per ENTRAMBI gli eventi (boot.reason.history li contiene tutti e
     due) + dropbox, salvate a verbale;
  2. ripristino `screen_off_timeout=1800000` (pendente dalla parte 2) + pull artefatti;
  3. **guardrail ricalibrati nell'harness**: die >88 °C sostenuti per 60 s → pausa fino a
     <80; memfree <100 MiB sostenuti → abort cella con ABORT_MEM esplicito. La lezione:
     i run che il telefono non regge vanno interrotti dall'harness, non dal kernel;
  4. campagna FERMA finché 1-3 non sono chiusi. Nota: C3500 era già respinta nei numeri
     (−68% tok/s) — il regime che uccide il telefono è anche un regime che non ci serve.

- **2026-08-08 — 🏆🏆 IL NUMERO DEL PRODOTTO, MISURATO: turno 5 da 165 s a ~9 s di
  prefill (−94%), da staccato, partenza fredda, conversazione vera. E la causa della
  mezza-suite persa non è un reset: è il timeout schermo.**

  Cella 1 di `misure-staccato` COMPLETA (2 rep, prompt F5.1 con sha a verbale,
  `bin_sha256=cab20432…` in ogni riga):

  | turno | n_common | n_prompt | prefill_s (r1/r2) | tok/s (r1/r2) |
  |---|---:|---:|---|---|
  | 1 | 0 | 97 | 9.0 / 10.8 | 4.51 / 3.39 |
  | 2 | 353 | 87 | 8.9 / 10.5 | 3.88 / 3.16 |
  | 3 | 696 | 88 | 10.2 / 11.8 | 3.51 / 3.24 |
  | 4 | 1040 | 92 | 11.0 / 12.4 | 3.48 / 3.24 |
  | **5** | **1388** | **70** | **8.9 / 9.8** | 3.43 / 3.08 |

  Il riuso scala: ogni turno prefilla SOLO il nuovo messaggio, `n_common` cresce fino a
  1388. Load freddo sul campo: 9.2/10.5 s (DENSE2). Decode cala 4.5→3.1 tok/s col
  crescere di `n_past` e col die a ~79 °C in decode — il costo dell'attenzione più il
  termico, tutto atteso. Storico da battere: 165 s (F5.1). **Battuto: −94%.**

  **Le celle 2-3-4 sono perse, e NON per un reset** (uptime continuo dalle 15:21, gualt
  aveva temuto un secondo riavvio — smentito): sessione partita 19:03, timeout schermo 30
  min scaduto alle 19:33 esatte → Samsung declassa Termux dal cpuset top-app → `nproc=3`
  → preflight FATAL e celle saltate. Due lezioni di processo:
  1. **il timeout schermo è un limite di sessione**: le suite da staccato devono tenere
     lo schermo acceso oltre i 30 min (screen_off_timeout alzato via adb per la durata,
     poi ripristinato) o promuovere Termux periodicamente;
  2. **bug dell'harness**: STATUS con `rc=0` e "winner 2000/512" che sono DEFAULT senza
     dati — una chiusura che mente. Una cella saltata deve produrre SKIPPED esplicito e
     rc≠0, mai un winner di default.

  Rimedio: `mandates/misure-staccato-2.md` (solo celle 2-3-4, schermo gestito, preflight
  che aspetta invece di saltare, STATUS onesto). Batteria al 90%: margine per la parte 2.

- **2026-08-08 — ✅ DENSE2 ADOTTATO (CAMPAIGN = `cab20432…`) e residuo CHIUSO PER
  ESPERIMENTO: il reclaim è DURANTE il warm-up, il riordino non avrebbe recuperato nulla.**

  Report: `reports/moe-adopt-dense2.md`. Re-pin `ede3ac7c… → cab20432…` con doppio smoke:
  (a) due-turni KV sul pin nuovo → `n_common=71`, `n_prompt=41` (il fix KV è nella base,
  provato); (b) firma DENSE2 in stderr (`dense-anon: memcpy=…`, `expert-mmap: dropped …`).
  KVFIX/DIAG2/KVCTRL rimossi, PREFAULT intatto.

  **L'esperimento da 10 minuti ha chiuso la domanda**: mincore sulle range dense a fine
  capture warm-up (prima di rebind/drop/conversione) = **899/1664 MiB** — e nello stesso
  run la conversione ha copiato 900 MiB. Perfettamente allineati: fra fine warm-up e
  conversione **non si perde nulla**; la metà mancante sparisce durante il warm-up stesso
  (pressione di memoria mentre si decode-a per il capture). Nessun riordino
  drop/conversione può recuperare pagine già assenti a fine warm-up → **residuo chiuso
  definitivamente, nessun mandato di riordino**. Terza vittoria del metodo
  "esperimento-prima-della-narrativa": stavolta l'esperimento ha ucciso il fix *prima* di
  scriverlo, costo 10 minuti invece di un mandato intero.

  Verifica ssh indipendente del pin rimandata a fine sessione misure (in volo): non si
  tocca il telefono durante le celle di timing.

- **2026-08-08 — 🟡 DENSE2: PARZIALE onesto. Metà del dense si copia gratis, l'altra metà
  non è più residente quando serve. Comunque strettamente meglio su ogni asse misurato.**

  Report: `reports/moe-dense2.md`, commit `f907200` (memcpy con piano `mincore`
  page-by-page, fallback O_DIRECT per-range) + `313cde9` (drop mmap esperti post-rebind).
  Verificato dal coordinatore: commit su tree PC, VERDICT coerente, strumentazione per-run.

  - **G-D1 8/8 PASS** — i buchi O_DIRECT riempiono lo stesso buffer: byte-identità piena.
  - **G-D2 PARZIALE per la regola dichiarata** (soglia PASS: Δ≥1.3 GiB): Δread_bytes
    **−0.81 GiB** (10.18→9.37), rchar **dimezzato** (1.66→0.84, allineato al volume
    memcpy), VmHWM **−321 MiB**. Flight recorder attivo per tutta la suite: 260 righe,
    nessun boot, die mai oltre ~42 °C fuori load.
  - **La diagnosi del perché**: `memcpy≈815 MiB` su 1664 di trunk — al momento del piano
    `mincore`, ~metà delle pagine dense è già stata reclaimata (pressione durante il load:
    memfree a decine di MiB in volo). Il fix non può copiare pagine che non ci sono più;
    il fallback per-range fa esattamente il suo lavoro (~670 range a O_DIRECT).
  - **Pezzo 2 come da attese**: `dropped 9313 MiB` di range esperto orfane, VmHWM giù.
  - **Nessuna regola violata**: l'esecutore non ha proposto l'adozione (la soglia non era
    raggiunta) e ha riportato la diagnosi invece di forzare. Da manuale.

  **Raccomandazione del coordinatore a gualt: ADOTTARE comunque DENSE2** — la soglia 1.3
  era il criterio di *auto-proposta*, non un divieto: il binario domina strettamente
  CAMPAIGN su ogni asse (−0.81 GiB I/O, −0.82 rchar, −321 MiB VmHWM, identità 8/8 provata,
  strumentazione permanente in più). Il residuo (~0.85 GiB) resta sul tavolo come
  follow-up opzionale, che parte da un esperimento da 10 minuti, non da una teoria: uno
  snapshot `mincore` del dense a fine warm-up. Se la metà mancante è già sparita LÌ, il
  riordino della conversione non recupererebbe nulla → si chiude; se è ancora residente,
  spostare la conversione prima della pressione la recupera → si fa.

- **2026-08-08 — ✅ CAMPAGNA KV CHIUSA E ADOTTATA: G-K3 8/8 sul path `-p`, CAMPAIGN
  re-pinnato al fix (`ede3ac7c…`), riavvio classificato UMANO/SOFTWARE con domanda aperta.**

  Report: `reports/moe-kv-close.md`. Verifica indipendente del coordinatore via ssh:
  `bmoe-cli.CAMPAIGN` sha = `ede3ac7c…` = KVFIX = `CAMPAIGN.sha256`, binario read-only,
  `KVCTRL`/`DIAG` rimossi, `nproc=6` in shell fresca (ripristino cpuset persistente).

  - **G-K3 8/8 PASS sul path `-p`** — come previsto dall'arbitrato: sul path dei
    riferimenti il codice multi-turno non esegue nemmeno; la divergenza vista sul path
    `--session` era il delta di 3 token pre-esistente, non il fix. `n_prompt` tornati in
    stile F5.5-B (f45_1=121). Nessuna regressione single-turn.
  - **Smoke post-pin PASS**: due-turni col binario pinnato → `n_common=71`, `n_prompt=41`.
    Il binario di campagna è quello col fix, provato, non presunto.
  - **Riavvio delle 15:21 — RICLASSIFICATO (risposta di gualt: non è stato lui, era
    fuori casa)**: `boot.reason = reboot` senza `shell`/`userrequested`, dropbox
    `LAST_KMSG_KP` (convenzione Samsung per kernel panic) senza stack recuperabile,
    pstore inaccessibile senza root. Classe finale: **INSPIEGATO, sospetto kernel panic
    sotto carico** — avvenuto a metà suite (4 thread, streaming O_DIRECT, in carica,
    die ~90 °C nelle fasi di load). Un solo evento non fa una causa, ma da ora:
    (a) ogni suite gira con un **flight recorder** su flash (timestamp, die °C, memfree,
    batteria, fsync per riga) così l'ultima riga prima di un boot inatteso dice lo stato
    alla morte; (b) a ogni boot inatteso rilevato, PRIMA di ogni altra cosa si cattura
    `persist.sys.boot.reason.history` + lista dropbox; (c) un **secondo** riavvio
    inspiegato = STOP campagna e indagine dedicata. Nota a favore: il fix del loader ha
    già tolto metà dell'I/O (e del calore) proprio dalla fase incriminata, e dense2 ne
    toglierà altro.
  - `ALLOW_UNPINNED=1` usato solo per il G-K3 su KVFIX pre-pin (gate, non misura),
    annotato nei meta. Lo smoke post-pin è passato dal pin normale.

  **La parte "righello + fix di prodotto" è chiusa.** In un solo giorno: loader −51% di
  I/O al load, prefill incrementale (165→~10 s attesi al turno 5), binario pinnato con sha
  in ogni riga di CSV, meter PPL operativo. Si apre la fase di spinta: dense double-pass →
  misure da staccato → scorer decode-path.

- **2026-08-08 — ⚰️ F6 (DFlash draft esterno) CHIUSO senza spendere il porting. Evidenza
  esterna + la nostra misura convergono: la speculazione su CPU non paga.**

  L'altra sessione Claude su Kalsa (`ai-chat`, CI emulatore) ha misurato con un A/B a tre
  bracci (BASELINE / MTP / DFlash, assert fail-closed, braccio dflash verificato davvero
  dflash dopo il fix `9015f14`) che **MTP e DFlash PEGGIORANO la velocità su CPU** anche su
  Qwen3.5-4B denso — il caso *facile*: niente streaming, solo compute.

  Trasferimento al nostro caso, ed è peggio su tutti e tre i termini:
  1. su CPU la verifica di k token costa ~k× il compute di un token (niente amortamento
     GPU-style del batch) — è la ragione per cui perde anche sul denso;
  2. da noi il compute è già il collo (expert GEMM 50.5%, ceiling 7.8 tok/s) e scala con k;
  3. l'unica speranza era l'ammortamento dei BYTE (esperti condivisi fra token consecutivi)
     — e l'abbiamo **già misurata: 0.00%** sul nostro trace (miss@t ∧ miss@t+1, F5).

  Il gate dichiarato per F6 era ≥+15% tok/s con ≤2× i byte: con questi tre termini contro,
  è irraggiungibile. **Decisione: F6 va nella tabella CHIUSO** — si riapre solo con un fatto
  nuovo di regime (es. verifica offloadata su NPU/GPU). *Addendum stesso giorno*: la
  letteratura conferma su tre fronti indipendenti (roofline CPU compute-bound: Nightjar,
  OpenInfer; design GPU-native di DFlash: NVIDIA; expert scattering nei MoE: MoE-SpeQ,
  EcoSpec) — e delimita il confine: su CPU la speculazione PUÒ vincere (denso 3B
  memory-bound, 1.72×) ma serve memory-bound + acceptance ≥60% + niente scattering; noi
  falliamo tutte e tre. Nota completa con fonti e **criteri di riapertura**:
  `reports/research/speculative-cpu-literature.md`. Risparmiato: il plumbing del draft
  esterno nel fork (ctx_dft da modello separato), che era il lavoro più grosso in coda.

  Nota di convergenza: la stessa sessione ha appena spedito la **persistenza KV di sessione**
  nell'app (`7d34747`, llama.rn) — lo stesso insight del nostro fix KV, trovato due volte
  indipendentemente. Il multi-turno senza ri-prefill è LA feature, su entrambi gli stack.

  Piano di spinta aggiornato (dopo `close-kv-campaign`):
  1. **dense double-pass** (chiude E1 sotto gli 8 GiB);
  2. **sessione di misure da staccato** (cache 3000/3500, ubatch speed, plateau sostenuto);
  3. **scorer PPL decode-path + sweep `--drop-cold-experts`** — al posto di DFlash: l'unica
     leva lossy rimasta con un metro per giudicarla (il meter teacher-forced non la vede,
     serve lo scorer nel decode).

- **2026-08-08 — 🏆 IL FIX KV FUNZIONA: `n_common=71`, prefill t2 da 12 a 4.2 s, testo
  byte-identico col riuso. G-K3 resta aperto per un riavvio del telefono, e NON è una
  regressione del fix.**

  Report: `reports/moe-kv-reuse-fix.md`, commit fork `2c675a5` (verificato sul tree PC:
  22 righe, solo session.cpp). Arbitrato:

  - **Il fix ha DUE pezzi, non uno** — e la nota di esecuzione lo prova: la sola history
    grezza ha dato ancora `n_common=0`. Il template Qwen del GGUF **scarta** `<think>` sugli
    assistant passati salvo `preserve_thinking`; con `--no-think` lo span vuoto sta nel
    *generation prompt* (quindi in `kv_tokens`), non nello stream generato. Serviva anche
    `chat_template_kwargs["preserve_thinking"]="true"` al render.
  - **G-K1 PASS**: t2 `n_prompt=41`, `n_common=71`, prefill 4.23 s (prima: 108 / 0 / 11.95).
  - **G-K2 PASS — la prova regina**: `KVCTRL` (stesso albero, `n_common` forzato a 0,
    `n_prompt=112` = il 108+4 predetto dalla diagnosi) produce **lo stesso identico testo**
    (sha `5590b1ee…`) in 10.68 s contro 4.23. Il riuso non corrompe il contesto.
  - **G-K3 PARZIALE, declassato a problema di harness**: `f45_1` diverge dai ref F5.5-B
    (`6c45cb91` vs `2424179f`) ma **KVFIX ≡ CAMPAIGN byte-identici sullo stesso harness** —
    il path `--session` rende `n_prompt=124` contro i 121 del path `-p` dei ref, differenza
    di 3 token **pre-esistente sul binario pinnato**. Non è il commit. La suite va chiusa
    rilanciando gli 8/8 sul path `-p` (quello dei ref), dove il codice modificato non
    esegue nemmeno (nessuna history al primo turno).
  - **Il telefono si è RIAVVIATO a metà suite** (uptime 3 min, cpuset degradato a 0-2,
    `nproc=3`). Causa non indagata. Prima di qualunque altra misura: ripristino cpuset e
    setup standard. I run post-reboot valgono solo come A/B interni (stesso stato per
    entrambi i bracci), mai contro riferimenti.
  - **Bonus, e va inciso nella pietra**: dal log di load, arch `qwen35moe` con tensori
    SSM/Mamba (`ssm_d_state=128`, `n_swa=0`) → **memoria ibrida attention+ricorrente**.
    Il `seq_rm` parziale rifiuta perché lo stato ricorrente non si ritaglia: **su questo
    modello il rollback parziale della KV è impossibile per costruzione** — vale per
    sempre (edit/regenerate = ri-prefill completo). Col fix, il caso append-only non ne ha
    più bisogno.
  - **Nota di scope**: `preserve_thinking=true` è incondizionato nel path chat → con
    thinking reale i reasoning passati resterebbero nei re-render (cambio di semantica
    oltre lo scope dichiarato). Oggi impatto nullo (si spedisce no-think); da ricordare se
    mai si riattiva il thinking.

  **Adozione: non ancora.** Percorso: ripristino telefono → 8/8 su path `-p` con KVFIX →
  se PASS, re-pin deliberato di CAMPAIGN (nuovo sha in `CAMPAIGN.sha256`).

- **2026-08-08 — ✅ TRE BLOCCANTI CHIUSI IN UN COLPO (mandato `fix-bloccanti-audit.md`),
  arbitrato da me con verifica su disco. G3 CONFERMATO: −51%.**

  Report: `reports/moe-blockers-fix.md`. Verificato: commit sul tree PC (`e5605f3` fixup
  submodule, `5e6778c` session, `bd0cb35` bump), implementazione tri-stato conforme
  (`llama.h:333` `int32_t`, default 0, `init_mappings(params.mmap_prefetch >= 0, …)` a
  `llama-model.cpp:1506` → **zero-init riproduce il comportamento storico**, la promessa di
  compatibilità ora è vera), pin helper (`scripts/lib_campaign_pin.sh`: abort su mismatch,
  path nudo vietato, override solo `ALLOW_UNPINNED=1`), artefatti G3 completi.

  1. **ABI (bloccante 2)** — chiuso. Fixup sopra `206a8fe7f` senza rebase; il messaggio
     corregge esplicitamente il claim falso. Nit da sistemare al prossimo passaggio: il
     commento in `llama.h:332` è in italiano, per l'upstream va in inglese.
  2. **Pin (rischio di processo)** — chiuso. `bmoe-cli.CAMPAIGN` sha `ad058660…`,
     `chmod a-w`, 26 script harness aggiornati, colonna `bin_sha256` in coda a `runs.csv`.
  3. **G3 (bloccante 1)** — rifatto e **CONFERMATO**: sampler on-device (mediana 201 ms,
     p95 221 ms, G-B PASS), confine = riga `bmoe: expert streaming ON` verificata dal cambio
     di regime I/O su entrambi i bracci. **CTRL 21.05 GiB vs NEW 10.31 GiB = −51.0%**;
     VmHWM −41.6%; scarto fra ripetizioni <1%. E la prova regina: `rchar` **1.649 GiB in
     entrambi i bracci** ≈ F4.8 storico (1.62) — i 3.2-3.4 GiB del G3 originale erano
     contaminazione del vecchio sampler, come sospettato nell'arbitrato dell'audit.
     **I numeri di `moe-blockers-fix.md` sostituiscono quelli di `moe-loader-fix.md`.**

  **Deviazione legittima e documentata**: `bmoe-cli.PREFAULT` (binario pre-campo) va in
  SIGSEGV con la `libllama` tri-stato — atteso: struct cresciuta, binari vecchi richiedono
  la lib vecchia. Il ctrl è diventato `G3P` (stesso tree, `mmap_prefetch=1`): **controllo
  migliore**, una sola variabile. ⚠️ Conseguenza da ricordare: PREFAULT come "via di
  ritorno" non è più eseguibile con le lib attuali — il rollback vero è ricostruire da git
  (`b0c4e5b`/`206a8fe7f`), lo sha intatto serve da riferimento storico, non da binario
  pronto.

  G-A 8/8 byte-identici → il binario ABI (= CAMPAIGN) è equivalente sul decode: **tutte le
  misure storiche restano confrontabili**. Restano in coda: fix KV
  (`mandates/kv-reuse-fix.md`, ora eseguibile — l'albero è quello post-blocchi), dense
  double-pass, nit del commento.

- **2026-08-08 — 🎯 DIAGNOSI KV CHIUSA: non divergono a posizione 0 — divergono a 35 sul
  blocco `<think>` vuoto, e poi il fallback butta via anche i 35 token buoni.**

  Report: `reports/moe-kv-reuse-diagnosis.md` (build usa-e-getta `bmoe-cli.DIAG`, campagna
  intatta). **Due difetti in serie**, entrambi verificati da me sul sorgente:

  1. **La divergenza (session.cpp:1533-1539).** Con `--no-think` il modello emette comunque
     ` <think>\n\n</think>\n\n ` (4 token) prima della risposta; quei token entrano in
     `kv_tokens`. Ma la history committa il messaggio **parsato** — `content` senza i marker —
     e il re-render del turno 2 produce `<|im_start|>assistant\n` seguito subito da `La…`.
     Match grezzo: **35 token su 71** (posizioni 0..34 identiche, rottura a 35:
     `kv=<think>` vs `tok=La`).
  2. **Il wipe (session.cpp:985-988).** Col match a 35, `llama_memory_seq_rm(0, 35, -1)`
     **fallisce** e il fallback fa `llama_memory_clear` + `n_common = 0`: si perde anche il
     prefisso valido. Il commento a riga 983 lo anticipava ("SWA-style memory can refuse a
     partial removal") — il fallback è deliberato, ma totale. Da capire (diagnostica nel
     mandato di fix): perché questo modello rifiuta la rimozione parziale — sospetto
     architettura ibrida/ricorrente, dove il rewind parziale è impossibile per costruzione.

  **Conseguenza di design**: se il difetto 1 è risolto (re-render byte-identico allo stream
  che la KV ha visto), nel caso append-only della chat il `seq_rm` parziale **non serve più**
  (n_common = tutta la KV, coda da rimuovere vuota). Il fix giusto è quindi **uno solo, nel
  commit della history**: conservare la forma grezza quando il parse ha spogliato uno span
  think vuoto. Il caso thinking-ON resta fuori scope (Kalsa spedisce no-think; con reasoning
  vero lo strip della history è raccomandato e il riuso lì non può funzionare senza chirurgia
  mid-KV, che è unsound).

  Soglia di successo dichiarata dal report: `n_common ≈ 71`, `n_prompt(t2) ≈ 37-41`,
  prefill t2 nell'ordine del turno 1 (~5 s, non ~12 s). Valore in gioco invariato: turno 5
  da **165 s a ~10 s**. Mandato di fix: `mandates/kv-reuse-fix.md` — da eseguire in
  **sequenza** con `mandates/fix-bloccanti-audit.md` (entrambi toccano session.cpp), mai in
  parallelo.

- **2026-08-08 — ARBITRATO SULL'AUDIT DEL LOADER FIX: un bloccante confermato e aggravato,
  uno declassato, uno chiuso da me, più un rischio di processo che nessuno aveva visto.**

  Audit ostile in `reports/audit-loader-fix.md`. Due bloccanti, una verifica lasciata aperta.

  ### ✅ Punto 6 — CHIUSO: la rete di sicurezza esiste

  L'audit non poteva verificarlo (vincolo di sola lettura). Verificato via ssh:
  `bmoe-cli.PREFAULT` presente, `sha256 = 5c95cb5f…` **identico all'atteso**. La via di ritorno
  c'è.

  ### 🔴 Bloccante 2 (ABI) — CONFERMATO, ed è il più grave. La patch mente nel messaggio.

  L'audit ha ragione e il punto è più serio di come è scritto. `llama_model_params` è una
  **struct aggregate**: aggiungere un `bool` in coda significa che

  ```cpp
  llama_model_params p{};        // value-init  → mmap_prefetch = FALSE
  ```

  cioè **chi non tocca nulla ottiene il prefault DISATTIVATO**, che è il comportamento *nuovo*,
  non quello vecchio. Il default `true` vale **solo** per chi passa da
  `llama_model_default_params()`.

  Il messaggio del commit dichiara *«default true for classic warm-load compatibility […]
  everyone else is unchanged»*. **La seconda metà è falsa**, e va corretta: non è una sfumatura,
  è la promessa su cui si regge l'idea di poterla un giorno proporre a monte.

  **Impatto reale sul nostro fork: nullo oggi** — controlliamo tutti i chiamanti e passiamo tutti
  da `default_params()`. **Impatto se la si propone upstream: bloccante.** Il fix pulito è quello
  che l'audit indica: sentinella (`int32_t`, `-1` = non impostato ⇒ comportamento precedente)
  invece di un `bool` che si azzera da solo.

  ### 🟡 Bloccante 1 (G3) — CONFERMATO sui numeri assoluti, DECLASSATO sulla conclusione

  L'audit ha ragione che la strumentazione è difettosa: campionamento reale a **2.5-3.3 s** e non
  ai 200 ms dichiarati, e il confine di fine-load dedotto da una stringa che compare tardi ⇒
  `read_bytes_at_load` può includere traffico post-load. Lo conferma un sintomo che il report
  aveva liquidato come «differenza di strumentazione»: `rchar` **3.24/3.41 GiB** contro gli
  **1.62** storici.

  **Ma la conclusione sopravvive, e la ragione è G2.** L'A/B usa la **stessa** metodologia
  difettosa sui due bracci, e il decode è **byte-identico** fra loro: la contaminazione è
  in gran parte **di modo comune** e si cancella nella differenza. Le finestre hanno durate
  diverse (22.2 s contro 12.5 s), quindi il delta può essere sporcato di ~1-2 GiB — su **10.65**
  misurati.

  ⇒ **Non bloccante per la decisione** (il fix funziona, la direzione e l'ordine di grandezza
  reggono), **bloccante per il verbale**: i numeri assoluti non vanno citati come misura finché
  G3 non è rifatto con un marker esplicito di fine-load e un campionatore davvero periodico.

  ### ⚠ Il rischio che nessuno aveva visto: il binario di campagna non è pinnato

  Verificato: `bmoe-cli` e `bmoe-cli.NEW` hanno lo **stesso sha256** (`7354947b…`). Non è
  un'adozione furtiva — è che la build produce `bmoe-cli` e le copie etichettate sono snapshot
  *a posteriori*. Ma la conseguenza è che **l'harness invoca l'output dell'ultima build**, non un
  binario scelto: un `make` distratto cambia il binario di campagna senza che nessuno lo decida.

  **Fix di processo**: l'harness deve invocare un percorso **pinnato e nominato** (es.
  `bmoe-cli.CAMPAIGN`, aggiornato solo da una decisione esplicita), e registrarne lo `sha256` in
  ogni riga di `runs.csv`. Costa poco e chiude una classe intera di errori silenziosi — la stessa
  classe del cpuset e dei contatori a finestre mescolate.

- **2026-08-08 — ✅ CONFERMATO: `n_common = 0`. I 165 s di ri-prefill al quinto turno sono un
  DIFETTO, non il prezzo del multi-turno. E la domanda si stringe a una riga di codice.**

  Mandato lampo, due sessioni da 5 minuti, nessuna modifica al binario.

  ```
  Y (clear_kv=true)    turno 1: n_prompt=39   n_past=71
                       turno 2: n_prompt=39   n_past=71     ← storia azzerata
  X (clear_kv=false)   turno 1: n_prompt=39   n_past=71
                       turno 2: n_prompt=108  n_past=140     prefill 9.1 s a 11.9 tok/s
  ```

  ### ⚠ Il mio A/B era progettato male — e serve comunque

  Avevo proposto di confrontare `n_prompt` del turno 2 fra `clear_kv` true e false. **Non
  discrimina**: `session.cpp:864` mostra che `clear_kv=true` fa anche `im.chat_history.clear()`,
  quindi nel braccio Y il turno 2 renderizza **solo il messaggio nuovo**, non la conversazione.
  I due bracci non renderizzano lo stesso prompt. Errore mio di lettura del codice.

  **Ma Y è servito lo stesso, come calibrazione**: dice che il blocco
  `[utente P][apertura assistente]` vale **39 token**.

  ### L'aritmetica che chiude la questione

  Dopo il turno 1 la KV contiene **71 token** (39 di render + 32 generati). Il render del turno 2
  **comincia con quegli stessi 71** e poi aggiunge chiusura, secondo blocco utente e apertura:

  ```
  render_2 ≈ 39 + 32 + ~2 + 39 ≈ 108-112
  n_prompt misurato = 108   ⇒   n_common = 0
  ```

  Se il riuso avesse funzionato, `n_common = 71` e `n_prompt ≈ 37`. Il tempo conferma: **9.1 s
  per 108 token a 11.9 tok/s**, cioè li ha prefillati tutti.

  ### La domanda che resta, e perché è piccola

  La macchina del riuso **esiste ed è completa** (`session.cpp:963-980`), `im.kv_tokens` **è
  mantenuto** (righe 1100 e 1355), `clear_kv=false` **arriva davvero** (verificato nel JSON
  dell'harness). Eppure il confronto `im.kv_tokens[i] == tokens[i]` fallisce **alla posizione 0**.

  Il turno 2 comincia con lo stesso blocco `[utente P]` del turno 1 — **a meno che il template
  non renda diversamente quando i messaggi sono più di uno** (per esempio inserendo un blocco di
  sistema assente al primo turno, o un BOS trattato in modo diverso).

  **Il passo successivo è mirato e minimo**: non «loggare `n_common`», ma **stampare i primi 10
  token di `im.kv_tokens` e i primi 10 di `tokens`** al momento del confronto. Se divergono a
  posizione 0 si vede subito *cosa* il template ha messo davanti, e **il fix è nel rendering,
  non nel confronto**.

  **Valore in gioco, invariato:** turno 5 da **165 s a ~10 s**, cioè −65% di latenza percepita,
  senza toccare decode, qualità o modello.

- **2026-08-08 — 🎯 E1 SCOPERCHIATA: i 19 GiB di spreco sono UN DEFAULT di llama.cpp, e il fix
  è una riga (o ~20 fatte bene). Diagnosi in sola lettura, nessun file toccato.**

  ### La causa

  ```cpp
  // third_party/llama.cpp/src/llama-model.cpp:1506
  ml.init_mappings(true, use_mlock ? &pimpl->mlock_mmaps : nullptr);
  //               ^^^^ prefetch — default true in llama-model-loader.h:189
  ```

  `init_mappings(prefetch=true)` fa **`MAP_POPULATE` + `MADV_WILLNEED` sull'intero file**, e il
  percorso di load lo chiama **sempre** così. L'unica chiamata con `prefetch=false` in tutto
  l'albero è in **quantizzazione** (`llama-quant.cpp:885`), non nel runtime.

  **E nessun parametro pubblico lo disattiva**: `llama_model_params` (`llama.h:324-327`) espone
  solo `use_mmap`, `use_direct_io`, `use_mlock`, `check_tensors`. Non era il flag gratis che
  speravo — è un default cablato.

  **Per noi è spreco integrale**: con `--moe-stream` gli esperti si leggono via O_DIRECT quando
  servono, e con `--dense-weights anon` il trunk denso viene **copiato fuori** dall'mmap. Il
  prefault dell'intero GGUF non serve a nulla di ciò che facciamo — riempie la page cache con
  9 GiB di esperti che poi rilasciamo (`dropped 1662 MiB of now-unused mmap pages`).

  ### Il fix

  | | |
  |---|---|
  | minimo | `init_mappings(false, …)` — **1 riga**, ma cambia il comportamento per tutti |
  | corretto | campo `mmap_prefetch` in `llama_model_params` (default `true` per compat) → propagato a `init_mappings` → messo a `false` in `session.cpp` **solo se `--moe-stream`** — **~15-30 righe** |
  | effetto atteso | load I/O **20.76 GiB → ~4-5 GiB**, tempo **19.6 s → ~4-5 s** |
  | per arrivare a ~2.6 s | serve anche il **fix secondario**: con `anon` il dense è letto due volte (fault + O_DIRECT). Mitigazione: `memcpy` dalle pagine mmap già residenti invece di rileggere — ~20-40 righe in `dense_weights.cpp` |
  | decode | **non toccato** |
  | rischio | un load *senza* streaming che contava sul populate per nascondere i fault dentro `load_seconds` li vedrebbe spostati al primo token. Con `--moe-stream` è **esattamente il comportamento voluto** |
  | vincolo di processo | la modifica è **nel submodule** ⇒ patch sul fork `Helldez/llama.cpp` + bump, **non** patch silenziosa in-tree |

  ### Tre finte soluzioni, escluse con motivazione

  - **`use_mmap=false`** → materializza **tutto** in RAM: peggio.
  - **`use_direct_io` sul model load** → disabilita l'mmap (`llama-model-loader.cpp:565-568`):
    stesso esito.
  - **`--dense-weights mmap` da solo** → toglie i 1.62 GiB del secondo passaggio, **lascia i
    19 GiB di fault**, e regredisce la residenza dense in decode oltre-RAM.

  ### Perché questa voce vale più di tutte le altre

  È **la stessa causa di tre problemi** che avevamo trattato come distinti: ~17 s di TTFT su 28,
  il picco termico a **92 °C** (il momento più caldo della sessione è il *caricamento*, non la
  generazione), e la fragilità di memoria che ha prodotto la **cascata OOM di 10 processi**.
  Un fix da ~20 righe, senza costo di qualità, che tocca tutti e tre.

  **Gate di accettazione, non negoziabile:** ri-superare la non-regressione **8/8 output
  byte-identici** contro i riferimenti k=8. A `temp 0` su questo stack gli output sono
  bit-identici (dimostrato in F5.4-D1), quindi **una sola differenza è un difetto, non rumore**.

- **2026-08-08 — ⚫ LA SCALA k È ANNIENTATA. E il metro appena costruito rivela il proprio
  limite: misura il MODELLO, non le decisioni del runtime in decode.**

  Report `reports/moe-f5.6.md`, commit `62ba1f0`. Scala completa su `part1` (34 003 posizioni,
  confronto appaiato, `cache 0`, un solo flag diverso per volta).

  ### Passo 0 superato

  `--n-expert-used` **tocca il prefill**: sonda corta k=8 vs k=4 ⇒ ΔPPL **+4.50**. Se avesse
  agito solo in decode le due PPL sarebbero coincise e l'intero mandato sarebbe stato vuoto.
  Sesta verifica di un'assunzione su un flag; la prima che risulta **vera**.

  ### La scala

  | | k | PPL | ΔPPL vs k8 | CI95 | costo = ΔPPL / % traffico risparmiato |
  |---|---:|---:|---:|---|---:|
  | k8 | 8 | **2.556** | — | — | riferimento |
  | k6 | 6 | **3.497** | **+0.941** | [0.860, 1.018] | 0.0376 |
  | k5 | 5 | **5.117** | **+2.561** | [2.372, 2.745] | 0.0683 |
  | k4 | 4 | **9.843** | **+7.287** | [6.837, 7.725] | **0.1457** |

  A k=4 la perplessità è **quasi quadruplicata**. Nessun intervallo si avvicina allo zero.
  Soglia dichiarata per archiviare: 0.15 ⇒ **tutte e tre archiviate**, k6 di 6×.

  **E il costo-per-traffico peggiora MONOTONICAMENTE** (0.038 → 0.068 → 0.146): ogni gradino
  verso il basso rende peggio del precedente. **k non è una manopola con un ottimo: è una
  direzione strettamente dominata.** Non esiste un k «giusto» sotto 8.

  ### ⚠ Il risultato metodologico, che vale quanto i numeri

  Il 2026-08-07 ho letto l'output di **k=4** e ho scritto, nel verbale, che il codice era
  corretto e che la fisica della batteria era *«la più corretta di tutto il set»*. **Era vero.**
  E quel modello aveva una perplessità **4× peggiore**.

  **Testo che sembra a posto non è prova di qualità preservata.** È esattamente il modo in cui
  si spedisce un prodotto rotto fidandosi dell'occhio — e le 24 coppie che avevo letto non
  erano un campione troppo piccolo per *caso*: erano lo strumento sbagliato. Un modello
  degradato produce ancora frasi fluenti e, a volte, fatti giusti; quello che perde è la
  *distribuzione*, che a occhio non si vede.

  ### ⚠ `--drop-cold-experts` è BLOCCATO, e il perché è una scoperta sul metro

  Diagnosi confermata da probe + lettura di `config.cpp`:
  1. `drop_cold_frac` con `cache_mb=0` viene **rifiutato** (degenera in taglio di pesi);
  2. il percorso PPL marca **ogni batch come prefill**, e `drop_prefill` è **off di default**.

  Cioè: `--drop-cold-experts` è un meccanismo **di decode con cache**, il protocollo PPL è
  **prefill con cache 0**. Incompatibili per progetto, non per svista.

  **Il limite generale che ne discende:** il metro costruito da A misura il **modello** —
  quanto bene predice il testo — non le **decisioni del runtime durante la generazione**.
  Qualunque leva che agisca solo in decode (drop-cold oggi, e chiunque altro domani) **gli è
  invisibile**.

  **Il rimedio, che è un'estensione modesta di ciò che A ha già costruito:** uno **scorer sul
  percorso di decode** — teacher forcing un token alla volta invece che in batch di prefill.
  A ~6 tok/s sono ~1.6 ore per gli stessi 34k token: fattibile. È l'unico modo di dare a
  `drop-cold` la stessa prova che ha demolito k, invece di archiviarlo per non-misurabilità.

  ### Stato del ramo lossy

  | leva | esito |
  |---|---|
  | `k=6/5/4` | **archiviate**, ΔPPL da +0.94 a +7.29 |
  | `--drop-cold-experts` | **non misurabile** col metro attuale — serve lo scorer di decode |
  | REAP (pruning) | non ancora toccato; il metro ora esiste, ma vale per il modello, e il pruning è una modifica **del modello** ⇒ **misurabile con il metro attuale** |

  **Ricaduta su REAP**: è l'unica leva lossy che il metro attuale può giudicare così com'è,
  perché cambia i pesi e non il comportamento a runtime. Se un giorno si vorrà provarla, la
  prova è già disponibile.

- **2026-08-08 — ⚫ k=6 È ARCHIVIATO CON UN MARGINE DI 6×. Il metro dà in un colpo la risposta
  che 24 coppie lette a occhio non avevano potuto dare.**

  Prima variante della scala F5.6, completata alle 04:32.

  ### Il numero

  Attenzione al confronto — la baseline da `PPL 2.779` era su **part1+part2**, mentre le
  varianti girano su **part1 sola**. Confrontarle direttamente sarebbe **lo stesso errore di
  categoria** che ho commesso ieri col simulatore. Baseline su part1 ricavata per sottrazione:

  ```
  combinata:  n=68175   sum_logprob=-69682.70682
  part2:      n=34172   sum_logprob=-37772.75592
  ────────────────────────────────────────────────
  part1:      n=34003   sum_logprob=-31909.95090
              mean = -0.938441   ⇒   PPL = 2.556
  ```

  `k6` riporta `n_scored=34003`: **stesso identico conteggio**, quindi il confronto è appaiato
  sullo stesso testo.

  ```
  k=8  →  PPL 2.556
  k=6  →  PPL 3.497          ΔPPL = +0.941   (+37% relativo)
  ```

  **Soglia dichiarata per archiviare: ΔPPL > 0.15. Siamo a +0.94, sei volte tanto.**
  `k=6` non è «quasi indistinguibile»: è **materialmente peggiore**, senza ambiguità.

  ### Perché questo giustifica da solo tutto il lavoro sul metro

  Il 2026-08-07 ho letto **24 coppie di output** a occhio, prompt per prompt. Ho trovato errori
  che **non si ordinavano per k**: l'errore fattuale peggiore a k=6, quello tecnico a k=5, la
  fisica più corretta a k=4, e parole malformate a **ogni** k incluso 8. Ne avevo concluso —
  onestamente, ed era il massimo che quello strumento permettesse — che **non riuscivo a
  distinguere il degrado dal rumore fra traiettorie**.

  Il metro, su **34 003 posizioni** invece di 24 campioni, lo distingue in un colpo e senza
  margine di dubbio. **Era rumore la mia incapacità di vedere il segnale, non il segnale.**

  Ricaduta sulla domanda di gualt di ieri (*«k=8 è l'unica opzione?»*): **per k, sì**, e con un
  margine che non lascia spazio. Resta aperto `--drop-cold-experts`, che taglia per **costo**
  (solo ciò che è insieme miss di cache e marginale nel peso del router) invece che per **rango**
  — ed è l'unica leva della famiglia lossy ancora in gioco.

  ### ⚠ Errata: una mia conclusione delle 02:42 era falsa

  Nel messaggio del commit `784c8c6` ho scritto *«la catena notturna copriva solo la baseline,
  non la scala; il telefono è fermo dalle 02:37»*. **Falso.** Avevo campionato lo stato **alle
  02:42**, cioè nella finestra fra la baseline che chiudeva alle 02:37 e la scala che partiva
  alle 03:13. L'osservazione era corretta; **la conclusione — uno stato permanente dedotto da
  una finestra di cinque minuti — no.**

  gualt ha detto «non è vero, controlla meglio» ed è bastato guardare l'elenco completo dei
  processi: `poller.sh` dalle 03:13, `run_scale_rest.sh` dalle 04:35, `bmoe-cli` con 56 minuti
  di CPU al 371%.

  **Lezione, che è la stessa di ieri in forma nuova:** ieri avevo confrontato una previsione con
  una misura di un'altra cosa; oggi ho dedotto uno stato stabile da un campione istantaneo. In
  entrambi i casi il dato era giusto e l'inferenza no. **Per stati che evolvono, un campione non
  è una misura: serve o una serie, o un'attesa, o un artefatto persistente da leggere.**

- **2026-08-07 sera — 🟢 F6 SI RIAPRE: esiste un draft DFlash per IL NOSTRO target, pesa 421 MB,
  ci sta in RAM, e la verifica è output-lossless. Manca solo che il fork sappia caricarlo.**

  Segnalazione di gualt (link in fondo). Prima volta in tutta la campagna che una leva ha
  **tutte e quattro** le proprietà giuste insieme.

  ### Cos'è DFlash, davvero (avevo capito male al primo colpo)

  Al primo link avevo letto *«block-diffusion decoding»* e concluso che fosse una modalità di
  decodifica applicabile a un modello autoregressivo. **Falso.** Verificato nel nostro albero:

  ```c
  bool llm_arch_is_diffusion(const llm_arch & arch) {
      case LLM_ARCH_DREAM: case LLM_ARCH_LLADA:
      case LLM_ARCH_LLADA_MOE: case LLM_ARCH_RND1: return true;
      default: return false;    // ← DFLASH NON è qui
  }
  // e separatamente:  { LLM_ARCH_DFLASH, "dflash" }
  ```

  **DFlash è l'architettura del MODELLO DI BOZZA per lo speculative decoding.** Il target resta
  un autoregressivo normale; il pezzo nuovo è un draft veloce che propone k token e il target ne
  verifica k in un passaggio solo.

  ### Perché questo risolve esattamente ciò che aveva ucciso F6 due volte

  F6 l'avevo chiusa due volte, e **nessuna delle due per l'idea in sé**:
  - **M5**: MTP non ammortizza i **byte di flash** (`miss@t ∧ miss@t+1` = 0.00%). Vero e resta vero.
  - **F5.2**: sull'asse RAM/calcolo, `--mtp` **fallisce** (`this gguf has no nextn block`) e
    `--ngram` **non ha mai draftato** (0 di 128 step su prosa IT).

  Il secondo verdetto non diceva «l'idea non funziona»: diceva **«il meccanismo di bozza non
  produce bozze»**. Un draft model separato e addestrato risolve precisamente quello. E il
  guadagno che cercavo è reale: verificare k token in un batch legge i pesi degli esperti **una
  volta invece di k volte** — l'ammortamento sulla RAM (301 MB/token di pesi letti, di cui solo
  34 dal flash) che non ero riuscito a misurare.

  ### Lo stato, voce per voce

  | | |
  |---|---|
  | draft per **il nostro** target | ✅ [`Alittlehammmer/Qwen3.6-35B-A3B-DFlash-GGUF-llama.cpp`](https://huggingface.co/Alittlehammmer/Qwen3.6-35B-A3B-DFlash-GGUF-llama.cpp) |
  | dimensione | ✅ **Q8_0 421 MB**, Q4_K_M 235 MB, Q6_K 326 MB |
  | ci sta in RAM | ✅ oggi `1664 + 2000 + 500 ≈ 4.2 GB`, picco 4.6 ⇒ con 421 MB si sta **sotto lmkd**, stretto |
  | qualità | ✅ verifica greedy **output-lossless**: MATH-500 88.0% vs 87.0%, differenza attribuita a rumore FP |
  | il nostro llama.cpp conosce l'arch | ✅ `LLM_ARCH_DFLASH` registrato nel submodule |
  | **il nostro fork lo carica** | ❌ **l'unica cosa che manca** |

  ### Cosa manca, esattamente

  `session.cpp:534` — il contesto di bozza nasce **dallo stesso modello**:

  ```cpp
  llama_context * ctx_dft = llama_init_from_model(model, dparams);
  if (!ctx_dft) return fail("failed to create the MTP draft context");
  ```

  Nessun `--model-draft`, nessun `--spec-type`, nessuna gestione di `dflash` in `cli/main.cpp`.
  **Ma è impianto idraulico, non ricerca**: llama.cpp ha già la macchina dello speculative con
  draft esterno, il fork ha già un contesto di bozza e chiama già `common_speculative_begin()`.
  Serve caricare un secondo modello, creargli il contesto, e puntare l'helper lì invece che alla
  testa MTP. **Giorni, non settimane.**

  ### Le due incognite che ne decidono la taglia — da MISURARE, non stimare

  1. **Tasso di accettazione sulla prosa italiana.** `--ngram` non ha draftato **mai** in
     italiano; un draft *addestrato* dovrebbe, ma non è verificato. E con verifica greedy ogni
     bozza rifiutata è **calcolo buttato** su un sistema che gira al 41% della frequenza di picco.
  2. **Il costo dell'unione MoE.** Verificare k token carica l'unione dei loro esperti. Misurato:
     **36% di sovrapposizione** fra token consecutivi ⇒ per k=4 servono ~23 esperti per layer
     invece di 8. Il traffico sale, e paga **solo se l'accettazione è alta**.

  **Condizione di riapertura (dichiarata ora):** F6 vive se, misurato sul carico vero,
  `tok/s netti ≥ +15%` con `mib_tok` che non più che raddoppia. Sotto, si archivia per la terza
  e ultima volta.

  ### Nota di metodo

  Le tre chiusure di F6 (flash, RAM, e ora la riapertura) sono lo stesso schema: **avevo
  archiviato un'idea per il fallimento del suo strumento, non dell'idea.** `--ngram` che non
  drafta e un GGUF senza testa MTP non dicono niente su se lo speculative decoding paghi qui.
  Vale la pena tenerlo: *quando una leva muore, chiedersi se è morta lei o il modo in cui l'ho
  provata.*

- **2026-08-07 — IL RAMO RI-QUANTIZZAZIONE È CHIUSO, con il conto invece che con l'intuizione.
  E `--ubatch` si rivela una leva sulla cache, non solo sulla memoria.**

  ### B — invalida sulla metrica, ma la chiusura analitica funziona

  L'A/B LFM2 Q4_0 vs Q4_K_M è **INVALIDO** per la regola che avevo dichiarato: `work` fra
  repliche dello stesso arm va da 102k a 128k (25%, oltre il ±10%), e Q4_0 sta
  sistematicamente sopra Q4_K_M pur avendo `compute` quasi identico. I 300 MB di differenza
  fra i file mettono i due arm in regimi di memoria diversi — **esattamente il rischio che
  avevo previsto dopo il fallimento della metrica in C**.

  Ma la chiusura per via analitica regge, ed è più informativa del test:

  | modello | geometria | FLOP/token | compute | GFLOP/s |
  |---|---|---:|---:|---:|
  | 35B **IQ2** | 40 layer × 8 exp, 2048×512 | 2.01 G | 98.7 ms | **20.4** |
  | LFM2 **Q4_0** | 24 × 4, 2048×1792 | 2.11 G | 63 ms | **33.6** |
  | LFM2 **Q4_K_M** | idem | 2.11 G | 61 ms | **34.7** |

  I due modelli fanno quasi lo stesso lavoro aritmetico per token (2.01 vs 2.11 GFLOP), il che
  rende il confronto insolitamente pulito. **IQ2 ottiene il 60% dei GFLOP/s dei formati a
  blocchi.** Confondente dichiarato: il 35B fa **320 matmul piccole** (2048×512) contro le
  **96 grandi** di LFM2 (2048×1792), e le matrici piccole sono meno efficienti — quindi
  l'1.65× mescola costo del codebook e geometria, in proporzione ignota.

  ### ⚠ Il meccanismo, letto nel sorgente (e una correzione mia)

  **Correzione**: ho ripetuto per giorni che «IQ2 non ha un percorso ARM veloce». **Falso** —
  un kernel NEON ce l'ha (`ggml_vec_dot_iq2_xxs_q8_K`, `arch/arm/quants.c:3631`). Quello che
  non ha è un **codebook che sta in un registro**:

  ```c
  // MXFP4 (arch/arm/quants.c:767) — la tabella entra in UN registro, una volta
  const int8x16_t values = vld1q_s8(kvalues_mxfp4);

  // IQ2_XXS (arch/arm/quants.c:3664) — otto load dalla MEMORIA per blocco da 32,
  // a indirizzi che dipendono dal dato appena letto
  q2u.val[0] = vcombine_s8(vld1_s8(iq2xxs_grid + aux8[0]), vld1_s8(iq2xxs_grid + aux8[1]));
  ```

  Gather dipendenti dal dato, non vettorizzabili, che spezzano la pipeline del prodotto
  scalare. **È lì che se ne vanno i GFLOP/s.**

  ### ⚠ E il percorso veloce di llama.cpp è IRRAGGIUNGIBILE dallo streaming

  `repack.cpp:4793` pretende **due** condizioni: tipo fra {Q4_0, Q4_K, Q8_0, IQ4_NL} **e**
  `op->src[0]->buffer->buft == ggml_backend_cpu_repack_buffer_type()`. Lo streaming degli
  esperti alloca memoria propria (`vm_reserve`/`vm_commit`), quindi la seconda non è mai
  soddisfatta.

  | configurazione | percorso |
  |---|---|
  | 35B IQ2 in streaming (oggi) | generico (IQ2 non è comunque supportato) |
  | 35B **Q4_0 in streaming** | **ancora generico** — tipo giusto, buffer sbagliato |
  | modello non-streamed | repack, veloce |

  **Questo spiega anche perché il test B non ha visto differenze**: entrambi gli arm giravano
  con `--moe-stream` (cache 400 MiB, hit 0.0%), quindi **nessuno dei due usava il percorso
  repack**. Il test confrontava due kernel generici, dove Q4_0 e Q4_K sono equivalenti. **Non
  ha testato l'ipotesi.**

  **Eccezione importante: MXFP4.** Il suo vantaggio sta nel `vec_dot` **generico**, non nel
  repack — quindi sarebbe **raggiungibile** dallo streaming, a differenza di Q4_0.

  ### La ricerca: l'idea del pre-pack su disco è stata FATTA e ABBANDONATA

  Su obiezione di gualt («sicuro che nessuno lo fa? forse c'è un motivo negativo?»), ricerca
  dedicata. Risposta: **sì, è stata fatta.** I tipi GGUF `Q4_0_4_4`, `Q4_0_4_8`, `Q4_0_8_8`
  sono esistiti su disco da metà 2024 e sono stati **rimossi il 7 dic 2024**
  ([PR #10446](https://github.com/ggml-org/llama.cpp/pull/10446), commit `19d8762`) in favore
  del repack a runtime. L'errore è ancora nel codice: `TYPE_Q4_0_4_4 REMOVED, use Q4_0 with
  runtime repacking`.

  **Motivazione, testuale (Djip007):** *«be prepare to have lot of new type (AVX512 will like
  bloc of 16xN, AVX512BF16 of 2x16xN, AVX2 of 8xN, RDNA3 of 16x16 …)»* — e (slaren):
  *«support for Q4_0_N_M model files has been removed and cannot be made anymore»*.

  **È una ragione di ECOSISTEMA, non tecnica**: proliferazione di formati su disco per hardware
  eterogeneo. **Non ci tocca**: un SoC, un telefono, artefatto privato di ricerca.

  **Cercato e NON trovato** (che è a sua volta un risultato): nessun documento dice che il
  pre-tiling rompa lo streaming MoE; nessun manutentore sostiene che rompa la correttezza
  numerica (hanno verificato la parità di perplessità); la dimensione del file **non** aumenta
  col tile; **non esiste** un'API ggml tipo `already_packed=true`.

  ### Il conto che chiude il ramo

  Normalizzando il decode di oggi (compute 0.137 di cui GEMM esperti 50.5%, stall 0.043):

  ```
  Q4_0, cache 2000:  esperti 1.70 MB → 1176 voci (da 2226), hit 76→~68, traffico ×2.4
                     compute 0.110   stall 0.103   decode 0.220   → PEGGIO del 16%
  Q4_0, cache 3500:  2059 voci ≈ come oggi, traffico ×1.80
                     compute 0.110   stall 0.077   decode 0.194   → PAREGGIO
  ```

  **Il guadagno sul calcolo e la penale sui byte hanno la stessa taglia.** Anche nel caso
  migliore si pareggia. **Non si spendono 20 GB e giorni di lavoro per un pareggio. RAMO CHIUSO.**

  ### La ragione strutturale per cui non esiste una via d'uscita

  **Pochi bit e dequantizzazione economica sono in tensione per costruzione.** A 2 bit servono
  codebook grandi per conservare qualità — è tutto il senso della griglia di IQ2 — e un codebook
  grande non sta in un registro NEON. MXFP4 ha la tabella in un registro **perché** ha 16 valori,
  e ne ha 16 **perché** è a 4 bit. Il formato che vorremmo (2-3 bit con codebook in registro)
  non esiste, e non è un caso.

  ### D2 — `--ubatch` è anche una leva sulla CACHE, non solo sulla memoria

  | ubatch | buffer MiB | hit % | tok/s | work |
  |---:|---:|---:|---:|---:|
  | 256 | 250.51 | **60.2** | 4.024 | 254 137 |
  | 512 | 501.02 | **69.3** | 3.574 | 323 939 |
  | 1024 | 1002.04 | **73.8** | 3.574 | 321 249 |
  | 2048 | 2004.08 | **79.2** | 4.157 | 261 400 |

  1. **Il buffer scala esattamente**: `0.979 MiB per token di ubatch` (avevo stimato 0.98).
  2. **L'hit rate sale con ubatch, 60.2 → 79.2** — effetto non previsto. Non dovrebbe dipendere
     da ubatch (in decode c'è un token solo in volo), ma il contatore è cumulativo e dominato
     dal **prefill**: con ubatch piccolo il prompt passa in tanti blocchi e fra l'uno e l'altro
     la cache evince esperti che il blocco dopo richiede di nuovo.
  3. **Ne esce un confronto che nessuno aveva posto:**

  ```
  +1500 MB in CACHE  (2000→3500)  →  +5.0 punti di hit
  +1500 MB in UBATCH (512→2048)   →  +9.9 punti di hit
  ```

  **A parità di RAM, l'ubatch compra il doppio dell'hit.** Il che rimette in discussione la
  raccomandazione «adottare 512»: 512 era la scelta sicura sulla memoria, ma se i 3.5 GB
  liberati si possono spendere, forse vanno spesi in ubatch e non in cache.

  ### Convergenze da Godwit (github.com/rayl15/Godwit)

  Runtime MoE su Apple Silicon, GPT-OSS-120B su 16 GB. Tre cose che ci riguardano:
  - **Conferma indipendente**: *«layer adiacenti condividono solo il 4.8% degli esperti»* ⇒
    prefetch per ripetizione impossibile. Noi: Recall@8 = 19.2%. Stessa conclusione, sistemi e
    modelli diversi.
  - **Il dato che chiude il ramo prefetch**: hanno un predittore *vero* (eseguono il router sul
    residuo in ingresso, prima dell'attenzione) con **87-91% di accuratezza**. Guadagno:
    **+3.1%**, e loro sono **I/O-bound**. Noi siamo compute-bound con il 20% di I/O esposto:
    un predittore perfetto ci darebbe meno.
  - **Il contrasto**: loro GPU al 17.6%, hit 38%, **1.4-1.5 tok/s** su M4. Noi compute-bound,
    hit 76-89%, **3.5-5.3 tok/s** su un telefono. Modelli diversi (120B vs 35B), ma siamo in un
    regime strutturalmente migliore — perché il nostro modello è 11.5 GB contro 59, quindi la
    cache ne copre una frazione molto maggiore.

  ### ⚠ Pattern metodologico: in carica i TEMPI non sono affidabili, nemmeno normalizzati

  Terza cella di fila (C, B, D2) in cui i conteggi deterministici reggono e i tempi no:
  dispersione di `work` fra repliche identiche del **25-27%**, contro una soglia di validità del
  ±10%. La metrica `work = compute × freq` regge solo quando il collo è la CPU; sotto pressione
  di memoria la CPU gira e **aspetta**.

  **Regola per i prossimi mandati: le campagne di timing si fanno SCOLLEGATE, o non si fanno.**
  In carica si misurano solo byte, hit, output e dimensioni — che però sono tantissime cose, e
  infatti tutte le conclusioni utili di F5.4 vengono da lì.

- **2026-08-07 — F5.4: la curva h(C) misurata dice +5.0 punti dove il simulatore ne prevedeva
  +11.8. E la metrica invariante che avevo proposto NON regge sotto pressione di memoria.**

  Cella C completa (in carica, ma hit e traffico sono deterministici ⇒ pienamente validi).

  ### La curva, riproducibile alla decimale

  | cache MiB | hit % | mib_tok | Δ hit | RSS picco |
  |---:|---:|---:|---:|---:|
  | 2000 | **71.1** | 32.93 | — | 4459 MB |
  | 2500 | **73.3** | 24.80 | +2.2 | 4554 |
  | 3000 | **75.1** | 18.35 | +1.8 | 4664 |
  | 3500 | **76.1** | 14.63 | +1.0 | 4646 |

  Le repliche danno hit **identico alla decimale** (71.1/71.1, 73.3/73.3, 75.1/75.1) — conferma
  che a `--temp 0` la sequenza di accesso è deterministica, come assumevamo senza averlo mai
  verificato su due run separati.

  **Totale 2000 → 3500: +5.0 punti di hit, −56% di traffico** (32.93 → 14.63 MiB/token). Forma
  concava corretta (+2.2, +1.8, +1.0). La regola dichiarata (≥+3 punti) è **superata**.

  ### ✅ D1 — `--ubatch` è TRASPARENTE sull'output (questione chiusa)

  Prompt da **1318 token** (>512, quindi il percorso a blocchi è stato davvero esercitato),
  `--temp 0`, **stesso file** per entrambi i run con `sha256` registrato.

  ```
  --ubatch 512  vs  --ubatch 2048   →   output BYTE-IDENTICI (1006 char, zero divergenze)
  ```

  Più forte di quanto avessi previsto: avevo detto *«matematicamente equivalente in teoria, ma
  la virgola mobile non è associativa quindi può divergere»*. Non diverge nemmeno di un bit. Il
  motivo: i kernel di matmul CPU riducono lungo assi fissi **indipendenti dalla dimensione del
  batch**, quindi l'ordine delle somme per ogni elemento di output non cambia — il batch è un
  asse separato, non un riordino.

  **Conseguenza: `--ubatch 512` si adotta senza alcun rischio di qualità**, e porta con sé i
  3.5 GB di RAM liberati e la sopravvivenza della sessione (F5.3-A1, 10/10 turni). Resta da
  misurare solo se un altro valore sia più *veloce* (cella D2, issue upstream #18725).

  E la divergenza F5.1 vs F5.3 resta attribuita **interamente all'accento** nel prompt, non a
  ubatch. La disciplina del prompt byte-identico con checksum — nata da quell'errore stamattina —
  ha pagato al primo utilizzo: senza, questo confronto sarebbe stato inconcludente come quello.

  ### ⚠️ RITIRATO — «il simulatore sovrastima di 2.4×» era un ERRORE MIO, non del simulatore

  > **Avevo scritto**: il simulatore prevede +11.8 punti fra cache 2000 e 3500, ne misuriamo
  > +5.0, quindi sovrastima di 2.4×; e per ricaduta il divario di Belady e il bake-off delle
  > politiche vanno scontati. **Tutto falso, ed è colpa mia.**

  **Causa (diagnosi F5.5-C):** confronto apples-to-oranges. Ho messo nella stessa tabella:
  - la **previsione** del simulatore: `lru_hit_req_dec`, **solo-decode**, sulla trace **corta**
    `short_bench` (102 prompt + 32 generati);
  - la **misura** F5.4-C: hit **cumulativo** (prefill+decode) su un **prompt italiano lungo**
    (1138 + 256).

  **Due metriche diverse su due carichi diversi.** Da lì ho concluso che lo strumento fosse
  rotto e ci ho costruito sopra una raccomandazione infondata.

  **Il simulatore è fedele**, verificato:
  - riproduce i propri numeri esattamente (Δ = 0.000);
  - **stessa trace, stessa metrica**: short `48.05` contro `48.1` misurato (−0.05 pt),
    long_512 `86.58` contro `86.6` (−0.018 pt).

  Ipotesi che avevo elencato come candidate per lo scarto, tutte **escluse**: capacità effettiva
  scontata (residente ≈ nominale), taglia della voce (è già per-layer; uniformarla muove +0.5 pt),
  prefetch non modellato, granularità di eviction (è già a livello di voce).

  **I verdetti M5/M5b REGGONO invariati**: Belady−LRU **+17.79** su short decode-only (vivo),
  **+6.2** su long cumulativo, LFU ≈ LRU, W-TinyLFU peggiore. Non c'era niente da riaprire.

  **La lezione è la mia stessa regola, applicata male.** Nella sezione STATO CORRENTE ho scritto
  *«chiedersi su QUALE CARICO si sta misurando prima di quale opzione vince»* — e poi ho
  confrontato una previsione su short_bench decode-only con una misura su prosa IT cumulativa.
  **Le previsioni portano con sé la traccia e la metrica su cui sono state fatte: confrontarle
  con altro è un errore di categoria, non un'imprecisione.**

  **Regola operativa nuova**: se una misura sul telefono dovrà essere confrontata con una
  simulazione, **catturare la route-trace INSIEME alla misura**. Per predire F5.4-C servirebbe
  la trace di quella specifica run, che non è stata raccolta — nessun blocco oggi, ma è il
  motivo per cui la verifica ha richiesto una diagnosi invece di un confronto diretto.

  ### ⚠ La metrica `work = compute × freq` NON regge qui (errore mio)

  L'avevo proposta come misura del calcolo invariante rispetto al throttling, giustificandola con
  F5.3 dove era costante entro il ±2%. In questa cella si sfascia:

  ```
  cache3000-r1   compute 0.394   freq 1.63 GHz   work   641 495
  cache3000-r2   compute 0.231   freq 1.61 GHz   work   371 374
  cache3500-r1   compute 0.842   freq 2.59 GHz   work 2 183 542   ← freq ALTA, compute pessimo
  ```

  Repliche della **stessa identica configurazione** che differiscono di 2×, e a 3500 un run con
  la CPU al massimo e il calcolo cinque volte peggiore. **Il motivo:** `work = compute × freq`
  assume implicitamente che il collo sia la CPU. Quando a stallare è la **memoria** — reclaim,
  cache che compete col buffer di calcolo — la CPU gira veloce e **aspetta**, e il prodotto
  esplode invece di restare costante. In F5.3 reggeva perché lì il vincolo era davvero termico.

  **Conseguenza operativa: di questa cella sono utilizzabili SOLO hit e traffico, non i tempi.**
  Quindi sappiamo che la cache grande taglia il traffico del 56% e **non sappiamo se questo si
  traduca in velocità**. Con l'RSS a 4.65 GB e la cascata OOM già vista, il costo potrebbe
  superare il beneficio. **Non promuovere cache 3000-3500 in config di prodotto su questa base.**

  ### La cascata OOM: confermata dal log di sistema, e la radice è E1

  Il primo tentativo a cache 2500 era morto con diagnosi «OOM sospetto, non loggato». Letto da
  adb il buffer eventi di Android (non accessibile da Termux), alle 13:26:47-48 in **1.2 secondi**:

  ```
  am_proc_died  com.sec.epdg · ext.services · gms.persistent · adservices · messaging:rcs
                mcfserver · nsflp2 · easysetup · com.google.android.gms · com.termux  ← ultimo
  ```

  **Dieci processi in 1.2 s**: non è stato scelto il nostro processo, è il **sistema intero**
  andato in reclaim d'emergenza, con Termux ultimo a cadere. L'aritmetica statica tornerebbe
  (`1664 + 2500 + 500 ≈ 4.7 GB` sotto i 5.6), ma **il loader fa fault su 20.76 GiB di file**
  [M, F4.8]: quelle pagine riempiono la page cache e azzerano il margine.

  **Quindi E1 è la radice comune di tre problemi distinti**: i ~17 s di TTFT, il picco termico a
  92 °C, e la fragilità di memoria. Tre sintomi, una causa, un fix.

  ### Bug operativo: sshd riavviato da adb ha perso l'ambiente Termux

  Dopo la cascata OOM, sshd è stato riavviato via adb e **ha ereditato l'ambiente Android nudo**:
  `PREFIX` non definito, `$PREFIX/bin` assente dal PATH. Ogni sessione ssh figlia lo eredita.
  `termux-battery-status` sembrava «mancante» ma era solo irraggiungibile.

  **Portata reale, verificata (Grok):** il **gate termico legge da sysfs**
  (`/sys/class/thermal/...`), che **non dipende dal PATH** ⇒ è rimasto attivo per tutte le celle
  C e **i die registrati sono letture vere**. Il **gate batteria** era invece cieco (ritornava
  `-1`) dopo il ripristino via adb — ma in F5.4 il floor di batteria era **disabilitato per
  progetto** (mandato in carica), quindi l'impatto è nullo su questa fase.

  **Resta però la lezione generale, che vale per i prossimi mandati non-in-carica**: un gate che
  legge da un comando esterno fallisce *aperto* (non trova il comando → non blocca → prosegue),
  mentre un gate che legge da sysfs fallisce *chiuso*. **Preferire sempre sysfs dove esiste**, e
  dove non esiste, far fallire il gate in modo esplicito invece che silenzioso.

  Fix: `export PREFIX=/data/data/com.termux/files/usr; export PATH=$PREFIX/bin:$PATH` nel wrapper
  del launcher, non affidandosi al profilo.

- **2026-08-07 — F5.2: IL PROFILER RISPONDE. Il GEMM degli esperti è metà del calcolo,
  l'attenzione è il 7%, e il calo sostenuto è RIDUZIONE DI FREQUENZA, non contesto. Tre mie
  affermazioni cadono.**

  Report `reports/moe-f5.2.md`, commit `0f34855`. Le quattro celle usavano solo flag già
  presenti nel binario, mai usati prima.

  ### C1 — dove va il calcolo (`--compute-trace`)

  | bucket | @300 tok | quota | @1500 tok | quota |
  |---|---:|---:|---:|---:|
  | **GEMM esperti** (`MUL_MAT_ID` gate+up+down) | 98.7 ms | **50.5%** | 151.2 ms | **50.0%** |
  | esperti totale (+ dispatch) | 106.5 | **54.5%** | 164.7 | **54.5%** |
  | attenzione piena (10 layer) | 9.2 | 4.7% | 20.5 | **6.8%** |
  | └ `FLASH_ATTN_EXT` da solo | 2.12 | 1.1% | **9.27** | 3.1% |
  | attenzione GDN (30 layer) | 27.6 | 14.1% | 43.0 | 14.2% |
  | router + barriere | 8.9 | 4.5% | 12.9 | 4.2% |

  **Nessuna delle tre soglie che avevo dichiarato scatta**, ma il segnale pratico è netto: il
  GEMM degli esperti è **metà del calcolo e la sua quota non cambia col contesto**.

  ### ⚠ Correzione 1 — «su conversazione lunga il collo è l'attenzione, non il MoE». Falso.

  L'avevo scritto ieri leggendo il +41% di `compute` di F5.1. L'attenzione piena è il **6.8%**
  del token a 1500 di contesto, non il 30%. `FLASH_ATTN_EXT` cresce sul serio (×4.4: 2.12 →
  9.27 ms/tok) ma parte da così poco che resta il **3.1%**. Il ramo quantizzazione/kernel
  attacca il bucket giusto — è quello sbagliato che avevo indicato io.

  ### ⚠ Correzione 2 — «il calo è il contesto, non il termico». Falso, e il ragionamento era rovesciato.

  Guardando la crescita **assoluta** di ogni bucket fra 300 e 1500 token:

  ```
  GEMM esperti   +53%      attenzione GDN  +56%      router     +47%
  shared_ffn     +59%      barriere        +43%      rest       +49%
  ────────────────────────────────────────────────────────────────────
  lm_head         +9%      FLASH_ATTN_EXT +337%   ← le uniche due eccezioni
  ```

  **Quasi tutto rallenta dello stesso ~50%, incluso il GEMM degli esperti — il cui lavoro per
  token è IDENTICO a qualunque contesto** (8 esperti × 40 layer, fisso). Se un lavoro invariante
  richiede il 53% di tempo in più, non è cambiato il lavoro: **è rallentata la macchina.** Un
  rallentamento uniforme su bucket invarianti è la firma di una **riduzione di frequenza**.

  E il mio errore di lettura era peggiore del verdetto: in F5.1 avevo concluso «il die respira
  fra 72 e 76 °C senza accumulare, quindi non è termico». **È l'inverso.** Un die che resta
  piatto mentre il carico si prolunga è la prova che il governor **sta funzionando** — e il modo
  in cui tiene la temperatura è tagliare la frequenza. La temperatura stabile era il sintomo
  del throttling, non la sua assenza.

  **Verifica diretta, cheap, da fare**: campionare `cpufreq/scaling_cur_freq` (non `max_freq`,
  che è un tetto e infatti non si muove mai) durante un run lungo. Chiude la questione in un run.

  ### ⚠ Correzione 3 — avevo riaperto F6 sull'asse RAM. Chiusa, per due ragioni pratiche.

  - **`--mtp` fallisce**: `error: --mtp needs a model with a trained MTP head, and this gguf has
    no nextn block`. **Il nostro GGUF di prodotto non porta la testa MTP.**
  - **`--ngram` non ha mai draftato**: `drafted on 0 of 128 steps` su prosa italiana libera.
    Senza ripetizioni non trova match, e il ±6% fra le varianti è rumore termico (`mib_tok`
    identico a 32.40, accept 0).

  Il mio argomento sui 267 MB/token di pesi letti dalla RAM **non è stato confutato**: è
  rimasto **non misurabile**, perché nessuno dei due meccanismi riesce a produrre un draft su
  questo modello e questo carico. **F6 chiusa su due assi** (flash in M5, RAM qui). Si riapre
  solo con un GGUF MTP vero, o su carichi ad alta ridondanza (codice), non sulla chat.

  ### C4 — le leve lossy, e una convalida incrociata elegante

  | | tok/s | compute | mib_tok | qualità (lettura umana) |
  |---|---:|---:|---:|---|
  | k=8 (default) | 4.045 | 0.197 | 47.52 | riferimento |
  | k=6 | 3.719 | 0.209 | 26.14 | **indistinguibile** da k=8 |
  | **k=4** | **5.296 (+31%)** | **0.152** | 13.12 | **visibilmente peggiore**: sbaglia l'aritmetica del budget, inventa un vettore aereo, deforma i toponimi |
  | drop F=1.0 | 4.859 (+20%) | 0.176 | **7.78** | struttura ok, errori sparsi |

  **La convalida incrociata**: `k=4` dimezza il lavoro degli esperti. Se il GEMM esperti è il
  50.5% del calcolo, il compute dovrebbe scendere di `0.505/2 = 25%` ⇒ `0.197 × 0.7475 = 0.147`.
  **Misurato: 0.152.** Entro il 3%. **Un esperimento indipendente conferma la ripartizione di
  C1** — cosa che nessuno aveva chiesto e che vale più del verdetto formale.

  Nota di cautela già nel report: `k=6` più lento di `k=8` è **anomalo** (una sola replica,
  stati termici diversi). Non usare quel confronto senza ripetizione.

  **Informazione forte comunque**: a **k=6 il modello non collassa**. Instrada 8 esperti quando
  su questo testo 6 gli bastano. Ma nessuna leva lossy entra in prodotto senza il metro di
  perplessità, che resta bloccato.

  ### Dove porta

  Il GEMM degli esperti è **metà del calcolo, invariante col contesto, e riducibile** — lo
  dimostra k=4. Un kernel ARM veloce su quel bucket, a parità di lavoro, vale:

  ```
  GEMM esperti 2× più veloce ⇒ compute −25% ⇒ decode 0.197 → 0.148 ⇒ +33% di tok/s
  ```

  **E il risparmio si compone col termico**: meno tempo di calcolo per token significa meno
  energia dissipata, quindi meno riduzione di frequenza, quindi meno degrado nel sostenuto. È
  l'unica leva che attacca insieme il picco e la tenuta.

  **Ordine confermato dai dati**: ri-quantizzazione **Q4_0 / IQ4_NL** (giorni, percorsi ARM già
  ottimizzati in mainline) **prima** del kernel IQ2 a mano (settimane).

- **2026-08-07 — 🔴 LA SESSIONE È MORTA AL TURNO 6, E LA CAUSA SPIEGA TUTTI I PROBLEMI DI RAM
  DELLA CAMPAGNA: il buffer di calcolo è dimensionato su `n_ctx` perché nessuno ha limitato
  `--ubatch`.**

  F5.1 non ha completato 8 turni: il turno 6 è una riga di zeri in `turns.csv`
  (`n_prompt=0, tokens=0, tok_s=0, hit=-1`, contatori `/proc` in negativo) e il master log dice
  `sampler exit (bmoe dead)` → `TURN 6 FAIL rc=1 line=DEAD`.

  **Non era overflow del contesto** (`n_ctx=4096`, il turno 6 ne chiedeva ~2030). La riga che
  spiega tutto è nello stderr della sessione:

  ```
  sched_reserve: CPU compute buffer size = 4008.16 MiB
  ```

  `--ubatch` ha come default *«as wide as the context»*, quindi con `n_ctx=4096` il buffer di
  calcolo viene riservato per **4096 token in un colpo**:

  ```
  dense anon          1664 MiB
  cache esperti       2000 MiB
  buffer di calcolo   4008 MiB
  overhead             ~300 MiB
                     ─────────
                     ~7.7 GB    contro i ~5.6 GB dove lmkd uccide
  ```

  ⇒ **ucciso da lmkd.**

  ### Il rapporto è esattamente lineare, e il rimedio è un flag che avevamo già

  | n_ctx / ubatch | buffer di calcolo | fonte |
  |---:|---:|---|
  | 512 | **501.52 MiB** | log F4.8 [M] |
  | 4096 | **4008.16 MiB** | log F5.1 [M] |

  `4008/501.5 = 7.99` contro `4096/512 = 8.00`. **≈0.98 MiB per token di ubatch.** Quindi
  `--ubatch 512` tiene `n_ctx=4096` per le conversazioni lunghe pagando **500 MiB invece di
  4000**, e libera **~3.5 GB**. Il costo è che il prefill viene spezzato in blocchi da 512 —
  comportamento standard, effetto trascurabile sul throughput.

  ### Cosa questo spiega, a posteriori, di tutta la campagna

  Ogni problema di memoria che ci portiamo dietro da giorni ha ORA una causa unica e nota:

  | sintomo | quando | spiegazione |
  |---|---|---|
  | `cache-mb 3000` uccisa in `create_tensor` | F4.4 | budget totale oltre lmkd |
  | `memfree_min_mb = 12` | F4.9 (`n_ctx=2048`) | ~2 GB di buffer di calcolo |
  | sessione morta al turno 6 | F5.1 (`n_ctx=4096`) | ~4 GB di buffer di calcolo |

  **Non eravamo al limite della RAM per natura del problema: eravamo al limite perché nessuno
  aveva limitato `ubatch`.** È la quinta volta che una funzionalità già presente nel runtime
  cambia una conclusione — e stavolta la conclusione era «8 GB di RAM sono il vincolo duro».

  ### Cosa si apre

  Liberati ~3.5 GB, tornano praticabili cose che avevamo archiviato come impossibili:
  - **`--cache-mb 3000-3500`**, mai misurata in regime valido (h(C) ha ancora un solo punto
    reale); il simulatore prevede un guadagno modesto ma il ramo non era chiuso per merito, era
    chiuso per lmkd.
  - **Conversazioni lunghe senza morire**: `n_ctx` 8k-16k con `--ubatch` piccolo, che è
    esattamente ciò che serve a un prodotto di chat.
  - **Margine termico e di memoria** per la speculazione (`--mtp` alloca il draft).

  **Da fare subito, costa un flag**: rieseguire F5.1 con `--ubatch 512` e `n_ctx` alto, e
  vedere fino a che turno arriva. È anche l'unico modo di sapere se la curva del sostenuto si
  assesta — cosa che i 5 turni disponibili non dicono.

- **2026-08-07 — 🔴 F5.1: IL PROBLEMA N.1 DEL PRODOTTO NON È LA VELOCITÀ. Ogni messaggio
  ri-prefilla l'intera conversazione: 165 s di attesa al quinto turno. E la cache degli
  esperti invece persiste — le due persistenze hanno esito opposto.**

  Prima conversazione vera della campagna: 5 turni consecutivi in `--session`, **senza
  cooldown**, italiano, contesto che cresce davvero (viaggio in Sicilia, budget, vincolo
  bambino). Report `reports/moe-f5.1.md`.

  ### Misura A — le due persistenze, esiti opposti

  | turno | n_prompt | TTFT | hit% |
  |---:|---:|---:|---:|
  | 1 | 97 | **9.1 s** | 79.6 |
  | 2 | **436** | **41.2 s** | 77.6 |
  | 3 | **776** | **76.3 s** | 76.3 |
  | 4 | **1119** | **123.9 s** | 76.1 |
  | 5 | **1441** | **165.3 s** | 75.9 |

  - **KV: PER-MESSAGGIO.** `n_prompt` non è il messaggio nuovo (~80-100 token): è **l'intero
    contesto accumulato**, e cresce di ~+330 a turno. Il TTFT scala quasi linearmente.
  - **Cache esperti: CALDA.** 79.6 → 75.9%, non crolla al ~3% da freddo. **Sopravvive fra i
    turni.** Era la distinzione che avevo chiesto di fare, ed era giusto farla: gli esperti sì,
    il KV no.

  **Precisione che il report tiene bene**: non dice che il KV «non esiste», dice che l'API di
  sessione con `clear_kv=false` + `--chatml` **ri-prefilla**. Cioè è un problema di **riuso del
  prefisso**, non di memoria. È esattamente ciò che `llama-server` risolve col match del
  prefisso comune. **Ingegneria, non ricerca.**

  ### L'aritmetica dell'esperienza utente

  ```
  turno 1:   9 s di attesa + 256 tok / 4.78 tok/s =  54 s  ⇒   63 s
  turno 5: 165 s di attesa + 256 tok / 3.54 tok/s =  72 s  ⇒  237 s   (~4 minuti)
                ↑ il 70% del turno è ri-lettura di ciò che il modello ha già letto
  ```

  Con il prefill incrementale il turno 5 diventerebbe `~10 s + 72 s ≈ 82 s`: **−65% di latenza
  percepita**, senza toccare né il decode né la qualità né un solo bit del modello.

  **Questa voce scavalca tutto il resto del piano**, kernel IQ2 compreso: nessuna ottimizzazione
  del decode può recuperare 165 secondi, e il decode è la parte che l'utente aspetta *meno*.

  ### Misura B — il sostenuto non regge, e il calo NON è solo termico

  | turno | tok/s | compute | stall | die inizio→fine (picco) |
  |---:|---:|---:|---:|---|
  | 1 | 4.776 | 0.159 | 0.040 | 64.4→64.4 (90.3) |
  | 2 | 4.274 | 0.180 | 0.041 | 53.1→59.9 (75.8) |
  | 3 | 3.843 | 0.204 | 0.041 | 52.1→58.9 (73.3) |
  | 4 | 3.800 | 0.205 | 0.044 | 53.9→60.1 (72.1) |
  | 5 | **3.539** | **0.225** | 0.044 | 51.8→59.3 (73.3) |

  **−26% su cinque turni**, discesa monotona, sotto 4.0 dal terzo. Il criterio di prodotto
  («ultimi 3 entro il 10% e sopra 4.0») **non regge**.

  **Ma il die NON accumula**: respira fra 72-76 °C nei turni e 52-55 °C in mezzo, senza deriva
  verso i 98. Eppure `compute` sale del **41%** mentre `stall` resta piatto a 0.04. Quindi il
  termico non basta a spiegarlo, e il candidato è il **contesto che cresce**: i 10 layer di
  attenzione piena costano di più man mano che la sequenza si allunga. **È un secondo effetto
  sul calcolo, strutturale e distinto dal throttling**, e nessuna delle nostre misure precedenti
  poteva vederlo perché erano tutte a contesto fisso e corto.

  **Da separare con una misura** (facile): due sequenze di turni, una a contesto che cresce e
  una a contesto troncato costante, stessa durata. Se il calo resta solo nella prima, è il
  contesto; se c'è in entrambe, è termico.

  ### Misura C — quello che è venuto gratis

  - **Qualità multi-turno: sufficiente.** Il filo regge su 5 turni (il T3 cita esplicitamente i
    vincoli introdotti prima), nessuna parola malformata evidente. Difetti: qualche imprecisione
    geografica e una confusione sul budget. Il troncamento a metà frase è **artefatto di
    `-n 256`**, non del modello.
  - **Sopravvivenza: OK.** RSS stabile 3.8-4.1 GB, nessun kill di lmkd, sessione ancora viva al
    turno 6.
  - **Sicurezza: mai sopra 98 °C**, batteria 85 → 78%.

  ### Riordino delle priorità

  | # | cosa | perché ora |
  |---|---|---|
  | **1** | **prefill incrementale (riuso del prefisso)** | **−65% di latenza percepita al turno 5. Ingegneria nota, non ricerca** |
  | 2 | `--compute-trace` | dove vanno i 0.159→0.225 s/token — e **quanto è attenzione contro esperti** al crescere del contesto |
  | 3 | separare termico da contesto | una misura, decide se il calo è governabile |
  | 4 | `--ngram` / `--mtp` | F6 sull'asse RAM |
  | 5 | `--n-expert-used` | leva diretta su calcolo e traffico |
  | 6 | ri-quantizzazione Q4_0/IQ4_NL | versione economica del kernel |
  | 7 | kernel IQ2 a mano | solo se 2 lo giustifica e 6 non basta |

- **2026-08-07 — RILETTURA DEL PIANO PRIMA DEL KERNEL (richiesta di gualt). Il runtime contiene
  già un profiler del calcolo, un motore di speculazione e un override del top-k, e non ne
  abbiamo mai usato nessuno. Inoltre due delle sei ipotesi vanno rivalutate, e MTP l'ho ucciso
  sull'asse sbagliato.**

  ### 1. Le sei ipotesi di §6, ri-giudicate sul carico vero

  | | ipotesi | attesa | esito |
  |---|---|---|---|
  | H1 | località temporale, hit ≥80% con cache ≈2× working set | 81-97% | **CONFERMATA e superata**: 89% con una cache che è **0.37×** il working set (2 GB contro 5.35 GB di esperti distinti a 512 token). Meglio della letteratura, con un rapporto molto peggiore |
  | H2 | cache 2 GB riduce il traffico ≥5× vs naive, ≤50 MB/token | ≤50 | **SODDISFATTA — avevo sbagliato a dichiararla falsificata.** Sul benchmark 88.8 MB/token (fallisce), ma sul **carico vero 33.96 MiB = 35.6 MB/token** ⇒ `305.2/35.6 =` **8.6×**, ben oltre il 5× richiesto |
  | H3 | il prefetch predittivo batte LRU/LFU | +5-15 pt | **FALSIFICATA**: Recall@8 19.2%, extra-fetch 274%, e nessuna politica batte LRU sul carico vero |
  | H4 | MTP riduce i caricamenti per token utile | 1.45× | **falsificata sul flash, MA VEDI §3: uccisa sull'asse sbagliato** |
  | H5 | il degrado sotto pressione è governabile con cache esplicita | 5.0 vs 0.09 | **CONFERMATA** |
  | H6 | riordinare gli esperti converte random in sequenziale | — | **PARZIALE**: `iobench` dà 1.26×, ma ora che l'I/O esposto è il 20% del decode il premio è tagliato in proporzione |

  **Due correzioni al mio stesso verbale**: H2 non era falsificata, lo era la sua misura sul
  benchmark; e H1 è confermata in modo più forte di come la letteratura la formulava.

  ### 2. ⚠ L'audit della superficie dei flag: il runtime ha molto più di quanto usiamo

  È la **quarta** volta che scopro una funzionalità dopo aver costruito un'analisi che la
  assumeva assente (`--session`, `tools/iobench`, i contatori a finestre, e ora questa lista).
  Ho quindi eseguito `bmoe-cli --help` per intero. Mai usati:

  | flag | cosa fa | perché conta ORA |
  |---|---|---|
  | **`--compute-trace` / `--compute-trace-layers`** | **profila il calcolo** | **stavamo per scrivere un kernel IQ2 senza sapere dove vanno i 0.124 s/token** |
  | **`--n-expert-used N`** | override del top-k, *«lower = faster»* | leva **diretta** su calcolo *e* traffico, zero codice, solo qualità da misurare |
  | **`--mtp` / `--ngram` / `--draft N`** | speculazione già implementata | vedi §3 |
  | `--drop-cold-experts F` | salta un esperto in miss di peso basso | lossy, taglia insieme flash e calcolo |
  | `--prefetch K`, `--route-ahead`, `--predict-prefetch`, `--predict-log` | prefetch predittivo | il piano (F7.3) diceva di usarli come baseline; mai fatto |
  | `--progress`, `--csv`, `--io-trace` | telemetria per token / per lettura | risponde a «la velocità cala DENTRO una generazione?» |
  | `--io-two-wave`, `--ubatch`, `--no-odirect` | varianti del percorso I/O | `--no-odirect` è l'A/B che chiude la vecchia disputa sulla page cache |

  **Regola operativa che ne ricavo, e che vale per il futuro: prima di progettare qualcosa,
  leggere `--help` per intero.** Quattro analisi di questa campagna sono state costruite su
  un'assunzione di assenza, e quattro volte l'assunzione era falsa.

  ### 3. ⚠ Correzione mia: ho ucciso MTP sull'asse sbagliato

  Ho dichiarato F6 morta perché MTP non ammortizza i byte di **flash** — e quel ragionamento
  regge: con LRU che tiene una voce ~24 token, un esperto condiviso fra t e t+1 costa una
  lettura con o senza MTP (`miss@t ∧ miss@t+1 = 0.00%`, misurato).

  **Ma il flash è la parte piccola.** Per token il calcolo legge dalla **RAM**:

  ```
  8 esperti × 40 layer × 0.942 MB = 301 MB/token di pesi letti dalla RAM
  di cui dal flash: 34 MiB (i miss)  ⇒  dalla RAM: ~267 MB
  a 6 tok/s ⇒ ~1.8 GB/s di traffico RAM solo per i pesi degli esperti
  ```

  **Quei 267 MB non li avevo considerati.** Verificare k token in un batch legge l'unione dei
  loro esperti **una volta sola** invece di k volte, e trasforma k GEMV separate in una GEMM a
  k colonne. Con una sovrapposizione misurata del ~36% fra token consecutivi, un batch da 4
  leggerebbe ~205 slot/token invece di 320: **−36% di traffico RAM**, più l'efficienza della
  GEMM. Su un sistema **compute-bound** è esattamente il risparmio che serve.

  **F6 si riapre, sull'asse RAM+calcolo invece che flash.** E il costo del test è nullo: `--mtp`
  e `--ngram` esistono già nel binario. `--ngram` in particolare ha un draft che costa
  praticamente zero (guarda i token recenti nel prompt), quindi il rischio di draft rifiutati
  costosi è minore che con MTP.

  ### 4. Le estensioni F9, rilette

  1. **Quantizzazione mista per-esperto (F9.1) — SI CAPOVOLGE.** Era «hot a 3-4 bit residenti,
     cold a 2 bit su flash», cioè meno byte. Ma ora siamo **compute-bound con l'80% della banda
     di storage inutilizzata** (425 di 1204 MiB/s). Il baratto giusto corre **al contrario**:
     conviene una quantizzazione **più grande ma più veloce da calcolare**. E sappiamo quale —
     **Q4_0 e IQ4_NL hanno percorsi ARM veloci in mainline, IQ2 no** (codebook, ostile alla
     cache). È la versione **economica** dell'idea del kernel: giorni di ri-quantizzazione
     invece di settimane di NEON scritto a mano, per lo stesso obiettivo. Contro: esperti 1.86×
     più grandi ⇒ meno voci nella stessa cache ⇒ hit più basso. **Ambiguo, e solo la misura
     decide** — ma è la stessa ambiguità che il piano già annotava («pool −25% ma quant +1
     tier»), letta con il collo di bottiglia giusto.
  2. **Expert packing (F9.2)**: premio tagliato dal 20% di quota I/O.
  3. **DraftExpert (F9.3)**: resta l'ultima delle speculazioni, dopo `--ngram` e `--mtp` che
     sono gratis.
  4. **Binario prodotto / llama.rn (F9.4)**: si lega direttamente alla domanda sulla sessione —
     è il posto dove si decide se il processo resta vivo fra i messaggi.
  5. **Multi-device (F9.5) — SI RIFORMULA.** Era «UFS 4.0 per lo storage più veloce». Ma lo
     storage non è più il collo: **serve CPU sostenuta e massa termica**. Un S25 conta per il
     silicio, non per il flash; e un tablet, con più superficie di dissipazione, potrebbe essere
     un prodotto migliore di un telefono.

  ### 5. Ordine proposto, che mette il kernel DOPO le cose gratis

  | # | cosa | costo | cosa decide |
  |---|---|---|---|
  | 1 | **`--compute-trace`** sul carico vero | ore | **dove vanno i 0.124 s/token.** Prerequisito del kernel: senza, si ottimizza alla cieca |
  | 2 | **F5.1 sessione multi-turno** (già scritta) | un run | TTFT per-sessione o per-messaggio + dove si assesta il sostenuto |
  | 3 | **`--ngram` e `--mtp` A/B** | un run | F6 sull'asse RAM: −36% di traffico pesi previsto |
  | 4 | **`--n-expert-used` 8→6→4** | un run + qualità | leva diretta su calcolo e traffico insieme |
  | 5 | ri-quantizzazione Q4_0/IQ4_NL | giorni | la versione economica del kernel |
  | 6 | **kernel IQ2 a mano** | settimane | solo se 1 dice che la GEMM degli esperti domina *e* 5 non basta |

- **2026-08-07 — F4.9: ⚠ IL DIE ARRIVA A 92 °C E IL CALO SOSTENUTO ESISTE — ma è tutto sul
  CALCOLO, non sull'I/O. Risposta a F5 arrivata da una cella che non doveva cercarla.**

  ### Cella A — lo scalino di F4.7 era REALE

  A batteria 100%, config del gate: cold 5.02, warm 5.06 / 4.87 (nproc=7) / sentinella 5.01.
  **Mediana warm 5.01 ≈ baseline 5.02**, tutte entro ±3%, anti-drift 0.9%. ⇒ il calo del 5%
  sotto il 13% di carica **non era deriva di sessione**: la curva F4.7 è **valida**. Il
  controllo obbligatorio è chiuso, e la finestra è stata usata.

  ### Cella B — compute-bound confermato, e il modo in cui lo conferma è più forte del verdetto

  | rep | eval | decode | compute | stall | **stall/decode** | **mib_tok** | load_s | T_batt |
  |---|---:|---:|---:|---:|---:|---:|---:|---|
  | 1 (cold) | **6.07** | 0.165 | 0.124 | 0.034 | **20.6%** | **33.96** | 115 | 29.9→36.5 |
  | 2 warm | **5.40** | 0.185 | 0.141 | 0.038 | **20.5%** | **33.96** | 126 | 29.3→36.4 |
  | sentinella | **4.59** | 0.218 | 0.166 | 0.045 | **20.6%** | **33.96** | 144 | 31.4→38.2 |

  Verdetto formale: `stall/decode 20.6% ≤ 25%` e `compute 0.141 ≥ 0.11` ⇒ **COMPUTE-BOUND
  CONFERMATO** nel regime valido, scollegato. Il ramo I/O è chiuso non più per inferenza da un
  run in carica, ma per misura.

  **Ma l'isolamento è la parte importante.** Su tre rep consecutive, con 180 s di cooldown fra
  l'una e l'altra:

  ```
  traffico       33.96 MiB/token   IDENTICO   (deterministico, come deve)
  quota I/O      20.6%             IDENTICA
  compute        0.124 → 0.166     +34%
  velocità       6.07 → 4.59       −24%
  caricamento    115 s → 144 s     +25%
  ```

  **Stessi byte, stesso I/O, un terzo di tempo di calcolo in più.** Non c'è modo di attribuirlo
  a qualcosa che non sia il **throttling termico della CPU**. La sentinella fallisce l'anti-drift
  (20% > 15%) e lo segnala correttamente: non è rumore di misura, è degrado fisico.

  ### Il numero che nessun protocollo di questa campagna aveva mai visto: 92 °C

  Curva del die (max `cpu-*`, campionata a 500 ms, rep 2):

  ```
  t=0     53.9 °C   (attach)
  t=6.5   77.8 °C   (load)
  t≈40    92.0 °C   ← PICCO
  t=70-90 78-86 °C  (decode)
  t=125   70.9 °C
  ```

  Sentinella: picco **90.3 °C**. **Per tutta la campagna abbiamo gattato su un sensore che
  segnava ≤30 °C mentre il silicio stava a novanta.** La voce del Registro che segnalava il
  gate sul sensore sbagliato stimava uno scarto di 16 °C sulla base di un burst da 13 s; sul
  carico vero lo scarto è di **sessanta**.

  Nota che il picco è **durante il caricamento**, non durante il decode — coerente con E1: i
  20.76 GiB di I/O inutile più la conversione dense sono anche la fase più calda. **Il fix del
  loader non è solo TTFT: è meno calore all'inizio di ogni sessione**, cioè più margine termico
  per il decode che segue.

  ### ⚠ Correzione a quanto avevo scritto stamattina

  Avevo chiuso la voce «la generazione lunga è il caso buono» dicendo che *«il timore che il
  sostenuto crollasse non si materializza»*. **Vero per la cache, falso per il sistema.** La
  cache è piatta su 512 token (+0.48 pp, misurato), ma il **calcolo** degrada del 34% su tre
  esecuzioni consecutive. Avevo verificato il meccanismo che sospettavo e concluso sull'intero
  sistema: errore di portata, non di misura.

  **Riformulazione definitiva di F5**: memoria ✅ non cresce, KV ✅ trascurabile (DeltaNet),
  cache ✅ piatta, **termica ❌ è il collo, e agisce sul calcolo**.

  ### Cosa cambia nelle priorità

  1. **Il kernel IQ2 vale il doppio di quanto pensassimo.** Non solo alza il tetto (7.87 → ~14):
     meno tempo di calcolo significa **meno energia dissipata per token**, quindi meno
     throttling, quindi meno degrado sostenuto. È l'unica leva che attacca insieme velocità di
     picco e tenuta nel tempo.
  2. **Il fix del loader guadagna una seconda ragione**: toglie il picco termico a 92 °C
     dall'inizio di ogni sessione.
  3. **Il numero di prodotto non è 6.07 né 5.40.** In uso sostenuto reale — turni consecutivi
     senza 180 s di cooldown fra l'uno e l'altro — è **≤ 4.6 e in calo**. Ogni cifra di questo
     piano va letta con questa in mente.
  4. **Serve un run F5 vero**: turni back-to-back senza cooldown, die campionato, finché non si
     stabilizza. Solo così si sa dove si assesta la curva invece di dove comincia.

  ### Deviazioni dichiarate (F4.9)

  - Gate termico **31.5 °C** (batteria) per la sola cella B — il gate a 30.0 è tarato su burst
    e in ambiente caldo va in stallo (osservati 660 s a 30.5).
  - **`n_ctx=2048`** (il gate usa `-c 512`, ma 143 prompt + 512 generati = 655 non ci stanno).
    Le due prime rep sono fallite per questo; restano in `runs.csv` come FAIL storici.
  - Rep 1 **non rifatta** dopo l'innalzamento del gate: i dati F4.7 mostrano nessuna
    correlazione fra T di partenza e throughput su 28.5-31.3 °C, e l'autoriscaldamento (6.6-7.1
    °C/rep) domina di 4× la differenza di soglia. La tabella `T_batt start→end` è nel report,
    quindi la non-correlazione è **verificabile**, non assunta.

- **2026-08-07 mattina — LA GENERAZIONE LUNGA È IL CASO BUONO, non quello cattivo. E c'è un
  buco nel piano che vale più di tutte le leve rimaste: la MODALITÀ SESSIONE, che esiste nel
  runtime e non abbiamo mai usato.**

  ### Tre dei quattro meccanismi temuti sono misurati e assenti

  F5 («Stabilità: memory pressure, termica, lunga durata») è impostata attorno al timore che il
  lungo periodo sia peggio del burst — il 4B denso di controllo perdeva metà (8.90 → 4.68
  [M, F2.4]). Sul MoE in streaming, misurato:

  | meccanismo temuto | misura | esito |
  |---|---|---|
  | la RAM cresce con la lunghezza | RSS ~4.6 GB a 64 token **e** a 512 | **assente** |
  | la KV esplode | ~10-20 KB/token ⇒ ~40 MB a 4k | **trascurabile** |
  | la cache degrada | hit per blocchi da 64 tok: 87.1 · 90.8 · 90.4 · 89.2 · 88.7 · 89.0 · 89.2 · 89.6 | **assente** (+0.48 pp) |
  | il termico | batteria +6.6 °C ogni 90 s di decode (29.9 → 36.5) | **vivo, unico superstite** |

  **La KV è trascurabile per una ragione architetturale, non per fortuna**: `full_attention_interval=4`
  ⇒ solo **10 layer su 40** hanno attenzione piena; gli altri **30 sono Gated DeltaNet**, cioè
  attenzione lineare con **stato di dimensione fissa**, che non cresce col contesto. Un denso
  classico da 40 layer pagherebbe ~4× la KV. È il regalo strutturale di questa architettura, e
  vale la pena saperlo perché **rende il contesto lungo economico** proprio dove ce lo
  aspettavamo caro.

  **Riformulazione di F5**: non è più «regge il lungo periodo?» ma **«regge il termico?»**. Tre
  quarti della fase sono già risolti senza averla eseguita.

  ### ⚠ Il buco: `bmoe-cli` ha una modalità sessione e non l'abbiamo mai usata

  Dallo schema della route-trace, prima colonna:

  ```
  turn | int | session-mode turn (0 for a one-shot run)
  ```

  **Tutti i nostri run, senza eccezione, sono `turn=0` — one-shot.** Ma il prodotto è una chat
  multi-turno, e la domanda che ne discende è la più importante rimasta aperta:

  > **A ogni turno il prefill si ripaga da capo?**

  Il prefill costa **~45.7 MiB/token** a cache fredda (4.55 GiB per 102 token [M, F4.8]).
  Se KV e cache esperti **non** sopravvivono fra un messaggio e l'altro, il costo cresce col
  procedere della conversazione, perché ogni turno ri-prefilla **tutto lo storico**:

  ```
  turno 1 (≈150 tok di contesto):    ~7 GiB      → TTFT ~28 s
  turno 3 (≈1500 tok):              ~30-60 GiB   → TTFT ~30-60 s
  turno 5 (≈2400 tok):              ~48+ GiB     → TTFT ~40-60 s
  ```

  Cioè **il TTFT di 28 s non sarebbe il costo di apertura dell'app: sarebbe il costo di OGNI
  risposta, e crescente**. Se invece il processo resta vivo e KV + cache esperti persistono,
  si paga una volta per sessione e ogni turno successivo prefilla solo i token nuovi, con la
  cache già calda al ~89%.

  **Questa è una domanda di INTEGRAZIONE, non di runtime**: dipende da se il prodotto tiene il
  processo vivo fra i messaggi o ne lancia uno per messaggio. Un'integrazione ingenua fa la
  seconda, e pagherebbe **19 s di caricamento + prefill completo a ogni messaggio**.

  **Perché ha il miglior rapporto valore/costo di tutto ciò che resta**: non richiede di
  scrivere niente. La modalità esiste. Richiede di misurare **due turni invece di uno** e
  guardare il traffico del secondo. Confronto:

  | leva | costo | guadagno atteso |
  |---|---|---|
  | **sessione multi-turno** | **una misura** | **decide se il TTFT è per-sessione o per-messaggio** |
  | fix del loader | 2-4 giorni | −17 s di TTFT, una volta per sessione |
  | kernel IQ2 | settimane | tetto 7.87 → ~14 tok/s |
  | politiche di cache | — | **zero** (misurato) |

  **Da fare come prossima cella, prima del kernel e prima del fix del loader**: due turni
  consecutivi in modalità sessione, e misurare `read_bytes` e TTFT del **secondo**. Se il
  secondo turno prefilla solo il delta, il prodotto è già molto meglio di come lo raccontiamo.
  Se ri-prefilla tutto, quella è la prima cosa da sistemare e rende marginale tutto il resto.

  ### Decisioni operative su F4.9 in corso

  - **Cancello termico alzato 30.0 → 31.5 per la sola cella B.** Motivo: la soglia era tarata
    su burst da 13 s; il carico lungo scalda la batteria di 6.6 °C per rep e in ambiente caldo
    non ridiscende (stallo osservato di 660 s a 30.5 °C).
  - **Il rep già riuscito (6.07, `batt_temp_start=29.9`) NON si rifà.** Avevo proposto di
    rifarlo per uniformità termica; **gualt ha obiettato ed aveva ragione**, e i dati lo
    confermano: in F4.7 su 2.8 °C di escursione della T di partenza (28.5-31.3) non c'è
    **nessuna correlazione** col throughput (il più caldo fa 4.84, il più freddo 4.64). In più
    l'autoriscaldamento del run (6.6 °C) domina di 4× la differenza di soglia (1.6 °C).
    `batt_temp_start/end` vanno comunque registrati su ogni rep, così la non-correlazione è
    **verificabile a posteriori invece che assunta**.
  - **Deviazione dichiarata: `n_ctx=2048`** (il gate usa `-c 512`, ma 143 prompt + 512 generati
    = 655 non ci stanno). I due primi rep falliti hanno questa causa.
  - **Osservazione da tenere d'occhio: `memfree_min_mb=12`** durante il run lungo, con
    `vmrss_peak_mb=4577`. Non è colpa di `n_ctx` (la KV a 2048 sono ~20 MB): siamo
    strutturalmente al limite. Un kill di lmkd a metà di una generazione da 512 token costa
    molto più che su un burst.

- **2026-08-07 mattina — CHIUSURA DELLA NOTTE: il ramo cache è finito, e non perché le
  politiche non funzionino — perché non è rimasto quasi niente da vincere. Il metro di qualità
  resta BLOCCATO ed è ora l'ostacolo numero uno.**

  Report `reports/moe-notte.md`. Verifica mia.

  ### C1 — nessuna politica raggiunge la soglia, e la soglia era già generosa

  | politica | Δ vs LRU (short_bench) | Δ medio 6 trace | verdetto |
  |---|---:|---:|---|
  | **layer_equal** (budget uguale per layer) | **+3.85** | **+4.62** | IN_MEZZO |
  | layer_prop_top8 | +2.92 | +3.74 | IN_MEZZO |
  | layer_prop_invH | +2.79 | +3.71 | IN_MEZZO |
  | ARC-2L | −0.04 | +0.26 | archivia |
  | LFU | −0.12 | +0.14 | archivia |
  | SCORE-ADMIT (q10/q25/q50) | −1.3 / −2.8 / −4.6 | — | archivia |
  | SCORE-EVICT | −8.60 | −9.89 | archivia |
  | LIRS-HIR | −30.2 | −29.4 | archivia (variante size-aware, non la LIRS del paper) |

  Nessuna arriva a +5.9 (un terzo del divario). Le due idee **specifiche del dominio** che
  avevo proposto danno esiti opposti: il **budget per-layer funziona** (ed è la variante più
  semplice, `layer_equal`, a vincere — non quelle pesate sull'entropia), mentre **il punteggio
  del router peggiora sempre**, in tutte le forme provate.

  ### La ricaduta che chiude il ramo: il divario si misura sul carico sbagliato

  La mia obiezione di stanotte, confermata da Grok con il numero:

  ```
  divario Belady − LRU su short_bench  : +17.79 pp
  divario Belady − LRU su long_512     : **+6.37 pp**      (LRU 89.25 → Belady 95.62)
  ```

  Quindi sul carico reale **il premio massimo di QUALUNQUE politica possibile è 6.37 punti**.
  Avevo stimato che la migliore ne catturasse ~22-26% ⇒ ~1.4 punti ⇒ ~3% di velocità.

  **Misurato (commit `dec8307`, bake-off rifatto con `long_512` dentro): la stima era
  ottimistica. Sul carico reale NESSUNA politica batte LRU, e la più promettente lo peggiora.**

  | politica | Δ su short_bench | **Δ su long_512** |
  |---|---:|---:|
  | layer_equal | **+3.85** | **−0.95** |
  | layer_prop_top8 | +2.92 | −2.88 |
  | LFU | −0.12 | +0.76 |
  | ARC-2L | −0.04 | +0.28 |
  | SCORE-ADMIT | −1.31 | +0.16 |

  **Il ramo delle politiche di cache non è marginale: è VUOTO.** E `layer_equal` — l'idea che
  sembrava l'unica viva, e che avevo proposto io — era un **artefatto del benchmark non
  rappresentativo**: dà +3.85 sul carico sbagliato e −0.95 su quello giusto. Il che è anche la
  dimostrazione più pulita del perché la scoperta sul contenuto valeva più di tutto il resto:
  senza `long_512`, avremmo implementato una politica che peggiora il prodotto.

  ### Il meccanismo, che spiega tutti i fallimenti in una riga

  Distanza di riuso mediana: **80 batch-step ≈ 2 token** (p90 = 680, p99 = 1240). Il segnale
  dominante è **recenza a brevissimo termine**, ed è esattamente ciò che LRU cattura in modo
  perfetto. Da qui, tutto:
  - **LFU e ARC ≈ 0**: non c'è un segnale di frequenza da sfruttare, il riuso è immediato.
  - **Belady vince poco**: il suo vantaggio sta nella coda p90-p99, che è una frazione piccola.
  - **Il prefetch cross-layer fallisce ma non serve**: ciò che serve fra 2 token è già in RAM.
  - **MTP non ammortizza**: stessa ragione, con il conto già fatto.

  ### C3 — due fatti collaterali che valgono

  1. **Nessun degrado sulle generazioni lunghe**: hit per blocchi da 64 token 87.1 · 90.8 ·
     90.4 · 89.2 · 88.7 · 89.0 · 89.2 · 89.6 — piatto (+0.48 pp fra primo e ultimo quarto).
     Il timore che il sostenuto crollasse (il 4B denso perdeva metà) **non si materializza**
     sul MoE in streaming, e per un motivo strutturale: il 4B thrashava, questo ha una cache
     che regge.
  2. **Il working set cresce ma il riuso no**: esperti distinti visti 2944 @64 → 4717 @256 →
     5681 @512. A 512 token il working set (5681 voci ≈ 5.35 GB) è **2.5× la cache**, eppure
     l'hit è 89%. L'impronta è larga, il riuso è concentrato **nel tempo**, non nello spazio.

  ### C2 — BLOCCATA: manca il tooling per la perplessità

  Grok si è fermato al passo 1 come da mandato (giusto: non ha bruciato la notte su un percorso
  morto). Non è un problema di batteria o di carica: **non esiste un percorso perplessità su
  questo stack**. Conseguenza: **ogni leva lossy — REAP, precisione ridotta, cache a doppia
  precisione — resta bloccata**, perché nessuna si può nemmeno ordinare senza un metro.

  **È ora l'ostacolo numero uno del piano.** E va risolto costruendo lo strumento, non
  aggirandolo: la strada più promettente è (c) del mandato — logprob per token via bmoe-cli su
  un testo fisso, con la perplessità calcolata a mano. Serve solo che il binario esponga i
  logprob; se non lo fa, è una patch piccola e ben delimitata al runtime.

  ### Dove siamo, in una riga

  Il ramo I/O è **chiuso** su tutti i fronti misurati: politiche ~3%, prefetch morto, MTP
  morto, e il residuo esposto totale è il 20% del decode. Restano **tre** cose:
  1. **Il calcolo** — kernel IQ2 a mano, l'unico che sposti il tetto (7.87 → ~14 tok/s).
  2. **Il TTFT** — fix del loader, ~17 s su 28 (E1, già misurata e confermata).
  3. **Il metro di qualità** — che sblocca tutto ciò che è lossy, e oggi non esiste.

- **2026-08-07 notte — ⚠⚠ IL RISULTATO PIÙ IMPORTANTE DELLA CAMPAGNA: il benchmark del gate
  NON RAPPRESENTA il carico del prodotto. Su contenuto conversazionale italiano il traffico
  crolla del 61%, l'hit sale a 89.2% e il sistema diventa COMPUTE-BOUND.**

  > **Correzione applicata la stessa notte, un'ora dopo la prima stesura.** Avevo scritto che
  > il benchmark «misurava il riscaldamento della cache». **Falso**, e l'ho smontato io stesso
  > analizzando la trace: l'hit per blocchi di 64 token è **piatto** (85.6 · 90.5 · 90.8 · 90.2
  > · 87.9 · 89.3 · 88.3 · 91.8), già all'85% dal primo blocco di decode — nessuna rampa. La
  > cache arriva a regime **durante il prefill** (143 token × 320 = 45 760 lookup riempiono
  > 2226 voci molte volte). La causa vera è **il contenuto**, e la scomposizione è sotto.
  > La conclusione (compute-bound nel regime reale) **regge intatta**; cambia il perché.

  Cella C3 del mandato notturno (trace lunga, deterministica, telefono in carica).

  ```
  generation: 512 token, 6.273 tok/s
  prefill:    143 token, 11.845 s | model load 19.107 s | TTFT 30.952 s
  moe-stream: read 16150.4 MiB (31.54 MiB/token), decode 0.159 s/token
              = compute 0.120 + cache mgmt 0.007 + flash I/O 0.134
  moe-cache:  86.6% hit, 20454 evictions, 15719 re-reads (30.7/token)
  moe-overlap: stall 0.032 s/token
  ```

  ### Il confronto che ribalta la campagna

  | | bench 64 token | **long 512 token** | Δ |
  |---|---:|---:|---|
  | traffico | 84.73 MiB/tok | **31.54** | **−63%** |
  | hit (contatore cumulativo) | 48.1% | **86.6%** | +38.5 pp |
  | re-read | 75.8 /tok | **30.7** | −60% |
  | stall I/O esposto | — | **0.032 s/tok** | **20% del decode** |

  ### La scomposizione: contenuto e lunghezza, misurati separatamente

  Sette trace, tutte con `--temp 0` e stessa config, quindi confrontabili. Hit **solo-decode**:

  | trace | prefill tok | decode tok | hit decode | MiB/tok |
  |---|---:|---:|---:|---:|
  | f45_3 istruzioni | 114 | 32 | 80.9% | 54.99 |
  | f45_1 esplicativo | 121 | 32 | 77.1% | 65.94 |
  | f45_2 scrittura | 133 | 32 | 74.5% | 73.58 |
  | **short_bench** | 102 | 32 | **72.2%** | **80.62** |
  | f45_5 ragionamento | 164 | 32 | 70.5% | 85.33 |
  | f45_4 codice | 148 | 32 | 67.5% | 94.24 |
  | **long_512** (prosa IT) | 143 | **512** | **89.2%** | **31.14** |

  **La lunghezza del PROMPT non spiega nulla**: `f45_5` ha il prefill più lungo (164) e uno
  degli hit più bassi (70.5%); `f45_3` ha il più corto (114) e il più alto fra i brevi (80.9%).
  Nessuna correlazione.

  Per separare contenuto e lunghezza della generazione ho ricalcolato `long_512` **troncata ai
  suoi primi 32 token di decode**, cioè a parità esatta con gli altri:

  ```
  short_bench            32 tok  →  hit 72.2%   80.62 MiB/tok
  long_512 (primi 32)    32 tok  →  hit 83.6%   47.32 MiB/tok    ← effetto CONTENUTO: +11.4 pp, −41%
  long_512 (completa)   512 tok  →  hit 89.2%   31.14 MiB/tok    ← effetto LUNGHEZZA:  +5.6 pp, −34%
  ```

  **Il fattore dominante è il CONTENUTO** (+11.4 punti), la lunghezza è secondaria (+5.6). Ma
  entrambi puntano nella stessa direzione, e **entrambi valgono per il prodotto vero**: prosa
  conversazionale italiana, risposte lunghe.

  **Conseguenza vera, e più scomoda di quella che avevo scritto prima: la campagna ha
  ottimizzato per quasi due settimane contro un benchmark il cui comportamento di I/O è 2.6×
  peggiore del carico reale.** La «dipendenza dal contenuto» che M5 aveva relegato alla sezione
  3.4 come curiosità è in realtà **il fatto di primo ordine**: sposta l'hit di 16 punti
  (codice 67.5% → prosa 83.6%) e il traffico di 2×.

  ### Il sistema è passato dall'altra parte del crinale

  La roofline del round 1 poneva il **crossover dell'hit-rate a h\* = 0.82**: oltre quella
  soglia l'I/O smette di legare e il collo diventa il calcolo. Era scritta come un confine
  teorico lontano (eravamo a 0.705). **Siamo a 0.866: l'abbiamo superato.** E i dati lo
  confermano direttamente: `compute 0.120` contro `stall esposto 0.032`.

  ```
  tetto architetturale = 1/(0.120 + 0.007) = 7.87 tok/s
  osservato = 6.27  ⇒  siamo all'80% del massimo, e il residuo 20% è I/O
  ```

  ### Cosa questo fa al piano

  1. **Tutto il ramo I/O vale molto meno di quanto crediamo.** Cache policy, packing,
     prefetch, repack per-esperto, DirectIO: si contendono un residuo del **20%**, non del
     60%. Il premio massimo di TUTTO il ramo è ~1.6 tok/s (da 6.27 a 7.87).
  2. **Il collo è il CALCOLO, e lo è adesso.** 54 GFLOPS su un SoC che ne fa molti di più,
     con quantizzazioni IQ che in mainline **non hanno un percorso ARM veloce** (solo Q4_0 e
     IQ4_NL ce l'hanno; KleidiAI copre Q4_0/Q8_0). **Il kernel IQ2 scritto a mano — l'idea di
     gualt — passa da "il muro successivo" a LA priorità.** Dimezzare `compute` porterebbe il
     tetto da 7.87 a ~14 tok/s.
  3. **Il gate F4 (5.02 tok/s) sottostima il prodotto.** Non è sbagliato: è misurato nel
     transitorio. Una conversazione vera vive nel regime lungo.
  4. **La domanda sul "sostenuto" si ribalta.** Temevamo che il lungo periodo fosse peggio del
     burst (il 4B denso perdeva metà). Qui è **meglio**, e per un motivo strutturale: il 4B era
     memory-bound e thrashava, questo ha una cache che si scalda.

  ### Cautele, dichiarate

  - Il **6.27 tok/s è in carica** e non è confrontabile col 5.02 del gate. Va rimisurato
    scollegato. Ma i numeri di **traffico e hit sono deterministici** e pienamente comparabili,
    ed è da lì che viene la conclusione — non dal tok/s.
  - Prompt diverso (143 token contro quello del bench) e lunghezza diversa: i due effetti sono
    confusi. La cella C3 chiede l'hit-rate **in funzione della posizione** a blocchi di 64
    token, che separa i due e mostra la curva di riscaldamento. **Quella è la misura che
    conferma o smonta questa lettura.**
  - Il verdetto "compute-bound" poggia su `moe-overlap: stall`, un contatore che non abbiamo
    ancora validato in modo indipendente. Va incrociato col `read_bytes` di `/proc`.

  **Coerenza del trace verificata:** 209 643 righe contro `(143+512) × 320 = 209 600` eventi
  di routing attesi più l'header. Torna esatto ⇒ il trace copre prefill+decode e ogni evento.

  ### ⚠ Ricaduta immediata su M5 e su M5b: i verdetti sono TARATI SUL TRACE SBAGLIATO

  Tutti i verdetti di M5 — e il bake-off M5b in corso — sono misurati sulle **sei trace brevi**,
  e la regola di decisione è valutata specificamente su `short_bench`. Verificato nel sorgente
  (`scripts/analysis/m5b_policy_bakeoff.py:562` e `:625`):

  ```python
  names = ["short_bench","f45_1_esplicativo","f45_2_scrittura",
           "f45_3_istruzioni","f45_4_codice","f45_5_ragionamento"]   # long_512 ASSENTE
  gap = belady_dec["short_bench"] - lru_dec["short_bench"]
  ```

  **`short_bench` è il trace che abbiamo appena dimostrato essere 2.6× peggiore del carico
  reale.** Conseguenza aritmetica certa, indipendente da quanto valga Belady:

  ```
  su short_bench:  LRU 72.2%  →  Belady 90.03%  →  divario 17.79 pp   ("politiche VIVE")
  su long_512:     LRU 89.2%  →  divario massimo CONCEPIBILE = 10.8 pp
  ```

  Il premio del ramo politiche è **al più il 60%** di quello che M5b riporterà, e realisticamente
  molto meno (Belady non arriva al 100%). **Il verdetto "vale costruire una politica migliore"
  potrebbe ribaltarsi sul carico vero.**

  **Da rifare prima di decidere**: aggiungere `long_512` alla lista dei trace e valutare la
  regola su di esso, non su `short_bench`. È una modifica di una riga; il simulatore è già
  validato. Finché non è fatto, **nessuna decisione sulle politiche di cache**.

  Nota di portata: la stessa obiezione **non** tocca il verdetto su MTP, il cui meccanismo
  (`miss@t ∧ miss@t+1`) è indipendente dalla lunghezza e dal contenuto; e difficilmente ribalta
  quello sul prefetch, che manca la soglia di 50 punti (19.2% contro 70%). Colpisce **il ramo
  politiche**, che è esattamente quello ancora aperto.

- **2026-08-07 notte — M5 VERIFICATA (Claude): tre rami si chiudono, ma Belady dice che il
  premio esiste e nessuno dei tre meccanismi ovvi lo prende. E una correzione a una mia
  ambiguità che aveva ribaltato un verdetto nel verso sbagliato.**

  Analisi di Grok su PC delle 6 route-trace di F4.8 (`reports/moe-m5.md`, commit `41ac652`,
  fix `7ff26f9`). Verifica mia.

  ### Il cancello del simulatore è passato in modo netto

  hit misurato dallo stdout **48.1%** vs simulato **48.1%**, scarto **−0.05 pp**. Riproduzione
  esatta ⇒ il modello del comportamento della cache è corretto e tutto ciò che segue poggia su
  basi solide. In più il simulatore riproduce **entrambe** le finestre (cumulativa 48.1%,
  solo-decode **72.2%**): **terza conferma indipendente** della faccenda prefill/decode, dopo
  la derivazione del round 3 e la misura di F4.8.

  ### I quattro verdetti

  | domanda | numero | verdetto |
  |---|---|---|
  | politiche di cache | Belady − LRU = **17.79 pp** | premio GRANDE… |
  | …ma LFU | 72.12 vs LRU 72.24 | **+0** |
  | …e W-TinyLFU | 59.45 | **−12.8** |
  | MTP | vedi correzione sotto | **negativo sui byte** |
  | prefetch cross-layer | Recall@8 **19.2%**, extra-fetch **274%** | **morto** |
  | dipendenza dal contenuto | hit decode **67.5–80.9%** (Δ13.4 pp) | reale, rifatta bene |

  **Il prefetch muore due volte**, e la seconda è aritmetica: 84.73 × 3.74 = **317 MiB/token**,
  che a 5 tok/s vorrebbe **1583 MiB/s** contro i 1204 che il device sa dare. Non ci sta nemmeno
  spendendo tutta la banda che F4.8 ha appena scoperto.

  ### Il filo che lega i tre verdetti, ed è il risultato vero

  **17.79 punti sono sul tavolo e nessuno dei tre meccanismi ovvi ne prende un pezzo.** La
  frequenza non aiuta (LFU +0, W-TinyLFU −12.8), la co-occorrenza col layer precedente non
  predice (Recall@8 19.2%), il batching non ammortizza (0.00%). Quadro coerente: **l'accesso
  agli esperti non è guidato dalla frequenza e non è deducibile dal routing precedente.**
  Belady vince solo perché conosce il futuro, e quel futuro non si estrae dal passato.

  Belady usa un segnale che nessuna delle tre prova: la **distanza di riuso**. Il bake-off è
  quindi incompleto proprio dove puntano i dati. Due aggiunte, gratis perché il simulatore è
  già scritto e validato:
  1. **ARC e LIRS** — progettate esattamente per «LRU thrasha e LFU non aiuta», lavorano sulla
     distanza di riuso. Mai provate.
  2. **Politiche che usano il punteggio del router** (la colonna score è nel trace): evincere
     per score più basso, o ammettere solo sopra soglia. È un segnale **specifico del dominio**
     che nessuna cache generica possiede — la direzione in cui si può fare qualcosa che la
     letteratura del caching non ha.

  ### ⚠ Correzione: il "fix" del Passo 3 ha peggiorato il numero, e la colpa è del mandato mio

  Il commit `7ff26f9` cambia il residual MTP da `miss@t ∧ miss@t+1` (**0.00%**) a `miss@t fra
  l'overlap` (**5.04%**), e il verdetto da MTP_NEGATIVO a IN_MEZZO. **La definizione originale
  era quella giusta.** Il meccanismo, su un esperto E attivo sia a t sia a t+1:

  - **senza MTP**: miss a t ⇒ 1 lettura; a t+1 è in cache (LRU lo tiene ~24 token) ⇒ 0. **Tot 1.**
  - **con MTP**: i due token si verificano insieme, E sta nell'unione ⇒ **1. Tot 1.**

  Risparmio **zero**. MTP guadagna un byte **solo** se E viene sfrattato fra t e t+1, cioè
  `miss@t ∧ miss@t+1` = **0.00%**. Il 5.04% conta gli esperti che **LRU già cattura** (il
  report stesso li chiama `miss@t ∧ hit@t+1 = 0.050` due righe sopra): un risparmio già
  incassato, non uno che MTP aggiunge. Cade con esso il break-even «accettazione ≥85%», che
  calcola il pareggio su un beneficio inesistente.

  **Causa: la formulazione del mio mandato M5 Passo 3b era ambigua** — la prosa descriveva la
  quantità giusta, la formula `(i) ∧ (ii)` che ho scritto sotto ne descriveva un'altra.
  L'audit ha implementato le mie parole letterali. Lezione: in un mandato, prosa e formula
  devono dire la stessa cosa, e se divergono vince chi legge la formula.

  **Verdetto d'arbitrato: MTP resta NEGATIVO sui byte. F6 non si apre per ammortamento.**
  Resta vivo un solo caso, e di natura diversa: verificare 2 token insieme porta i miss per
  layer da 2.36 a ~4.7 e **riempie meglio la coda di I/O**. Con il device a 1204 MiB/s e noi a
  425, in regime di latenza, quello è l'unico asse su cui MTP può pagare — utilizzo delle
  corsie, non byte risparmiati. I draft rifiutati costano comunque byte veri.

- **2026-08-07 notte — F4.8 VERIFICATA (Claude): E1 confermata in modo spettacolare, e il
  device è QUASI TRE VOLTE più veloce di quanto tutto il piano assumeva. I numeri fio su cui
  abbiamo ragionato per giorni sono sbagliati di un fattore 2.**

  Mandato eseguito da Grok in carica (solo conteggi di byte e routing, nessuna misura di
  velocità). Report `reports/moe-f4.8.md`, commit `520b84e`. Qui la **mia verifica indipendente**
  sui dati grezzi, con due correzioni a quanto avevo detto io.

  ### 1. E1: confermata, e peggio del previsto

  ```
  load:    read_bytes = 20.76 GiB   rchar = 1.62 GiB   19.563 s   1086.7 MiB/s
  prefill: read_bytes =  4.55 GiB   rchar = 4.55 GiB    8.575 s    543.4 MiB/s   (102 token)
  TTFT = 28.138 s
  ```

  Il caricamento fa **20.76 GiB di traffico di blocco** per materializzare un trunk residente
  da 2.8 GiB. Il file intero ne pesa 11.52: **ne legge 1.8 volte tanto**. E `rchar` (le
  `read()` logiche) è solo 1.62 GiB ⇒ **19.14 GiB dei 20.76 sono page fault di mmap**.

  Sequenza, dalla timeline campionata ogni 200 ms:
  - t≈9.6 s: **l'intero file è già faultato** in RAM
  - t=12-15 s: le pagine mmap vengono rilasciate (`dropped 1662 MiB of now-unused mmap pages`)
  - t≈17.5 s: `rchar` sale — il trunk dense viene **riletto** via O_DIRECT in buffer anon

  Cioè il file viene letto **due volte**: tutto per fault, poi la parte dense di nuovo.
  L'aritmetica del tempo chiude senza residui: 20.76 GiB a 1086.7 MiB/s = **19.1 s** su 19.563
  misurati. Il caricamento è *solo* volume di byte, e 1086 MiB/s è già banda piena.

  **Un loader che legge i ~2.8 GiB che gli servono: ~2.6 s invece di 19.6 ⇒ TTFT 28.1 → ~11 s.**

  ### 2. ⚠ IL DEVICE FA 1200 MiB/s, NON 413. Il piano è tarato su numeri fio sbagliati.

  `bmoe-iobench` (stesso `FileReader` del motore, stesso O_DIRECT, con `--compute-load 4`):

  | dimensione | MiB/s | | corsie @942 KiB | MiB/s |
  |---|---:|---|---|---:|
  | 264 KiB | 844.8 | | 1 | 850.6 |
  | 512 KiB | 987.6 | | 2 | 1184.2 |
  | **942 KiB** | **1204.2** | | 4 | 1204.2 |
  | 2048 KiB | 1369.3 | | | |

  §5 del piano dice `fio: 1M = 413 MiB/s [MISURATO F2.1]`. iobench a **942 KiB / 1 corsia**
  misura **850.6**. Stesso device, stessa classe di dimensione, profondità di coda 1 in
  entrambi: **fattore 2.06 di discrepanza**. Lo strumento credibile è iobench, perché usa il
  percorso di codice reale invece di un binario fio che su Termux dà già segni di malfunzionamento
  (le celle qd4 in archivio leggono 87 MiB/s a 256k, e i job log contengono
  `clock setaffinity failed`).

  **Conseguenza: il runtime ottiene 425 MiB/s dove il suo stesso strato di I/O ne fa 1204.
  Siamo al 35% della capacità del device.** Tutte le conclusioni della tavola rotonda sul
  "tetto dello storage" — la mia inclusa — poggiavano su 413. **Non siamo mai stati al tetto.**

  ### 3. Il rapporto scatter passa la soglia, ma c'è una trappola dentro

  `scatter1/scatter3 = 1150.8/905.4 = 1.271` e `1136.0/912.3 = 1.245` ⇒ **1.26 ≥ 1.25**: per la
  regola dichiarata prima, il repack per-esperto **ha un caso**. Ma il numero va letto insieme
  alla latenza, e allora si ribalta:

  - le corsie **saturano a 2** (1→2 = 1.39×, 2→4 = 1.02×), e noi facciamo solo ~2.36 miss/layer
  - **scatter 3**: 7.1 letture da 1.36 ms si spalmano sulle corsie ⇒ ~2.7 ms/layer
  - **scatter 1**: 2.36 letture da 3.19 ms, una sola tornata ⇒ ~3.2 ms/layer

  In regime di **banda** il repack vince del 26%. In regime di **latenza con corsie libere**
  perde. E il collo sembra essere la latenza: gli esperti del layer L+1 non sono noti finché L
  non ha calcolato ⇒ **40 catene dipendenti per token**, che nessuna banda accorcia.

  **Questo riapre il prefetch cross-layer (H4), che il round 3 aveva dichiarato morto sulla
  premessa «siamo rate-bound, non latency-bound». I dati dicono il contrario.**

  ### 4. Due correzioni a quanto avevo detto io stanotte

  1. **Sul picco di RAM avevo torto.** Avevo detto «il picco non è il caricamento, è il regime».
     La serie temporale dice il contrario: **HWM 4416 MiB a t≈8.2 s, dentro il load**, contro
     **3920 MiB a regime** con cache 2000. Il picco sta 500 MiB sopra lo stazionario ed è la
     tempesta di fault. Quindi **sistemare il loader sblocca davvero una cache più grande** —
     toglie la punta che uccide cache-3000 in `create_tensor`. Con un limite però: a regime la
     RAM è `dense 1664 + cache + ~250`, quindi cache-3000 ⇒ ~4.9 GiB e cache-3500 ⇒ ~5.4 GiB,
     sul filo di lmkd. **La pista arriva a ~3000-3500, non oltre.**
  2. Avevo derivato l'errore dai soli valori di fine fase senza guardare la serie. È lo stesso
     schema che il Registro nomina da giorni: una conclusione presa su una quantità derivata
     senza controllare il dato sotto.

  ### 5. Conferme collaterali

  - **Prefill misurato 4.55 GiB per 102 token.** Il round 3 lo aveva **derivato** per pura
    aritmetica dai contatori mescolati: **4521 MiB**. Errore del 3%. La chiusura N4b regge.
  - **Qualità**: sul prompt di ragionamento — *«5.0 tok/s con 8 core, 1.2 tok/s nel run
    successivo, stessa temperatura: throttle termico, cpuset a 3 core little, o quantizzazione
    cambiata?»* — il 35B a 2.4 bit ha scelto **(B)**, la risposta giusta, che è esattamente il
    bug che ci è costato una giornata. Test di qualità molto migliore dei 5 di F4.5: ha una
    risposta verificabile invece di richiedere un giudizio a occhio.
  - Un run in carica riporta `moe-overlap: stall 0.064 s/token` con scomposizione **additiva**
    esatta (`0.158 compute + 0.018 cache + 0.064 stall = 0.240 decode`). Se regge nel regime
    valido, **l'I/O esposto è solo il 27% del decode** — ancora un'altra storia rispetto
    all'«I/O-bound di 1.7×» della roofline. **Da rifare sulla config del gate, scollegato.**

  ### 6. Cosa cambia nella coda

  1. **Rifare la scala fio** con iobench, e **ritirare i numeri fio da §5**: sono la base di
     troppi ragionamenti per lasciarli lì sbagliati di 2×.
  2. **Il fix del loader sale in cima**: vale ~17 s di TTFT *e* sblocca cache 2500-3000.
  3. **Il repack per-esperto scende**: passa la soglia ma il guadagno di banda potrebbe essere
     annullato dalla perdita di parallelismo. Prima serve sapere se siamo latency- o
     bandwidth-bound, e lo dice il punto 4.
  4. **Rimisurare `moe-overlap: stall` nel regime valido**: decide quale roofline è vera, e
     quindi se il ramo I/O vale il 27% o il 60%.
  5. **Riaprire il prefetch cross-layer** con la premessa corretta.

- **2026-08-06 notte — F4.7 CHIUSA: la batteria non conta fino al 17%, poi costa il 5%. E in
  regalo, la prima misura di ENERGIA della campagna.**

  Campagna terminata da sola a `STOP_PCT=9`. Otto punti, config fissa, top-app, `nproc=8`
  `mask=ff` su tutti, scollegato. Carica = quella a **inizio** run (dal summary di fase):

  | batteria % | 32 | 30 | 27 | 25 | 21 | 17 | **13** | **10** |
  |---|---|---|---|---|---|---|---|---|
  | tok/s | 4.84 | 4.98 | 4.84 | 4.92 | 4.88 | 5.00 | **4.64** | **4.69** |
  | T inizio °C | 31.3 | 30.3 | 29.0 | 29.4 | 28.7 | 28.6 | 28.5 | 28.9 |

  **Verdetto: piatta da 32% a 17% (media 4.91, dispersione ±1.6% = la ripetibilità dello
  strumento), poi uno scalino di −5.0% sotto il 13% (media 4.665).** La rottura sta fra 17 e 13.

  **Non è policy del sistema operativo** — canale adb, campionato ogni 120 s per tutta la
  fase: `low_power=0` e `mSettingBatterySaverEnabled=false` **sempre**, `Thermal Status: 0`
  **sempre**, `mPlugType=0` sempre. `scaling_max_freq` invariato ai massimi di fabbrica
  (cpu0 2016 / cpu3 2803 / cpu7 3360 MHz) anche a batteria 12%. L'unica cosa che cambia è
  `mBatteryLevelLow: false → true` **al 15%**, che è solo il flag del popup e non tocca né
  scheduler né frequenze.

  **Non è deriva di sessione, e lo dicono le temperature.** I run vanno dalle 17:24 alle 20:58;
  se ci fosse una deriva sarebbe confusa con l'effetto. Ma `temp_start` **scende** lungo la
  sessione (31.3 → 28.5 °C): le ultime due misure sono **le più fredde e le più lente**. Una
  deriva termica avrebbe prodotto il contrario. Resta comunque obbligatorio il controllo a
  ≥80% (voce sotto) — due punti sono due punti.

  **Il meccanismo è elettrico, e ha evidenza.** Dallo storico dei broadcast `BATTERY_CHANGED`
  (letto via adb — non lo stavamo registrando), tensione e corrente **sotto carico**:

  | livello | V a riposo | V sotto carico | I |
  |---|---|---|---|
  | 21% | 3720 mV | 3570 mV | −1443 mA |
  | 17% | 3697 | **3469** | −2039 mA |
  | 13% | 3659 | 3496 | −1439 mA |
  | 12% | 3657 | 3596 | −1830 mA |

  Resistenza interna ≈ **104-113 mΩ**, in lieve salita. Il minimo di tensione sotto carico
  **scende** (3570 al 21% → 3469 al 17%) e il PMIC di una Li-ion inizia a limitare la corrente
  intorno ai **3.4 V**: stiamo entrando in quella regione proprio dove compare lo scalino. La
  frequenza *massima* resta invariata ma la *permanenza* in turbo no — ed è invisibile in
  `scaling_max_freq`, che è un tetto, non una frequenza raggiunta. Strumento giusto per
  confermarlo: `cpufreq/stats/time_in_state` campionato attorno al run.

  ### ENERGIA — prima misura della campagna, e non era in programma

  Sotto carico il sistema tira **1.4-2.0 A a ~3.6 V = 5.2-7.1 W**. A 5.0 tok/s:

  **≈ 1.0-1.4 J/token**, schermo acceso incluso (quindi è un **tetto** sul costo del modello).

  - Batteria S23 ~3900 mAh × 3.8 V ≈ 14.8 Wh ≈ 53 kJ ⇒ **~40 000 token generati per carica**.
  - Ritira la stima a verbale di **6 J/token** (era fuori di 4-6×) e batte anche la stima
    «1.5-2.5 J/token [speculazione]» della tavola rotonda: il valore reale è più basso.
  - **Conseguenza di prodotto**: il 35B in streaming **non è energeticamente proibitivo** su
    questo telefono. È la prima volta che lo si può dire con una misura invece che con
    un'impressione, e chiude in positivo la domanda §5.6 del brief.
  - Da industrializzare: aggiungere `voltage_now`/`current_now` alle colonne CSV e campionarli
    a inizio/fine run. Il dato è disponibile da `dumpsys battery` e da
    `termux-battery-status` (`current`, `current_average`), quindi **anche dall'harness**, non
    solo da adb.

  ### Cosa NON dice questa fase

  Le righe F4.7 portano `DO_NOT_COMPARE_TO_GATE` e vanno lasciate fuori da qualunque mediana
  del gate. E lo scalino del 5% è un risultato **di caratterizzazione**, non una leva: non si
  guadagna nulla tenendo il telefono carico, si evita solo di perdere il 5% quando è scarico.

- **2026-08-06 notte — TAVOLA ROTONDA AVVERSARIALE (Grok ↔ DeepSeek, 4 round + arbitrato).
  Ha corretto quattro nostri numeri, chiuso la disputa sulla banda, e trovato il lavoro più
  prezioso del progetto in un posto dove non stavamo guardando.**

  Metodo: R0 Grok (letteratura + ipotesi) → R1 DeepSeek (attacco ostile + ipotesi proprie) →
  R2 Grok (concessione/difesa/mutazione + controattacco) → R3 DeepSeek (sintesi + raccolto
  della collisione). Fra R2 e R3 ho iniettato `ARBITER-NOTES.md`, fatti letti da me nel
  sorgente. Artefatti: `scratchpad/agents/moe-theory/{BRIEF,r0-dossier,r1-attack,r2-rebuttal,
  r3-synthesis,ARBITER-NOTES}.md`.

  ### 1. La disputa sulla banda è CHIUSA, e non come diceva nessuno dei due

  - R0: «425 MiB/s di parete ≈ 413 di fio ⇒ siamo al tetto, l'I/O è morto».
  - R1: «no: le letture sono da 264/264/392 KiB, cioè classe 256k = **214 MiB/s**; il 266 del
    runtime è la firma di quel pattern, e il 425 è gonfiato dalla page cache».
  - **Arbitrato, dai log [M]: `o_direct=1` in tutti i 50 run** (38× con io_threads=4
    cache=2000). O_DIRECT **bypassa la page cache**, quindi l'argomento di R1 è impossibile:
    gli 84.73 MiB/tok vengono tutti dal flash e **425 MiB/s è banda di disco reale**.

  Conseguenza che nessuno dei due ha tratto: a **314 KiB** medi otteniamo **425 MiB/s** dove
  fio a 256k-QD1 ne dà 214 ⇒ **la coda a 4 corsie raddoppia la banda**. La domanda vera non è
  «siamo al tetto» ma **«la curva dimensione→banda è ancora ripida a 942 KiB, o è già piatta?»**

  ### 2. Lo strumento esisteva già, e nessuno dei due lo sapeva

  `BigMoeOnEdge/tools/iobench.cpp` — scritto dall'autore del runtime **per esattamente questa
  domanda**. Dalla sua intestazione: *«`--scatter N` … today one routed expert costs one pread
  per projection at offsets an expert-stride apart (scatter ~3), while a contiguous per-expert
  sidecar would serve the same bytes in a single window (scatter 1). If bandwidth at scatter 1
  is not materially above scatter 3 for the same slice, the sidecar has no prize and must not
  be built.»* Usa **lo stesso `FileReader` del motore** (stesso O_DIRECT, stesso bounce,
  stessa verifica) e ha `--compute-load` per misurare mentre i thread ggml girano.

  ```
  bmoe-iobench -m <gguf> --lanes 4 --slice-kb 942 --scatter 3 --compute-load 4
  bmoe-iobench -m <gguf> --lanes 4 --slice-kb 942 --scatter 1 --compute-load 4
  ```

  Stessi byte, stesse corsie, cambia solo la contiguità. Vale più di fio, che su Termux è
  **inaffidabile sopra QD1** (§5 lo annota già; le celle qd4 in archivio danno 87 MiB/s a
  256k, cioè numeri da buttare). **Questo è il primo esperimento da fare, e costa minuti.**

  ### 3. I contatori: nessuno era rotto, il reporting mescolava due finestre

  Avevo trovato una contraddizione (8843 evizioni richiedono ≥9944 MiB, ne risultano letti
  5423 — fattore 1.83). R3 l'ha chiusa: **`moe_read_mib` è solo-decode; `evictions`/`rereads`/
  `cache_hit_pct` sono cumulativi (prefill+decode)**. Ricostruzione, ogni riga verificata:

  ```
  letture decode   = 84.73 × 64        = 5423 MiB
  miss decode      = 5423 / 0.8984     = 6036
  lookup decode    = 64 × 8 × 40       = 20480   ⇒ hit decode = 70.5%
  inserimenti tot  = 8843 + 2226       = 11069
  inserimenti prefill = 11069 − 6036   = 5033    ⇒ 4521 MiB a ~450 MiB/s ≈ 10 s = prefill misurato ✓
  evizioni decode  = 8843 − 2807       = 6036    = miss decode ✓ (identità esatta)
  ```

  - **Il 56.9% non è mai stato l'hit-rate del decode.** L'hit di decode è **70.5%**, che
    coincide col byte-hit 70.9%. Entrambe le metriche erano giuste, entrambe lette male.
  - **I livelli di F4.5 (71-77% "dipendenza dal contenuto") sono cumulativi**, diluiti da un
    prefill freddo: la **classifica** fra prompt regge, i **valori assoluti** no.
  - Fix: 6 righe in `GenTally::record` (delta per-finestra dei contatori). Costo 30 minuti.

  ### 4. Il prefill è l'evento di I/O più grande del run, ed era invisibile

  **4.5 GiB letti in prefill al ~3.2% di hit**, per un prompt da ~16 token — più del decode
  intero (5.4 GiB per 64 token). La cache che il decode usa **è riempita dal prefill**, quindi
  «lo stato stazionario» su una finestra da 64 token è una finzione. Invisibile perché i
  contatori mescolavano le finestre.

  ### 5. Il pezzo più prezioso: 19 s di caricamento per ~2 GiB residenti

  Il trunk residente (dense + shared + embed) è **1.75-2.5 GiB**. A banda sequenziale sarebbero
  **1-6 s**; ne servono **19**. Ma `11.52 GiB / 19 s ≈ 620 MiB/s` è esattamente banda
  sequenziale: **il loader legge quasi tutto il file**, compresi i corpi degli esperti che poi
  ricollega e non usa. Il sorgente lo rende plausibile: `vm_reserve` + `vm_commit` on-miss
  (`expert_stream_source.cpp:157-166`) ⇒ la cache **non** aggiunge RSS al load, quindi i 19 s e
  la morte di cache-3000 in `create_tensor` si spiegano coi **page fault dell'mmap del file**,
  non con la cache.

  **~10-15 s dei 27.5 s di TTFT sono probabilmente spreco software.** Con anche il preload
  degli esperti caldi e un prefill consapevole: **TTFT 27.5 → 12-16 s**, senza toccare il
  decode, senza costo di qualità. Era invisibile perché la cornice del progetto è
  «streaming+cache del **decode**», e «caricare» non è «streammare».

  ### 6. La roofline e i suoi confini (R1, calibrata sui nostri numeri)

  `t_token = t_cache + max(A/Π, (1−h)·B_naive/B_dev)`, che riproduce il 5.02 misurato.

  | confine | valore | significato |
  |---|---|---|
  | tetto architetturale | **7.8 tok/s** | con questo compute, anche a I/O gratis |
  | crossover hit-rate | **h\* = 0.82** | siamo a 0.705: **12 punti e ogni lavoro sulla cache smette di pagare** |
  | crossover banda | **730 MiB/s** | oltre, il collo diventa il calcolo |
  | squilibrio | **1.7×** | I/O-bound, ma di poco |

  Il premio dell'intero ramo I/O è **finito e vicino**. Oltre 7.8 tok/s bisogna attaccare il
  calcolo (Π = 54 GFLOPS, ~5-10% del silicio) — non più l'I/O.

  ### 7. Correzioni al piano (tutte da recepire)

  1. **§5 / §7 H2 è FALSIFICATA**: prometteva ≤50 MB/token con 2 GB; ne leggiamo **88.8**.
     Riduzione 3.4×, non 5×. Era così da giorni e non l'aveva notato nessuno.
  2. `343 MB/token` in Registro era mio errore (9 esperti/layer invece di 8: contavo lo shared
     residente come traffico). Il valore giusto, già in §5 [V], è **305.2 MB/token**; il
     byte-hit è **70.9%**, non 74%.
  3. Il **56.9%** va ritirato come «hit-rate»: è cumulativo. Usare **70.5% (decode)**.
  4. **Mio errore di stasera, esplicito**: avevo stimato la fusione delle letture a **1.6× →
     7.7 tok/s**, interpolando la scala fio **QD1** (4k=21, 64k=83, 256k=214, 1M=413) su un
     carico che gira a **QD4**. Non è un'inferenza valida: a QD4 la curva può essere già
     piatta. La stima onesta resta aperta fra **+0.4 e +2.5 tok/s** finché non gira iobench.
     È il quinto caso in questa campagna di una quantità **derivata** che eredita un input
     sbagliato — stavolta l'ho fatto io, dopo aver scritto la nota che avverte del pattern.

  ### 8. Sequenza decisa (esperimenti che DISCRIMINANO prima delle manopole)

  | # | cosa | dove | costo | cosa decide |
  |---|---|---|---|---|
  | M2 | grep `o_direct` nei log | PC | **fatto** | ✅ O_DIRECT attivo ⇒ 425 è disco vero |
  | M4 | **`bmoe-iobench --scatter 3 vs 1`** | telefono | minuti | se il repack per-esperto ha un premio |
  | M3 | patch finestre contatori (6 righe) | PC | 30 min | ogni cifra futura di cache onesta |
  | M1 | run strumentato: `read_bytes` a load / prefill / decode + RSS | telefono | 3 h | verdetto su E1 (il bug del loader) e primo punto di h(C) |
  | P5 | **gate perplessità italiana** ≥500k token, soglie ΔPPL congelate prima | PC | 3-5 gg | sblocca ogni leva lossy; senza, nessuna |
  | M5 | trace di routing su prompt italiani | entrambi | 1 gg | alimenta policy, D1, preload, packing |
  | P1 | fix del loader (non toccare i corpi degli esperti) | PC | 2-4 gg | TTFT −10-14 s |
  | P2 | repack + `preadv` scatter | PC | 2-4 gg | solo se M4 dà ≥1.25× |
  | F5 | **10 minuti sostenuti con `max(cpu-*)` e J/token** | telefono | 3 h | **prima di qualunque affermazione di prodotto** |

  ### 9. Il modo più probabile in cui tutto questo fallisce

  **Ogni numero di titolo è un burst da 13 secondi a ≤32 °C, e il prodotto è una conversazione
  da 10 minuti.** Il 4B denso di controllo ha già mostrato sostenuto ≈ metà del burst
  (8.90 → 4.68 [M, F2.4]); il die tocca 47 °C dentro un singolo burst [M]; lmkd vive ~1 GB
  sopra la RSS stazionaria [M]. In tutta la campagna **nessuno ha mai fatto girare il 35B per
  cinque minuti nel regime valido**. Se il decode decade verso 2.5-3 tok/s, o il processo
  muore, niente di quanto sopra conta. Costa un pomeriggio saperlo, e va saputo **prima**.

- **2026-08-06 sera — Il gate termico misura la BATTERIA, cioè una massa termica lenta, non il
  silicio. Il sensore giusto era leggibile da Termux dall'inizio. Da correggere PRIMA di F5.**

  **Il fatto.** Fra un run e l'altro, letti nello stesso istante: `termux-battery-status`
  **31.1 °C**, `cpu-1-5` **36.4 °C**. E un campione caduto *dentro* un decode ha visto l'AP a
  **47.1 °C** mentre il sensore batteria si muoveva di 0.2. Il die oscilla di ~16 °C dentro un
  singolo run da 64 token; la batteria non se ne accorge, perché è una massa termica che
  smorza e ritarda.

  **Perché è grave, e perché non lo è ancora.** Tutto il protocollo di §8.2 — cooldown ≥180 s,
  gate `T ≤ 30.0` — è costruito sulla temperatura **batteria**. Oggi non ci sta falsando le
  misure: `Thermal Status` è 0 anche a 47 °C, cioè Android non sta throttlando, e la baseline
  regge. Ma **F5 è per definizione la fase in cui il die sale e ci resta** (memory pressure,
  long-run, sostenuto), ed è esattamente lì che il gate direbbe "freddo, procedi" mentre il SoC
  è già in throttling. Ci arriveremmo con lo strumento cieco proprio dove serve vedere.

  È lo stesso errore del cpuset, nella forma: misurare la cosa giusta **sull'entità sbagliata**.

  **La correzione è disponibile e costa niente.** `dumpsys` non esiste nel PATH di Termux, ma
  il sysfs termico Qualcomm **sì**, senza permessi speciali: 45+ zone in
  `/sys/class/thermal/thermal_zone*/{type,temp}` (milli-°C), fra cui `cpu-0-0..2` e
  `cpu-1-0..10` (per-core), `gpuss-0..7` (GPU), `ddr`, `nspss-0..3` (DSP/NPU), `aoss`, `video`.

  ```sh
  # max sui sensori di CPU, in °C — questo è il gate corretto
  for z in /sys/class/thermal/thermal_zone*; do
    case "$(cat "$z/type" 2>/dev/null)" in cpu-*)
      v=$(cat "$z/temp" 2>/dev/null); [ -n "$v" ] && echo "$v";; esac
  done | sort -n | tail -1 | awk '{printf "%.1f\n", $1/1000}'
  ```

  **Direttiva per il prossimo mandato harness** (NON durante una campagna in corso):
  1. Il gate di cooldown passa a `max(cpu-*)`; la soglia va **ritarata** — 30.0 era su batteria
     e su die è irraggiungibile a riposo (a freddo, fra i run, si sta già a 34-36).
  2. Nuove colonne CSV: `soc_temp_start`, `soc_temp_end` (max cpu-*), accanto alle
     `batt_temp_*` esistenti, che **restano** — non si butta una serie storica, si affianca.
  3. `gpuss-*` e `ddr` vanno campionati anche adesso che la GPU è inattiva: sono la baseline
     contro cui si leggerà qualunque tentativo OpenCL/Adreno di F9.
  4. `nspss-*` (i DSP Hexagon) sono leggibili: se un giorno si tocca l'NPU, il termometro c'è già.

- **2026-08-06 sera — F4.7: `power_saver=UNKNOWN` non è sciatteria, è il sandbox. Aperto un
  canale laterale via adb, altrimenti la riga interessante della curva sarà muta.**

  **Primi due punti della curva** (UNPLUGGED, schermo acceso, top-app, nproc=8 mask=`ff`):

  | batteria | eval tok/s |
  |---:|---:|
  | 32% | 4.84 |
  | 30% | 4.98 |

  Baseline di riferimento: mediana warm **5.02**, sentinella 4.97, rep singole 5.02/5.06/5.08.
  I due punti stanno **dentro il rumore** (±1.5%) e il più scarico è il più veloce: a 30% di
  carica **non c'è alcun effetto batteria**. Questo chiude in negativo l'ipotesi di gualt sul
  calo di `t3io5` — quel calo era la **demotion dei core** (nproc=3, mask `07`, già a verbale),
  non la carica.

  **Perché non c'è ancora nulla: nessun regime è cambiato.** Stato letto da adb a 29%:
  `low_power=0`, `mSettingBatterySaverEnabled=false`, `mBatteryLevelLow=false`,
  `Thermal Status: 0` (AP 30.7 °C), `mPlugType=0`. Il telefono a 29% si comporta esattamente
  come a 70%. Il dato che cerchiamo sta più giù, dove Android cambia politica.

  **La lacuna.** L'harness gira come uid non fidato dentro Termux, e da lì lo stato del
  risparmio energetico **non è leggibile**: `settings get global low_power` →
  `SecurityException: requires android.permission.INTERACT_ACROSS_USERS`; `dumpsys power`
  restituisce vuoto; `/sys/class/power_supply/battery/capacity` → permission denied. Ecco
  perché ogni riga F4.7 porta `power_saver=UNKNOWN`. Non è un difetto del report: è il
  confine del sandbox, e Grok da lì non può farci niente.

  **Il rimedio.** adb gira come uid 2000 e lo legge. Campionatore lato PC (monitor
  `bxhl6lzzo`, `scratchpad/powersaver_timeline.sh`) che ogni 120 s appende a
  `f47_powersaver.csv`: `ts_utc,batt,plug,low_power,saver_enabled,batt_low,thermal_status,ap_temp`,
  da incrociare con le righe del CSV per timestamp del `run_id`. Notifica solo sui **cambi di
  regime**: saver on/off, thermal status, e telefono attaccato alla corrente (violazione del
  protocollo).

  **Confondente dichiarato, non nascosto:** due chiamate binder ogni 120 s mentre un run da 64
  token dura ~13 s. È poco, non è zero; sta scritto qui perché chi legge la curva lo sappia.

  **Regola di lettura della fase.** Un calo di tok/s vale come *effetto batteria* **solo se**
  la timeline mostra `saver_enabled=false` e `thermal_status=0` in quell'istante. Altrimenti
  è un cambio di regime — throttling o power save — e va etichettato come tale, perché è una
  cosa diversa e si comporta in modo diverso (il power save è una scelta del sistema
  operativo, reversibile; la batteria scarica no).

  **Difetto di disegno della fase, e il controllo che lo chiude (obbligatorio).** F4.7 ha una
  variabile che si muove in una sola direzione: la batteria scende e non risale. Dentro la
  fase, quindi, **un effetto batteria e una deriva di sessione producono la stessa curva** e
  non sono distinguibili. Non è teoria: questa campagna è già stata ingannata due volte da una
  deriva (lo sweep thread del pomeriggio, e il falso gradino termico che era un riavvio di
  Termux). Coi primi tre punti — 32%→4.84, 30%→4.98, 27%→4.84, media **4.89** contro baseline
  **5.02**, cioè −2.6% — siamo esattamente nella zona ambigua: troppo piccolo per gridare a un
  effetto, troppo sistematico per ignorarlo.

  **Il controllo: 3 rep della config identica a batteria ≥80%, subito dopo la ricarica e prima
  di qualunque altra fase.** Costa ~10 minuti e discrimina in modo netto:
  - torna a ~5.02 → il calo era **stato del device** (batteria o accumulo di sessione), e la
    curva misura qualcosa di reale;
  - resta a ~4.87 → era **deriva**, la curva non misura la batteria, e va buttata.

  Questa rimisurazione **non è opzionale e non è rimandabile**: la finestra esiste solo tra la
  ricarica e la fase successiva. Se si perde, F4.7 resta un dato non interpretabile e i tre
  punti raccolti stasera sono sprecati.

- **2026-08-06 sera — REAP: il pruning degli esperti va PROMOSSO da F9.1b (lossy, in fondo)
  a leva di prima linea. Il ragionamento che l'aveva declassato era sbagliato.**

  **Cos'è** (segnalato da gualt): REAP — *Router-weighted Expert Activation Pruning*,
  Cerebras, [arXiv:2510.13999](https://arxiv.org/abs/2510.13999), **codice pubblico**
  ([CerebrasResearch/reap](https://github.com/CerebrasResearch/reap)). One-shot, sceglie gli
  esperti da eliminare combinando i valori del router e la norma delle attivazioni. Rimuove
  **fino al 50% degli esperti** mantenendo ~**97%** della qualità su modelli fino a 1T; già
  **esteso all'architettura Qwen3.5**, cioè la nostra classe (`qwen3_5_moe`), comprese le
  attenzioni ibride.
  *[CORREZIONE 2026-08-10, audit ostile pre-pod: FALSO per l'upstream — il repo
  Cerebras ufficiale NON ha `Qwen3_5Moe` in MODEL_ATTRS; le estensioni all'ibrido
  sono SOLO fork/pipeline community (RangerX, 0xSero). Il mandato REAP v2 impone
  il pin della toolchain community con commit URL.]*

  **Perché il piano l'aveva declassato, e perché era un errore.** §F9.1b diceva: *«nello
  streaming il pruning NON riduce il traffico di decode (8 attivi restano 8) e muove poco
  l'hit-rate»*. La prima metà è vera — i byte **richiesti** per token non cambiano. La
  seconda è falsa, e la differenza è tutto: **il traffico verso la flash non è dato dai byte
  richiesti ma dai byte MANCANTI in cache**.
  Conti attuali: pool esperti ≈ **9.6 GB** (256 × 40 × 0.942 MB); cache 2000 MiB ≈ 2.1 GB,
  cioè copre il **22%** del pool; hit osservato **67-77%** (grazie alla località).
  **Dimezzando il pool a ~4.8 GB, la stessa cache ne copre il 44%.** L'hit-rate sale, e ogni
  punto di hit toglie byte dal **ramo critico**. Se il byte-hit passasse da ~74% a ~87%, il
  traffico crollerebbe da 88.8 a ~44 MB/token e il flash I/O da 0.319 a ~0.16 s — **sotto il
  compute (0.116)**, cioè tornerebbe compute-bound intorno ai **7 tok/s**.
  In più il file dimezza (11.5 → ~6 GB): **load da 19 s a ~10 s, quindi TTFT quasi dimezzato**
  — che attacca l'unico problema di prodotto rimasto.

  **La condizione, ed è quella che il piano aveva già indicato giustamente**: il pruning va
  calibrato **sul NOSTRO dominio**. Il modello pruned che circola (`Qwen3.5-18B-REAP-A3B-Coding`)
  è tarato **per il codice**, che per Kalsa è il dominio sbagliato — e F4.5 ha appena mostrato
  che il codice è il carico con la **peggiore** località (hit 67% contro il 77% dell'italiano
  discorsivo). Serve calibrare su **chat italiana**.
  E qui i pezzi combaciano: **F7.1 (route trace) esiste già** — `--route-trace` è nel runtime,
  zero patch — quindi possiamo produrre noi la statistica di attivazione sul carico Kalsa e
  darla in pasto a REAP. **Non è più una fase di ricerca lontana: è il passo che abilita la
  leva più forte che abbiamo.**

  **Rischio, da misurare non da assumere**: il pruning è lossy e il 97% dichiarato è su
  benchmark di coding in inglese. Ma ora abbiamo **F4.5 come metro di qualità**, quindi il
  danno si misura invece di temerlo. Ordine sensato: trace → prune 25% → F4.5 → prune 50% →
  F4.5, e ci si ferma dove la qualità italiana cede.

  **Domanda aperta da verificare (gualt)**: gli esperti di Qwen3.6 sono stati addestrati/
  rilasciati nativamente a bassa precisione (stile MXFP4 di GPT-OSS)? Se sì, il nostro IQ2_M
  a 2.4 bpw sta **sotto la precisione nativa** e sarebbe una spiegazione diretta delle parole
  malformate di F4.5. Da controllare in `config.json`/model card, non da assumere.

  **Cancellato dalla coda**: il rifacimento del riferimento 4B (decisione di gualt) — era un
  confronto di contorno, il valore è nel MoE.

  **CONTRAPPESO (obiezione di gualt: «il pruning è sempre un rischio elevato»). Accolta.**
  La quantizzazione perde **precisione**, il pruning perde **capacità**: se un esperto
  gestiva la morfologia verbale italiana e lo togli, nessuna ottimizzazione a runtime lo
  riporta indietro. Ed è irreversibile.
  **Il problema vero però non è il rischio in sé, è l'asimmetria**: oggi sappiamo **causare**
  il danno molto meglio di quanto sappiamo **misurarlo**. F4.5 sono 5 prompt letti da un
  umano — becca una catastrofe, non becca un degrado del 5% sparso sulle parole rare, che è
  precisamente il modo in cui il pruning si manifesta. Abbiamo stimato ~2 parole malformate
  su ~1000 token; per distinguere 2 da 3 serve un campione un ordine di grandezza più grande.
  **Prerequisito non negoziabile prima di qualunque pruning: costruire il rilevatore.**
  Perplessità su un corpus **italiano** (llama.cpp ha il tool), misurata prima sul modello
  attuale come baseline. È oggettiva, sensibile ai degradi piccoli, e costa un run — mentre
  leggere cinque risposte non lo è e non lo fa.
  **Ordine rivisto**: (1) esaurire prima le leve **senza perdita** — cache nel regime valido,
  expert packing, DirectIO: reversibili e a qualità intatta; (2) costruire la misura di
  perplessità italiana; (3) **solo allora** pruning, a gradini, con la qualità misurata a
  ogni gradino. Il pruning resta la leva col guadagno più alto, ma è anche l'unica che non
  si può annullare — quindi va per ultima, non per prima.

- **2026-08-06 sera — ✅ F4.5 QUALITÀ: UD-IQ2_M è USABILE. Il rischio che poteva invalidare
  tutta la campagna è chiuso.**

  6 run, `--temp 0`, `-n 200`, `--chatml --no-think`, config del gate, binario con
  `nproc=8 mask=ff` su tutti. Output letti **per intero**, non riassunti.

  **Lingua — buona.** Italiano corretto in tutti i prompt italiani: apostrofi e accenti
  giusti, congiuntivi corretti («per garantire che il processo **resti** in foreground»),
  registro adeguato al ruolo richiesto. **Nessuna ripetizione a ciclo, nessuna deriva verso
  l'inglese, nessun collasso grammaticale** — i tre modi tipici in cui cede una quant
  aggressiva. Difetto reale ma contenuto: **~2 parole malformate su ~1000 token**
  (`nascuro` per *nascosto*, `giusterebbe` per *giustificherebbe*) più un `Quale è` per
  *qual è*. È esattamente il degrado che ci si aspetta a 2.4 bpw, e non compromette l'uso.

  **Aderenza alle istruzioni — forte, con UNA violazione.** Rispettati: limite di 120 parole;
  **esattamente** tre frasi + **esattamente** due domande su richiesta; divieto di titoli,
  elenchi e prefazioni; divieto di rispondere in inglese; scelta di una sola opzione.
  **Violato**: `No markdown fences` nel prompt di codice — ha aperto con ```` ```python ````.
  Piccolo, ma è il tipo di errore che rompe un'integrazione che si aspetta codice puro.

  **Ragionamento — corretto su un problema non banale.** Al prompt che chiedeva di
  diagnosticare un calo 5.0 → 1.2 tok/s a temperatura invariata, scegliendo fra (A) throttle
  termico, (B) cpuset a 3 core little, (C) quant cambiata, ha risposto **(B)**, con
  l'argomento discriminante giusto — *«un throttle termico causerebbe un calo graduale, non
  un salto netto tra run separati»* — e ha indicato come verifica **`/proc/<pid>/status`,
  riga `Cpus_allowed_list`**. Cioè ha risolto in ~30 s, e nominando il file esatto, il
  rompicapo che a noi è costato mezza giornata.

  **Codice — logica corretta.** `median_eval_tok_s` filtra i `None`, filtra `nproc < 6`,
  ordina e gestisce il caso dispari correttamente; troncato dal limite di token sul caso pari.

  **Errore fattuale da annotare**: nella spiegazione MoE afferma che si caricano «solo gli
  esperti attivi (**circa 6 GB**)» — a 2.4 bpw, 3B attivi stanno sotto **1 GB**. Sbaglia di
  ~6×, con sicurezza. È il modo tipico in cui questi modelli sbagliano: il ragionamento
  intorno è corretto, il numero è inventato.

  **Nota di metodo per la prossima volta**: `-n 200` ha **troncato a metà frase 2 risposte su
  6** (la spiegazione da 180 parole e il codice). Su quelle non si può giudicare né la
  chiusura né il rispetto del limite di parole. **Servono ≥400 token** per un giudizio pieno.

  **Verdetto: USABILE.** Non serve passare a UD-IQ3_XXS né a un K-quant, e **tutti i numeri
  di throughput restano validi sulla base attuale**. Il rischio che avrebbe reso vana la
  campagna è chiuso — e siamo autorizzati a spendere settimane sul layout degli esperti.

  **SCOPERTA COLLATERALE, e vale più del verdetto: l'HIT-RATE DIPENDE DAL CONTENUTO.**
  Il 56.9% su cui è stata costruita tutta l'analisi della cache **è il caso peggiore** — il
  prompt sintetico di benchmark (`short.txt`, inglese). Su contenuto reale:

  | prompt | hit-rate |
  |---|---:|
  | IT esplicativo | **77.0%** |
  | IT istruzioni letterali | 75.9% |
  | IT scrittura breve | 71.6% |
  | IT ragionamento | 71.6% |
  | **codice Python** | **67.0%** |
  | benchmark `short.txt` (EN) | 56.9% |

  **Venti punti di escursione.** Conseguenze: (a) **nell'uso reale il traffico da flash è più
  basso di quanto misurato**, quindi il throughput di un'app di chat è probabilmente migliore
  dei nostri numeri da benchmark — che sono conservativi, non ottimistici; (b) **H1 (località
  degli esperti) è confermata sul nostro modello e sul nostro carico**, ed è **dipendente dal
  contenuto**, cosa che la letteratura misura in simulazione e noi abbiamo su hardware vero;
  (c) il **codice è il caso più difficile** (67%), coerente con l'attivazione di esperti più
  eterogenei; (d) **da rifare le stime sulla cache** usando l'hit-rate del carico reale, non
  quello del prompt sintetico.

  **Riferimento 4B: NON VALIDO, da ripetere.** Il run `Qwen3.5-4B-Q4_K_M` è girato **con il
  ragionamento attivo** (il 35B aveva `--chatml --no-think`), ha consumato tutti i 200 token
  dentro il blocco di *thinking* **in inglese** e **non ha mai prodotto la risposta italiana**.
  Confronto impossibile: configurazioni diverse e una risposta assente. Da rifare con gli
  stessi flag e ≥400 token.
  Un indizio dal poco prodotto: il 4B ha letto *«il ruolo dello streaming da flash»* come
  **«Flash Attention streaming»**, confondendo lo streaming dei pesi con il meccanismo di
  attenzione. Il 35B sullo stesso prompt aveva capito. Indizio a favore del modello grande,
  ma **è un indizio, non un risultato**: da un blocco di ragionamento troncato non si conclude.
  **Velocità (questa sì valida)**: 4B **8.00 tok/s** vs 35B ~5.5 sugli stessi prompt →
  il modello **9× più grande costa 1.45× in tempo**.

- **2026-08-06 sera — Il floor batteria proteggeva la COMPARABILITÀ, non il telefono.
  Due nuove fasi: F4.5 qualità (priorità assoluta) e F4.7 curva batteria.**

  **Chiarimento su §8.2 (osservazione di gualt, correzione a un mio errore di metodo).** La
  regola «nessun rep sotto il 40%» esiste per rendere i run **confrontabili fra loro**, non
  perché sotto quella soglia il telefono smetta di essere utile. Applicarla come un muro
  fisico ha per due volte fermato del lavoro che si poteva fare. **Regola aggiornata**: sotto
  il 40% non si producono numeri destinati a un confronto con le fasi precedenti, ma si
  possono raccogliere dati di **natura diversa**, a condizione che siano marcati come **fase
  separata** e non finiscano mai accanto a quelli del gate.

  **F4.5 — QUALITÀ. Priorità assoluta, prima di F5 e di qualunque conclusione di prodotto.**
  In tutta la campagna non è stata letta **una sola frase** prodotta dal modello. A ~2.4 bpw
  il rischio è reale, e 5 tok/s di testo incoerente valgono zero.
  - **Non richiede il protocollo di misura**: niente cooldown, niente 3 rep, niente
    sentinella, niente gate termico. Quelle regole rendono confrontabili dei *tempi*; qui si
    legge del testo.
  - **È indipendente dalla batteria**: con `--temp 0` l'output è deterministico — a 5 tok/s
    o a 1 tok/s il modello scrive le stesse identiche parole. Si può fare a qualunque carica.
  - Disegno: **5 prompt**, almeno 3 **in italiano** (il caso d'uso di Kalsa: le quantizzazioni
    aggressive degradano prima sulle lingue non inglesi) + 1 di codice + 1 di ragionamento
    breve. `--temp 0`, ~200 token ciascuno. Giudizio umano a 3 livelli (usabile / degradato /
    inutilizzabile), **output riportato per intero nel report**, non riassunto.
  - Se UD-IQ2_M risulta inutilizzabile: la strada è UD-IQ3_XXS (13.21 GB) o un K-quant, e
    **tutti i numeri di throughput vanno rivalutati su quella base**.

  **F4.7 — CURVA BATTERIA-PRESTAZIONI (fase nuova, idea di gualt).** Configurazione **fissa**
  (quella del gate: `t=4 --io-threads 4 --cache-mb 2000 --dense-weights anon --overlap`),
  ripetuta mentre la carica scende da ~40% verso ~10%, **registrando il livello a ogni run**.
  Risponde in modo diretto alla domanda rimasta aperta («la carica influenza le prestazioni?»),
  che finora era senza risposta perché `battery_pct` non è mai stata una colonna.
  - **Marcare la fase `F4.7-batt-curve`**: questi numeri non vanno MAI confrontati con quelli
    del gate. È l'intero motivo per cui il floor esisteva.
  - **Registrare se si attiva il risparmio energetico** (sotto il ~15% Android tipicamente lo
    accende, cambiando frequenze e cpuset). Se succede è **parte del risultato**, non un
    guasto — ma va annotato, altrimenti è la trappola dei tre core una seconda volta.
  - Valore di prodotto: un'app di chat gira anche al 15% di batteria. Se lì dimezza, è un
    fatto che l'utente sente e che va saputo.

- **2026-08-06 sera — Coda dei lavori dopo il gate, con due correzioni a quanto avevo
  scritto io.**

  **1. Correzione: NON è vero che «l'unica leva rimasta è il packing».** Lo sweep
  `--cache-mb` è stato *invalidato* (misurato pre-`top-app` su 3 core), il che significa
  «non sappiamo», non «non conta». La cella **`cache-3000` nel regime valido** è il test
  mancante più economico (~16 min) e va fatta prima di dichiarare chiusa quella famiglia.
  **Aspettativa da calibrare prima di misurare, per non raccontarsela dopo**: senza cache il
  traffico sarebbe ~343 MB/token (37 layer × 9 × 0.942 MB + 3 × 9 × 1.098). Ne leggiamo
  **88.8 MB**, cioè il **26%** → la cache dà già circa il **74% di hit A LIVELLO DI BYTE**.
  Il **56.9%** riportato dal runtime è quasi certamente un hit **per richiesta**: sono due
  metriche diverse e la seconda sovrastima il margine. Con 1.5× di cache un salto realistico
  del byte-hit è verso 80-82%, cioè 60-65 MB/token: **10-15% sul ramo lento**, non un
  dimezzamento. Vale i 16 minuti, ma sapendo cosa aspettarsi.
  *(Da verificare nel codice del runtime quale delle due metriche sia il 56.9%.)*

  **2. Lacuna grave che nessuno dei due aveva messo in coda: NON ABBIAMO MAI GUARDATO COSA
  SCRIVE IL MODELLO.** Giriamo a ~2.4 bpw e in tutta la campagna non è stata letta **una
  sola frase** di output. Abbiamo ottimizzato per giorni la velocità di un oggetto senza
  verificare che produca testo sensato — **in italiano**, che è il caso d'uso di Kalsa e su
  cui le quantizzazioni aggressive degradano prima che sull'inglese. Se a 2.4 bpw il modello
  è incoerente, tutto il resto è ginnastica: staremmo perfezionando qualcosa che non si può
  spedire. Costa pochissimo (un prompt, dieci righe, lette da un umano) e va fatto **prima**
  di investire settimane nel packing. È F4.5, che era in fondo alla lista: va promosso.

  **Coda decisa:**
  1. **Gate di rifiuto** (core attesi + harness vivo) — prima di qualunque altra misura.
     Deve coprire due guasti distinti visti oggi: uscita da `top-app` (→ 3 core) e **morte
     completa di Termux** (lmkd l'ha ucciso, non solo sshd). Harness sotto `nohup`/`setsid`.
  2. **F4.5 qualità** — vedi sopra.
  3. **`cache-3000`** nel regime valido.
  4. **`t=5` appaiato** (oggi 5.16 con una rep sola; la sequenza 4.84 → 5.06 → 5.16 per
     t=3/4/5 è coerente ma non conclusiva).
  5. **Packing degli esperti** o **MTP**. Packing favorito: attacca i **byte**, non solo la
     banda, ed è l'intervento che converge con la fusione dei matmul. Ma costa settimane —
     si spendono solo dopo il punto 2.

- **2026-08-06 sera — F4.4 (parziale, sessione chiusa dalla batteria): dare più thread
  all'I/O NON aiuta. Il vincolo è il pattern di accesso, non le braccia.**

  **Cella `F4.4-io5`** (`t=3 --io-threads 5`, totale 8 come la config vincente ma spostato
  verso l'I/O; resto identico: `--cache-mb 2000 --dense-weights anon --overlap`):
  **4.85 · 4.83 · 4.84** → mediana **4.84**, dispersione **0.4%** (la più stretta mai vista).
  Manca solo la sentinella, chiusa dal floor batteria.
  Confronto: `t=4/io=4` = **5.06** · `t=5/io=4` = **5.16** (1 rep) · `t=3/io=5` = **4.84**.

  **Lettura: l'I/O non è thread-limited.** Togliere un core al calcolo per darlo all'I/O
  costa ~4% e non guadagna nulla sul ramo lento. Quindi il vincolo dei 0.319 s/token non è
  la capacità di emettere richieste, ma **il pattern**: letture sparse da ~1 MiB su UFS,
  dove fio misura 413 MiB/s in sequenziale contro i **266 MiB/s** che otteniamo. Nessuna
  manopola di configurazione può cambiarlo — serve intervenire sul **layout degli esperti**
  (H6/G3, expert packing), che è anche l'intervento che converge con la fusione dei matmul.
  È un risultato negativo pulito e utile: **elimina un'intera famiglia di tentativi** e
  concentra il lavoro sull'unica leva che resta sul ramo lento.

  **Nota sul thread sweep rifatto in top-app**: `t=5` (5.16) ≥ `t=4` (5.06), cioè
  **l'opposto** di quanto sembrava nello sweep invalido su 3 core, dove `t=4` era già in
  sovrascrizione. Coerente, ma `t=5` ha una rep sola: non è una conclusione.

  **INCIDENTE, e la lezione vale più del dato.** A metà cella lo `screen_off_timeout` (30
  min) è scaduto: lo schermo si è spento, Termux è uscito da `top-app`, il processo è
  tornato sui 3 core A510 e una rep è finita nel CSV a **1.24 tok/s**. Il timeout è ora al
  massimo (2147483647). Ma il punto è un altro: **le colonne `nproc`/`affinity_mask` hanno
  registrato fedelmente il crollo, e il run è partito lo stesso.** Avere la telemetria non
  basta: serve il **rifiuto**. Prima di ogni rep il numero di core va confrontato con la
  soglia attesa e, se non torna, il run non deve partire — exit dedicato, come il gate
  batteria. **Un dato sbagliato che entra nel CSV è peggio di un run non fatto.**
  Quella riga va marcata `INVALID/3-core` ed esclusa da ogni mediana.

  **Chiarimento sulle due metriche di core** (si contraddicono solo in apparenza):
  `Cpus_allowed_list` del processo = insieme **permesso** (0-7 in top-app, 0-2 in
  background); `nproc` = core **online E permessi**, e Android ne spegne e riaccende di
  continuo (viste maschere `df`, `bf`, `5f`, `3f`). Vanno registrate **entrambe**: la prima
  distingue il regime, la seconda misura la capacità effettiva del momento. Verificato che
  la differenza 6 vs 7 core online **non correla** col tok/s (5.08 con 6, 5.06 con 7).

- **2026-08-06 — Ri-prioritizzazione dopo il gate: le teorie di giornata restano valide, ma
  due CAMBIANO SEGNO.** Le ipotesi costruite stamattina non sono state confutate dalla
  scoperta dei core: sono state **ricollocate**. Ora che il quadro è `compute 0.116` vs
  `flash I/O 0.319`, ecco dove va ciascuna.

  **Salgono (agiscono sul ramo lento, cioè l'I/O):**
  1. **MTP / speculative decoding — INVERSIONE.** Stamattina l'avevo declassata, e per un
     motivo corretto: il suo meccanismo è **ammortizzare letture memory-bound su N token**, e
     in regime compute-bound serve a poco. Ora l'I/O domina e ogni token costa **84.7 MiB**:
     generare 2 token per forward pass **dimezza i MiB per token**. È tornata a essere una
     delle leve più forti. Resta il dato scomodo (su GPU, per Qwen3.6-35B-A3B, lo speculative
     ha perso 19 volte su 19) — ma quello era un regime completamente diverso.
  2. **Ripartizione core compute/IO — INVERSIONE.** Avevo proposto di spostare core **dall'I/O
     al calcolo**. Con l'I/O che costa 2.7× il calcolo, la direzione giusta è **l'opposta**:
     provare `--io-threads` 5-6 con `t` 3-4. Cheap, e va fatto presto.
  3. **Expert packing (H6/G3) + DirectIO + sweep cache**: già in cima, v. voce del gate.

  **Convergenza importante — packing e fusione degli esperti sono lo STESSO intervento.**
  L'idea "fondere i 9 esperti attivi in 3 matmul larghe" (per togliere overhead di dispatch)
  e l'idea "riordinare gli esperti su flash per letture sequenziali" (per alzare la banda)
  richiedono entrambe **che gli esperti attivi stiano contigui in memoria**. Un solo lavoro
  sul layout serve tutti e due i rami. È il contributo originale più forte rimasto, ed è
  possibile **solo perché la cache è nostra**: con mmap il layout lo detta il file.

  **Restano valide ma spostate sul "tetto" (7.8 tok/s), non sul numero attuale:**
  4. **Quantizzazione mista per residenza** (densi in Q4_0, esperti routed a 2 bit): riduce
     il calcolo **senza toccare l'I/O**, quindi alza il tetto. Nota che la variante ingenua
     (tutto in Q4) sarebbe ora **controproducente**: raddoppierebbe i byte per token sul ramo
     che è già il collo di bottiglia.
  5. **Sonda `--n-expert-used`** (dot-product vs overhead di dispatch): ancora da fare, ma
     ora informa il tetto, non la strada per arrivarci.

  **Scendono:**
  6. **GPU (tronco denso su OpenCL)**: il calcolo è 0.116 s e non è il vincolo. Spostarlo su
     GPU libera core per l'I/O, il che non è nulla, ma il beneficio diretto è piccolo.
     Declassata, non cancellata.

  **Invariata e ancora da fare**: la misura di **J/token**, che con 5× di velocità dovrebbe
  migliorare in proporzione se la potenza resta simile — da verificare, non da assumere.

- **2026-08-06 — ✅ GATE F4: PASS. 5.06 tok/s sul 35B, stage valido.**

  Braccio `F4.3-bis C-topapp`, config `--moe-stream --cache-mb 2000 --dense-weights anon
  --overlap --io-threads 4`, `t=4`, runtime BigMoeOnEdge `b0c4e5b`, in `top-app` con
  `nproc=7`:

  | rep | tipo | eval | ttft |
  |---|---|---:|---:|
  | 1 | **cold** (fadv) | 5.06 | 27.5 s |
  | 2 | warm | 5.02 | 27.6 s |
  | 3 | warm | 5.08 | 27.7 s |
  | sentinella | warm | **4.97** | 27.5 s |

  **Mediana warm 5.02, drift sentinella 1.0%** (soglia 15%) → **stage VALIDO**.
  *(Correzione 2026-08-06 sera, rilevata da Grok: §10 definisce x come **mediana WARM** della
  config migliore, quindi il numero di gate è **5.02** — mediana di {5.02, 5.08, 4.97}. Il
  5.06 che avevo scritto includeva la rep **cold** e non è la definizione. Differenza dello
  0.8%, irrilevante per il verdetto, ma va un numero solo in giro.)* Dispersione 1.2%:
  la misura più stabile dell'intera campagna. Cold ≈ warm, come atteso ora che il file non
  entra comunque in RAM. Riga **C** di §9 compilata.
  **Soglia del gate: ≥3 tok/s = PASS. Ottenuto 5.06 → PASS con margine.**

  **Il percorso completo, per memoria:**
  | configurazione | tok/s |
  |---|---:|
  | mmap naive, mainline (F3) | 0.10 |
  | BigMoeOnEdge, ma su 3 core A510 | 0.82 |
  | BigMoeOnEdge, `top-app`, 7 core | **5.06** |

  **50× rispetto al naive**, e **6.2×** rispetto a quello che credevamo di avere stamattina.

  **Scomposizione finale — l'I/O è il ramo lento, senza ambiguità:**
  ```
  decode 0.201 = compute 0.116 + cache mgmt 0.012 + flash I/O 0.319 (in overlap), 266 MiB/s
  cache: 56.9% hit, 2000 MiB residenti, 8843 evizioni, 4848 ri-letture (75.8/token)
  ```
  L'I/O costa **2.7× il calcolo**. Se fosse gratis: `1/(0.116+0.012)` ≈ **7.8 tok/s**. È il
  tetto dell'architettura attuale, e la distanza da 5.06 è **tutta I/O**.

  **Quindi la frontiera di F4.4+ è l'I/O, e le leve sono già tutte in piano:** rifare lo
  sweep `--cache-mb` (il vecchio è ritirato, misurato nel regime sbagliato) partendo da un
  hit-rate del 56.9% con 4848 byte ri-letti; **expert packing** (H6/G3) per convertire
  letture sparse in sequenziali — la banda è 266 MiB/s contro i **413 MiB/s** che fio misura
  a 1 MiB; **`--load-mode dio`**; e infine il **prefetch predittivo** (H3, F7) contro lo
  stall residuo. Il calcolo (0.116 s) resta interessante solo per alzare il tetto dei 7.8,
  non per arrivarci.

  **Restano aperti due problemi che il gate non copre:**
  1. **TTFT = 27.5 s.** Per un'app di chat è il vero ostacolo di prodotto: throughput e
     tempo-al-primo-token sono problemi diversi, con leve diverse. Va trattato come metrica
     di pari dignità, non come colonna di contorno.
  2. **Sostenuto vs burst**: questi sono run da 64 token. F2 aveva mostrato sul 4B che il
     sostenuto su 10 minuti è ~metà del burst. Prima di dichiarare "5 tok/s" come numero di
     prodotto serve la prova di durata (F5), con lo schermo acceso che ora aggiunge calore.

- **2026-08-06 — 🎯 4.48 tok/s CON I CORE GIUSTI. Il muro torna a essere l'I/O, e il piano
  originale aveva ragione.**

  Primo run con pinning sui core veloci (`taskset 3-7`, cioè A715/A710/X3) dopo il passaggio
  a `top-app`. Config invariata (`--moe-stream --cache-mb 2000 --dense-weights anon
  --overlap --io-threads 4`, `t=5`):

  | metrica | prima (3 core A510) | dopo (pin 3-7) | fattore |
  |---|---:|---:|---|
  | **eval tok/s** | 0.82 | **4.48** | **5.5×** |
  | decode s/token | 1.070 | 0.223 | 4.8× |
  | **compute s/token** | **0.913** | **0.134** | **6.8×** |
  | flash I/O s/token | 0.764 | 0.320 | 2.4× |
  | banda effettiva | 111 MiB/s | **264 MiB/s** | 2.4× |
  | **ttft** | ~91-96 s | **31 s** | 3× |
  | load_s | 157 | 47 | 3.3× |

  **Il run è verificato, non è un artefatto**: stessi 64 token, **stesso** traffico da flash
  (33.09 GB), stessi majflt (~29k), stessa RSS (4630 MB) delle misure lente. Lavoro identico,
  hardware diverso.

  **Il collo di bottiglia si è ribaltato di nuovo, e stavolta in modo definitivo:**
  ```
  decode 0.223 = compute 0.134 + cache mgmt 0.013 + flash I/O 0.320 (in overlap)
  stall = 0.076 s/token  ← il calcolo che ASPETTA l'I/O
  ```
  **`flash I/O 0.320` > `compute 0.134`**: l'I/O è tornato a essere il ramo lento, con uno
  stall esplicito di 76 ms per token. Se l'I/O fosse gratis, decode ≈ 0.147 s/token = **~6.8
  tok/s**. È quello il tetto attuale dell'architettura, e la distanza da 4.48 è tutta I/O.

  **Conseguenze sul piano — quasi tutto ciò che oggi era stato declassato torna valido:**
  - **H3 (prefetch predittivo), H6/G3 (expert packing), F7 (trace + simulatore + predictor)
    tornano centrali.** Erano stati messi da parte stamattina perché «l'I/O non è il ramo
    critico»: lo era, ma solo perché il calcolo era artificialmente lento su tre A510.
  - **Il "risultato negativo" dello sweep cache è RITIRATO**: misurato in un regime dove
    l'I/O non era vincolante, quindi non poteva mostrare nulla. Va rifatto. La cache è al
    **56.9% di hit** con 2000 MiB e ha **4848 ri-letture** di byte già pagati: c'è margine.
  - La banda effettiva è 264 MiB/s contro i **413 MiB/s** che fio misura su letture da 1 MiB:
    margine anche lì, ed è esattamente ciò che l'**expert packing** dovrebbe catturare.
  - **`--load-mode dio` (DirectIO)** torna in cima alla lista, non più come curiosità.
  - Le teorie sul calcolo (kernel IQ2 lenti, matmul minuscoli, quant mista per residenza)
    **non sono confutate ma sono molto meno urgenti**: il calcolo ora è il ramo veloce.
    Restano rilevanti per il tetto dei 6.8 tok/s, non per arrivarci.

  **Gate F4**: la soglia era **≥3 tok/s = PASS**. 4.48 la supera. Da confermare con le 3 rep
  + sentinella e in `top-app` stabile prima di dichiararlo formalmente.

  **Nota su `taskset 3-7`**: include CPU 6 e 7, che il cpuset `top-app` (mask 0x3f = CPU 0-5)
  in teoria non concede. Da verificare quale sia l'affinità **effettiva** del processo, non
  quella richiesta — il numero potrebbe migliorare ancora se il prime X3 fosse davvero
  raggiungibile.

- **2026-08-06 — ⚠ CAUSA RADICE DI TUTTA LA GIORNATA: misuravamo su 3 core lenti su 8.
  Ogni numero di calcolo va rifatto.**

  **Il fatto.** Il processo di inferenza girava nel cgroup `cpuset:/background` +
  `cpu:/background` + `blkio:/low`, cioè **confinato alle CPU 0-2**. Su Snapdragon 8 Gen 2
  quelle tre CPU hanno `CPU part 0xd46` = **Cortex-A510, gli efficiency core**. I quattro
  performance core (0xd4d = A715 su CPU 3-4, 0xd47 = A710 su CPU 5-6) e il prime
  (0xd4e = **Cortex-X3** su CPU 7) **non sono mai stati usati**.
  Non era aggirabile dall'interno: `taskset -c 0-7 nproc` restituiva comunque **3**, perché
  il cpuset del cgroup ha l'ultima parola sull'affinità.

  **La cura, immediata e gratuita: portare Termux in primo piano.**
  ```
  background : cpuset:/background  nproc=3  mask=0x07   (CPU 0-2, solo A510)
  top-app    : cpuset:/top-app     nproc=6  mask=0x3f   (CPU 0-5)
  ```
  Il cambio si propaga **anche ai processi già in esecuzione**. Schermo tenuto acceso
  (`settings put system screen_off_timeout 1800000`) perché l'app non ricada in background
  a metà misura.

  **Cosa invalida.** *Tutta* l'analisi di giornata sul calcolo — «il compute è il collo di
  bottiglia», «0.913 s/token», «8× peggio per parametro attivo del 4B denso», i kernel IQ2
  lenti, i mille matmul minuscoli — parte da numeri raccolti **su tre core deboli**. Le
  ipotesi non sono necessariamente sbagliate, ma **la base numerica non è valida** e va
  rifatta prima di ragionarci sopra. In particolare il famoso **fattore 8 rispetto al 4B
  potrebbe essere in buona parte un artefatto**: se F2 girò con più core disponibili,
  stavamo confrontando un modello su 6 core con uno su 3. **Da verificare per F2 e F3.**

  **E spiega il gradino delle 12:05→12:40** (0.94 → 0.82 a config identica): quando lmkd ha
  ucciso la sessione Termux e **l'ho riavviata io via adb**, l'app è finita in background, e
  con lei tutte le misure successive. Il gradino l'ha causato un'azione dell'operatore, non
  il telefono. La «deriva di sessione del 14%» della voce precedente è quindi **spiegata**:
  non è deriva, è un cambio di cpuset. (E lo sweep thread resta comunque non interpretabile,
  perché con 3 core `t=4` era già in sovrascrizione: il minimo utile sarebbe stato `t=3`,
  che non abbiamo mai misurato.)

  **Regole nuove, non negoziabili:**
  1. **Gate di preflight sui core**: prima di OGNI run, verificare `nproc` e la maschera di
     affinità; se non corrispondono all'atteso, **il run non parte**. È il controllo che
     oggi avrebbe risparmiato otto ore di misure inutili.
  2. **Registrare `nproc` e `affinity_mask` come colonne del CSV.** Senza, una riga non è
     interpretabile a posteriori — come si è visto.
  3. **`top-app` è la condizione realistica di prodotto**, non un trucco da benchmark:
     un'app di chat gira in primo piano con lo schermo acceso e l'utente che guarda.
     Misurare in background era insieme lento e irrealistico. Nota il confondente da
     dichiarare: schermo acceso = più consumo e più calore, quindi va tenuto costante fra
     le configurazioni confrontate, non acceso e spento a caso.
  4. La sessione Termux non va mai riavviata a metà campagna senza rifare la baseline.

  **Aperto**: nemmeno `top-app` dà le CPU 6 e 7 (un A710 e il **prime X3**). Se si trova un
  modo di raggiungerle c'è un ulteriore margine, probabilmente il più grande di tutti visto
  che l'X3 è il core più veloce del chip.

- **2026-08-06 — SWEEP THREAD INVALIDO: c'è una DERIVA DI SESSIONE del 14% che maschera
  tutto. Voce unica, scritta a bracci chiusi (le tre voci intermedie di giornata, con due
  tesi poi ritirate, sono state sostituite da questa).**

  **La prova, ed è indipendente dalla sentinella.** La configurazione **identica**
  (`t=4 --cache-mb 2000 --overlap --io-threads 4`) è stata misurata due volte nella stessa
  giornata:

  | quando | letture | mediana | dispersione |
  |---|---|---|---|
  | F4.2 «C» | 0.93 · 0.96 · 0.97 · sent 0.94 | **0.95** | 4% |
  | F4.3 «C3-t4» | 0.81 · 0.82 · 0.83 · sent 0.80 | **0.82** | 4% |

  Ogni braccio è **internamente compatto e riproducibile**; i due bracci differiscono del
  **14%**. E l'intera sessione scende in modo **monotòno nell'ordine di esecuzione**:
  `cache-auto 0.95 → cache-1500 0.93 → t=4 0.82 → t=5 0.69 → t=6 0.68 → t=8 0.51`, mentre
  la batteria va da 74% a 63% e la temperatura da 29.1 a 30.7 °C.

  **Conseguenza: lo sweep non ha misurato i thread, ha misurato il tempo.** La differenza
  `t=4` vs `t=6` è del 21%, ma la deriva vale già 14% e i bracci sono stati eseguiti in
  quell'ordine: le due cose **non sono separabili** con questi dati. Tutte le conclusioni
  sul numero ottimo di thread sono **ritirate**, comprese le due che avevo scritto oggi
  (prima «t=5 peggiora del 16-21%», poi «t=5 è instabile per sovrascrizione»: la seconda è
  crollata quando `t=6` è risultato compatto a 0.68, e `t=5` resta l'unico braccio con
  dispersione anomala, causa ignota).
  Bracci per il verbale: `t=4` 0.82 (sent. drift 2.4%, VALIDO) · `t=5` 0.69 (sent. drift
  26%, **INVALIDO**) · `t=6` 0.68 (sent. drift 0%, VALIDO) · `t=8` 0.51 (1 rep).
  Le due letture alte di `t=5` (0.86/0.87) **non sono artefatti**: stessi 64 token, stesso
  TTFT, stessi majflt, stesso `read_bytes`, stessa RSS delle basse. Lavoro identico,
  velocità diversa → è il sistema che esegue diversamente, non il carico che cambia.

  **Il buco del protocollo.** La sentinella §8.2 controlla la deriva **dentro** uno stage;
  non esiste nessun controllo **fra** stage. Con bracci sequenziali e una deriva del 14%,
  qualunque effetto sotto il 20% è indistinguibile dall'ordine di esecuzione. Non era mai
  emerso perché finora gli sweep confrontavano bracci adiacenti con effetti grandi.

  **Regole nuove, da adottare da ora:**
  1. **Disegno appaiato**: confronti fra configurazioni si fanno alternando A/B/A/B nello
     stesso blocco e confrontando le coppie adiacenti, **non** con bracci sequenziali.
  2. Ogni sweep si chiude **ri-misurando il primo braccio** come controllo d'ordine, in
     aggiunta alla sentinella del vincitore.
  3. `battery_pct` deve essere una **COLONNA del CSV per ogni riga** (oggi non c'è: il
     livello di carica è usato solo come gate operativo e non viene mai registrato, quindi
     a posteriori **non si può verificare se abbia influenzato una misura** — lacuna emersa
     il 2026-08-06 su domanda di gualt). Insieme a `batt_temp_start/end`, che invece c'è.
     Vanno riportate anche nel summary di ogni stage: sono covariate, non contorno.
     *Controllo fatto con i dati disponibili (dal monitor, non dal CSV)*: nella fascia
     **44-56%** la carica **non** spiega le differenze — il valore più alto misurato (5.16)
     è stato ottenuto al **49%**, cioè con meno carica del 5.06 ottenuto al 56%. Sotto il
     30% l'effetto potrebbe esistere (sag di tensione) e va verificato quando capiterà.
  4. I numeri assoluti **non sono confrontabili fra sessioni**. Solo confronti interni a un
     blocco appaiato lo sono.

  **Primo esperimento da fare (diagnosi della causa)**: ricarica al 100%, stacca, fai
  raffreddare, **ri-misura `t=4` con la config identica**. Se torna ~0.95, la deriva è
  legata allo stato di batteria/termica accumulata e non ai thread — e allora ogni campagna
  lunga va spezzata in blocchi con lo stesso stato di partenza. Finché non è chiuso, **non**
  proseguire con `t=8` né con la variante somma-costante: si rimisurerebbe la deriva.

  **Cosa resta valido dello sweep**: l'idea di variare la ripartizione **a somma costante**
  (`t=5/io=3`, `t=6/io=2`) resta la più sensata da provare — ma per il motivo giusto, cioè
  separare calcolo e contesa, non perché `t=5` sia risultato peggiore. E resta vero che
  `t + io` è la domanda reale di core, un vincolo che nessuno degli studi letti ha, perché
  nessuno di loro **streama pesi mentre calcola**.

  **Non toccati dalla deriva**: il passo 2 (verifica i8mm) e il passo 3 (sonda
  `--n-expert-used`) — il primo è un controllo di configurazione, il secondo è robusto a un
  fattore di scala comune perché guarda la **forma** della curva, non i valori assoluti.

- **2026-08-06 — Due lacune che la campagna si porta dietro dall'inizio (Claude).**

  **1. Non abbiamo MAI misurato l'energia.** Per giorni abbiamo inseguito i tok/s e trattato
  la batteria solo come vincolo operativo (floor 40%, mai in carica), mai come metrica. Per
  un'app su telefono i **joule per token** contano quanto i token al secondo: un modello due
  volte più veloce che consuma il triplo non è un progresso. E si misura quasi gratis —
  `termux-battery-status` dà `voltage` e `current`, quindi la potenza istantanea, e il numero
  di token generati lo abbiamo già.
  **Da fare in harness**: colonna `j_per_token` = (V × I medi durante il run × durata) /
  n_gen, più `power_w_mean`. Campionare la corrente insieme al resto della telemetria, non
  solo a inizio/fine (la corrente varia molto fra prefill e decode). Ordine di grandezza dai
  dati esistenti, da confermare: 35B in streaming ≈ 6 J/token, 4B denso ≈ 1.5 J/token — cioè
  il 4B non è solo ~8× più veloce, è anche ~4× più efficiente per token. Se il numero regge,
  è un argomento di prodotto, non solo tecnico.
  Nota di principio: sui telefoni conviene **"correre e poi dormire"** — finire sui core
  grandi e tornare in idle consuma meno che spalmare il lavoro su tutti i core. È un secondo
  motivo, indipendente dalla velocità, per non usare gli efficiency core.

  **2. Il binario denso (Qwen3.5-4B) eredita 3 scoperte su 4, e la GPU gli si applica MEGLIO.**
  Il 4B è il candidato prodotto a breve per Kalsa, e finora l'abbiamo lasciato fermo ai
  numeri di F2. Cosa trasferisce:
  - **Quantizzazione**: gira a **Q4_K_M**, cioè su un K-quant che su ARM **non ha kernel
    dedicati** e cade sul percorso generico. Q4_0 è l'unico formato con KleidiAI + repack
    online. Taglia quasi identica (4.5 vs 4.8 bpw). **A/B Q4_0 vs Q4_K_M con misura di
    velocità E di qualità** — su un 4B la perdita per bit si sente più che su un 35B, quindi
    la qualità non è opzionale.
  - **Thread**: F2 aveva scelto `-t 4`; l'evidenza big.LITTLE dice numero di core grandi = 5.
  - **i8mm**: stesso controllo del 35B.
  - **GPU: qui il 4B è avvantaggiato**, non svantaggiato. Tutto il blocco sul 35B è
    `MUL_MAT_ID` ("partial", e inesistente per IQ2). **Un modello denso non usa quell'op**:
    gli serve solo la matmul densa, che OpenCL dà come **"full"**, in Q4_0 — lo stesso
    formato verso cui lo sposteremmo comunque per la CPU. È esattamente il caso che gira già
    in giro (denso + Q4_0 + backend GPU). Restano i due dubbi veri: il backend carica su
    Adreno 740, e quanto dura prima del throttling.
  - **Non trasferisce**: tutto lo streaming/cache/expert-packing — il 4B sta in RAM.

  **Metrica di prodotto, da non dimenticare**: il numero del 4B **non è 8.90 tok/s** (burst a
  telefono fresco) ma **4.68** (sostenuto 10 min, F2.4). Ogni ottimizzazione va riportata sul
  sostenuto: è quello che l'utente sente dal secondo messaggio in poi.

- **2026-08-06 — GPU/NPU: la porta è stretta ma non è murata. Verifica dello stato reale.**
  La domanda «perché non usiamo tutto il telefono?» è stata rifatta ora che il muro è il
  calcolo (prima non aveva senso: per un muro di I/O la GPU non serve). §3.2 diceva
  "OpenCL non supporta i tensori MoE" e "Vulkan rotto su Adreno 740": **la prima è ormai
  FALSA, la seconda è imprecisa.** Fonte principale: talk Qualcomm a IWOCL 2026 (Wang et
  al.) + `docs/backend/OPENCL.md`.
  - **OpenCL**: `MUL_MAT_ID` **è mergiato** nel backend pubblico. Ma Qualcomm stessa lo
    classifica **"MoE (mul_mat_id): partial — routing works, per-expert tuning ongoing"**,
    contro "full" di CUDA/Metal/Vulkan. Quant supportati: Q4_0/1, Q5_0/1, Q8_0, Q4_K, Q5_K,
    Q6_K, MXFP4, IQ4_NL — **nessun IQ a 2 bit**, e i kernel `MUL_MAT_ID` esistono solo per
    **Q4_0, Q4_1, Q4_K, MXFP4**. Con UD-IQ2_M il MoE su GPU **non è eseguibile**, punto.
  - **Adreno 740 non è nella lista verificata** (750, 810, 830, 840, X1-85, X2-90). Le slide
    Qualcomm parlano genericamente di "7xx e 8xx": discrepanza da risolvere **empiricamente**
    (test da 30 minuti: compila con `-DGGML_OPENCL=ON` e vedi se carica).
  - **Il dato che ridimensiona tutto**: i numeri spettacolari di Qualcomm (5×, 600+ tok/s in
    prefill su gpt-oss-20B MXFP4) sono su **Snapdragon X2 Elite — un chip da laptop** — con
    **kernel ILA in assembly interni, non pubblici**. E **il nostro modello, Qwen3.5/3.6-A3B,
    è nella loro lista dei supportati ma marcato "Internal ILA path; flagship demo"**. Cioè:
    gira benissimo nel loro laboratorio, su codice chiuso, su hardware che non è un telefono.
    Sul percorso pubblico non esiste **nessun numero** per la nostra combinazione. È G5 in
    forma pura: i sistemi migliori esistono e non sono pubblicati.
  - **Vulkan**: `MUL_MAT_ID` c'è (shader generici), ma i driver Adreno crashano in modo
    ricorrente e trasversale alle generazioni — sul 740 c'è un `createComputePipeline:
    ErrorUnknown` proprio sulla pipeline `matmul_q4_k` (issue #6713, stale). Qualcomm
    stessa dà a Vulkan priorità inferiore rispetto a OpenCL. **Non è la strada.**
  - **Hexagon NPU**: backend sperimentale in mainline; 8 Gen 2 = Hexagon **v73**, "elencato
    ma non verificato" (verificati v75/v79/v81). Esempio MoE esistente solo su **OLMoE-1B-7B**,
    giocattolo. Resta aperta la questione **firma del codice DSP** su un S23 Samsung con
    Knox: non verificato. GenieX (SDK Qualcomm 2026) **esclude esplicitamente 8 Gen 2**.
    **Parcheggiare.**
  - **Fisica**: 8 Gen 2 ha ~67 GB/s di banda **condivisa** fra CPU e GPU. La GPU non alza
    il tetto di banda: aiuta solo se il limite è ALU/dequant sui byte già letti — che è
    plausibilmente il nostro caso, ma va dimostrato.
  - **Termica, avvertimento serio per il prodotto**: su S24 Ultra è documentato un **floor
    di frequenza GPU imposto dall'OS che TERMINA l'inferenza** sotto carico sostenuto (gli
    autori hanno dovuto spegnere lo schermo e ridurre il contesto). Niente di equivalente
    riportato per la CPU. Per un'app di chat un guadagno che si spegne da solo non è un
    guadagno.

  **L'unico bersaglio realistico, e converge con l'analisi CPU**: mettere sulla GPU **solo il
  tronco denso** (attention + shared expert) via **OpenCL**, tenendo gli esperti routed sulla
  CPU con `-ngl` + `--n-cpu-moe`/`-ot`. È l'unico pezzo che la tabella Qualcomm dà come
  **"full"** (GEMM/GEMV densa), non tocca il percorso MoE "partial", non richiede i kernel
  ILA chiusi. E i pesi densi sono **residenti**: si caricano una volta, non si streamano —
  quindi il costo di portarli in memoria GPU si paga una volta sola. **Stessa conclusione a
  cui porta l'analisi della quantizzazione**: densi in Q4_0 = kernel ARM veloci sulla CPU
  *e* formato pienamente supportato da OpenCL. La quantizzazione mista per residenza è ora
  giustificata da tre direzioni indipendenti.
  Prerequisiti prima di investirci: (1) il backend OpenCL carica davvero su Adreno 740?
  (2) quanto costa portare i densi in memoria GPU senza zero-copy — AHardwareBuffer non è
  integrato in ggml, andrebbe scritto.

  **Da valutare, unico software pubblico con focus MoE-on-edge**: `mllm`
  (UbiquitousLearning, base di EdgeMoE) — ARM CPU + OpenCL + QNN, ma scala provata
  8x2B, lontanissima dai nostri 35B. **PowerInfer-2 confermato NON pubblico** (issue #207
  senza risposta): resta paper.

- **2026-08-06 — F4.2: IL COLLO DI BOTTIGLIA SI È SPOSTATO. Riorientamento del piano (Claude).**
  Primi numeri BigMoeOnEdge (35B UD-IQ2_M, `--moe-stream --cache-mb 2000 --dense-weights anon
  --overlap --io-threads 4`): **0.93-0.97 tok/s**, ttft ~86 s. Dal log del runtime:
  ```
  read 84.73 MiB/token, decode 1.070 s/token
     (compute 0.913 + cache mgmt 0.050 + flash I/O 0.764 s/token, 111 MiB/s)
  cache: 56.9% hit, resident 1999.7 MiB, 8843 evictions, 4848 re-reads (75.8/token)
  ```
  - **H2 non solo confermata, stravinta**: 9.5 GiB/token (F3) → **84.7 MiB/token**, cioè
    **115×**; majflt 11.4M → 33k (340×). Lo streaming degli esperti funziona.
  - **MA con `--overlap` il percorso critico è il CALCOLO**: compute 0.913 s vs I/O 0.764 s.
    **Se l'I/O andasse a zero saremmo a 1.1 tok/s.** Tutto il ramo I/O del piano — H3
    (predictor), H6/G3 (packing), F7 (trace+simulatore), cache più grande — **non è
    sbagliato, è diventato prematuro**: ottimizza un ramo già coperto dall'overlap.
  - **L'anomalia da spiegare**: il 4B denso Q4_K_M fa 0.112 s/token con ~4B parametri
    attivi; qui ~3B attivi costano 0.913 s. **8× peggio per parametro attivo.** Un MoE
    dovrebbe costare MENO di un denso di pari attivi.

  **Ricerca 2026-08-06 — cause e leve (fonti in §13):**
  1. **IQ2 su ARM è il percorso peggiore possibile** [CONFERMATO]. Gli IQ memorizzano indici
     in un codebook: il loop interno fa lookup + ricostruzione invece di mappare diretto su
     NEON dotprod. In mainline llama.cpp **solo Q4_0 e IQ4_NL hanno kernel ARM veloci**;
     KleidiAI accelera **solo Q4_0/Q8_0**; il repack online copre Q4_0; l'ottimizzazione
     i8mm di Arm ha toccato Q6_K/Q4_K su Neoverse, **niente a 2 bit**. Stima 2-5× — grossa,
     ma **non spiega tutto l'8×**.
  2. **Thread**: su big.LITTLE il numero ottimo è **il numero di core grandi**; aggiungere
     gli efficiency core **peggiora** (straggler sulla barriera), e in decode il degrado è
     più marcato. 8 Gen 2 = 1 prime + 4 perf + 3 eff → **`-t 5`**, non 4 (ereditato da F2,
     regime diverso) né 8.
  3. **i8mm su Android**: regressione nota di detection in alcune versioni llama.cpp
     (`lscpu` lo vede, llama.cpp no → fallback scalare). **Da verificare sul nostro build.**
  4. **Esperti minuscoli** (`moe_intermediate_size` 512, 9 attivi × 3 matmul × 40 layer):
     overhead di dispatch/barriera pagato ~1080 volte per token invece di ~120. Meccanismo
     plausibile ma **non quantificato in letteratura per questa forma**. Attenzione: il
     grouped GEMM **non riduce i FLOP a batch=1** — con un token solo non c'è nulla da
     raggruppare; il guadagno sarebbe solo di overhead. Ridimensiona l'idea "fondere gli
     esperti".
  5. **MTP/speculative: aspettative da abbassare.** Tutti i numeri di llama.cpp (PR #22673,
     1.7-1.85×) sono **GPU**. Nessun benchmark CPU-only per MoE. E su **Qwen3.6-35B-A3B
     specificamente** lo speculative è risultato **in perdita netta su RTX3090 in 19
     configurazioni su 19**. Il meccanismo (ammortizzare letture memory-bound su N token)
     è più debole in regime compute-bound. **H4 va declassata**, non promossa.
  6. **Lead nuovo con codice**: i **Trellis quant di ik_llama.cpp** (IQ2_KT/IQ3_KT/IQ4_KT)
     sostituiscono il lookup su codebook con aritmetica a trellis, con supporto NEON —
     nati esattamente contro il problema del punto 1. ik_llama.cpp dichiara 4.6-7× sui
     kernel ARM vs mainline. Nessun confronto controllato Trellis vs IQ2_M a 2 bit: da
     misurare noi.

  **Scala degli esperimenti (dal più economico), da eseguire in F4.3:**
  | # | Cosa | Costo | Atteso |
  |---|---|---|---|
  | 1 | sweep `-t` {4,5,6,8} sulla config attuale | minuti | 1.1-1.3× |
  | 2 | verificare che il build usi davvero i8mm/dotprod | minuti | 0 o molto |
  | 3 | profilare quanto degli 0.913 s è dispatch/barriera vs dot-product | ore | diagnosi |
  | 4 | **UD-Q2_K_XL vs UD-IQ2_M** (era F4.4, ora prioritaria) | ore | ? — nota: anche i K-quant su ARM non hanno kernel dedicati, il salto vero è verso Q4_0 |
  | 5 | **Quant mista per residenza (idea nuova)**: tensori RESIDENTI (trunk denso, attention, shared expert) in **Q4_0** = kernel ARM veloci, costo solo RAM e **zero traffico flash**; esperti ROUTED restano a 2 bit perché sono quelli che si streamano. Oggi paghiamo il kernel lento anche su ciò che non viene mai streamato. | 1-2 giorni (requant per-tensore) | potenzialmente il più grande |
  | 6 | Trellis quant ik_llama.cpp | giorni (altro runtime) | ignoto, alto |

  Ordine deciso: 1-2-3 subito (misura, nessun codice), poi 4, poi 5. MTP (F6) **rinviata**
  finché il calcolo non scende: oggi non è la leva giusta.

  **Conferma sperimentale del riorientamento (8 righe `F4.3`, sweep `--cache-mb`).** Grok
  aveva lanciato lo sweep della cache — il vecchio F4.3, deciso quando credevamo che il muro
  fosse il flash. Esito: `--cache-mb 1500` → 0.90-0.95, `auto` → 0.93-0.96, contro `2000` →
  0.93-0.97 di F4.2. **Tutto entro il rumore: la dimensione della cache non sposta niente.**
  È esattamente ciò che prevede l'analisi — con `--overlap`, ridurre l'I/O agisce su un ramo
  che non è il percorso critico. Risultato negativo valido: **il ramo I/O è chiuso**, non ci
  si torna finché il calcolo non scende sotto l'I/O. Le 8 righe restano in archivio come
  prova, non come sweep da estendere.
  Da guardare: l'harness segnala `ttft_lt_load` su queste righe (ttft ~86 s < load_s ~157 s).
  Con lo streaming il "load" può completarsi in background dopo il primo token, quindi non è
  necessariamente un bug — ma il check va interpretato, non lasciato acceso a vuoto.

  **Lezione operativa (2026-08-06, canale caduto durante F4).** sshd è morto **senza
  riavvio** (uptime 7 h): Android ha ucciso la sessione Termux durante i run del 35B
  (~4.7 GB RSS + 2 GB di cache esperti = pressione di memoria, lmkd). Recuperato via adb in
  un minuto senza intervento umano (`am start` di Termux + `input text 'sshd'`), quindi
  **non è un'azione umana obbligata** come sembrava. Mitigazioni per F4.3+: lanciare
  l'harness sotto `nohup`/`setsid` così sopravvive alla morte della sessione ssh, riarmare
  `termux-wake-lock` all'inizio di ogni blocco, e ricordare che il CSV è scritto in modo
  incrementale — un canale caduto non perde i run già chiusi.

- **2026-08-06 notte — ANOMALIA APERTA sul binario: da risolvere PRIMA di F4 (Claude).**
  Cercando di capire perché `ttft_ms` resta vuoto ho trovato un problema più grosso, e
  **non l'ho risolto**: quello che segue è un referto, non una diagnosi chiusa.
  - **Fatto 1 — riproducibile.** `build-safe/bin/llama-cli` (pin 67d5978) **aborta in
    `load_tensors`** (`SIGABRT`, `src/llama.cpp:62: fatal error`, top frame
    `llama_load_mode_from_str`) su **tutti e tre i modelli** (4B, LFM2, 35B) quando
    `--load-mode` non è passato. Con **`--load-mode mmap` esplicito carica e genera**
    (`[ Prompt: 2.5 t/s | Generation: 2.2 t/s ]` sul 4B). Testato ~8 volte, deterministico
    in entrambe le direzioni. Non è memoria (4.2 GB `MemAvailable`), non è `TMPDIR`, non è
    un file corrotto (crashano tutti e tre), non è il binario cambiato (mtime 2026-08-03
    23:57, cioè **precedente** ai run F2 riusciti), non sono variabili d'ambiente
    (nessuna `LLAMA_*`/`GGML_*` né in shell interattiva né di login).
  - **Fatto 2 — non spiegato, ed è questo il punto.** La riga di comando dell'harness
    (`run_bench.sh:1033-1046`) è **identica** a quella che fallisce — stessi flag, stesso
    ordine, stesso `< /dev/null` — e alle 22:00-00:22 ha caricato e generato senza
    problemi 9 volte di fila, exit 0. Alle 01:00 la stessa riga aborta.
    **Un ambiente che cambia comportamento in silenzio invalida qualunque confronto**: se
    F4 gira in queste condizioni non sapremo se un delta viene da BigMoeOnEdge o dal
    binario. Va chiuso prima, non "aggirato".
  - **Fatto 3.** Con `--load-mode mmap` il processo carica, genera, e poi **non esce**:
    resta appeso oltre `--single-turn`/`--no-conversation` fino al timeout (rc=124), e in
    un run manuale ha mostrato il banner della REPL interattiva (`> `, `/exit`, `/regen`).
    Sotto l'harness invece usciva con rc=0. Se in F4 ricapita, un run resta appeso 45
    minuti e finisce come `BLOCKED/timeout` invece che come dato.
  - **F3 NON è invalidata**: quei run hanno caricato, generato, chiuso con rc=0 e prodotto
    numeri coerenti fra loro sullo stesso percorso mmap.
  - **Test decisivo che non ho potuto fare**: lanciare `run_bench.sh` così com'è. Il gate
    batteria lo blocca perché il telefono è in carica (corretto che lo faccia) — quindi va
    rifatto **a telefono scollegato**. È il primo passo prima di qualsiasi cosa in F4:
    se l'harness passa e la mano fallisce, la differenza è nell'ambiente di invocazione e
    va trovata lì; se fallisce anche l'harness, si ricostruisce il binario.
  - **Solo dopo**, se confermato: passare `--load-mode mmap` esplicito in
    `build_run_cmdline` (e registrarlo nella colonna flags, perché diventa parte della
    configurazione misurata), più un guard che fallisca subito se nel log compare il
    banner della REPL.
  - **Scoperta collaterale che vale una riga in F4**: questa build espone
    **`--load-mode dio` (DirectIO)**. Visti i **9.5 GiB riletti per token** di F3, causati
    dalla page cache continuamente sfrattata, bypassarla del tutto è esattamente
    l'esperimento suggerito da kimi-k3-in-c (§3.3) — ed è già disponibile, senza scrivere
    codice. Da provare in F4 accanto a `mmap`, non da rimandare a F8.
  - Difetto minore dell'harness: il gate batteria scatta **prima** di `--print-cmd`, che
    non esegue nulla; stampare la cmdline a telefono collegato è impossibile.
  - **Aggiornamento 2026-08-06 mattina — altre 5 ipotesi cadute, e 2 fatti nuovi.**
    Cadute: pseudo-terminale (crasha anche con `ssh -tt`), riavvio pulito, flag
    `-ctk/-ctv`, secondo binario (`build/`), stato del telefono (scollegato, 100%, 26°C).
    **Fatto nuovo 1 — il workaround regge sul modello che conta**: 35B + flag esatti di
    F3 + `--load-mode mmap` → nessun abort, e i numeri **coincidono con F3**
    (`[ Prompt: 1.8 t/s | Generation: 0.1 t/s ]`). È una **conferma indipendente del muro
    di F3**, ottenuta con un percorso diverso: 0.10 tok/s non era un artefatto dell'harness.
    **Fatto nuovo 2 — `--perf` NON produce il blocco perf nemmeno così**: `ttft_ms` resta
    vuoto. La spiegazione di Grok regge, ma la conseguenza cambia strategia: **smettere di
    inseguire `llama_perf_context_print`**. L'harness legge già lo stream di output del
    processo, quindi il TTFT va misurato **fuori dal binario**, prendendo il wall-clock
    del primo token emesso sullo stream. Più robusto e indipendente dal runtime — utile
    anche per `bmoe-cli` in F4, che ha un formato di output diverso.
    Confermato anche il blocco post-generazione: il 35B genera e poi **non esce**
    (rc=124 al timeout). Sotto l'harness usciva con rc=0 — differenza ancora non spiegata.
  - **Aggiornamento 2026-08-06 ~06:30 — ANOMALIA CHIUSA (mitigata; Grok, solo agente).**
    Report: `reports/moe-f3-binary-anomaly.md`. Commit harness `bc1ee61`.
    **Test A:** rebuild `build-safe2` pin 67d5978 (GGML_NATIVE=OFF, stessa ISA) → PREFLIGHT OK.
    4B **senza** `--load-mode`: rc=0, genera, Exiting. **Anche il vecchio build-safe** (stesso
    mtime 2026-08-03) **ora** carica senza flag. Pin e file su disco **non** sono la causa
    permanente; trigger transiente non più riprodotto (boot 05:17 + MemAvailable ~5.1 GiB).
    **Test B:** non rilanciato `start_f3 numa` (CSV già completo). Diagnostica equivalente
    via `run_bench` 4B + env start_f3 → rc=0, flags=`--load-mode mmap`, ttft_wall, spinner
    collassato. Preflight 4B 30s rc=0.
    **Harness (a prescindere):** sempre `--load-mode mmap` in cmdline+CSV; preflight 4B in
    `start_f3` (exit 10); anti-REPL hang → exit 9; batteria dopo `--print-cmd`; stream
    filter CR/spinner; `ttft_ms` wall-clock primo token stream (non `--perf`).
    Test: `test_run_bench` 54 PASS, `test_f3` 47 PASS.
    **Binary F4 raccomandato: `build-safe2`.** F3 non invalidata. Root-cause non
    deterministica → mitigazione obbligatoria, non «ignorare e sperare».

- **2026-08-06 — Gate F3 ACCETTATO (Claude): PASS, con 4 correzioni. Il muro è misurato.**
  Numeri: **0.10 tok/s** su tutte e tre le varianti (default, `--numa distribute`,
  `--no-warmup`), **~11.4M majflt** e **~9.5 GiB letti da flash per token** — l'intero
  modello riletto ~28 volte ogni 32 token. **Warm ≈ cold**: con 7 GB di RAM la page cache
  non trattiene il working set. Zero OOM, zero lmkd, sentinella a drift 0. Il piano
  stimava 1.2–1.3 tok/s: la realtà è **12× peggio**, il che rafforza la tesi del progetto
  invece di indebolirla — nessuna manopola di mmap salva il naive.
  Correzioni applicate a `reports/moe-f3.md` (sezione "Correzioni post-audit") e a §9:
  (1) la colonna MiB/tok era **1024× troppo alta** (KiB spacciati per MiB) — pericoloso
  perché F4 misura la riduzione di traffico contro questa baseline; (2) **"0.10" ha
  risoluzione ±0.05** (viene dalla riga compatta a 1 cifra significativa, non dal blocco
  perf): quindi "numa non dà guadagno" NON è dimostrato, è solo non misurabile con questo
  strumento; (3) `--no-warmup` è esplorativa, non riga promossa (1 rep, nessun warm);
  (4) `read_bytes_delta=0` va letto come "non misurato", non come zero.
  **Prerequisito per F4** oltre a batteria ≥80% e ≤30°C: far stampare il blocco perf vero
  (`llama_perf_context_print`) — senza `ttft_ms` e con 1 cifra significativa, F4 non
  potrebbe distinguere un 3 tok/s da un 5 tok/s in modo difendibile.

- **2026-08-05 notte — Canale di controllo riparato (Claude). LEGGERE PRIMA DI RIPARTIRE.**
  Dopo un riavvio il telefono era irraggiungibile (sshd giù, adb wireless spento). Causa,
  fix e limiti accertati sono in **§2.3**; qui la parte che cambia il lavoro di Grok:
  1. **sshd ora riparte da solo a ogni riavvio** (verificato con un riavvio reale: sshd su
     ~80 s dopo il boot, marker `~/.boot_ready`, log `~/boot.log`). Non serve più toccare il
     telefono per riavere il canale.
  2. **adb NON è più un canale affidabile**: il toggle "Debug wireless" muore a ogni riavvio
     e non è riattivabile da software (testato: `svc power reboot`, `/system/bin/reboot`,
     `am ... REBOOT`, `setprop persist.adb.tcp.port` — tutti negati). **Ogni script deve
     funzionare interamente via ssh.** Se un passo richiede `adb`, va segnalato a gualt come
     azione umana, non assunto come disponibile.
  3. **Cold senza riavvio**: sul telefono ci sono ora `~/bin/fadv` (sorgente
     `scripts/fadv.c`) e `~/bin/cold_model.sh`. Verificato: 153856 pagine residenti → 0,
     con exit non-zero se il file resta residente. **Compito di Grok**: cablare
     `cold_model.sh "$MODEL"` dentro `run_f3.sh`/`start_f3.sh` al posto dell'assunzione
     "il run cold parte dopo un riavvio umano", e aggiungere `MemAvailable` (da
     `/proc/meminfo`, leggibile) come colonna/covariata di ogni riga CSV. Finché non è
     cablato, le righe cold di F3 vanno marcate `cold=fadv` o `cold=reboot` nelle note —
     mai lasciate ambigue.

- **2026-08-05 — Addendum F3 (Claude, durante la fase — 2 punti critici per l'harness):**
  (1) **Timeout harness**: i timeout calibrati sul 4B (load in secondi) NON valgono per il
  35B naive — il solo caricamento può durare 10-30+ minuti in thrashing. Timeout per-run in
  F3 ≥ 45 min, altrimenti l'harness ammazza run validi e registra spazzatura. Un run ucciso
  DA NOI non è un dato: solo lmkd/OOM di Android lo è.
  (2) **ttft_ms VA POPOLATO da questa fase in poi** (in F2 la colonna è rimasta vuota): in
  F3 il tempo-al-primo-token È una metrica primaria del muro, non un nice-to-have. Se il
  parser non lo estrae dai timing di llama-cli, va sistemato PRIMA dei run, e in ogni caso
  registrare anche il wall-clock load-time (da log runner) come colonna note.
  (3) Promemoria §8.2: le righe B/B2 sono "promosse" → per ciascuna variante servono il
  cold (post-riavvio) E il warm immediato senza riavvio, in coppia.

- **2026-08-05 sera — Gate F2 ACCETTATO (Claude): PASS-CONDIZIONATO → via libera a F3.**
  Numeri chiave: 4B denso 8.90 tok/s burst / **4.68 sostenuti su 10 min** (il sostenuto vale
  ~metà del burst su questo device: metro per giudicare F4); fio fatto; LFM2 = risultato
  negativo valido (nessuna quant gira senza thrashing su 8GB → niente baseline MoE-in-RAM,
  controllo = 4B denso; per il prodotto se ne riparla con lo streaming F4+). F3 è MISURA,
  non ottimizzazione: lmkd kill e tok/s ridicoli sono dati validi, non fallimenti. Batteria
  93% ✓. Promemoria: cold = riavvio; MAI caricatore durante la fase.

- **2026-08-05 mattina — Nota di revisione F2.3c (Claude).** F2.2c chiusa pulita: 4B =
  **8.90 tok/s** (t4/c1024/f16) → soglia F2 di fatto raggiunta. F2.3c invece è "done with
  warning": sentinella kv FALLITA due volte (drift 0.95), majflt milionari e ~10GB riletti
  per 128 token anche col protocollo conforme → **LFM2 Q4_K_M (5.04GB) è memory-bound su
  questo device: il 5.30 tok/s NON è un baseline affidabile**. Azioni per Grok al resume:
  (1) F2.3c-bis con **LFM2 Q4_0 (4.73GB)** — stessa griglia ridotta (threads best + ctx best,
  3 rep + sentinella) — prima di dichiarare il numero prodotto; (2) F2.4 termica; (3) report
  gate F2. Telefono in ricarica ≥80% (regola §8.2) prima di F3.

- **2026-08-03 — Checkpoint F0.4: PASS confermato (verdetto Claude).** Spot-check
  indipendente sul clone locale (pin submodule `5236140e5` identico al report,
  `LLAMA_CURL OFF FORCE`, LRU/route-trace/`bmoe-cli` presenti nel tree): il report
  `reports/moe-f0.4.md` riflette il codice reale. Adottata la raccomandazione F8 = estendere
  BigMoeOnEdge. Emendamenti applicati al piano: F4.1-F4.3b (bmoe-cli, floor cache 1500,
  overlap/io-threads/prefetch nella griglia, knob lossy separati), F7.1 (route-trace già
  presente, zero patch), F7.3 (baseline aggiuntive `--predict-prefetch`/`--route-ahead`),
  F8 (base runtime decisa). **Autorizzato procedere con F0.5-F0.6 e, a telefono pronto, F1+.**

- **2026-08-04 — Nota di revisione F2.2 (Claude, non un gate).** Analisi di `runs.csv`:
  la preoccupazione "4B < 8-10 tok/s" del report F2 è quasi certamente un **artefatto di
  protocollo**, non un problema del device. Evidenza: stessa config (t4, c512) → 5.9 tok/s
  back-to-back vs **8.9/8.7 tok/s** da telefono riposato (run `…-083319`/`…-083413`); i run
  lenti hanno majflt_delta 200-450k (page-cache eviction) vs 11k del run veloce; degrado
  progressivo dentro ogni stage (c4096: 8.5→5.5→4.9 con batteria 31.7→32.6°C).
  **Azioni per Grok**: (1) applicare le tre nuove regole di §8.2 (cooldown ≥3min + ≤30.0°C,
  sentinella anti-drift, majflt come covariata); (2) **rifare lo stage threads** col nuovo
  protocollo prima di fidarsi di "t4 best" (fu misurato tutto in regime caldo); (3) completare
  ctx/kv con cooldown; (4) la diagnostica profonda pre-F3 proposta nel report F2 NON serve:
  il device raggiunge già la fascia attesa da fresco; (5) nit harness: colonne `ttft_ms` e
  `flags` del CSV sono vuote — riempirle. Gate F2 resta da chiudere con F2.2 completa +
  F2.3 (LFM2) + F2.4 (termica).

---

## 13. Fonti (verificate 2026-08-03)

**Modelli**
- Qwen3.6-35B-A3B: https://huggingface.co/Qwen/Qwen3.6-35B-A3B
- GGUF: https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF · MTP: https://huggingface.co/unsloth/Qwen3.6-35B-A3B-MTP-GGUF · https://huggingface.co/ggml-org/Qwen3.6-35B-A3B-MTP-GGUF
- Qwen3.5-4B: https://huggingface.co/Qwen/Qwen3.5-4B · GGUF unsloth (base + MTP)
- LFM2-8B-A1B: https://huggingface.co/LiquidAI/LFM2-8B-A1B-GGUF
- Gemma-4-26B-A4B: https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF
- SmallThinker: https://github.com/SJTU-IPADS/SmallThinker (no motore Android pubblico: https://github.com/SJTU-IPADS/PowerInfer/issues/207)

**Runtime**
- BigMoeOnEdge: https://github.com/Helldez/BigMoeOnEdge
- llama.cpp mmap: https://github.com/ggml-org/llama.cpp/blob/master/src/llama-mmap.cpp
- PR #26003 --lazy-experts (OPEN): https://github.com/ggml-org/llama.cpp/pull/26003 · PR #24156 --reclaim-mmap-source
- PR #19435 Qwen3.5 dense+MoE: https://github.com/ggml-org/llama.cpp/pull/19435
- PR #22673 MTP: https://github.com/ggml-org/llama.cpp/pull/22673 · issue Metal #23011
- PR #15077 --cpu-moe · PR #11397 --override-tensor · PR #19493 speculative checkpointing
- Test speculative RTX3090: https://github.com/thc1006/qwen3.6-speculative-decoding-rtx3090
- Bug DirectIO scoped storage: https://github.com/ggml-org/llama.cpp/issues/18804
- Vulkan Adreno 740: https://github.com/ggml-org/llama.cpp/issues/6713 · OpenCL docs: docs/backend/OPENCL.md
- Expert-cache forks/issue: https://github.com/ggml-org/llama.cpp/issues/20757
- llama.rn: https://github.com/mybigday/llama.rn (0.12.8)
- ik_llama.cpp: https://github.com/ikawrakow/ik_llama.cpp (Termux PR #336; regressione MoE #1699; quant MoE discussion #359)
- Termux llama-cpp package: https://github.com/termux/termux-packages/blob/master/packages/llama-cpp/build.sh
- Phantom process killer: https://github.com/termux/termux-app/issues/2366 · https://dontkillmyapp.com/samsung
- S23 128GB UFS 3.1: https://www.gsmarena.com/128gb_samsung_galaxy_s23_to_use_the_old_ufs_31_storage-news-57375.php · AndroBench: https://www.digit.in/reviews/mobile-phones/samsung-galaxy-s23-review-258863.html

**Letteratura**
- Mixtral: arXiv:2401.04088 · Local Routing Consistency: arXiv:2505.16056 · Caching analysis: arXiv:2511.05814
- PowerInfer-2: arXiv:2406.06282 · LLM in a Flash: arXiv:2312.11514 · EdgeMoE: arXiv:2308.14352
- Mixtral-offloading: arXiv:2312.17238 (github.com/dvmazur/mixtral-offloading) · MoE-Infinity: arXiv:2401.14361
- Pre-gated MoE: arXiv:2308.12066 · SwapMoE: arXiv:2308.15030 · AdapMoE: arXiv:2408.10284
- HOBBIT: arXiv:2411.01433 · ProMoE: arXiv:2410.22134 · ExpertFlow: arXiv:2410.17954
- Fate/Cross-Layer Gate: arXiv:2502.12224 · PreScope: arXiv:2509.23638 · FlashMoE: arXiv:2601.17063
- SpecPrefetch: arXiv:2607.24787 · DraftExpert: arXiv:2607.24434 · EVICT: arXiv:2605.00342
- MoESD: arXiv:2505.19645 · SliceMoE: arXiv:2512.12990 · Klotski: arXiv:2502.06888
- Survey on-device 2026 ("the architecture … doesn't exist yet"): https://v-chandra.github.io/on-device-llms/
- Co-attivazioni Qwen3.5-35B-A3B: https://blog.doubleword.ai/moe-expert-coactivations

---

*Fine del piano V1. Grok: parti da F0.1 (ri-verifica online) e F0.4 (audit BigMoeOnEdge) — tutto
il resto dipende da quei due report.*

---

# PARTE II — cronaca STATO CORRENTE fino al 2026-08-20

Appesa il 2026-08-20 (secondo sfoltimento). Blocchi spostati VERBATIM da
PLAN.md § STATO CORRENTE, ordine originale, nessuna riga persa.

---


# ⭐ STATO CORRENTE

> 📕 **GERARCHIA DEI DOCUMENTI (regola gualt, 2026-08-16 — non invertirla).**
> **`PLAN.md` è IL documento principale e si aggiorna SEMPRE**: a ogni verdetto,
> a ogni kill, a ogni misura, a ogni correzione — nel momento in cui succede,
> non a fine giornata. È il registro autoritativo della campagna e vince su
> qualunque altro file in caso di conflitto.
> **`docs/ALIVE.md` è un DERIVATO**, la vista a una pagina di cosa è ancora in
> piedi: si aggiorna **dopo una giornata di lavoro**, riassumendo dal PLAN.
> Non ci si scrive mai niente che non sia già nel PLAN, e non si legge mai
> ALIVE al posto del PLAN per decidere.

> 🛠️ **19/08 ~10:40 — L'ORACOLO LATO CONSUMER ESISTE: COSTRUITO, COMPILATO,
> NON ANCORA ESEGUITO (S23 occupato dall'altra sessione).**
>
> Due commit su `kalsa/kernel-s3-repack` (`538341999` atterraggio, `d8b6528e8`
> chunking anti-OOM per i tensori 2880×2880×32), **puramente additivi** (607+,
> 0−), verificati su disco da me. Gated da `GGML_OPENCL_ORACLE=1`, inerte
> altrimenti. Disegno: **4 kernel = (idioma gemv|gemm) × (lettura buffer|image)**,
> dump di float dequantizzati E word grezzi, confronto host **nello stesso run**
> contro `dequantize_row_q4_0`; verbatim-ness per **concatenazione dei sorgenti
> reali** (program = `gemv_src`/`gemm_src` + wrapper, niente ricopiature), stesse
> `CL_moe_compile_opts` dei consumer veri (onora `GGML_OPENCL_MOE_OPTS`). Il
> doppio read-path + dump raw serve a distinguere un difetto di **coerenza
> immagine/buffer** (il paradosso bitselect) da un difetto del **dequant
> compilato**.
> Build nuova `build-android-opencl-s3oracle/` (s3printf/s3base intatte);
> `libggml-opencl.so` sha `8da5316f9cdcdab5…3826048b`, 7 587 272 B,
> mtime 19/08 10:37. Invocazione pronta (REPORT dell'agente,
> `scratchpad/agents/oracle-consumer/REPORT.md`):
> `GGML_OPENCL_HOST_REPACK=1 GGML_OPENCL_ORACLE=1 ./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID -p 'type_a=q4_0'`
> ⚠️ **Limite epistemico dichiarato dall'implementatore e da tenere a mente:
> il program oracolo è un COMPILATO DIVERSO dal program consumer** (stesso testo
> dell'helper + stesse opzioni, ma kernel extra in coda): un oracolo ROSSO trova
> il difetto nell'idioma; un oracolo VERDE **non** proscioglie l'ISA del
> GEMM/GEMV reale. ⚠️ Non eseguito da nessuna parte (niente smoke PC OpenCL);
> q4_1/mxfp4 non aggiunti.
>
> 🔎 **AUDIT OSTILE CONSEGNATO (Reviewer Math/DeepSeek, report in
> `scratchpad/agents/oracle-consumer-review/REPORT.md`): 2 HIGH CONFIRMED,
> 4 MEDIUM, fix rimandati all'implementatore.**
> - **F1 (HIGH):** la produzione può selezionare il **GEMM binario offline**
>   `kernel_gemm_moe_q4_0_f32_ns_bin` (blob `_ila`, via
>   `libadreno-opencl-kernels.so`) che l'oracolo **non esercita mai**: un
>   oracolo verde proscioglierebbe il componente sbagliato. Il GEMV non ha
>   variante bin e trasferisce per intero. Mitigazione: log
>   `gemm_bin_loaded=0|1` + sezione esplicita nel report; NON si tenta di
>   oracolare il blob.
> - **F2 (HIGH, aritmetica confermata):** tolleranza 0.25·|d| ~64× più larga
>   del necessario (fp16-rounding ⇒ ≤0.0039·|d|): un errore di scala ≤3%
>   passerebbe TUTTI i check (`all_ok=1` con dequant corrotto). Fix: banda
>   giustificata + dump dei byte di `d` come canale indipendente.
> - MEDIUM: `ORACLE=0/false` ABILITA (check di presenza); `CL_CHECK` su
>   `clCreateImage` cambia il normal-path anche a oracolo spento; nessuna
>   detection di HOST_REPACK attivo (rosso misattribuibile al consumer);
>   skip silenzioso dei tensori fuori euristica di nome.
> - ✅ **SOUND con evidenza:** verbatim-ness (il `.cl.h` embedded nel `.so` è
>   byte-identico all'HEAD), aritmetica di indirizzamento e chunking, sync
>   (coda in-order + blocking read), sentinel, release delle risorse, sha.
>   L'onestà del report dell'implementatore è reale, con la sola omissione
>   bin-kernel (F1).
> 🔧 **FIX APPLICATI (commit `a97f7bd0c`, verificati su disco da me):** banda
> → `0.00390625·|d|` (2⁻⁸ = 0.5 ulp fp16 per |y|≤8|d|, derivazione a
> commento) + dump della half `d` letta dal kernel (`raw_d_mismatch`);
> `CL_CHECK` su `clCreateImage` solo a oracolo acceso (normal-path
> ripristinato); `ORACLE=0/""/false` spengono (⚠️ HOST_REPACK e DUMP_Q
> restano presence-only, stesso trap, notato e NON toccato); `hostrepack=0|1`
> su ogni riga + WARNING se 0; `ORACLE_PATHINFO{gemm_bin_loaded=0|1}`;
> `skipped=name_gate` una volta per nome. Nuovo `libggml-opencl.so`
> sha `3f3df26af2375d3b…07530bac`, 7 685 072 B, mtime 19/08 11:13.
> ✅ **RE-REVIEW CHIUSA (stesso auditor, appendice nel report): F2/F3/F5/F6/
> F7/F8 FIXED, F1/F4 PARTIAL per ragioni note e accettate. Nessun difetto
> nuovo critico (17/17 e 9/9 format string riverificate). L'ORACOLO È
> DICHIARATO PRONTO AL DEVICE.** Residui, tutti bounded:
> - **F1:** il blob `_ila` resta strutturalmente non-oracolabile; disclosure
>   rumorosa OK. **Protocollo del run: verificare `gemm_bin_loaded=0`
>   nell'output; se =1 il verdetto GEMM non vale** (niente lo forza sul
>   device).
> - **F2 edge:** con `|d| ≲ 2⁻²⁰` (subnormali fp16 + FTZ da fast-math) il
>   GEMM-path può dare falsi positivi mal classificati. **Irraggiungibile
>   coi dati random di test-backend-ops (scale ~0.06-0.12)**; da ricordare
>   SOLO se un giorno si oracolano pesi reali sparsi.
> - **F4:** `"0 "` (spazio/newline in coda), `"off"`, `"no"` ancora ARMANO
>   la sonda — igiene operatore: settare esattamente `1` per accendere,
>   unset per spegnere.
> ➡️ **Prossimo passo: eseguire sull'S23 appena libero** —
> `GGML_OPENCL_HOST_REPACK=1 GGML_OPENCL_ORACLE=1 ./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID -p 'type_a=q4_0'`
> (push list nel REPORT dell'agente, senza il blob; sha on-device prima del
> run; esiti attesi: rosso = difetto trovato nell'idioma → passo 2
> dell'ordine; verde = idioma pulito nel program oracolo → passo 3, GEMV
> n=1 isolato.)
>
> 🟥 **PRIMA SESSIONE DEVICE (19/08, S23 libero): L'ORACOLO NON È MAI
> PARTITO — COMPILE FAIL, né verde né rosso.** Il wrapper GEMV usava `local`
> come nome di parametro: **parola riservata OpenCL C**, il compilatore
> Qualcomm E031.41.03.62 rifiuta (`err=-11`, "parameter name omitted") e
> `build_program_from_source` fa `exit(1)` prima di qualunque riga ORACLE.
> Igiene della sessione comunque perfetta: sha on-device tutti verificati
> (incluso `3f3df26a…`), env esatte, cpuset `/`, blob non pushato, due run
> byte-identiche, cleanup fatto, log conservati in
> `results/oracle_consumer_s23/run{1,2}/`.
> 📌 **Lezione a verbale: NESSUN compilatore aveva mai visto i wrapper**
> (niente smoke PC OpenCL), e né l'implementatore né l'auditor hanno
> fiutato la keyword — l'auditor citava perfino gli store "`local`-indexed"
> senza vederla. Un difetto da compilatore lo becca solo un compilatore:
> lo smoke di compilazione va nel giro PRIMA del device, quando esiste una
> piattaforma. Fix (rename + sweep di TUTTE le parole riservate nei
> wrapper) e seconda sessione device in corso (run3/run4).
>
> 🟢 **SECONDA SESSIONE DEVICE (19/08 ~12:30) — ORACOLO VERDE SU TUTTI E
> QUATTRO I PATH, CON L'END-TO-END CHE FALLISCE NELLO STESSO RUN.
> IL DEQUANT COMPILATO DA SORGENTE È PULITO SU INPUT NOTO-BUONO.**
> Fix abilitante: `local`→`n_loc` solo nei wrapper (unico identificatore
> riservato trovato dallo sweep), commit `95046b85c`; nuovo `.so`
> `085b127f…a29be4`, sha on-device identica. PC smoke: wrapper GEMV
> **CL_SUCCESS su Intel** (il gate che mancava); il program GEMM non è
> compilabile su PC (`float32` qcom nel consumer) — per il GEMM il device
> resta l'unico compile gate. Verificato da me sui log pullati
> (`results/oracle_consumer_s23/run{3,4}/`).
> - `ORACLE_SUMMARY{tensors=74, lines_bad=0/296, float_mismatch_total=0,
>   raw_mismatch_total=0, raw_d_mismatch_total=0, hostrepack=1,
>   gemm_bin_loaded=0, all_ok=1}` — run3 e run4 concordi; zero WARNING,
>   zero skip; incluso il tensore 2880×2880×32.
> - **Nello stesso run: 74/74 MUL_MAT_ID q4_0 FAIL, ERR medio 0.456/0.450**
>   (cluster host-repack ~0.45 confermato).
> ➡️ **Cosa significa:** gli idiomi dequant dei consumer (macro GEMM e
> helper GEMV), compilati da sorgente con le stesse opzioni, letti sia da
> buffer sia da image, producono float corretti da un buffer perfetto.
> **Il difetto vincolante sta OLTRE l'idioma dequant:** riduzioni
> subgroup, geometria/argomenti di dispatch, gestione degli `ids`
> (routing), path di scrittura di `dst` — oppure un miscompile specifico
> del program consumer reale (caveat epistemico a verbale: il program
> oracolo è un compilato diverso).
> 📉 **Effetto collaterale sul paradosso bitselect:** il read-path image
> dell'oracolo ha letto byte GIUSTI (`raw_mismatch=0` via image sullo
> stesso `cl_mem`): l'ipotesi "coerenza immagine/buffer" ne esce
> indebolita (nelle condizioni dell'oracolo, non identiche a quelle del
> consumer in-flight).
> ➡️ **SI PASSA AL PUNTO 3 DELL'ORDINE: isolare GEMV n=1 con host-repack.**
> Strumento scelto: **audit in-situ del kernel di produzione** — niente
> kernel nuovi (zero rischio compile): a valle del dispatch reale
> (n=1, q4_0, HOST_REPACK), readback di dst/A/ids, riferimento host in
> doppia precisione, e classificazione del PATTERN d'errore per-elemento
> (per riga, per subgroup, per esperto; got/want ≈ costante = bug di
> riduzione/scala; pattern a blocchi = lane; random = memoria). È la
> mappa d'errore fine che non abbiamo mai avuto.
>
> 🛠️ **STEP-3 IMPLEMENTATO (19/08 ~12:40, commit `2bdef5c7d`, verificato su
> disco da me): `GGML_OPENCL_GEMV_AUDIT`**, 564+/5− solo in
> `ggml-opencl.cpp`, zero `.cl` nuovi. Dispatch di produzione intatto;
> con l'env accesa: `clFinish` + readback dst/src1/ids, reference
> `dequantize_row_q4_0` + dot in double, bound d'errore alla Higham
> (`gamma_k`, u=2⁻²⁴, fattore 8× per scala di blocco + riduzione a 4
> subgroup, stampato in `GEMV_AUDIT_BOUND{}`), classificatori di pattern
> (ratio costante / `LANE_MOD_{32,64,128}` / routing / sign-smear ≥0x80 /
> unstructured), cap sul volume di log. Nuovo `.so`
> `a8f1e2354f…ce331fe2` (7 921 880 B). **Limite di attribuzione
> dichiarato:** i valori di glue (shape/offset/geometry) sono
> logged-not-verified — il probe testa il kernel dato quel glue, non
> dimostra il glue. ⚠️ Il commit rifattorizza il parsing env dell'ORACLE
> in un helper condiviso: semantica sotto audit. 🔎 Audit ostile in corso
> (stesso auditor); il device (sessione ERR breve) parte solo dopo il suo
> verde + S23 disponibile.
>
> 🔎 **AUDIT DI `2bdef5c7d` CONSEGNATO: 1 HIGH che avrebbe mandato
> l'indagine sul ramo sbagliato, preso in tempo.**
> - **HIGH (CONFIRMED): il classificatore SIGN_SMEAR era VACUO** — test
>   row-level "almeno un byte ≥0x80" che con nibble random scatta con
>   P≈1−2⁻¹²⁸: OGNI caso fallente sarebbe stato etichettato SIGN_SMEAR a
>   prescindere dalla causa. Fix: test per-elemento con enrichment contro
>   il base rate (~50%).
> - MEDIUM: i casi del filtro sono **14, non 12** (due grid-case n=1 in
>   più, ~113+66 MB di stash — informativi, si tengono); stash AoS senza
>   cap né rilevanza (150 MB stashati per tensori GEMM-only mai usati;
>   nessun OOM sul run prescritto, cap aggiunto comunque); semantica env
>   ereditata ("tutto ciò che non è 0/false/vuoto arma") — accettata per
>   coerenza con ORACLE, documentata.
> - LOW: LANE_MOD co-firing (64 fa scattare anche 32 → si riporta il
>   divisore più grande che spiega); REDUCTION_OR_SCALE a mediana cieca
>   sulle mappe miste (60% ok + 40% quartered ⇒ med=1.0) → cluster di
>   ratio con frazioni.
> - ✅ SOUND: glue same-variable (passa esattamente i locals del dispatch),
>   ids+guardie OOB, bound Higham corretto (~1000× sopra il drift f32
>   legittimo e ~1000× sotto l'errore classe-0.45), readback bloccanti con
>   skip puliti, inerzia a env spenta, refactor ORACLE bit-identico.
> 🔧 Fix in lavorazione; re-review del diff dei classificatori prima del
> device.
>
> 🟥 **RE-REVIEW DI `6c822d826`: NO-GO — il fix dei classificatori ha
> introdotto una regressione peggiore del difetto che curava.**
> - **LANE_MOD REGRESSED:** col "divisore più grande prima", QUALUNQUE
>   pattern periodico (32/64/128) passa il test mod-128 (i suoi residui
>   fully-bad a 128 danno comunque rmax=1.0/rmin=0) → tutto etichettato
>   `LANE_MOD_128`, periodo perso. Fix giusto: inferire il periodo dal
>   CONTEGGIO dei residui fully-bad al modulo più grande
>   (periodo = m/n_residui: 4→32, 2→64, 1→128).
> - **SIGN_SMEAR onesto-ma-cieco, confermato col calcolo:** attraverso un
>   dot di lunghezza k su dati iid l'appartenenza alle righe bad è una
>   selezione ~50% casuale ⇒ `rate_ge80 ≈ rate_lt80` e la soglia
>   0.80/0.20 sta a ~10σ: **l'etichetta non può scattare sul veicolo a
>   dati random nemmeno per un sign-smear vero.** Il gate resta (giusto
>   non indebolirlo); la cecità va dichiarata NEL log del run e nel
>   report: "assenza di SIGN_SMEAR su dati random non esclude nulla".
> - ✅ FIXED e SOUND: ratio clustering sui soli bad (il caso misto ora è
>   etichettato), stash cap (il run da 14 casi sta in ~186 MB < 512),
>   layer di osservazione (numeri grezzi, dump, entrambe le rate)
>   affidabile e degno di raccolta; 44/44 format string.
> 🔧 Fix (~20 righe: periodo dai residui + nota di reachability) in
> lavorazione; poi re-check finale e device.
>
> ✅ **FINAL CHECK DI `d77e82347`: GO CONDIZIONATO — SESSIONE DEVICE
> AUTORIZZATA E LANCIATA (19/08 pomeriggio).** Periodo inferito dai residui
> fully-bad: tracciati nel codice i 3 casi nominali + i 2 avversari (3
> residui non-divisore → bloccato; residui parziali → bloccato, cade su
> BLOCK_RUNS; m<512 conservativo; all-bad bloccato). `GEMV_AUDIT_NOTE`
> emessa una volta per processo nello stesso blocco del BOUND. Nessun
> collaterale nelle righe cancellate.
> ⚠️ **Residuo nuovo (accettato per la sessione 1, da fixare prima di una
> eventuale sessione 2): l'inferenza conta i residui ma ne ignora la
> SPAZIATURA** — una banda contigua di 32 righe darebbe `LANE_MOD_4`
> (co-fire con BLOCK_RUNS, scontabile), e l'unione di due classi mod-64
> sfalsate darebbe `LANE_MOD_32` senza tag contraddittorio. Fix noto:
> check di equidistribuzione (~10 righe).
> 📖 **Regole di lettura vincolanti per il referto:** `LANE_MOD_N` =
> "reticolo single-coset a periodo N", niente di più; con `BLOCK_RUNS`
> co-fired non fidarsi del modulo; assenza di `SIGN_SMEAR` sul veicolo
> random NON esclude nulla; il canale decisionale è `REDUCTION_OR_SCALE`
> (ratio_clusters) + i dump grezzi — i tag sono indizi, i numeri sono
> evidenza.
> 📱 Sessione lanciata con precondizione anti-contesa (S23 raggiungibile E
> idle: ps su test-backend-ops/bmoe/llama, altrimenti stop), sha on-device
> `acb41c32…`, run5/run6, 14 casi n=1 q4_0, HOST_REPACK=1 GEMV_AUDIT=1.
> 🛑 **SESSIONE ABORTITA SU PAROLA DELL'OWNER (S23 rioccupato dall'altra
> sessione)** — la parola dell'owner vince sul check `ps` dell'agente. Lo
> strumento resta pronto (sha `acb41c32…`, comando documentato): il run5/6
> parte alla prossima finestra S23.
> 📦 **MA run5 e run6 erano GIÀ COMPLETI prima dell'abort, log già sul PC**
> (`results/oracle_consumer_s23/run{5,6}/`). Sessione ERR: la contesa col
> workload dell'altra sessione non tocca la correttezza. Letti e verificati
> da me riga per riga.
>
> 🎯 **VERDETTO STEP-3 (19/08): IL KERNEL GEMV DI PRODUZIONE CALCOLA
> GIUSTO, DATI I SUOI ARGOMENTI. IL DIFETTO VINCOLANTE È NELLA GLUE HOST
> DEL PATH MoE (ids / colonna attivazioni / layout dst), NON NEI KERNEL.**
>
> Il fatto, per ognuno dei 12 casi n=1 q4_0, in ENTRAMBI i run:
> - `GEMV_AUDIT`: **n_bad=0**, max_abs ≤2.3e-6, ratio_med=1,
>   pattern=ok — il dst prodotto dal kernel coincide col riferimento
>   host in double calcolato da (ids letti dalla GPU, src1 letto dalla
>   GPU, pesi AoS stashati, offset/geometrie del dispatch reale).
> - Lo STESSO dispatch fallisce il check semantico del test:
>   **0/12, ERR 0.36-0.70** (media ~0.48, cluster storico).
> - Gate tutti verdi: `hostrepack=1`, NOTE e BOUND presenti, zero skip,
>   zero OOB negli ids.
> ➡️ **Deduzione stringente:** kernel e audit concordano; entrambi
> dissentono dal riferimento del test. Le uniche componenti CONDIVISE fra
> kernel e audit sono i valori di glue (ids in GPU, ne11/offset/geometrie)
> — il famoso `glue=logged_not_verified`, che da caveat diventa
> l'INDIZIATO. Il difetto sta in ciò che la glue carica/interpreta:
> contenuto o mapping degli `ids`, selezione della colonna di attivazione
> (i casi b=1 girano con ne11=1, i b=0 con ne11=n_used — entrambi
> falliscono), o layout/offset di `dst` — non nell'aritmetica compilata.
> 💡 **E spiega OGNI paradosso storico in un colpo:** perché nove
> riscritture del convert e ogni variante dei consumer non hanno mai
> portato l'ERR sotto soglia (il kernel non era il vincolo); perché un
> buffer byte-exact può andare PEGGIO di uno corrotto (con routing/layout
> sbagliati l'ERR è ~casuale nel cluster 0.4-0.7, non monotono nella
> correttezza del buffer — il paradosso bitselect); perché il denso è
> perfetto (glue diversa); e — DA VERIFICARE SUL CODICE — perché q8_0 e
> q6_K passano: ipotesi che prendano un path di dispatch MUL_MAT_ID
> diverso da quello SoA/Adreno dei quant stretti.
> ⚠️ Caveat onesto: resta possibile in linea di principio che gli ids in
> GPU siano GIUSTI e l'errore sia solo nel layout di dst, o viceversa —
> il prossimo strumento distingue esattamente questo.
> ➡️ **PROSSIMO STRUMENTO (glue-audit, solo host, niente kernel):**
> (a) stash degli `ids` a set_tensor (come i pesi AoS); (b) riferimento
> SEMANTICO calcolato dai tensori stashati secondo la semantica ggml di
> MUL_MAT_ID; (c) triplo confronto nello stesso run — dst vs ref-semantico
> (deve fallire come l'e2e), dst vs ref-da-argomenti (già ok), ids
> GPU vs ids stashati — e per il primo elemento divergente la MAPPA:
> esperto semantico vs usato, colonna semantica vs usata, offset dst
> semantico vs usato. Quella mappa È il bug, nome e cognome.
>
> 🛠️ **GLUE-AUDIT IMPLEMENTATO (19/08 ~13:41, commit `b0684a2b6`,
> verificato su disco):** stash I32 ids + F32 src1, reference semantica
> specchiata dallo stock `ggml_compute_forward_mul_mat_id` (ggml-cpu.c
> 1924-1933 / 1685-1703, citato), triple compare, righe `GLUE_AUDIT` /
> `GLUE_AUDIT_DIV` / `GLUE_AUDIT_IDS`. Nuovo `.so` `2ab3624c…6fcf62`.
> Review ostile in corso; device alla prossima finestra S23.
>
> 🧩 **RISPOSTA SUL PATH (sola lettura, da confermare in review) — E
> RIMODELLA L'IPOTESI:** q8_0 prende `kernel_mul_mv_id_q8_0_f32_flat`
> (stride-based, NON il gemv MoE) → il suo 75/75 non scagiona la glue
> MoE. **MA q6_K prende lo STESSO path packed-ids `gemv_moe` di q4_0**
> (con `use_adreno_moe_kernels`) e passa 3/3. ➡️ Se confermato, la parte
> CONDIVISA della glue (packing degli ids, layout dst) è probabilmente
> sana; **l'indiziato si restringe ai valori di glue SPECIFICI del
> quant** — stride/offset per-esperto nel buffer SoA q4_0, offset delle
> image. ⚠️ Tensione da sciogliere in review: se l'offset pesi fosse
> sbagliato, il reference args-consistent (verde 12/12) avrebbe dovuto
> vederlo — dipende da COME l'audit pesca i pesi (per expert-id o per
> byte-offset della glue); la review deve dire quali indiziati il verde
> ha GIÀ scagionato.
>
> ⚖️ **19/08 ~14:00 — REVIEW `b0684a2b6` (GO condizionato) + ATTACCO
> ESTERNO DI QWEN 3.8 MAX SULLA DEDUZIONE: la sintesi stringe il campo.**
> - ✅ Reference semantica FEDELE allo stock (righe ggml-cpu.c confermate);
>   ids/src1 stash sound; path claims CONFERMATI a file:line (q8_0 →
>   `mul_mv_id_q8_0_f32_flat` stride-based :21813-21875; q6_K → STESSO
>   `gemv_moe` packed-ids :22261).
> - 🧾 **Lista degli scagionati dal verde args-consistent** (reviewer, con
>   evidenza): byte SoA, **indirizzamento per-esperto dei pesi** (un bug
>   di offset quant-specifico sarebbe andato ROSSO: l'audit pesca per
>   expert-id dallo stash), idioma dequant, VALORI di ids/src1 come letti,
>   posizioni di scrittura dst, atomi di offset. ➡️ **L'ipotesi "valore di
>   glue quant-specifico" è CONTRADDETTA.** Il residuo è una mappatura
>   common-mode (dominio del ramo semantico) o fuori dal dispatch.
> - 🗡️ **Attacco Qwen (le ipotesi che sopravvivono a TUTTE le misure):**
>   (1) ids mai confrontati con l'INTENTO → coperto da `GLUE_AUDIT_IDS`;
>   (2) **CLOBBER/READBACK di dst fra lo snapshot dell'audit e la lettura
>   del test via get_tensor** → NON coperto → **aggiunto ora** (hook
>   `DST_READBACK{match}` + `OVERLAP_MAP`, in implementazione);
>   (3) copertura solo GEMV n=1 (i GEMM del set da 74 restano inauditi —
>   per dopo).
> - 📐 **Correzioni di ragionamento accettate:** in ERR una permutazione ≈
>   garbage (indistinguibili su dati random); **ERR 0.36-0.70 sta SOTTO il
>   tetto del completamente-sbagliato (~1-2) ⇒ corruzione PARZIALE** (una
>   frazione di righe giuste) — vincola il modello del bug: il misrouting
>   uniforme predice il tetto, non 0.5.
> - 📚 Prior art (Qwen, con fonti): la lib di kernel binari Adreno copre
>   MUL_MAT_ID **esattamente per Q4_0/Q4_1/Q4_K/MXFP4** (OPENCL.md
>   upstream) — esclusa nei NOSTRI run (`gemm_bin_loaded=0`, blob non
>   pushato), ma in produzione è nel path: da tenere per il capitolo fix.
>   Classi di bug storiche: ids i32 letti male/stride/view-offset; pattern
>   CUDA sort-by-expert + scatter (scatter dimenticato = dst permutato).
> - 🎯 **Matrice della prossima sessione S23 (tre risposte ortogonali da
>   UN run):** ramo IDS (GPU vs intento) · ramo SEMANTICO (mappatura
>   slot→colonna→dst) · ramo READBACK (clobber). Condizioni del GO:
>   grep `skipped=` prima di credere al ramo semantico; un triplo verde =
>   negativo forte per il backend ⇒ pivot su geometria harness/reference,
>   NON ri-caccia al kernel.
>
> 🟢🟢🟢 **19/08 ~14:30 — SESSIONE LAMPO (finestra corta concessa
> dall'owner): TRIPLO VERDE SU TUTTI E 12 I CASI, IN ENTRAMBI I RUN.
> IL DISPATCH DEL BACKEND PRODUCE L'OUTPUT SEMANTICAMENTE GIUSTO —
> E IL TEST LEGGE COMUNQUE SPAZZATURA.**
> (`results/oracle_consumer_s23/run{7,8}/`, binario revisionato
> `2ab3624c…` sha-verificato on-device, `skipped=0`, verificato da me
> anche su run8: 12/12 righe con semantic=0, args=0, divergent=0, ids=0,
> src1=0 — e 12/12 e2e FAIL, ERR 0.41-0.66.)
> ➡️ **Scagionato l'INTERO percorso di calcolo:** kernel compilati
> (oracolo), valori e mappatura della glue (ids=intento, colonne, offset
> dst, semantica stock ggml). Il danno avviene DOPO: o (A) **un secondo
> scrittore sovrascrive dst** dopo il nostro snapshot (doppio dispatch /
> fall-through a un altro kernel — e se esiste, spiegherebbe TUTTA la
> campagna in un colpo: l'ultimo autore sarebbe un kernel le cui varianti
> narrow sono rotte e la q6_K sana; le 9 riscritture del convert non
> potevano aiutare perché il gemv auditato non era mai l'autore finale),
> o (B) **il path di readback `get_tensor` restituisce byte diversi** da
> quelli che il buffer contiene.
> 🔎 In corso, PC-only: lettura del sorgente del dispatch (ogni enqueue
> che tocca il dst cl_mem, in ordine, file:riga — il sospetto (A) è
> verificabile SENZA device); se il sorgente è pulito, hook
> `DST_READBACK{raw_match, returned_match}` + logger degli enqueue
> post-snapshot (WIP in stash@{0}, da estendere). Il device servirà solo
> per il caso (B) o per confermare (A).
>
> ☠️ **(A) È MORTA SUL SORGENTE (19/08 ~14:25, walk completo con
> file:riga):** in `ggml_cl_mul_mat_id` (:20932) l'UNICO writer di dst è
> il singolo `clEnqueueNDRangeKernel` del gemv (:21085); il path generico
> (`mul_mv_id_q4_0_f32_8x_flat`, enqueue :22711) è IRRAGGIUNGIBILE per il
> `return` a :21224; il ramo GEMM è l'`else` di `ne12==1`; il graph
> compute è single-pass e la fusion non tocca MUL_MAT_ID; il harness è
> nodo-per-nodo (`graph_view(i,i+1)`) coi sentinel computati DOPO la
> lettura di `out`. Niente doppio dispatch, niente legacy writer — il
> "fit bello" non è quello che fa il codice. (Nota a margine: a gate
> Adreno OFF il `case` q6_K non ha `break` e cade in MXFP4 :22429 — bug
> REALE ma di un altro path, registrato.)
> 🧨 **19/08 ~15:00 — INTEL CROSS-TREE DALL'ALTRO CLAUDE (llama.rn 0.12.8,
> app kalsa) + VERIFICA SUL NOSTRO ALBERO: UPSTREAM CONOSCE LA NOSTRA
> CLASSE DI DIFETTO E L'HA SPENTA COL GATE INVECE DI FIXARLA.**
> - Nel loro albero vendorizzato, `use_adreno_moe_kernels` **esclude
>   A6X/A7X** (730/740/750 sono tutti A7X: passa solo A8X) e il commento
>   upstream dichiara il perché: *miscompile del compilatore* — i kernel
>   `*_trans4_ns` fanno aliasing di una `ushort8` privata via `uchar*` e
>   su alcuni A6x/A7x *corrompono i pesi*. "For now."
> - **Nel NOSTRO albero il gate è SOLO nome+shape** (:6960-6964,
>   `backend_ctx` GGML_UNUSED, niente esclusione di generazione): per
>   questo sul 740 i kernel MoE Adreno GIRANO — ed è per questo che
>   misuriamo la corruzione che upstream ha solo spento. Il convert che
>   chiamiamo è letteralmente `convert_block_q4_0_trans4_ns` (:8366):
>   **il commento upstream è l'ammissione della nostra classe di difetto
>   (A)**, quella che abbiamo fixato byte-wise per il −55%.
> - Conseguenze coordinate con l'app: (1) **NON rimuovere l'esclusione
>   A7X nel loro albero oggi** — sbloccherebbe sul 740/750 esattamente i
>   kernel che misuriamo corrotti: si scambierebbe "CPU corretta" con
>   "GPU spazzatura"; (2) lo sblocco della famiglia K su A7X (Q4_K_M
>   compreso) è il PREMIO della nostra campagna: passa per la chiusura
>   del difetto residuo, non per la rimozione del gate; (3) **mxfp4 MoE
>   "gira oggi su S23"** è vero solo nel LORO albero (ramo generale
>   flat) e resta da verificare in correttezza — nel NOSTRO albero mxfp4
>   prende il path Adreno e fallisce 0/74; l'unico quant MoE
>   general-branch MISURATO verde sul 740 è **q8_0 (75/75)**;
>   (4) "supportato ≠ veloce" ha già un numero: decode MoE su GPU
>   0.41-0.44× CPU (~60 ms/token di glue, graveyard) — la leva GPU è il
>   PREFILL; e per i modelli streammati (>RAM) gli esperti restano su
>   CPU per architettura (Q7), quindi il MUL_MAT_ID GPU serve ai modelli
>   con esperti residenti e ai disegni di prefill.
>
> 🏛️ **19/08 ~15:20 — SESSIONE READBACK (run9/run10): BRANCH C, 12/12.
> IL BACKEND GPU È TOTALMENTE ASSOLTO. L'INDIZIATO PRINCIPALE ORA È IL
> RIFERIMENTO CPU DEL TEST — CIOÈ IL GIUDICE, NON L'IMPUTATO.**
> (`results/oracle_consumer_s23/run{9,10}/`, sha on-device `25044c5a…`
> = commit `bcdbc9ed6`; 12/12 `raw_match=1, returned_match=1` con
> checksum snap==raw==returned identici, `get_off==snap_off`, zero
> `POST_ENQUEUE`, zero overlap; run9 e run10 concordi; e2e sempre 0/12.)
> ➡️ Catena di assoluzioni completa: aritmetica compilata (oracolo) →
> valori e semantica della glue (glue-audit, riferimento = stock ggml) →
> integrità memoria + readback (`DST_READBACK`). **Il harness riceve
> byte semanticamente corretti e dichiara ERR 0.4-0.7 ⇒ out2 (il
> riferimento CPU) è il principale sospettato.**
> 🧩 **E i pezzi combacerebbero tutti:** questo albero porta gli
> esperimenti CPU S3/REPACK/i8mm (`8d3c2ea75` è su QUESTO branch, sotto
> i commit oracle); `ggml-cpu.c` NON è upstream puro (verificato); i
> path CPU sono quant-specifici ⇒ compatibile col pattern q4_0/q4_1/
> q4_K/mxfp4 rotti e q8_0/q6_K sani; e il paradosso bitselect si
> rileggerebbe — se il riferimento è corrotto in modo affine al vecchio
> convert, un buffer corrotto uguale produce output più VICINO al
> giudice sbagliato: "due difetti che si compensano", col secondo nel
> GIUDICE. ⚠️ IPOTESI, non verdetto: da provare col forensic diff del
> lato CPU (in corso, gratis su PC — attenzione: il harness device gira
> su ARM, un check x86 non scagiona i path NEON/i8mm/repack) e con la
> sessione f1/f2 (dump di entrambi i buffer del confronto, attesa:
> f1(OpenCL)==semantico, f2(CPU)≠semantico).
> 📌 Nota di metodo per il verbale: se l'ipotesi regge, OGNI numero ERR
> di questa campagna era una distanza da un bersaglio sbagliato — il
> −55% incluso — e la narrativa dei "due difetti" va riscritta con
> l'imputato e il giudice scambiati. Non si riscrive niente finché il
> forensic non parla.
>
> 🗡️ **SECONDO ROUND QWEN (19/08 ~15:40) — la prova logica regge "modulo
> fedeltà dello specchio", e la banda d'errore ora è PREDETTA, non solo
> tollerata.**
> - **Logica confermata:** dst==specchio(sorgente) ∧ dst≠out2 ⇒ il
>   runtime CPU diverge dalla semantica del SUO stesso sorgente (path
>   ottimizzati vec_dot/repack o codegen) — *purché lo specchio sia
>   trascrizione fedele*. Residui vivi: fedeltà specchio (kill:
>   judge-swap), loop naïf esso stesso campaign-modified (il forensic
>   deve classificare ANCHE quello), mutazione input T0→T1 (kill:
>   checksum), bug di codegen i8mm/NEON (invisibile al diff — serve A/B
>   del path).
> - ☠️ **A3 (convenzione righe di coda): morta sui dati esistenti** —
>   i casi n_used=1 non hanno code e falliscono a 0.36-0.66.
> - 💪 **Vincolo del denso, rafforzato:** q4_0 denso 46/46 INCLUSE le
>   forme GEMV n=1, stesso vec_dot via mul_mat ⇒ se il giudice è rotto,
>   è rotto nel codice SPECIFICO di mul_mat_id (gather per-esperto /
>   applicazione repack / chunking — esattamente le regioni
>   campaign-modified 1685-1703/1924-1933).
> - 📐 **Banda 0.36-0.70 PREDETTA dall'ipotesi giudice-repack:**
>   permutazione di partner dentro blocchi che condividono una scala
>   (magnitudini plausibili, NMSE intermedio) oppure miscela
>   condizionata dall'allineamento (~15-50% righe colpite). Il
>   misrouting grossolano predice il tetto ~1-2: le ipotesi kernel morte
>   restano morte anche per la banda.
> - 🎯 **Discriminatori (ranking Qwen, adottato):** (1) mappa per-riga
>   f2-vs-specchio [dentro la sessione f1/f2]; (2) **JUDGE-SWAP — build
>   con `ggml/src/ggml-cpu` riportato al merge-base upstream, stesso
>   OpenCL nostro: se 12/12 PASS, caso chiuso e specchio validato
>   insieme** [build in preparazione]; (3) checksum invarianza input;
>   (4) round-trip repack host-only; (5) niente switch runtime standard
>   per spegnere repack/i8mm — l'A/B è una rebuild con le flag off.
> - 🧪 Predizione testabile registrata: i residui (GPU-esatto − out2) e
>   (GPU-corrotto − out2) dovrebbero essere CORRELATI se i due difetti
>   si compensano via lo stesso layout.
>
> ⚡ **19/08 ~16:00 — JUDGE-SWAP ESEGUITO: 0/12 FAIL ANCHE COL GIUDICE
> PRISTINE. L'IPOTESI "GIUDICE CPU CORROTTO DALLA CAMPAGNA" È
> CONFUTATA.** (runJS1, ERR 0.31-0.61 — STESSA banda del giudice di
> campagna: i due giudici CONCORDANO fra loro; runJS_ctrl sotto giudice
> pristine: q8_0 74 OK, q6_K OK, denso q4_0 45 OK / 0 FAIL.)
> 🔥 **Il confronto che brucia ogni teoria di mapping:** q6_K
> `(n_mats=4, n_used=2, b=0, m=512, n=1, k=256)` **OK** contro q4_0
> **stessa identica forma** **FAIL** — glue condivisa, giudici
> condivisi, shape identica: **il discriminante è il QUANT e solo il
> quant.**
> ✅ Verificato da me ora: `ggml-quants.c/.h` INTOCCATI dal merge-base
> upstream (`22b69b6e9`) — `dequantize_row_q4_0` dello specchio è stock.
> 🧷 E il denso q4_0 46/46 prova che i giudici ≈ dequant stock SUGLI
> STESSI byte q4_0 (via mul_mat). Quindi lo stato logico è: specchio
> (dequant stock, byte stashati) == GPU ≠ giudici (valutazione q4_0
> corretta di byte "visti da loro") ⇒ **le ipotesi rimaste in piedi si
> contano su due dita:** (1) **i BYTE visti dai giudici ≠ i byte
> stashati** — divergenza degli input fra le due valutazioni backend
> (variante dell'A4 di Qwen: mutazione/rigenerazione fra eval GPU ed
> eval CPU, o gestione delle VIEW), quant-specifica per come il test
> costruisce i tensori; (2) il loop naïf di QUESTO albero è
> campaign-modified e lo specchio è fedele-al-sorgente-sbagliato
> (forensic in corso — ma deve spiegare perché q6_K passa con la stessa
> semantica). 📌 La banda 0.31-0.70 è compatibile con "esperti in
> parziale overlap": con ids diversi fra le due eval, la frazione di
> righe coincidenti produce esattamente NMSE sub-tetto.
> ➡️ **La Sessione B decide: f1/f2 per-riga contro lo specchio +
> checksum INPUT_INVARIANT (T0 vs T1).** Se gli input visti dal giudice
> differissero da quelli stashati, il "difetto" starebbe nel PROTOCOLLO
> del test, non in nessun kernel di nessuno.
>
> 🚪 **19/08 ~16:20 — LA PORTA, TROVATA A LIVELLO DI SORGENTE (verificata
> da me su ggml-backend.cpp:2156-2209 e graph_copy_init_tensor:2041-2055):
> IL GIUDICE RICEVE I PESI ATTRAVERSO IL `get_tensor` DELLA GPU.**
> `compare_graph_backend` costruisce il grafo del backend2 con
> `graph_copy` → `ggml_backend_tensor_copy(src, dst)` dove src sta sul
> backend1 (OpenCL): **i pesi q4_0 MoE del giudice sono il ROUND-TRIP
> write(SoA)→read(reverse) dello storage GPU.** Ipotesi ora in verifica
> byte-level: il reverse (get_tensor) del path MoE SoA q4_0 è ROTTO
> (quello q6_K sano). Spiegherebbe TUTTO:
> - judge-swap confutato: qualunque giudice mangia la stessa copia
>   avvelenata;
> - discriminante puro-quant a parità di forma (reverse per-quant);
> - denso immune (storage/reverse diverso, 46/46);
> - **paradosso bitselect sciolto**: convert-write e get_tensor-read sono
>   inversi dello STESSO storage — bug accoppiati (scrivi storto + leggi
>   storto uguale) si annullano in round-trip → giudice sano → ERR 0.18;
>   fixata la sola scrittura → la lettura rotta avvelena il giudice →
>   0.45. **"Due difetti che si compensano" = write e read dello stesso
>   storage.** Il −55% andrà riletto in questa chiave.
> - **la produzione non è mai passata di lì**: l'inferenza reale non
>   chiama `get_tensor` sui pesi — il path è esercitato SOLO dal
>   protocollo del test.
> 🔬 In corso: (1) round-trip byte test su device (set_tensor X →
> get_tensor → memcmp, q4_0 MoE vs q6_K vs denso, con e senza
> HOST_REPACK — sotto ipotesi, il write corretto DEVE mismatchare al
> read); (2) audit PC del reverse (transpose_2d/un-repack) contro il
> contratto, file:riga. Fix solo dopo conferma + review ostile.
>
> ⚔️ **QWEN ROUND 3 (19/08 ~16:40) — LA VARIANTE IDS È MORTA PER
> ARITMETICA, E C'È UN MECCANISMO CONCORRENTE CON PRIOR ART UPSTREAM.**
> - ☠️ **H1-via-ids esclusa quantitativamente:** con n_used=1 gli id
>   valgono tutti 0 per costruzione (non POSSONO differire); e per
>   n_used>1 id indipendenti danno NMSE ≥ 1.0 (righe sbagliate
>   scorrelate) — la banda osservata 0.31-0.61 sta SOTTO il pavimento
>   del fully-wrong. ☠️ H2 (specchio infedele) morta via q6_K
>   (mapping quant-agnostico).
> - ✅ Sopravvive solo: **divergenza nei BYTE DEI PESI visti dall'eval
>   CPU**, con NMSE ≈ f·(1..2) ⇒ f ≈ 16-61% di elementi corrotti in modo
>   STRUTTURATO (pattern block-periodico atteso; ERR shape-deterministico
>   atteso).
> - 🥊 **Meccanismo di Qwen (concorrente col nostro get_tensor):** il
>   REPACK ONLINE ARM del giudice CPU (dotprod/i8mm extra bufts) corrotto
>   o mis-sized per MUL_MAT_ID: copre Q4_0/IQ4_NL/Q4_K(+mxfp4?) = set
>   fallente, NON copre Q6_K/Q8_0 = controlli sani; il denso passa
>   (sizing corretto per mul_mat, storicamente rotto per mul_mat_id:
>   PR #12544, commit #14292, classe #10165). E la stoccata: *"il
>   judge-swap non ha confutato la colpa dell'input — ha scagionato il
>   codice di campagna e incriminato ggml pristine"* (il revert al
>   merge-base riporta lo STESSO stato repack upstream). ⚠️ Caveat suo:
>   `tensor_get` su buffer repackato può ri-trasformare in lettura —
>   un confronto via readback può MASCHERARE la divergenza.
> - 🧪 **Discriminatori ordinati (in esecuzione):** (1) git: i fix
>   #12544/#14292 sono nel merge-base 2026? (attesi sì ⇒ serve una
>   regressione più recente della stessa classe); (2) audit copertura
>   tipi del repack ARM vs set fallente — q4_1/q5_0/q5_1/q5_K con ERR
>   piccoli (0.09-0.12) potrebbero essere un SECONDO strato di difetto;
>   (3) **norepack judge-swap** (giudice ricompilato senza extra-bufts
>   ARM): 12/12 PASS ⇒ meccanismo Qwen confermato; ancora FAIL ⇒ resta
>   il nostro get_tensor, che il round-trip byte test decide.
> 📌 Nota di coerenza con la campagna: il motore BMoE carica con
> `use_extra_bufts=false` e "K-E (i8mm) never runs — mmla vive solo nel
> path REPACK che gli esperti streammati bypassano" ⇒ **la produzione
> bypassa il repack che il test invece esercita** — coerente con "solo
> il tribunale era truccato", qualunque dei due meccanismi vinca.
>
> 💥 **19/08 ~17:00 — ROUND-TRIP BYTE TEST: DIRTY. IL SECONDO DIFETTO HA
> NOME, FILE E RIGA: `kernel_restore_block_q4_0_trans4_ns` (cvt.cl:352-392),
> IL REVERSE DEL get_tensor, MISCOMPILATO CON LO STESSO IDIOMA CHE IL
> CONVERT FU PATCHATO PER EVITARE.**
> (Log: `results/oracle_consumer_s23/roundtrip/`; harness dedicato,
> OpenCL invariato `25044c5a…`.)
> | caso | A (convert GPU) | B (HOST_REPACK=1) |
> |---|---|---|
> | q4_0 MoE "as" 256×512×4 | **94208/294912** | **61440/294912** |
> | q6_K MoE "as" | 0/430080 | 0/430080 |
> | q4_0 denso "weight" | 0/73728 | 0/73728 |
> Firma al 100% dei mismatch: **byte `qs` DISPARI, `got=(want&0x0F)|0xF0`**
> (nibble alta forzata a 0xF, bassa intatta; `d` e byte pari sempre
> match). Il restore legge `uint4`→`as_ushort8`→`uchar*` su registro
> privato — **esattamente l'idioma che il commento del convert
> (cvt.cl:330-333) dichiara miscompilato su Adreno**; il restore q6_K usa
> un idioma diverso (`uchar*` su ARRAY) e round-trippa pulito; il denso
> non entra nel path trans4_ns. **La predizione dell'ipotesi era "(b)
> DEVE mismatchare": confermata. Il write corretto (host-repack) torna
> indietro corrotto.** Nota numerica: B = 7680/16384 = 46.9% dei blocchi
> per offset — la stessa cifra del "46% dei word alti" storico.
> ➡️ **Il "difetto residuo dei consumer" era il RESTORE del get_tensor:
> un path che solo il protocollo del test esercita.** La catena del
> veleno è verificata a livello di sorgente: compare_graph_backend →
> graph_copy → tensor_copy(src=OpenCL) → get_tensor → restore rotto →
> giudice avvelenato (qualunque giudice: per questo il judge-swap
> "falliva").
> 🧷 Qwen round 3, esiti delle sue piste: i fix #12544/#14292 SONO
> antenati del merge-base (versione semplice della sua ipotesi: morta);
> la sua mappa di copertura repack era sbagliata su q6_K/q8_0 (SONO
> coperti eppure passano) e q4_1/q5_0/q5_1 NON sono coperti eppure
> falliscono ⇒ il meccanismo repack-CPU non spiega il pattern; quello
> get_tensor sì. ⚠️ q4_1/q5_0/q5_1/q4_K/q5_K: da verificare i loro
> restore kernel (stesso idioma?) — ERR piccoli su q5_0/q5_1 (0.09-0.11)
> possibile strato separato.
> 🔎 **AUDIT FORENSE INDIPENDENTE LANCIATO su richiesta di gualt** (agente
> fresco, zero fiducia nei report, claim-vs-artefatti su TUTTA la catena:
> roundtrip, JS build purity, circolarità degli strumenti, sha, filtri,
> env; report in `scratchpad/agents/evidence-audit/`). **Nessun fix parte
> prima del suo verdetto + review ostile del fix stesso.**
>
> ✅✅ **19/08 ~17:30 — VERDETTO FORENSE: TUTTA LA CATENA CONFERMATA
> SUGLI ARTEFATTI.** (report: `scratchpad/agents/evidence-audit/REPORT.md`)
> C1 roundtrip CONFIRMED (X = pattern deterministico host `(i*131+17)&0xFF`,
> confronto contro l'originale, TUTTA l'aritmetica riderivata: 16384×18,
> 8×11776, 8×7680, 46.9%, firma MISURATA dal classificatore non asserita);
> C2 sorgente colpevole CONFIRMED (idioma letterale a cvt.cl:352-392,
> commento a :330-333, dispatch nel get_tensor a ggml-opencl.cpp:9914,
> rotta test→giudice verificata end-to-end); C3 judge-swap CONFIRMED
> (worktree con ggml-cpu.c byte-identico al merge-base: 0 righe di diff
> contro le 937 del branch); C4-C6 CONFIRMED (stash da set_tensor host,
> dequant stock, 3 checksum da 3 letture distinte, interleaving nei
> medesimi log). **Zero numeri allucinati.**
> 🔧 Correzioni minori a verbale: la prosa "zero POST_ENQUEUE" nel blocco
> Branch C è SBAGLIATA — il contatore arriva a 11 (sono gli OVERLAP a
> essere zero; il campo per-case n_post_enq=0 vale per il case 1);
> `SHA256.txt` del roundtrip ha una riga exe incoerente (538ae4ed vs
> 306af176 su disco) — la lib OpenCL è coerente ovunque; run5-8 senza
> file sha su disco (fanno fede le righe on-device nei log).
> ⚠️ **I due buchi residui dichiarati dall'audit, che il retrial DEVE
> chiudere:** (1) l'anello finale — "il giudice riceve ESATTAMENTE i
> byte avvelenati e da lì esce ERR 0.31-0.73" — è inferito, mai
> osservato DENTRO un confronto fallente: serve la sessione f1/f2 che
> dumpa entrambi i buffer + i pesi consumati dal giudice e RIDERIVA
> l'ERR; (2) "la produzione non è toccata" è da lettura del codice, mai
> dimostrato sul motore BMoE reale. (3) Nota fresca: A≠B nei conteggi
> roundtrip (94208 vs 61440 a X costante) ⇒ lo storage del convert GPU
> byte-wise ≠ storage host-repack — coerente col fatto NOTO che il
> byte-wise viola il contratto (DUMP_Q storico), ma da spiegare
> esplicitamente nel piano fix.
> ➡️ **VIA LIBERA AL FIX** (piano in redazione dal takeover codex, poi
> review ostile, poi S23: roundtrip=0 → 12/12 → bitselect → set completo
> + f1/f2 probatorio).
>
> 🗡️ **QWEN ROUND 4 (19/08 sera) — EMENDAMENTI AL PIANO FIX, da
> incorporare nell'ordine di implementazione:**
> - **`uint4 q_block[1]` BOCCIATO**: "la peggior forma di array
>   possibile" — materiale canonico da SROA, il compilatore la promuove a
>   registro e l'IR torna la forma che miscompila. Scommesse ranked:
>   (1) **shift/mask puro senza aliasing** (`(v.sN>>8*k)&0xFF` +
>   riassemblaggio aritmetico — l'idioma dei dequant già puliti);
>   (2) clone del **`uint4[8]`** provato-sano; `[1]` solo come CANDIDATO
>   nel bake-off, mai come assunzione. Niente `as_ushort8` in nessun
>   ruolo residuo.
> - **Buchi da chiudere PRIMA del device:** (1) il PREDICATO di gating
>   (cosa instrada un tensore nel path avvelenato) va DIMOSTRATO con
>   una riga di logging, non inferito; (2) mismatch ≠ poisoning (il
>   danno è invisibile dove la nibble alta era già 0xF): la derivazione
>   dell'ERR usa il modello di poisoning, non il conteggio; (3)
>   **NMSE atteso in forma chiusa** dalla firma (metà pesi forzati a
>   7·d, strutturato) deve cadere in 0.36-0.70 — se non ci cade, c'è un
>   secondo contributore; (4) **stato intermedio predetto**: restore
>   fixato + producer byte-wise attuale TOGLIE la compensazione ⇒ l'e2e
>   può PEGGIORARE prima del bitselect — va predetto numericamente in
>   anticipo perché si legga come conferma, non regressione; (5) firma
>   per-tipo da verificare su q5_x (interplay qh), non estrapolare.
> - **f1/f2 probatorio: PRE-REGISTRATO** (calibrazione a due punti:
>   byte avvelenati→ERR predetto, byte puliti→PASS; giudice pristine
>   per evitare circolarità di harness).
> - **Prova di produzione**: enqueue shim (log dei kernel-name in una
>   sessione del motore reale: i 5 restore NON devono mai apparire con
>   `use_extra_bufts=false`) + log del buft che riceve i pesi MoE +
>   A/B dei logits patched/unpatched su prompt fisso (delta ⇒ falsifica
>   "produzione immune").
> - **Matrice riordinata**: zero-device prima (forma chiusa + predicato);
>   sweep firme per-tipo su build NON patchata; bake-off delle forme di
>   patch sul device; stato intermedio confermatorio; controlli negativi
>   di buft; q4_K/q6_K roundtrip=0 come regressione; **il −55% si
>   rimisura nella STESSA sessione del confronto fix o si cancella il
>   claim** ("finché non rimisurato" senza scadenza diventa permanente);
>   **il round-trip byte test diventa regressione permanente** per ogni
>   restore di ogni quant — questa classe di bug è sopravvissuta perché
>   nessun test esisteva a livello di byte.
>
> ✅ **REVIEW DEL PIANO FIX: GO CON 3 EMENDAMENTI (19/08 sera).** Mappa
> del blast radius CONFERMATA citazione per citazione ("load-bearing and
> it holds"); loop del fix = inverso esatto (hand-trace k=3 e k=19);
> bitselect CONFERMATO (formule = byte esatti del producer, builtin
> definito su questo vintage CL3.0/Adreno). Emendamenti: (i) **NO
> `uint4[1]`** — stessa bocciatura di Qwen, convergenza indipendente:
> forma no-alias byte-wise o ≥[2]; (ii) aggiungere alla matrice il
> probatorio out1/out2 e lo smoke BMoE (o deferral esplicito);
> (iii) "94208 atteso" declassato a "≈94208, da rimisurare" (era
> misurato col restore ROTTO). Nota: l'auditor non trova la memoria
> `adreno-moe-two-defects` nei SUOI store pi — corretta: vive nello
> store Claude dell'orchestratore, già riscritta oggi.
> 🛠️ **ORDINE DI IMPLEMENTAZIONE EMESSO** (replacement coder
> qwen3.7-max, agente `13f74d68`): fusione piano + emendamenti dei due
> reviewer — forma PRIMARIA shift/mask puro senza aliasing sui 5
> restore; bitselect producer come variante env-selezionabile
> (`GGML_OPENCL_CVT_VARIANT=bitselect`, default invariato); harness
> roundtrip esteso a tutti e 5 i tipi + controlli con firma per-tipo;
> logging del predicato di gating; sezione RETRIAL PRE-REGISTRATION
> (NMSE in forma chiusa dal modello di poisoning, stato intermedio
> predetto, f1/f2 pre-registrato a due punti su giudice pristine,
> deferral esplicito dello smoke BMoE). Poi: verifica su disco → review
> ostile del diff → S23.
>
> ✅ **19/08 ~00:00 (notte) — IL FIX È IMPLEMENTATO E COMMITTATO (PC-only,
> build verde).** Odissea provider prima del via: qwen3.7-max fermo in
> lettura (zero scritture), quota FREE di `qwen-model-studio-sg` esaurita
> (morti in blocco kimi/Talk/qwen3.7/V4 Pro), 402 grok; implementato da
> **Codex gpt-5.6-sol** (fuori lista profili — errore di processo a
> verbale, vedi memoria `profile-list-is-law`: mai più senza chiedere).
> Due commit locali su `kalsa/kernel-s3-repack`, MAI push:
> `5cc6f2bd5` (harness roundtrip ereditato dalla sessione device, commit
> separato per attribuzione) → `eaec5d884` (fix: 3 file, +260/−147).
> Contenuto verificato SU DISCO dall'orchestratore: (1) i 5 restore
> `*_trans4_ns` (cvt.cl:372/565/772/1000/1602) riscritti shift/mask puro
> — grep di `as_ushort8`/cast/array nei corpi: ZERO match; i 6 cast
> `(uchar*)` residui stanno TUTTI nei K-quant (idioma sicuro su array,
> controlli non toccati, come da ordine); (2) producer bitselect a
> build-time del programma CL (`-DGGML_OPENCL_CVT_BITSELECT`), env
> `GGML_OPENCL_CVT_VARIANT` VALUE-parsed, default bytewise invariato
> (ggml-opencl.cpp:1646); (3) log `OPENCL_WEIGHT_PATH{...}` sul path
> davvero preso (ggml-opencl.cpp:6982); (4) harness esteso 5 tipi +
> K-quant + 2 densi, firma per-tipo con qh separato per i q5
> (test-opencl-moe-roundtrip.cpp:49); (5) RETRIAL PRE-REGISTRATION nel
> REPORT oracle-consumer (~riga 1219). **Primo dividendo della forma
> chiusa: NMSE atteso 0.4505813953, DENTRO la banda osservata 0.36-0.70
> (emendamento Qwen #3 soddisfatto), e 65536 eventi di poisoning − 4096
> invisibili (nibble alta già 0xF) = 61440 = esattamente il conteggio
> misurato sul device (61440/294912).** Build: target `ggml-opencl` +
> `test-backend-ops` + `test-opencl-moe-roundtrip` verdi; syntax-check
> NDK clang CL3.0 verde in ENTRAMBE le varianti (il gate anti-`local`);
> LF-only confermato byte-level. `.so`:
> `9198f38779db531c92818a9d7b23ba0d471df1d95aba1498b61c9cbf1d07f43c`
> (da riverificare on-device via sha, mai via strings). Fuori scope
> dichiarato: `test-chat.cpp` non compila per `mtmd.h` mancante nella
> config cache-ata (pre-esistente, non nostro). stash@{0} intatto
> (INPUT_INVARIANT hook + test semantico PC, ispezionato read-only).
> 🔎 **Review ostile del diff IN CORSO** (profilo Reviewer Math,
> deepseek-v4-flash: attacco su inversi aritmetici dei 5 contratti,
> bitselect bit-exact, idiomi vietati post-inline, classificatore
> harness, parsing env, ri-derivazione indipendente della NMSE).
> GO/NO-GO della review = gate per chiedere l'S23.
>
> ✅ **REVIEW OSTILE DEL DIFF: GO (19/08 notte, Reviewer Math, report 19KB
> in `scratchpad/agents/restore-fix-review/REPORT.md`).** Tutti e 7 gli
> attacchi CONFERMATI a favore: (1) inversi dei 5 restore corretti
> byte-per-byte (prova per sostituzione + simulazione 500k blocchi a
> letteralità di contratto: 0 fail; qh 200k round-trip: 0 fail; mxfp4 usa
> `e:uchar` correttamente); (2) bitselect bit-exact (256×256 esaustivo,
> 0 mismatch; env value-parsed con stringhe esatte, unknown→warn+default;
> un programma per processo, no riuso stantio); (3) zero idiomi vietati
> nei 5 restore e negli helper; (4) harness: layout = ggml-common.h,
> regioni qs/qh disgiunte (una corruzione qs non è mai contata come qh),
> firma `odd_qs_hi_to_f` esatta, no false-PASS; (5) host pulito, env
> one-shot, fuori dai hot loop; (6) NMSE ri-derivata indipendentemente
> (E[q²]=21.5, E[δ²|poison]=77.5 → 1240/2752 = 0.4505813953 ✓, conteggi ✓);
> (7) superficie di regressione minima (3 file esatti). **Trovati e a
> verbale (non bloccanti):** GAP — solo q4_0 logga tutti e 3 i path, gli
> altri 7 tipi loggano solo il ramo trans4-moe; NOTA ONESTA — i restore
> K-quant/q6_K INTOCCATI portano la stessa classe di aliasing: se l'S23
> miscompila anche quelli, le 3 righe di controllo escono sporche (rc≠0,
> riportato correttamente) e vanno documentate come evidenza di
> superficie intoccata, NON piegate nel claim di questo commit; la banda
> 0.36-0.70 ha potere discriminante debole (pre-registrato). **Prescrizioni
> device della review:** bytewise e bitselect in DUE processi separati con
> CVT_VARIANT registrato; log dei path attivo e verifica delle etichette
> (8 trans4-moe + noshuffle + generic); i 5 tipi fixati devono uscire
> `class=clean`; niente claim "produzione immune" senza lo smoke
> pre-registrato (enqueue shim + A/B logits). ➡️ **PROSSIMO PASSO: sessione
> S23** (in carica OK, è una sessione ERR) — matrice della RETRIAL
> PRE-REGISTRATION, sha del binario on-device prima di ogni run.
>
> 🏆 **19/08 NOTTE — RETRIAL S23 ESEGUITO: IL FIX È VERIFICATO SUL DEVICE.
> I 5 TIPI MoE COLPITI PASSANO DA FAIL A PASS.** (GLM 5.2, commit
> artefatti `890a775`: `scratchpad/agents/retrial-s23/REPORT.md` +
> MANIFEST + 22 log + entrambi i .so per provenienza; verificato su disco
> dall'orchestratore.) Verdetti per cella: **(0)** sha PC==device,
> Adreno 740, dir storiche intatte → PASS. **(1) Baseline non patchata:**
> firme per-tipo riprodotte (94.208 sporchi sui 5 colpiti, qh dei q5
> PULITO misurato indipendentemente — la firma NON era estrapolata),
> e2e q4_0 FAIL riprodotto → PASS. **(2a)** patched+HOST_REPACK: q4_0
> roundtrip **0 mismatch** (il restore fixato è byte-esatto sotto storage
> contract-conforme); ANOMALIA a verbale: HOST_REPACK repackava SOLO
> q4_0 (gli altri 4 giravano col producer bytewise). **(2b) Stato
> intermedio:** 65.536 sporchi da violazione di contratto del producer
> bytewise (il "≈94.208 da rimisurare" si rimisura in 65.536 = 131.072
> candidati odd-qs × 1/2; il falsificatore pre-registrato era uno ZERO,
> non scattato) → PASS. **(3) Predicato di gating DIMOSTRATO:** 8×
> trans4-moe, denso 256→generic-soa, denso 512→noshuffle. **(4) E2E:**
> q4_0 74/74, q4_1 75/75, q5_0 3/3, q5_1 3/3, mxfp4 74/74 — TUTTI
> FAIL→PASS; regressioni invariate: q8_0 75/75, q6_K 3/3, denso 915/925
> (i 10 FAIL sono i soliti q6_K flat); q4_K/q5_K MUL_MAT_ID FAIL
> pre-esistente (compute K2, confermato anche su unpatched, NON di questo
> commit). **(5a) PREDIZIONE FALSIFICATA (unica):** bitselect roundtrip
> ≠ 0 — 65.536 sporchi IDENTICI al bytewise: il device miscompila
> entrambe le forme allo stesso modo, o il difetto del convert è
> strutturale, non nella forma dell'helper. Thread STOPPATO come da
> disciplina, zero improvvisazioni, analisi off-device dovuta. Il fix del
> restore NON è implicato (2a lo prova). **(5b)** bitselect e2e 74/74
> PASS (coerenza). **(6) f1/f2 A DUE PUNTI CHIUSO — l'ultimo anello
> inferito è ora PROVATO:** byte consumati dal giudice→ERR ~0.43
> riderivato (in banda, vicino a 0.45058); byte puliti→PASS; il restore è
> il contributore UNICO; NMSE offline combacia 12/12. **(7) Il −55% è
> ri-ancorato in-sessione:** 61.440 riprodotto (== modello 65.536−4.096);
> il difetto vincolante era il RESTORE; il fix completo vale −100%
> (FAIL→PASS); il −55% storico va etichettato come delta parziale
> intermedio a restore ancora rotto. **Restano aperti:** analisi
> off-device del puzzle bitselect/producer-violation (perché l'e2e passa
> con roundtrip producer-violato: auto-consistenza producer↔consumer da
> caratterizzare); smoke di produzione BMoE (enqueue shim + A/B logits)
> PRIMA di ogni claim "produzione immune"; MAX RECALL finale sul diff
> cumulativo; decisione di pubblicazione (owner, dopo questi).
>
> 🔬 **19/08 NOTTE — MAX RECALL ESEGUITO (3 reviewer paralleli su angoli
> diversi) + IL PUZZLE È RISOLTO: C'È UN TERZO DIFETTO, E RESTA APERTO.**
> Report: `scratchpad/agents/maxrecall-{tracer,claims,puzzle}/REPORT.md`.
> **(1) Claims-vs-artefatti (mimo, voto B):** hash, manifest 22/22,
> TUTTI i conteggi roundtrip/e2e/firme verificati riga-per-riga nei log.
> DUE errori aritmetici nel report del retrial, ARBITRATI
> dall'orchestratore sul log grezzo (`cell6_armA_*_dump.log`): **media
> ERR cella 6 = 0.4158 (non 0.4325)** e **4/12 sotto 0.36 (non 2/12)** —
> la calibrazione f1/f2 è più lasca del dichiarato ma il verdetto
> qualitativo regge (restore contributore unico confermato).
> **(2) Tracer cross-file (GLM): purezza del default TIENE** (a env
> spenti: solo convert byte-wise + restore shift/mask); trovata
> l'ASIMMETRIA §3C: il rewrite shift-then-mask del consumer fu applicato
> solo a gemv/gemm_moe_q4_0, i consumer q4_1/q5_0/q5_1/q4_K tengono
> l'idioma originale — severità DECLASSATA dall'evidenza (il puzzle prova
> che quei consumer NON sono miscompilati: 156 casi affetti passati, una
> deviazione inietterebbe ~0.45 NMSE ≈ 900× soglia); resta debito di
> uniformità (port meccanico dei 6 macro). Minori: getenv non cache-ato
> in audit_q4_0; riga di log variant= incondizionata; `register_dst_snap`
> senza clRetainMemObject (solo path audit). **(3) Puzzle (v4-flash,
> simulazione byte-esatta sim1-3.py): MECCANISMO IDENTIFICATO — DUE
> difetti device distinti che forzano la nibble alta dei byte qs dispari
> a 0xF:** **P (convert, WRITE)** scatta su want<0x80 (bit7 basso) e
> colpisce ENTRAMBE le forme del producer (bytewise E bitselect) →
> 65.536 visibili col restore fixato, 0 invisibili; **R (vecchio
> restore, READ)** scattava block-even value-independent → 65.536 eventi,
> 4.096 invisibili = 61.440. **P∪R = 94.208 ✓, tutti e 4 i numeri
> misurati riprodotti esattamente.** Il rapporto 1/2 è una proprietà del
> pattern LCG dell'harness (`p[i]=(i·131+17)&0xFF`, biiezione
> periodo-256), non una probabilità del kernel. ⚠️ **CONSEGUENZA: l'e2e
> PASS = auto-consistenza giudice/GPU sugli STESSI pesi sporchi, NON
> fedeltà ai pesi originali. RISCHIO LATENTE PESI-SBAGLIATI: SÌ
> (condizionale)** — qualunque load path che accende il convert device
> su A740 (gate name+shape: `ffn+exps`/`as`, ne01%32==0 — matcha nomi
> reali di checkpoint) corrompe ⅛ dei pesi in silenzio. BMoE produzione
> immune BY DESIGN (use_extra_bufts=false) ma NON ancora dimostrato
> (smoke §4 sempre dovuto). **Il capitolo kernel NON è chiuso: resta il
> DIFETTO P (convert write).** Esperimento discriminante più economico
> (pre-registrato dal reviewer): cambiare la costante di fill_pattern e
> rerun della sweep (si ricompila solo il test exe, NON il .so) —
> predizione: il conteggio resta N/2 e l'insieme dei mismatch segue la
> nuova classe want<0x80. Ipotesi meccanicistica da vagliare per P:
> classe sign-extension (char vs uchar) negli store/helper del convert.
>
> 🧪 **ESPERIMENTO DISCRIMINANTE P ESEGUITO (S23, 4 run, stesso .so
> 9198f387… verificato prima di ogni run; commit test-only `5a952cb2`;
> report `scratchpad/agents/defectP-experiment/REPORT.md`, log
> `results/oracle_consumer_s23/defectP/`). VERDETTO: MIXED — il gate
> bit7 ESISTE ma la polarità del reviewer era INVERTITA e il trigger è
> un byte PARTNER trasposto:** (a) lcg default: 65.536 riprodotto ✓;
> (b) const40 (bit7 basso): **0 clean** — la predizione "tutti" VIOLATA;
> (c) constC0 (bit7 alto): **131.072, TUTTI corrotti** — predizione "zero"
> VIOLATA all'opposto; (d) lcg29: 57.344 con partizione bit7 imperfetta
> (bit7clear=15.360 / clean_bit7set=23.552). **Lettura: P scatta quando
> il byte SORGENTE PARTNER (quello che contribuisce la nibble alta del
> byte dispari di output, trasposto nel layout trans4) ha bit7=1 —
> perfettamente coerente con SIGN-EXTENSION (`char` vs `uchar`: (char)
> 0xC0>>4=0xFC inonda la nibble alta; 0x40>>4=0x04 pulito), condivisa da
> entrambe le forme producer perché sta nel LOAD/store comune, non negli
> helper di pack. Il "want<0x80" della simulazione era un proxy valido
> solo col moltiplicatore 131 (correlazione posizione↔partner).**
> Follow-up dovuti prima del fix: identificare il byte partner esatto da
> cvt.cl (read-only) e ri-derivare in forma chiusa TUTTI i conteggi
> (65.536 lcg / 0 const40 / 131.072 constC0 / 57.344+partizione lcg29 /
> 61.440 e 94.208 storici) da UN solo meccanismo — poi scrivere il fix
> (unsigned esplicito nel punto incriminato) e riverificare su device.
>
> 🎯 **P′ IDENTIFICATO AL BYTE (v4-flash, sim4.py: TUTTI e sei i
> datapoint ESATTI, più mxfp4 come extra).** Meccanismo: in
> `trans4_pack_hi` (cvt.cl:59 bytewise / :57 bitselect) l'idioma
> **mask-then-shift** `((x0 & 0xF0) >> 4)` viene miscompilato: il byte
> mascherato è trattato come signed, lo shift aritmetico sign-filla il
> campo, l'OR con `(x1 & 0xF0)` vince → la nibble alta del byte hi-word
> storato va a 0xF **sse bit7 del partner PARI x0=qs[2k] della stessa
> coppia è SET** (locale, stesso blocco; il restore fixato la mappa sulla
> nibble alta del byte dispari → firma `got=(want&0x0F)|0xF0`,
> `qs_other=0` ✓). Sotto qualunque fill biiettivo scatta esattamente su
> metà dei candidati (65.536); mult-131 vs mult-29 differiscono solo per
> l'overlap con posizioni già-0xF (0 vs 8.192 invisibili). R (block-even)
> regge invariato: 61.440 ✓, P∪R=94.208 ✓. Stessa classe dell'idioma
> "signed-smear" già documentato dalla campagna sul consumer q4_0 — ma
> nei PACK HELPER del convert, condivisi dalle due forme producer (per
> questo bytewise==bitselect). I path densi/K con lo stesso idioma
> round-trippano puliti: difetto specifico del path trans4. **FIX
> PREDETTO: shift-first-then-mask nei due helper** — `(x0>>4)&0x0F` (+
> difensivo `((x1<<4)&0xF0)` in trans4_pack_lo) — con predizione: TUTTI
> e sei i conteggi → 0 sotto OGNI fill. Se dopo il rewrite il bitselect
> corrompe ancora, il residuo è nel load/store condiviso (probe
> discriminante già disegnato: coppia singola even×{00,80}×odd×{40,C0}).
> ➡️ Implementazione in corso (GLM), poi: verifica disco → review ostile
> (Luna) ∥ verifica device (i 4 fill + sweep 5 tipi + e2e + regressioni).
>
> ❌➡️🔦 **FIX P TENTATIVO #1 (shift-first negli helper, `39a0b130f`):
> BIT-EXACT MA ZERO EFFETTO SUL DEVICE.** Review Luna: helper nuovi
> bit-identici ai vecchi su tutti i 65.536 input, robusti anche sotto
> compilatore avverso, scope +5/−4, GO condizionato agli zeri device.
> Device (16 log, `results/oracle_consumer_s23/defectP_fix/`, .so
> `69d6d862…` sha-verificato a ogni run): **tutti i conteggi
> BYTE-IDENTICI al pre-fix** — lcg 65.536, constC0 131.072, lcg29
> 57.344 con la stessa partizione, bitselect == bytewise, stesse
> posizioni first — su ENTRAMBE le arm. e2e tutto PASS (auto-consistenza,
> non fedeltà), K/denso puliti, HOST_REPACK 0. **Conclusione: P NON è
> nella forma dell'espressione dei pack helper — abbiamo cambiato l'unica
> cosa che distingue le due arm e non è cambiato NULLA. Il difetto vive
> nel LOAD di x0/x1 o nello STORE/assemblaggio della hi-word, condivisi
> (rank-2 della lista). Indizio di firma: got = want|0xF0 ≡ OR con 0xF0
> — coerente con sign-extension di un campo a 4 bit OR-ato
> nell'assemblaggio della word.** Il commit `39a0b130f` resta (innocuo,
> uccide l'idioma-classe per uniformità). **PROSSIMO: probe di
> localizzazione** — (a) fill "pair" mirato per blocco (even∈{00,80} ×
> odd∈{40,C0}, resto neutro) per inchiodare quale byte gate-a; (b)
> readback RAW del buffer SoA convertito via clEnqueueReadBuffer nel
> harness (SENZA passare dal restore) confrontato con le word di
> contratto attese host-side: separa definitivamente WRITE corrotto da
> READ corrotto — possibilità non ancora esclusa: il convert scrive
> giusto e il restore legge male i buffer GPU-converted (alignment
> diverso dallo storage host-repacked su cui fu assolto). Dopo la
> localizzazione: fix strutturale del convert in stile restore (uint
> word end-to-end, niente corsie uchar).
>
> 🔦 **PROBE ESEGUITO (commit test-only `bb05e4a0b`, 6 log,
> `results/oracle_consumer_s23/defectP_probe/`): P LOCALIZZATO — È LA
> SCRITTURA DEL CONVERT, IL RESTORE È INNOCENTE.** (1) pair-fill:
> pair8040 → 131.072 sporco, pair00C0 → 0 pulito ⇒ **gate = bit7 del
> byte PARI x0=qs[2k]**, il bit7 del dispari NON gate-a (era solo proxy
> posizionale). (2) Readback RAW dello storage SoA (via DUMP_Q, senza
> restore): **le word hi-nibble escono GIÀ corrotte dal convert**
> (lcg: 18.688/65.536 word sporche, pair8040: 32.768 = 50% esatto;
> 32.768×4 byte = 131.072 = roundtrip ✓), word lo-nibble TUTTE pulite,
> firma raw esatta got=(want&0x0F)|0xF0 (0x48→0xF8). Restore assolto
> in via definitiva (inverte fedelmente storage già sporco). **Indizio
> chiave: il bit7 di x0 corrompe il termine di x1 — effetto CROSS-BYTE
> impossibile dall'espressione di pack ⇒ il compilatore rivettorizza la
> forma byte-wise in corsie short/ushort con shift aritmetico — la
> STESSA classe as_ushort8 del difetto restore. Ecco perché il
> tentativo #1 (forma dell'espressione) non poteva funzionare.** FIX
> STRUTTURALE disegnato: riscrivere il path qs dei 5 convert trans4 in
> stile restore-fix — nibble extraction e assemblaggio delle word di
> output INTERAMENTE in uint scalari (shift/mask a livello word, uno
> store per word, zero corsie uchar/short intermedie). Verifica: il
> probe stesso (4 pair-fill + raw readback → tutto 0) + sweep + e2e +
> regressioni.
>
> 🏆 **DIFETTO P MORTO — FIX #2 (`f63746555`, riscrittura uint scalare
> dei 5 convert) VERIFICATO SUL DEVICE: TUTTE LE PREDIZIONI CONFERMATE,
> ZERO VIOLAZIONI** (review statica Luna: GO, contratto/segno/bitselect/
> scope tutti CONFIRMED; device 16 log,
> `results/oracle_consumer_s23/defectP_fix2/`, .so `2032b7c7…`
> sha-verificato a ogni run). **(1) GATE PRIMARIO — raw readback: 0/0**
> su lcg e pair8040 (erano 18.688/32.768): la scrittura deposita i byte
> di contratto, confrontati col riferimento host. **(2) Roundtrip 0 sui
> QUATTRO fill** (lcg/const40/constC0/lcg29 — constC0 era 131.072).
> **(3) Sweep 5 tipi: 0×5** (erano 65.536×5), controlli K/denso puliti.
> **(4) Arm bitselect: tutto 0, raw incluso** — anche la variante è
> sanata dalla stessa forma uint. **(5) e2e invariato tutto PASS e ORA
> WEIGHT-FAITHFUL** (GPU e giudice vedono i byte originali x): 74/74,
> 75/75, 3/3, 3/3, 74/74, q8_0 75/75, q6_K 3/3, denso 915/925.
> **(6) HOST_REPACK 0.** Lo smear cross-byte da bit7-del-pari è
> eliminato: la forma uint scalare batte la rivettorizzazione byte-lane
> di Adreno, la STESSA medicina che guarì il restore. **LA FAMIGLIA
> TRANS4 È INTEGRALMENTE SANATA — tre difetti, tre fix verificati al
> byte sul silicio:** convert-READ (9dc1ec0cb, ago), restore-READ
> (eaec5d884), convert-WRITE (f63746555). **Restano:** smoke di
> produzione BMoE (unico anello di fedeltà non misurato sul motore
> vero); 2 commenti stantii da ripulire (offset q4_0, "byte-wise
> stores" — segnalati da Luna, cosmetici); port di uniformità sui 6
> macro consumer (debito, non difetto); capitolo K2 q4_K/q5_K (grok);
> decisione di pubblicazione (owner). Lignaggio finale della notte:
> 1582f2d83 → eaec5d884 (restore) → 5a952cb2 (fill param) → 39a0b130f
> (helper, innocuo) → bb05e4a0b (probe) → f63746555 (convert uint) =
> **kalsakernel-v2**.
>
> 🔒 **SMOKE DI PRODUZIONE ESEGUITO — "PRODUZIONE IMMUNE" NON È PIÙ UN
> CLAIM BY-DESIGN: È DIMOSTRATO SUL MOTORE VERO (20/08 notte).**
> (GLM fino all'80% — shim `8c659e120` + estensione `55f43a574` quando il
> controllo positivo uscì VUOTO, cioè lo shim originale era cieco sui
> kernel trans4: il metodo ha retto anche qui — poi quota; Luna ha
> chiuso. Report `scratchpad/agents/bmoe-smoke/REPORT.md`, log
> `results/oracle_consumer_s23/bmoe_smoke/`.) Setup: bmoe-cli build
> condivisa dedicata (`build-android-opencl-smoke`, un solo binario,
> A/B = puro swap LD_LIBRARY_PATH), LFM2.5-8B-A1B-KEXP reale su S23,
> -c 512, --ngl 99 (tronco GPU), --moe-cpu-experts on, greedy seed 0.
> **CONTROLLO POSITIVO: PASS** (l'harness con shim ON mostra TUTTI e 10
> i nomi trans4 convert/restore — lo shim li vede). **(a) CONFERMATO:**
> zero kernel trans4/restore tra i dispatch del motore in load+64 token.
> **(b) CONFERMATO:** zero path trans4-moe nel log dei pesi (esperti
> CPU; tronco K su noshuffle). **(c) CONFERMATO — la prova regina:**
> output 64 token BYTE-IDENTICO tra il .so kalsakernel e il .so
> ARCHIVIATO TUTTO-ROTTO (1582f2d83): il motore non attraversa mai quei
> path. Caveat di copertura a verbale: KEXP = esperti Q2_K+Q3_K (gate
> trans4 mai attivabile per tipo con questa lineup — verificato al gguf);
> il fix è load-bearing per gpt-oss (MXFP4) e per chiunque usi quant
> narrow su Adreno. **IL CAPITOLO TRANS4 È INTEGRALMENTE CHIUSO: tre
> difetti fixati e verificati al byte, giudice riabilitato, produzione
> dimostrata immune.** Restano nel progetto: capitolo K2 (grok, domani
> 19:00 — tocca Mellum2 Q4_K_M; più eventuale supporto q2_K/q3_K MoE
> GPU per KEXP); commenti stantii + port di uniformità consumer
> (debito cosmetico); decisione di pubblicazione (owner).
> **CODA AGGIORNATA:** (a) esperimento discriminante P (S23, breve);
> (b) fix del difetto P; (c) smoke produzione BMoE; (d) port meccanici
> di uniformità + retain cl_mem + getenv cache; (e) grok domani: capitolo
> K2 (q4_K/q5_K compute) — nota: Mellum2 è Q4_K_M, esperti in famiglia K.
>
> ➡️ **Ultimo indiziato in piedi: il READBACK (`get_tensor`).** Hook
> pronto (working tree, +287/−1, `.so` `0111c70d…4ed692`):
> `DST_READBACK{raw_match, returned_match}` (raw = re-read indipendente
> del range snapshottato; returned = checksum di ciò che get_tensor
> consegna), snap consumati dopo il log (anti falso-clobber su cl_mem
> riciclati), OVERLAP_MAP, POST_ENQUEUE (limite onesto: matcha il tensor
> del wrapper, OpenCL non espone i cl_mem bound). 🔎 Review ostile in
> corso, con domanda-crux: l'hook DISTINGUE davvero i quattro esiti
> (raw×returned), e cosa resta logicamente se esce tutto verde e l'e2e
> fallisce ancora (⇒ reference/NMSE del harness — la sessione deve poter
> essere interpretabile in anticipo per ogni esito).
>
> ➡️ Nel frattempo il Jelly (libero) è
> stato messo sul buco di provenienza del listino: **cella tracciabile per
> "Marco1c Jelly 3.64 t/s (t2, ranking)"** — uno dei due numeri di ALIVE §5
> che non risalgono a nessun runs.csv — con config spedita (d=0.0, flag da
> citare per file:riga), harness covariate, ≥3 round, unplugged
> (`results/lineup_marco_jelly_cov/`).
>
> 🏷️ **19/08 — REGOLA DI RICONOSCIBILITÀ DELL'ENGINE ("kalsallama", proposta
> gualt).** Paura a verbale: due kernel patchati in modo diverso su lignaggi
> separati. Protezione: (1) **una sola linea di patch** — tutto si impila su
> `kalsa/kernel-s3-repack`, mai patchare main/upstream (già a verbale); (2) al
> **prossimo commit engine** si aggiunge un **version banner di build**
> `kalsallama <branch> <sha>` in `--version` e nel log di avvio — chiude anche
> il buco "`strings` sull'exe mente"; (3) **niente rename di file o simboli
> kernel** (avvelenerebbe diff e rebase contro upstream). L'altro Claude lavora
> su macOS al repo app (kalsa), non su moe-experiments: nessuna collisione di
> working tree; la risorsa condivisa è solo l'S23.
>
> 📱 **19/08 — LE TRE CELLE CACHE JELLY SONO RIFATTE CON LA COVARIATA CPUSET
> E PASSATE ALL'AUDIT OSTILE. VERDETTO A DUE FACCE: c1500/c2000 REPLICANO,
> IL "+15/+20% a c4000" NON SOPRAVVIVE — E CADE ANCHE IL +39% ORIGINALE.**
> (Report agente: `scratchpad/agents/jelly-cache-rerun/REPORT.md`; audit con
> tutta l'aritmetica: `scratchpad/agents/jelly-cache-rerun-review/REPORT.md`.)
>
> Celle nuove `results/cachesweep_marco_jelly_c{1500,2000,4000}_cov/` (dir
> nuove, sennò il resume avrebbe skippato), harness al commit **`6a26036`**
> (già committato — la voce "uncommitted" di ALIVE §6 è superata; disco ==
> commit verificato dall'audit). **Tenuta della piattaforma, confermata riga
> per riga dall'audit:** 24/24 righe accettate con `nproc=8`,
> `affinity_mask=ff`, `/top-app 0-7` **dal PID di `bmoe-cli`** (harness
> L548-570); tutte UNPLUGGED, batteria **94→56 nei DATI** (il "97→55" del
> report agente è prosa che non sta in nessun file — stessa classe di errore
> già ritrattata in campagna); sha binario `77a94640a56a9043` (prefisso a 16
> hex, calcolato live dall'harness) identico in tutti e 6 i log.
>
> ✅ **Ciò che REGGE (12/12 righe appaiate, aritmetica ricalcolata):**
> a c1500 il drop paga **−24.8%**, a c2000 **−28.4%**, stabili ≤1.5% fra i
> due run. Per queste due celle "replica, non artefatto" è onesto — e sono
> le celle su cui poggia il default spedito. ➡️ **Il default NON poggia su
> un artefatto da cpuset.**
>
> ❌ **Ciò che NON regge (HIGH dell'audit):**
> - **c4000 "+15/+20%" era un sottoinsieme (r2/r3):** con TUTTI i round
>   accettati il danno del drop collassa a **+2.4% medio / −3.1% aggregato ≈ 0**.
>   E il **+39% della cella originale era portato al 100% dal suo outlier
>   r1**: esclusione simmetrica di r1 → +15.5% vs +17.4% (coerenti); tutti i
>   round → +39% vs +2% (incoerenti). **Il rerun SMENTISCE la grandezza
>   originale.** Lettura onesta di c4000: a cache grande il drop **non paga**
>   (il suo vantaggio va a ~0), ma il "fa male +39%/+15%" citabile non
>   esiste più. "Termicamente appaiate" non è sostenibile: l'anomalia r1 è
>   in `compute_s_tok` (0.154 vs 0.089), non termica.
> - **"Byte bit-identici" è FALSO sul contatore vero:** le colonne identiche
>   (read_MiB, hit%, evictions, …) sono **formule deterministiche**;
>   l'unica misura I/O reale, `proc_read_bytes`, differisce in **24/24**
>   righe (−0.58%…+1.16%, normale). Il meccanismo replica; "bit-identico"
>   no.
> - **0.184→0.142 a c1500: numero confermato, spiegazione refutata** — il
>   rerun misura 0.142 **alla stessa temperatura (35 °C)** dell'0.184
>   originale: era varianza run-to-run, non termica.
> ⚠️ **Caveat di provenienza (da chiudere):** le celle "originali" usate come
> termine di confronto **non esistono nel repo** se non nelle copie
> dell'agente — il bersaglio del confronto non è verificabile alla fonte.
> In coda: localizzare/committare gli originali o declassare il confronto.
> ➡️ Voce di coda "rerun celle Jelly con la covariata": **CHIUSA** (resta il
> gemello S23, telefono occupato). 🔧 Residuo harness confermato dall'audit
> (display-only, `watch_dropsweep_lfm_jelly.ps1` ~L112): il contatore righe
> buone fa `grep ',0,ok$'` e sul nuovo schema stampa 0 — non blocca il
> rilancio, da sistemare al prossimo giro.
>
> ✅ **KEEPALIVE JELLY: CONFERMA PIENA.** `mWakefulness=Awake` ininterrotto
> per **~83 min** (soglia era ≥60), Termux mai ucciso. ⚠️ Dettaglio operativo
> nuovo: **staccato il Jelly non ha USB** — la ricetta adb va applicata via
> **wireless debugging** (`192.168.1.82:39591` in questa sessione; la porta
> cambia a ogni pairing).
>
> 📇 **19/08 ~13:45 — CELLA DI LISTINO MARCO1c JELLY RIFATTA AL FLAG
> SPEDITO, E LA CARD VA CORRETTA IN DUE PUNTI.**
> (`results/lineup_marco_jelly_cov/`, harness covariato; report agente in
> `scratchpad/agents/jelly-lineup-marco/REPORT.md`.)
> - ✅ **Il flag di provenienza di ALIVE §5 era SBAGLIATO in un senso
>   inatteso: il 3.64 UN runs.csv ce l'ha** (`results/lineup_card/jelly_1c/`)
>   — ma misura **k6 d=0.65** (il default VECCHIO, ritirato), ABBA
>   fact+creative, binario `36b01966…`.
> - 📏 **Il flag spedito (d=0.0, t2, cache 2000 — ogni flag citato, cache
>   4000 è l'ottimo Jelly ma NON è nel flag) misura 3.27-3.39 t/s,
>   mediana 3.34** su 3 round freddi p_fact, range ±3%, stesso binario
>   della card verificato per sha, covariate tutte pulite (nproc=8, ff,
>   UNPLUGGED 46→41%).
> - ➡️ **Like-for-like (solo fact): lo spedito è ~7-9% più LENTO della
>   card** (3.27-3.39 contro 3.576-3.594); il 3.642 mescola anche il
>   creative (più veloce). **La riga Jelly del listino va aggiornata a
>   ~3.3 t/s con questa cella come fonte.**
> - 🔍 **Fatto nuovo che il confronto ha stanato:** lo sweep cache misura
>   **5.5-5.9 t/s** alla STESSA config (d=0.0, cache 2000) con gli STESSI
>   byte (11803.1 MiB) e hit (50.2%) — ma su **binario diverso**
>   (`kernel_kf`). Il regime I/O è identico alla cifra: **il gap di
>   tok/s (~+70%) è il BINARIO, non config né drop.** Va capito cosa ha
>   `kernel_kf` che il binario di listino non ha — possibile upgrade di
>   listino gratis. In coda.
> ⚠️ Batteria Jelly a 41%: prima di altre celle lunghe va ricaricato.
>
> 🔬 **PROFILING COMPUTE — LA DOMANDA APERTA DA GIORNI HA RISPOSTA: SONO I
> MATMUL MoE, IL GDN NON ESISTE (18/08, CalaQwen, `--compute-trace`).**
>
> Domanda di gualt: *"capire se quei 0.1407s sono dominati dai matmul MoE o
> dal GDN. Solo quello vi salverà."* Traccia per-nodo su CalaQwen
> (47.021 nodi, `qwen35moe`, 40 layer), separata per fase:
>
> | operazione | prefill | **decode** |
> |---|---|---|
> | **MUL_MAT_ID** (esperti MoE) | **81.6%** | **33.5%** |
> | MUL_MAT (densi/attenzione) | 9.9% | **23.1%** |
> | GET_ROWS | 2.0% | 7.6% |
> | ADD | 0.8% | 7.5% |
> | **GATED_DELTA_NET** | **0.94%** | **2.26%** |
> | **rapporto MoE/GDN** | **87×** | **15×** |
>
> ➡️ **Il compute è matmul: MoE + densi = 56.6% del decode. Il GDN è il
> 2.26%.** Tagliare FLOP ha senso solo su `MUL_MAT_ID`.
>
> 🪦 **E questo UCCIDE il "Predictive GDN State Update Skipping"** proposto
> nel PDF (DCB) — **per mano del suo stesso criterio di morte**, che
> recitava: *"se il layer GDN è sotto il 10% del compute per token, la
> componente state-skip probabilmente non vale la pena"*. Misurato:
> **2.26%**. Chiuso senza scrivere una riga di codice.
>
> ⚠️ **Limite dichiarato dallo strumento stesso:** `--compute-trace`
> *"isolates and times EVERY graph node — serializes the graph, proportions
> only"*. Quindi le operazioni minute (il ~40% di decode in `GET_ROWS`,
> `ADD`, `MUL`, `RMS_NORM`) sono **gonfiate**: perdono fusione e
> coalescing. **Il rapporto MoE/GDN regge** (15× e 87× sono fuori da
> qualunque artefatto di serializzazione), quel 40% no. Per una ripartizione
> fedele serve `--compute-trace-layers`, che tiene una barriera per layer e
> lascia sopravvivere coalescing e prefetch — **prossimo passo naturale**.
> ⚠️ Un secondo `bmoe-cli` girava in parallelo durante la traccia: altro
> motivo per non citare i tempi assoluti, solo le proporzioni.
>
> ✅ **Allineato con gualt (18/08): la speculative decoding è chiusa** — F6
> morta sui byte (β=0.594 contro 0.56 di pareggio) e draft-by-drop morta
> prima dell'implementazione. Il compute-bound si attacca tagliando FLOP,
> non aggiungendo draft head.
>
> 📦 **UN REPO SOLO, SENZA CANCELLARE NIENTE (18/08, commit `15b4e47`).**
> gualt: *"vorrei un repo solo per non perderci, ma senza cancellare o
> perdere niente"*. La proposta iniziale era spostare tutto in
> `kalsa-engine` e cancellare `moe-experiments`: **sconsigliata con un
> numero.** Fuori da git, perché gitignorato, c'è **`models/` = 57 GB** e
> **`build-pc-mellum-ppl/` con il binario pinnato** — ricostruibile dal
> branch giusto ma **non byte-identico**, e la campagna lo pinna per sha.
> Cancellare la cartella avrebbe distrutto entrambi.
>
> ✅ **Fatto invece:** `BigMoeOnEdge/` è ora un **submodule** puntato al
> nostro `Aspis0/kalsa-engine` (privato, 9 branch + uno snapshot per
> l'unica copia-cartella il cui sorgente non corrispondeva a nessun
> branch). Gitlink su `0c54a27`, cioè la linea del binario di campagna.
> **Da adesso ogni commit di risultati registra l'engine che li ha
> prodotti** — è il buco che il 18/08 è costato mezza giornata.
> 🔒 Remote rinominati: **`origin` = il nostro** (scrivibile),
> **`upstream` = Helldez** con push URL **disabilitato**. Nessuna nostra
> patch era mai uscita (verificato dal reflog), e ora non può.
>
> 🧾 **BATTERIA DI SANITÀ SU MARCO (18/08, 12/12) — IL GATE NON TROVA
> CONFERMA NELLE RISPOSTE, E VA DETTO.**
>
> Tre config: `stock` k=8 (ancora), `shipped` k=6 d=0.0 (**da spedire**),
> `rejected` k=6 d=1.0+nr (**bocciata dal gate al 122% del budget**).
>
> | | F1 Spa 2000 | tabellina 9 | giudizio | **vocali in "armadio"** |
> |---|---|---|---|---|
> | stock k=8 | ✅ Häkkinen | 10/10 | ✅ | **3** ❌ |
> | **shipped** k=6 d=0 | ✅ Häkkinen | 10/10 | ✅ | **5** ❌ |
> | **rejected** d=1.0+nr | ✅ Häkkinen | 10/10 | ✅ | **4** ✅ |
>
> ⚠️ **Sulla domanda che discrimina, la config MIGLIORE per bpb sbaglia
> (3, deduplicando le due "a"), quella da spedire sbaglia diversamente
> (5, inventando una "i"), e l'unica corretta è quella BOCCIATA.**
> Su CalaQwen le quattro config dicevano tutte 4. **Quindi è una
> debolezza di Marco, non della configurazione**, e quale config indovini
> è fortuna.
>
> ➡️ **Due conclusioni oneste:** (1) **quattro domande non bastano a
> ordinare le config** — la varianza fra domande è molto più grande della
> differenza fra config; (2) **il rifiuto di d=1.0 da parte del gate NON
> è corroborato da evidenza indipendente.** Non significa che il gate
> sbagli — la bpb integra su un corpus intero, quattro domande no — ma
> significa che al momento **la bocciatura di Marco poggia su un solo
> tipo di misura.** Se quella decisione diventa costosa, serve una
> batteria vera (decine di domande, giudice cieco), non queste quattro.
> ✅ **Quello che la batteria esclude davvero:** nessuna delle tre config
> è rotta — istruzioni rispettate, aritmetica esatta, giudizio sensato,
> italiano fluente ovunque.
>
> 🛑 **MARCO1c — ANCORA MISURATA, E IL DROP A 1.0 NON SI PUÒ SPEDIRE.
> NEMMENO COL FLAG. (18/08 03:38, `results/marco_renorm_ablation`)**
>
> Ancora sua: **`marco_k8d0` = 0.761332** (k=8, nessun drop, stesso binario
> e corpus). Contro quella, col budget di campagna `MACRO_PASS = 0.04`:
>
> | config Marco | macro bpb | vs ancora | quota budget | esito |
> |---|---|---|---|---|
> | k6 **d=0.0** | 0.766534 | **+0.0052** | **13%** | ✅ PASS |
> | k6 d=1.0 renorm ON | 0.861667 | +0.1003 | **251%** | ❌ FAIL |
> | k6 **d=1.0 + no-renorm** | 0.810295 | **+0.0490** | **122%** | ❌ **FAIL** |
>
> **`--drop-no-renorm` dimezza il danno (da +0.1003 a +0.0490) ma non
> basta: su Marco il drop a 1.0 sfonda comunque il budget del 22%.**
>
> ➡️ **Per Marco1c la risposta è: NESSUN DROP.** `d=0.0` passa col 13% del
> budget; `d=0.65` è già escluso dall'altro lato (sul device è **più
> lento** di non droppare, +5.4% su 3 round). Non esiste un livello di
> drop che convenga su questo modello.
> ✅ **È esattamente perché mi ero rifiutato di estendere a Marco il
> default deciso per CalaQwen senza la sua ancora.** Su CalaQwen d=1.0+nr
> sta al 50% del budget, su Marco al 122%: **stesso flag, stesso livello,
> esito opposto.** La config è per-modello, come diceva gualt.
>
> 📌 **E si incastra col risultato cache:** per Marco la leva giusta non è
> togliere esperti ma **dargli RAM** — cache 4000 senza drop è il minimo
> assoluto misurato (0.113 s/tok) e costa **zero** qualità, contro un drop
> che qui non passa nemmeno il gate.
>
> 🔭 **PREFILL GPU RIVERIFICATO (18/08, Xiaomi 14 / Adreno 750, scollegato,
> celle INTERLACCIATE, 5 ripetizioni per ordinamento) — IL 5.77× È
> RITIRATO, MA LA LEVA ESCE PIÙ FORTE DI PRIMA.**
>
> ❌ **Il 5.77× era un artefatto della BASELINE CPU, non della GPU.**
>
> | | riverifica 18/08 | report originale |
> |---|---|---|
> | GPU pp128 | 183-188 t/s (media 186.6) | 181.65 ✅ riprodotto |
> | **CPU pp128** | **57-62 t/s (media 58.7)** | **31.46** ❌ |
>
> **La GPU riproduce esattamente il valore storico; è la CPU che
> nell'originale girava in uno stato lento** (i suoi due campioni erano
> coerenti fra loro — 31.76 / 31.16 — quindi non un errore di misura ma
> uno stato reale, e mai rimisurato). Rapporto vero a pp128: **3.18×**.
> ✅ **E NON è l'artefatto da prima-cella-fredda che temevo** (quello che
> aveva fregato il 740): la prima GPU della serata è stata la **più lenta**
> (179.7) e le prime CPU le **più veloci** (62.4 → assestate a 57.2) —
> l'opposto del pattern. I due ordinamenti concordano: **3.10× e 3.27×**.
>
> 📈 **MA il vantaggio CRESCE con la lunghezza del prompt, e il nostro
> punto di lavoro non è 128 token — è il system prompt da ~1.4k:**
>
> | pp | 2B GPU/CPU | 4B GPU/CPU |
> |---|---|---|
> | 128 | 3.18× | 4.17× |
> | 512 | 3.95× | 5.70× |
> | **1024** | **5.35×** | **6.95×** |
> | 2048 | 6.69× | 6.46× |
>
> **TTFT interpolato a 1400 token: 2B ~6.5 s su GPU contro ~33 s su CPU;
> 4B ~16 s contro ~108 s.** Cioè il 4B diventa usabile solo con la GPU.
>
> 🌡️ **L'argomento più solido non è il rapporto, è la STABILITÀ: la CPU è
> termicamente fragile, la GPU no.** Gli outlier CPU (29.5 t/s a pp1024,
> 18.8 a pp2048) sono arrivati a 38-40 °C mentre la GPU accanto restava
> a 216.7 e 212.2. Su un telefono caldo — cioè in uso vero — la CPU
> degrada e la GPU tiene la banda 210-217 (2B) / 86-89 (4B).
>
> 🔧 **Niente da spremere: la config di partenza era già l'ottimo.**
> `-ngl 99` batte 8/16/24; `-ub 512` batte 128/256/1024; `-b` e i thread
> GPU sono rumore. ⚠️ **`-fa on` CRASHA (exit 134, JSON vuoto)** — da
> aprire come bug, non è una config.
>
> ---
>
> 🔭 **RECON SILICIO NON-CPU/GPU (18/08, due round Grok con fonti obbligatorie;
> report in `scratchpad/agents/isp-npu-recon/` e `.../eva-npu-round2/`).
> MANDATO gualt: "se nessuno l'ha fatto possiamo farlo noi".**
>
> ☠️ **EVA / CVP — CHIUSA COL SORGENTE DEL DRIVER, non con le slide.**
> `eva-kernel` è `msm_cvp` rinominato; device `/dev/cvp`; DT `qcom,kalama-cvp`
> = SM8550 = 8 Gen 2. L'ioctl **ignora `cmd`** e dispatcha su
> `eva_kmd_arg.type`; `EVA_KMD_SEND_CMD_PKT` (0x10001040) è un **pass-through
> HFI opaco** da 490 word. **MA il kernel tiene un allow-list `cvp_hfi_defs[]`
> e rifiuta `-EINVAL` ogni tipo non elencato.** La lista, letta dal sorgente:
> DFS (depth-from-stereo), SGM_OF e CV_TME (optical flow), WARP, NCC
> (correlazione fra patch), HCD (Harris), OD/ODT, FD/DLFD, ICA, DMM, DCM.
> ⚠️ **`DCM` = Descriptor Calc & Matching, NON "dense compute"** — era la mia
> speranza ed era sbagliata. I pacchetti di config sono 47 word (NCC) e 20
> (DCM): non c'è posto per un tensore di pesi. `SET_MODEL_BUFFERS` è l'IOVA
> persistente dei modelli face-detection Qualcomm, non pesi arbitrari.
> ➡️ **Nessun comando moltiplica una matrice del chiamante per un'altra.**
> 🔒 **Secondo cancello indipendente:** `/dev/cvp*` è etichettato
> `video_device`; AOSP ha un **neverallow** su tutto `appdomain`; il dominio
> previsto è `hal_camera`. Non apribile da app né da `adb shell` stock.
> ✅ **La parte giusta dell'intuizione di gualt: prior art = ZERO.** Nessun
> paper, repo, thread o writeup di compute generico su un ISP di telefono.
> ❌ La parte sbagliata: non perché nessuno abbia guardato, ma perché **la
> porta non esiste**.
> 📌 **"Patchiamo il kernel per togliere l'allow-list?"** Si può (sullo Xiaomi;
> sull'S23 il bootloader Samsung Snapdragon in genere non si sblocca e Knox si
> brucia) **e non serve**: l'allow-list è un filtro SOFTWARE, toglierlo non
> crea una GEMM che nel firmware/silicio non c'è. L'EVA è pipe a funzione
> fissa; un pacchetto non implementato dà errore firmware, non una matmul.
> **Il muro è l'op-set del firmware, non il filtro.** L'unica versione seria
> sarebbe reverse-engineerare il firmware firmato: mesi, premio ipotetico.
>
> ☠️ **VENUS — chiusa.** Nel UAPI V4L2 pubblico: nessuna modalità
> motion-estimation-only, nessun output di vettori di moto separato
> dall'encode, nessun pacchetto SAD/NCC, nessun controllo che accetti
> coefficienti del chiamante. Il trucco esiste **su desktop** (NVENC documenta
> un ME-only mode) **perché NVIDIA lo espone**; patchare un kernel non aggiunge
> una modalità al firmware Venus. E comunque sarebbe SAD, non GEMM.
>
> ☠️ **ISP Spectra / CHI — chiusa.** CHI compone pipeline *fotografiche* e i
> suoi "extended node" scaricano su **CPU, GPU o DSP**, non caricano microcodice
> sull'ISP; `qcom_camss` mainline è cattura V4L2. **CHI è un instradatore, non
> un motore.** ☠️ Sensor hub, DPU display, DSP del modem: chiusi anch'essi —
> sul modem la frase è netta, i core li programma solo Qualcomm.
>
> ☠️ **UFS HPB — chiusa, per tre ragioni indipendenti.** (1) Il nodo sysfs
> `flags/hpb_enable` è **read-only per ABI del kernel**: non è "serve root", da
> userspace non si accende. (2) HPB è stato **rimosso da Linux mainline nel
> 2023** ("not aware of any current users"). (3) Accelera le letture **random
> da 4 KB** — tutti i numeri pubblicati (58-67%, 43%, 46%) sono lì; noi
> leggiamo blocchi da centinaia di KB con O_DIRECT, dove un lookup di mappa si
> ammortizza su centinaia di pagine. Numeri sulle nostre dimensioni: NOT FOUND.
>
> 🔧 **DUE CORREZIONI MIE, ENTRAMBE DETTE A gualt PRIMA DI VERIFICARLE.**
> 1. **Lo 0.67 MiB NON era la prova che credevo.** Avevo dato «l'HTP carica
>    0.67 MiB, quindi l'NPU non è candidata» come fatto. Il thread vero
>    (llama.cpp #22791, **proprio su un Galaxy S23**) dice altro: il log è
>    `token_embd.weight (q6_K) (and 197 others) cannot be used with preferred
>    buffer type`, e il manutentore risponde **«We do not support Q4_K_M in the
>    Hexagon backend»**. Quasi tutti i tensori erano di un quant non supportato
>    e restavano su CPU: 0.67 MiB è ciò che avanzava, non un tetto.
>    ✅ **La conclusione regge su evidenza migliore:** col quant giusto il
>    decode su HTP non vince comunque — OnePlus 12, Qwen3.5-4B **Q4_0**: CPU
>    11.43 t/s, OpenCL 8.44, **HTP 3.02** (#23314); in una prova successiva
>    CPU 9.1 / OpenCL 9.4 / HTP 8.9. Pari, non 100×.
> 2. **`graph splits = 283` non erano handover intenzionali.** Avevo scritto
>    «se quelle 283 transizioni costano poco il disegno regge». Falso: era lo
>    scheduler GGML che esplodeva perché ogni tensore rimbalzava per quant non
>    supportato. Sul path Q4_0 funzionante l'esempio ufficiale mostra **un solo
>    device HTP e `graphs reused = 473`**.
>
> 🚫 **"L'NPU ha memoria propria e non compete per la banda" — SMENTITO da
> fonte primaria.** Doc Hexagon di llama.cpp, testuale: memoria **unificata**,
> «the NPU does have a dedicated tightly-coupled memory called VTCM but that
> memory is used only for intermediate data … or temporary data (chunks of the
> weight tensors fetched via DMA)». TCM dell'8 Gen 2 = **8 MB**: scratchpad,
> non VRAM.
> ⚖️ **Correzione a me stesso in senso opposto:** avevo detto "non si può
> sommare banda", troppo netto. PowerInfer-2 misura sull'8 Gen 3 **CPU sola
> 43.9 GB/s, NPU sola 56, CPU+NPU 59.6** — non si sommano, ma **+36% di
> utilizzo aggregato** esiste.
>
> ✅ **L'UNICA PISTA VIVA: PREFILL DENSO SU NPU, ESPERTI SU CPU.**
> Numeri altrui su 8 Gen 3: PowerInfer-2 **770 tok/s** di prefill NPU su 7B
> INT4 (GPU 37, CPU 8); mllm-NPU sullo Xiaomi 14 **>1000 tok/s** su
> Qwen1.5-1.8B, 7.3-18.4× la CPU a prompt 1024. È la **terza conferma
> indipendente** dello stesso confine — acceleratori per il prefill, CPU per il
> decode — dopo la nostra misura GPU e i numeri di campo llama.cpp. E il nostro
> dolore è il system prompt da ~1.4k token, cioè prefill.
> 🎯 **La novità che sarebbe nostra: prefill NPU su un MoE che NON sta in RAM e
> streamma da flash.** Nessuno lo fa: PowerInfer-2 fa offload su flash e il
> decode gli crolla a 1.4-2.3 tok/s; mllm-NPU fa NPU ma su modelli piccoli
> tenuti in memoria. Noi abbiamo già la metà difficile. **E la Q7-landmine, che
> sul decode ci blocca, qui è la forma GIUSTA: denso sull'acceleratore,
> esperti su CPU.**
>
> 🔬 **VINCOLI DURI (fonti primarie, round 2):**
> - **La strada NON è QNN, è il backend Hexagon di llama.cpp.** QNN è a grafo
>   statico (prepare-once/execute-many) e **non esiste API pubblica per
>   aggiornare i pesi di un grafo finalizzato**. Il backend llama.cpp non ha
>   grafo: i pesi stanno in buffer rpcmem, `set_tensor` li riscrive — memcpy +
>   re-tiling, non 11 s di compilazione. Ed è aperto.
> - **`mllm-NPU` non è riusabile come speravo:** MIT ma **non include QNN**
>   (proprietario), gira su **v75**, il suo MoE è **CPU-only**, i telefoni nel
>   README oggi sono **8 Elite** (non il nostro Xiaomi 14), e carica un
>   **context binary compilato**: non gli passi i tuoi pesi a runtime.
> - **v73 (S23): VA del cDSP a 32 bit, tetto pratico ~2 GiB, `ndev` forzato a
>   1.** EuroSys 2026 su OnePlus Ace 3 (stesso 8 Gen 2): i 3B **non si
>   caricano**. v75 (Xiaomi 14) può aprire più sessioni.
> - **FastRPC #137, misurata su 8 Gen 2: `munmap` NON libera la VA del DSP**
>   finché non si fa `rpcmem_free`. Una finestra scorrevole da 1 GiB fallisce
>   appena la *storia* delle mappature supera 2 GiB.
> - **Costo per handover CPU↔HTP: NOT FOUND.** Nessuno l'ha pubblicato. È il
>   rischio aperto vero: denso-su-NPU/esperti-su-CPU è uno split **per layer**.
> - **Prefill tok/s su v73 con un quant supportato: NOT FOUND.** È il numero
>   che deciderebbe se l'S23 è un bersaglio, e non esiste al mondo.
>
> 💡 **IDEA DI gualt CHE RIAPRE L'S23 — e regge.** Il tetto dei 2 GiB è su
> **quanto mappi nella sessione**, non sulla taglia del modello. **LFM2.5-8B-A1B
> (3.1 GB su disco, 1B attivo)** con i soli **densi** mappati sta in qualche
> centinaio di MB: dentro con margine. E **sparisce anche FastRPC #137**, perché
> quel bug morde solo se fai ruotare i buffer: densi mappati **una volta e mai
> smappati** non perdono VA. Disegno: densi in sessione una volta, esperti che
> streammano su CPU come già fanno.
> ⚠️ **Da verificare prima di entusiasmarsi:** LFM2.5 è **ibrida**, non un
> transformer puro — le sue op devono essere fra quelle che il backend Hexagon
> esegue. Se i blocchi conv/ricorrenti rimbalzano su CPU il grafo si spezza in
> mille pezzi, ed è esattamente il rischio numero uno.
> 💡 **E il quant si risolve senza requantare il valore nostro:** serve un quant
> supportato (Q4_0/IQ4_NL/MXFP4) **solo per i tensori DENSI** — GGUF misto,
> esperti KEXP intatti su CPU; `llama-quantize` fa override per tipo di tensore.
> Abbiamo `Mellum2-12B Q4_K_M` su disco ma **Q4_K_M non è supportato**: è
> proprio il quant che ha reso vacua la misura S23.
>
> ⏭️ **NPU + GPU insieme: si può, ma DOPO.** Lo scheduler GGML elenca CPU,
> `GPUOpenCL` e `HTP0..HTP4` come device dello stesso grafo, e il +36% di banda
> aggregata è reale. Ma un grafo a tre vie, prima di conoscere il costo di UN
> handover, rende il risultato non attribuibile.
>
> 🔬 **MISURA NUOVA (18/08 sera, S23 Adreno 740, binario K2.2, via `adb shell`):
> IL KERNEL MoE OPENCL È ROTTO SU TUTTI I QUANT STRETTI — E IL DENSO NO.**
> `test-backend-ops test -b GPUOpenCL`, stessa sessione, stesso driver:
>
> | type_a | `MUL_MAT` denso | `MUL_MAT_ID` MoE |
> |---|---|---|
> | q4_0 | **46/46 OK** | **0 / 74 FAIL** (ERR 0.42-0.44) |
> | q4_1 | 35/35 OK | 0 / 75 FAIL (ERR 0.38) |
> | q4_K | 33/33 OK | 0 / 73 FAIL (ERR ~0.9) |
> | mxfp4 | 34/34 OK | 0 / 74 FAIL (ERR 0.34) |
> | q5_0/q5_1/q5_K | OK | FAIL (q5_0 ERR 0.10) |
> | q8_0 | 47/47 OK | **75/75 OK** |
> | q6_K | 4 OK / **10 FAIL** | **3/3 OK** |
>
> Soglia ERR = 0.0005, quindi 0.42 è spazzatura non arrotondamento. Fallisce a
> **ogni** forma — `n=1` (GEMV) e `n=32` (GEMM), `m=64` e `m=2880` — e il q6_K
> passa **sulle stesse forme** dove il q4_0 muore: **il discriminante è il quant,
> non la shape.**
> ✅ **Cosa esclude (è la parte utile):** NON è il driver e NON è un miscompile
> dei dequant subgroup-free — il q4_0 **denso** è perfetto sullo stesso silicio
> e compilatore. (L'ipotesi miscompile era vera per il port MLD/M1; **qui non si
> applica**.) NON è la matematica di dequant: lo stesso quant è corretto in un
> percorso e sbagliato nell'altro. ➡️ **Il difetto è nei kernel MoE.**
> 🎁 **E c'è un riferimento funzionante**: per lo stesso quant, sullo stesso
> hardware, il kernel denso dà il risultato giusto. Non si debugga al buio.
> 📌 I 10 FAIL del q6_K **denso** NON sono una regressione: è il kernel flat
> ancora rotto (K2.2 corresse il *dispatch* perché i tensori veri non ci
> finissero; K2.3 fu deprioritizzato). `test-backend-ops` genera forme che i
> modelli non producono. *Invariato* è la condizione di pass, non *migliorato*.
>
> 🧭 **KERNEL MoE ADRENO — LA PATCH ESISTEVA GIÀ, È STATA RIVISTA, COMPILATA E
> MISURATA SUL DEVICE (18/08 sera). RISULTATO: L'ERRORE SI DIMEZZA MA NON SPARISCE.**
>
> 🔴 **CORREZIONE DI UN FATTO SCRITTO QUI SOPRA: «l'albero llama.cpp è rimasto
> pulito (nessuna modifica), nessuno stato a metà» ERA FALSO.** `cvt.cl` porta
> mtime **18:45:16**, cioè **tre minuti DOPO** le 18:42 in cui avevo dato Grok per
> morto: era solo staccato e ha continuato a lavorare. Sul disco c'erano **82
> righe aggiunte e 117 tolte**, mai compilate e mai viste da nessuno.
> *(Intuizione di gualt, non mia: «probabile che Grok era staccato e ha continuato».)*
>
> **Cosa conteneva la patch — due fix per due cause diverse, non l'ipotesi unica:**
> - **(A) allineamento**: i load `ushort8` da `b->qs[0]` (offset 2/4/6/8/1 nei
>   rispettivi struct, quindi **mai** allineati a 16 byte) sostituiti da accessi
>   byte-wise, su q4_0/q4_1/q5_0/q5_1/mxfp4 + la ricostruzione byte-wise di `qh`.
> - **(B) layout q4_K/q5_K**: riscrittura da gruppi da 64 a sub-blocchi da 32.
>
> 🔬 **AUDIT OSTILE (DeepSeek V4 Flash, thinking max, hand-trace + simulazione
> numerica di tutti i quant contro la matematica reale dei consumer):**
> - **(A) CORRETTA** — byte-exact contro i kernel densi che passano 46/46, con
>   round-trip esatti; la ricostruzione `qh` è l'equivalente little-endian esatto
>   della `memcpy` della CPU, nessuna trappola di endianness o sign-extension.
> - **(B) SBAGLIATA E DISTRUTTIVA — il layout vecchio era GIÀ corretto** (simulazione
>   **256/256** valori giusti), il nuovo ne sbaglia **122/256 e 124/256**. La CPU
>   impacchetta il byte `32g+l` come `(L[64g+l], L[64g+32+l])`, quindi il loop
>   vecchio emetteva già i valori `[32·ib, 32·ib+32)` nei 16 byte che il consumer
>   legge; quello nuovo, per ogni `ib` dispari, pesca 16 valori indietro e dal
>   nibble sbagliato. **Prova indipendente: q6_K usa lo stesso windowing del vecchio
>   q4_K e passa 3/3 sul device.** ➡️ **Le hunk q4_K/q5_K sono state RIMOSSE**; delle
>   16 hunk ne restano **12**, tutte e sole di allineamento (55+/93−).
> 📌 **Errore mio da mettere a verbale:** avevo verificato che il consumer legge tile
> da 32 e concluso che «la direzione regge» — **un lato solo dell'uguaglianza**, senza
> controllare che il convert vecchio già li producesse. Compilando subito avrei rotto
> q4_K e q5_K, che erano sani.
> 📌 Effetto collaterale non dichiarato della patch: **l'intero file era stato
> riconvertito da LF a CRLF** (invisibile nel diff perché git normalizza). Riportato a LF.
>
> 📱 **MISURA SUL DEVICE (S23, `adb shell`, cpuset `/`, build NUOVA
> `build-android-opencl-s3fix`; `build-android-opencl-k2` intatta come riferimento):**
>
> 🧪 **CONTROLLO FATTO BENE, e la prima versione di questo blocco NON lo era.**
> Avevo confrontato il binario nuovo con `build-android-opencl-k2` (build del
> **12/08**): fra i due non c'è solo la patch, ci sono anche i commit intermedi —
> quindi quel confronto **non isolava la patch**. Rifatto compilando lo **stesso
> commit senza la patch** (`build-android-opencl-s3base`): unica variabile il file
> `cvt.cl`, **311 casi identici appaiati per nome del test**.
>
> | type_a | ERR baseline (stesso commit, NO patch) | **ERR con patch (A)** | Δ | n |
> |---|---|---|---|---|
> | q4_0 | 0.4080 | **0.1842** | **−54.9%** | 74 |
> | q4_1 | 0.4297 | **0.1907** | **−55.6%** | 73 |
> | mxfp4 | 0.3525 | **0.1654** | **−53.1%** | 74 |
> | q5_0 | 0.1161 | **0.0546** | −52.9% | 3 |
> | q5_1 | 0.0880 | **0.0479** | −45.6% | 3 |
> | **q4_K** *(non toccato — controllo)* | 0.8891 | 0.8879 | **−0.1%** | 80 |
> | **q5_K** *(non toccato — controllo)* | 0.9140 | 0.9362 | **+2.4%** | 4 |
> | q8_0 / q6_K | pass | **pass** | — | 75/75 · 3/3 |
>
> 📏 **RUMORE MISURATO, non stimato (18/08 22:45): stesso identico binario rilanciato
> due volte, 311 casi appaiati. `test-backend-ops` rigenera i dati a ogni run —
> **0 casi su 311 sono bit-identici**.**
>
> | quant | n casi | rumore sulla MEDIA | peggior caso SINGOLO |
> |---|---|---|---|
> | q4_0 / q4_1 / mxfp4 / q4_K | 73-80 | **0.1 – 1.3%** | fino a **172%** |
> | q5_0 / q5_1 / q5_K | 3-4 | **fino a ±14%** | 35% |
>
> ➡️ **Conseguenze, e una correzione a me stesso.** Avevo stimato il rumore a ±2-3%
> dai quant di controllo: **sovrastimato dove n è grande, sottostimato dove è piccolo.**
> - Su **q4_0/q4_1/mxfp4** il −55% è **~50× il rumore**: solidissimo. Anche il +19% di
>   peggioramento della variante no-alias su q4_0 è reale (190× il rumore di quel quant).
> - Su **q5_0/q5_1/q5_K le medie poggiano su 3-4 casi e ballano fino al 14%**: i loro
>   numeri vanno citati come indicativi, mai come misure.
> - **Nessun caso singolo è citabile** (fino al 172% di scostamento fra due run dello
>   stesso binario): si cita solo la media su n grande, mai una riga. ➡️ **Il dimezzamento
> è attribuito alla patch, non ai commit intermedi.**
>
> ➡️ **Quindi (A) era un difetto vero ed è ora chiuso — ma spiegava solo METÀ della
> corruzione.** Nessun caso passa: 0 su 311.
> ✅ **GATE, misurato e non dedotto — due terzi PASS, uno FAIL:**
> 1. ✅ **q8_0 e q6_K non regrediscono su MoE**: 75/75 e 3/3 in entrambe le build.
> 2. ✅ **Il denso resta identico**: `-o MUL_MAT` su entrambe le build dà **915 OK e
>    10 FAIL**, e l'insieme dei casi falliti è **lo stesso** (0 casi falliti solo in
>    una delle due). I 10 FAIL sono tutti `q6_K` denso — il kernel flat già noto come
>    rotto e già dichiarato non-regressione (K2.3 deprioritizzato), non un effetto
>    della patch.
> 3. ❌ **«q4_0 passa» NO**: 0 casi su 311 scendono sotto soglia, l'errore si dimezza
>    e basta.
>
> 🎯 **STATO: ESISTE UNA SECONDA CAUSA, ANCORA IGNOTA.** Colpisce tutti i quant
> stretti, risparmia q8_0 e q6_K, e si manifesta sia a `n=1` (GEMV) sia a `n=16/32`
> (GEMM). **Due ipotesi sono ora MORTE come spiegazione completa:** il load non
> allineato (fixato e misurato: metà) e il layout q4_K/q5_K (provato corretto).
> 🔎 Tre agenti in caccia su angoli disgiunti (data-path / dispatch host / sweep dei
> kernel di calcolo + classe del workaround `printf` Adreno).
> ⚠️ Sospetto già formalizzato e non ancora escluso: i kernel patchati replicano la
> matematica dei densi **senza** il `printf` che il commento di quelli dichiara
> obbligatorio; e il GEMM può usare il blob precompilato opaco
> `gemm_moe_q4_k_f32_ns_ila`, che un fix sorgente non tocca.
>
> 🌙 **NOTTE 18→19/08 — NOVE IPOTESI TESTATE SUL DEVICE, IL CONVERT È ESAURITO.**
> Ogni riga è una build compilata e misurata su S23 (in carica: irrilevante per ERR,
> vietato per tok/s), confronto appaiato per nome del caso contro
> `build-android-opencl-s3base` (stesso commit, senza patch).
>
> | # | esperimento | ERR q4_0 | esito |
> |---|---|---|---|
> | 0 | baseline (stesso commit, no patch) | 0.4080 | — |
> | 1 | **letture byte-wise** (fix allineamento) | **0.1842** | ✅ **tenuto: −55%** |
> | 2 | + `printf` di guardia Adreno | 0.4449 | ❌ peggiora |
> | 3 | shift/OR senza aliasing (`uint qw[4]`) | 0.2206 | ❌ peggiora |
> | 4 | riscrittura GLM (store byte-granulari diretti) | 0.1810 | ➖ invariato |
> | 5 | convert senza fast-math (`GGML_OPENCL_CVT_OPTS`) | 0.1888 | ➖ invariato |
> | 6 | convert `-cl-opt-disable` | — | ⛔ driver: `err=-6` out of host memory |
> | 7 | kernel MoE `-cl-opt-disable` | — | ⛔ 1 kernel non compila |
> | 8 | kernel MoE senza fast-math | 0.1809 | ➖ invariato |
> | 9 | allineamento immagini su subbuffer | — | ❌ **REFUTATA da misura** |
>
> 🔑 **Il fatto che ordina tutto: CINQUE forme diverse del convert danno tutte ~0.18.**
> Il difetto di allineamento (esperimento 1) era reale ed è chiuso; **il residuo non
> dipende più dal convert.** Le opzioni del compilatore non c'entrano né sui convert né
> sui consumer.
>
> ❌ **Ipotesi 9 (mia, elegante e sbagliata): i subbuffer non allineati per le immagini.**
> Il codice upstream porta il dubbio scritto — *"Does this create misaligned subbuffers
> (alignment is 1024) in certain cases ?"* — e `CL_DEVICE_IMAGE_BASE_ADDRESS_ALIGNMENT`
> non è **mai** interrogato, pur creando immagini 1D su subbuffer in 9 punti. Misurato sul
> device: **image align = 64 B contro mem align = 128 B**, quindi i subbuffer sono già
> conformi. Refutata in una query invece che in una notte.
>
> 🛠️ **Strumenti costruiti stanotte, che restano:** due hook a variabile d'ambiente
> (`GGML_OPENCL_CVT_OPTS`, `GGML_OPENCL_MOE_OPTS`) che ricompilano i program con opzioni
> diverse **senza rebuildare il binario**; e un ramo `GGML_OPENCL_HOST_REPACK` che
> costruisce i buffer SoA sulla **CPU**, bypassando il convert — è l'esperimento che
> separa produttore e consumatore in modo definitivo.
>
> ⚠️ **Limite di piattaforma incontrato:** opencode-go ha un tetto di utilizzo a 5 ore;
> DeepSeek/GLM/Kimi tornano disponibili dopo il reset. Grok è su un altro provider.
>
> 🧨 **19/08 09:20 — IL PARADOSSO È SCIOLTO, E RIBALTA LA LETTURA DEL −55%.
> I CONSUMER SONO ROTTI; IL CONVERT ERA IL DIFETTO PIÙ PICCOLO DEI DUE.**
>
> ⚠️ **CORREZIONE ALLA NARRAZIONE DEL COMMIT `9dc1ec0cb`: il −55% NON è «il convert
> riparato». Sono DUE difetti che si compensano a vicenda.** La corruzione del produttore
> compensa parzialmente quella del consumatore; togliendo solo la prima, il risultato
> peggiora. Il guadagno è reale, misurato e riproducibile — ma la spiegazione era sbagliata.
>
> 🔑 **L'esperimento che decide era già agli atti: `GGML_OPENCL_HOST_REPACK=1`** costruisce
> i buffer SoA **sulla CPU**, byte-exact per costruzione, senza alcun convert GPU nel
> percorso. **Fallisce comunque: q4_0 media 0.4497** (GEMV n=1 0.4440, GEMM 0.4508).
> ➡️ Con un produttore fuori dal gioco, l'errore resta: **il difetto vincolante è nei
> kernel di calcolo compilati**, in ENTRAMBI i path.
> 🎯 **La prova più netta sta dentro un singolo run** (hostrepack): q4_0 con buffer
> **perfetto** fallisce a **0.450**, mentre **q4_1 nello stesso run**, con buffer corrotto
> byte-wise e gli stessi identici consumer, fallisce a **0.189**.
>
> 📊 **L'errore end-to-end NON è monotono nella correttezza del buffer** — tre cluster netti:
>
> | buffer q4_0 | mismatch vs oracolo | ERR end-to-end |
> |---|---|---|
> | byte-wise (viola il contratto) | 46% dei word alti | **0.184-0.193** |
> | bitselect / host-repack (byte-exact) | **0%** | 0.438-0.450 |
> | originale `ushort8` non allineato | — | 0.408 |
> | nessun un-shuffle (copia diretta) | — | 0.444 |
>
> ✅ **Cosa è PROVATO (tre derivazioni indipendenti: DeepSeek, Grok, GLM, più la mia):**
> il contratto **`valore k → word ⌊k/8⌋, nibble k%8`**; GEMV e GEMM **concordano**; l'immagine
> `q_img` è creata sullo **stesso `cl_mem`** del buffer; i blob precompilati sono **compilati
> fuori**; il layout CPU (`qs[j]` → valore `j` basso, `j+16` alto); **il reference host è
> corretto e non va toccato**; q6_K 3/3 e q8_0 75/75 passano in ogni run.
> 🔍 **Cosa resta INFERITO:** il trigger `x0 ≥ 0x80` con shift aritmetico (regge su 16/16
> byte e sul 46.1%); la natura cross-lane del difetto consumer.
>
> 🧭 **ORDINE DEGLI ESPERIMENTI RACCOMANDATO (una variabile per volta):**
> 1. **Oracolo LATO CONSUMER — è lo strumento che manca.** Un kernel di debug che legge
>    `extra->q` secondo il contratto e scrive i float dequantizzati usando **verbatim** la
>    macro `dequantize_q4_0` e l'helper `q4_0_to_fp32_packed8`; confronto host contro
>    `dequantize_row_q4_0`. Con `HOST_REPACK=1` prova l'idioma del consumer su input
>    noto-buono, **scollegato da dispatch, riduzioni subgroup e router**.
> 2. Riscrivere la macro `dequantize_q4_0` del GEMM (e l'helper GEMV) a **shift-poi-maschera**
>    con `HOST_REPACK=1` + bitselect. Se l'oracolo passa ma l'end-to-end no, il difetto è
>    nella riduzione o nel path di `dst`.
> 3. Isolare **GEMV n=1** (12 casi, niente router) con host-repack: il check end-to-end
>    più pulito.
> 4. Solo allora riattivare il convert GPU e rifare l'intero set, tenendo q6_K, q8_0 e il
>    denso come controlli di regressione e la disciplina di `compare_runs.py`.
>
> 📌 **Stato dell'albero:** committato `9dc1ec0cb` (llama.cpp) con la variante byte-wise —
> la migliore misurata — più i tre hook diagnostici. Le varianti bitselect / copia-diretta /
> printf **non** sono nell'albero: vivono solo nel registro qui sopra.
>
> ✅ **JELLY — SESSIONI LUNGHE RIPRISTINATE (19/08 09:16). NIENTE ERA STATO PERSO DA GIT.**
> L'archeologia (DeepSeek) dimostra che **nessun meccanismo è mai stato rimosso**: heartbeat,
> pulse nei cooldown e watchdog con rilancio furono **aggiunti** il 17-18/08 per i drop-sweep
> e **mai portati** negli orchestratori KEXP/REAP/TTFT, che sono ancora `ssh` sincrono per
> cella, senza detach né resume. Quello che l'owner ricordava funzionava **lì**.
> 🔑 **La tecnologia che mancava:** sugli altri due telefoni lo schermo si tiene acceso **via
> adb**; da Termux la stessa chiamata è **rifiutata** (`INTERACT_ACROSS_USERS`, documentato in
> `results/dropsweep_jelly/REPORT.md:113`). Sul Jelly non era mai stata applicata perché ci
> si arriva via ssh — **ma il Jelly è collegato in adb** (`JELLYS0000053795`).
> **Applicato:** `settings put system screen_off_timeout 7200000` (era 1800000),
> `svc power stayon true`, `input keyevent KEYCODE_WAKEUP` → `mWakefulness=Awake`.
> **Misura:** heartbeat staccato (`setsid nohup`, battito ogni 15 s) **vivo a 26 min 53 s**
> e ancora in corso, contro i ~20 min oltre i quali finora moriva. ⚠️ Prova preliminare: la
> conferma piena è ≥60 min. ⚠️ Il Jelly era **in carica** (88%): buono per un test di
> sopravvivenza, **inutilizzabile per tok/s**.
>
> 🌅 **MATTINA 19/08 — IL CONTRATTO È CONFERMATO DA DUE DERIVAZIONI INDIPENDENTI,
> E IL GUADAGNO STABILE È −55%.**
>
> | quant | baseline (stesso commit, no patch) | **con la patch** | Δ | n |
> |---|---|---|---|---|
> | q4_0 | 0.4080 | **0.1857** | **−54.5%** | 74 |
> | q4_1 | 0.4297 | **0.1885** | **−56.1%** | 73 |
> | mxfp4 | 0.3525 | **0.1671** | **−52.6%** | 74 |
> | q5_0 / q5_1 | 0.1161 / 0.0880 | 0.0568 / 0.0532 | −51% / −40% | 3+3 |
> | **q4_K / q5_K** *(non toccati — controllo)* | 0.8891 / 0.9140 | 0.9002 / 0.9133 | **+1.2% / −0.1%** | 80+4 |
>
> ✅ **CONTRATTO DI LAYOUT: CONFERMATO.** Due derivazioni indipendenti (DeepSeek e Grok)
> più la mia, tutte dai **consumer** e non dai commenti, concordano: **valore `k` sta nel
> word `k/8`, nibble `k%8`**; `qs[j]` della CPU porta il valore `j` nel nibble basso e
> `j+16` nell'alto; GEMV e GEMM **vogliono lo stesso layout** (il GEMM legge un'immagine
> che aliasa lo stesso buffer). ➡️ Il mio reference host è corretto e **non va toccato**:
> è l'oracolo con cui si giudica ogni esperimento.
>
> 🔬 **MECCANISMO DEL DIFETTO, misurato:** la corruzione avviene **se e solo se il byte
> sorgente è ≥ 0x80** (16 casi su 16), con firma `got = want | 0xF0`. Il compilatore
> esegue uno shift **aritmetico** su un valore mascherato il cui bit 7 è settato, e il
> segno smaglia il nibble adiacente. Una maschera successiva **non salva**: viene rimossa
> come codice morto, perché l'analisi known-bits assume lo shift logico che il bug viola.
> 📌 È lo stesso pattern che distingue i kernel che passano da quelli che falliscono:
> `q6_K` (3/3 OK) usa **shift-poi-maschera**, i quant rotti usavano **maschera-poi-shift**.
>
> ❓ **PARADOSSO ANCORA APERTO, da non nascondere.** Una variante `bitselect` produce un
> buffer **byte per byte identico al reference** (`BUFFER MATCHES HOST REFERENCE`,
> `low wrong=0 | high wrong=0`) e **peggiora** l'end-to-end (0.4378 contro 0.4080 di
> baseline). Con un produttore verificato corretto il risultato peggiora: il buffer non
> può essere l'unica cosa che conta. Ipotesi in coda: **coerenza di memoria** — il
> readback lo fa l'host con `clEnqueueReadBuffer`, il consumer legge un'**immagine**
> costruita sul buffer, e le scritture `vstore4` potrebbero non essere visibili per quel
> percorso. ⚠️ Finché non è spiegato, `bitselect` **non si spedisce**.
>
> 🔻 **Ipotesi morte, tutte con misura:** load non allineato (era vero, −55%, tenuto) ·
> layout q4_K (era già giusto) · `printf` Adreno (peggiora) · aliasing scalare (peggiora) ·
> riscrittura a store byte-granulari (invariata) · opzioni del compilatore su convert e su
> consumer (invariate) · allineamento immagini (image align 64 B < mem align 128 B) ·
> `bitselect` (buffer corretto ma e2e peggiore) · shift-poi-maschera nei consumer
> (ininfluente: q4_0 con consumer fixato misura come q4_1 senza).
>
> 🎯 **Gate:** q8_0 75/75 e q6_K 3/3 **non regrediscono**; il denso resta **915 OK / 10
> FAIL identici**. ❌ Nessun quant scende sotto 5e-4: l'errore si dimezza, non sparisce.
>
> 🔧 Si lavora su **`kalsa/kernel-s3-repack`**, che discende già da
> `opencl-q6k-dispatch-fix` (merge-base 04c5d362a, zero commit esclusivi): la fix
> nuova si impila sulla vecchia, niente due patch parallele — requisito di gualt.
>
> ➡️ **PRIMO PASSO (non è codice):** (a) verificare la copertura op Hexagon per
> l'architettura LFM2.5; (b) produrre il GGUF misto coi soli densi in Q4_0;
> (c) **misurare noi il numero che manca al mondo** — prefill HTP vs CPU vs GPU
> sullo stesso telefono. Se l'NPU non batte la GPU che già abbiamo a 3.2-7×, la
> pista si chiude con una cifra nostra invece che con un'assenza.
> ✅ **Decode invariato: GPU 0.66× (17.5 contro 26.5), gate FAIL.** Stessa
> conclusione qualitativa di prima, con entrambi i lati più veloci del
> report storico.
>
> 🧪 **BRACCIO RANDOM — CODICE PRONTO E RIVISTO (18/08). Grok implementa,
> DeepSeek attacca, io verifico.**
>
> `--drop-policy {cold|weight|random}` + `--drop-seed`, build isolata in
> `build-pc-droppolicy/`. **Binario pinnato verificato intatto da me:**
> sha `7722cb23…d75d52` = `expected_binary_sha256`, mtime ancora 14/08.
>
> ✅ **Il controllo regge:** `cold` è **bit-identico** al codice precedente
> (verificato da me sul diff — è la stessa espressione spostata nel ramo
> `else` — e dal revisore anche empiricamente). Tutti i miei sospetti
> REFUTATI con prove: `kept` del ramo random equivalente (legge `drop_w_`
> pre-drop, array diverso da quello scritto), `drop_res_` stantio **senza
> lettori** sotto Weight, RNG con **un solo** chiamante (niente re-seed a
> metà run), Fisher-Yates uniforme e senza OOB, **conteggio random ==
> conteggio cold verificato su 60.000 casi**.
>
> 🌿 **BRANCH SBAGLIATO — la causa vera del fallimento del primo tentativo
> (18/08). E una mia affermazione allarmista, ritirata.**
>
> Il primo braccio è morto in 11 s con `unknown arg: --no-moe-fused-gemv`,
> che l'harness passa via `--stock-kernel`. Indagando avevo detto a gualt
> che *"l'albero che ha prodotto il binario pinnato non è ricostruibile"*.
> **FALSO, e l'errore è mio: stavo guardando solo `main`.**
>
> **Provenienza del binario PC di campagna, ricostruita:**
> - `build-pc-mellum-ppl/cli/bmoe-cli.exe` sha `7722cb23…`, mtime
>   **14/08 01:58** (`reports/moe-mellum2-f1-s23.md:532`: *"mellum recipe +
>   fused flags forced OFF"*).
> - I flag `--moe-fused-gemv` / `--moe-fused-ffn` nascono in `93d78ab` e
>   `0c54a27`, **13/08 19:01 e 19:59** — cioè poche ore prima della build.
> - Stanno su **`kalsa/kernel-s1-expert-pack`** e
>   **`kalsa/kernel-s2-layer-fuse`**, entrambi con ANCHE la ricetta mellum.
> - **`kalsa/kernel-s2-layer-fuse` = `main` + 3 commit** (`main..s2` = 3,
>   `s2..main` = **0**: main è suo antenato).
> ➡️ **Il binario di campagna viene da `kalsa/kernel-s2-layer-fuse`.**
>
> ❌ **Grok ha applicato `--drop-policy` su `main`**, che è indietro di 3
> commit e non ha i kernel fusi. Da lì il rifiuto del flag.
> ✅ **Rimedio: riapplicare la patch su `kalsa/kernel-s2-layer-fuse` e
> ricompilare.** Così `cold` torna a essere un controllo vero, sulla
> stessa linea del binario di campagna e con gli stessi flag.
>
> 📌 **Nota di metodo, per non ripeterla:** `strings` sull'exe restituisce
> **zero righe** (non estrae dal PE) e mi aveva dato un falso negativo che
> ho quasi usato come prova. Il test valido è stato lanciare il binario
> con il flag e con un flag inventato: accetta il primo, rifiuta il
> secondo. **Verificare lo strumento prima di credere al suo silenzio.**
>
> 🚨 **F1 [CONFERMATO, sev 2] — VINCOLO CHE CAMBIA IL DISEGNO:** nel
> changeset è finito anche uno spostamento del submodule `llama.cpp`
> (`e5605f3` → `8d3c2ea`: due commit di matmul CPU, **lo strato che decide
> gli arrotondamenti**). Codice bit-identico ≠ output bit-identico.
> ➡️ **I numeri di `build-pc-droppolicy` NON sono confrontabili con quelli
> del binario pinnato.** L'esperimento dev'essere autosufficiente: il
> braccio `cold` va girato NEL BINARIO NUOVO come controllo, e **non si
> confronta mai con la curva esistente** (0.6780748 ecc.).
>
> ⚠️ **F2 [plausibile, sev 2]:** `settle_spec()` gira anche sotto Weight,
> quindi quel braccio non azzera tutta la tassa. Il revisore è però equo:
> `query_residency` — la scansione per-slot, la parte dominante — **è
> rimossa davvero**, e `settle_spec` gira in ENTRAMBI i bracci, quindi il
> delta cold-vs-weight isola comunque la query. **Vincolo di scrittura:
> non si potrà dire "la query è il 100% della tassa".**
> 📌 **F3 [sev 4]:** `std::uniform_int_distribution` non è portabile fra
> toolchain — stesso seed su PC e su Android può dare esperti diversi.
> Irrilevante finché si confronta dentro una sola piattaforma; da dire se
> un giorno si riproduce su device un run del PC.
>
> 📊 **DROP-POLICY QUALITY — DUE BRACCI SU QUATTRO CHIUSI (18/08, Marco-Mini
> KEXP, k=6, cache 2000, ppl decode multi5).**
>
> 🏷️ **RISULTATO PRE-REGISTRATO CENTRATO: `cold` ≪ `random`. LA QUERY DI
> RESIDENCY COMPRA QUALITÀ, NON È SOLO COSTO.**
>
> ⚠️ **CORREZIONE DI PROVENIENZA (mia, importante).** Avevo scritto qui e
> detto a gualt che questa cella gira su `build-pc-droppolicy-s2` sha
> `262701dc32a96254` con `--stock-kernel`. **Falso.** I tre `*_multi5.json`
> registrano tutti `build-pc-droppolicy` sha **`59f2762e54ed56af`** (la build
> da `main`) e **nessun** flag `--no-moe-fused-*`. Motivo: l'orchestratore è
> partito alle **08:29:51**, il binario s2 è stato compilato alle **08:52** —
> PowerShell aveva già letto la versione precedente dello script. ✅ **La
> cella resta valida per la sua domanda**: i tre bracci condividono binario,
> flag e modello. ❌ Non è confrontabile con la campagna né con Mellum2/
> CalaQwen. *Lezione: il binario vero si legge dal JSON del run, non dallo
> script — lo script può essere cambiato dopo il lancio.*
>
> ✅ **COMPLETO SU 5 LINGUE (18/08 17:01).** `dp_rand_d10` era morto a 3/5
> (`bmoe: pread failed at 5783089152` durante `it`, rc=1) trascinandosi dietro
> l'orchestratore; `it`/`zh` sono stati rifatti in una cella separata
> (`dp_rand_d10_itzh`, `--langs it,zh`, stesso binario `59f2762e54ed56af`,
> rc=0) perché l'harness non ha resume per-lingua. Le due metà si uniscono:
> ogni lingua è una misura indipendente sullo stesso binario e modello.
>
> | lingua | d0 | cold d=1.0 | random d=1.0 | cold vs d0 | random vs d0 |
> |---|---|---|---|---|---|
> | en | 0.640213 | 0.706213 | 0.745753 | +10.31% | +16.49% |
> | es | 0.705789 | 0.782259 | 0.837969 | +10.83% | +18.73% |
> | fr | 0.756660 | 0.861962 | 0.922563 | +13.92% | +21.93% |
> | it | 0.785352 | 0.879999 | 0.954762 | +12.05% | +21.57% |
> | zh | 0.944656 | 1.077903 | 1.128981 | +14.11% | +19.51% |
> | **MACRO** | **0.766534** | **0.861667** | **0.918006** | **+12.41%** | **+19.76%** |
>
> ➡️ **`random` è peggiore di `cold` di +6.54% bpb (+0.0563 bpb)** — un delta
> che da solo **supera l'intero gate MACRO_PASS di 0.04**. Concorde in **tutte
> e cinque** le lingue. 📌 L'anticipazione fatta sulle prime 3 lingue diceva
> +6.63%: la stima parziale ha retto a 0.1 punti.
> La lettura era dichiarata prima dei numeri: *«cold ≪ random → "scegliere i
> freddi" è un risultato vero da nominare»*. È il ramo che è uscito.
> **Conseguenza: la condizione (b), la query di residency, NON è pura tassa da
> rimuovere sull'asse velocità** — a parità di quanti esperti cadono, sceglie
> molto meglio QUALI. Chi proponeva di eliminarla per recuperare il compute
> della tassa d'armamento stava proponendo di pagare 6.5% di qualità.
>
> | arm | macro bpb (5 lingue) | Δ vs dp_d0 | slot droppati |
> |---|---|---|---|
> | `dp_d0` (macchinario spento) | 0.766534 | — | 0 |
> | `dp_cold_d10` (regola di oggi, d=1.0) | 0.861667 | **+0.0951 / +12.41%** | **32.6%** |
> | `dp_rand_d10` (+ `_itzh`) | 0.918006 | **+0.1515 / +19.76%** | **28.6%** |
> | `dp_weight_d10` | **1.317696** | **+0.5512 / +71.90%** | **61.9%** |
>
> ✅ **CELLA CHIUSA A 4 BRACCI (18/08 18:43 — `OK dp_weight_d10
> macro_bpb=1.31769604986121`, tutte e 5 le lingue rc=0).** Binario, modello,
> thread, ctx, ubatch, cache e `--n-expert-used` sono **identici in tutte e cinque
> le celle**, verificati dai JSON dei run e non dagli script: `59f2762e54ed56af` /
> `2f92195854011538`. L'unica variabile è `--drop-policy`.
>
> 🔴 **RITIRATO — «weight droppa il 63.4% degli slot contro il 46.9% di `cold`».
> IL 46.9% NON ERA MISURATO E NON ESISTE IN NESSUN DATO DEL REPO.** Quei due numeri
> comparivano **solo** in questa riga del PLAN e nella sua copia in
> `docs/ALIVE.md:232`, con la parola «misurato». **Non potevano esserlo:** il path
> `--ppl-decode` stampa unicamente `BMOE_PPL {n_tokens,n_scored,sum_logprob,ppl,
> seconds}` e **nessun** contatore di drop, e gli `harness.err.log` della cella sono
> **0 byte**. Stessa classe dell'errore già a verbale sul commento circolare in
> `run_droppolicy_quality.ps1:44`: una cifra nata in prosa e poi citata come dato.
>
> ✅ **MISURATO ORA (18/08 19:00, `results/droppolicy_quality_marco/droprate/`).**
> Stesso binario `59f2762e54ed56af`, stessa config della cella, 300 token generati,
> una run per policy; il path di generazione stampa
> `moe-drop: N/M routed experts dropped (X%)` (`cli/main.cpp:1079`):
>
> | policy | slot droppati / instradati | frazione |
> |---|---|---|
> | `cold` | 16427 / 50400 | **32.6%** |
> | `weight` | 31217 / 50400 | **61.9%** |
> | `random` | 14395 / 50400 | **28.6%** |
>
> ➡️ **Il rapporto vero è 1.90×, non 1.35×: `weight` droppa quasi il DOPPIO di
> `cold`.** Il 61.9% conferma il vecchio 63.4%; **è il 46.9% attribuito a `cold` a
> essere falso** — il valore reale, 32.6%, è coerente con l'unica altra misura
> indipendente nel repo (`dropsweep_jelly`: `experts_routed=33600
> experts_dropped=9986` → **29.7%**), che il PLAN stesso cita altrove.
> ⚠️ **Workload dichiarato: generazione, non `--ppl-decode`** — gli assoluti non sono
> quelli della cella di qualità; ciò che serve è il **rapporto fra policy a parità di
> setup**, ed è quello misurato.
>
> ➡️ **Conseguenza sulla lettura di `weight`: il suo +71.90% NON dimostra che la query
> di residency batte la soglia di peso.** Ha corso con un handicap quasi doppio. E dal
> codice le due regole non sono alternative ma **inclusive** (`router_hook.cpp:300-306`):
> con `thr = drop_frac/nu` = **1/6**, `weight` droppa ogni non-best sotto soglia, `cold`
> **solo il sottoinsieme** di quelli che sono anche non residenti. **Weight ⊇ Cold per
> costruzione**, quindi un confronto like-for-like fra i due **non è ottenibile a parità
> di `d`**. L'unico confronto a conteggio confrontabile resta **cold-vs-random**, ed è
> quello su cui poggia il risultato della cella.
>
> 🔍 **Anche `random` è like-for-like solo PER-TOKEN, non a run intera.** Il codice pesca
> esattamente `n_cold` slot (`router_hook.cpp:268-274`), ma misurato dà **28.6% contro il
> 32.6% di `cold`**: appena le due run divergono generano testo diverso e riempiono la
> cache in modo diverso, quindi `route_miss` — e con esso `n_cold` — diverge. L'identità
> di conteggio vale **all'istante della decisione**, non sull'aggregato. Non tocca il
> +6.54% (in `--ppl-decode` il testo è imposto dal corpus e non può divergere), ma la
> frase «stesso conteggio» **va detta per-token**, mai come proprietà della cella.
>
> 🚢 **DECISIONE OWNER (18/08, a chiusura cella): SI SPEDISCE `cold`; IL LIVELLO È
> PER-MODELLO. Tre assi da non fondere in una regola sola:**
> 1. **Quale policy → `cold`, e non dipende da nulla.** Batte `random` in **5 lingue su
>    5**; `weight` e `random` esistono solo come strumenti diagnostici, non come config.
> 2. **Quanto droppare → per-modello, sulla QUALITÀ.** Marco a d=1.0 costa **+12.41%** e
>    spedisce quindi **d=0.0**; CalaQwen costa **+3.96%** e spedisce **d=1.0 +
>    `--drop-no-renorm`**. Stesso flag, stesso livello, verdetto opposto.
> 3. ⚠️ **La CONVENIENZA in velocità dipende invece da device e RAM, e resta vero.**
>    Sul Jelly a cache 4000 il drop **fa danno** (+15%) mentre a 1500/2000 rende −25%;
>    sull'S23 non si ribalta mai (−2/−6%). **L'ipotesi «dipende dal modello e non da
>    RAM/processore» è corretta sulla qualità e smentita sulla velocità**: sono due assi
>    distinti e vanno citati separatamente.
>
> 🔧 **CORREZIONE MIA, DA METTERE A VERBALE.** Avevo scritto a gualt che quel
> +12.41% «riproduce esattamente il valore di campagna di Marco a d=1.0 con
> renorm». **Falso: quella corroborazione non esiste nei dati.** L'unica fonte
> del +12.41% pre-esistente è un commento di intestazione che ho scritto io in
> `scripts/run_droppolicy_quality.ps1:44` — citarlo come conferma era
> circolare. In `results/` **non c'è nessuna misura Marco k6 d=1.0** anteriore
> a questa cella. Da correggere anche quel commento (a cella finita: il file
> è in esecuzione).
>
> ✅ **Ciò che regge davvero:** i due numeri sopra sono misurati nella STESSA
> cella sullo STESSO binario, quindi il +12.41% è valido come sta. E la
> premessa di disegno («Marco è dove il drop morde di più») è confermata dai
> dati nuovi, non da una misura precedente: le altre due curve di campagna a
> d=1.0 costano molto meno — **Mellum2 +5.09%** (1.0073390 → 1.0586322,
> `results/mellum2_dropcurve/curve.csv`) e **CalaQwen +3.96%** (0.6780748 →
> 0.7049320). ⚠️ E ricordare che **Mellum2 ≠ Marco**: è il termometro PPL del
> PC (`docs/NAMING.md:31`), un modello diverso — la curva `mellum2_dropcurve`
> non è la curva di Marco.
>
> 🔥 **CACHE × DROP — LA SCOPERTA CHE RIMETTE IN DISCUSSIONE IL DEFAULT
> APPENA DECISO (18/08, round 1 di 3, Marco-Mini su Jelly).**
>
> 📈 **CURVA A TRE PUNTI (Marco-Mini, 3 round per cella, tutte complete) —
> E IL MIGLIOR NUMERO IN ASSOLUTO NON CONTIENE IL DROP.**
>
> | cache | hit a d=0 | **d=0.0** | col drop | vantaggio drop |
> |---|---|---|---|---|
> | 1500 | 39.5% | 0.189-0.194 | 0.142-0.145 | **−25%** |
> | 2000 | 50.2% | 0.163-0.171 | 0.123-0.127 | **−25%** |
> | 4000 | 76.8% | **0.113-0.116** | 0.130-0.131 | **+15%** |
>
> 🏆 **Il minimo assoluto è `0.113` — cache 4000 SENZA drop.** Batte cache
> 2000 col drop (0.124) del 9%, **e costa ZERO qualità** invece del +5.71%
> che il drop costa su Marco. Cioè: **dargli RAM è meglio che togliergli
> esperti**, dove la RAM c'è.
> Il drop resta la leva giusta **solo dove la RAM non c'è** — ed è
> esattamente il segmento in cui sta LFM2.5 (3.3 GB).
>
> ⚠️ **Artefatto ricorrente da mettere a verbale: il braccio col drop ha
> run sporadiche col compute gonfiato**, quello senza drop no. Due casi su
> nove: c4000 r1 (compute 0.194 contro 0.117 delle altre due) e c1500 r3
> (0.143 contro 0.116). Il baseline d=0.0 è invece stabile in tutte e tre
> le celle. **Conseguenza: le medie del braccio drop sono meno affidabili
> di quelle del baseline**, e vanno lette per mediana con i round mostrati
> uno per uno, non aggregate.
>
> **CELLA CACHE 4000, COMPLETA 3/3.**
>
> | | cache 2000 (sempre usata) | **cache 4000** |
> |---|---|---|
> | d=0.0 — s/tok | 0.166 | **0.113 (−32%)** |
> | d=0.0 — hit | 50.2% | **76.8%** |
> | d=0.0 — byte letti | 11803 MiB | **3366 MiB (−71%)** |
> | **d=1.0+nr vs d=0.0** | **−24.9% (più veloce)** | **+15% (più LENTO)** |
>
> ⚠️ **CORREZIONE DI UN MIO NUMERO: il "+87%" era un OUTLIER, non il
> risultato.** Round per round: r1 +87%, **r2 +16%, r3 +15%**. r2 e r3
> coincidono (0.131 / 0.130) e girano a 29-32 °C; r1 girò a 34 °C col
> compute gonfiato (0.194 contro 0.117) ed era la prima run dopo il
> riavvio dell'harness. **Il valore onesto è +15%.** Avevo scritto a gualt
> "un +87% non è rumore": era troppo sicuro su un round singolo, ed è
> esattamente l'errore contro cui esiste il disegno a 3 round.
> **La conclusione qualitativa NON cambia** — a cache 4000 il drop fa
> danno — ma l'oscillazione da −24.9% a +15% è di ~40 punti, non di 110.
>
> **Due risultati, e il secondo ribalta una decisione presa oggi.**
>
> 1. **Alzare la cache da 2000 a 4000 dà −32% di tempo A QUALITÀ IDENTICA.**
>    Non tocca nessun esperto, non cambia un token di output: tiene in RAM
>    ciò che prima rileggeva dalla flash.
>
>    🔧 **CORREZIONE: avevo scritto "non l'avevamo mai guardato". FALSO, e
>    la fonte è dentro il nostro engine.** `BigMoeOnEdge/docs/cache-sizing.md`
>    apre con *«The expert cache budget (`--cache-mb`) is the **dominant
>    throughput lever**»* ed esiste già **`--cache-mb auto`**, che la
>    dimensiona sulla RAM del device una volta al load
>    (`available RAM − cache_floor_mb`, clampata). Quel documento descrive
>    anche una **scogliera misurata il 2026-07-20**: sotto il ciclo di un
>    token l'hit rate non degrada, **va esattamente a 0.0%** — perché la LRU
>    globale sfratta proprio ciò che sta per rileggere.
>    **Quello che è nuovo NON è la leva cache: è la sua INTERAZIONE col
>    drop** — che al variare della cache il drop cambi *segno*. Di questo
>    in `cache-sizing.md` non c'è traccia. Rivendicare il resto sarebbe
>    riscoprire il lavoro di qualcun altro e chiamarlo mio.
>
>    ⚠️ **E una trappola operativa, dal documento stesso:** il pavimento
>    `cache_min_mb = 1500` **non è calcolato sul modello** — è generico. La
>    quantità vera è `token_demand_MiB` (il ciclo di un token), stampato in
>    ogni riga di summary: **Marco = 136.8 MiB**, CalaQwen = 334.5. Quindi
>    per Marco 1500 ha 11× di margine, ma per un modello con k più alto il
>    pavimento può stare SOTTO il ciclo e la protezione smette di
>    proteggere in silenzio. *Quando si sceglie una cache a mano, si
>    confronta con `token_demand_MiB`, non con `cache_min_mb`.*
> 2. **A cache 4000 il drop diventa DANNOSO, non solo inutile: +87%.** La
>    mia predizione dichiarata era "il vantaggio si restringe". **Non si è
>    ristretto: si è invertito.** È il meccanismo di stanotte al suo
>    estremo — con hit al 76.8% non stai più aspettando il disco, quindi la
>    tassa fissa di compute del drop non ha più nulla da ripagare.
>
> ⚠️ **Conseguenza diretta: il default B deciso oggi è l'ottimo a cache
> 2000, e la cache non è una costante di natura — è un budget di RAM.**
> Va rifatto su CalaQwen prima di considerare chiusa la decisione.
>
> ❓ **QUESTIONE APERTA SULLE CELLE S23 (18/08 pomeriggio): SU QUALI CORE
> HANNO GIRATO? NON LO SAPPIAMO, E IL CSV NON PUÒ DIRLO.**
> `run_dropsweep_jelly.sh` non scriveva `nproc`/`affinity_mask` (gate F4.3-bis
> assente: vedi il fix di oggi). Quindi la domanda è **indecidibile a
> posteriori** su queste tre celle.
> ⚠️ **DUE MIE CONCLUSIONI RITIRATE, STESSO IDENTICO ERRORE DUE VOLTE:**
> (1) ho sondato una shell ssh **idle** e concluso sul processo misurato;
> (2) ho sondato col telefono in **`mWakefulness=Dozing`** (schermo spento) e
> concluso sulle celle, che per protocollo di campagna girano **screen-ON**
> (deciso da gualt il 2026-08-13, a verbale più in basso). Entrambe le volte
> ho misurato una condizione e concluso su un'altra. È la stessa trappola del
> **"flagship dimezzato" dello Xiaomi**, che era Doze e non throttle.
> 📌 Fatto misurato che resta valido: col telefono in Doze i processi Termux
> stanno su **tre cpuset diversi contemporaneamente** — `/` (adj −1000),
> `/background` (adj 995), `/moderate` (adj 200, `Cpus_allowed_list 0-2`).
> Il cpuset è **per-processo e per-stato**, non una proprietà dell'app: per
> questo l'unica lettura che conta è quella sul **PID del binario mentre
> gira**, ed è esattamente ciò che la covariata nuova registra.
> 📌 Misurato anche: `termux-wake-lock` **non** promuove il cpuset (sonda in
> tre tempi, sempre `/moderate`) — ma in Doze, quindi non dice nulla sul caso
> screen-on. Conseguenza operativa comunque valida: **il wait-and-retry del
> gate è tempo morto**, la scatola non si apre aspettando.
> ➡️ **Come si chiude:** riaccendere lo schermo nella postura di campagna e
> risondare; e comunque **rifare le tre celle con l'harness nuovo**, che
> scrive la covariata. Stessa verifica sul Jelly appena torna: **stesso
> harness, stesso buco**, e su quelle celle poggia il default spedito.
>
> ✅ **SONDA JELLY FATTA (18/08 22:40, Jelly riacceso, `u0_a225@192.168.1.82:8022`).
> IL JELLY NON HA IL PROBLEMA: `/top-app`, `Cpus_allowed_list 0-7`, `nproc=8`.**
> Sondato **come va sondato** — non sulla shell idle (errore commesso due volte), ma
> sul PID di un processo che **brucia CPU davvero** (`yes > /dev/null`, letto dopo 3 s):
> ```
> shell   : /top-app   Cpus_allowed_list 0-7   nproc=8
> worker  : /top-app   Cpus_allowed_list 0-7
> ```
> ➡️ **Le celle Jelly — quelle su cui poggia il default spedito — NON sono contaminate
> dal cpuset ristretto.** Il rischio che il PLAN teneva aperto su di esse si chiude.
> 🔍 **E spiega l'anomalia S23-vs-Jelly:** su S23 le sessioni Termux stanno in
> `/moderate` (0-2, tre A510), sul Jelly in `/top-app` (0-7). Non è una differenza di
> silicio ma di ROM/OEM — ed è coerente col compute misurato, S23 **0.186 s/tok**
> contro Jelly **0.117** sullo stesso modello: un 8 Gen 2 che perde contro un G99 è
> impossibile a parità di core, normale se ne usa tre piccoli.
> ⚠️ **Limiti dichiarati:** (a) `dumpsys power` non è accessibile da Termux, quindi
> `mWakefulness` non è verificabile per questa via — ma un processo classificato
> `/top-app` implica Termux in foreground, cioè la postura di campagna; (b) è una
> sonda di **oggi**, non una covariata registrata **allora**: assolve il Jelly come
> piattaforma, non certifica retroattivamente le righe di quelle celle. Per quelle
> serve comunque il rerun con l'harness che scrive `nproc`/`affinity_mask`.
> 📌 **Conseguenza operativa per l'S23: i bench si lanciano da `adb shell`** (cpuset `/`,
> 0-7), mai da Termux — già a verbale, e ora con la controprova sul telefono buono.
>
> 🚨 **REPLICA SU S23 (18/08): IL MECCANISMO REPLICA, LA CONSEGUENZA NO.
> LA "REGOLA" QUI SOTTO È SPECIFICA DEL JELLY — non spedirla come regola.**
>
> Stesso binario (copiato dal Jelly, sha `77a94640…` verificato sul device),
> stesso modello (`2f92195854011538`), stessa cella, 3 round:
>
> | cache | Jelly (G99) | **S23 (SD 8 Gen 2)** |
> |---|---|---|
> | 1500 | **−25%** | ≈ **−5%** |
> | 2000 | **−25%** | ≈ **−2%** |
> | 4000 | **+15% (fa danno)** | ≈ **−4% (aiuta ancora)** |
>
> ✅ **Ciò che è device-independent:** hit rate a d=0 **identici** (39.5 /
> 50.2 / 76.8%) e byte e conteggi di drop coincidenti **al decimo di MiB**.
> Il meccanismo — il drop può scartare solo i cache miss, più cache = meno
> da scartare — vale su entrambi i silici.
> ❌ **Ciò che NON lo è: la conseguenza sul tempo.** Sull'S23 il drop non
> raggiunge mai il −25% e **non si ribalta mai**: resta fra −2% e −6% a
> tutte e tre le cache. Il "cache 4000 senza drop è l'ottimo" è vero sul
> Jelly e **falso sull'S23**.
> ➡️ **Quindi la scelta drop/cache va decisa PER DEVICE, e la
> generalizzazione che stavo scrivendo era prematura.** È esattamente
> perché la replica si fa prima di spedire una regola, non dopo.
>
> 🎯 **La lettura che RESTA valida** (punto di gualt, 18/08): 4 GB di cache
> si possono forse concedere su un telefono da 8 GB, ma **su uno da 6 GB
> non esistono** — Android ne trattiene una fetta e le altre app competono.
> Il vincolo di RAM è reale; è la resa in velocità a non essere universale:
>
> **più RAM → cache grande → hit alto → il drop fa danno →
> meno RAM → cache piccola → hit basso → il drop paga, e molto.**
>
> Cioè la config giusta **dipende dal telefono**, non solo dal modello: sono
> lo stesso parametro visto da due lati, perché entrambi decidono quanta
> parte del modello sta in RAM. **E per il segmento 6 GB la risposta non è
> tarare le manopole di un modello da 6 GB: è LFM2.5-8B-A1B (3.3 GB)** —
> che è esattamente perché sta in lineup.
>
> 🔧 **CORREZIONE MIA:** avevo liquidato lo sweep LFM2.5 come "inutile, lì
> il drop non paga mai (hit 93.5%)". **Sbagliato: quel 93.5% è a cache
> 2000.** A cache 1000 — la condizione reale di un 6 GB — l'hit scende e il
> drop può tornare a pagare. È il modello E la condizione che contano per
> quel segmento. Rimesso in coda.
>
> 🚢 **DECISIONE OWNER 2026-08-18 — SI SPEDISCE LA CANDIDATA. `drop 0.65`
> È RITIRATO.**
>
> **Nuovo default CalaQwen:**
> `-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap
> --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 1.0
> --drop-no-renorm`
>
> Motivo in una riga: **lo 0.65 era dominato** — costava qualità *e* tempo,
> ed è risultato più lento di non droppare affatto in tutti e tre i round.
> L'unico punto che compra velocità è d=1.0, e `--drop-no-renorm` ne toglie
> il 70% del costo di qualità senza cambiare né i byte né la velocità.
> **Contro l'ancora vera: 50% del budget invece del 97%.**
>
> Aggiornati: `Scheda prodotto` (default B), `docs/ALIVE.md` (config b),
> `docs/NAMING.md`. ⚠️ **Le tok/s assolute delle celle S23/Xiaomi sono del
> vecchio default e NON valgono per B** — il segno è noto, gli assoluti per
> device vanno rimisurati.
>
> 📌 **Marco1c resta da decidere separatamente** (sweep device in corso):
> lì d=1.0 costa **+5.71% anche col flag** contro il +1.18% di CalaQwen, e
> manca la sua ancora `k8d0` per sapere se sta nel budget. **Non estendere
> il default B a Marco senza quei due numeri.**
>
> 🔍 **AUDIT OSTILE ESTERNO SULLA STATISTICA (16/08, DeepSeek V4 Flash
> thinking max, tutto ricalcolato da CSV grezzi con scipy).**
> **I DUE P-VALUE SPEDITI REGGONO — attaccati e ricalcolati, esatti.**
> S23: mediana 0.2585→0.1480 (−42.75%), W=0, p = 2/2¹² = 0.000488, HL
> −0.10825, **Cohen dz = 12.6**. Xiaomi: 0.368→0.3145 (−14.54%), W=0,
> p = 2/2¹¹ = 0.000977, HL −0.05625, dz = 2.13. Pairing verificato
> contro i PREREG, floor esatti corretti, spiegazione 11-vs-12 corretta.
> Con dz così la varianza device ±50% non può ribaltare nulla.
> **Altri REFUTED (attaccati e hanno tenuto):** ABBA verificato in tutte
> e 5 le sessioni · pre-registrazione Xiaomi = esemplare di disciplina
> (PREREG 4h prima dello staging, 3 emendamenti tutti prima dei dati,
> kill condition onorate) · kf_ship_jelly e kf_cold_jelly timeline
> pulite · **confronti multipli NON sono una minaccia**: in tutta la
> campagna esistono ~6 test con p-value (4 celle pre-registrate + 2
> esplorativi dichiarati), e Bonferroni li lascia in piedi entrambi
> (servirebbero ≤102 e ≤51 test) · nessuno stopping opzionale, nessun
> outcome switching, nessun endpoint drift · sensibilità post-hoc di
> kf_cold_jelly presentata in modo sicuro · confound di contesa della
> dropcurve reale ma dichiarato e confinato.
>
> ⚠️ **MA CINQUE FINDING CONFERMATI, DA SISTEMARE — e il primo è mio, di
> oggi:**
>
> **(1) [ALTA, ERRORE MIO] `docs/ALIVE.md` attaccava i p-value alla
> config SBAGLIATA.** Verificato al sorgente: entrambe le celle A/B
> hanno testato come braccio B **`-t 2 --n-expert-used 6
> --drop-cold-experts 1.0`** (`run_ship_ab_s23.sh:421`,
> `run_ship_ab_xiaomi.sh:531`), contro A = stock `-t 4 --n-expert-used
> 8`. Io avevo scritto la config di CAMPAGNA CalaQwen (`-t 4 …
> --drop-cold-experts 0.65`, Scheda prodotto del 10/08) e ci avevo
> appeso il −42.7%/−14.5%. **Sono due config diverse su due modelli
> diversi**: quella validata dal p-value è Mellum2 t2/k6/d1.0; quella di
> campagna CalaQwen ha un gate di QUALITÀ (PPL), non un test appaiato.
> ALIVE.md corretto: le due config ora sono separate con l'evidenza di
> ciascuna. **Decisione owner aperta: o si spedisce la config testata,
> o si fa l'A/B di quella spedita.**
>
> **(2) [ALTA] La pre-registrazione S23 non è verificabile da git.**
> `results/kernel_ship_ab_s23/PREREG.md` ha **un solo commit**,
> `da9fa34` del 14/08 23:27:38 — e quel commit contiene GIÀ gli
> emendamenti 1 e 2. Ma la sessione 1 girava alle 17:03-18:25 e la 2 era
> partita alle 18:29. Quindi la frase "registrato PRIMA di ogni run" è
> falsa come affermazione git: il file è entrato nell'albero dopo due
> sessioni. I dati analizzati (v3, 23:28-23:49) sono partiti 55 secondi
> dopo il commit, quindi **la cella analizzata è pulita** — è la
> narrazione che non regge.
>
> **(3) [ALTA] I dati grezzi della sessione 2 non esistono nel repo.**
> `push.log` prova che è partita (18:29:34, batteria 61%), ma nessun
> runs.csv/master log da nessuna parte, e `git log --diff-filter=D` è
> vuoto. Il report spedito dice che il collasso RAM è stato "riprodotto
> 2×": **una sola riproduzione è archiviata**, l'altra è asserita.
>
> **(4) [MEDIA] Il PREREG S23 attribuisce l'esclusione della sessione 1
> a due cause che si escludono a vicenda:** emendamento 1 dice
> "misconfigurata, flag assente" (21.3 s/tok = patologia di default di
> engine); emendamento 2 dice "invalidate dallo stato RAM, **non dalla
> config**" (zram, stesso 21.3 s/tok). L'emendamento 1 non è mai stato
> ritirato e il report spedito sta con il 2.
>
> **(5) [MEDIA] Lo stato dello schermo è dichiarato loggato e non lo è
> mai stato.** Colonna `screen` = `?` su OGNI riga di ENTRAMBE le
> sessioni S23 e su ogni riga delle celle Jelly. Il PREREG S23 dichiara
> "screen state logged every run". Non è un confound differenziale (è
> bilanciato dall'ABBA) ma è un buco protocollo-vs-realtà, e sul Jelly
> contraddice il "wake-lock held" visto che c'è un evento di schermo
> spento documentato a metà cella.
>
> 🔋 **ASSE ENERGIA S23 — l'audit ESAGERA, ma sotto c'è un problema
> vero. Verificato da me riga per riga:** l'auditor sostiene che le
> mediane di energia siano "fisicamente impossibili" citando 0.3367 J
> come sorgente della mediana. **Falso: quelli sono i MINIMI del range.**
> Le mediane vere danno **A = 0.4214 W e B = 0.8227 W**, del tutto
> plausibili — e sono esattamente i numeri che il PLAN riporta da giorni
> (0.42→0.82 W). Quindi la claim "misura rotta" è **REFUTATA**.
> **Ma restano due fatti confermati:** (a) singole righe sono assurde
> (0.280 J su una run da ~52 s = 5 mW), quindi il campionatore fallisce
> a intermittenza e le righe singole non sono citabili anche se la
> mediana regge; (b) **i due bracci emettono un numero di token diverso
> — A 200 (cap), B 144 (EOS)** — e questo ribalta il segno a seconda
> della normalizzazione: **per TOKEN B costa +11.8%, per RISPOSTA B
> costa −19.5%** (17.53 J contro 21.79 J). La campagna ha citato solo il
> per-token come "asse rosso". Entrambi sono veri; va detto quale si
> intende. L'asimmetria 144-vs-200 è dichiarata nel report Xiaomi e
> **non** in quello S23.
>
> 🏁 **M4 CHIUSO A TRE LIVELLI (11:24) — E SUL DEFAULT SPEDITO LA RISPOSTA
> È LA MIGLIORE POSSIBILE.**
>
> | drop | renorm ON | renorm OFF | Δ | costo vs d=0.0 |
> |---|---|---|---|---|
> | 0.50 | 0.6802864 | 0.6791113 | −0.17% | +0.33% → **+0.15%** |
> | **0.65 (spedito)** | **0.6842309** | **0.6794305** | **−0.70%** | **+0.91% → +0.20%** |
> | 1.00 | 0.7049320 | 0.6860923 | −2.67% | +3.96% → **+1.18%** |
>
> **Cambiando UN flag, il costo di qualità della config che spediamo
> scende da +0.91% a +0.20% — il 78% in meno.** Non cambia il livello di
> drop, non cambia quali esperti cadono, non cambia i byte letti, non
> richiede di rifare l'A/B. Il danno cresce in modo monotono col drop
> (0.0012 → 0.0048 → 0.0188), come previsto dal meccanismo.
> *(La mia interpolazione dichiarata in anticipo dava ~+0.32%; misurato
> +0.20%.)*
>
> ✅ **MELLUM2 È Q4_K_M ED È GIUSTO COSÌ — e i p-value non hanno nessun
> problema di portata. (Registrato 17/08; la mia prima stesura di questo
> blocco era gonfiata, vedi in fondo.)**
>
> Mellum2 esiste solo come **Q4_K_M ufficiale JetBrains**; il KEXP su
> Mellum è stato **proiettato e mai costruito**
> (`reports/moe-mellum2-f1-s23.md` §"one honest KEXP projection":
> ~7.5-8.8 t/s stimati contro 4.5-6 del Q4, con la nota esplicita
> "none of those numbers were observed today"). **È una scelta di
> prodotto, non una dimenticanza:** Mellum2 è la SKU coding a pagamento
> e la generazione di codice è la capacità che soffre di più la
> quantizzazione aggressiva — quantizzarlo oltre metterebbe a rischio
> proprio ciò che si vende. *(Razionale di gualt; da oggi scritto qui e
> non più solo a voce.)*
>
> 🔗 **E la catena regge esattamente:**
> A/B braccio B = `-t 2 --n-expert-used 6 --drop-cold-experts 1.0`
> (`run_ship_ab_s23.sh:421`) · config viva di Mellum2 da F1e = **k=6
> drop 1.0, "solo config t2+d1.0"** · modello testato = Q4_K_M ·
> modello spedito = Q4_K_M. **Config, quantizzazione e p-value
> coincidono: i −42.7% / −14.5% validano precisamente ciò che Mellum2
> spedisce.**
>
> ❌ **MIO ERRORE DA NON RIPETERE (17/08 sera):** avevo scritto qui che
> esisteva un "terzo disallineamento" e che citare quei p-value fosse
> "una forzatura di portata". **Falso.** I tre presunti disallineamenti
> (thread, drop, quantizzazione) sono **un solo problema, già trovato e
> già corretto il 16/08**: i p-value erano stati attaccati alla config
> CalaQwen invece che a quella Mellum2, e ALIVE.md era già stato
> sistemato separando le due config. **L'ho ri-derivato da zero e
> presentato come tre scoperte nuove.** Gonfiare un problema risolto
> costa credibilità quanto nasconderne uno vero.
>
> 📌 **Lavoro futuro, non ora (decisione gualt):** un test di coding su
> Mellum2 con la nostra ricetta, per sapere quanto costa davvero il KEXP
> sulla capacità che vendiamo. Fino ad allora Mellum2 resta Q4_K_M.
>
> ✅ **Attenuante misurata, da dire insieme al problema:** la leva
> funziona anche su KEXP — gli sweep device su **Marco-KEXP**
> (`dropsweep_jelly`) e **CalaQwen-KEXP** (`dropsweep_calaqwen_jelly`)
> mostrano il drop che opera e paga. **Il meccanismo trasferisce; è il
> numero con il p-value che resta legato a Q4_K_M.**
>
> 🔧 **CORREZIONE (stessa sera, dopo domanda di gualt): non è una
> dimenticanza, e la mia prima formulazione era troppo severa.**
> Mellum2 è la **SKU coding a pagamento**, un prodotto diverso da
> CalaQwen/Marco, e gualt ricorda una decisione esplicita: *non
> riquantizzarlo oltre perché la capacità di coding crolla*. Il razionale
> è solido — la generazione di codice è la capacità che soffre di più la
> quantizzazione aggressiva.
> **Ma quella decisione NON è scritta da nessuna parte nel repo.** Quello
> che il repo documenta è: Mellum2 esiste solo come **Q4_K_M ufficiale
> JetBrains**; il KEXP su Mellum è stato **proiettato e mai costruito**
> (`reports/moe-mellum2-f1-s23.md` §"one honest KEXP projection":
> ~7.5-8.8 t/s stimati contro 4.5-6 del Q4 vanilla, con la nota che
> "none of those numbers were observed today"); F1b ha streamato **il
> file Q4_K_M** tramite una riga di ricetta `mellum`, non un file
> riquantizzato.
> ➡️ **Da registrare come decisione di prodotto** (con il razionale
> coding), altrimenti è la quarta cosa portante tramandata a voce — ed è
> esattamente il meccanismo che ha generato gli altri tre disallineamenti.
> **Resta vero e non attenuato:** citare i due p-value a sostegno delle
> config **KEXP** che spediamo è comunque una forzatura di portata,
> perché quei test hanno girato su Q4_K_M.
>
> ⚠️ **Nota sulla cella Marco su device:** `runs.csv` sul telefono segna
> **0 righe buone** — il bug del parser di quella notte marcò tutte e 11
> le run `excluded=1`. I numeri citati vengono dal ri-parsing offline dei
> per-token (validi), ma **la cella sul device è inservibile così com'è**
> e **non ha il braccio `no-renorm`**, che ora è la config candidata.
>
> ✅ **CELLA CALAQWEN COMPLETA — 12/12, STATUS=DONE (17/08 23:12).**
> Confronti dentro ogni round:
>
> | | R1 | R2 | **R3 (la più pulita)** | byte vs d0 |
> |---|---|---|---|---|
> | d=0.65 vs d=0.0 | +10.9% | +5.2% | **+1.2%** | −27.3% |
> | d=1.00 vs d=0.0 | −14.1% | −29.4%* | **−11.6%** | −71.4% |
> | d=1.00+nr vs d=0.0 | −13.2% | −24.2%* | **−12.8%** | −71.8% |
>
> \* **Round 2 da scartare sui bracci d=1.0**: la riga mancante è stata
> rifatta ore dopo, a telefono FREDDO (29→32 °C contro i 36-38 degli
> altri), quindi quei due valori sono gonfiati a favore del drop. Il
> **round 3 ha tutti e quattro i bracci a 36-38 °C** ed è il confronto
> termicamente omogeneo: è quello da citare.
>
> **Conclusioni robuste su 3 round:**
> - `d=0.65` **più lento di non droppare in tutti e tre** (+10.9 / +5.2 /
>   +1.2%). Mai una volta più veloce.
> - `d=1.0` **~12-14% più veloce** e legge **−71%** di byte.
> - `d=1.0` con e senza renorm: sui round termicamente confrontabili
>   (R1, R3) la differenza è **+1.1% e −1.3%, segno che si inverte** →
>   **equivalenti in velocità**. Il flag è gratis sul tempo, misurato.
>
> 🎯 **DECISIONE PRONTA PER CALAQWEN (17/08, 11 righe buone su 12).
> `d=0.65` È STRETTAMENTE DOMINATO: COSTA QUALITÀ *E* TEMPO. LA SCELTA
> VERA È `d=0.0` CONTRO `d=1.0 + --drop-no-renorm`.**
>
> Confronti **dentro ogni round** (la deriva termica resta fuori: ogni
> round ha la sua temperatura, e il round-robin dà a ogni braccio la
> stessa posizione in ognuno):
>
> | braccio | R1 | R2 | R3 | byte vs d0 |
> |---|---|---|---|---|
> | d=0.65 vs d=0.0 | **+10.9%** | **+5.2%** | **+1.2%** | −27.3% |
> | d=1.00 vs d=0.0 | −14.1% | *(void)* | −11.6% | −71.4% |
> | d=1.00+nr vs d=0.0 | −13.2% | −24.2% | −12.8% | −71.8% |
>
> **`d=0.65` più lento di non droppare in TUTTI E TRE i round** (segno
> costante, media ~+5.8%). Il finding di Marco-Mini si replica sul
> modello che spediamo. **E `d=1.0` con e senza renorm sono
> indistinguibili in velocità** (−14.1/−11.6 contro −13.2/−12.8, segni
> opposti fra round): **il flag è gratis anche sul tempo — misurato, non
> più dedotto.**
>
> | config | qualità vs d0 | velocità vs d0 |
> |---|---|---|
> | d=0.0 | — | — |
> | **d=0.65 ON — quella spedita** | +0.91% | **+5.8% più LENTA** |
> | d=0.65 OFF | +0.20% | ~+5.8% più lenta |
> | d=1.0 ON | +3.96% | −12.9% |
> | **d=1.0 OFF** | **+1.18%** | **−12.9%** |
>
> ➡️ **Lo 0.65 va abbandonato in qualunque forma**: peggiora entrambi gli
> assi rispetto a non droppare. Se si vuole velocità, l'unico punto che
> la compra è **d=1.0 + `--drop-no-renorm`**: +1.18% di bpb per −12.9% di
> tempo e −71.8% di byte letti.
>
> 🔍 **Dettaglio coerente:** `d=1.0nr` legge un filo MENO byte di `d=1.0`
> (2654.9 vs 2692.2) e droppa un filo di più. La renorm non tocca la
> *decisione* di drop, ma cambia i pesi passati a valle, quindi il
> routing del token successivo diverge: su 200 token le traiettorie si
> separano appena. Non è rumore di misura — i byte sono identici alla
> cifra fra round dello stesso braccio.
>
> ⏳ Manca `r2_d1.0` (escluso). Il resume lo rifà da solo alla prossima
> carica: non cambia il segno, che è già coerente su due round.
>
> 🐞 **LE MORTI DEL JELLY DI STAMATTINA ERANO UN BUG MIO, NON ANDROID —
> e il bug era nel "fix" che avevo scritto stanotte per curarle.**
>
> ```
> run_dropsweep_jelly.sh:109: total: unbound variable
> local total="$1" lbl="$2" left="$total" step=5 since=0
> ```
> **`local` è un comando: TUTTI i suoi argomenti vengono espansi PRIMA che
> venga eseguito**, quindi `"$total"` viene letto quando `total` non è
> ancora assegnato. Con `set -u` è fatale → `cooldown_alive()` moriva al
> primo giro, **sempre e in modo deterministico**. La cella CalaQwen è
> andata avanti solo perché il watchdog la rilanciava e il resume faceva
> un run per rilancio.
>
> ❌ **Come me lo sono lasciato scappare:** ho validato con `bash -n`, che
> controlla la **sintassi** e non il **comportamento**, e non ho mai
> ESEGUITO la funzione. Poi ho costruito una teoria su Android e ho fatto
> controllare a gualt le impostazioni di sistema del telefono — che erano
> già a posto. **Regola: una funzione nuova va eseguita, non compilata.**
> ✅ Ora eseguita in isolamento (12 s esatti, countdown 7→2→0) e verificata
> in campo: `cooldown 120s` 11:54:06 → `COLD_RESET` 11:56:12.
>
> ⚠️ **Attenzione a non estendere troppo la spiegazione:** questo bug
> spiega **solo** le morti di stamattina. `cooldown_alive` non esisteva
> ancora quando sono morte la cella Marco-Mini (16/08 23:34) e la cella
> LFM2.5 (17/08 00:25): **quelle due restano senza causa nota**, e il
> pattern "muore nel cooldown" per esse è ancora solo un pattern.
>
> 🔄 **Round 1 di stamattina ARCHIVIATO, non buttato**
> (`dropsweep_calaqwen_jelly_round1_buggycooldown`, 4 righe). Non si
> mescola col resto: quei run erano separati da un ciclo di rilancio del
> watchdog (sha256 di 13.4 GB + smoke test in mezzo) invece che dai 120 s
> dichiarati — protocollo inter-run diverso da quello scritto.
> ✅ **Controllo di determinismo gratuito:** il re-run pulito di `r1_d0.0`
> dà `read_MiB=9410.3` e `hit=75.5`, **identici alla cifra** all'archivio
> (s/tok 0.651 vs 0.639, differenza solo nel tempo). Le due celle
> misurano la stessa cosa.
>
> 📱 **CALAQWEN SUL JELLY — CELLA PARTITA 10:23, ROUND 1 (17/08).**
> Modello trasferito via USB e **verificato bit per bit**: sha256
> `ac44e20c…721a`, identico alla copia PC. Config **spedita** (`-t 4`,
> `k=6`), 4 bracci × 3 round, scollegato da 100%.
>
> | braccio | s/tok | stall | compute | read_MiB | hit% | droppati/48000 |
> |---|---|---|---|---|---|---|
> | d=0.00 | 0.639 | 0.061 | 0.570 | 9410.3 | 75.5 | 0 |
> | **d=0.65** | **0.693** | 0.052 | 0.629 | 6842.4 | 78.8 | 2761 |
> | d=1.00 | **0.603** | 0.031 | 0.567 | 2692.2 | 84.8 | 8224 |
> | d=1.00+nr | 0.647 | 0.037 | 0.604 | 2654.9 | 84.8 | 8294 |
>
> ❌ **ERRORE MIO, DA CORREGGERE SUBITO: la predizione che avevo scritto
> nel launcher poggiava su un numero falso.** Avevo dichiarato "CalaQwen
> ha hit 11.8%, il più legato al disco di tutti, quindi il drop deve
> rendere più del −27% di Marco-Mini". **Quel 11.8% veniva dallo smoke da
> 5 token, con la cache ancora da riempire.** Su 200 token l'hit vero è
> **75.5%** — cioè CalaQwen è molto MENO I/O-bound di Marco-Mini (50.2%),
> non di più. Lezione: **un hit rate da 5 token non è un hit rate**, è
> il transitorio di riempimento della cache.
>
> ✅ **Cosa REGGE, ed è il punto che conta per la decisione: `d=0.65` è
> più lento di non droppare affatto anche sul modello che spediamo**
> (+8.5%, contro il +10% di Marco-Mini). Il finding non era un'anomalia
> di Marco-Mini.
> ⚠️ **Ma d=1.0 rende molto meno qui: −5.6%, non −27%.** Coerente con
> l'hit rate più alto: meno I/O da risparmiare, stessa tassa di compute.
>
> ⏳ **NON concludo sul braccio no-renorm** (appare +7.3% più lento di
> d=1.0 a parità di byte e di drop): ha girato **ultimo del round a
> 37→38 °C**, e in questo disegno **la posizione nel round è correlata
> col braccio**. È il limite che avevo già dichiarato sulla cella LFM e
> che non ho corretto qui. **Rimedio: round con l'ordine ROVESCIATO**,
> che il resume aggiunge a costo zero — ma la batteria (~4.2%/run, 100%
> → ~50% a fine cella) non ne regge altri 3 su questa carica: vanno
> fatti dopo una ricarica.
>
> 🧊 **IL PC SI SOSPENDE DA SOLO — e per 78 minuti ho creduto di avere un
> watchdog rotto.** M4 finisce alle 07:45:07, il PC resta senza carico ed
> entra in **Modern Standby**; il watchdog del Jelly smette di scrivere
> alle 07:44:36 e riprende da solo alle **09:04:27**. `Get-Process` lo
> dava **vivo** per tutto il tempo. Prova definitiva dal registro
> eventi: `Kernel-Power Id=507 "The system is exiting Modern Standby"`
> alle 07:46:23 e alle 09:01:11 (quando i miei comandi hanno svegliato la
> macchina). **Non era bloccato: era congelato.**
> **Regola operativa:** "processo vivo" non è prova che stia lavorando —
> si confronta l'**mtime del log** con l'ora, e si escludono gli eventi
> Kernel-Power *prima* di accusare il codice. Stavo per riavviare un
> watchdog perfettamente sano. **Conseguenza per le catene: un runner in
> attesa sopravvive solo se qualcos'altro tiene la CPU occupata**; se la
> coda si svuota, il PC dorme e la catena si ferma finché qualcuno non
> tocca la macchina. Stessa forma del problema del Jelly, causa opposta:
> **lì Android UCCIDE, qui Windows SOSPENDE.**
>
> ▶️ **BRACCIO AGGIUNTO (09:02, PC libero): `k6d065_norenorm`.** È il
> livello di drop che spediamo davvero, ed è l'unico che risponde a
> "basta cambiare UN flag per migliorare la config attuale, senza
> toccare il livello di drop?". Il resume ha saltato i due bracci già
> completi e ha lanciato solo il nuovo. Fine attesa ~11:30.
>
> 🏆 **M4 COMPLETO (07:45) — IL RISULTATO PIÙ IMPORTANTE DELLA NOTTE.
> IL 70% DEL COSTO DI QUALITÀ DEL DROP AGGRESSIVO NON VIENE DAL DROP:
> VIENE DA UN DEFAULT.**
>
> | | renorm ON (default) | renorm OFF | Δ |
> |---|---|---|---|
> | **d=0.5** | 0.6802864 (+0.326%) | 0.6791113 (+0.153%) | −0.0011751 (−0.17%) |
> | **d=1.0** | 0.7049320 (**+3.961%**) | **0.6860923 (+1.183%)** | **−0.0188397 (−2.67%)** |
>
> (percentuali contro d=0.0 = 0.6780748, macchinario spento)
>
> ✅ **La predizione che avevo dichiarato PRIMA di vedere il braccio 2 è
> confermata:** il danno cresce con la frazione droppata — **16× più
> grande a d=1.0 che a d=0.5**, per un livello di drop doppio. Il
> meccanismo proposto regge: `total/kept` amplifica i top expert oltre la
> magnitudine per cui sono addestrati, e più droppi più li amplifichi.
> **Tutte e 5 le lingue, in tutti e 2 i bracci, hanno lo stesso segno.**
>
> 🔍 **Il dettaglio che dice di più:** a d=1.0 con renorm ON il costo per
> lingua è irregolare (en **+8.12%**, es +2.88, fr +2.96, it +3.59,
> zh +3.12) — con renorm OFF diventa **uniforme e piccolo** (+1.06,
> +1.15, +1.24, +1.58, +0.91). Il riscalamento non degrada un po'
> ovunque: **massacra l'inglese**, cioè la lingua dove il routing è più
> concentrato e quindi `total/kept` più aggressivo.
>
> ❗ **Il commento nel codice che giustifica il default è empiricamente
> sbagliato.** `router_hook.cpp:278` teme "uno shrink sistematico che il
> modello non vede mai in training". Misurato: **lo shrink è meno
> dannoso del riscalamento, di un fattore ~4 a d=1.0.** Era
> un'assunzione plausibile mai messa alla prova, ed è rimasta il default
> per tutta la campagna.
>
> 🎯 **CONSEGUENZA SULLA DECISIONE — il quadro cambia davvero:**
>
> | config | qualità vs d0 | velocità (Marco-Mini, device) |
> |---|---|---|
> | d=0.65 renorm ON — **quella spedita** | +0.91% | **+10% più LENTA** di d0 |
> | d=1.0 renorm ON — **quella validata dall'A/B** | +3.96% | −27% |
> | **d=1.0 renorm OFF** | **+1.18%** | −27% (stessi drop ⇒ stessi byte) |
>
> **Non è dominanza, è uno scambio molto buono:** d=1.0+OFF costa 0.28
> punti di qualità in più dello 0.65 spedito, e sul device dove abbiamo
> misurato è ~37 punti percentuali più veloce.
>
> ⚠️ **Quattro cautele, tutte da dire:** (1) la qualità è CalaQwen su PC,
> la velocità è Marco-Mini su device — **modelli diversi**; (2) l'A/B fu
> girato con renorm ON, quindi d=1.0+OFF **non è letteralmente la config
> testata**; (3) `--drop-no-renorm` non cambia QUALI esperti cadono (la
> decisione di drop non dipende dalla renorm), quindi byte e conteggi
> restano identici e la velocità dovrebbe trasferirsi — **ma è
> un'inferenza, non una misura**; (4) **`d=0.65 + OFF` non è misurato**
> ed è il braccio ovvio che manca: interpolando il danno, starebbe
> intorno a **+0.32%**, cioè meglio dello 0.65 attuale a parità di
> velocità. Costa ~2.5 h di PC.
>
> 🔬 **M4 — BRACCIO 1 CHIUSO (04:59, d=0.5, 5/5 lingue, rc=0). LA
> RINORMALIZZAZIONE NON GONFIA IL RISULTATO: LO PEGGIORA.**
>
> | | macro bpb | vs d=0.0 |
> |---|---|---|
> | d=0.5 renorm **ON** (default) | 0.6802864 | **+0.326%** |
> | d=0.5 renorm **OFF** | **0.6791113** | **+0.153%** |
>
> Δ = **−0.0011751 (−0.173%)**, e **tutte e cinque le lingue hanno lo
> stesso segno**: en −0.40%, es −0.03%, fr −0.05%, it −0.19%, zh −0.22%.
> **Spegnere la renorm recupera il 53% del costo di qualità del drop.**
> Con rumore run-to-run a 1e-6, un delta di 0.0012 bpb è ~1000× il
> rumore: piccolo ma reale.
>
> ❗ **È il CONTRARIO dell'ipotesi dei due auditor.** Loro dicevano: "il
> miglioramento potrebbe venire dalla rinormalizzazione invece che dal
> togliere rumore" — cioè la renorm faceva il lavoro buono. **Fa il
> lavoro cattivo.** E contraddice anche il commento nel codice
> (`router_hook.cpp:278`), che giustifica la renorm temendo "uno
> shrink sistematico che il modello non vede mai in training":
> empiricamente **lo shrink è meno dannoso del riscalamento**. Lettura
> plausibile: gli esperti droppati hanno peso basso, quindi lo shrink è
> minuscolo, mentre `total/kept` amplifica i top expert oltre la
> magnitudine per cui sono addestrati — perturbazione più grande.
>
> 🎯 **PREDIZIONE DICHIARATA ORA, prima che il braccio 2 finisca
> (partito 04:59):** se il meccanismo è "il riscalamento sovracorregge",
> il danno deve **CRESCERE con la frazione droppata**, perché `total/kept`
> cresce. Quindi mi aspetto **OFF−ON a d=1.0 più negativo di −0.173%**.
> Se invece a d=1.0 il delta si appiattisce o cambia segno, la mia
> spiegazione è sbagliata e il fenomeno è specifico a d=0.5.
>
> ⏳ **M4 — PRIMO SEGNALE (03:15, 1 lingua su 5, NON è un verdetto).**
> `k6d05_norenorm` en: **ON 0.561173 → OFF 0.558919, cioè −0.40%: senza
> rinormalizzazione va MEGLIO.** È il terzo ramo della lettura che avevo
> dichiarato in anticipo ("OFF meglio di ON → il default è sbagliato e
> c'è qualità gratis"), ed è quello che mi aspettavo di meno.
> ✅ **La guardia no-op è superata empiricamente**: i valori DIFFERISCONO,
> quindi `--drop-no-renorm` ha agito davvero. Si somma al controllo da
> sorgente (la CLI esce con rc=1 su argomento sconosciuto,
> `main.cpp:752-756`, e l'engine gira col flag sulla riga di comando).
> ⚠️ **Una lingua su cinque, e l'inglese è la più facile del corpus**
> (bpb 0.56 contro 0.84 dello zh). Aspettare le altre quattro e il
> braccio d=1.0 prima di dire qualunque cosa: se il segno si mantiene su
> tutte, la frase "affilare la mistura" non solo non spiega il
> risultato — è **al contrario**, e va riscritta in PLAN, ALIVE e NAMING.
> 🔎 **Nota di metodo:** il JSON del braccio esisteva già dopo la PRIMA
> lingua, senza `finished`. È esattamente il caso che l'audit aveva
> chiamato F1 e che ho corretto tre ore fa: col vecchio `Test-Path`
> questo braccio sarebbe stato saltabile come "completo".
>
> 🚨 **CURVA CALAQWEN COMPLETA (02:28) — E DUE DELLE SUE TRE COLONNE SONO
> ARTEFATTI. Il difetto è nell'ancora, non nei dati.**
>
> | drop | macro bpb | vs d0 (**valido**) | `gate_vs_k8d0` (**da ignorare**) |
> |---|---|---|---|
> | 0.00 | 0.6780748 | — | ~~PASS~~ |
> | 0.30 | 0.6784793 | +0.06% | ~~PASS~~ |
> | 0.50 | 0.6802864 | +0.33% | ~~PASS~~ |
> | **0.65** | **0.6842309** | **+0.91%** ← il default spedito, misurato | ~~PASS~~ |
> | 0.80 | 0.6889289 | +1.60% | ~~PASS~~ |
> | 1.00 | 0.7049320 | +3.96% | ~~PASS~~ |
>
> ❌ **`GATE_PASS` su questa curva NON VUOL DIRE NIENTE.** `GATE_DIR` è
> hardcoded a `results/mellum2_ppl_gate` (`run_mellum2_dropcurve.py:31`) e
> l'ancora `k8d0` è **Mellum2-12B** (macro 1.020819). Quando `launch.ps1`
> ha riusato lo script per CalaQwen passando solo `--expect-model-sha`,
> **l'ancora è rimasta Mellum2**: quindi `d_macro_vs_k8d0` = CalaQwen
> meno Mellum2 ≈ **−0.34**, contro una soglia `MACRO_PASS = 0.04`. Ogni
> braccio passa con 0.38 bpb di margine **perché CalaQwen è un modello
> migliore di Mellum2**, non perché quel livello di drop sia accettabile.
> Il gate è vero per costruzione e **non porta informazione sul drop**.
>
> ❌ **`DROPCURVE_FLAT(spread=0.0269, noise=0.3537)` è lo stesso artefatto.**
> Il "noise floor" è `|rerun − stored|` con `stored` preso dalla stessa
> cartella Mellum2: `d10_stored_macro = 1.0586` (Mellum2) contro
> `d10_rerun_macro = 0.7049` (CalaQwen) → 0.3537. **Non è rumore
> run-to-run: è la differenza fra due modelli.** Con un floor così, la
> condizione `all_within_noise` è una tautologia e "FLAT" esce sempre.
>
> ✅ **COSA SOPRAVVIVE, ed è la parte che conta:** `macro_bpb` e la
> colonna **vs d0** sono stesso modello, stesso binario, stesso corpus, e
> la PPL in decode è deterministica (la campagna Mellum2 misurò rumore a
> 1e-6). Quindi la curva vera è **monotona crescente e reale**: il costo
> di qualità non è piatto e non è zero, è **+0.91% al default spedito** e
> **+3.96% a d=1.0**. È piccolo, ma è misurato e ordinato.
>
> 🔧 **Da correggere:** ero io ad aver scritto un'ora fa in `docs/ALIVE.md`
> "five points measured, **all GATE_PASS**" — quel PASS è vacuo e va tolto.
> Per un gate CalaQwen vero serve un'ancora **CalaQwen k8 d0**, che non
> esiste (≈1 giorno-PC). Fino ad allora la frase onesta è: *il costo di
> qualità del drop su CalaQwen è misurato e piccolo; non esiste un gate
> superato, perché il gate confrontava un altro modello.*
> **Nota: M4 NON è toccato** — confronta OFF contro ON dentro CalaQwen,
> stesso modello e stesso binario.
>
> ☀️ **COSA SERVE DOMATTINA — la decisione su `d=0.65` è cambiata di
> FORMA, non solo di numeri.** Prima la domanda era "quanto costa in
> qualità lo 0.65". Ora si sa che **il drop paga solo se la quota di
> stall è alta abbastanza da ripagare una tassa fissa di compute**, e
> quella quota dipende dal modello e dal device. Quindi:
>
> 1. **Serve una decisione dell'owner, non una misura:** come portare
>    CalaQwen su un telefono per misurarlo. Sono 13.4 GB e non c'è.
>    (a) trasferirlo sul Jelly **mentre è in carica**, poi caricarlo al
>    100% e fare lo sweep scollegato (il protocollo vuole UNPLUGGED solo
>    durante la misura, non durante il trasferimento); oppure
>    (b) aspettare che l'S23 si liberi dall'altro harness.
>    **Senza uno dei due, la decisione sul default resta bloccata** — e
>    non è aggirabile con l'analisi (vedi sotto: i dati device CalaQwen
>    esistenti non hanno stall/compute e sono su un'altra quantizzazione).
> 2. **Affermazione onesta nel frattempo:** il default 0.65 sta su una
>    parte della curva **dominata sull'unica coppia device+modello dove
>    l'abbiamo misurata**, ed è **non testato sul modello che spediamo**.
>    Non è "sbagliato": è non verificato.
> 3. Quando M4 chiude, si sa anche **se il risultato di qualità è della
>    renorm o del drop** — e questo cambia le PAROLE in PLAN/ALIVE/NAMING,
>    non solo il numero.
>
> 🌙 **NOTTE 16→17/08 — DUE MISURE, POI SI DECIDE (nessuna idea nuova).**
> Ordine deciso con gualt prima che andasse a dormire: si chiude, non si
> apre. Stato alle 00:20.
>
> **PC — la curva qualità CalaQwen è a 5 punti su 6 e sta chiudendo il
> sesto, che è proprio il default spedito:**
>
> | drop | arm | macro bpb | Δ vs d0 | gate |
> |---|---|---|---|---|
> | 0.00 | k6d0 | 0.6780748 | — | GATE_PASS |
> | 0.30 | k6d03 | 0.6784793 | +0.06% | GATE_PASS |
> | 0.50 | k6d05 | 0.6802864 | +0.33% | GATE_PASS |
> | 0.65 | k6d065 | *in corso, fine ~02:40* | — | — |
> | 0.80 | k6d08 | 0.6889289 | +1.60% | GATE_PASS |
> | 1.00 | k6d10 | 0.7049320 | +3.96% | GATE_PASS |
>
> Quando k6d065 chiude, **il costo di qualità dello 0.65 è MISURATO e non
> più interpolato** — la riga più debole della tabella di Pareto del
> REPORT sweep sparisce.
>
> 🔬 **M4 — ABLAZIONE DELLA RINORMALIZZAZIONE, ARMATA (parte da sola
> quando il PC è libero; `scripts/run_m4_renorm_ablation.ps1`, pid 57676).**
> È la misura che due auditor indipendenti hanno messo al primo posto.
> Disegno 2×2 **dichiarato prima di lanciare**:
>
> | | renorm ON (default) | renorm OFF (`--drop-no-renorm`) |
> |---|---|---|
> | **d=0.5** | k6d05 = 0.6802864 ✅ già misurato | `k6d05_norenorm` ← stanotte |
> | **d=1.0** | k6d10 = 0.7049320 ✅ già misurato | `k6d10_norenorm` ← stanotte |
>
> Mancano solo le due celle OFF: **le ON sono già misurate su questo
> identico binario e modello, quindi il contrasto è senza confondenti.**
> d=1.0 c'è perché a 0.5 la correzione di renorm è piccola e un nulla lì
> non direbbe niente; a 1.0 il costo qualità è massimo (+3.96%) ed è dove
> la rinormalizzazione lavora di più.
> **Lettura dichiarata in anticipo:** OFF≈ON a entrambi i livelli → la
> renorm non è il meccanismo e la claim regge com'è scritta; OFF molto
> peggio → **è la rinormalizzazione a portare il risultato**, e allora la
> frase onesta diventa "affilare la mistura costa poco", che è un'altra
> cosa e molto meno nuova (da riscrivere in PLAN, ALIVE e NAMING);
> OFF meglio di ON → il default è sbagliato e c'è qualità gratis.
>
> 📄 **Il verdetto esce da solo:** `scripts/summarize_m4_renorm.py` — scritto
> **prima che i dati esistessero** — legge i quattro bracci, rifiuta i JSON
> senza `finished`, costruisce il 2×2 e applica la regola no-op; il runner
> lo invoca a fine catena e scrive `results/m4_renorm_ablation/VERDICT.md`.
> Così la conclusione non dipende da chi è sveglio. Provato a vuoto: legge
> i due bracci ON e dichiara "Incomplete — no verdict".
>
> ⛔ **Il terzo braccio (drop CASUALE invece che per freddezza) NON si fa
> stanotte, e non è una dimenticanza:** il flag non esiste nell'engine,
> servirebbe una modifica al codice e una ricompilazione — **e un binario
> nuovo romperebbe l'identity pin che rende confrontabili questi bracci.**
> Farlo bene costa anche un braccio di controllo ricompilato. Decisione
> owner, non contrabbandata di notte.
>
> 📱 **JELLY — SECONDO MODELLO PER LA NON-MONOTONICITÀ: NON è CalaQwen, ed
> è una scelta forzata dai numeri, non una scorciatoia.** CalaQwen
> (13.4 GB) **non è sul Jelly** e non c'è nessun 35B sul telefono.
> Trasferirlo costa ~45 min di WiFi + scrittura flash ≈ 20% di batteria,
> partendo da 71% scollegato, con floor di protocollo al 45%: **finirebbe
> la batteria prima della fine dello sweep.** Con l'S23 riservato
> all'altro harness, l'unico altro MoE disponibile è
> **LFM2.5-8B-A1B-KEXP** — e non è un ripiego:
>
> **`lfm2moe`, gating sigmoid, k=4 su 32 esperti, 3.3 GB** contro i
> **k=6 su 256, 6.4 GB** di Marco-Mini. Pre-flight misurato stanotte:
> d=0.0 → `read_MiB=183.0`; d=1.0 → `read_MiB=99.1`,
> `experts_routed=440 experts_dropped=26`. **Cache hit 93.5% contro il
> 50.2% di Marco-Mini**: qui il working set degli esperti STA in cache,
> lì no.
>
> **Lettura dichiarata prima del lancio:** se i byte salgono a d=0.3
> anche qui → l'effetto è a livello di implementazione e il default 0.65
> è sospetto su OGNI modello, CalaQwen compreso; se qui sono monotoni e
> su Marco no → **CONFERMA il meccanismo di località di cache** (serve un
> working set che sfori la cache) e il finding di Marco resta in piedi,
> circoscritto ai modelli con tanti esperti. **Nessuna delle due è un
> fallimento** — ed è per questo che la cella vale la sua batteria.
>
> 🔴 **CORREZIONE MIA, DA SORGENTE + DATI (17/08, round 1 LFM2.5): IL
> MECCANISMO CHE AVEVO SCRITTO IERI È SBAGLIATO. Non è località di
> cache. È il costo di ARMARE il drop, e si paga in COMPUTE.**
>
> | drop | s/tok | stall | **compute** | io | read_MiB | hit% | droppati |
> |---|---|---|---|---|---|---|---|
> | 0.00 | 0.182 | 0.016 | **0.164** | 0.045 | 2245.6 | 93.5 | 0 |
> | 0.30 | 0.214 | 0.014 | **0.199** | 0.037 | 1917.7 | 93.9 | **9** / 17600 |
> | 0.65 | 0.206 | 0.010 | **0.194** | 0.029 | 1414.4 | 94.6 | 296 |
> | 1.00 | 0.238 | 0.006 | **0.231** | 0.015 | 739.6 | 95.5 | 639 |
>
> **Tutto ciò che è I/O migliora in modo monotono** (stall −63%, io −67%,
> byte −67%, hit 93.5→95.5) **e il compute peggiora in modo monotono
> (+41%).** Su questo modello il drop è perdita pura a OGNI livello:
> risparmia byte che non stavamo aspettando (a d=0 l'I/O è l'8.8% del
> tempo, perché il working set STA in cache) e aggiunge compute.
>
> **Il numero che chiude il ragionamento: a d=0.3 sono stati droppati 9
> slot su 17600 — lo 0.05% — e il compute è salito del 21%.** Nove
> esperti non possono costare il 21%. Quindi non è il DROPPARE a costare.
>
> ✅ **Verificato al sorgente:** `RouterHook::drop_armed()`
> (`router_hook.cpp:213-215`) ritorna false se `drop_frac_ <= 0`. A
> d=0.0 vengono saltati per intero `gather_weights`, `settle_spec()`,
> `query_residency()` e il doppio ciclo `nu×nt` con la passata di
> renorm; a d>0 girano su TUTTI gli slot instradati (88/token qui) a
> prescindere da quanti ne cadono. **Quindi `d=0.0` non è "lo stesso
> engine senza drop": è il macchinario spento.** Il confronto d=0.0 vs
> d=0.3 misura quasi solo l'accensione.
>
> 🧪 **Braccio di controllo dichiarato PRIMA di misurarlo: `d=0.001`.**
> La soglia è `thr = drop_frac_/nu`, quindi a 0.001 il macchinario è
> ARMATO ma non droppa (quasi) nulla. Predizione registrata ora:
> **compute(d=0.001) ≈ compute(d=0.3) ≫ compute(d=0.0)**. Se esce così,
> la tassa di accensione è isolata e quantificata; se compute(0.001)
> ≈ compute(0.0), la mia spiegazione è sbagliata di nuovo e il costo
> viene davvero dal droppare. Costa 3 run (~9 min) e il resume lo
> aggiunge senza rifare nulla.
>
> ⚠️ **Cosa NON cambia:** il finding di Marco-Mini resta (d=1.0 lì è
> davvero il più veloce, −27.2%), perché lì lo stall era il 22% del tempo
> e il risparmio di I/O ripaga la tassa. **Cambia la REGOLA generale, che
> ora è prevedibile invece che aneddotica:** *il drop paga solo se
> risparmia abbastanza I/O da coprire una tassa fissa di compute per
> token; il break-even lo fissa la quota di stall, non il livello di
> drop.* Su un modello che sta in cache non paga mai. **E l'aumento di
> +5.0% dei byte a d=0.3 su Marco-Mini resta un'anomalia separata e
> ancora non spiegata** (candidato: `settle_spec()` cambia il
> comportamento del prefetcher) — non la si archivi come "risolta".
>
> 🛡️ **AUDIT OSTILE SUI TRE SCRIPT DELLA NOTTE (DeepSeek V4 Flash thinking
> max, 17/08 00:20-00:35). CINQUE PROBLEMI REALI, TUTTI CORRETTI PRIMA
> CHE PARTISSE M4.** Undici altri attacchi REFUTATI con prove (parser
> awk, collisioni di chiavi, `jfield`, conteggio colonne CSV, escaping
> della here-string, trappola dell'`exec`, heredoc del resume).
>
> **F1 [GRAVITÀ 1 — dato silenziosamente sbagliato, il peggiore]:** usavo
> `Test-Path <arm>_multi5.json` come test di completezza. **Ma quel JSON
> viene scritto dopo OGNI lingua e su OGNI percorso di errore**
> (`run_multi5_ppl_host.py:218,229,258`); solo la scrittura finale
> aggiunge la chiave `finished` (riga 265). Un braccio andato in OOM
> sulla prima lingua sarebbe stato **saltato per sempre come "già
> completo"**, e M4 avrebbe confrontato un braccio OFF parziale contro un
> ON completo — cioè esattamente il risultato-che-sembra-giusto che
> questa cella non può permettersi. **Corretto:** `ArmComplete()` esige
> `finished` E `macro_bpb`, e il runner si FERMA su rc≠0 invece di
> proseguire. Verificato su dati veri: `k6d05` (finito) → True,
> `k6d065` (in corso, JSON già presente) → **False**.
> **F4 [2]:** PID orchestratore hardcoded → dopo la sua uscita Windows
> può riciclare il numero e la catena aspetterebbe uno sconosciuto fino
> al tetto di 24 h. **Corretto:** si verifica che la command line
> contenga `run_mellum2_dropcurve`.
> **F5 [2]:** un engine **bloccato** era invisibile — `kill -0` lo tiene
> "vivo" per sempre e il watchdog non avrebbe mai rilanciato. **Corretto:**
> l'heartbeat diventa segnale di vivacità (età > 900 s ⇒ kill + resume).
> **F3 [3]:** la finestra di ~1-2 s prima dell'`exec` di `launch.sh` non
> era vista dal guard. **Corretto:** il guard ora riconosce entrambi, e
> `ALIVE>1` diventa un allarme che BLOCCA il rilancio.
> **F2 [2]:** ssh morto produceva la stessa riga ogni 5 minuti senza
> escalation. **Corretto:** allarme a 15 min su `logs/JELLY-ALERT.txt`.
>
> 🔬 **Controllo positivo dichiarato PRIMA dei numeri (buco che l'audit
> NON aveva visto e che ho trovato verificando io la sua claim R9):** in
> `--ppl-decode` l'engine stampa solo `drop_cold=0.500 k=6` e **non
> stampa mai `drop_renorm`**; la CSV è `pos,token_id,logprob`. Quindi
> **non esiste una riga di log che provi che `--drop-no-renorm` ha
> agito**, e un nullo sarebbe indistinguibile da un flag ignorato.
> Regola fissata ora: **`macro_bpb`(OFF) identico a piena precisione a
> quello ON ⇒ FLAG NO-OP, non "la renorm non conta"**. È solido perché
> senza renorm i superstiti non vengono riscalati per `total/kept`
> (`router_hook.cpp:278-282`), quindi la PPL non può uscire identica.
>
> 🧩 **MECCANISMO CHIUSO SU DUE MODELLI (rianalisi dei dati grezzi
> Marco-Mini + round 1 LFM2.5, costo zero: i per-token erano già in
> repo).** Il modello che spiega tutto:
>
> **`compute(d) = base + tassa_di_accensione − risparmio(quanti ne cadono
> davvero)`**
>
> | modello | hit% | slot instradati | d=0.3: caduti | Δcompute | d=1.0: caduti | Δcompute |
> |---|---|---|---|---|---|---|
> | Marco-Mini (k6/256) | 50.2 | 33600 | **21** (0.06%) | +6.8% (r1), +13.8% (r2) | **9986** (29.7%) | **−13.7%** |
> | LFM2.5 (k4/32) | 93.5 | 17600 | **9** (0.05%) | **+21.3%** | **639** (3.6%) | **+40.9%** |
>
> A d=0.3 **entrambi i modelli droppano lo 0.05% degli slot e pagano
> comunque compute**: è la prova diretta che il costo è ACCENDERE, non
> droppare. A d=1.0 Marco ne droppa il 29.7% e il risparmio **ripaga con
> gli interessi** (compute sotto il baseline); LFM ne droppa il 3.6% e la
> tassa non viene mai ripagata.
>
> 🔑 **E perché LFM ne droppa così pochi? Il drop può colpire SOLO ciò che
> non è in cache** — `router_hook.cpp:271`: `drop = k != best &&
> drop_res_[idx] == route_miss && drop_w_[idx] < thr`. **Quindi l'hit
> rate mette un TETTO al drop rate**, e i due modelli lo rispettano
> entrambi: Marco hit 50.2% → al più ~49.8% droppabile, osservato 29.7%;
> LFM hit 93.5% → al più ~6.5%, osservato 3.6%. **`--drop-cold-experts`
> è auto-limitante: su un modello che sta in cache non ha niente da
> droppare e resta solo la tassa.**
>
> ❓ **Ho provato a PREDIRE CalaQwen dai dati che già abbiamo, e non si
> può — ed è la ragione per cui quella misura non è sostituibile
> dall'analisi.** La regola nuova ("paga solo se la quota di stall è
> abbastanza alta") richiede stall/compute e hit rate della config
> spedita su device. L'unica cella device CalaQwen è
> `results/adopt_dropcold/` e **non ha la scomposizione**: `conv5.turns.csv`
> ha solo `tok_s` e `cache_hit_pct` (81.5%), niente stall né compute, ed è
> per di più su una quantizzazione diversa (`UD-IQ2_M`, non KEXP) e in
> regime conversazionale con riuso di cache tra turni. **Quindi: nessuna
> predizione onesta possibile.** Serve lo sweep CalaQwen su device.
>
> ❌ **Candidato REFUTATO sui byte:** avevo ipotizzato che l'aumento di
> +5.0% dei byte a d=0.3 su Marco venisse da `settle_spec()`. **Falso:
> `spec_read_MiB=0.0`, `spec_experts=0` in tutte le run — il prefetcher
> speculativo è spento.** Il dato dice altro: a d=0.0 e d=0.3 la domanda
> è IDENTICA (`token_demand_MiB=136.8` in entrambi), ma **evictions
> 16692→17409 (+4.3%) e rereads 12514→13221 (+5.7%)**. Quindi i byte in
> più sono **rilettura da sfratto a domanda invariata**: il percorso
> armato carica in modo diverso (`load_layer` immediato con
> `D.deferred = false`) e frusta la cache. Ipotesi non ancora confermata
> al sorgente — **resta aperta, ma non è più "località di cache" e non è
> speculazione.**
>
> ⚠️ **Limite del disegno, dichiarato:** dentro un round l'ordine è
> sempre 0.0→0.3→0.65→1.0, quindi **la posizione nel round è correlata
> col livello di drop** e nel round 1 la temperatura sale 32→34 °C. Due
> cose lo attenuano: `d0.65` e `d1.0` girano entrambi a 34→34 (stesso
> stato termico) e differiscono 0.206 vs 0.238, e i round 2-3 girano
> tutti a saturazione termica. **Rimedio previsto: round aggiuntivi con
> l'ordine dei drop ROVESCIATO**, che il resume permette a costo zero.
>
> 💀 **JELLY PERSO ALLE ~00:25 — MA STAVOLTA SO PERCHÉ, E NON È IL
> TIMEOUT DELLO SCHERMO.** 4 run buone in cassa (tutto il round 1, i
> numeri qui sopra), poi Termux ucciso. **Il telefono rispondeva al ping
> con 0% di perdita mentre TUTTE le porte erano chiuse** (8022, 22,
> 18022, 2222, 8080): non è la rete e non è doze profondo — è stato
> ucciso l'intero process group dell'app, non solo sshd.
>
> 🔍 **Il pattern che ieri non avevo visto: tutte e due le morti sono nel
> COOLDOWN, non in una run.** 16/08: ultima run finita 23:34:26, morto
> nel cooldown dopo. 17/08: ultima run finita 00:22:02, ultimo battito
> "cooldown before r2_d0.0", sparito entro tre minuti. **E gli intervalli
> dal lancio sono 30 min e 13 min — quindi nessun timeout fisso**, il che
> falsifica la diagnosi "timeout schermo a 30 min" che avevo dato ieri
> (già allora contraddetta dalla cella K-F durata 50 minuti).
> Ipotesi, 2 casi su 2, non confermata: **Android congela l'app quando
> resta inattiva, e un processo fermo in `sleep 120` sembra inattivo.**
>
> 🔧 **Fix applicato (misura invariata):** `cooldown_alive()` spezza il
> cooldown in `sleep 5` con heartbeat a ogni giro e wake-lock riacquisito
> ogni 30 s — stessi secondi totali, stessi flag, stesso gate: cambia
> solo la meccanica di sopravvivenza. E il watchdog ora **rispinge lo
> script via scp e ne verifica lo sha prima di rilanciare**, se no
> rilancerebbe fedelmente la versione che muore.
>
> ⛔ **Limite onesto: senza adb sul Jelly non esiste canale fuori banda**
> (solo l'S23 è su adb ed è riservato all'altro harness). Il watchdog
> ritenta all'infinito e riprende dal run 5 appena sshd torna, ma **fino
> ad allora si è ciechi.** Le 4 run del round 1 sono l'unico dato, e il
> segnale che portano è già forte.
>
> 🔧 **Lo sweep v2 corregge la causa comune dei tre bug di ieri:
> parametrizza invece di riscrivere** (`scripts/run_dropsweep_jelly.sh`).
> **Resume derivato da `runs.csv`** (lo stato È il dato: nessun file di
> resume che possa divergere), **passate di recupero** sui label vuoti,
> **pre-flight smoke da 5 token** che avrebbe intercettato in 20 secondi
> sia il fallimento di link sia il parser che tornava vuoto, e **guardia
> Termux:API** (una batteria illeggibile non deve più essere letta come
> "attaccato alla corrente"). Watchdog lato PC che rilancia solo se
> l'harness è morto **senza** verdetto terminale, con ricontrollo di
> vivacità **sul device** un istante prima di lanciare — perché un
> rilancio a vuoto crea un harness duplicato, che è l'errore già
> commesso oggi. Primo run in cassa: `r1_d0.0 s/tok=0.182
> read_MiB=2245.6 hit=93.5 excluded=0`.
>
> 🚨 **DROP SWEEP JELLY — RISULTATO (16/08, 11 run su 12): IL RISPARMIO DI
> BYTE NON È MONOTONO, E `d=0.65` CHE SPEDIAMO È PIÙ LENTO DI NON
> DROPPARE AFFATTO.**
>
> | drop | s/tok | read_MiB | hit% | tempo vs d0 | byte vs d0 |
> |---|---|---|---|---|---|
> | 0.00 | 0.1703 | 11803.1 | 50.2 | — | — |
> | **0.30** | 0.2000 | 12395.9 | 48.3 | **+17.4% PIÙ LENTO** | **+5.0% PIÙ BYTE** |
> | **0.65** | 0.1873 | 10535.0 | 52.3 | **+10.0% più lento** | −10.7% |
> | **1.00** | 0.1240 | 3712.8 | 67.1 | **−27.2% più veloce** | **−68.5%** |
>
> **Un drop piccolo non è un risparmio piccolo: è una perdita netta.** Il
> meccanismo si vede nella colonna cache: l'hit rate SCENDE (50.2 → 48.3)
> perché ripuntare lo slot droppato sul top expert
> (`router_hook.cpp:267-268`) perturba quali esperti vengono toccati, e a
> frazioni basse questo distrugge più località di quante letture tolga.
> A d=1.0 si ribalta: hit 67.1%, byte a un terzo, throughput **+37%**
> (5.87 → 8.07 tok/s).
>
> ✅ **CONTROLLO INTERNO PASSATO:** d=0.65 senza prefetch riproduce il
> braccio OFF della cella K-F — `read_MiB` = **10535.0 identico in tutti
> e tre i round** (contabilità byte dell'engine esatta e deterministica),
> `/proc read_bytes` 22.17/22.07/22.19 GB contro i 22.1-22.5 di quella
> cella. Il round-robin ha fatto il suo: r3 è gonfiato in blocco (34 °C)
> ma **conserva l'ordinamento**.
>
> 🎯 **INCROCIATO CON LA CURVA QUALITÀ DEL PC: d=0.3 e d=0.65 sono
> STRETTAMENTE DOMINATI** — costano qualità E tempo. La scelta vera è
> **d=0.0 contro d=1.0**: 4% di bpb per +37% di token/s, o niente drop.
> **E spiega per un'altra strada quello che l'audit statistico ha
> trovato:** l'A/B pre-registrato testava il braccio B a
> `--drop-cold-experts 1.0`, NON lo 0.65 di campagna. **L'A/B ha testato
> la config che è davvero veloce; il nostro default sta sulla parte
> dominata della curva.** Due evidenze indipendenti che convergono sullo
> stesso punto: la config spedita e quella validata non coincidono.
> Esplorativo: un device, un modello, d=1.0 ha n=2. **Licenzia un
> riesame del default, non un cambio.**
>
> ⚠️ **TRE BUG, TUTTI MIEI, NESSUNO DEL DEVICE.** (1) il binario non
> linkava — `bmoe-cli` carica le `.so` dalla propria cartella e l'harness
> K-F lo risolve alla riga 42 con `LD_LIBRARY_PATH`: ho riusato il
> binario senza riusare quella riga; (2) `set -e` dopo il `wait`
> accendeva errexit mai voluto (header `-uo pipefail`) e il comando
> successivo uccideva lo sweep in silenzio; (3) **il parser buttava via
> ogni campo di tempo**: le chiavi dell'engine contengono `/` (`s/tok`,
> `tok/s`) e il mio estrattore `sed s///` leggeva la barra come
> delimitatore — i campi con barra tornavano vuoti, quelli senza
> (`read_MiB`, `hit%`) funzionavano, ed è per questo che il guasto era
> invisibile. **I dati si sono salvati solo perché l'engine scrive da sé
> la riga di summary**: la misura era giusta, era rotta l'estrazione.
> **Causa comune: ho scritto un harness nuovo invece di parametrizzare
> quello provato.** Tutti e tre erano già risolti in
> `run_kf_reality_jelly.sh`. results/dropsweep_jelly/REPORT.md.
>
> 🧪 **(design dichiarato prima del lancio:)**
> `--drop-cold-experts` è la leva viva della campagna e il suo costo di
> QUALITÀ è misurato (curva PC: d0.3 +0.06%, d0.8 +1.6%, d1.0 +4.0%
> macro bpb). **Il suo risparmio di BYTE non è MAI stato misurato** — è
> lo scopo dichiarato del flag, citato come se fosse un risultato. La
> cella PC non ha strumentato i byte e i suoi tempi sono confusi da una
> contesa CPU diversa per braccio.
> Questa lo misura sul device dove i byte costano davvero (flash lento,
> stall ~22%), da page cache verificata fredda.
>
> **Dichiarato prima di lanciare:** bracci d ∈ {0.0, 0.3, 0.65, 1.0} ·
> ordine **round-robin ×3 round = 12 run**, così ogni livello è
> campionato presto/medio/tardi e la deriva termica o di batteria non
> può fabbricare un trend monotono · n=200 · **reset a freddo verificato
> prima di OGNI run** (fadv + Cached prima/dopo, COLD-VALID solo se il
> calo ≥ 1000 MB — lo stesso gate che oggi ha beccato tre run tiepide) ·
> cooldown 120 s (dichiarato: il device sta a ~20 °C, ben sotto il
> target 30 °C che usava la cella K-F) · UNPLUGGED, floor 45%.
>
> **CONTROLLO INTERNO, ed è il motivo per cui d=0.65 è nello sweep:**
> d=0.65 senza prefetch È esattamente il braccio OFF della cella K-F a
> freddo — stesso binario, stesso modello, stessi flag. Deve riprodurre
> ~0.192 s/tok e ~22.3 GB. **Se non lo riproduce, la cella sta misurando
> altro ed è nulla.**
>
> **Attesa e kill dichiarati:** i byte devono scendere monotonicamente
> con d. **Se NON scendono, il flag non fa quello che stiamo affermando**
> e "l'expert skipping è la nostra modalità veloce" perde il meccanismo.
> Quell'esito è un risultato, non un fallimento, e va riportato.
> Esplorativa: niente p-value, niente pre-registrazione, niente claim.
> results/dropsweep_jelly/.
> ⚠️ **OPS — PERCHÉ SI È FERMATA A 11/12, E PERCHÉ LA MIA DIAGNOSI ERA
> TROPPO SICURA.** Lanciata staccata (`setsid nohup`), PPID=1 **provato
> da sessione nuova**, ed è sopravvissuta a più cadute di sshd: il
> distacco ha funzionato e sshd NON è la causa. Lancio 23:04:15, ultima
> run completata **23:34:26 = 30 min 11 s** — coincide col timeout
> schermo del device (30 min, la UI non offre "mai";
> `settings put system screen_off_timeout` da Termux è **rifiutato**,
> `INTERACT_ACROSS_USERS`).
> **MA ho dichiarato quella diagnosi con più sicurezza di quanta ne
> reggano i dati: oggi stesso la cella K-F è girata dalle 16:15 alle
> 17:05 = 50 MINUTI**, ben oltre i 30. Quindi il timeout da solo NON
> spiega tutto — la variabile probabile è se il telefono viene toccato
> nel frattempo. Resta un'ipotesi con un controesempio, non un fatto.
> **La conclusione operativa non cambia e non dipende dalla causa: una
> morte deve costare UN BLOCCO, non la corsa.** L'harness K-F sopravvive
> a essere ucciso di continuo perché ha `RESUME_AT` + void-scan; questo
> script non li ha. **Aggiungere il resume è la modifica che rende
> affidabili le celle lunghe su questo telefono**, qualunque sia la causa
> della morte. Nota: sul device ci sono **Termux:Boot e Termux:API**, non
> ancora sfruttati — un boot-script che riprende le celle interrotte è la
> via naturale.
> results/dropsweep_jelly/.
>
> ☠️ **IDEA 2 (k ADATTIVO SULLA CONFIDENZA DEL ROUTER) — MORTA IN UN
> MINUTO, A COSTO ZERO. Era il rank 1 mio E di Qwen.**
> Test dichiarato prima: se i bin ad alta confidenza sono troppo piccoli
> per muovere il k medio, l'idea muore. Eseguito sulle route trace che
> avevamo già (`results/f4.8/traces/long_512.route.tsv`, 26 200 gruppi
> token×layer, il campo `weight` È il peso della gate per slot):
>
> | quantità | p10 | p50 | p90 |
> |---|---|---|---|
> | entropia normalizzata (1 = piatta) | 0.919 | **0.967** | 0.988 |
> | gap top1−top2 (frazione di massa) | 0.007 | **0.044** | 0.138 |
> | peso del top-1 | 0.171 | **0.219** | 0.300 |
>
> **Il router non è quasi MAI confidente.** Quota di posizioni con
> entropia < 0.8 = **0.8%**; sotto 0.5 = **0.0%**. Anche concedendo k=2
> a ogni singola posizione di quel 0.8%, il k medio passerebbe da 6.000
> a 5.968: **niente**. La precondizione dell'idea non esiste.
>
> **E spiega F6 dal di dentro.** Il top-1 porta ~22% della massa routata
> e l'ottavo ~7%: scendere a k=2 conserva ~40% della massa. Ecco perché
> l'accordo argmax a k=2 misurava **0.6905** — non è un caso, è la
> geometria del router. È anche la versione *per-token* di M1 (top-16 =
> 25% della massa sul corpus): il routing è diffuso non solo FRA gli
> esperti, ma anche DENTRO il top-k selezionato.
>
> ⚠️ **Limite dichiarato:** la trace è su `Qwen3.6-35B-A3B-UD-IQ2_M` a
> **k=8**, non su KEXP a k=6. L'entropia è normalizzata sul numero di
> slot quindi il confronto regge, ed è la stessa famiglia — ma la
> conferma sul modello di campagna costa una run tracciata e va fatta
> prima di chiamarla chiusa definitivamente. Il segno però è così netto
> (0.8% contro una soglia che ne vorrebbe ~40%) che un ribaltamento è
> implausibile.
>
> ⚰️ **AUDIT OSTILE SUI KILL (16/08, mimo-v2.5 thinking max): 20 kill su
> 25 corretti, accuratezza 80%. Cinque buchi, e uno è un tesoro sepolto.**
>
> 🏴‍☠️ **(1) IL TESORO: 5.77× di PREFILL GPU misurato e poi RIDOTTO A
> 1.3-1.7× nel nostro stesso sommario.** Verificato al sorgente,
> `reports/moe-gdn-750.md:201-206`, Phase 3, Xiaomi 14 / Adreno 750,
> staccato, llama-bench r=2:
>
> | | pp128 | tg256 |
> |---|---|---|
> | CPU `-ngl 0` | 31.46 | **16.15** |
> | GPU `-ngl 99 -fa off` | **181.65** | 7.07 |
>
> Cioè **prefill GPU 5.77× la CPU**, e il report stesso concludeva
> «GPU-prefill on A7X: **alive and large** — 2.2× (740) to 5.8× (750).
> The TTFT lever is real across the whole A7X installed base».
> **Poi la riga di lane del PLAN l'ha registrato come "prefill GPU
> 1.29-1.7×" e ALIVE.md ha messo la GPU nel cimitero senza distinguere
> decode da prefill.** Una lane dichiarata VIVA dal suo stesso report è
> stata contabilizzata come morta. Ed è su **TTFT**, che questo piano
> chiama «LA priorità user-facing».
> ⚠️ **QUALIFICATORE DECISIVO, che l'audit non mette:** la misura è su
> **Qwen3.5-2B DENSO**, non sul 35B MoE. Per CalaQwen resta la
> Q7-LANDMINE (l'hook expert-ready dello streaming vive solo nel loop CPU
> di `mul_mat_id` → gli esperti del 35B DEVONO stare su CPU). Quindi il
> 5.77× vale per i **densi 2B/4B su Adreno 750-class**, che però sono
> proprio gli slot free-tier/piccoli del listino, e il dolore TTFT
> dell'app è il prefill del prompt di sistema da ~1.4k token — cioè
> esattamente prefill. **Da riaprire come lane TTFT sui densi**, non come
> lane MoE. Cautela: il vecchio claim "1.29× prefill GPU" sul 740 si
> rivelò un artefatto da cold-outlier, quindi il 5.77× va riverificato
> con la stessa severità prima di spenderlo — ma è su un altro device e
> un margine 4× più grande, quindi un artefatto lo spiega male.
>
> ✅ **(2) L'ablazione M4 renorm è il buco più caro, e l'audit ci arriva
> INDIPENDENTEMENTE.** Stesso verdetto già registrato sopra dopo l'audit
> Qwen: `drop_renorm` true di default, mai disattivato in nessun
> `command.txt`, il guadagno di PPL può essere sharpening. L'audit la
> classifica «highest-value missing measurement in the campaign», ~4 ore
> di PC, zero device. Due auditor indipendenti sulla stessa cosa.
>
> ❌ **(3) "Selfspec mai testata sul Jelly" — REFUTATA DA ME, il
> ragionamento è invertito.** L'audit dice: la selfspec è stata uccisa
> sullo Xiaomi dove lo stall è 6%, mentre il Jelly ha 27-30% di stall,
> quindi lì avrebbe «più margine da comprimere». **No: la selfspec non
> comprime i byte, li ESPANDE.** Dato nostro (D1): byte per token emesso
> 174 → 133 → 110 MiB man mano che le migliorie mordono, contro un plain
> a **50-60**. Cioè legge ~2× i byte del plain. Su un device dove i byte
> costano di PIÙ (flash lento), una penale del 2× sui byte fa **più**
> male, non meno. Il Jelly è il device PEGGIORE per la selfspec, non il
> più promettente. La regola "stall alto = più margine" vale per una
> tecnica che nasconde o riduce l'I/O, non per una che ne aggiunge.
>
> 🔧 **(4) Il kernel S2 non è mai stato misurato su silicio SENZA REPACK
> — e costa 5 minuti.** La build S23 ha REPACK ON, e il path fuso di S2
> lo bypassa: è esattamente il motivo per cui perde (restituisce più di
> quanto il taglio di launch compri). Su silicio senza REPACK anche lo
> stock userebbe `vec_dot`, e il taglio 84→28 launch potrebbe vincere.
> **Quel silicio ce l'abbiamo: il PC x86_64.** `results/kernel_s2/` ha la
> correttezza PC PASS ma **nessuna misura di velocità**. Un
> `llama-bench -r 2` ON/OFF chiude la questione. Se vince, il branch (già
> corretto e PR-abile) vale per iPhone Pro / ARM senza REPACK.
>
> 📉 **(5) La componente UX di K-F è stata abbandonata senza decisione.**
> Il kill come tecnica di THROUGHPUT è corretto e pre-registrato. Ma
> p99 −17%, stutter dimezzato e TTFT 12-18 vs 21-22 s a freddo sono
> misurati, e sono stati archiviati come nota fra parentesi invece che
> come decisione. Non serve nessuna misura nuova: i dati sono in
> `results/kf_burst/` e `results/kf_cold_jelly/`. Serve una scelta owner.
>
> **REFUTED (attaccati e hanno tenuto): 20 kill su 25** — F6, GPU decode
> (740 e 750), REAP-50, KEXP-G99, MTP, prefetch cross-layer, politiche di
> cache, taglia cache, ubatch, k<6, drop come leva compute, requant 1c,
> kernel IQ2, typeahead, phase-split, expert-major, predittore di route,
> LFM su G99. Sul drop-come-leva-compute l'audit ha verificato il
> sorgente e conferma: lo slot droppato è ricalcolato con peso zero, il
> matmul non si salta mai.
>
> 🧬 **NOTTE DELL'INVENZIONE (2026-08-15, mandato gualt "trucco mai
> provato"): 10 candidati, 9 kill onesti, UN VINCITORE DI CORSA.**
> Kill: cache-tricks tutti occupati (HOBBIT/DyMoE/SMoE/AdapMoE/
> ExpertFlow/Apple — bibbia related-work in docs/t2-novelty-round1-4);
> similarità e skew morti PER FISICA sui nostri modelli (esperti
> ortogonali cos~0.02; routing ad alta entropia: 96% esperti toccati in
> 300 tok, top-16=25% — LA PERLA: spiega le 45 riletture/tok e valida
> l'architettura hide-latency+weighted-drop); drop-asimmetrico morto
> (XShare: potare in prefill avvelena la KV, MMLU 51→27).
> **🏇 VINCITORE: "DRAFT SENZA STATO" (F)** — selfspec su ibridi con
> draft attention-only e GDN CONGELATO all'ultimo commit: il prefisso
> fantasma sparisce PER COSTRUZIONE, draft più economico, e la
> letteratura 2026 (Component-Aware SSD, arXiv:2605.01106) ha provato
> la POLARITÀ OPPOSTA (draft solo-SSM) fallendo con α=0.038 sui
> sequential hybrid — la loro ablazione predice che la NOSTRA polarità
> vinca. Nessuno l'ha pubblicata. Baseline da battere: 0.038. FRETTA: la
> finestra si chiude in mesi (ReplaySSM giu-2026, C-A mag-2026).
> **E4 IMPLEMENTATA (2026-08-15 pomeriggio, kalsa/selfspec-f1 @
> dc944f5, 11 commit):** spec docs/e4-stateless-draft-spec.md (as-built
> annotata); freeze = skip-write via eval-callback (nop del nodo store
> CPY/DUP, MAI snapshot/restore); catch-up con seq_rm SOLO-attention
> (scoperta review R1-F1: il seq_rm ibrido stock riavvolge R/S dai
> piani snapshot che i draft frozen non scrivono — il veleno rientrava
> dalla finestra); gate S2/S3 bitwise contro riferimenti shape-mirrored
> (R2-F1: batch-vs-serial >1e-3 al 100% su questo engine, tolleranze
> larghe VIETATE); verdetto automatico prima riga SUMMARY
> (GO≥0.60+EL1.5 / MARGINAL / DEAD<0.30 / PRODUCT per k2/k6 /
> BLOCKED). Audit: 3 round ostili + pass finale 3-auditor
> (deepseek/hy3/mimo) + conferma — tutto verde, ctest 11/11.
> Letteratura (RELATED.md nel task dir): SP-MoE, C-A SSD (α=0.038 è
> ALL-TOKEN a k=2 — confronto onesto = alpha_alltok), ReplaySSM (stesso
> primitivo skip-write, uso diverso: I/O non drafting — conferma
> indipendente + urgenza), LayerSkip (early-exit 50% su ibridi
> sequenziali = α 0.000: MAI saltare i GDN, solo congelarne la
> scrittura). RUNNER NOTTURNO ARMATO: results/selfspec_e4/
> run_e4_arms.py (PID in runner.pid.txt) aspetta fine dropcurve →
> A2 G=8 (refs O(B²/G) più economici) → A1 G=4 (headline) → A3 k2
> (prodotto). Poi, se GO: F5 loop reale; cella device su S23 con
> CalaQwen IQ2_M (modello già a bordo, serve build Android).
> **🚨 E4 PRIMO RISULTATO REALE (2026-08-16 01:54, CalaQwen-35B PC,
> rev c977d58, wall 4073s): A2 G=8 →
> `E4_GO_PENDING_G4(alpha1=1.000, EL=3.556)`. Tutti e quattro i gate
> BITWISE VERDI (S1 identity 300/300 dlogit=0 dopo il fix ref-su-ctx_dft;
> S2 leftover 38/38=0; S2 freeze-read 38/38=0; S3 post-catch-up 37/37=0):
> il congelamento NON contamina e il catch-up ricostruisce esattamente.
> Curva accettazione: α_s0 0.974 · **α_s1 1.000** · α_s2 0.789 ·
> α_s3 0.579 · α_s4 0.486 · α_s5 0.541 · α_s6 0.378 · α_s7 0.378 —
> macro 193/300 = 0.643, **E[L] = 3.556 token per verify a G=8**.
> Confronto onesto col paper mirror (Component-Aware SSD, polarità
> opposta, α=0.038 all-token a k=2): il nostro α_s1 = 1.000 e il macro
> 0.643 stanno **oltre un ordine di grandezza sopra**. `alpha_alltok(G=8)
> = 0.000` è atteso (richiede 8/8 token corretti di fila).
> **🏆 A1 G=4 — VERDETTO UFFICIALE (2026-08-16 03:39, wall 6303s):
> `E4_GO(alpha1=0.987, EL=2.995)`. Gate di nuovo tutti bitwise (S1
> 300/300, S2 75/75, S2 freeze-read 75/75, S3 74/74, max|dlogit| = 0).
> α_s0 0.947 · α_s1 0.987 · α_s2 0.733 · α_s3 0.627 → macro 247/300 =
> **0.823**, **E[L] = 2.995 token per verify**. E soprattutto:
> **alpha_alltok(G=4) = 0.413** — QUESTO è il numero confrontabile col
> paper specchio (Component-Aware SSD, α=0.038 all-token): ~11× sopra,
> a parità di k.
> **🏁 A3 PRODOTTO (04:24, wall 2711s): `E4_PRODUCT(alpha1=0.867,
> EL=2.029)` a draft k=2 / verify k=6. Gate di nuovo tutti bitwise.
> α 0.800 · 0.867 · 0.547 · 0.413 → macro 0.657, E[L] 2.029,
> **alpha_alltok = 0.173 — QUESTO è il confronto apples-to-apples col
> paper (0.038 a k=2): 4.6× sopra, stesso budget di draft, polarità
> opposta.** E4_ARMS_DONE, tre bracci su tre.
> **MA: E[L] NON è speedup.** E[L] = Σ prodotti-prefisso = draft
> ACCETTATI per ciclo (session.cpp:2458), +1 dal verify → 3.03 token per
> ciclo a k2γ4. Il loop vince solo se γ·costo(draft k2) + verify-batch +
> catch-up < 3.03 passi a k6, e il termine ignoto è l'overlap di batch:
> la NOSTRA misura di entropia (96% esperti in 300 tok, top-16=25%, 45
> riletture/tok) dice che token consecutivi routano a insiemi quasi
> DISGIUNTI → il batch di verify streamma ~5×, non 1×. Quindi il premio
> non è il batching ma il draft più economico — ed è esattamente perché
> F1 misurò 0.37×. **PREDIZIONE REGISTRATA per F5: estendi γ solo finché
> il prodotto-prefisso supera k_d/k_v (0.33) → γ=3 ottimo a k=2, γ=4 già
> sovra-esteso; a k pari (ratio 1.0) NESSUNO slot qualifica — a1/a2 sono
> bracci scientifici, mai candidati prodotto.**
> **🔥 F5 — L'INVENZIONE FUNZIONA NEL LOOP VERO (2026-08-16, 35B hybrid,
> 256 token, k2/k6 γ=4, `--chatml`): freeze OFF alpha di loop 8.6%
> (51/594), 1.25 token/verify · freeze ON **24.6% (126/512), 1.97
> token/verify**. **2.9× di alpha cambiando SOLO il flag.** Il braccio
> OFF riproduce la baseline pubblicata di F1 (0.117), quindi il
> confronto è pulito. Riprodotto su DUE binari diversi (d31ad8d
> 08d16910 e 2a7f365 524973b8) con conteggi BIT-IDENTICI — greedy
> deterministico, e vale anche da regressione del fix round.
> Meccanismo: senza freeze ogni rifiuto riavvolge lo stato ricorrente
> dai piani snapshot, ed è proprio il restore che E4 aveva dimostrato
> sbagliato (R1-F1); col freeze non c'è riavvolgimento, la riga viva È
> s_t0. L'alpha guadagnato è la rimozione di un difetto di stato, non
> un bonus. RAM: 251.25 MiB risparmiati a γ=4 (misurato).
> **MA sul PC la selfspec PERDE comunque** (5.99 plain vs 1.82
> effettivi) e il prefill quasi raddoppia (19.1→37.0s: il contesto
> draft rifà il prefill del prompt). Il caso velocità vive o muore su
> flash — arm D1. Codice: 3 round di audit ostile, 6+2+? findings
> CONFIRMED, tutti chiusi con test-che-falliva-prima.
> results/selfspec_f5_pc/.**
> **🧪 F5 CHAT MULTI-TURNO (16/08 mattina) — la prova nel caso d'uso
> vero.** Sonda `chat_multiturn.py` via `bmoe-cli --session`, 3 turni,
> `clear_kv:false` dal 2°: **senza freeze l'accettazione decade 3.9×
> lungo la conversazione (0.117 → 0.100 → 0.030); col freeze non
> decade (0.183 → 0.275 → 0.138), al 3° turno 4.6×.** Token emessi
> identici nei due bracci (governa il target). Freeze verificato per
> run dall'allocatore (draft ctx n_rs_seq=0 / 62.81 MiB), non assunto.
> Braccio flag-off BIT-IDENTICO prima e dopo i fix: la feature non
> tocca chi non la usa.
> **AUDIT: 3 round + 3 finali su angoli/modelli diversi → 11 finding
> CONFIRMED, 6 chiusi con test-che-falliva-prima (F5 fix a b3eb60c).
> E TRE spiegazioni alternative proposte dagli auditor SONO CADUTE SUI
> DATI:** (a) "il riuso del grafo vanifica il freeze" → 512 draft/130
> cicli ≈ γ=4 e canary muto; lo skip-write vive nell'ask di compute,
> non nel build; (b) "il guadagno viene da clear+rebuild a ogni
> rifiuto" → un prefill costa 39s e p2 ha fatto 130 cicli in 187s, e
> ha letto 32.8 GiB contro 51.8; (c) "il modello di chat è non-hybrid"
> → l'allocatore nei log stessi dice n_rs_seq=0/62.81 MiB.
> **RITRATTAZIONE ONESTA:** la prima tabella di velocità F5 misurava
> prefill, non decode (le run avevano generato 1 token; nessun gate di
> validità). Ritirata. Ne è uscito però un costo reale: **la selfspec
> quasi raddoppia il prefill (+94%)** perché il contesto draft rifà il
> prefill del prompt — non ammortizzabile su risposte corte.
> results/selfspec_f5_pc/ (REPORT + 5 audit archiviati).
> Report completo: reports/moe-selfspec-e4.md. Spec F5 aggiornata
> (arm D2 = γ ∈ {2,3,4}). **F5 NON lanciato: il classifier ha bloccato
> l'avvio di grok con --always-approve mentre l'owner dorme — prompt
> pronto in scratchpad/agents/f5-impl/prompt.md, serve ok owner.**
> **F5 SPEC SCRITTA (docs/f5-stateless-loop-spec.md) — e rileggendo F1 è
> saltato fuori che il premio grosso non è la velocità ma la RAM: il
> loop F1 deve chiedere `n_rs_seq = draft_max` snapshot ricorrenti sul
> contesto draft = **251.25 MiB di snapshot a γ=4 su questo 35B** (MISURATO
> 2026-08-16: buffer RS 314.06 MiB a n_rs_seq=4 contro 62.81 a 0; la riga viva
> resta). Col congelamento il
> draft non scrive MAI stato ricorrente e il rollback è solo-attention →
> `n_rs_seq = 0`, quei 251.25 MiB non vengono allocati e γ diventa gratis
> in memoria. Su un telefono da 8 GB è un fatto di prodotto anche se la
> velocità non paga. ATTENZIONE ONESTÀ: gli α di E4 sono teacher-forced
> (classe F0 0.6991); il loop vero F1 è crollato a 0.117 — l'α di loop
> lo dà solo F5, non si cita 0.643 come numero di loop.**
> **DROPCURVE VERDETTO (notte 15-16/08): DROPCURVE_OPTIMUM(dstar=0.5,
> dMacro=−0.0150). IL CLAIM VIVE: potare gli esperti freddi MIGLIORA
> la PPL multilingue — minimo reale a d=0.5 (−0.0015 sotto k6d0,
> −0.0150 sotto k8), rumore run-to-run 1e-6 (continuità d065 e d1.0
> riprodotte a 6 e 4+ decimali: protocollo deterministico, corpus
> fisso — la generalizzazione cross-corpus resta il vero margine).
> Curva: d0 −0.0135 · d0.3 −0.0122 · d0.5 −0.0150 · d0.65 −0.0086 ·
> d0.8 +0.0047 · d1.0 +0.0378. Nota prodotto: la certificata d0.65 è
> leggermente OLTRE l'ottimo; d0.5 = +qualità, −risparmio I/O —
> ritocco a discrezione owner. results/mellum2_dropcurve/.**
> 3 survivor ingegneristici senza claim (controller stutter
> ExpertFlow-style, repack lazy hot ×1.27, corazza anti-zram).**
> 📈 **DROPCURVE CALAQWEN (16/08, IN CORSO sul PC) — l'expert skipping è
> la leva viva della campagna, e la qualità a d0.3 è GRATIS.**
> Stesso protocollo della curva Mellum ma sul modello di campagna
> (`Qwen3.6-35B-A3B-KEXP`, sha ac44e20c…), 5 lingue multi5, ~59k token
> per braccio, identity MATCH (modello + binario + 5 DLL).
>
> | drop | macro bpb | vs k6d0 | gate |
> |---|---|---|---|
> | 0.0 | 0.6781 | — | GATE_PASS |
> | **0.3** | 0.6785 | **+0.0004 (+0.06%)** | GATE_PASS |
> | 0.8 | 0.6889 | +0.0109 (+1.6%) | GATE_PASS |
> | 1.0 | in corso (en: bpb 0.6021) | — | — |
>
> **Il costo NON è lineare: piatto fino a 0.3, poi sale piano.** A d0.3 il
> +0.06% è sotto qualunque soglia di rilevanza — qualità gratis. La sonda
> preliminare aveva già deciso di fermarsi a 1.0 (rifiuta d>1.0), quindi
> k6d12/k6d15 non girano.
>
> ⚠️ **I TEMPI DI QUESTA CELLA NON SONO CONFRONTABILI FRA BRACCI — e va
> detto prima che qualcuno ci costruisca sopra.** Ogni braccio ha girato
> con una quantità DIVERSA di contesa CPU da altri job: d0.0 all'8% del
> suo wall, d0.8 al 100% (sonda F6 addosso), d0.3 al 100% (ed è infatti
> il più lento misurato, 4.589 tok/s — contesa pura), d1.0 a contesa
> ZERO (F6 uccisa alle 19:2x, braccio partito alle 19:50). Il d1.0 su en
> misura 8.822 tok/s contro i 5.577 di d0, ma **quel +58% è gonfiato
> dall'avere la macchina da solo**. Le bpb sono deterministiche e salve;
> i tempi no. **La cella che manca è quindi: throughput E BYTE, senza
> contesa, tutti i bracci nelle stesse condizioni** — e i byte non sono
> mai stati strumentati in questa cella (`per_token.csv` ha solo
> pos,token_id,logprob). È il lavoro numero uno appena il PC si libera.
> results/calaqwen_dropcurve/.
> 🧮 **L'INVARIANTE CHE DECIDE TUTTO (16/08, brainstorm con Qwen 3.8
> Max, verificato da me).** Con verifica a batch: byte/token =
> `[γα + (γ+1)β]/L` e `L ≤ γ+1`; con verifica sequenziale early-stop:
> `β + γα/L`. **Se β ≥ 1, byte/token ≥ 1 ANCHE con draft gratis (α=0):
> la speculazione al massimo PAREGGIA, non vince mai.** Quindi l'unica
> via è **β < 1**: la verifica deve leggere meno byte di una
> generazione normale. Conseguenza immediata: la direzione "draft a
> zero byte" (che avevo messo prima) non poteva funzionare da sola —
> ottimizzava il termine da 1.33 lasciando quello da 5.0. E il prefetch
> non tocca i byte per definizione. **L'unica porta aperta: certificare
> costa meno che generare.** Generare vuole l'argmax su tutto il
> vocabolario → tutti i 6 esperti. Certificare un candidato vuole solo
> mostrare che vince → può bastare un bound sul contributo dei mancanti.
> ☠️ **PROBE F6 — DEAD ON BYTES (16/08, chiusa).** Accordo argmax a
> k=2..5 contro k=6, teacher-forced su CalaQwen, EXACT-RESTART, d0,
> 1037 posizioni × 4 set (fact/creative/longfact/code). Break-even
> dichiarato prima: β < 0.56 → meno di ~3.3 esperti medi. **Check
> dell'harness superato in pieno: k=2 = 0.6905, identico a F0 a quattro
> decimali** — quindi il DEAD è un dato, non un bug sospetto.
>
> | j | accordo | n | esperti medi | β |
> |---|---|---|---|---|
> | 2 | 0.6905 | 1037 | 3.24 | 0.540 |
> | 3 | **0.8120** | 1037 | 3.56 | **0.594** |
> | 4 | 0.8640 | 1037 | 4.27 | 0.712 |
> | 5 | 0.8685 | 555 (parziale) | 5.13 | 0.855 |
>
> k=3 cade in pieno nella banda DEAD pre-dichiarata (0.75–0.85) contro
> una soglia GO di ~0.95. **Solo j ≤ 3 poteva funzionare**: a j=4 il
> pavimento è già 4/6 = 0.667 > 0.56, a j=5 è 0.833 — cioè j≥4 fallisce
> per costruzione anche con accordo perfetto. j=3 sbaglia del 6%; j=2 dà
> 0.540, nominalmente sotto soglia del 3.6%, ma **l'accordo argmax è un
> UPPER BOUND sulla certificabilità** (certificare richiede di provare
> il vincitore con un bound sui mancanti, test più stretto del semplice
> "l'argmax ha coinciso"): costruirci sopra vuol dire costruire sulla
> barra d'errore. Split per dominio come in F0: longfact/code 0.85-0.92,
> fact/creative 0.52-0.86 — sopravvive sul testo prevedibile, non sui
> token difficili.
>
> **La ragione vera che ritira la tecnica è che la baseline si è mossa,
> ed era la nota onesta registrata in anticipo.** La drop curve conferma
> il premesso dall'altro lato: droppare gli esperti freddi a 0.8 costa
> **+0.0109 macro bpb (+1.6%)**, GATE_PASS. La qualità non ha bisogno di
> sei esperti. Quindi il confronto giusto per β non è contro il plain
> k=6 ma contro il plain GIÀ alleggerito, che legge molti meno byte e non
> vuole draft, verify, rollback né stato ricorrente congelato.
> (Scope: il +1.6% è una misura di QUALITÀ; il risparmio in byte di
> `--drop-cold-experts` è lo scopo del flag ma non è misurato in quella
> cella — l'argomento regge sulla direzione, non su una magnitudine non
> misurata.)
>
> **Buco dichiarato, non aggirato:** i margini top1-top2 sotto set
> parziali — la quantità che predice davvero il costo di uno schema
> adattivo — **l'engine non sa emetterli** (`engine_top2_logits: false`;
> il `--ppl-csv` dà il logprob del solo token gold). Nessun margine è
> stato inventato. Non cambia il verdetto (il pavimento j≥4 è
> strutturale e j≤3 non ha spazio) ma è l'unica porta lasciata chiusa, e
> aprirla richiede una modifica all'engine.
> Chiusa per decisione owner appena il verdetto è stato determinato:
> k=1 mai partito, k=5 parziale (555/1037), entrambi dichiarati.
> Nessun timing riportato (macchina condivisa con la drop curve; le
> quantità misurate sono deterministiche). ~5 ore di sonda hanno ucciso
> una tecnica che sarebbe costata settimane. results/f6_certify_probe/.
>
> ☠️ **"DRAFT BY DROP" — MORTA IN 2 ORE, PRIMA DI SCRIVERE UNA RIGA
> (16/08, audit Qwen 3.8 Max su docs/qwen-prompt-drop-draft.md).**
> Proposta: usare `--drop-cold-experts 0.8` come DRAFT e il config pieno
> come VERIFY → output bitwise identico al modello pieno, e finalmente
> il "draft 5-10× più economico della stessa famiglia" che avevo
> dichiarato mancante quando ho scartato la coppia densa 2B/4B (rapporto
> 0.755, troppo vicino). **Falsa.**
>
> **L'errore, mio, grave: ho assunto c_draft = 0.2 senza misurarlo.**
> Il nostro stesso dato dice 6.401 vs 5.807 tok/s → il config drop-0.8
> costa **0.91×** il pieno, non 0.2×. Droppare l'80% degli esperti
> FREDDI non è droppare l'80% del LAVORO, e la nostra throughput lo
> dimostrava già. Quindi il draft economico **non esiste**: 1.1×, cioè
> *peggio* del 4B/2B a 0.755 che avevo già scartato per questo motivo.
> Conseguenza aritmetica (γ=4, c_v=1, accettazione PERFETTA):
> `L_max/(4·0.91+1) = 5/4.64 = 1.08×`. Con c_v=2 → **sotto 1**. Morta
> prima ancora di parlare di accettazione. Il numero era nel prompt,
> nella sezione 4, e l'ho contraddetto nella sezione 5.
>
> **Secondo colpo — bpb NON è un proxy dell'accettazione.** La bpb è
> liscia, l'accettazione greedy è una soglia sul margine top1-top2:
> p=[0.501,0.499] vs q=[0.499,0.501] ha cross-entropy quasi identica e
> ribalta l'argmax il 100% delle volte. Pinsker (TV ≤ √(Δ/2)) lega la
> KL all'accettazione **campionata**, non a quella greedy. Quindi il
> ponte "+1.6% bpb → il draft sbaglia poco" è un non sequitur.
> **E c'è di peggio, deducibile dai nostri dati senza misurare nulla:**
> se ~5 dei 6 esperti sono freddi, drop-0.8 ne butta ~4 e ne tiene ~2 —
> cioè un k≈2 scelto per RESIDENZA invece che per rango del router.
> Il top-2 (la scelta MIGLIORE) dà 0.6905 di accordo; una scelta peggiore
> non può fare meglio. **α del draft-by-drop ≲ 0.69, non 0.9.**
>
> **Terzo colpo — osservazione che non era nostra: la cache è un secondo
> stato non riavvolgibile.** Abbiamo congelato il GDN, ma il draft che
> carica/sfratta esperti sporca la expert-cache, e quelle side effect
> **sopravvivono al rigetto**. Se il draft è resident-only non inquina ma
> non scalda nulla di utile; se carica esperti freddi inquina. Nessun
> pasto gratis. In più il draft diventa NON stazionario: dipende da
> LRU e dalla storia di accept/reject, quindi ogni misura teacher-forced
> è strutturalmente cieca su questo.
>
> **Anche il verify batch a costo 1 era ottimistico, e contraddiceva un
> nostro risultato:** con token consecutivi che routano a esperti quasi
> disgiunti (96% toccati in 300 token — la nostra misura), un batch da 5
> tocca ~5× i pesi, non 1×. È esattamente il motivo per cui avevo detto
> che il batching non ammortizza su questo MoE.
>
> **Dove Qwen è pessimista senza che cambi il verdetto:** stima la
> residenza con routing uniforme (2000 MiB/13.4 GB → ~38 esperti su 256
> → ~0.9 hit su un top-6). Il nostro routing è skewed e l'LRU lo sfrutta:
> `hit_pct` misurato nelle celle K-F sta a ~52%, non 15%. Ma non salva
> niente, perché l'ancora decisiva (c_d = 0.91) è **misurata in wall
> clock** ed è indipendente da quel conto.
>
> **Verdetto: la proposta ha una storia di CORRETTEZZA ma non di
> PRESTAZIONI.** In regime I/O-bound l'invariante la uccide (verify
> esatto → β=1). In regime compute-bound è morta sull'aritmetica con
> numeri che avevamo già. Nessuna misura da fare: la sonda argmax che
> avevo pianificato è un gate asimmetrico (male → uccide, bene → non
> salva), quindi non la lanciamo.
> **Cosa sopravvive e va spedito da solo:** `--drop-cold-experts` come
> MODALITÀ VELOCE LOSSY, senza speculazione sopra. Curva qualità:
> d0.3 = **+0.06%** bpb (gratis), d0.8 = +1.6%. Manca la misura che la
> rende spedibile: **throughput E byte, senza contesa** (la cella attuale
> non ha strumentato i byte e i timing sono confusi dalla sonda F6).
>
> 💡 **CINQUE DIREZIONI NUOVE (16/08, generate rileggendo tutta la
> campagna; in audit da Qwen 3.8 Max — `docs/qwen-prompt-5-wild-ideas.md`).**
> Ognuna è ancorata a una NOSTRA misura, non a un'intuizione, e **quattro
> su cinque hanno un test decisivo che costa ZERO tempo device** perché
> gira sulle route trace che abbiamo già. Nessuna è approvata: sono in
> attesa del verdetto "già pubblicata / morta di fisica / test non
> decisivo".
>
> **(1) EXPERT-MAJOR DECODING — l'unica che può riaprire β<1.** I token
> consecutivi routano a esperti disgiunti (M1), ma quello che determina
> il traffico flash non è la SOMMA (6B) bensì l'**UNIONE** degli esperti
> del batch. Riordinare il calcolo per-esperto invece che per-token:
> carichi E una volta, lo applichi a tutti i token del batch che lo
> vogliono. Se `|unione(B)|/B < 6` allora **β < 1** e tutto il caso
> speculazione chiuso da M2/M3 si riapre su un meccanismo diverso.
> Test: calcolare il rapporto di unione per B=2,4,8,16,32 dalle trace
> esistenti. Kill: rapporto piatto a 1.0 (routing troppo entropico).
> Da chiedere: è lo scheduling standard dei MoE server (expert
> parallelism DeepSpeed-style) riletto con un collo di bottiglia nuovo?
>
> **(2) k ADATTIVO SULLA CONFIDENZA DEL ROUTER.** Il router gira sulla
> parte densa, già residente → la sua uscita è disponibile **prima di
> leggere un solo byte di esperto**. Gate top-1 dominante → k=2; gate
> piatta → k=6. E a differenza del drop (M5, solo-I/O), **k taglia byte
> E compute**. Test: binnare le posizioni per entropia del router e
> misurare l'accordo argmax di k=2/k=3 dentro ogni bin. Kill: accordo
> piatto fra i bin (la confidenza del router non predice la stabilità
> dell'argmax) — kill pulito e a costo zero.
>
> **(3) PREDITTORE DI ROUTE DALLO STATO RICORRENTE CONGELATO.** Non
> predire il TOKEN, predire l'INSIEME DI ESPERTI. Sonda lineare dallo
> stato GDN (62.81 MiB, in RAM, che sappiamo leggere bitwise — M6) verso
> 256 punteggi. Predire un insieme è molto più facile che predire un
> argmax, e costa **zero byte di flash** — attacca esattamente il modo in
> cui K-F ha fallito (M7: +14% di byte per nascondere lo stall). Test:
> allenare offline su trace e misurare la recall top-6 a un token di
> anticipo, contro due baseline (K-F 76% e "gli esperti del token
> precedente"). Kill: se la baseline banale pareggia la sonda. Il combo
> ibrido+streaming è dove forse siamo soli.
>
> **(4) MASCHERE DI ESPERTI PER LINGUA, SPEDITE COME METADATA.** Se il
> miglioramento di PPL a drop 0.5 (M4) è perché gli esperti freddi sono
> RUMORE sotto-allenato per il dominio corrente, allora una maschera
> scelta **per lingua** deve battere una scelta per residenza in cache,
> che con la linguistica non c'entra nulla. Istogramma offline per
> lingua → maschera statica → metadata nel GGUF → detect lingua dai primi
> token. Test: multi5 che abbiamo già, confronto **a parità di byte**.
> Kill: nessun vantaggio a parità di byte (e allora M4 resta un mistero
> più profondo, non risolto). **Ho chiesto esplicitamente a Qwen di
> ATTACCARE M4**: un miglioramento di PPL togliendo calcolo è il tipo di
> risultato che di solito è un artefatto, meglio saperlo prima.
>
> **(5) QUANTIZZAZIONE PER TEMPERATURA.** Buttare un esperto è il caso
> estremo di quantizzarlo a zero bit; la versione continua dovrebbe
> dominare quella binaria. Caldi Q5/Q6, tiepidi Q4, coda fredda Q2 — un
> solo GGUF, precisione per-esperto chiavata sulla frequenza di accesso
> **misurata** (non su statistiche dei pesi). È l'unica che taglia byte
> senza policy e senza dirupo di qualità: è un cambio di formato file,
> non una scommessa a runtime. **Kill noto in anticipo, e ci ha già
> fregati due volte (KEXP-G99, REAP): su silicio debole meno byte ≠ più
> decode** — KEXP su G99 era dequant-bound sui 2×A76 (8.83 contro una
> proiezione 14.7). Il test DEVE misurare il decode sul device DEBOLE,
> non i byte sul forte.
>
> ⚖️ **AUDIT QWEN SULLE 5 IDEE (16/08) — ranking, due kill, e un colpo
> al cuore di M4 che ho dovuto verificare al sorgente.**
> Ranking per valore atteso: **(2) k adattivo > (5) quantizzazione per
> temperatura > (4) maschere per lingua > (3) predittore di route >
> (1) expert-major**. Le prime due sopravvivono, le ultime due sono da
> archiviare, la (4) è sospesa in attesa di un'ablazione.
>
> ☠️ **IDEA 1 (expert-major) — MORTA per il nostro regime.** L'aritmetica
> dell'unione con la NOSTRA skew: B=8 → 42/48 = 0.88; B=16 → 0.81;
> B=32 → 0.65. Serve **< 0.56**, cioè B≈64, e su un telefono
> single-user quei 64 token non esistono. Due argomenti che mi ero
> perso: (a) **in una sequenza causale singola non puoi riordinare per
> esperto** perché le route future non le conosci finché non le hai
> calcolate — l'expert-major funziona su item di batch INDIPENDENTI,
> non su un'autoregressione; (b) **se la cache LRU tiene ~38 esperti e
> l'unione di 5 token è ~28, la cache sta GIÀ leggendo l'unione e non
> la somma** — l'expert-major aiuterebbe solo se il nostro chunking
> fosse rotto. E lo scheduling per-esperto è standard nei sistemi MoE
> (DeepSpeed-MoE, Megablocks, Tutel, FasterMoE). Archiviata.
>
> ☠️ **IDEA 3 (predittore di route) — MORTA, e l'errore era retorico.**
> Avevo venduto "legge zero byte di flash". Vero e **irrilevante**: il
> predittore legge zero byte, ma **il prefetch che ne consegue li
> legge**. È esattamente M7 (76% di precisione, +14% byte, −4.3% wall).
> Un predittore migliore deve battere non il caso ma l'ECONOMIA dei
> byte sprecati, e la metrica giusta non è la recall top-6 ma il
> *guadagno wall per byte extra prefetchato*. In più è pubblicata
> (ExpertFlow, MoE-Infinity, Pre-gated MoE); l'unico angolo forse nuovo
> era l'input SSM/GDN, ma la novità dell'input non ripara l'economia.
>
> ✅ **IDEA 2 (k adattivo sulla confidenza del router) — RANK 1, e il
> caveat di Qwen NON ci si applica.** Lui avverte: "se l'output esatto
> a k=6 è un vincolo duro, l'idea muore". **Da noi non lo è**: la
> ricetta certificata SPEDISCE già `--n-expert-used 6` (da k=8) e
> `--drop-cold-experts 0.65`, cioè una config lossy passata da un gate
> PPL. L'idea sta dentro il contratto che abbiamo già. Resta l'obiezione
> teorica seria: **la gate del router misura la preferenza di ROUTING,
> non la decisività dell'OUTPUT** — un esperto con gate piccola può
> comunque ribaltare l'argmax se il margine top1-top2 è sottile.
> Test aggiornato (migliore del mio): non solo accordo per bin, ma anche
> **k medio implicito + bpb su held-out + confronto contro k statico E
> contro drop-cold a parità di byte/compute**. Kill: accordo piatto fra
> i bin, o bin ad alta confidenza troppo piccoli per muovere il k medio.
>
> ✅ **IDEA 5 (quantizzazione per temperatura) — RANK 2, la più
> spedibile e la meno originale** (MoQE, QMoE, HAQ/HAWQ). Sequenziamento
> di Qwen, migliore del mio: **prima il microbenchmark di dequant sui
> formati candidati sul device DEBOLE**, poi si costruisce il GGUF misto.
> Così sai quali formati sono permessi prima di spendere la pipeline.
> Rischio aggiuntivo che non avevo scritto: la frequenza di accesso è
> corpus-dipendente — un esperto freddo nel nostro istogramma può essere
> caldo per una lingua a bassa risorsa, per il codice o per la matematica.
> **La PPL macro nasconde il fallimento sulle route rare** → misurare la
> qualità CONDIZIONATA ai token che routano sugli esperti a bassa
> precisione, non solo la media.
>
> 🔬 **IDEA 4 / M4 — IL COLPO GROSSO, E LA VERIFICA AL SORGENTE.**
> Qwen sostiene che M4 (drop 0.5 MIGLIORA la PPL) ha una spiegazione
> banale: dato che lo slot droppato è ripuntato sul top expert (M5),
> l'intervento non sarebbe "togli l'esperto freddo" ma
> `y' = y − g_j·E_j + g_j·E_top`, cioè **un boost del top expert**.
> **VERIFICATO AL SORGENTE (`router_hook.cpp:267-268`): la formula di
> Qwen è SBAGLIATA.** Il peso viene messo **a zero**, non trasferito:
> `*weight_at(...) = 0.0f; *id_at(...) = best_id;` — e il commento dice
> perché il repoint esiste: far leggere al kernel memoria valida «and
> multiply it by exactly zero». Il dot duplicato contribuisce ZERO.
>
> **MA la sua intuizione si salva su un altro ramo, e questo cambia
> tutto: `drop_renorm` è TRUE di default** (`config.h:175`; si spegne
> con `--drop-no-renorm`), e **la dropcurve NON lo ha mai spento**
> (verificato nei `command.txt`). Quindi il codice che gira è
> `router_hook.cpp:278-282`: i sopravvissuti vengono riscalati per
> `total/kept > 1`. E siccome **il top expert non è mai droppabile**
> (riga 262, `k != best`), la rinormalizzazione concentra massa su un
> insieme superstite top-heavy. **Cioè: è mixture sharpening.**
> Formula vera: `y' = (total/kept) · Σ_{superstiti} g_i·E_i(x)`.
> Quindi il miglioramento di PPL può venire dallo SHARPENING e non dal
> togliere rumore — Qwen ha sbagliato il meccanismo e azzeccato la
> sostanza. **Non si costruiscono maschere per lingua finché M4 non è
> spiegata.**
>
> 🎯 **E L'ESPERIMENTO DECISIVO È UN FLAG CHE ABBIAMO GIÀ.**
> Bracci: (A) d=0.5 renorm ON = comportamento attuale · (B) d=0.5
> **`--drop-no-renorm`** = rimozione pura senza riscalatura ·
> (C) d=0 baseline · (D) controllo di Qwen: drop di esperti **a caso**
> allo stesso conteggio, renorm ON.
> Lettura: **A > B ≈ C → il guadagno è la rinormalizzazione**, l'idea 4
> è costruita sulla sabbia — ma avremmo trovato una **leva di qualità
> gratis che non richiede NESSUN risparmio di byte** (basta sharpare le
> gate). **A ≈ B > C → il rumore degli esperti freddi è reale** e
> l'idea 4 vive. Se anche (D) migliora, è sharpening puro.
>
> ⚠️ **E una nota di onestà che indebolisce M4 già ora:** il
> miglioramento sotto zero è un risultato **MELLUM** (d0.5 = −0.0150).
> Sulla curva CalaQwen il minimo è a d=0 (0.6781) e d0.3 sta
> marginalmente SOPRA (+0.0004) — cioè su CalaQwen il miglioramento
> **non si vede**. Prima di chiamarlo "il nostro risultato più strano"
> va detto che finora è di un modello solo.
>
> **Cosa NON tocca:** quel che resta di F5 è intatto e resta vero —
> l'acceptance quasi raddoppia come meccanismo di CORREZIONE (loop alpha
> 8.6% → 24.6%) e il freeze salva **251.25 MiB** misurati di RAM. Non
> erano claim di throughput in byte. **Il caso BYTE della decodifica
> self-speculative su questa architettura è chiuso.**
> **DENSI (Qwen3.5 2B/4B, misurato su Xiaomi 16/08):** `qwen35` = denso
> MA IBRIDO (24 layer GDN su 32) → il freeze serve anche lì, e stando in
> RAM il batch AMMORTIZZA (prefill/decode = 2.33×), cioè il regime dove
> la speculazione può pagare. **MA il 4B ha 2.24× i pesi del 2B e va
> solo 1.32× più lento** → draft/target = 0.755, troppo vicino: con γ=4
> spendi ~3 passaggi-target per guadagnarne ~2.4. Servirebbe un draft
> 5-10× più economico (un ~0.6B della stessa famiglia), che non abbiamo.
> `--ngram` provato: drafta sul 2.5% dei passi (testo non ripetitivo),
> inutile. **E varianza del device ±50% fra run consecutive (3.99 →
> 8.27 tok/s stesso modello/config): qualunque claim di velocità sui
> densi richiede coppie ABBA, due run back-to-back non provano nulla.**
> ⛔ **F5 ARM D1 SU FLASH (16/08, Xiaomi, ESPLORATIVO): NULL. La
> self-speculation perde anche su telefono.** 12/12 run valide,
> intercalate a/b/c/d × 3, n=200, staccato 70→46%, 28.9→40.1 °C.
> plain **1.654 tok/s** · freeze OFF γ4 0.563 (**0.34×**) · freeze ON γ4
> 0.657 (**0.40×**) · freeze ON **γ3 0.720 (0.44×)**. Il freeze fa il
> suo (alpha 13.9→23.6%, RS 314.06→62.81 MiB) e γ=3 batte γ=4 come
> predetto — ma serve 2.3× e se ne recupera 1.3.
> **IL DATO CHE ORIENTA IL SEGUITO: i byte per token emesso scendono
> 174 → 133 → 110 MiB man mano che le migliorie mordono.** Il plain sta
> a ~50-60. Quindi non è "non funziona": **manca ~2×, e la grandezza su
> cui prenderlo è nota**. La speculazione su questo modello LEGGE PIÙ
> byte di quanti ne risparmi (verify batch senza ammortamento: token
> consecutivi routano a esperti quasi disgiunti — la stessa entropia
> misurata nella notte dell'invenzione). Direzioni aperte (brainstorm
> in corso, anche con Qwen 3.8 Max): (1) draft che leggono ZERO byte
> nuovi (solo esperti già residenti in cache / shared expert); (2) un
> solo contesto con k commutato → via il prefill doppio (+94%) e la KV
> in più; (3) **ribaltare il draft da generatore a PREDITTORE per il
> prefetch**, per nascondere lo stall invece di saltare decodifiche;
> (4) verify più magro sfruttando il drop già certificato.
> results/selfspec_f5_d1_xiaomi/.
> ❄️☠️ **CELLA K-F A FREDDO SUL JELLY — COMPLETA 24/24, VERDETTO NULLO
> CHE PENDE CONTRO. KF_SHIP CHIUSA COME "SOLA CARATTERIZZAZIONE".**
> Endpoint registrato: Wilcoxon esatto two-sided su 12 coppie,
> **W=12 p=0.0635 → non significativo**. Direzione: K-F ON è **+4.3% più
> LENTO** (OFF 0.1919 vs ON 0.2001 s/tok), HL −0.0090, **9 coppie su 11
> non-pari a favore di OFF**. Una coppia è pari esatto → N efficace 11,
> floor 2/2¹¹ = 0.000977. Il −20% esplorativo **NON si riproduce**.
> **La policy di attivazione registrata NON è licenziata: K-F resta OFF.**
>
> **Robustezza (post-hoc, dichiarata, NON l'endpoint):** ogni variante
> peggiora la NOSTRA tecnica, mai il contrario — per questo è sicuro
> pubblicarla. Senza b24: p=0.0996, +2.9%. **Senza b5: p=0.0039, +6.9%.**
> Senza entrambi: p=0.0078, +5.6%. Cioè **b5 è l'unica ragione per cui il
> primario è un nullo invece di un negativo significativo**: è un blocco
> OFF anomalo (0.243 contro mediana OFF ~0.19) e produce l'unica coppia
> che sembra una vittoria K-F. **L'unica vittoria della cella è un
> outlier del braccio OFF, non un successo del braccio ON.** E il +6.9%
> che ne esce sta dentro il rumore del **+7.1% pre-registrato del warm**:
> due regimi indipendenti, due celle, stesso segno e stessa magnitudine.
> b24 dichiarato ma NON escluso (COLD-VALID per la regola registrata:
> fadv_rc=0, drop 2739 MB, letture 12.60 GB sopra il floor 11.14) benché
> abbia letto la metà di ogni altro OFF (22.1-22.5 GB) e abbia l'energia
> rotta (0.0867 J/tok contro ~0.78).
>
> **Il meccanismo funziona e non basta SULLA MEDIA — ma vince sulla
> CODA.** Stall OFF 21.9% → ON 13.4% su OGNI blocco, letture 21.39 →
> 24.41 GB (**+14%**) con precisione del prefetch 76% (un quarto dei byte
> prefetchati non serve mai). Ma con i dati per-token **due gate
> ribaltano a YES**: `KF_ROBUST_WIN ✅` (p99 ON **328** vs OFF **341** ms,
> stutter ON **0.34%** vs OFF **0.55%**) e `KF_THERMAL_WIN ✅` (sag ON
> 0.0423 vs OFF 0.0670, dT 0). Energia NO (ratio 1.070 escludendo il b24
> rotto, 1.162 includendolo), majflt MIXED, TTFT in parità.
> **Quindi la caratterizzazione onesta non è "K-F è inutile" ma "K-F
> scambia throughput medio per fluidità della coda"** — stessa forma
> trovata nella cella burst (p99 −17%, stutter dimezzato). Non licenzia
> una claim di velocità; è un argomento di UX, e come tale va misurato
> con un endpoint suo se mai lo vorremo.
>
> ⚠️ **Due miei errori nel primo giro di report, corretti da un agente
> delegato che ha riscritto il REPORT:** (1) avevo dichiarato gli assi di
> coda MANCANTI — falso, i 27 file per-token erano sul device, non li
> avevo tirati giù, e sono proprio quelli che ribaltano i gate;
> (2) avevo scritto 2 run escluse per tepore fidandomi del contatore
> `excl_warmth.txt` dell'harness, mentre il CSV ne mostra **3**
> (`not_cold_valid`) più 1 esclusa per SIGTERM. Il CSV è ground truth, il
> contatore ne conta una in meno — bug dell'harness, nessuna riga tenuta
> è affetta. Lezione: non fidarsi di un contatore quando il dato grezzo è
> lì accanto.
>
> **Il gate di validità a freddo si è ripagato:** 3 run escluse per
> tepore, 1 blocco (b16) vuoto e rifatto in coda dal void-scan. Erano le
> tre run bruciate dai due harness concorrenti (errore mio, causa radice:
> il wrapper fa `exec` nello script interno → `pgrep` sul nome del
> wrapper torna VUOTO su harness vivo). Senza il gate sarebbero entrate
> come run WARM in una cella pre-registrata, e warm è dove K-F perde del
> 7%: non rumore, **bias a smentire la nostra stessa tesi**.
> results/kf_cold_jelly/REPORT.md.
> (contesto originale della cella:) PREREG committato PRIMA dello staging (01350f1):
> 24 blocchi OFF-ON-ON-OFF ×6, N=12, Wilcoxon esatto two-sided, Marco
> KEXP, un solo binario (il braccio è il flag). Motivo: il regime warm
> ha un NEGATIVO pre-registrato (+7.1% contro, p=0.000977) e l'unico
> positivo (cold −20%) non lo era — asimmetria indifendibile.
> **Meccanismo di integrità specifico del freddo:** `fadv` prima di
> OGNI run, `Cached` registrata prima/dopo, run COLD-VALID solo se il
> calo ≥ 1000 MB E le letture superano il pavimento fissato dal primo
> blocco OFF (11.14 GB, dichiarato in COLD_FLOOR.md prima delle
> coppie). Perché conta: un reset fallito in silenzio produce una run
> WARM, e warm è dove il K-F PERDE del 7% — quindi non aggiunge rumore,
> **spinge sistematicamente a smentire la nostra stessa tesi**.
> Registrata in anticipo anche la POLICY che un pass licenzierebbe:
> K-F ON sse stall misurato alto E cache fredda E nessun allarme
> termico; batteria esplicitamente NON un gate.
> **15 blocchi validi, 7 coppie complete su 12 — SOSPESA al 16/08 19:xx.
> Il −20% NON si riproduce; la tendenza è LEGGERMENTE CONTRO.**
> (Nota di correzione: avevo detto 6 coppie. Sono 7 — il quartetto 4
> salva la coppia b13-b14, solo (b16,b15) è nulla per l'esclusione di b16.)
>
> Il meccanismo funziona ed è solidissimo, su **ogni singolo blocco**:
> stall OFF 21.4-22.8% (media 21.9) → ON 12.1-15.5% (media 13.4), otto
> punti in meno. Ma le letture salgono 22.3 → 24.4 GB di media (+9%:
> **prefetch sprecato**, precisione 76-77%) e il tempo non ne beneficia.
>
> | coppia | OFF | ON | OFF−ON | % |
> |---|---|---|---|---|
> | b1-b2 | 0.189 | 0.200 | −0.011 | −5.8% |
> | b4-b3 | 0.193 | 0.193 | 0.000 | 0.0% |
> | b5-b6 | 0.243 | 0.199 | +0.044 | +18.1% |
> | b8-b7 | 0.192 | 0.195 | −0.003 | −1.6% |
> | b9-b10 | 0.192 | 0.198 | −0.006 | −3.1% |
> | b12-b11 | 0.190 | 0.188 | +0.002 | +1.1% |
> | b13-b14 | 0.192 | 0.195 | −0.003 | −1.6% |
>
> N=7, mediana(OFF−ON) = **−0.0030**, 4 negative / 2 positive / 1 zero.
> **La lettura onesta dei per-blocco smonta l'unico positivo:**
> OFF = 0.189 0.193 **0.243** 0.192 0.192 0.190 0.192 (mediana 0.192,
> range strettissimo tranne b5) · ON = 0.200 0.193 0.199 0.195 0.198
> 0.188 0.195 **0.224** (mediana 0.198). Cioè **b5 è un outlier del
> braccio OFF, non una vittoria del braccio ON**: la coppia +18.1% è un
> blocco OFF anomalamente lento, non un ON veloce. Tolto l'outlier, ON
> sta sistematicamente ~3% SOTTO OFF — **stessa direzione del warm
> (+7.1% contro, pre-registrato), magnitudine minore**.
> Servono N≥10 per la claim confermativa, ma **K-F resta OFF comunque**:
> il warm ha un negativo pre-registrato e il cold non porta un positivo.
>
> **Tre interruzioni dichiarate, tutte da riportare nel REPORT:**
> (1) 14:41 — schermo spento, sshd morto, harness morto con lui perché
> NON era staccato (colpa del mandato che non lo richiedeva, non
> dell'agente): 93 minuti persi, 5 blocchi salvi, RESUME_AT=6.
> (2) ~18:00 — **due harness concorrenti** lasciati vivi nella ripresa
> (colpa mia): due `bmoe-cli` tenevano il modello in mmap, `fadv` tornava
> rc=3 "still has 618912 resident pages" e il blocco 16 ha bruciato 3
> tentativi, TUTTI scartati dal gate (`excl_warmth=2`, drop_mb 0/390/222
> contro la soglia di 1000). **Il gate di validità a freddo ha fatto
> esattamente il suo lavoro**: senza, oggi avrei tre run tiepide
> travestite da fredde dentro una cella pre-registrata, cioè il bias
> verso il negativo che il gate esisteva per impedire.
> (3) 18:15 — `STATUS = STOP_PLUGGED`: l'owner ha messo in carica (su mia
> richiesta) e l'harness **si è fermato da solo** rifiutandosi di
> misurare sotto carica, come impone il PREREG (UNPLUGGED). Non un
> guasto: il guard-rail che funziona. E si è fermato DOPO la morte di
> sshd → **il distacco stavolta ha tenuto, quel problema è chiuso.**
>
> **Per chiudere:** RESUME_AT=17, servono ~9 blocchi (il 16 va ri-fatto
> in coda, la sua coppia è nulla) ≈ 2 ore non presidiate. Da batteria
> piena il floor 45% non si sfiora nemmeno (~2.3%/blocco). Basta
> staccare dalla presa. results/kf_cold_jelly/.
> 📱✅ **CELLA REPLICA XIAOMI (16/08) — REPLICATA.** La config certificata
> vince anche sul secondo device: **W=0, p=0.000977, HL B−A = −0.05625
> s/token, mediana −14.5%**, N=12 coppie, zero esclusioni. Onestà sul
> test: la coppia 3 è un pareggio esatto (0.2940 = 0.2940 alla
> risoluzione a 4 decimali dell'harness) e Wilcoxon scarta le differenze
> nulle → il test gira su **11 coppie effettive**, quindi p = 2/2¹¹ =
> 0.000977 è il floor esatto per N=11, NON il floor N=12 di 0.000488
> (dichiarato perché chi ricalcola da "N=12" troverebbe una discrepanza).
> Tutte e 11 le differenze non nulle favoriscono B.
> **La predizione pre-registrata ha tenuto sulla magnitudine:** effetto
> molto più piccolo del −42.7% del S23, ma NON nullo. L'asse energia
> NON è stato replicato (quantizzazione del coulomb counter).
> Replica pre-registrata della claim di ship su secondo device: stesso
> ELF, stesso modello, stesso prompt, cambia solo il telefono. PREREG committato PRIMA dello
> staging con **predizione registrata: effetto più piccolo o nullo qui**
> (11.4 GB RAM, SD8G3, flash veloce → il braccio stock soffre meno il
> costo I/O che il certificato rimuove; stall a freddo 8.7%). Un nullo è
> SCOPE, non fallimento. **3 emendamenti, tutti prima di qualsiasi
> dato:** (1) l'ELF della claim esisteva SOLO sul S23 — tirato,
> verificato 7/7 file bit-identici, archiviato (models_staging/); (2)
> J/token non riproducibile qui (sysfs negato a uid 2000) → coulomb
> counter, 2 letture per run, meno perturbante del sampler 1 Hz del S23;
> (3) **lo schermo resta acceso** (prassi di questo device contro Doze)
> e questo GONFIA il J/token del braccio lento, cioè favorisce la NOSTRA
> config sull'unico asse dove il S23 era rosso → misurata baseline
> **P₀ = 0.503 W**, energia riportata grezza E corretta. Baseline dello
> stesso ordine di TUTTO il calcolo (S23: 0.42/0.82 W): senza correzione
> il segno del +11.8% si ribalterebbe per artefatto.
> Staging verificato per hash sul device; harness portato a `sh` POSIX
> (23 colonne identiche → analyzer S23 intoccato). Run delegata a grok.
> results/kernel_ship_ab_xiaomi/.
 — aggiornato 2026-08-16 (mattina)

> 🏆🏆 **IL P-VALUE È ARRIVATO (2026-08-15 ~00:30): SHIP CRITERION MET.**
> Cella pre-registrata Mellum2-S23, 12 coppie ABBA da telefono
> dichiarato pulito: **stock 0.2585 → certificata 0.1480 s/token
> (−42.7%, tok/s 3.87 → 6.76, +75%), Wilcoxon W=0 p=0.000488** — tutte
> e 12 le coppie favoriscono la certificata, p al floor del test esatto.
> Assi di contorno: sustained −38% ✅, temp parità ✅, TTFT parità ✅,
> **J/token +11.8% ❌ dichiarato** (la certificata spinge di più i core:
> ~+12% energia per risposta — 4 assi su 5 verdi/neutri). Bonus finding:
> la certificata è ROBUSTA alla pressione RAM reale (lo stock collassa
> 60-100× con zram sporco, riprodotto 2×). Report:
> reports/moe-kernel-ship-ab-s23.md. Primo mattone PRE-REGISTRATO del
> paniere ship; K-F escluso di proposito (fattori isolati).
> **DIRETTIVA gualt (2026-08-15): POLICY DI ATTIVAZIONE del kernel** —
> la promozione finale richiede: (a) completamento burst-cold, (b)
> caratterizzazione eventi stutter/max, (c) policy che limiti l'uso
> aggressivo quando batteria o termica sono vincolanti (es. "spegni"
> la config aggressiva sotto soglia batteria). Ingressi policy: stall%
> (K-F), livello batteria, stato termico. Nota misurata: J/token +11.8%
> e potenza media ~raddoppiata (0.42→0.82 W) MA a schermo spento —
> nell'uso reale lo schermo (~1-2 W) brucia metà tempo a velocità
> doppia: serve la cella "J per risposta a schermo acceso" prima di
> fissare le soglie (il costo potrebbe ribaltarsi in risparmio netto).
> **MISURATO (2026-08-15 notte): ribaltamento CONFERMATO per l'uso
> interattivo.** Sessione screen-on: velocità replica esatta (−41.3%,
> W=0 p=0.000488 — secondo campione indipendente); J/token con display
> attivo inaffidabile (sensore Samsung mescola scale mA/µA) → misura
> %-drop: schermo ≤~0.6W (sotto risoluzione 1%/15min). Aritmetica:
> certificata risparmia 22s schermo/risposta (4-13 J) vs +2.6 J compute
> → A SCHERMO ACCESO LA CONFIG VELOCE RISPARMIA BATTERIA NETTA.
> Policy corretta: gate su TERMICA e task screen-off (lì +12% J/tok è
> reale), NON sul livello batteria in chat interattiva.
> Chiarimento terminologia (per non confondersi mai più): (1) ricetta/
> dispatcher = funziona OVUNQUE (S23 p-value; Xiaomi +158% Marco t4);
> (2) K-F prefetch = solo dove stall%>~20% (Jelly sì, Xiaomi no);
> (3) K-G prefill GPU = lane morta ovunque (artefatto).

> 🚨 **SHIP A/B S23: SOSPESA CON CAUSA TROVATA (2026-08-14 ~21:00).**
> Il braccio A "stock" (k8, no drop) fa 21 s/token — 60× degradato vs le
> celle storiche F1d (2.90) su STESSO binario/telefono/flag — e il fix
> del flag esplicito NON c'entrava (stessa patologia con e senza).
> **Pistola fumante: 1.5 GB di pagine anon in zram** (SwapFree 2.68/4.19
> GB, mm_stat 1.44 GB orig): i pesi densi anon sono swappati compressi;
> il churn page-cache del k8 no-drop (183 MiB/tok) li tiene fuori e ogni
> GEMV paga la decompressione → compute 21.2 s/tok. Il braccio B (d1.0,
> 39 MiB/tok) non pressa abbastanza → normale. Harness fermato pulito
> (STOPPED_FOR_DIAG), 2 coppie valide archiviate nel csv, telefono in
> carica. **PROSSIMO: reboot S23 (serve gualt: riavvio + Termux + sshd)
> → singola run A-config: se compute torna ~0.5 s/tok, causa confermata
> → PREREG emendamento 2 (stato RAM dichiarato post-reboot) → riparte la
> prova. Finding di prodotto: la config certificata è RESILIENTE alla
> pressione RAM reale, lo stock collassa 60× — da misurare e bancare nel
> ship report.**

> **Leggi questa sezione e basta.** Il piano originale del 3 agosto (contesto, ipotesi,
> roadmap F0-F9, rischi, fonti) e i checkpoint fino all'11 agosto vivono in
> `PLAN-archive.md`. Qui: TL;DR lanes, scheda prodotto, tabella aperta, regole operative,
> §8 telemetria/harness, checkpoint recenti. Vista di stato: va aggiornata a ogni fase.

