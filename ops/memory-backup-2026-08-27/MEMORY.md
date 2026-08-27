# Memory index — moe-experiments

- [Stato 26/08 sera: q59 BANCATA (owner A), q62 BANCATA (compute-bound, HVX prereq (1) OK, secondario mancante), q63 IN VOLO notturno PC (Luna-3 f4d556a6)](repack-q23k-v1-state.md) — outer bb031f46, kalsallama a0cabca6b; Xiaomi via con gualt; coda: q63 bank+erratum q59, q62 secondario, decisione HVX owner, QDC 8xx

- [Lezioni operative Paseo](paseo-ops-lessons.md) — agenti muoiono silenziosi (idle senza notifica → list_agents), risposte troncate → get_agent_activity, "resto in ascolto" non esiste, profili da rileggere a ogni giro, verdetti del free coder da arbitrare

- [Termux:API muore](termux-api-can-die.md) — batt=-1 → STOP_BATT falso; termux-api-start prima di ogni riavvio harness; export PATH nelle probe ssh

- [Script device solo LF](device-scripts-lf-only.md) — CRLF su Termux = morte silenziosa a riga 5; bash -n su Git-bash è falsa conferma; sed \r$ prima di ogni scp + verificare STATUS entro minuti

- [Recovery stato progetto](moe-exp-recovery.md) — PLAN.md STATO CORRENTE è la vista; registro checkpoint ~riga 1090; in-flight via logs/ mtime + resume_*.ps1
- [Watchdog termico intra-run OBBLIGATORIO](device-thermal-watchdog-mandatory.md) — 25/08 S23 spento bollente e non riparte dopo PPL HTP v73 sostenuta; gate pre/post non basta: poll 10 s, kill a 43 °C, cap 10 min sui run NPU v73
- [Metodo tetti di offload](measurement-ceiling-method.md) — wall/max(I/O floor, compute/k) in wall-secondi, mai 1/(1−share); floor self-consistent = tautologia; per-processo ≠ per-prompt; modello < RAM non è streaming
- [Kill dei background alla compattazione](background-kills-at-compaction.md) — task tracciati muoiono al confine di compattazione; agenti lunghi SEMPRE detached via Start-Process + watcher tracciato leggero
- [I figli dei runner detached vanno in process group proprio](detached-children-need-own-process-group.md) — CTRL di console di shell terze uccide i figli (0xC000013A) anche con padre detached; output di processi morti a metà → cancellare, mai skip-resume
- [tail -f blocca i log su Windows](monitor-tail-locks-logs.md) — un Monitor su STATUS.txt uccide il runner che ci scrive; guardare altri segnali
- [git push sopravvive al kill della shell](git-push-survives-shell-kill.md) — push in timeout = quasi sempre riuscito; "cannot lock ref is at <mio HEAD>" al retry = successo mascherato; sempre fetch+confronto ref, mai retry cieco
- [Watcher non vedono i morti](watchers-verify-pid.md) — verificare PID + size out.log a ogni check di board; 0-byte log + pid morto = morto al lancio
- [MAI pushare su repo di terzi](never-push-to-upstream-bigmoe.md) — dal 22/08 fork llama.cpp origin=Aspis0/kalsallama, pre-push allow-list solo Aspis0 (testato), .gitmodules bonificato da Helldez; sweep di verifica prima di agenti nei repo
- [Il binario pinnato sta su kernel-s2-layer-fuse](pinned-binary-lives-on-kernel-s2-branch.md) — non su main; main rifiuta --no-moe-fused-*; e `strings` sull'exe mente
- [Il PC congela i job in Modern Standby](pc-modern-standby-freezes-jobs.md) — processo "vivo" ma fermo: confrontare mtime del log + eventi Kernel-Power 507 prima di dare la colpa al codice
- [Il Jelly muore nei sleep inattivi](jelly-dies-in-idle-sleep.md) — le morti sono nei cooldown, non nelle run; ping OK con tutte le porte Termux chiuse = ucciso il process group; spezzare i sleep + heartbeat, e il watchdog rispinge lo script prima di rilanciare
- [pgrep non vede l'harness vivo](pgrep-misses-exec-wrapper.md) — il wrapper fa exec nello script interno: pgrep sul nome del wrapper torna VUOTO su harness sano → lanci un duplicato che scalda le run fredde
- [Qualcomm Device Cloud](qdc-device-cloud.md) — qdc.qualcomm.com, gualt ha minuti FREE (22/08); farm vendor per 8xx, Hexagon v75+, matrice compiler E031 del dossier; verificare adb interattivo/binari custom
- [Canale chat Qwen Max](qwen-max-chat-channel.md) — https://chat.qwen.ai/ su Chrome (plugin) per confronti diretti con l'auditor Qwen 3.8 Max
- [Grok autolaunch bloccato](grok-autolaunch-blocked.md) — `--always-approve` lo blocca il classifier; niente workaround, prompt pronto e ok owner
- [adb da Git-bash](adb-from-git-bash.md) — MSYS_NO_PATHCONV=1 o i path device si storpiano; i bench si lanciano da `adb shell` (0-7) mai da Termux (0-2); /data S23 pieno al 96%
- [Lo scrollback del terminale mangia la RAM](terminal-scrollback-eats-ram.md) — desktop nero = 33 GB in WindowsTerminal, non nel job; Clear Buffer NON libera; guardare CHI tiene la memoria, non quanta ne resta
- [Gate cpuset su OGNI harness](cpuset-gate-every-harness.md) — F4.3-bis exit 93 + colonne nproc/affinity_mask stanno solo in run_bench.sh; senza, la cella non è validabile dopo; sondare la shell non dice nulla, si legge /proc/<pid-binario>/cpuset
- [Soprannomi modelli](kalsa-model-nicknames.md) — CalaQwen = Qwen3.6-35B; Marco = Marco-Mini KEXP; ricetta KEXP = esperti Q2_K+Q3_K, tronco Q5_K/Q6_K (verificato al gguf 20/08): la lineup non tocca MAI i tipi trans4; gpt-oss (MXFP4) sì
- [Policy modelli opencode](opencode-model-policy.md) — mimo-2.5 explorer, v4-flash default, mai GLM 5.3; tetto quota per provider a 5h
- [La lista profili è legge](profile-list-is-law.md) — mai modelli fuori lista senza chiedere (Sol vs Luna 19/08); quota morta → segnalare, non ripiegare da solo; gli AUDIT si delegano ai reviewer (mai auto-certificarsi): Free coder PRIMA scelta quando basta, mimo riserva per audit profondi, Reviewer Math=Luna; rileggere la lista a ogni giro
- [Keepalive Jelly via adb](jelly-keepalive-via-adb.md) — schermo acceso via adb (da Termux è vietato); 26+ min contro i 20 fatali
- [Lezioni ops campagna 21-22/08](kalsa-campaign-ops-lessons.md) — binari pinnati da archiviare AL LOCK; ALIVE.md a ogni bank (gualt legge quello); ox-alpha muore alla scrittura finale → file-first; interessi gualt: governor termico #24, proposte pazze #25
- [Campagna kernel Adreno COMPLETA + decision table + TRE giudici avvelenati risolti](adreno-moe-two-defects.md) — 23/08: NaN-judge = tiled-memcpy is_host (non REPACK), 36 residui = HMX mai partito + error-swallowing; ERR 10⁵× soglia = kernel mai girato, non imprecisione; 4+1 difetti fixati device-verified (407/407), q2/q3 inediti, Vulkan morto sui K-quant, NPU bocciata (0.67MiB); verdetti 740/S23: CPU pura più veloce (refute A/C), GPU = cool-mode solo KEXP, mezzo-offload MAI, streaming: conta la ricetta; **750 (#16 22/08): kernel trasferiscono (407/407 su E031.45) MA il compiler nuovo rompe f16 batched upstream (20 fail) e A≈C decode + A=2.21× prefill → il "C vince sempre" era solo del 740**
- [Topologia repo + lignaggi engine](kalsa-engine-single-lineage.md) — 22/08 "opzione A": fork = Aspis0/kalsallama con DUE lignaggi (kernel-s3-repack GPU, mmap-prefetch-opt hook CPU dell'app); vendored eliminate, patch app ri-derivate col diff; "bmoe/expert-ready-hook" non esiste; banner "kalsallama" da introdurre
- [gualt via 28/08→~07/09: solo S23+Jelly ATTACCATI (temperatura!), Xiaomi assente, parlare meno](owner-away-2026-08-28.md) — niente celle v75, plugged declared, watchdog obbligatorio, keepalive Jelly, celle corte/PC-side
- [Stabilità PC > throughput con owner via](pc-stability-over-throughput.md) — un solo job pesante alla volta, niente build/download in parallelo alle PPL; freeze/reset = campagna ferma 10 giorni
- [Pipette (Liquid AI) benchmark on-device](pipette-liquid-benchmark.md) — open-source, NPU esclusa (noi oltre), thermal-gate simile a q56, Q2_g64 da guardare
- [Cercare prima online](search-online-first.md) — regola gualt: problema tosto → websearch SUBITO, non dopo il terzo tentativo
- [Play memory mandate 2027](play-memory-mandate-2027.md) — anon RSS+swap gated da feb 2027 + Android 17 MemoryLimiter kill; mmap non conta (repack #29 premiato), NPU/cache anon esposti
- [Build su CI, non sul PC](builds-on-ci-not-pc.md) — repo pubblici = Actions gratis; PC solo celle/smoke; APK via workflow artifact+sha
- [S23 solo APK debuggabili](s23-debuggable-apks-policy.md) — release+debuggable flag, run-as sempre; release pulito = solo artifact CI
