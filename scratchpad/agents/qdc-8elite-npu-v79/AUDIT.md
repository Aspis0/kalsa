# AUDIT OSTILE — cella #43 (NPU Hexagon v79 day-0, session 793389)

## VERDETTO: FIX

La cella regge sui numeri duri (tutti i conteggi ricalcolati battono) e la diagnosi "giudice avvelenato" sopravvive a un censimento completo, non solo al campione richiesto. Ma il REPORT contiene (1) una affermazione fattualmente falsa sulla concentrazione degli INTERNAL-ERROR, (2) un overclaim del probe Q4 — nessuna risposta finale è mai stata catturata in NESSUN braccio, (3) una violazione del gate termico binding sul probe CLI, (4) un "max HAL well under gate" smentito dai suoi stessi raw, (5) una clausola "EVERY compared failure" che tace 9 FAIL su 70 senza diagnostico e 6 casi CPU=+inf. Correzioni obbligatorie elencate sotto; nulla rovescia il verdetto bancario (Q2 = defect list started).

Metodo: lettura integrale di PREREG.md, REPORT.md e tutti i 29 file in raw/; ricalcolo indipendente via script (grep/python) di ogni conteggio, mediana e rapporto; cross-check git dei lock.

---

## 1. ARITMETICA

**F1.1 — Conteggi test-backend-ops MUL_MAT — CONFIRMED (tutti corretti).**
`backend_ops_MUL_MAT_HTP0.txt:4168` = `472/542 tests passed`; failing-list (righe 4171–4240) = **70** voci esatte; `not supported` nel backend HTP0 = **928**; `OK` body = 472. 472+70=542 ✓. Exit: `EXIT=1` (ultima riga) ✓.

**F1.2 — MUL_MAT_ID 0/301 — CONFIRMED.**
`backend_ops_MUL_MAT_ID_HTP0.txt:832` = `0/301 tests passed`; 301 voci in failing list; zero linee `OK`; `INTERNAL-ERROR` count = **0** ✓ (REPORT dichiarato "zero INTERNAL-ERROR" — vero).

**F1.3 — Judge-probe 407/407 — CONFIRMED.**
`backend_ops_MUL_MAT_ID_GPUOpenCL_judgeprobe.txt:850` = `407/407 tests passed`; `Backend OpenCL: OK`; `EXIT=0` ✓.

**F1.4 — 36 INTERNAL-ERROR — CONFIRMED il numero, REFUTED la concentrazione.**
Count = 36 esatto, tutti `ggml-hex: HTP0 dspcall : dsp-rsp: INTERNAL-ERROR` in MUL_MAT, zero in MUL_MAT_ID. MA il REPORT (sezione Q2, punto 4) scrive: *"concentrated on tiny shapes (m=16, n=1..4) across all supported quants"*. FALSO su tre conti:
- n = **4..8**, mai 1–3 (censimento completo: q4_0/q4_1/q8_0/mxfp4/iq4_nl × n=4,5,6,7,8 = 25 casi a bs=[1,1], + 4 casi m=16 n=4 bs=[3,2]);
- **7/36 casi NON sono m=16**: uno è `MUL_MAT(q4_0, m=576, n=512, k=576)` (riga ~1365 — una shape GRANDE), sei sono `m=1, n=64, k=256` (bf16, q4_0, q5_1, q1_0, iq1_m, iq4_xs);
- i sei casi m=1 n=64 colpiscono tipi **non** tra i supportati (bf16/q5_1/q1_0/iq1_m/iq4_xs) — il quadro è più sporco di "tiny shapes across all supported quants".
**Correzione obbligatoria.**

**F1.5 — Mediane bench e rapporti — CONFIRMED.**
Da bench_N1/N2/C1/C2 (righe tabella, verbatim): N pp 1500.38±20.68 / 1524.09±9.63 → mediana 1512.235 ≈ **1512.2** ✓; N tg 22.59±3.35 / 24.34±0.21 → 23.465 ≈ **23.47** ✓; C pp 211.95±0.48 / 210.22±0.35 → 211.085 ≈ **211.1** ✓; C tg 38.55 / 38.43 → **38.49** ✓. Rapporti: 1512.235/211.085 = **7.16** → "7.2×" ✓ (arrotondamento legittimo); 38.49/23.47 = **1.640** → "1.64×" ✓.

**F1.6 — Upload — CONFIRMED.**
`model_push_793389.log`: `1 file pushed, 0 skipped. 23.8 MB/s (1593894944 bytes in 63.924s)` → 1.593 GB a 23.8 MB/s = 63.9 s; +kit 10.8 MB ≈ 4.5 s → ~68–75 s. "≈75 s, PASS" onesto.

## 2. LA DIAGNOSI "GIUDICE AVVELENATO"

**F2.1 — Censimento completo (oltre il campione di 15 richiesto): ZERO inversioni — CONFIRMED e RAFFORZATA.**
Censito **ogni** riga diagnostica: 61 in MUL_MAT + 301 in MUL_MAT_ID = 362 mismatch lines. Tutte e 362: HTP0 **finito**, CPU **non finito** (MUL_MAT: 24×`CPU=nan`, 25×`CPU=-nan`, 6×`CPU=-inf`, 6×`CPU=inf`; MUL_MAT_ID: 123×nan, 104×-nan, 31×-inf, 43×+inf). **Nessun caso con HTP0=nan/inf e CPU finito. La diagnosi non crolla.**
Il REPORT cita `[MUL_MAT_ID] NaN at index 0 (HTP0=20.906250 CPU=nan)` — esiste verbatim a riga 28 ✓.

**F2.2 — Ma "EVERY compared failure ... CPU=nan/-nan/-inf" è impreciso — CONFIRMED (difetto di enunciato).**
12 linee diagnostiche MUL_MAT + 43 in MUL_MAT_ID mostrano `CPU=inf` (POSITIVO), non incluso nell'enumerazione del REPORT. Inoltre: la riga 119 (`inf mismatch: HTP0=-5.168302 CPU=inf`) e la 125. Direzione corretta, enumerazione incompleta.

**F2.3 — 9 FAIL su 70 NON hanno alcun diagnostico "compared" — CONFIRMED (taciuto nel REPORT).**
7 FAIL silenziosi (solo marker `FAIL`, nessun valore stampato): `q4_0,m=1,n=2048,k=8192` (uno shape LLM-prefill-like! riga ~3488), `q8_0,m=16,n=1,k=32`, `iq4_nl,m=16,n=9`, e `q4_1/q8_0/mxfp4/iq4_nl m=1,n=64,k=256`. Più 6 linee INTERNAL-ERROR senza mismatch-prefix. Per questi 9 non si sa cosa abbia prodotto HTP0: il claim "in EVERY compared failure" è tecnicamente vero (sono "compared failures" solo quelli con confronto) ma il lettore non viene avvisato che 13% dei FAIL MUL_MAT è senza confronto e può essere mismatch numerico reale.

**F2.4 — Control GPUOpenCL: stesso binario/ambiente — CONFIRMED (PLAUSIBLE sul "stesso binario").**
Il probe (mtimes 14:20:51, tra i due run HTP0) mostra le stesse righe `ggml-hex: Hexagon Arch version v79`, `HTP0 allocating new session`, stessa uri `file:///libggml-htp-v79.so?...&_dom=cdsp` e stesso backend registrato — stesso kit, stessa sessione operativa, GPUOpenCL eseguito `Backend OpenCL: OK`, exit 0. Il "stesso binario" non è provabile da raw (nessun sha/percorso del binario nel log), quindi PLAUSIBLE, non CONFIRMED al 100%.

**F2.5 — Copertura del control incompleta: 3 casi su 301 non controllati — CONFIRMED (taciuto).**
Censimento firme: HTP0 ha eseguito 297 firme distinte; il probe OpenCL 403; overlap 294. **Tre casi falliti su HTP0 non sono mai passati dal control OpenCL** (`iq4_nl,n_mats=4,n_used=2,b=0` con m=512 n=1, m=512 n=32, m=64 n=16 k=96). "Passes 407/407 against the SAME CPU reference" è vero ma non dimostra il judge innocente per quei 3 casi. Inoltre non esiste NESSUN control OpenCL per i 61 FAIL MUL_MAT a pattern giudice — l'analogia poggia solo sul signature-matching.

**F2.6 — Disciplina del claim — CONFIRMED, con una crepa.**
Il REPORT mantiene "correctness is NOT proven by these runs; equally, the FAILs do not prove the kernels wrong" e chiude "correctness is ... characterized ... not certified". Bene. MA: (a) usa "finite outputs + poisoned-pairing evidence" a tutela dei FAIL — per i 36 INTERNAL-ERROR l'output HTP0 è buffer probabilmente non inizializzato, "finite" lì non significa nulla; (b) per i 9 FAIL senza diagnostico l'argomento "finite outputs" non è disponibile. La disciplina formale regge, il supporto argomentativo è più magro di come è presentato.

## 3. CONFORMITÀ AL PREREG

**F3.1 — Lock prereg — CONFIRMED.**
`git show -s 5606d929` = commit 2026-08-31 **02:24:55**, contenente solo PREREG.md (68 righe). Prima misura (therm_pre_probe) 14:18:29. 12 ore di distanza ✓. REPORT = commit 2b4717b8 (14:34:25), working tree pulito.

**F3.2 — Verdetto Q2 conforme — CONFIRMED.**
Prereg: "any FAIL banks as 'v79 defect list started'". REPORT: "this banks as **'v79 defect list started'** — the rule is applied as written". Applicato ✓, incluso il 0/301.

**F3.3 — Ordine N C C N e gate per-invocazione bench — CONFIRMED (mtime al secondo).**
14:21:31 pre_N1 → 14:21:52 bench_N1 → 14:21:53 post_N1; 14:22:02 pre_C1 → 14:22:24 bench_C1 → 14:22:25 post_C1; 14:22:35 pre_C2 → 14:22:57 bench_C2 → 14:22:58 post_C2; 14:22:59 pre_N2 → 14:23:18 bench_N2 → 14:23:19 post_N2. Sequenza N,C,C,N ✓, un'invocazione ciascuna ✓, gate pre+post per ciascuna ✓.

**F3.4 — Flag esatti — CONFIRMED.**
`run_npu_bench_793389.sh`: N = `--device HTP0 -ngl 99 --mmap 0 --poll 1000 -t 6 --cpu-mask 0xfc --cpu-strict 1 -ub 1024 -fa 1 -m ship.gguf -p 512 -n 128 -r 3`; C = `-ngl 0` senza `--device HTP0`. Identico al prereg, flag per flag. I bench file confermano poll 1000, ub 1024, fa 1, mmap 0, mask 0xfc, strict 1 in tabella.

**F3.5 — VIOLAZIONE gate termico sul probe CLI — CONFIRMED.**
Prereg (BINDING): "live HAL max ≤60 °C and status ≤1 before EACH invocation". Il probe CLI ha DUE invocazioni (N a 14:33:13, C a 14:33:16) ma UN solo `therm_pre_cli.txt`, presa a **14:23:37** — **10 minuti prima** della prima invocazione e **mai** prima della seconda. Nessun gate vivo pre-C. L'aggravante: tra le due cose è accaduto l'incidente dei 663 MB di flood (nota operativa), il periodo esatto in cui il gate mancava. Mitigante: therm_post_cli = 48.0 °C, status 0; nessun numero bench ne dipende. Resto una violazione del prereg da registrire.

**F3.6 — Exit codes — CONFIRMED.**
`EXIT=$?` echo nello script; bench files tutti `EXIT=0`; `cli_N.exit`/`cli_C.exit` = `EXIT=0` entrambi.

**F3.7 — Q3 dichiarato esplorativo — CONFIRMED.**
REPORT: "(Exploratory per prereg: seeds the NPU column ...; a routing verdict needs its own preregistered cell.)" ✓. Nessun verdetto di routing emesso.

**F3.8 — Gate anche sui run backend-ops — CONFIRMED (bonus).**
therm_pre_probe (14:18:29) e therm_pre_mmid (14:19:42) coprono i due run test-backend-ops. Disciplina superiore al minimo del prereg.

## 4. TRASCRIZIONI

**F4.1 — Tabella bench 4×2 — CONFIRMED verbatim.**
Tutti gli 8 numeri ± stdev corrispondono carattere per carattere ai file (1500.38±20.68/22.59±3.35; 211.95±0.48/38.55±0.04; 210.22±0.35/38.43±0.23; 1524.09±9.63/24.34±0.21).

**F4.2 — Header v79/hwinfo — CONFIRMED verbatim.**
Ogni file HTP-invocante contiene: `ggml-hex: Hexagon Arch version v79`, `HTP0 hwinfo: threads 6, hvx 6, hmx 1, vtcm 8 MB`, uri `file:///libggml-htp-v79.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0` ✓.

**F4.3 — SHA modello — CONFIRMED.**
`model_sha_local.txt` e `model_sha_device_793389.txt`: `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` identici, coerenti col REPORT (`a247afd6...40b03`) e con la stessa immagine `ship.gguf` in tutti i log.

**F4.4 — Provenance — CONFIRMED con riserva.**
`provenance_793389.txt`: fingerprint `qti/sun/sun:16/BQ2A.260305.002-BP2A.250705.008/eng.lnxbui:userdebug/test-keys`, `SM8750`, `2a38935c`, `16`. Tutto citato correttamente nel REPORT. Riserva: il file è 4 righe **senza etichette** — nessun `ro.serialno=`; l'attribuzione "via ro.serialno" si fida dell'ordine delle righe, non di un raw etichettato.

**F4.5 — Storia SHA256SUMS self-hash FAILED — NON VERIFICABILE (verificazione richiesta, assente).**
Il REPORT afferma "23/23 payload files OK on device; the SHA256SUMS line for itself reads FAILED because the manifest hashed its own (then-empty) file at creation". **In raw/ non esiste né SHA256SUMS né il log di verifica.** La storia è chiara, plausibile e disclosure onesta — ma per questo audit è unfalsifiable: nessun artefatto su disco la supporta o la smentisce. La domanda dell'audit ("il file elenca se stesso?") non ha risposta possibile dai file presenti. Da accodare come artefatto mancante.

**F4.6 — Note operative — CONFIRMED oneste (con dettaglio).**
`--mmap 0` è effettivamente un flag di llama-bench, non di llama-cli (lo script bench lo usa legittimamente; l'incidente cli è coerente). Il loop "> " con 663 MB flood è descritto come "file deleted" — nessun raw residuo, ma il REPORT lo banca come incidente senza numeri toccati; coerente con gli mtimes (due tentativi cli falliti nell'intervallo 14:23–14:33, terzo tentativo buono). Onesto.

## 5. OMISSIONI / OVERCLAIM

**F5.1 — "The per-phase split — the governor's thesis — appears on the THIRD engine class" — CONFIRMED sui numeri, con caveat.**
Sui 4 run: prefill 1500–1524 vs 210–212 (ratio 7.1–7.2, non-overlapping anche con stdev), decode 38.43–38.55 vs 22.59–24.34 (ratio ≥1.48 anche nel caso peggiore 38.51 vs 25.94). Il split è netto sui dati. Caveat: 1 sessione, 1 modello, r=3 con tg N1 ±3.35 (spread 15% su 3 rep), e la frase appare in una sezione che ripete "no routing verdict" — la forma è dentro la disciplina prereg, il contenuto numerico regge.

**F5.2 — Q4 venduto come "the correctness evidence that matters" — OVERCLAIM CONFIRMED.**
**NEITHER capture contains a final answer.** `cli_N.out`: il testo si interrompe dentro `[Start thinking]` dopo "8. Neptune" — nessun `[End thinking]`, nessuna risposta dell'assistente. `cli_C.out`: si interrompe dentro il thinking dopo "* Earth". Il "full correct list Mercury→Neptune, in order" del REPORT esiste **solo nella traccia di reasoning**, e "BOTH are semantically correct" si riferisce a output che non contengono una risposta finale. Il probe è etichettato "probe" e la certificazione quantitativa è rimandata a future work (onesto), ma la frase "the correctness evidence that matters" sopra un run dove nessun braccio ha mai emesso una risposta è inaccettabile in una cella bancata. **Correzione obbligatoria.**

**F5.3 — "max HAL well under gate; status 0 throughout" — CONFIRMED as false for N2.**
Prereg gates: 41.0 / 41.0 / 45.7 / **57.6** °C (pre_N2). 57.6 su gate 60.0 non è "well under" — è 4% dal limite. I post-snapshot toccano **61.5** (post_C1) e **63.0** °C (post_C2): i run CPU hanno superato la soglia del gate durante l'esecuzione. Status 0 ovunque ✓. La frase del REPORT è fuorviante; i raw la smentiscono.

**F5.4 — Contraddizioni raw↔REPORT censite.**
(a) "n=1..4" vs n=4..8 + 7 casi fuori cluster (F1.4); (b) "CPU=nan/-nan/-inf" vs 49 casi CPU=+inf (F2.2); (c) "EVERY compared failure" vs 9 FAIL senza diagnostico (F2.3); (d) "same binary" del control non provabile da raw (F2.4); (e) 3 casi HTP0 senza copertura control (F2.5); (f) "well under gate" vs 57.6/63.0 (F5.3); (g) kit integrity senza artefatto (F4.5). Nessuna contraddizione tocca i conteggi o i numeri bench.

**F5.5 — Curiosità non bloccanti.**
- Body MUL_MAT: 79 righe FAIL-ish vs 70 in tally; MUL_MAT_ID: 301 righe FAIL vs 297 firme distinte — lo strumento stampa alcuni test doppi; nessuno ha riconciliato, i tally dichiarati restono quelli dello strumento.
- L'arm C (CPU) registra backend "OpenCL,HTP" in tabella con sessione HTP allocata a ngl 0: compute su CPU, coerente col prereg (che prescriveva esattamente questo), ma il REPORT non nota che il braccio "CPU" gira in un processo con Adreno OpenCL di default registrato.
- `provenance` riporta `ro.build.fingerprint ... eng.lnxbui:userdebug/test-keys`: userdebug build sul QDC — coerente con unsigned-PD, meriterebbe menzione esplicita in Q1.

---

## CORREZIONI OBBLIGATORIE (prima di registry/ALIVE)

1. Riscrivere la frase INTERNAL-ERROR: n=4..8, 7/36 casi fuori m=16 (incluso m=576,n=512,k=576 e 6× m=1,n=64,k=256 su tipi non-supportati).
2. Q4: riscrivere esplicitamente che NESSUNA risposta finale è stata catturata in nessun braccio; il "full correct list" è solo traccia di thinking; ritirare "the correctness evidence that matters" in favore di "reasoning-trace-only smoke test".
3. Registrare la violazione del gate termico CLI (pre-gate assente/stale per entrambe le invocazioni) come deviazione binding dal prereg, con nota mitigante (post=48.0 °C).
4. Sostituire "max HAL well under gate" con i valori reali (41.0/41.0/45.7/57.6 pre; 61.5/63.0 post) e notare che i run CPU hanno superato la soglia in esecuzione.
5. Qualificare "In EVERY compared failure": 61/70 FAIL MUL_MAT hanno diagnostico (tutti CPU non finito, 49 con +inf); 7 FAIL senza alcun diagnostico (incluso q4_0 m=1 n=2048 k=8192) restano non-caratterizzati; enumerare CPU=+inf.
6. Notare che il control OpenCL copre 294/297 firme HTP0 (3 iq4_nl scoperte) e che MUL_MAT non ha control.
7. Accodare SHA256SUMS + log di verifica kit come artefatti mancanti in raw/ (o depositarli).

## NON OSTACOLA (regge)

Censimento completo 362/362 diagnostici: HTP0 sempre finito, CPU sempre nan/inf, zero inversioni. Conteggi, mediane, rapporti, ordine N-C-C-N, flag, exit, lock prereg: tutti verificati esatti. Il verdetto Q2 (FAIL → defect list started) è applicato come scritto e resta valido.

**VERDETTO FINALE: FIX** — applicare le 7 correzioni, poi la cella è da ALIVE.
