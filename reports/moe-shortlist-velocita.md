# moe-shortlist-velocita

**STATUS: DONE_NO_VIVE** — shortlist C (k=5) chiusa. **Default resta k6d065.**
STOP — decisione default/MTP/adozione a gualt (nessuna auto-adozione).

Mandate: `mandates/shortlist-velocita.md` (v2 post-audit).  
Run: 2026-08-11 ~09:32–15:32 EDT · S23 · KEXP · bin CAMPAIGN `1ca51420…`  
Artifacts: `results/shortlist_k5/` (pulled host) · phone `~/experiments/results/shortlist_k5/`

## Pin

| Item | Value |
|------|--------|
| Model | KEXP `Qwen3.6-35B-A3B-KEXP.gguf` size=13416430592 sha_cached=`ac44e20c…` |
| Bin | `bmoe-cli.CAMPAIGN` sha=`1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` |
| Corpus | `corpus_subset_10k.txt` sha=`46efe834…` size=31200 |
| Floor prodotto | **≤ 2.0955** (regola gualt; Δ cumulativo obsolete) |
| Riferimenti PPL | F=0 **1.5249** · k6d065 **1.852** (grid adopt) |
| thr_eff | k6d065 = 0.65/6 ≈ **0.1083** · k5d065 = 0.65/5 = **0.13** · k5d000 = **0** |

A (drop-by-weight) e B (top-p): **archiviate per meccanismo** (mandate) — non misurate.

## 1. PPL (in carica / poi unplugged)

Protocollo: `--ppl-decode` · cold_model per cella · n_scored=10098 / 10101 · rc=0 entrambe.

| tag | k | drop | thr_eff | PPL | Δ vs F0 1.5249 | Δ vs k6d065 1.852 | vs floor 2.0955 | wall_s | verdetto |
|-----|---|------|---------|-----|----------------|-------------------|-----------------|--------|----------|
| **k5d065** | 5 | 0.65 | 0.13 | **2.4563** | **+0.931** | **+0.604** | **+0.361** | 6599 | **MORTA** |
| **k5d000** | 5 | 0.00 | 0.00 | **2.3067** | **+0.782** | **+0.455** | **+0.211** | 5234 | **MORTA** |

`alive` criterion: PPL ≤ 2.0955. **VIVE = ∅.**

### Lettura

- Anche **k=5 drop=0** (solo taglio top-k, zero cold-drop) sta **+0.45** sopra k6d065 e **sopra il floor**.
- k5d065 peggiora ancora (~+0.15 vs k5d000): drop a thr_eff=0.13 costa PPL in più, come atteso (più miss remap).
- Coerente col rischio mandate: su IQ2_M k=5 era morto; sul KEXP col “tesoretto” **la scommessa PPL fallisce**.
- **Il decode CPU ha dato quello che aveva** a k=6; scendere a k=5 non è free quality.

## 2. Speed

**Non eseguita** — zero cellule vive → gate “solo le vive” → skip interleaved.

`speed/speed_cells.csv` = solo header. Nessun ratio paired vs k6d065.

Nota operativa: durante k5d000 batteria unplugged ~30–33% (sotto floor speed 45%); ricarica AC a fine run. Irrilevante: PPL già morta.

## 3. Route-trace KEXP (k5d065)

| | |
|--|--|
| Path (host) | `results/shortlist_k5/trace/k5d065.route.trace` |
| Path (phone) | `~/experiments/results/shortlist_k5/trace/k5d065.route.trace` |
| Size | 2340 B |
| SHA256 | `c9906e824b5b11e464374c5b6bc72cd30a2b739e83298cda27122a9c8f0f4b54` |

Contenuto: header v1 (model/arch n_layer=40 n_expert=256 **n_expert_used=5**) + 40 righe `# layer=… expert_bytes…` + CSV header  
`turn,phase,step,layer,slot,expert,weight,residency,expert_bytes,dropped`  
**0 righe di route per-token.** Trace “KEXP k=5” archiviata ma **incompleta per analisi B** (top-p reopen). Da verificare se `--route-trace` su path `--ppl-decode` non emette row, o flush/abort silenzioso.

## 4. Pareto / verdetto

| Domanda | Esito |
|---------|--------|
| k5 domina k6d065? | **No** — PPL morta, speed non misurata |
| Entro 2% → vince PPL? | N/A |
| Banda 1.02–1.05 dossier? | N/A |
| **Default campagna** | **k=6 drop=0.65** (invariato) |

**Shortlist C chiusa.** A/B già chiuse per meccanismo. Nessuna leva k/drop residuale ovvia sul decode CPU con floor 2.0955.

## Timeline

| Time (EDT) | Event |
|------------|--------|
| 09:31:52 | start · pin OK · thr dichiarati |
| 09:32 | cold_model COLD_OK → PPL k5d065 |
| 11:22:21 | k5d065 rc=0 PPL=2.4563 **MORTA** |
| 11:22:22 | PPL k5d000 (lenta: ~30% batt, throttling sospetto) |
| 15:32:49 | k5d000 rc=0 PPL=2.3067 **MORTA** · VIVE= · **DONE_NO_VIVE** |

## STOP

Default a gualt. Non toccare harness defaults. Eventuali next (MTP, REAP, GPU path, B solo se trace route row completa) **non auto**.
