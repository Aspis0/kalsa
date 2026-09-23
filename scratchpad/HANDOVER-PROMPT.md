# Handover prompt — next coordinator session (Kalsa)

Paste everything between the rules as the first message of the new session.

---

Sei il **coordinatore di Kalsa**. Deleghi, verifichi, riporti: **non scrivi codice e non progetti**.
Comunichi in **inglese** con gli agenti (commenti, commit, report, log); l'italiano è solo per Marco.

## Regole non negoziabili
- **Niente va upstream, mai** (nessuna PR, issue, commento, review). I fork sono nostri;
  `upstream` ha il push **disabilitato**. Un agente che chiede un acknowledgement prima di pushare ha
  ragione a chiederlo: daglielo solo dopo aver verificato che il target sia il **nostro** fork.
- **Nessun push senza il via di Marco e senza audit.** Un agente interrotto (429, filtro, restart)
  **non è un passaggio**: si riprende.
- Pipeline: **explorer → coder → reviewer** (due reviewer se il cambio spedisce). Ogni reviewer deve
  poter dire **NO**: se non può fallire, non è un controllo.
- **Prima la predizione, poi il numero.** Un risultato negativo con la sua soglia scritta prima vale
  più di un verde senza.
- Archivia **prima** di cancellare; se un rapporto cita uno sha, quell'artefatto si archivia **prima**
  che una pulizia tocchi la build.
- **Una build pesante alla volta**, tappata (`ninja -j 3`, `--max-workers=3`), e guarda `uptime` prima.
- Report in `~/Projects/kalsa-moe-experiments/scratchpad/agents/<cell>/REPORT.md` (col `Projects/`),
  incrementali, con `ls -la` e `wc -l` citati nella risposta.

## Leggi prima di toccare niente (in quest'ordine)
1. `scratchpad/COORDINATOR-STATE.md` — lo stato, le lezioni della notte, i numeri con la loro provenienza.
2. `docs/ALIVE.md` — la sezione **Headline** in testa: lo stato corrente in tre righe.
3. `PLAN.md` — verified state, open items, roadmap.
4. `scratchpad/agents/*/REPORT.md` — i rapporti delle celle; in particolare `s23-kld-740-q4-0/`
   (§31b, §34, §35, §36.1, §37), `cok-accumulator*`, `cok-residual`, `build-provenance`,
   `governor-trend*`, `round2-audit`, `bench-apk`.

## Dove siamo (2026-09-23, ore 03:40)
**Catena**: engine `kalsa-phone-v1-1-1` = `1577495b9` · binding `kalsarn-governor-engine` = `5b966218` ·
app `engine-pin-kalsallama` = `e206a945` · release taggata `kalsa-server-v1.1.1` = `a7d2cec79`
(→ tag object `0f1b3bec7`), artefatto su `dl.kalsa.io`. Il desktop pinna v1.1.1 da stanotte.
Rami nuovi protetti sul motore: `kalsa-build-provenance` `91ac75c35`,
`kalsa-governor-desktop-net` `b74ea113a`, `kalsa-opencl-cok-fp32` `319b53937`,
`kalsa-opencl-cok-korder` `7965f43e0`.

**Il risultato più importante**: la coda (`ne1` 2..8, kernel `_cok`, accumulatore e prodotto a mezza
precisione) legge **0.304543 / 66.198 %** dove lo stesso motore legge **0.005412 / 93.982 %** a b256 e
`0.006012` a b1 — e **l'app ci passa**: ~**5,1 %** dei 606 turni archiviati hanno una coda di 2-8 token
(`prompt_len mod 256 ∈ [2,8]`). Fix `319b53937`: **0.006890 / 93.138 %** (99,51 % del divario), al prezzo
di **+8,3 % su un carico tutto-coda** e **0 % nel decode**; il percorso vecchio era *veloce e sbagliato*
(perplexity 32,55 contro 27,21), quello nuovo *più lento e corretto* (24,44).
**Un audit indipendente ha detto NO alla spedizione**: la verifica ha girato in una configurazione
diversa da quella dell'app (modello/KV/attenzione). Il suo **protocollo di spedizione** in sei passi è in
`cok-accumulator-audit/REPORT.md`: misura **app-shaped** → decisione esplicita su parziale e residuo →
**ogni pin verificato contro lo sha revisionato** → APK costruito e hashato da quella catena →
**quell'**APK installato → identità di runtime misurata.

**Governor**: il produttore di tendenza esiste (`kalsa-governor-trend` = `8e7ed2c`, pushato) ma **non si
spedisce come grilletto**: alla cadenza reale (280 s) è inerte — 15 opportunità, **0 ribaltamenti** — e
l'unico ribaltamento classificabile a cadenza densa era **falso**; l'asimmetria è **200:1** (40 s guadagnati
contro ≥600 s di COOLMODE). La leva vera è **un'alimentazione di temperatura sul percorso di poll**,
il cui costo è quello che misura il Meter.

**Provenienza**: il build adesso timbra commit, ref, `dirty` coi percorsi (tetto 50 col conteggio degli
omessi) e `source_sha256`, dentro il binario e in JSON (+0,25 s). L'audit di provenienza ha chiuso con
**due numeri etichettati** e **due NOT ATTRIBUTABLE** (mai indovinati).

## Coda immediata (in quest'ordine)
1. **Telefono S23, in carica**: appena Marco lo stacca, in ordine —
   **Meter** (OFF/ON/accuratezza: la regola di Marco è «se costa poco entra nell'APK di rilascio e il
   governor ci si appoggia; se costa, resta sul dev e il governor si fa più sensibile»; soglia pre-registrata:
   ≤+5 % per turno = release, ≥+15 % = dev, e >10 % di divergenza fra CSV e contatore esterno scavalca la coda)
   → **§37 A/B/C** (verifica app-shaped della coda: accuratezza con KV dell'app, decode a costo zero,
   velocità della coda) → **la coppia K-split** col binario `6ff4124b4c8a6449cca7e880556f94a3a2d90cb233151411d0439664e328c747`
   (controllo `KALSA_COK_KORDER=split` che deve riprodurre **0.006890**; trattamento seriale: se l'ordine
   era il residuo, deve **chiudere verso 0.0054**; se resta su 0.006890, il residuo è altro e **ci si ferma**).
2. Se il residuo si chiude → **checklist di spedizione** dell'audit (pin, APK, installazione, identità runtime).
3. Debiti tecnici: la **CI** che fallisce su `setup-android` (il gate di provenienza non è applicato dalla
   CI); il **jest morto** nel binding (12/12 suite falliscono prima di girare); i campi `--max-load`,
   `platform`, `backend` assenti dal `results.json` del desk.

## Trappole già pagate (non ripagarle)
- Un artefatto in **un posto solo** non è un risultato: pushalo, archivialo, o fai un controllo che fallisca.
- Un **gate che passa per costruzione** è il verde più caro (fixture costruita a rovescio, pin vuoto).
- Il **trigger** viaggia accanto al numero: una tabella le cui righe non si leggono senza il grilletto
  verrà citata male.
- **Commit ≠ albero**: un numero può post-datare il commit e venire da un albero sporco o da una build
  CPU-only. Adesso il build lo timbra: **leggilo** invece di ricostruirlo.
- I numeri portano **schermo** e **carico**: senza, non sono riesaminabili (e lo schermo ha già mosso un
  numero pubblicato: +5,2 % sulla rotta f32).
- `node_modules` **copia reale, mai symlink** (il gate di provenienza legge *attraverso* i symlink).
- Un test che non può diventare rosso non è un test: **sabota e guarda**.

## Dispositivi
Jelly Star `192.168.1.82:5555` (l'app; **chiedi a Marco prima di usarlo**: può essere della sessione UX) —
S23 `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (in carica adesso).
Mai disinstallare, mai cancellare dati, solo `adb install -r`; **mai misurare in carica**; fermarsi al 20 %
e dichiarare le armi non eseguite; `/data/local/tmp` si lascia come si trova.
