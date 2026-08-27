---
name: adb-from-git-bash
description: "Git-bash storpia i path device di adb; e per i bench si lancia da adb shell (cpuset 0-7), non da Termux/ssh (0-2)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-18T22:43:21.349Z
---

**Due trappole adb su questa macchina, entrambe costate tempo il 2026-08-18.**

**1. Path mangling.** Con lo strumento Bash (Git-bash/MSYS), `adb ... /data/local/tmp`
diventa `C:/Program Files/Git/data/local/tmp` e il comando fallisce con
*"target ... is not a directory"*. Rimedio, prima di QUALSIASI comando adb:
```bash
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
```
Stessa classe di problema: `/tmp/foo.log` scritto da bash **non** è leggibile da
`python` di Windows (che lo risolve come `\tmp\foo.log` sul drive corrente). Per
file che devono passare fra bash e python usare lo scratchpad con path Windows.

**2. `adb shell` ha tutti i core, Termux no.** Su S23:
- `adb shell` → cpuset `/`, `Cpus_allowed_list 0-7`, `nproc` 6-8
- sessione ssh Termux → cpuset `/moderate`, `0-2` (soli A510 a 2016 MHz), `nproc` 3

Quindi **ogni bench CPU-vs-GPU va lanciato da `adb shell`**, non da Termux: altrimenti
la CPU gira su tre core piccoli e l'acceleratore sembra molto meglio di quanto sia.
Modelli e binari in `/data/local/tmp`. Vedi [[cpuset-gate-every-harness]].

⚠️ Vincolo S23 scoperto lo stesso giorno: `/data/user/0` è **pieno al 96%, ~4.5 GB
liberi** — ci stanno i binari (test-backend-ops ~25 MB + libc++_shared), NON un
modello da 4.8 GB. Per benchare modelli grossi serve lo Xiaomi.

adb sta in `C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe` (non in
PATH). Serial S23: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (passare sempre `-s`).

**Seriali/endpoint (26/08/2026)**: S23 = `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (192.168.1.152, porta cambia);
Jelly = `192.168.1.82:<porta>` dopo `adb connect` (mDNS `adb-JELLYS0000053795-UFuN1D`, il nome mDNS NON
funziona con -s dopo un connect manuale); **Xiaomi houji = `adb-625689a2-9xEOfw._adb-tls-connect._tcp`**
(pairing una tantum via VPN 100.68.107.71:<porta pairing> + codice; dopo il pair si attacca da solo via
mDNS; l'entry ip:porta di pairing resta "offline" → `adb disconnect` di quella sola). Lezione: gli agenti
NON devono mai fare `adb connect` su IP che non gli ho dato — Luna ha riconnesso l'S23 per sbaglio.
Xiaomi MemTotal 11.4 GB ma MemAvailable spesso ~4 GB (app residenti): un modello da 6.5 GB NON è
"streaming" pulito lì; serve ≥1.2× MemTotal.

