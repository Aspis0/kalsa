# MANDATO — shortlist velocità: k=5 → drop-by-weight → top-p (da research-speed-pruning)

Esegue la shortlist C→A→B del report `research-speed-pruning.md` (ordine di
costo). **Regola di adozione: frontiera di PARETO su (tok/s, PPL)** — una leva
entra nel dossier solo se domina o estende la frontiera rispetto a k6d065
(5.86 tok/s, PPL 1.852) e alle altre celle. Floor qualità: **PPL ≤ 2.0955**.
Aspettativa onesta a verbale: ceiling +7-15%, cioè ~6.3-6.7 tok/s.

**Regole fisse:** modello KEXP `ac44e20c…`; PPL in carica OK, speed staccato;
guardrail+flight; floor 30%; screen ripristinato; STOP ai gate.
**ATTENZIONE fase A/B: modificano il FORK** → valgono le regole BigMoeOnEdge
(AGENTS.md: commit Helldez-only, niente patch in-tree a llama.cpp, gates prima
del merge) + le regole di campagna: nuovo binario → **G1 8/8 byte-identici con
flag nuovi SPENTI** → re-pin CAMPAIGN con sha a verbale (procedura solita).

## C — k=5 statico (misura pura, binario attuale, ~mezza giornata)

Celle: k=5 × drop ∈ {0, 0.65}. Per ciascuna: PPL decode subset 10k (in carica)
+ speed n=200 2 prompt × 2 rep ABBA (staccato) con control k6d065 interleaved.
| gate | soglia |
|---|---|
| qualità | PPL ≤ 2.0955 (storico k=5 su IQ2_M: morto a +2.56 — su KEXP è TUTTO da rimisurare) |
| speed | ≥ 6.15 (+5%) per essere interessante |
| ruolo | anche se vive, è la BASELINE che A e B devono battere in pareto |

## A — drop-by-weight (patch fork: il drop anche sugli HIT)

1. Estendere il meccanismo drop-cold con modalità resident-inclusive (es.
   `--drop-by-weight F` o `drop_resident=true`): drop se weight < F/k ∧
   non-top, **indipendente dalla residency**, con renorm come oggi. Patch
   minima in `router_hook` (stessa sede del drop-cold), zero tocchi llama.cpp.
2. Nuovo binario → **G1 8/8 col flag spento** → re-pin (autorizzato dal lancio
   di questo mandato se G1 passa).
3. Celle: F ∈ {0.5, 0.65, 0.8} su k=6, PPL prima (in carica), speed dei vivi
   poi (staccato, control k6d065). Isolare la leva: prima con drop-cold OFF,
   poi la combinata migliore con d065.
| gate GO | ≥ +5% speed E PPL ≤ floor E smoke output sano |
| gate NO-GO | < +3% o PPL > floor o >40% slot droppati senza speed (overhead renorm) |

## B — top-p / k dinamico training-free (solo se A lascia spazio in pareto)

**Prima la simulazione gratis**: replay su route-trace esistenti (host):
distribuzione dei pesi router → k_eff atteso per p ∈ {0.85, 0.90, 0.95}.
Se k_eff simulato > 5.5 (skip <8%) → B si chiude senza patch.
Se promette: patch `k_max=6, attiva finché Σw ≥ p`, stesso protocollo di A.
| gate | k_eff ≤ 5.2 E PPL ≤ floor E speed ≥ +4% |

## Deliverable

`reports/moe-shortlist-velocita.md`: tabella pareto completa (ogni cella:
tok/s, PPL, k_eff/drop%, hit), grafico testuale della frontiera, il punto
raccomandato, G1/re-pin a verbale se fatti. **STOP — l'adozione del nuovo
default è di gualt.**
