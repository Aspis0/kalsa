# LAB RECEIPTS — 2026-10-04 (v2, corrected harness) — LFM2.5-VL-3B vs Gemma 4 E4B at receipts→JSON, "the model proposes, the code decides"

Lab measurement for the owner's question: **can a small local model be made USEFUL
beyond chat by a harness where the model proposes and code decides?** First case:
photographs of Italian receipts and bills → structured data. Two models, both
already on the Lenovo, each with its pinned projector, one headless engine at a
time (vulkan `kalsa-server` v1.1.5, RTX 4050 pin): **LiquidAI LFM2.5-VL-3B Q8_0**
and **Google Gemma 4 E4B Q4_K_M**. Four conditions on the same 60 images,
temperature 0 in every request: **A** free text, **B** the same words under
`response_format json_schema`, **C** = B plus code validators (items-vs-total,
IBAN mod-97, P.IVA checksum, real-calendar dates, amounts ≥0, REQUIRED-by-tipo)
with one named re-ask then `UNSURE`, **D** = A plus a normalizer (lenient JSON,
Italian numbers, labels, dates) plus the same validators and re-ask.

**This document replaces the first version's results. The first run's B and C
columns are INVALIDATED — four harness defects, named below — and its CORD
numbers are invalid for ALL conditions (the lab's own CORD ground-truth parser
was wrong by 1000× on comma-formatted amounts). The first run's A numbers are
also not comparable (the prompt changed when the key list was made identical
across conditions).** Everything below is measured with the corrected harness.

**Verdict, stated plainly: the concept works, and it needs the bigger of the two
models.** With every field REQUIRED and nullable and every check mechanical,
Gemma 4 E4B under the validators delivers **10/40 synthetic documents fully
correct (25%) with 7 silent fields left across 40 documents — from 14 in free
text — and it caught 9 of 10 planted traps outright; the tenth it silently
"repaired" (a corrupted IBAN became a VALID DIFFERENT account number, delivered
confidently: the one failure mode the harness classification now names).** On
real CORD receipts Gemma reaches **8/20 fully correct in free text, 7/20 under
validators, 0 silent errors in C**. LFM2.5-VL-3B transcribes printed totals
essentially perfectly (21/21 synthetic, 17/20 CORD) but proposes so much noise
(hallucinated IBANs, invented dates, rows that mis-sum into the quadrillions)
that the validators refuse **39/40 synthetic documents** — safe, and nearly
useless: 1 confident delivery in 40, which still carried a wrong date. **The
grammar is not the safety piece — A and B are identical for both models to the
field; the validators are. Condition D (free text + normalizer + validators)
worked for neither model: the free-text re-ask regresses vocabulary (LFM drops
`tipo` in 38/40) and the harness discards a good first proposal wholesale —
D's honest verdict is that the re-ask needs the schema, or nothing.**

Machine: the owner's Lenovo (Core Ultra 9 185H, 32 GB, RTX 4050), Windows 11.
Engine headless on 127.0.0.1:8150, one model at a time, launched by one-shot
scheduled tasks deleted immediately after `/Run`, reached from the Mac over
`ssh -L 18150:127.0.0.1:8150`. Nothing uploaded; no product code changed; repo
files: this document and `dev/lab-receipts/`. Scratch in `/tmp/lab-receipts/`
on the Mac.

## Why the first run's B/C were invalid — the four defects, plainly

1. **The schema had no `required`**, so the grammar let a model close the
   object after one or two fields — "Gemma 0/17 totals under the schema" and
   "LFM delivered only totals" were the harness, not the models.
2. **The schema prompt listed no keys while the free prompt did**, so B was
   less instructed than A; the comparison measured two variables at once.
3. **The re-ask said "metti null" while no type admitted null** — the grammar
   forbade obeying it (a control probe with a plain `number` forced
   `{"totale": 0}` when asked for null).
4. **`tipo` lost its enum**, so a bolletta with an invented tipo fell to the
   default REQUIRED set and its IBAN/scadenza/POD stopped being required:
   omission escape, reopened.

Plus two defects found correcting the above: **Gemma 4 E4B answers through a
thinking channel** (`reasoning_content`) whose prose consumed the whole
generation cap before any JSON (149/240 first-pass replies arrived as `content:
""` with 3 785 chars of thinking) — fixed with `chat_template_kwargs
{"enable_thinking": false}` (236 tokens, clean JSON, the app's own thinking-off
path; `chat_template_caps` had shown the template supports none of the caps
fields, but the kwarg itself works); and **the CORD ground-truth parser read
"28,000" as 28.0** — Indonesian amounts use either separator as a thousands
mark, so every comma-formatted CORD document's truth was 1000× too small and
both models' correct readings were scored as silent errors. All raw replies
were kept, so the CORD fix is a rescoring, not a re-run.

Two engine deaths mid-run, cause found: the `/IT` scheduled task ran the
server in a **visible console window on the owner's desktop** — closing it (or
a stray Ctrl-C) killed the engine (both logs end in a bare `^C`, mid-task, no
crash line). Relaunches went through
`Start-Process -WindowStyle Hidden` with redirected output; no further deaths.

## Setup (unchanged facts from v1, still verified)

Model files and pins, engine flags, dataset construction, licences — as in v1
and still true: both weights and both projectors sha256-verified against the
catalog pins (Gemma's projector downloaded by the pin's own URL into
`C:\kalsa-bench\lab\`); LFM ctx 32768 / Gemma 65536, `--device Vulkan1`,
q8_0 caches, the row's sampling on the launch line and `temperature: 0` per
request; 40 seeded synthetic Italian documents (21 scontrini, 13 bollette, 6
slips; rotation ±8°, keystone, blur, JPEG q60, uneven light, crumple) with 6
sum-traps and 4 mod-97 IBAN traps; 20 real CORD test receipts (CORD © Clova
AI, CC BY 4.0). Dataset manifest sha256 after the CORD ground-truth fix:
`d42beb386c58bab5bf4728fbf9f6697d7d65a4a2d478c7e4ac7cdb4a43a2c6df` (the v1
manifest `2a5f92d3…` covered the same images with the broken GT).

Schema-constraint probes (all against the live engine before scoring):
`required` binds (14/14 keys present in every output, including a null-everything
request), `type: [T, "null"]` is honored (`"totale": null` came out), the
`tipo` **enum with null** binds (asked to write `"FATTURA ELETTRONICA"` the
grammar forced `bolletta_luce`; `null` stays legal), and the non-nullable
control refused null by forcing 0 — the old defect, now impossible.

## Results — synthetic (40 documents)

Per-field = delivered-and-right / docs where the GT has it (omitted marked);
**silent** = wrong value delivered confidently; `itemF1` = mean line-item F1.

| | fully | malformed | UNSURE | silent docs (fields) | s/doc | totale | tipo | esercente | piva | righe | scadenza | iban | pod/pdr |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **LFM A** | 0/40 | 0 | 0 | 40 (113) | 7.1 | **21/21** | 19/40 | 22/40 | 4/34 | 14/21 | 13/13 | 1/19 | 0/13 |
| **LFM B** | 0/40 | 0 | 0 | 40 (113) | 6.6 | **21/21** | 19/40 | 22/40 | 4/34 | 14/21 | 12/13 | 1/19 | 1/13 |
| **LFM C** | 0/40 | 0 | **39** | **1 (2)** | 14.8 | **21/21** | 19/40 | 25/40 | 9/34 | 10/21 | 12/13 | 0/19 | 1/13 |
| **LFM D** | 0/40 | 0 | **38** | **2 (3)** | 10.6 | 18/21 | 0/40 | 2/40 | 2/34 | 2/21 | 7/13 | 1/19 | 1/13 |
| **Gemma A** | **14/40 = 35%** | 0 | 0 | 14 (14) | 8.5 | 20/21 | **40/40** | 33/40 | **34/34** | 18/21 | 11/13 | 13/19 | **13/13** |
| **Gemma B** | **14/40 = 35%** | 0 | 0 | 15 (15) | 7.5 | 20/21 | **40/40** | 33/40 | **34/34** | 18/21 | 11/13 | 13/19 | **13/13** |
| **Gemma C** | **10/40 = 25%** | 0 | 13 | **7 (7)** | 11.4 | 20/21 | **40/40** | 33/40 | **34/34** | 19/21 | 11/13 | **15/19** | **13/13** |
| **Gemma D** | **10/40 = 25%** | 0 | 14 | 6 (6) | 11.6 | 14/21 | 26/40 | 21/40 | 22/34 | 13/21 | 9/13 | 11/19 | 10/13 |

Reading it: **A and B are the same measurement twice** — with identical words
and REQUIRED keys, the constraint changed nothing for either model (LFM: 113
silent fields both; Gemma: 14 vs 15 docs). **The validators are the entire
safety effect.** For Gemma they cut silent fields 14→7 while keeping 25% of
documents fully correct and IMPROVING the checksummable fields it delivered
(iban 13→15 right: the re-ask fixed real misreads). For LFM they cut
113→2 fields by refusing 39/40 documents — LFM's proposals fail some check on
almost every document (a hallucinated IBAN on a scontrino, "BOLOGNA" as a
date, rows summing to 1.8×10¹³). LFM's one confident C delivery still carried
a wrong date (`2026-01-01` printed where the paper reads `2026-08-01`) — the
plausible-but-wrong class no checksum can see.

### Traps (10 planted: 6 sum, 4 IBAN) — mutually exclusive classes

| | sum 6 | IBAN 4 |
|---|---|---|
| LFM C | **6 flagged-by-validator** | **4 flagged-by-validator** |
| LFM D | 6 flagged | 4 flagged |
| Gemma C | **6 flagged-by-validator** | 3 flagged, **1 fixed-silently** |
| Gemma D | 6 flagged | 3 flagged, 1 fixed-silently |

No trap was ever delivered-as-printed, evaded by omission, or escaped
unflagged. The one `fixed-silently`: `syn-033` prints the corrupted
`IT822936968338747785098892` (mod-97 fails — the planted trap); Gemma
delivered `IT822936968338747785094892` — a VALID IBAN, two digits different,
in both C and D: it repaired the document instead of flagging it, and the
repair passes every checksum. On a real bill that is an invented account
number delivered as good — the exact case the UNSURE design exists to
prevent, and the number to watch as this harness evolves.

## Results — CORD (20 real receipts, CC BY 4.0, rescored on corrected GT)

| | fully | silent docs (fields) | UNSURE | totale | tipo | righe | itemF1 | s/doc |
|---|---|---|---|---|---|---|---|---|
| LFM A | 5/20 | 15 (18) | 0 | 17/20 | 19/20 | 6/20 | 0.53 | 5.8 |
| LFM B | 5/20 | 15 (18) | 0 | 17/20 | 19/20 | 6/20 | 0.54 | 5.0 |
| LFM C | 4/20 | **0 (0)** | 16 | 17/20 | 20/20 | 6/20 | 0.48 | 10.5 |
| LFM D | 4/20 | **0 (0)** | 16 | 5/20 (13 om.) | 4/20 | 4/20 | 0.20 | 8.1 |
| Gemma A | **8/20 = 40%** | 12 (15) | 0 | 17/20 | 19/20 | 8/20 | 0.54 | 7.0 |
| Gemma B | 8/20 | 11 (14) | 0 | 17/20 | 17/20 | 9/20 | 0.59 | 6.2 |
| Gemma C | 7/20 = 35% | **3 (5)** | 10 | 16/20 | 20/20 | 8/20 | 0.56 | 11.7 |
| Gemma D | 7/20 | 3 (4) | 10 | 9/20 (9 om.) | 10/20 | 7/20 | 0.35 | 11.7 |

With honest ground truth both models read real Indonesian receipts far better
than v1 claimed — **both read the thousands scale correctly (17/20 totals
each)**; the residual silent errors are misread items and dates, and C's
refusals are almost all the sum check firing on TAX/Subtotal rows the models
insist on listing as items (e.g. LFM `cord-004`: "la somma delle righe
(194000.00) non è il totale (174600.00)"). A typical CORD failure is a true
read of the printed lines against a menu GT that lists fewer: cord-000's model
output `TICKET CP 60000` (right) beside `TOTAL DISC $ / TAX / Subtotal`
(counted as false positives) — F1 0.29 on that document, not 0.

### Condition D, judged

D was this lab's own recommendation from v1, and the data says it was half
right: the normalizer works (raw `"totale": "3.39,"` → 3.39 scored right;
`"P.IVA 54185128417"` no longer fails the checksum once the label is
stripped), but the FREE-TEXT re-ask regresses vocabulary — LFM drops `tipo`
entirely in 38/40 (its UNSURE reasons are dominated by `tipo non riconosciuto:
""`), Gemma in 14/40 — and the harness replaces a good first proposal with
that regression wholesale. D's honest verdict: **the re-ask needs the
grammar**; free text should propose, and the schema should repair.

### Cost and capacity

UNSURE rate is the price of safety: LFM C refuses 39/40 synthetic + 16/20
CORD; Gemma C refuses 13/40 + 10/20 while still delivering 10 and 7 fully
correct. Seconds per document (whole request, one slot): Gemma 7–12 s with
thinking off (the first pass's 30 s included thinking; `enable_thinking:
false` cut it ~3×), LFM 5–15 s. Server private-memory peak: **LFM 5 068 MB,
Gemma 10 669 MB** (5 s sampler over the whole session).

## Recommendation (from this data only)

1. **Gemma 4 E4B is the extraction model**, decisively: 35% fully-correct
   free text, `tipo` 40/40, P.IVA 34/34, POD/PDR 13/13 under every condition,
   and the only correct-trap behavior worth shipping (9/10 flagged). LFM's
   ceiling here is "read the total off a slip" (21/21 totals) — everything
   else it proposes is unreliable enough that the validators must refuse it.
2. **Ship the validators, skip the grammar**: A≡B for both models; C = A's
   words + REQUIRED schema (the enum is what makes REQUIRED derivable) +
   validators + one named re-ask. The grammar's only irreplaceable job in
   this design is the RE-ASK round (D's lesson).
3. **Watch the fixed-silently class**: checksums prove internal consistency,
   not fidelity to the paper. The IBAN trap Gemma "repaired" passes mod-97;
   only a second reading (or a diff against the crop) can catch it. 1/10
   here — the number to drive to zero before any unattended use.
4. **Do not ship D** as built; if free text is required (no server grammar
   support), hold the first proposal and re-ask under a schema, or not at all.

## UNMEASURED

- A second seed per document (temperature 0, but batching state is not
  bit-deterministic); degradation axes beyond the five; English/mixed docs.
- CORD past 20 documents; whether a prompt naming the IDR convention changes
  the 3/20 wrong totals; the door's real slot bookkeeping (bypassed by design).
- The fixed-silently catch-rate (needs adversarial traps per field, not one
  IBAN); streamed first-token latency; whether Gemma's 13 UNSURE in C are
  mostly the TAX-rows-as-items convention (they looked it) — a menu-vs-tax
  prompt line might recover them, untested.
- The 103 records dropped from the interrupted Gemma session were 503-race
  artifacts (engine still loading; statuses recorded), never measurements;
  the resumed run re-measured every one.

## Cleanup

Lab engines killed by exact PID after each run (0 kalsa processes at the end);
every scheduled task deleted within seconds of `/Run` and confirmed gone;
tunnels closed; the RAM sampler stopped by its stop file. Left in place:
`C:\kalsa-bench\lab\` (the pinned projector), `lab-samples.csv`, the engine
logs (including the two `^C` death logs and the hidden-launch `server2` logs),
launchers, and the runtime-store models. On the Mac, `/tmp/lab-receipts/`
keeps everything: images + corrected GT, all raw JSONL (`lfm2.jsonl`,
`gemma2.jsonl` full A/B/C runs; `lfm2d2`/`gemma2d2` the fixed-normalizer D
re-runs; `lfm-final`/`gemma-final` the merged four-condition sets; the
archived invalidated first run `lfm.jsonl`/`gemma-cap700*`/
`gemma2-thinking-clipped.jsonl`), run logs, and the summaries.

One commit; no push; no product code touched.
