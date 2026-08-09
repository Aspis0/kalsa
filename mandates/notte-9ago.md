# MANDATO NOTTE 9/8 — due binari: telefono a batteria (leggero), PC a volontà

gualt dorme, telefono **scollegato** (~56% a mezzanotte, celle 3-4 in corso). Due binari
indipendenti. **Regole dure per la notte:** floor batteria **30%** = fine di OGNI attività
telefono (STOP sessione, non "ancora una cella"); guardrail `lib_guardrails.sh` attivi
sempre; flight recorder sempre; se il telefono sparisce dalla rete → UN tentativo di
riconnessione ogni 15 min, MAI riavvii, MAI escalation: si annota e si va avanti col
binario PC. Non toccare `../ai-chat`. STOP ai gate, mai `complete_goal`. Nessuna adozione:
solo report.

---

## BINARIO A — telefono (solo dopo che celle 3-4 chiudono, e solo se batteria ≥ 42%)

### La domanda simmetrica: quanta cache serve DAVVERO?

La Cella 2 ha risposto a "quanta ne reggiamo?" (non più di 2000). Il sistema a 2000 vive
con memfree_min 13-56 MiB: se una cache più piccola costasse poco in tok/s, comprerebbe
headroom prezioso (è RAM per l'app vera, e distanza dal regime-RescueParty).

**Sweep in discesa: C ∈ {1500, poi 1000 solo se batteria ≥ 38%}.**
Per C: 2 prompt fissi (short + f45_1, sha verificati) × 2 rep, `n=200`, ubatch 512,
config di campagna, cold a inizio tier. Metriche: decode tok/s, `expert_hit_rate`,
`memfree_min`, VmHWM.

**Regole di lettura (dichiarate ora):**

| esito | conclusione |
|---|---|
| C1500 entro **−3%** tok/s vs 2000 (mediana vs mediana 4.608) | 1500 è candidato prodotto: stesso motore, +500 MB di headroom. Si valuta C1000 |
| C1500 tra −3% e −10% | trade-off da portare a gualt, nessuna conclusione unilaterale |
| C1500 < −10% | 2000 è il minimo sano: chiudere lo sweep, non scendere a 1000 |

Deliverable: `results/notte9/cache_down/` + sezione nel report notte.

### Se la batteria non basta (probabile): si salta e si dice SKIPPED. Nessun eroismo.

---

## BINARIO B — PC (nessun limite di batteria): lo scorer PPL nel decode-path

Il metro attuale (`--ppl-file`) misura il MODELLO (prefill teacher-forced, all_logits):
è cieco alle decisioni runtime del decode (`--drop-cold-experts`, k effettivo, cache).
Per giudicare le leve runtime serve lo scorer **dentro il decode streamato**. È il lavoro
di stanotte sul fork, SOLO codice + build host: **zero run su telefono**.

**Specifica:**
- Nuova modalità CLI (es. `--ppl-decode <file>`): dato un testo, il motore lo percorre
  token-per-token **nel percorso di decode normale** (streaming esperti, cache, batch=1,
  nessun sampling): a ogni posizione registra `pos,token_id,logprob` del token VERO
  successivo — stesso formato CSV di `--ppl-file`, confrontabile riga a riga.
- Niente fork del calcolo: è il decode di sempre, con in più la lettura del logprob del
  token target prima di forzare quel token come input successivo (teacher forcing).
- Commit pulito sul fork (Conventional, inglese), separato da tutto il resto.

**Verifica notturna su HOST (build-host.sh):**
1. build ok + `bash -n` degli script;
2. smoke di coerenza: su un testo corto, `--ppl-decode` con config default (k=8, niente
   drop) deve produrre logprob **coerenti** con `--ppl-file` sullo stesso testo (stessa
   tokenizzazione; attesa: differenze nulle o da rumore floating-point dell'ordine di
   1e-4 — D1 ha provato che il batch non cambia gli output). Se divergono di più: è un
   bug dello scorer, non una scoperta — fermarsi e documentare.

**Il gate su device NON è di stanotte**: domani, col cavo, lo scorer dovrà riprodurre la
baseline PPL 2.779 su un sottoinsieme del corpus prima di qualunque sweep drop-cold.
Prepararne lo script (`run_ppl_decode_gate.sh`) stanotte, senza eseguirlo.

---

## Report unico al risveglio

`reports/moe-notte9.md`: esito celle 3-4 (se chiuse), sweep cache-down o SKIPPED con
batteria di fine, commit + smoke dello scorer, stato batteria/telefono ora per ora
(dal flight recorder), qualunque guardrail scattato. **STOP al report.**
