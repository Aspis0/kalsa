# LAB RECEIPTS — 2026-10-04 — LFM2.5-VL-3B vs Gemma 4 E4B at receipts→JSON, "the model proposes, the code decides"

Lab measurement for the owner's question: **can a small local model be made USEFUL
beyond chat by a harness where the model proposes and code decides?** First case:
photographs of Italian receipts and bills → structured data. Two models, both Q8/Q4
GGUFs already on the Lenovo, each with its pinned projector, one engine at a time on
the owner's PC (vulkan `kalsa-server` v1.1.5, RTX 4050 pin): **LiquidAI LFM2.5-VL-3B
Q8_0** and **Google Gemma 4 E4B Q4_K_M**. Three conditions on the same 60 images,
temperature 0 in every request: **A** free-text "extract as JSON" (parse what comes
back), **B** the same prompt under `response_format json_schema` (grammar-constrained),
**C** B plus code validators — line items vs total (±0.01), IBAN mod-97, partita IVA
checksum, real-calendar date not in the far future, amounts ≥0 — with ONE re-ask that
names the failed check, then `UNSURE` with the reason, never a wrong value shown as good.

**Verdict, stated plainly: the harness's safety half works, but both models escape it
by omission, and the grammar — the piece that looked most valuable — is the piece that
hurt.** In condition C no document ever ended in a wrong value delivered as valid where
a validator had fields to check: LFM's confident wrong fields fell from **101 across
40 synthetic documents (A) to 11 (C)**, Gemma's from 8 to a residual driven by wrong
dates (plausible dates no checksum can catch). But **all ten planted traps went
undetected** — 8 escaped by the model simply not proposing the fields the check needs
(an optional field is an unchecked field), and 2 trapped totals were delivered as
printed with the line items omitted so the sum check never ran. And condition B
crippled recall on both models: Gemma went from 10/40 documents fully correct (A) to
0/40 (B), delivering its merchant on 0/35 documents where the schema allowed it to
skip; LFM under B delivered only the total (21/21, always right) and omitted nearly
everything else. On real CORD receipts neither model produced one fully-correct
document under any condition. The measured answer for this case: **Gemma 4 E4B is the
extraction model (25% of synthetic documents fully correct, P.IVA 20/20, scadenza
13/13, POD/PDR perfect, and it alone read CORD's Indonesian thousands correctly) at
~10× LFM's latency; LFM is the transcriber of totals (21/21 under its own schema) at
3–7 s a document. Neither is useful unattended today; the missing harness pieces are
type-conditional REQUIRED fields (to close omission evasion) and validators around
free text (A+validators, the untested combination this lab's numbers point at).**

Machine: the owner's Lenovo (Core Ultra 9 185H, 32 GB, RTX 4050 6 GB), Windows 11.
Engine headless on 127.0.0.1:8150 (one model at a time, launched via a one-shot
scheduled task deleted immediately after `/Run`, reached from the Mac over
`ssh -L 18150:127.0.0.1:8150`). Every model file verified against its catalog pin
before use. Nothing was uploaded anywhere; no product code was changed; the only repo
files written are this document and the harness under `dev/lab-receipts/`. All
scratch (images, ground truth, raw request/response JSONL, run logs) stayed in
`/tmp/lab-receipts/` on the Mac — outside the repo on purpose; the image set's
manifest sha256 is recorded below.

## Setup

### Models, pins, projector (all verified on the Lenovo before any request)

| file | bytes | sha256 | provenance |
|---|---:|---|---|
| LFM2.5-VL-3B-Q8_0.gguf | 2 874 779 680 | `69b49ceddf61c65cce4a8938a0791c364a8d38cd2d87db2ca7ea359232a8b17e` | already at `%LOCALAPPDATA%\kalsa-brain\runtime\models\` — **equals the catalog pin** (walk of 2026-10-04) |
| mmproj-LFM2.5-VL-3B-Q8_0.gguf | 583 109 984 | `ecbbe7097f696dba67172738d79c9f01132cdb6c0b457606315e268df3d67e64` | same, same pin |
| gemma-4-E4B-it-Q4_K_M.gguf | 4 977 171 584 | `85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87` | same models dir — equals the row's pin |
| mmproj-gemma-4-E4B-it-Q8_0.gguf | 559 874 816 | `197f49a93027f9843772bd24a6a9e0be2a32a788de5a3def330e9c585d86edd1` | **downloaded by the pin's URL** (`ggml-org/gemma-4-E4B-it-GGUF@b8093469224f83f5c38f691eb906c380e9e63114`) into `C:\kalsa-bench\lab\`, `Get-FileHash` = pin |

### Engine flags (the app's own argv per row)

```
kalsa-server.exe --host 127.0.0.1 --port 8150
  --model <weights> --ctx-size <WINDOW> --parallel 1 --device Vulkan1
  --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0
  <ROW SAMPLING> --mmproj <PROJECTOR> --image-max-tokens 560 --no-webui
```

`<WINDOW>`: LFM **32768** (the row's trained cap — the window the launcher funds);
Gemma **65536** (= min(`CHOOSER_CONTEXT_TOKENS` 65 536, trained 131 072), the figure
the Lenovo walk itself ran). `<ROW SAMPLING>`: LFM `--temp 0.2 --top-k 50
--repeat-penalty 1`; Gemma `--temp 1.0 --top-p 0.95 --top-k 64` (the catalog rows).
**Every request carried `temperature: 0`** — extraction sampling is the lab's, the
launch flags are the app's; llama-server takes the per-request value. `GET /props`
answered `n_ctx` 32768 / 65536 and `vision: true` for each engine before its run.
No `--ctx-shift`, no `--cache-reuse`, no slot path (a lab server owns no app state).

### The schema-constraint probe (condition B's premise, verified not assumed)

A dropped `response_format` fails silently — the server just answers free text. Probed
twice against the LFM engine before any scored run:

```
PROBE valid-schema:   status=200  content shaped by the schema ("tipo" from the enum)
PROBE invalid-schema: status=500
  {"error":{"code":500,"message":"JSON schema error at #/properties/a: unrecognized type strin","type":"server_error"}}
```

The invalid-on-purpose schema (`"type": "strin"`) is rejected by the engine's own
grammar builder — the field provably reached the server. Both models ran B/C on that
enforced path.

### Dataset (privacy: no real personal documents anywhere)

**Synthetic, 40 documents** — generated by `dev/lab-receipts/gen-docs.mjs` (seeded,
reproducible): 21 supermarket scontrini (rows, IVA, total, date, time, P.IVA), 13
bollette (7 luce with POD, 6 gas with PDR; fornitore, importo, scadenza, IBAN for
SEPA), 6 bonifico/bollettino slips — varied layouts and five font stacks, rendered
via Playwright at 2×. Then `dev/lab-receipts/degrade.py` makes each a phone photo:
rotation ±8°, mild keystone, blur 0.4–1.1 px, JPEG q60, uneven lighting, ~35% with a
crumple warp. **Traps, seeded before any run and recorded in the ground truth:**
6 documents (15%) print a total their line items do NOT sum to (drift 0.03–1.37 €);
4 documents (10%) print an IBAN whose mod-97 fails (one corrupted account digit —
asserted invalid at generation); dates in the three shapes the owner named
(`04/10/26`, `4 ott 2026`, `2026-10-04`). Every clean document's arithmetic was
verified (non-trap sums exact, all 34 P.IVAs pass the checksum, all 15 clean IBANs
pass mod-97, all 4 traps fail it — checked by the same validators condition C uses).

**CORD, 20 real receipts** — the public CORD v1 test split (`naver-clova-ix/cord-v1`
on Hugging Face; the dataset card carries `"license": "Creative Commons Attribution
4.0 International License"`, the GitHub repo's LICENSE-CC-BY says the same —
**CORD © Clova AI, CC BY 4.0**, cited here). `dev/lab-receipts/cord-extract.py` took
the first 20 test receipts with a parseable total and ≥1 menu item, as real
photographs, with the card's own ground truth (total, menu items) in Indonesian
amount convention (thousands `.`). Download: one 234 MB parquet, curl EXIT=0, local.

Image set manifest (80 lines, `name sha256` per image + the GT jsons):
`shasum -a 256 dataset-sha256.txt` =
`2a5f92d3ac684dd69bb39e7dd20824f91c431b2c849a412bc04db63cac1a85bc`.
Images are NOT in the repo — they live in `/tmp/lab-receipts/images/`.

### Runs and a method note that matters

60 documents × 3 conditions × 2 models = 360 scored extractions plus C's re-asks,
each recorded as one JSONL line (request shape, both calls' status/wall ms/token
usage, raw reply, parsed JSON, validator verdicts, outcome). The first pass ran with
`max_tokens: 700`, which **clipped Gemma mid-JSON** (it explains itself at length —
one clipped reply ended `…per i prezzi interi con separatore migliaia/punto decim`);
LFM clipped twice. The cap was raised to 1300 and **both models were re-run whole**
(the 700-cap runs are archived as `lfm-cap700.jsonl` / `gemma-cap700-partial.jsonl`
and none of their numbers appear below; the cap never bound at 1300 for LFM).
Mid-run, the Gemma engine died once to an external hard kill (log ends mid-generation
at `n_gen = 262`, no crash line — the one unexplained event of the session); the
runner resumed by id+condition and completed. Latency is whole-request wall time
(image encode + prompt + full generation), one slot, sequential.

## Results — synthetic (40 documents)

`fields` = delivered-and-right / documents where the ground truth has the field;
`(n omitted)` = the model proposed nothing for it. **silent** = wrong value delivered
confidently. `itemF1` = mean F1 on line items.

| cond | fully correct | malformed | UNSURE | silent docs (fields) | s/doc |
|---|---|---|---|---|---|
| **LFM A** | 0/40 | 0 | 0 | **37 (101)** | 6.5 |
| **LFM B** | 0/40 | 0 | 0 | 17 (25) | 2.5 |
| **LFM C** | 0/40 | 0 | 11 | **8 (11)** | 2.9 |
| **Gemma A** | **10/40 = 25%** | 14 | 0 | 8 (8) | 28.4 |
| **Gemma B** | 0/40 | 5 | 0 | 10 (10) | 27.3 |
| **Gemma C** | 0/40 | 9 | 4 | 10 (10) | 33.0 |

Per-field, delivered-and-right (synthetic):

| field | LFM A | LFM B | LFM C | Gemma A | Gemma B | Gemma C |
|---|---|---|---|---|---|---|
| totale | **21/21** | **21/21** | 12/21 (9 om.) | 7/7 | 0/17 (17 om.) | 0/12 (12 om.) |
| data | 25/40 | 18/40 (13 om.) | 11/40 (23 om.) | 14/26 (12 om.) | 16/35 (9 om.) | 15/31 (6 om.) |
| esercente | 20/40 | 0/40 (40 om.) | 0/40 (40 om.) | **24/26** | 0/35 (35 om.) | 0/31 (31 om.) |
| piva | 8/34 | 2/34 (28 om.) | 2/34 (28 om.) | **20/20** | 1/29 (28 om.) | 1/25 (24 om.) |
| righe (F1) | 4/21 (0.54) | 0/21 (0.00) | 4/21 (0.19) | 6/7 (0.29) | 1/17 (0.05) | 0/12 (0.00) |
| scadenza | 11/13 | 3/13 (9 om.) | 1/13 (12 om.) | **13/13** | 3/12 (9 om.) | 5/13 (8 om.) |
| iban | 1/19 | 0/19 (16 om.) | 0/19 (18 om.) | 12/19 | 1/18 (17 om.) | 1/19 (18 om.) |
| pod / pdr | 0/13 | 0/13 | 0/13 | **13/13** | 4/12 | 4/13 |

Reading it: **LFM reads printed totals essentially perfectly** (21/21 in A and B —
with A's amounts arriving as Italian strings like `"€ 62,21"` that the harness
normalizes; B's grammar made them numbers). Everything else it proposes is a lottery
(1/19 IBANs right in A) — and A delivers those wrong guesses confidently, which is
the 101 silent fields. **Gemma in free text is a different class**: every P.IVA,
every scadenza, every POD/PDR, 24/26 merchants, 12/19 IBANs — at the price of 14/40
malformed (prose around or inside the JSON, one quoted below) and 10× the time.
**Under the schema both models stop proposing** (Gemma 0/35 merchants, 0/17 totals
delivered; LFM 0/40 merchants, 0/21 line-item sets) — the grammar guarantees shape
and loses content. Condition C's residual silent errors are almost entirely **wrong
but plausible dates** (real calendar days, so no checksum can catch them) — the
class of error "code decides" cannot see without reading the pixels itself.

### Silent errors — the key numbers, with the examples

- **LFM A: 101 wrong fields across 37/40 documents.** A typical one, `syn-022`: IBAN
  delivered `IT9847561 301295437 3018303` (spaces and a dropped digit) where the
  paper prints `IT984756130312954373018303` — delivered as confidently as a right one.
- **LFM C: 11** (−89% from A). What survived: dates like a shifted day/month, valid
  as dates, wrong as transcriptions.
- **Gemma A: 8 fields across 8 documents** (its 20% silent-document rate); e.g.
  `syn-024`: IBAN `IT65307191526666085222819` against the printed
  `IT653071915266660052222819` — two digits gone, still a syntactically clean IBAN.
  In B/C Gemma's silent count did NOT fall (10) because the schema taught it omission
  rather than correctness.
- **Gemma B's malformed shape is worth quoting** — the grammar cannot stop it talking:
  `{"data": "null", "scadenza": "null", "valuta": "null_o_non_specificata_dall_immagine_vuota_per_questo_campo_non_t…`
  (prose written INTO a string value until the token cap cut it — 5 such documents at
  cap 1300).
- A Gemma free-text success, for balance (`syn-010`, one of the 10 fully-correct A
  documents): `{"esercente": "ALIMENTARI DA LUIGI", "piva": "42877914517",
  "data": "2026-08-15", "totale": 22.97}` — every field right, no prose.

### Traps: 0/10 detected — the finding that matters most

| trap | LFM C | Gemma C |
|---|---|---|
| sum ≠ total (6 docs) | 0 flagged: 4 evaded by omission, **2 delivered the trapped total as printed** | 0 flagged: 6 evaded by omission |
| IBAN mod-97 (4 docs) | 0 flagged: 4 evaded by omission | 0 flagged: 4 evaded by omission |

The two LFM sum-traps that were "delivered as printed": `syn-015` proposed
`totale: 43.87` — exactly what the paper prints — with `righe: 0`, so the sum check
that would have caught the 0.10 € drift had nothing to sum. **An optional field is an
unchecked field**: both models learned (from the schema, or from the re-ask naming a
failed check) that not proposing is the painless move. The two C refusals that DID
happen on trap documents were for other reasons (`la scadenza "€ 37,98" non è una
data leggibile`). The fix direction is mechanical — REQUIRED per document type
(`scontrino` ⇒ `righe` + `totale` must be present; anything unreadable becomes `null`
PLUS a named `unreadable` list the code can count) — proposed, not measured here.

### CORD (20 real receipts, reported separately)

| cond | LFM | Gemma |
|---|---|---|
| fully correct | 0/20 | 0/20 |
| itemF1 mean | 0.00 | 0.00 |
| shape | A delivers items at the wrong scale; B/C omit them | A delivers the right scale, wrong item set; B/C omit or malformed |
| silent docs | A 20(20), B 0, C 0 | A 18(18), B 5(5), C 0 |
| s/doc | A 6.3 / B 4.2 / C 4.2 | A 26.9 / B 23.8 / C 47.3 |

LFM read `60.000` as **sixty** (its Italian decimal training) where CORD's ground
truth means sixty thousand — every amount wrong by 1000×, confidently. Gemma read the
same prints as **60000**, correct — but proposed more line rows than the card's menu
lists (its F1 dies to false positives, not scale). Neither model produced a fully
correct real receipt under any condition: real thermal paper, real fonts, real noise
are a class harder than the synthetic set, whose clean layouts both models found
easier. CORD is CC BY 4.0; totals/items per the card's own annotations.

### Cost of safety (UNSURE rate) and speed

UNSURE per 40 synthetic / 20 CORD: LFM C 11 + 8; Gemma C 4 + 9 (+11 CORD malformed,
the re-ask reply not being JSON). Seconds per document (whole request, one slot):
LFM A 6.5 → C 2.9 (the schema's short answers decode faster); Gemma ~27–33, CORD C
47.3 with re-asks — **Gemma costs ~10× LFM's time per document**, both peaks well
inside the machine: server private-memory peak **LFM 4 807 MB, Gemma 10 835 MB**
(5 s sampler over the whole session, `C:\kalsa-bench\lab-samples.csv`).

## What the numbers say the harness needs (recommendation)

1. **Model: Gemma 4 E4B when accuracy per document is the point** (25% fully correct
   free-text, checksummed fields near-perfect, the only correct IDR reading), LFM
   when the job is "read the total off a slip" at interactivo speed. On this PC
   Gemma's ~30 s/document is batch, not chat.
2. **The grammar is not the safety piece; the validators are.** B never improved a
   model's correctness — it shrank its proposals (and Gemma still wrote prose inside
   strings). Run A-shaped free text WITH the normalizer and the validators: the
   A+validators combination is the one this lab did not score and the one its data
   points at (LFM A totals 21/21 + validators would have flagged every wrong IBAN it
   proposed; Gemma A's 8 silent fields were all checksummable ones).
3. **Close omission evasion before trusting any of it**: type-conditional REQUIRED
   fields + an explicit `unreadable` list. Until then, UNSURE is honest but the
   traps pass through untouched — this lab's 0/10 is the number to beat.

## UNMEASURED

- The A+validators combination (the recommendation above is inference from A and C's
  halves, not a scored condition), and the REQUIRED-fields fix for omission evasion.
- A second seed per document (temperature 0, but the engine is not bit-deterministic
  across batch states); phone-vs-scan degradation axes beyond the five used; HDR/
  shadow extremes; receipts in English or mixed language.
- CORD beyond 20 documents, and its non-Italian merchant names against the Italian
  prompt; whether an Italian-convention prompt note would fix LFM's 1000× scale
  reading (a one-line prompt change, untested).
- Streamed first-token latency (all calls were whole-request); the door's real slot
  bookkeeping (bypassed by design — the lab talked to the engine directly).
- Why the Gemma engine died once mid-run (external hard kill, no crash line; resumed
  and completed — the only anomaly of the session).

## Cleanup

Lab engines killed after each run (exact PIDs; 0 kalsa processes at the end); every
scheduled task (`KalsaLabLFM`, `KalsaLabLFM2`, `KalsaLabGemma`, `KalsaLabGemma2`,
`KalsaLabSampler`) deleted within seconds of its `/Run` and confirmed gone by
`schtasks /Query` failing; the SSH tunnel closed; the RAM sampler stopped by its stop
file. Left in place, by instruction: `C:\kalsa-bench\lab\` (the pinned Gemma
projector), `lab-samples.csv`, the engine logs (`ctx32k-server.log`,
`lab-gemma-server.log`), the launcher `.cmd`s, and the models in the runtime store.
On the Mac: `/tmp/lab-receipts/` keeps the dataset (images + ground truth +
`dataset-sha256.txt`), all raw JSONL (`lfm.jsonl`, `gemma.jsonl`, the two archived
cap-700 runs), run logs and the CORD parquet — nothing committed except the harness
and this document.

One commit; no push; no product code touched.
