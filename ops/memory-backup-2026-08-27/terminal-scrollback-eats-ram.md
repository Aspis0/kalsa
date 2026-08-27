---
name: terminal-scrollback-eats-ram
description: Windows Terminal accumula decine di GB di scrollback e Clear Buffer NON li restituisce; sintomo = desktop nero
metadata: 
  node_type: memory
  type: reference
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-18T22:43:41.724Z
---

**2026-08-18: desktop nero (icone visibili solo cliccando) su un PC da 31.6 GB.**
Diagnosi: pressione di memoria. Il colpevole **non era il job di inferenza**
(`bmoe-cli` stava a 3.1 GB privati, del tutto normale per un modello da 6 GB con
cache 2000), ma **`WindowsTerminal.exe` con 33.8 GB di memoria privata** — sei
giorni di scrollback accumulato dalle nostre sessioni.

Meccanismo del sintomo: sotto pressione Windows sfronda il working set dei
processi fermi; la bitmap a schermo intero dello sfondo viene scartata, la finestra
del desktop dipinge il colore di fondo (`HKCU\Control Panel\Colors\Background = 0 0 0`
= nero) e ridipinge davvero solo quando un click invalida l'area. Nessun crash di
explorer, nessun TDR del driver video negli eventi: **non si era rotto niente.**

⚠️ **`Clear Buffer` NON libera la memoria.** Provato: private rimasto a 33.8 GB e
working set *salito* da 688 MB a 16 GB (il processo viene ripaginato dentro, non
svuotato). L'allocatore non decommitta. **L'unico rimedio reale è riavviare
Windows Terminal** — che però stacca la sessione Claude in corso (recuperabile con
`claude --continue` dalla stessa directory).

**Fatto il 2026-08-18 in `settings.json`** (`...\Packages\Microsoft.WindowsTerminal_
8wekyb3d8bbwe\LocalState\settings.json`): `historySize: 20000` nei
`profiles.defaults` (vale solo sui pane NUOVI), più due keybinding che mancavano —
`ctrl+shift+k` → azione `clearBuffer`/`clear: all`, e `ctrl+shift+p` → palette
comandi, che nella config dell'utente **non era legata a nulla** (l'array
`keybindings` è esplicito e non la conteneva: per questo `Ctrl+Shift+P` "non apriva
niente", non era un guasto).

**Why:** ho perso tempo dando la colpa al nostro job leggendo `FreePhysicalMemory`
(che conta solo le pagine LIBERE, non standby) invece di guardare **chi** teneva la
memoria.

**How to apply:** al primo sintomo, `Get-Process | Sort PrivateMemorySize64 -Desc`
e guardare il colpevole, non la memoria libera. E non riversare log grossi sullo
stdout: redirigerli su file e leggerli da lì.
