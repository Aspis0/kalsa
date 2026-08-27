---
name: repack-q23k-v1-state
description: "Stato al 27/08 sera (acf69301): q59 owner A, q62 COMPLETA (compute-bound, secondario+opzionale bancati), q64 costante cache 3437 MiB, governor #24 design v2.1, q63 BANCATA #35 + erratum q59 + appendice q67 (acf69301), q67 CHIUSA: C1 GIRA su HTP v75 + pp512 4.5x, r VOID (termico attaccato), q66 APK in coda dopo q63, piano 10 giorni firmato"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2fb8e59a-4ad7-403b-a321-8ee8ed388dfe
  modified: 2026-08-26T22:31:08.410Z
---

**Repo**: outer `main` = **`c42cf616`** pushato e fetch-verificato (q59 bank); **kalsallama `main` =
`a0cabca6b`**; BigMoeOnEdge submodule a `9f2584f0` (kalsa/drop-policy-s2, DIRTY 9 file = WIP owner,
intoccabile). PLAN riga 28c/#30/#31/**#32** e ALIVE righe 11/13/**14** + §8 sono la vista; ledger
router in `scratchpad/agents/q54-engine-router/SPEC.md` §6. Residui pre-sessione NON committati
(GROK_GOAL.md cancellato, q40/q48/q53 report modificati): decisione gualt.

**Verdetti bancati (24→26/08, ogni cella con prereg lockata + audit prima del bank)**
- **q59 (26/08, `c42cf616`) — quant denso HTP-readable su Qwen3.5-4B: IQ4_NL FAIL** (es +1.39 %,
  zh +1.02 % vs gate +1.0 % su 5/5; wiki −1.16, it +0.84, fr +0.46), **Q4_0 FAIL** (+2.15…+3.36
  su 4 lingue). Paired per-chunk (post-hoc, NON-gating): IQ4_NL peggiore del control su tutte e 4
  le lingue in modo non-rumore (CI esclude 0), upper bound ≤ +1.93 %, posizione vs +1 % irrisolta
  su it/es/zh; wiki inverte (candidati migliori, inspiegato). Effetto 3–9× più mite del q41 KEXP
  (+4.27 %). Audit math DeepSeek + doc mimo entrambi BANK-w-corrections solo wording. **Decisione
  owner pendente: A = resta Q4_K_M (raccomandata), B = IQ4_NL con gate loop classe q52 prima.**
  IQ4_NL = variante lab NPU come B′. ~24 GB di gguf/BF16/shard in `q59-dense-quant-gate/gguf/`
  fuori git (decisione gualt se cancellare).
- **Tronco Q8 (B′) BOCCIATO** (q52): col sampler di produzione loopa 4/10; lineup resta Q5_K/Q6_K.
- **NPU v73 (S23) CHIUSA**: 3 firme di morte firmware, incidente termico 25/08, spike pp512 ok
  (q58: N_max 512 token, soglia 39.5 °C).
- **NPU v75 (Xiaomi) CERTIFICATA** (q55): esperti OLMoE 32 chunk r −0.02 % (`-nkvo` obbligatorio
  a ctx 2048); Qwen ibrido r10 +0.11 %; spike ≤ 1 °C, NPU 8–11× CPU. R2 certified, R3
  caratterizzata, entrambe OFF finché mancano cella spike app-side e modello memoria HTP.
- **Streaming**: q60/q60b/q61 = mmap page-fault streaming PATTERN-bound (0.2–0.4 GB/s) → NON misura
  lo streamer di prodotto → q62.
- Router spec v0.2 pronta; watchdog q56 = strumento di produzione. HVX K-quant FERMO fino a (1) q62
  e (2) dato 8xx (QDC). Report upstream v73 = NON si fa.

**q62 BANCATA 26/08 sera (`bb031f46`, PLAN #33, ALIVE #15)**: prefill sotto lo streamer di
prodotto su Xiaomi = **COMPUTE-BOUND** (I/O 10–13 % del wall dall'io-trace, robusto sotto tutti i
bound), headroom k=4 ≈ 4.5 (≥ 2.095 ogni bound) → **prerequisito HVX (1) soddisfatto, decisione
kernel = owner (con dato 8xx)**. Primario 3/3; **secondario+opzionale BANCATI 27/08 notte (`85036e10`)**: cache lavora in decode
(−30 % byte) ma prefill byte-identico (nessun effetto misurabile, come da prereg); headroom k=4
point 4.45–4.60, ma 1.94–2.02 sotto il bound serializzato (claim '≥2.095 ogni bound' solo primario). Lezione: il binario spedito
`0ac612de` NON ha `-r`/`--no-warmup` e `-p` è TESTO; il motore non decompone io/compute in prefill
(solo decode) → I/O da `--io-trace` (latenze per lettura, modello max-lane). Harness riusabile:
`q62-product-streamer-prefill/{launch_q62.py,run_q62.py,q62_sampler.sh}` (sampler: seguire
binary_pid, non il wrapper).

**26/08 notte, `19e0af12`**: **q64 BANCATA** (PLAN #34, ALIVE #17): sweep cache streaming su S23
(Marco i1 10.5 GB > 8 GB, bmoe-cli spedito) → decode 1.07→2.84 t/s da cache 0→4000 MiB, auto
= 3437 MiB entro il 5 % del migliore → **costante cache app (8 GB, streaming) = 3437 MiB**;
prefill cala con la cache ma NON stabilito. **#24 governor design study v2.1** bancato
(`docs/GOVERNOR-TRI-ENGINE-DESIGN.md`, audit DeepSeek): soglie relative a T_idle attaccato,
regola di ammissione pre-turno, oggi nessuna corsia NPU ON, celle G1–G5 (G1 = curva throttle
CPU S23 attaccato, la più preziosa). q65 (encoder visivo su HTP v73, SmolVLM-500M candidato)
FERMATA fino a fine q63 per non ingolfare il PC ([[pc-stability-over-throughput]]).

**q63 IN VOLO (lock `7477247a`, road D owner)**: ricetta HTP-readable IQ4_NL-M su Qwen3.5-4B
(C1 = IQ4_NL + Q8_0 sui tensori Q6_K di Q4_K_M via `--tensor-type` first-match; C2 = `--pure`
IQ4_NL + Q8_0 embd/out), controlli q59 riusati, pre-check validità binario ricompilato (control/fr
= 7.1786 ± 0.0005), runner detached notturno PC (~13 h), agente Luna-3 `f4d556a6`. **Erratum q59
da bancare col report q63: l'arm "IQ4_NL" di q59 era NON pura (37 tensori Q5_K) → non leggibile
HTP.** I binari PC `build-pc-quantize/` e `build-llama-pc/` erano SPARITI (chi? chiesto a gualt),
ricompilati ai commit pinnati (sha nuovi in PREREG q63).

**Storico q62 (prima uscita)**: agente Luna-2 Paseo `d4fc3a41`
  (codex/gpt-5.6-luna full-access) esegue sullo Xiaomi: push `models_staging/ship_runtime_s23_0ac612de/`
  → `/data/local/tmp/q62_rt/`, sha on-device, smoke `--help`, harness `launch_q62.py` + `q62_sampler.sh`
  + guard q56, arm primario `bmoe-cli --moe-stream --cache-mb 0 ... -p 512 -r 3` su CalaQwen KEXP
  (13.4 GB, a bordo), secondario `--cache-mb 2000`. Xiaomi STACCATO da gualt al 55 %, 29.8 °C.
  Stop-rule esatta e deviazione "plugged" registrata se mai. Output attesi: RUN_LOG/manifest/raw/
  REPORT + `STATUS.txt` per fase. Al DONE: audit math (DeepSeek) sui tetti (headroom k=2/4/8,
  metodo [[measurement-ceiling-method]]) → bank PLAN+ALIVE → decide prerequisito HVX (1).
- Coda: cella spike lato app (riaccende R2/R3), modello memoria HTP, assaggio 8xx QDC (prereg su
  go), app-Claude rebuild a0cabca6b + arm 464s, decisione owner q59 A/B.

**Device**: S23 (v73) a riposo; Jelly libero; Xiaomi (v75, 12 GB) in uso q62. Seriali in
[[adb-from-git-bash]]. Grok autolaunch bloccato → sessioni device via Luna full-access
([[grok-autolaunch-blocked]]).

**q67 CHIUSA 27/08 (lock `4b5afc37` + Amdt1 `d451a1ee` + Amdt2 `aa697b3d`, artefatti committati)**:
STA IN PIEDI: C1 di q63 carica ed esegue su HTP0 v75 (prova execute-op) + pp512 HTP 199.7 vs CPU
43.8 t/s (~4.5×), sha verificati, temp piatte in B. VOID: r HTP-vs-CPU — att.1 mancava -f corpus
(errore orchestratore), att.2 A1 kill guardia 41.1 °C con 20 chunk HTP validi, A2 CPU kill 43.0 °C
al chunk 4 (attaccato in carica NON regge PPL sostenuta, nemmeno CPU). Opzione aperta: Amdt3 A2
STACCATO (~40 min) se gualt stacca lo Xiaomi oggi; altrimenti banca così come appendice di #35.
S23 staccato lasciato FERMO di proposito (tutto il suo lavoro richiede APK o cavo).

**27/08 pomeriggio**: q63 runner DONE (`70035b18` artefatti): C1 PASS 5/5 (wiki −2.31, it +0.43,
es +0.95 con CI paired [+0.39,+1.51] a cavallo soglia — dichiarato, gate point-estimate; fr +0.12,
zh +0.62), C2 pura FAIL 3/5 → qualità nel mix. Bank #35 preparato in working tree (PLAN riga 35 +
STATO, ALIVE riga 18 + erratum su riga 14) con segnaposto <ESITO_A3>/<AUDIT_*>; commit SOLO dopo:
audit math DeepSeek `357c1d09`, audit doc mimo `7584bb2f`, e A3 di q67 (Luna `2530364f`, A2 staccato
--chunks 20, owner ha staccato lo Xiaomi). q66 build APK sbloccato su Luna `9cf8103b` (gate 8 GB RAM,
no install ancora). Pipette (Liquid AI) segnata in [[pipette-liquid-benchmark]].

**q68 accodata (idea gualt 27/08, 'da vedere')**: dirty-phone load su S23 — RAM piena di app reali,
lancio app Kalsa: scalza le residenti (LMK economy, anon vs mmap)? tempo a model-ready, vittime da
logcat lowmemorykiller. Cella separata DOPO q66 (prereg q66 lockata, non si tocca), stesso APK.
Contesto: q67-A3 non ha mai fatto pressione (adb shell, gate pre-load); direzione opposta di q66.

**27/08 sera — BANK COMPLETO `acf69301`**: PLAN #35 + ALIVE #18 + erratum q59 su riga 14. q63: C1
IQ4_NL-M PASS 5/5 (audit math BANK pulito, doc BANK-w-corr applicate), C2 FAIL 3/5. q67 CHIUSA in
appendice: LOAD su HTP v75 provato + pp512 4.5×; r VOID (4 amendment, gate 4.0 GiB mai abbassato,
mai aperto nemmeno post-reboot — residenti HyperOS 3.6 GB; misura al rientro v75 o QDC v79). Road D
aperta: ship per-device v75-class SOLO dopo gate loop classe q52; HVX §8 'q63 FAIL' NON scatta.
IN CORSA: q66 build APK (Luna 9cf8103b, short-root C:/Users/gualt/q66b, fix repack-q23k.h fatto,
ora consistenza mtmd/minimax-m3 llama.rn-vs-engine); poi install S23 + cella q66; q68 dopo q66;
q65 scongelabile (PC libero).

**q69 accodata (gualt 27/08, 'si accoda')**: ricetta IQ4_NL-M su LFM 2.5/2.6 — il denso app e' per-device (RAM/telefono), niente default unico ([[kalsa-model-nicknames]]). Piano: (1) verifica arch nel toolchain pinnato, (2) dump Q4_K_M LFM → lista tensori promossi, (3) harness q63 riusato per PPL 5 corpora PC-side (perfetto coi 10 giorni), (4) smoke load classe q67 su HTP quando torna un v75/QDC (occhio: layer conv corti LFM → op supportati dal backend Hexagon?). Verdetti mai trasferiti: gate per modello + gate loop prima di ship.

**27/08 sera — OPZIONE C IN CORSO (ordine gualt: 'facciamo subito C e lo metti su main')**: pin
kalsallama come engine app via meccanismo ufficiale llama.rn (submodule third_party/llama.cpp →
fork + npm run bootstrap + scripts/patches; precedente ChatterUI/cui-llama.rn). Fase 1 COMPLETA
(`a00ac306`): GAP_JSI + GAP_MTMD_CMAKE (GLM x2) + WEBSEARCH + ENGINE_PIN_GAP consolidato (Luna):
R1 raccomandata (llama.rn resta 0.12.8, 9 blocker reali, patch app 196 righe sopravvive verbatim),
stima 24-40 h. FASE 2 CHIUSA CON PASS (3 passate reviewer GLM 602aea55): backport nel fork su clone fresco
C:/Users/gualt/kals-pin branch `app-pin-compat` (load_mode M, progress/vocab_only S, reasoning
activate_immediately+multi-end adapter M, thinking_end_tags plurale M, chat variant/caps S/M,
mtmd text_len S) — MAI toccare BigMoeOnEdge submodule (WIP owner). Fase 3 = llama.rn fork side
(trie copy-lines, 2 patch rebase, submodule pin) su branch ai-chat; fase 4 = build verde+assert →
merge main ai-chat (ok owner) avvisando la sessione app. APK CI-parity fallback: sha 444CCC8D.
S23 baseline: T_idle_plugged 27.8, classe cool, gate fallback 30.8, prereg DRAFT lock a Phase-1.

**27/08 notte — FASE 2 PASS, FASE 3 IN VOLO (`034ec723`)**: app-pin-compat @ `d1cc3b77` (build 501/501,
57/58 + skip ARM noto, reasoning-budget 12/12, prefill byte-identico a upstream #22488, test
revert-tripping). Review trail completo in phase2/REVIEW_PHASE2.md (PASS-w-fixes → FAIL F19 → PASS).
FASE 3 (Luna 9cf8103b): fork llama.rn sotto Aspis0 branch `kalsa-pin` da v0.12.8 (submodule →
kalsallama d1cc3b77; CANCELLARE TUTTE E 4 le patch chat.h/chat.cpp/common.h/sampling.cpp — F1+F20,
mai parziale; +repack-q23k.h copy, −trie copy; bootstrap in Git Bash; cpp/ rigenerato COMMITTATO;
neutralizzare download-native-artifacts; gate check-bootstrap-chat-symbols esteso a common.h) →
branch ai-chat `engine-pin-kalsallama` (UNICA scrittura permessa: branch nuovo, mai main) →
build APK arm64 + assert + marker engine. Merge su main = passo separato mio (ok owner), poi
avvisare la sessione app. Play memory mandate 2027: [[play-memory-mandate-2027]].

**27/08 tarda sera — APK KALSALLAMA ESISTE**: sha 8621E6F1..., fork llama.rn `a67a2639` (kalsa-pin,
hexagon opt-in via -PrnllamaHexagon, link pool serializzato), ai-chat branch `4c78b76b`
(engine-pin-kalsallama). Marker q23k in 6/6 lib engine. In chiusura da Luna: fix assert (cerca solo
librnllama.so, marker nelle _jni*.so) + workflow CI build-kalsa-apk (regola [[builds-on-ci-not-pc]])
+ install S23 con BACKUP apk attuale + smoke. POI merge main ai-chat (passo mio, ok owner) +
avvisare sessione app via gualt. Dopo: cella q66 vera con questo APK.

**27/08 notte — OPZIONE C COMPLETA E MERGIATA (main ai-chat = eaee200b)**: CI verde (run 33119894980, artifact APK
51 MB), assert 24/24, smoke S23 ok → PR https://github.com/Aspis0/kalsa/pull/1
(engine-pin-kalsallama → main) MERGIATA da me su autorizzazione esplicita gualt ('ti autorizzo'). APK kalsallama GIA' INSTALLATO su S23 (backup
device-backup/preinstall-2026-08-27). PROSSIMO: cella q66 (prereg a6f96328) con questo APK —
PREP di fatto completo; da lanciare come primo atto dei 10 giorni. Avvisare sessione app del pin
(via gualt): loro item 'rebuild a0cabca6b' superato dal pin d1cc3b77.
