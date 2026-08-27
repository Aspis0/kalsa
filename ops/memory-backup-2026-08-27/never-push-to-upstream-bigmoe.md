---
name: never-push-to-upstream-bigmoe
description: "MAI pushare a repo di terzi; dal 22/08 il fork llama.cpp ha origin=Aspis0/kalsallama con pre-push allow-list solo Aspis0 (testato); .gitmodules bonificato da Helldez; rifare la sweep prima di far lavorare agenti nei repo git"
metadata:
  node_type: memory
  type: feedback
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-22T19:40:42.567Z
---

**Regola dell'owner: non inviare NULLA a repo di terzi.** I nostri repo sono
solo `Aspis0/*`: `kalsa-moe-experiments`, `kalsa-forkbigmoeonedge` (ex
`kalsa-engine`, rinominato 22/08), `kalsa` (app) e — dal 22/08 —
**`kalsallama`** (fork llama.cpp, privato).

**AGGIORNAMENTO 22/08 (consolidamento "opzione A")**: il fork
`BigMoeOnEdge/third_party/llama.cpp` ha di nuovo UN remote: origin =
`Aspis0/kalsallama` (tutti i branch+tag pushati). Il pre-push hook è passato da
"blocco totale" ad **allow-list `github.com/Aspis0/*`** (testato: terzi exit 1,
Aspis0 exit 0). `.gitmodules` di BigMoeOnEdge non punta più a Helldez ma a
kalsallama (commit `9f2584f`): il rischio "`submodule sync` resuscita il remote
di terzi" è morto. In più: le credenziali git Aspis0 prendono 403 su ggml-org
(difesa in profondità). Il resto della bonifica 21/08 (sotto) resta storia valida.

**Stato dal 2026-08-21 sera (bonifica ordinata da gualt: "rimuoverli
completamente, se no un giorno pusherai per sbaglio")**:

- **Remote di terzi RIMOSSI del tutto** (`git remote remove`), non più solo
  push-DISABLED: `BigMoeOnEdge/third_party/llama.cpp` ha **zero remote**
  (prima: Helldez + ggml-org); `BigMoeOnEdge` ha solo origin Aspis0 (upstream
  Helldez rimosso); i due `deps/opencl-android/OpenCL-*` (KhronosGroup)
  hanno zero remote.
- **Pre-push hook installati e testati**: llama.cpp e deps → blocco totale;
  BigMoeOnEdge → blocca ogni URL non `github.com/Aspis0/*` (verificato con
  bare repo locale). ATTENZIONE submodule: il loro `.git` è un FILE — l'hook
  va nel git-dir vero (`git rev-parse --absolute-git-dir`).
- **Gli alberi-variante del 18/08 non esistono più** (BigMoeOnEdge-kf,
  -kernel-ke, -kernel-lib, -kvfix-a76, -mellum-ppl, -selfspec-f1, llama.cpp
  standalone): sweep 21/08 → solo outer + BigMoeOnEdge + submodule + 2 deps.
- **Fetch upstream quando serve**: ad-hoc per URL esplicito
  (`git fetch https://github.com/ggml-org/llama.cpp master`), senza
  ricreare remote.

**Rischi residui:** (1) `git submodule sync` può RICREARE i remote da
.gitmodules — gli hook restano comunque, ma dopo un sync rifare la sweep;
(2) i branch `kalsa/*` dell'engine vivono solo su questo disco: il backup è
il bundle in `moe-experiments/backups/` committato nell'outer (che si pusha
solo su Aspis0).

**Sweep di verifica (rifarla prima di far lavorare un agente nei repo):**
```bash
cd /c/Users/gualt/Desktop/Kalsa/moe-experiments
find . -maxdepth 4 -name .git | while read g; do d=$(dirname "$g");
  git -C "$d" remote -v | sed "s#^#$d  #"; done
```
Deve restituire **solo** righe `Aspis0/*`. Qualunque altra riga è una
regressione.

**Why:** le patch kernel sono il valore della campagna e i repo non sono
nostri; un push è irreversibile e pubblico. Vedi
[[pinned-binary-lives-on-kernel-s2-branch]].

**How to apply:** nei repo engine si committa localmente e basta; il
versionamento del valore passa da bundle + outer. `BigMoeOnEdge/` è
gitignored dal repo padre, quindi il codice engine non è versionato insieme
ai risultati.
