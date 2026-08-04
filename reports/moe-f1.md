# F1 — Setup telefono — 2026-08-03

## Cosa è stato fatto (vs piano)

### Checklist device (pre-F1 + F1)
| Voce | Stato | Note |
|---|---|---|
| ≥40GB liberi su `/data` | OK | 93GB free (pre-check orchestratore) |
| Batteria >50% | OK a setup | 50%→56% durante setup; **in carica AC** |
| Device vergine dedicato | OK | SM-S911U (S23 US), Android 16 |
| Nessun blocco schermo | OK | `locksettings get-disabled=true` (pre-F1) |
| Termux SENZA storage permission | OK | mai eseguito `termux-setup-storage`; READ_EXTERNAL_STORAGE non granted |
| RAM Plus OFF | OK | `ram_expand_size=0` (pre-F1) |
| Termux da F-Droid/GitHub (mai Play) | OK | GitHub releases v0.118.3 **github-debug arm64-v8a** |
| Ottimizzazione batteria disattivata | PARZIALE | `deviceidle whitelist +com.termux`; appops RUN_IN_BACKGROUND/RUN_ANY_IN_BACKGROUND/WAKE_LOCK allow. Non verificata UI Device Care post-drop |
| `termux-wake-lock` | OK | installato `termux-api` pkg; boot script lo invoca; chiamato in sessione |
| Phantom process killer workaround | OK | `settings_enable_monitor_phantom_procs=false`, `max_phantom_processes=2147483647` (pre-F1) |
| Modelli in `~/models/` (mai `/sdcard`) | OK | path home Termux only |
| Misure non sotto carica / ≤32°C | NON ESEGUITE | batteria `PLUGGED_AC`, temp ~31–33°C; gate non lanciato |

### Phase A — Install Termux + addons
- **termux-app** v0.118.3 `+github-debug_arm64-v8a.apk` (scelta deliberata: `android:debuggable=true` → `run-as com.termux` per setup scriptabile; GitHub releases autorizzati dal piano). Install via `pm install -r -t -d` dopo push su `/data/local/tmp` (install stream falliva con `INSTALL_FAILED_VERIFICATION_FAILURE`; workaround: `verifier_verify_adb_installs=0`, `package_verifier_enable=0`).
- **termux-api** v0.53.0 github.debug, **termux-boot** v0.8.1 github.debug — installati.
- Primo avvio: crash iniziale `BackgroundServiceStartNotAllowedException` con schermo spento (`am start` da adb in background). Fix: wake screen (`KEYCODE_WAKEUP` + `svc power stayon true`) → bootstrap OK (`files/usr/bin/bash` presente, ~389 bin).

### Phase B — Controllo remoto SSH
- Keypair PC: `~/.ssh/moe_s23` (ed25519, no passphrase, comment `moe-s23`).
- `~/.ssh/authorized_keys` scritto via `run-as` (chmod 700/600).
- Boot script `~/.termux/boot/start-sshd.sh`: shebang Termux, `termux-wake-lock` + `sshd` (commento IT).
- `openssh` installato; `sshd` in ascolto su **8022** (default Termux).
- Accesso verificato: `ssh -p 8022 -i ~/.ssh/moe_s23 u0_a344@192.168.1.152 'echo OK'` → **OK** (utente `u0_a344`).

### Phase C — Pacchetti, build, modelli, harness
**Pacchetti installati:** git, cmake, ninja, clang, make, python, curl, jq, openssh, termux-api, llama-cpp (pkg `0.0.0-b10092-0`, smoke-only).  
**fio:** package **non presente** nei mirror Termux al momento del setup → rimandato a F2 (build da sorgente o mirror alternativo).

**Build llama.cpp mainline:**
- Clone tag **b10244**, commit `67d5978bb1ba490070ddbd2a7c59c7ec5a60b7cc`
- Configure: `cmake -B build -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF -DGGML_OPENCL=OFF`
- Build: `cmake --build build -j4 --target llama-cli llama-bench llama-perf`
- **Risultato:** `llama-cli` + `llama-bench` prodotti in `~/src/llama.cpp/build/bin/` (BUILD_EXIT=2 perché target `llama-perf` assente/fallito su b10244 — non bloccante; gate usa `llama-cli`).
- bmoe **NON** buildato qui (F4).

**Modelli (`~/models/`, size byte-esatti via `stat -c %s`):**
| File | Atteso (B) | Ottenuto (B) | Metodo | Verdetto |
|---|---:|---:|---|---|
| `Qwen3.5-4B-Q4_K_M.gguf` | 2 740 937 888 | 2 740 937 888 | curl HF su telefono | MATCH |
| `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` | 11 522 702 304 | 11 522 702 304 | scp da PC (Wi-Fi) | MATCH |
| `LFM2-8B-A1B-Q4_K_M.gguf` | 5 044 779 712 | parziale | curl telefono troppo lento (~300 kB/s) → kill; download ripreso su PC in background (`models/`, ~1.2GB+ al drop) poi scp | PENDING |

**Prompt fissi** in `~/experiments/prompts/`: `short.txt`, `medium.txt`, `code.txt` (testi campagna, non da modificare in F2–F4).  
**Harness:** `scripts/run_bench.sh` + `runs.schema.md` copiati in `~/experiments/scripts/` (eseguibile). Dirs: `~/experiments/{results,logs,scripts,prompts}`.

**Smoke test `llama-cli` 4B:** avviato (`-m Qwen3.5-4B-Q4_K_M.gguf -p "Hello" -n 16 -t 4`); durante il load del modello la sessione SSH è caduta (connection reset). **Output di generazione non recuperato** prima della perdita di connettività. Verifica smoke → da ripetere al ripristino accesso.

### Deviazioni / sorprese / bug
1. **Install APK:** `adb install` stream → `INSTALL_FAILED_VERIFICATION_FAILURE` su OneUI/Android 16; fix push+`pm install` + disabilitazione verifier adb.
2. **Primo launch Termux:** crash se display asleep (Android 16 background service ban); serve schermo acceso.
3. **Stack TLS bootstrap:** mismatch `libngtcp2_crypto_ossl` / OpenSSL dopo bootstrap → `curl`/`git-remote-https` rotti; fix con upgrade openssl/libnghttp2 + reinstall curl.
4. **fio assente** nei repo Termux consultati.
5. **llama-perf** non buildabile come target su b10244 (exit 2 non bloccante).
6. **LFM2 via curl sul telefono** troppo lento; strategia corretta = download PC + scp (come 35B).
7. **Drop connettività:** wireless debugging spento (probabile reboot/sessione scaduta). adb devices vuoto, porta 8022 refused, ping IP ancora OK. **Richiede gualt:** riattivare Debug wireless e ripair/reconnect.

## Numeri chiave (tabella, riferimenti a run_id)

| Voce | Valore |
|---|---|
| Device | SM-S911U, Android 16, IP 192.168.1.152 |
| Termux | 0.118.3 github-debug arm64, package `com.termux` |
| SSH | porta 8022, user `u0_a344`, key `~/.ssh/moe_s23` — **verificato pre-drop** |
| llama.cpp | tag b10244 / `67d5978b…` — `llama-cli`+`llama-bench` OK |
| 4B size | 2 740 937 888 B MATCH |
| 35B size | 11 522 702 304 B MATCH |
| LFM2 size | PENDING (PC download in corso) |
| Gate run_id | **nessuno** (non eseguito) |
| Batteria al check | `PLUGGED_AC`, 56%, **31.3°C** |

## Deviazioni / sorprese / bug
Vedi elenco sopra. Nessuna riga CSV prodotta. Nessuna misura sotto carica (corretto).

## Verdetto gate: BLOCKED(connettività telefono persa — gualt deve riattivare Debug wireless; gate F1 run anche pending-unplug: batteria PLUGGED_AC)

Setup software sostanzialmente completo (Termux, sshd, build, 4B+35B, harness, prompt). Manca per chiudere il gate:
1. **gualt:** riattivare Wireless debugging (e, se serve, re-pair) → ripristino adb + sshd (boot script o `am start` Termux a schermo acceso).
2. Completare LFM2 (PC download → scp, size 5 044 779 712 B).
3. Smoke `llama-cli` 4B fino a testo generato.
4. **gualt:** staccare caricatore AC; verificare `termux-battery-status` → `UNPLUGGED` e temperature ≤32°C.
5. Eseguire:  
   `cd ~/experiments && ./scripts/run_bench.sh -m ~/models/Qwen3.5-4B-Q4_K_M.gguf -p ~/experiments/prompts/short.txt --phase F1 --runtime mainline --run-type warm --n-gen 128 --notes "F1 gate"`  
   e copiare la riga CSV valida nel report.

## Prossima azione proposta
1. gualt riattiva Debug wireless → orchestratore/Grok riconnette adb (SDK `adb.exe` diretto, non tool pi rotto).
2. Riavvia Termux a schermo acceso → sshd (boot o manuale); test `ssh -p 8022 … 'echo OK'`.
3. Finire LFM2 scp; smoke 4B; unplug; gate `run_bench.sh`; aggiornare questo report a PASS con run_id.

DONE
