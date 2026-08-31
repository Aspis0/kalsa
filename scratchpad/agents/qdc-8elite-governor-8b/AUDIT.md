# AUDIT ostile — cella #41 (qdc-8elite-governor-8b), REPORT 18a1d89e vs PREREG 166f9ccf

## VERDETTO COMPLESSIVO: **FIX**

Numeri, decision rule e WIN sono corretti e bancabili: ogni cifra misurata ricalcolata dal disco coincide. Ma il REPORT contiene (a) una citazione di provenienza FALSA (serial non presente nel file citato né in alcun raw), (b) un difetto aritmetico nel rate di upload, (c) tre claim non supportati da alcun artefatto in raw/ (re-probe termici, SHA256SUMS, orario di inizio sessione), (d) due arrotondamenti/lessico aggressivi. Nessuno di questi rovescia il WIN; tutti vanno corretti prima della registrazione.

---

## 1. ARITMETICA (ricalcolata dal disco)

**F1.1 — Tabella runs = summary=median: 30/30 valori corretti. CONFIRMED.**
- `gov_A_1_793164.out`: `summary=median arm=A ... ttft_ms=2517.739 decode_tps=28.202 prefill_ms=2513.932` → tabella 2517.7/28.20/2513.9 ✓
- `gov_A_2_793164.out`: `summary=median arm=A ... ttft_ms=2518.750 decode_tps=28.365 prefill_ms=2515.034` → 2518.8/28.37/2515.0 ✓
- `gov_C_1_793164.out`: `summary=median arm=C ... ttft_ms=25122.625 decode_tps=13.946 prefill_ms=25122.175` → 25122.6/13.95/25122.2 ✓
- `gov_C_2_793164.out`: `summary=median arm=C ... ttft_ms=26134.085 decode_tps=13.458 prefill_ms=26133.632` → 26134.1/13.46/26133.6 ✓
- `gov_G_1_793164.out`: `summary=median arm=G ... prefill_backend=GPUOpenCL decode_backend=CPU ttft_ms=2495.842 decode_tps=13.318 prefill_ms=2491.891 commit_ms=22.152 commit_bytes=8454144 commit_naive_count=1 commit_staged_count=1` → 2495.8/13.32/2491.9/22.15 ✓
- `gov_G_2_793164.out`: `summary=median arm=G ... ttft_ms=2496.068 decode_tps=13.327 prefill_ms=2492.219 commit_ms=20.770 commit_bytes=8454144` → 2496.1/13.33/2492.2/20.77 ✓

**F1.2 — I mediani sono autentici. CONFIRMED.** Ricalcolata la mediana delle 9 righe `turn` per ogni metrica di ogni file: coincide con `summary=median` in 6/6 file (es. A1 ttft: {2471.797…2551.310}, 5° ordinato = 2517.739 = summary). La riduzione del binario non è stata manipolata.

**F1.3 — Soglie prefill. CONFIRMED.** 1.15×2517.739=2895.40, 1.15×2518.750=2896.56 (REPORT: "2895.4 / 2896.6" ✓); 0.5×25122.625=12561.31, 0.5×26134.085=13067.04 ("12561.3 / 13067.0" ✓). G (2495.842/2496.068) passa tutte e 8 le accoppiate.

**F1.4 — Soglia decode. CONFIRMED.** 0.95×13.946=13.2487, 0.95×13.458=12.7851. G1 13.318 ≥ 13.2487, G2 13.327 ≥ 13.2487; 4/4 pairings passano. Ratio G1/C1 = 0.95497 → "0.955 × C" ✓.

**F1.5 — Commit %. CONFIRMED.** 22.152/2491.891 = 0.8890% → "0.89%" ✓; 20.770/2492.219 = 0.8334% → "0.83%" ✓. 8454144 B = 8.0625 MiB → "~8.06 MiB" ✓. Banda ≤3% → "scales cleanly", conforme al PREREG.

**F1.6 — Rate di upload: cifre del REPORT auto-incoerenti. CONFIRMED (difetto).**
`model_push_793164.log`: `1 file pushed, 0 skipped. 23.8 MB/s (5155564768 bytes in 206.885s)`. La divisione scritta nel REPORT ("5,155,564,768 bytes in 206.9 s = 23.8 MB/s") dà **24.92 MB/s** decimali; 23.8 è il valore di adb in **MiB/s** (5155564768/206.885/2²⁰ = 23.77). Il PASS regge lo stesso (206.885 s = 3.45 min ≪ 45), ma la riga com'è scritta è aritmeticamente falsa.

**F1.7 — 10× prefill. CONFIRMED.** C/A per pairings = 9.97 / 10.38 / 9.97 / 10.38 → "10×" corretto.

**F1.8 — "~2.1× decode A-vs-C": bordo superiore spacciato per tipico. PLAUSIBLE, con difetto.**
Pairing-wise: 28.202/13.946 = **2.022**, 28.202/13.458 = 2.096, 28.365/13.946 = 2.034, 28.365/13.458 = **2.108**. Il range onesto è 2.0–2.1×; "~2.1×" (usato due volte, incluso il caveat) è l'estremo superiore. Difetto minore ma è esattamente il tipo di arrotondamento che gonfia un headline.

## 2. CONFORMITÀ AL PREREG

**F2.1 — Ordine A C C A G G. CONFIRMED.** Catena mtime raw/: therm_pre_A1 19:30:06 → gov_A_1.exit 19:32:32 → therm_pre_C1 19:33:26 → gov_C_1.exit 19:39:00 → therm_pre_C2 19:39:20 → gov_C_2.exit 19:45:06 → therm_pre_A2 19:45:17 → gov_A_2.exit 19:47:37 → therm_pre_G1 19:49:16 → gov_G_2.exit 19:57:08. ABBA + G G rispettato; 12 therm = 2 snapshot × 6 invocazioni.

**F2.2 — Gate termico VIVO. CONFIRMED.** Ogni therm file apre con `Current temperatures from HAL:` e chiude con `Thermal Status: N` + footer `max_hal_temp=42.0 status=0`; nessuna occorrenza di `Cached temperatures:` in alcun file. Pre-invocazione: max 42.0/45.9/50.5/46.7/46.9 °C, status 0/0/1/0/0 — tutti ≤60 °C e ≤1. Gate onesto.

**F2.3 — Exit code. CONFIRMED.** Tutti e 6 i `.exit` contengono `0`.

**F2.4 — Comandi. CONFIRMED (indiretto).** Nessun raw/ archivia la riga di comando; ma le righe `turn` mostrano `arm=A/C/G`, `reps 0..2`, 9 turn, `seed=1234`, `n_ubatch=512`, `n_threads=1`, `build_commit=5c3979438`, `model_path=/data/local/tmp/kalsa/lfm8b.gguf` — tutto coerente col PREREG (`--arm X -m <model> -r 3`, workload fisso). Il MODEL path su device coincide con model_sha_device. La riga di comando esatta resta non-archiviata →FIX minore.

**F2.5 — Verdetto WIN derivato solo dalle condizioni pre-scritte. CONFIRMED.** Il REPORT applica esattamente le condizioni PREREG (prefill: due barre; decode: una barra; commit = caratterizzazione bandata, non pass/fail). Nessuna condizione inventata.

**F2.6 — SHA256SUMS kit "12/12 OK": NESSUN ARTEFATTO. PLAUSIBLE ma non verificabile.** Il REPORT: "SHA256SUMS verified on device: 12/12 OK, 0 failures" — non esiste alcun file in raw/ che lo documenti. Il solo aggancio verificabile è `build_commit=5c3979438` nelle turn lines. FIX: archiviare o marcare come non-persistito.

**F2.7 — Re-probe termici "47.1/0 e 46.9/0": NESSUN ARTEFATTO. PLAUSIBLE ma non verificabile.** REPORT: "After A2 and G1 the gate was re-probed once per minute and re-passed within 1 min (47.1/0 and 46.9/0 ...)". raw/ contiene solo i 12 pre/post: `47.1` non appare da nessuna parte; `46.9/0` coincide esattamente con therm_pre_G2 (coincidenza sospetta ma spiegabile). I pre_G1=46.7/0 e pre_G2=46.9/0 (entrambi ≤60/≤1) dimostrano che i run G sono partiti in gate legale, quindi il WIN non dipende da questi re-probe — ma il claim com'è scritto non è sostenuto da evidenza su disco. FIX: archiviare o riformulare.

**F2.8 — Upload gate. CONFIRMED.** PREREG: "projects the full push > 45 min → VOID". Push effettivo 206.885 s = 3.45 min. PASS regge.

## 3. TRASCRIZIONI

**F3.1 — Termici 12/12 corretti. CONFIRMED.** Es. REPORT "pre A2 50.5/1 → post 52.9/2" = max(mValue)=50.5 e `Thermal Status: 1` in therm_pre_A2, 52.9/`Thermal Status: 2` in therm_post_A2. Tutti gli altri 10 valori coincidono (verificati uno per uno: 42.0/0, 42.0/0, 42.0/0, 48.2/0, 45.9/0, 52.1/1, 46.7/0→53.2/2, 46.9/0→52.9/2).

**F3.2 — sha256 locale vs device. CONFIRMED.** `model_sha_local.txt`: `4923ec14...2bb0  /Users/marco/kalsa-models/LFM2.5-8B-A1B-Q4_K_M.gguf`; `model_sha_device_793164.txt`: `4923ec14...2bb0  /data/local/tmp/kalsa/lfm8b.gguf`. Identici, come dichiarato.

**F3.3 — Provenance: il serial `b4bd0901` NON È NEL FILE CITATO. REFUTED (come citato).**
REPORT: "Unit serial `b4bd0901`, props `qti/sun/sun:16/BQ2A.260305.002-...` (raw/provenance_793164.txt)". `provenance_793164.txt` contiene: `qti/sun/sun:16/BQ2A.260305.002-BP2A.250705.008/eng.lnxbui:userdebug/test-keys`, `SM8750`, `sun`, `16`, kernel line — **nessun serial**. `grep -ri b4bd0901 raw/` → 0 risultati. Props/SM8750/Android 16: CONFIRMED. Serial: oppure proviene da fuori (UI QDC, non citata) o non è vero — in ogni caso la citazione è falsa. FIX obbligatorio.

**F3.4 — Backend per-turn nei .out. CONFIRMED e sottoutilizzato.** Ogni turn line A/G stampa `prefill_backend=GPUOpenCL decode_backend=GPUOpenCL` (A) e `prefill_backend=GPUOpenCL decode_backend=CPU` (G): `turn arm=G rep=0 turn=0 ... prefill_backend=GPUOpenCL decode_backend=CPU ttft_ms=2468.400 ... commit_ms=17.050 commit_bytes=6586368 commit_naive_count=0 commit_staged_count=1`. Il REPORT lo cita ("Backends as printed per turn") — corretto.

**F3.5 — Omissione minore: commit per-turn.** I raw mostrano commit_bytes per-turn 6586368 (turn 0, staged-only, 6.28 MiB) vs 8454144 (turn successivi, naive+staged). Il REPORT riporta solo il summary. Nessun impatto materiale, ma "commit ~8.06 MiB" come cifra unica nasconde che il primo commit è più piccolo.

## 4. EVIDENZA GPU

**F4.1 — Contenuto del probe. CONFIRMED.** `opencl_banner_probe_793164.txt` contiene letteralmente: `ggml_opencl: selected platform: 'QUALCOMM Snapdragon(TM)'` e `ggml_opencl: device: 'QUALCOMM Adreno(TM) 830 (OpenCL 3.0 Adreno(TM) 830)'`. Il REPORT cita le prime due stringhe (truncando la seconda — accettabile). Corroborazione addizionale non citata: la tabella llama-bench mostra `tg4 | 29.95` t/s, coerente col decode A (28.2–28.4 t/s) — la GPU-IPR dell'arm A è plausibile anche per triangolazione.

**F4.2 — L'inferenza regge? SÌ, non è over-sold. CONFIRMED.** Catena: (1) fail-fast strutturale richiamato dal PREREG ("prints `fail-fast: no non-CPU backend resolved; resolved_backend=CPU` and exits non-zero") con exit=0 su A1/A2/G1/G2; (2) per-turn `prefill_backend=GPUOpenCL` nei .out; (3) probe OpenCL esplicito sullo stesso unit; (4) split 10× prefill. Un fallback silenzioso avrebbe prodotto i numeri di C (25.1–26.1 s); il fail-fast l'avrebbe abortito. Il REPORT, inoltre, dichiara onestamente che il banner NON è nei gov_*.out ("governor-bench swallows the ggml loader banner"). Giudizio: evidenza adeguata, Claims calibrati.

**F4.3 — Debolezza del probe.** Il probe è llama-bench, non governor-bench, e il file non registra la command line (`-p 16 -n 4 -r 1 -ngl 99`, LD_LIBRARY_PATH dichiarati solo nel REPORT). Difetto di archiviazione, non di sostanza.

## 5. OMISSIONI E OVERCLAIM

**F5.1 — Eccursioni status=2. DICHIRATE. CONFIRMED.** REPORT: "Post-run status-2 snapshots are disclosed, not gate violations (the binding gate is pre-invocation)" — e i raw confermano post 52.9/2 (A2), 53.2/2 (G1), 52.9/2 (G2). Lettura conforme al PREREG (il gate è pre-invocazione). Onesto.

**F5.2 — "A domina G in assoluto ... equal ttft": lessico impreciso. CONFIRMED (lieve).** G1 ttft 2495.842 vs A1 2517.739: G è 0.87% più veloce (il REPORT stesso lo ammette: "G is in fact marginally FASTER than A"). "Domina" + "equal ttft" nella co-headline contraddice il dettaglio due sezioni sotto. I numeri sono tutti esposti; è un difetto di forma, non di dati.

**F5.3 — Caveat n_threads=1. SUFFICIENTE. CONFIRMED.** REPORT: "C (and G's decode) ran at the binary's default n_threads=1, same as #38. This cell cannot say what multi-threaded CPU decode would do". Corretto e vincolato al claim 2.1×. Osservazione ostile (non bloccante): il WIN di G dipende dal fatto che anche C gira a 1 thread su 8 core; con CPU multi-thread il confronto decode cambiarebbe — ma il caveat lo copre esplicitamente.

**F5.4 — Sessione "ran 19:08–19:59, ~49 min", "queued ~2h". NON VERIFICABILE.** Primo artefatto raw: model_push 19:26:55; ultimo: probe 19:58:36. Nessun file copre il 19:08 né la coda. Claim di contesto, non numerico; flag minore.

**F5.5 — Cosa nascondono i raw? NIENTE di materiale.** Varianze per-turn (A prefill 2465.8–2551.3 ms; C monotona in peggioramento termico: 23186→26189 ms) sono visibili nei raw e coerenti col quadro termico del REPORT; nessuna sequenza sconcertante non dichiarata.

---

## Correzioni obbligatorie (FIX)

1. **Serial `b4bd0901`** (F3.3): correggere la citazione — indicare la vera fonte o rimuovere il claim. Il file citato NON contiene il serial.
2. **Upload rate** (F1.6): scrivere `24.9 MB/s` (o `23.8 MiB/s`) — la formula attualmente scritta non dà 23.8.
3. **Re-probe termici** (F2.7): archiviare gli snapshot di re-probe in raw/ o riformulare come "re-probed (values not persisted); subsequent pre_G1/pre_G2 gate files confirm legal start".
4. **SHA256SUMS 12/12** (F2.6): archiviare il log di verifica o marcare il claim come non-persistito.
5. **"~2.1×"** (F1.8): sostituire con "2.0–2.1× (2.02–2.11 per pairing)".
6. **Co-headline** (F5.2): "domina" → "A è l'arm migliore in assoluto (decode 2.0–2.1×, ttft a parità o 0.9% sotto G)".
7. **Minori** (F2.4, F4.3, F5.4): archiviare la command line esatta delle 6 invocazioni e quella del probe; qualificare il timing di sessione come "per QDC UI, non persistito".

Il WIN (G keeps GPU-prefill + CPU-decode; commit 0.83–0.89% ≤ 3%) è **corretto e robusto**: nessuna delle correzioni tocca le misure. La cella è bancabile SOLO dopo le correzioni 1–6.
