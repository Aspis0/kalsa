# S23_123 hostile audit — recomputed numbers

Date: 2026-08-13. Auditor recomputed every share from
`idea1/route_k6.csv` (sha256 prefix `fe78633483c2439f`, 866675 bytes,
identical to `idea1/A/route_k6.csv` and `device_pull/A/route_k6.csv`).
`peakiness.json` and `idea1/peakiness.json` are byte-identical
(`727e3e5341301809`). `cells.csv` matches `device_pull/cells.csv`.
Master log / boot_id match the pull. No number below is copied from
`peakiness.json` without a recompute.

Campaign pin (from `S23_123.master.log`):
- binary `bmoe-cli.CAMPAIGN` sha `1ca51420476d4a979552448f1c0b5bc48a04ed2e...`
- model `Qwen3.6-35B-A3B-KEXP.gguf` size `13416430592` (matches expect)
- device `SM-S911U`, boot_id `dd12b757-84cd-4730-9cd8-bd5604968664` (unchanged)
- UNPLUGGED 79%→78%, batt temp 25.4→28.3 C, never plugged
- prompt `p_fact.txt` 361 bytes sha `b5301c32c0bd8aae...` (English, not F5.2 IT prose)

This file attacks five sold-as-true failure modes, then lists extra
confirmed holes. Local notes (`k1_vs_k6.txt`, `ngram_count.txt`,
`ENGINE_NOTES.md`) already dodge some of the lies. `cells.csv` does not.

---

## 1. Peakiness — independent recompute (decode-only)

CSV header (line 43): `turn,phase,step,layer,slot,expert,weight,residency,expert_bytes,dropped`.
42 preamble comment lines. 27360 data rows. phase 0 = prefill, phase 1 = decode.
`analyze_peakiness.py` keeps phase==1 only. Published JSON matches that filter
to the last printed digit. It does **not** match any prefill window.

| quantity | published `peakiness.json` | recomputed decode (phase==1) | match |
|---|---:|---:|---|
| n_rows_total | 27360 | 27360 | yes |
| n_prefill_rows (phase 0) | 17760 | 17760 | yes |
| n_decode_rows (phase 1) | 9600 | 9600 | yes |
| n_other_phase / n_bad | 0 / 0 | 0 / 0 | yes |
| n_decode_cells | 1600 | 1600 | yes |
| n_slots_observed | [6] | [6] every cell | yes |
| share.mean | 0.30095031409594397 | 0.30095031409594397 | yes |
| share.median | 0.2835211985014645 | 0.2835211985014645 | yes |
| share.p10 | 0.21904957886775156 | 0.21904957886775156 | yes |
| share.p90 | 0.4087482245379747 | 0.4087482245379747 | yes |
| share.min | 0.178454 | 0.178454 | yes |
| share.max | 0.9270328145934372 | 0.9270328145934372 | yes |
| p(share>=0.50) | 0.02625 | 42/1600 = 0.02625 | yes |
| p(share>=0.70) | 0.000625 | 1/1600 = 0.000625 | yes |
| p(share>=0.85) | 0.000625 | 1/1600 = 0.000625 | yes |
| experts_eq mean @0.50 | 5.86875 | (42*1 + 1558*6)/1600 = 5.86875 | yes |
| experts_eq mean @0.70 | 5.996875 | (1*1 + 1599*6)/1600 = 5.996875 | yes |
| experts_eq mean @0.85 | 5.996875 | same 1 cell | yes |

Arithmetic check on the 1600: 40 generated tokens (A stdout
`generation: 40 tokens`) × 40 layers × 6 slots = 9600 decode rows.
Prefill: 74 prompt tokens × 40 × 6 = 17760. Decode steps are absolute
positions **74..113**, prefill steps **0..73**. No (step,layer) key
collision between phases.

Weights already sum to 1 per cell (min 0.999998, max 1.000002). So
`share == top1`. Mean top-1 mass is **0.301**. Uniform-over-6 is 0.167.
This is mildly peaked, not "one expert dominates".

The only cell with share>=0.70 (and >=0.85) is **step 76, layer 39,
share 0.9270328145934372**. One layer, one token. Not a policy.

A stdout line 97: `moe-drop: 990/9600 routed experts dropped (10.3%)`.
CSV `dropped==1` on decode = 990. Same number. Drop is decode-only
(0 dropped prefill rows). 674/1600 decode cells dropped at least one slot.

### 1a. ATTACK — prefill mixed into decode peakiness

**Verdict: REFUTED for the published JSON.** The file is decode-only.

Same n=1600 can be faked three ways. None of them match the published
shares:

| filter | cells | mean share | p>=0.50 | p>=0.70 | p>=0.85 |
|---|---:|---:|---:|---:|---:|
| **published / phase==1** | **1600** | **0.300950** | **42 (2.625%)** | **1** | **1** |
| prefill steps 0..39 (first 40 prefill tokens, forget phase) | 1600 | 0.310299 | 91 (5.688%) | 20 | 2 |
| prefill last 40 (steps 34..73) | 1600 | 0.289432 | 36 (2.250%) | 4 | 0 |
| all phases as cells (naive "use every row") | 4560 | 0.300673 | 162 (3.553%) | 25 | 3 |
| prefill only (all 74) | 2960 | 0.300523 | 120 (4.054%) | 24 | 2 |

Footgun: if you filter `step < 40` you get **prefill**, not decode.
Decode never uses steps 0..39. If you drop the phase column and group
by (step,layer) you get 4560 cells, not 1600. The published histogram
is the phase==1 one. Do not "correct" it by mixing.

### 1b. Dropped-excluded (not published; do not swap in silently)

`analyze_peakiness.py` includes dropped slots in the denominator and
always uses n_slots=6. That is routing peakiness, not "experts that
actually ran". Recompute on `dropped==0` only:

| | all 6 weights (published) | kept only (dropped==0) |
|---|---:|---:|
| n cells | 1600 | 1600 |
| mean share | 0.30095 | 0.32198 |
| median | 0.28352 | 0.29632 |
| p>=0.50 | 42 (2.625%) | 111 (6.938%) |
| p>=0.70 | 1 | 4 |
| p>=0.85 | 1 | 2 |
| n_slots hist | {6: 1600} | {6: 926, 5: 422, 4: 191, 3: 58, 2: 3} |
| mean n_slots | 6.000 | 5.38125 (= 6 - 990/1600) |
| experts_eq @0.50 | 5.86875 | 5.16688 |

Drop-cold already removed more average slots (0.619/cell) than the
"skip extras when share>=0.50" rule would (0.131/cell). Selling
experts_equivalent=5.87 as a new skip-extras win is a lie on top of
a 10.3% drop that already happened. Even on kept weights, 93% of
cells still have top-1 < 0.50.

Layer means (decode, all weights) sit in 0.245..0.377. Peak count
p>=0.50 is not concentrated in one block: L04 5/40, L20 5/40, L25 4/40,
L39 3/40 (including the 0.927 outlier). No layer is routinely peaky.

---

## 2. cells.csv — raw, not the notes

```
cell,rc,wall_s,n_gen,tok_s,n_prompt,n_past,drafted,accepted,drafted_steps,notes
A,0,184,40,2.410,74,,,,,route_k6
B,0,88,0,0.000,74,,,,,PREFIX_0
C,0,168,32,2.074,74,,4,2,1,ngram_draft4
D,1,3,,,,,,,,failfast_no_nextn
E,0,177,16,2.13,100,116,0,0,0,session_two_turn
```

A stdout: `generation: 40 tokens, 0.415 s/token (2.410 tok/s)`, prefill 74 / 17.313 s,
load 23.601 s, TTFT 40.914 s, moe-stream 45.90 MiB/token, cache 55.8% hit /
1999.2 MiB, drop 990/9600.

C stdout: `generation: 32 tokens, 0.482 s/token (2.074 tok/s)`,
`ngram: 2/4 drafts accepted (50.0%), 1.07 tokens per verify decode (30 decodes for 32 tokens)`,
`drafted on 1 of 30 steps (3.3%)`, prefill 74 / 18.345 s, drop 802/8160.
8160 = 34×40×6: 32 emitted + 2 extra routed draft tokens.

D stderr: `--mtp needs a model with a trained MTP head, and this gguf has no nextn block (nextn_predict_layers is absent or zero).` rc=1, wall=3s, no retry.

E BMOE_DONE (stdout, no `n_common` key in either object):

| id | tokens | tok_s | n_prompt | n_past | prefill_s | prefill_tps | text |
|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 0 | 0.000 | 75 | 75 | 14.791 | 5.07 | empty |
| 2 | 16 | 2.130 | 100 | 116 | 18.834 | 5.31 | `<think>…` + trade-off sentence |

`cells.csv` row E is **turn 2 only** (`parse_oneshot` keeps the last BMOE_DONE).
Turn 1 EOG is erased from the summary table.

---

## 3. ATTACK — k=1 free-run sold as teacher-force

**Verdict: REFUTED as a claim in `idea1/k1_vs_k6.txt` (it already says
free-run, no gold tokens). CONFIRMED that cell B cannot support any
k=1 quality or prefix claim. WARNING on the `PREFIX_0` label.**

What was actually run (`idea1/B/cmd.txt`): same oneshot flags as A,
`--n-expert-used 1`, **no** `--ppl-file`, **no** gold tokens, **no**
`--progress`. `--ppl-file` ("teacher-forced perplexity over the file's
raw text") exists in `--help` line 17 and was not used.

B stdout (entire generation record):

```
generation: 0 tokens, 0.000 s/token (0.000 tok/s)
prefill: 74 tokens, 8.934 s (8.3 tok/s) | model load 17.892 s | TTFT 26.827 s
moe-drop: 0/0 routed experts dropped (0.0%)
```

`gen.txt` is 0 bytes. `session.cpp:1377-1378` breaks if the first
argmax after prefill is EOG. That is what happened. There is **no**
k=1 continuation to compare to k=6.

`PREFIX_0` in `cells.csv` / `prefix_vs_A.txt` is a string-prefix of an
empty file against A's 182-byte gen. Empty is a prefix of everything
and of nothing useful. It is not a teacher-forced token overlap, not
`n_common`, and not "k=1 agreed with k=6 for 0 tokens then diverged".
They never produced a token.

A gen (40 tokens, includes think tags `--no-think` failed to suppress):

```
<think>

</think>

A Mixture-of-Experts (MoE) model consists of multiple distinct neural
network sub-modules, or "experts," that are activated selectively for
each input token via a
```

B also printed the drop-cold warning (`idea1/B/stderr.txt`):
`drop-cold-experts=0.65 with top-k 1 — the threshold is 65.0% of the
routing here, against 12.5% at the top-k 8 this was measured on.`
Campaign flags forced 0.65 onto a k=1 run that never decoded. Quality
is unmeasured. Do not back-fill a PPL or a prefix-agreement number.

---

## 4. ATTACK — ngram 0 drafts called a win

**Verdict: this cell is not 0 drafts. It is also not a win.
F5.2-C3 0/128 on IT prose stands. Confirm-short-then-stop was followed.**

| run | prompt | n | drafted | accepted | drafted_steps | tok/s | vs baseline |
|---|---|---:|---:|---:|---:|---:|---|
| F5.2-C3-ngram3 (`reports/moe-f5.2.md` C3) | long IT prose | 128 | 0 | 0 | 0/128 | 4.827 | −1.1% vs 4.882, mib_tok identical — **not spec** |
| F5.2-C3-ngram5 | same | 128 | 0 | 0 | 0/128 | 5.173 | +6% without a draft — **noise** |
| **S23_123 C** | English `p_fact.txt` | 32 | **4** | **2** | **1/30** | **2.074** | vs A 2.410 = **−13.9%** |

C ngram lines (stdout 74–76, `idea2/C/ngram_lines.txt`): 50% accept of
**four** drafts on **one** of 30 steps. 29/30 steps are plain decode.
Drafting cost printed as `0.0000 s/token`. Effective tok/s equals
reported tok/s (2.07). 30 decodes for 32 tokens is a 6.7% decode
saving that did **not** show up in wall (I/O 0.280 s/tok vs A's 0.213;
compute 0.215 vs 0.214).

Do not sell "50% accept" as a speculation win. The denominator is 4
drafts, not 32 tokens. Do not sell "drafted 0" either — that is F5.2,
not this cell. Do not open a long ngram bench on the back of 1/30.
`idea2/ngram_count.txt` already says confirm-short-then-stop. Stop.

A vs C is also not a clean A/B: A had `--route-trace --csv --progress`
and optional fadvise-cold; C is a new process after B, n=32 not 40.
The ngram self-report is enough to kill a win without that comparison.

C gen starts like A (think tags + "A Mixture-of-Experts (MoE) model
consists of multiple distinct neural network") then diverges at
wording (`sub-modules, or "experts,"` vs `"experts"`). Expected under
ngram verify; not a quality metric.

---

## 5. ATTACK — in-RAM session called disk serialize

**Verdict: REFUTED as a claim in `idea3/ENGINE_NOTES.md` and the master
log. CONFIRMED there is no disk session path in this binary.**

`--help` (cell E, rc=0): 73 flags. Present: `--session` (stdin JSON),
`--cache-mb` / `--cache-floor-mb` / `--cache-ceil-mb` (expert LRU),
`--load-all` (debug: read ALL experts each token), `--force-cache`,
`--ppl-file`. **Absent:** `--save`, `--load-session`, `--save-session`,
`--load-kv`, `--save-kv`. `help_save_load_cache.txt` is 18 hits, all
expert-cache / mmap / `--session` / `--load-all`. Master log:
`E help has no --save/--load session flag (cache-* is the expert LRU, not KV persist)`.

`--session` kept the process up for two JSON generates. That is RAM.
No session file was written (ENGINE_NOTES: "Do not treat this file as
a measurement of disk I/O — no save file was written."). `--cache-mb 2000`
filled the expert LRU (E turn 2 `cache_resident_mib=1999`). That is
not a KV snapshot.

llama.cpp has `llama_state_save_file` / `llama_state_load_file`.
bmoe-cli.CAMPAIGN does not expose them. Do not rename `--session` into
"we serialized the KV to disk".

---

## 6. ATTACK — inventing n_common

**Verdict: CONFIRMED that n_common is absent from telemetry.
REFUTED that the local notes invented a number. WARNING: `cells.csv`
and prior-art `n_common=71` are the two ways this gets invented next.**

E BMOE_DONE objects have keys:
`id, cancelled, tokens, tok_s, prefill_s, prefill_tps, load_s,
cache_hit_pct, n_prompt, n_past, compute_s_tok, io_s_tok,
cache_resident_mib, cache_budget_mib, read_mib, stall_s_tok,
mgmt_s_tok, majflt_tok, cpu_s_tok, token_demand_mib, mtp_drafted,
mtp_accepted, mtp_decodes, mtp_draft_s_tok, drafted_steps,
loop_overhead_s_tok, reasoning, text`.

**`n_common` is not in the schema.** `kv_fields.json`:
`n_common: null` on both turns, `n_common_in_schema: false`,
`n_common_grep: []`. Master: `E BMOE_DONE 2 n_common_in_schema False grep []`.

Engine (`BigMoeOnEdge/core/src/engine/session.cpp`):

- 1172–1173: `n_common = 0` unless `chat_on && !kv_tokens.empty()`.
  Cell E cmd has `--session`, **no** `--chatml`. READY
  `think_ctl=template`. `chat_on` is false. n_common stays 0.
- Turn 1 JSON `clear_kv: true` would empty `kv_tokens` even with chat on.
- 1629: `s.n_prompt = n_prompt - (int) n_common` (tokens actually prefilled).
- 1630: `s.n_past = chat_on ? kv_tokens.size() : n_prompt + n_gen`.

Plug in the printed fields, `!chat_on`:

- T1: n_past 75 = 75 + 0. Holds.
- T2: n_past 116 = 100 + 16. Holds.

`116 - 100 = 16` is **n_gen**, not n_common. Writing `n_common=16` is
invention. Writing `n_common=71` from `mandates/close-kv-campaign.md`
/ adopt-dense2 (old `--chatml` two-turn smoke) is invention. Writing
`n_common=75` because T1 left 75 tokens in some imagined cache is
invention: T2 prefilled **100** tokens in 18.834 s at 5.31 tok/s,
same rate as T1's 14.791 s / 75 tokens / 5.07 tok/s. A reused prefix
of 75 would prefill ~25 tokens (~5 s), not 18.8 s. The wall is the
reuse meter. Reuse did not happen.

`cells.csv` drafted/accepted/drafted_steps for E are the MTP zeros
from a non-MTP session run (`mtp_drafted=0`, `mtp_decodes=16`).
Column reuse, not n_common, but it is the same class of lie-by-schema.

---

## 7. Extra confirmed holes

### 7.1 E turn 1 EOG + oneshot/session prompt not the same bytes

**CONFIRMED. WARNING.**

`p_fact.txt` is 361 bytes and ends `Assistant:\n`.
`run_all.sh` oneshot does `PTEXT=$(cat "$PROMPT")`. Bash command
substitution strips trailing newlines → A/B/C/D prompt is **360 bytes**,
n_prompt=**74**. Session Python `Path.read_text` keeps the newline →
E t1 prompt is **361 bytes** ending `Assistant:\n` (`idea3/E/t1.json`),
n_prompt=**75**.

Same English request, different token sequence, different first
argmax: A decodes 40 tokens, E turn 1 EOGs. Do not treat E as a
replication of A. The extra newline after `Assistant:` is enough to
look like an empty completed turn.

T2 prompt is rebuilt as `prompt.rstrip("\n") + "\nUser: " + second +
"\nAssistant:\n"` (467 bytes) and does generate. That does not salvage
T1, and it is still `clear_kv=false` without `--chatml`, so T2
re-prefills the whole 100 tokens.

### 7.2 MTP / KEXP nextn

**CONFIRMED fail-fast. Not a measurement.**

Prior art: UD-IQ2_M had no nextn (`reports/moe-f5.2.md` C3). Mandate
was smoke KEXP only, no retry. KEXP also has no nextn. rc=1 in 3 s.
`--mtp` is not measurable on this file. The help text's "Qwen3.5/3.6
carry one in their ordinary quantisations" does not apply to this
KEXP. Do not report an MTP accept rate.

### 7.3 `--no-think` still emits think tags

**CONFIRMED. NITPICK on quality, WARNING if sold as think-off.**

A, C, and E T2 all start `<think>\n\n</think>\n\n` then the answer.
`--no-think` is on every cmd. E JSON has `"think": false`. READY
says `think_ctl=template`. The 40-token peakiness window includes
those tags. Not prefill contamination; it is junk decode.

### 7.4 Watchdog / floors (did not abort; correctly)

**CONFIRMED the MemFree<300 MiB rule was not used as a kill.
PLAUSIBLE one-sample LMKD dip.**

`watchdog.csv` 39 samples: 35 ok, 2 `lmkd_1`, 2 `batt_unreadable`.
Min MemFree **30140 kB** (14:27:42, during C, MemAvail 738588).
Min MemAvail **654692 kB** (above 400000). MemFree<300000 on **24/39**
samples — expected with 35B resident. Abort is MemAvail<400000 or
MemFree<50000 **×3**. Neither streak happened. Two `batt_unreadable`
are not adjacent (14:26:53 and 14:29:56). Batt 79→78, temp ≤28.3,
always UNPLUGGED. End snap MemFree 4113244 / MemAvail 4973772 (model
unloaded).

### 7.5 Wall vs telemetry

A wall 184 s vs TTFT 40.9 + 40×0.415 ≈ 57.5 s of printed inference.
B wall 88 s vs TTFT 26.8 s and 0 gen. The `date +%s` wrapper includes
llama loader + teardown around the BMOE_LOAD/perf lines. Do not treat
`wall_s` as decode time.

---

## 8. What this campaign actually supports

| idea | supported claim | not supported |
|---|---|---|
| 1 peakiness | On this 40-token English decode, top-1 routing mass mean 0.301, median 0.284; share>=0.50 on 2.6% of (step,layer) cells; share>=0.70 on 1/1600. Routing is not peaky enough to skip extras as a strategy. | Any prefill-mixed histogram. Any "k=1 is almost k=6". Any experts_eq sold as a speedup. |
| 1 k=1 | k=1 free-run EOGd at step 0. drop-cold 0.65 is mis-scaled at k=1. | Teacher-forced PPL, prefix agreement, quality delta. |
| 2 ngram | English `p_fact` drafted on 1/30 steps (2/4 accepted). F5.2-C3 drafted 0/128 on IT prose. Stop. | Speculation win. 0-draft win. Product ngram on chat prose. |
| 2 MTP | KEXP has no nextn. Fail-fast. | Any MTP tok/s or accept rate. |
| 3 session | In-RAM `--session` two-turn JSON works as a process. No disk save/load flag. No `n_common` in BMOE_DONE. T2 n_past=n_prompt+n_gen (no chat reuse). T2 prefill wall matches a full 100-token prefill. | Disk serialize. KV reuse. Invented n_common. T1 as a successful gen. |

## 9. Ruled out (brief)

- Published peakiness mixing prefill, or using steps 0..39 as "decode":
  share vectors differ (see §1a).
- Local notes calling B teacher-forced, C a 0-draft win, E a disk
  save, or printing a numeric n_common: they do not. `cells.csv` is
  the artifact that will be misread.
- Device / pin / model-size / boot_id / UNPLUGGED floors: hold.
- Fabricating a second ngram cell: none on disk.

Sources: `idea1/route_k6.csv`, `peakiness.json`, `analyze_peakiness.py`,
`cells.csv`, `S23_123.master.log`, `idea1/{A,B}/*`, `idea2/{C,D}/*`,
`idea3/E/*`, `idea3/ENGINE_NOTES.md`, `watchdog.csv`,
`device_pull/batt/*.json`, `reports/moe-f5.2.md` C3,
`BigMoeOnEdge/core/src/engine/session.cpp` 1167–1233 and 1629–1630.
