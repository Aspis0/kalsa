# MANDATO — adozione DENSE2 (re-pin) + esperimento mincore sul residuo

Decisione di gualt (2026-08-08): **DENSE2 si adotta** — domina strettamente CAMPAIGN su
ogni asse misurato (−0.81 GiB I/O, rchar dimezzato, VmHWM −321 MiB, identità 8/8).
Due passi, in carica ammesso (tutto deterministico).

**Regole fisse:** non toccare `../ai-chat`; STOP al report, mai `complete_goal`;
PREFAULT intatto.

## PASSO 1 — re-pin

1. `chmod u+w bmoe-cli.CAMPAIGN` → `cp bmoe-cli.DENSE2 bmoe-cli.CAMPAIGN` → `chmod a-w`
   → aggiornare `CAMPAIGN.sha256`.
2. A verbale: VECCHIO `ede3ac7c…` → NUOVO `cab20432…` (verificare che lo sha del file
   copiato coincida con quello del report dense2 prima di scrivere il sha-file).
3. **Smoke post-pin** (2 controlli in 1 run + 1 run):
   a. scenario due-turni della diagnosi KV col binario CAMPAIGN → attesi `n_common=71`,
      `n_prompt(t2)=41` (il fix KV è nella base di DENSE2, va provato non presunto);
   b. in un load qualunque, presenza in stderr delle due righe di strumentazione
      (`dense-anon: memcpy=…` e `expert-mmap: dropped …`) — firma che il binario pinnato
      è davvero DENSE2.
4. `bmoe-cli.DENSE2` resta come copia nominata. `KVFIX` si può rimuovere (superseded,
   sha a verbale).

## PASSO 2 — l'esperimento da 10 minuti sul residuo (~0.85 GiB)

Domanda unica: **la metà non-residente del dense sparisce DURANTE il warm-up, o DOPO
(tra fine warm-up e conversione)?** Dalla risposta dipende se un riordino della
conversione ha senso. Esperimento, non teoria.

- Build usa-e-getta `bmoe-cli.DIAG2` (base = tree DENSE2): **una riga** temporanea a fine
  capture warm-up (prima di rebind/drop/conversione) che esegue lo stesso piano `mincore`
  sulle range dense e logga:
  `bmoe: DIAG dense-resident-at-warmup-end: <MiB> / 1664`
- 1 run a cache fredda (fadvise), config di campagna. Confronto col valore alla
  conversione (memcpy ≈ 815 MiB, dal report dense2).
- Sorgente ripristinato dopo il run; binario non di campagna, si butta.

**Regole di decisione (dichiarate ora):**

| residente a fine warm-up | conclusione |
|---|---|
| ≥ ~1400 MiB (≈85%) | il reclaim avviene DOPO il warm-up → **il riordino recupera**: si scriverà il mandato di riordino della conversione |
| ≤ ~900 MiB (≈ come alla conversione) | il reclaim avviene DURANTE il warm-up → il riordino non recupererebbe nulla: **residuo chiuso definitivamente**, si passa oltre |
| in mezzo | riportare il numero; decide il coordinatore |

## Deliverable

`reports/moe-adopt-dense2.md` (breve): sha vecchio/nuovo + esito smoke (a+b) + numero
`mincore` a fine warm-up + verdetto secondo la tabella. **STOP al report.**
