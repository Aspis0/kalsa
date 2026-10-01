# Hostile audit — `s23-governor-npu-gpu-cpu/REPORT.md` (round 1)

Auditor: independent review. Scope: `REPORT.md` (175 lines) vs `raw/` (304 files).
No device was touched, nothing was patched, nothing was rerun.
Every finding quotes the line it was read from. File paths are relative to
`scratchpad/agents/s23-governor-npu-gpu-cpu/`.

## Verdict on the whole report

The **direction** of the headline survives (NPU prefill is faster than GPU in-app, and
far faster than CPU, on this device), but the report as written is **not publishable in
this form**: the turn count is wrong everywhere, one headline ratio is propped up by a
turn that is not a valid measurement, the single CPU-long data point has **no raw
evidence in the committed directory at all**, the crash sweep is described as
"byte-identical" when the two files differ, the end-state claim about Kalsa being
foreground is contradicted by the very file it cites, and one whole evidence channel
(`raw/*-ui.xml`) does not exist. Five of the report's load-bearing sentences are false
as written. The AUTO "12 of 13 turns chose NPU" sentence is simply fabricated arithmetic:
there are 10 AUTO turns and 9 of them chose NPU.

Severity ranking used below: **S1** = invalidates a headline / a PASS clause,
**S2** = invalidates a supporting claim, **S3** = correctness nit.

---

## 1. Arithmetic (recomputed from `raw/all-rows.tsv` + the per-turn extracts)

### 1.1 How many turns exist — S1, CONFIRMED

`REPORT.md:16` — "anywhere in 37 recorded turns." / `REPORT.md:55` — "in all 37 turns" /
`REPORT.md:44` — "37 CSVs collected (`raw/*.csv`)" / `REPORT.md:152` — "zero new crashes
across 37 turns".

Recount of the committed evidence:

* `raw/all-rows.tsv` has **35** data rows (`wc -l` = 36 incl. header).
* `raw/detail.md` has **34** data rows and **does not contain `cpu1-l1` at all**
  (`grep -n "cpu1-l1" detail.md` → no hit; the only hit is `all-rows.tsv:12`).
* `ls raw/*.csv | wc -l` → **34**. `ls raw/*-kalsa.txt | wc -l` → **34**.
* `cpu1-l1` has **no** `-kalsa.txt`, `.csv`, `-hexlog.txt`, `-fastrpc.txt` or
  `-state-post.txt` in `raw/` (it has only `-battery-pre.txt` / `-state-pre.txt`).
  Its numbers exist only in `raw/cpulong.log:6-7`.
* The two probe turns (`raw/nativecheck-full.log`, `raw/npucheck-full.log`) are not
  campaign turns, and `watch.log` is a `gh run watch` transcript.

So: **35 rows, 34 turns with committed evidence, 34 CSVs.** "37" is not reproducible
from any artifact. Verdict: **CONFIRMED** error, S1 (it is the denominator of the
"no crash / no fallback anywhere" claim).

### 1.2 The medians — CONFIRMED correct, with one poisoned row

Recomputed every table cell from `raw/all-rows.tsv` (median of the 1-dp `prefill_tok_s`
column, i.e. exactly what `raw/summarize.sh` produces):

| config | prompt | n | report tok/s | recomputed | report TTFT | recomputed |
|---|---|---:|---:|---:|---:|---:|
| NPU | short | 6 | 170.9 | **170.91** | 10.2 s | **10.2 s** |
| NPU | long | 5 | 120.9 | **120.92** | 26.0 s | **26.0 s** |
| AUTO | short | 6 | 170.0 | **170.01** | 10.2 s | **10.2 s** |
| AUTO | long | 4 | 116.0 | **115.99** | 27.1 s | **27.1 s** |
| GPU | short | 6 | 115.0 | **115.08** | 15.1 s | **15.1 s** |
| GPU | long | 4 | 101.2 | **101.16** | 30.3 s | **30.3 s** |
| CPU | short | 3 | 21.7 | **21.73** | 79.8 s | **79.8 s** |
| CPU | long | 1 | 20.9 | 20.9 | 150.7 s | 150.7 s |

All eight rows reproduce. So `101.2` is *arithmetically* right
(median of `87.6, 99.0, 103.3, 104.0` = 101.15) — but `87.6` is not a valid
long-prompt measurement (§1.3). Do not accuse the median function; accuse the row set.

### 1.3 `gpu2-l3` is not a long-prompt turn — S1, CONFIRMED

`raw/gpu2-l3-kalsa.txt:17`:
`10-01 17:07:07.989 14780 14852 W RNLlama : loadPrompt:537 KALSA_KVPREFIX embd=1660 text_tokens=3145 n_common=1660`
`raw/gpu2-l3-kalsa.txt:18`: `"tokensEvaluated":3145,...,"prompt_n":1485`
`raw/gpu2-l3-kalsa.txt:21`: `"prefill_chunks":"512+512+128+128+128+77"`

`n_common=1660` / `embd=1660` means **1660 of the 3145 tokens were served from a cached
prefix**; only 1485 new tokens were prefilled. It is the **only** turn in the campaign
with `n_common>0` (all 33 other turns show `n_common=0`). Consequences:

1. It is not comparable to the other GPU longs (same nominal prompt, different work).
2. `raw/parse.sh:23` computes `pts = prompt_n/(promptMs/1000)` = 1485/16.958 = **87.6**,
   which is a hybrid metric (denominator excludes nothing, numerator excludes the reused
   1660 tokens). The honest tokens/s for that turn on either convention is either
   185.5 (3145 tokens) or 87.6 (1485 tokens) — the report publishes neither and does not
   flag the row.
3. `raw/gpu2-l3-kalsa.txt` also shows the app re-inited the session (it is one of the 13
   turns carrying a `KALSA_GOVERNOR_PLAN` line), i.e. a cold load in the middle of a fill
   group.

Effect on the verdict (this is the one exclusion that changes a headline number):

| cut | NPU/GPU short | NPU/GPU long | NPU/CPU short | NPU/CPU long | n(gpu long) |
|---|---:|---:|---:|---:|---:|
| all rows (report) | 1.485 → **1.49×** | 1.195 → **1.20×** | 7.88 → 7.9× | 5.78 → 5.8× | 4 |
| exclude `gpu2-l3` | 1.485 | **1.170** | 7.88 | 5.78 | 3 |

So `REPORT.md:68` — "NPU prefill is **1.49× / 1.20× GPU**" — the long figure is
**overstated: 1.17×, not 1.20×**, once the prefix-reuse turn is removed. The short
figure is unaffected. Verdict: **CONFIRMED** (1.20×), S1.

### 1.4 The remaining ratios — CONFIRMED, but the CPU-long one is n=1

`REPORT.md:68-69` — "7.9× / 5.8× CPU", "−32 % / −14 % vs GPU and −87 % / −83 % vs CPU".
Recomputed: 170.91/21.73 = 7.87 → 7.9×; 120.92/20.9 = 5.78 → 5.8×;
10.2/15.1 − 1 = −32.5 % → −32 %; 26.0/30.3 − 1 = −14.2 % → −14 %;
10.2/79.8 − 1 = −87.2 % → −87 %; 26.0/150.7 − 1 = −82.7 % → −83 %. All six reproduce.

But: **5.8× and −83 % rest on one single turn** (`cpu1-l1`, n=1 in `REPORT.md:67`), and
that turn (a) has **no committed raw evidence** (§1.1), (b) ran **outside** the ABBA
campaign in a bespoke script, and (c) ran under a different thermal class —
`raw/cpulong.log:7`: `"thermal_state":"LOWBAT"` at battery 24 %. Excluding it makes the
CPU-long ratio undefined (0 rows). The report's sentence at `REPORT.md:110-111` says the
medians "mix FAST/WARM/COOLMODE turns"; the actual mix is
**COOLMODE 16, FAST 14, WARM 4, LOWBAT 1** (from `raw/detail.md` + `raw/cpulong.log`).
LOWBAT is missing from the report's own caveat. Verdict: **CONFIRMED** error in the
caveat text, S2.

### 1.5 The AUTO pick count — S1, CONFIRMED FABRICATION

`REPORT.md:34` — "**12 of 13 AUTO turns chose NPU.**"

Ground truth from the governor JSON of every `raw/*-kalsa.txt`:
* AUTO arm turns: `auto1-s1/s2/s3/l1`, `auto2-s1/s2/s3/l1/l2/l3` = **10** turns, of which
  **9** carry `"engine_prefill":"NPU"`; only `auto1-s1` carries `"GPU"`.
* If the NPU arm (which is also `route_requested:"auto"`, lane on) is included:
  **21** lane-on route=auto turns, **19** labelled NPU. The two GPU-labelled lane-on turns
  are `auto1-s1` and `npu2-l1`, both `"thermal_state":"WARM"`.

Neither 13 nor 12 exists under any row selection. Verdict: **CONFIRMED**, S1 — the
headline AUTO number is not derivable from the data.

### 1.6 Order effect is real and was never reported — S2, CONFIRMED

The report says the split arms exist "to catch order effects" (`REPORT.md:71`) but never
reports one. Measured pass1 vs pass2 medians (same arm, same prompt class):

| arm/prompt | pass 1 | pass 2 | delta |
|---|---:|---:|---:|
| npu short | 173.80 (n=3) | 168.40 (n=3) | **−3.1 %** |
| gpu short | 116.90 (n=3) | 113.40 (n=3) | −3.0 % |
| gpu long | 101.50 (n=2) | 95.45 (n=2) | **−6.0 %** |
| auto short | 170.20 (n=3) | 153.20 (n=3) | **−10.0 %** |
| cpu short | 23.85 (n=2) | 21.60 (n=1) | −9.4 % |

The later pass is slower in 5 of 5 comparable cells (−3 % to −10 %). The report's
`REPORT.md:72` — "AUTO vs NPU rows agree within noise" — is **REFUTED** in the only
place where pass order is visible: AUTO short pass 2 is 10 % below AUTO short pass 1.
Verdict: **CONFIRMED**, S2.

### 1.7 Sensitivity of the verdicts to the other cuts

| cut | NPU/GPU s | NPU/GPU l | NPU/CPU s | n(cpu long) |
|---|---:|---:|---:|---:|
| all rows | 1.485 | 1.195 | 7.88 | 1 |
| excl. `gpu2-l3` | 1.485 | **1.170** | 7.88 | 1 |
| excl. 4 WARM turns (`auto1-s1`,`gpu1-l2`,`gpu2-s1`,`npu2-l1`) | 1.466 | **1.160** | 7.88 | 1 |
| excl. all cold first turns | 1.485 | 1.211 | **7.08** | **0** |
| excl. the 6 all-128-chunk turns | 1.506 | 1.195 | 7.27 | 1 |
| excl. `gpu2-l3` + WARM + cold | 1.465 | **1.150** | 7.08 | 0 |

Conclusion: the qualitative verdict (NPU > GPU > CPU, NPU ≈ 1.15–1.5× GPU) is robust.
The **1.20×** and **7.9×** numbers are not: 1.20 → 1.15–1.17 once the two worst rows go,
and 7.9 → 7.1 once the cold-load CPU turn goes (leaving nothing for CPU long at all).

---

## 2. Evidence vs claim

### 2.1 "All four arms PASS" — S2, PLAUSIBLE but the acceptance clauses are never stated

`REPORT.md:15` — "All four arms PASS their acceptance clauses". The clauses are not in the
report, and the one place where an arm is graded on anything else
(`REPORT.md:29-33`, "PASS **on the engine clause**") shows the harness had no per-arm pass
criterion at all — `raw/arm.sh` has no check other than preflight, dead-marker and rc.
What *is* genuinely confirmed: no turn exceeded the 300 s guard (max `dur=239s`,
`raw/cpulong.log:5`), no `NO TELEMETRY`/`STAGE NEVER LANDED`/`NOT FOREGROUND` line exists in
any log, and every governor line has `failed:false, failure_reason:"", npu_fallback:null,
route_chunks_dropped:0, route_chunks_truncated:false`. Verdict: **PLAUSIBLE**, S2
(undisclosed grading basis).

### 2.2 "No silent fallback anywhere" — S2, PLAUSIBLE, and the check is unfalsifiable

The JSON fields are clean across all 34 turns (verified field by field). But the only
*explicit* fallback probe in the harness, `raw/parse.sh:12`:

```sh
fb=$(grep -c "KALSA_GOVERNOR_FALLBACK" $f)
```

`KALSA_GOVERNOR_FALLBACK` **never appears anywhere in `raw/`** (searched all 34
`-kalsa.txt`), and the column it feeds is `0` for every row of `all-rows.tsv`. So the
"no silent fallback" claim rests on (a) `npu_fallback:null`, which by the report's own
`REPORT.md:88-95` argument does **not** identify the executing device, and (b) a grep for
a tag that may not exist in this build. The column cannot distinguish "no fallback" from
"the build never emits that tag". Verdict: **PLAUSIBLE** for the JSON part,
**CONFIRMED** that the harness-level check is vacuous, S2.

### 2.3 "HTP execution is proven at buffer level" — S1, REFUTED as stated

`REPORT.md:20-23` — "HTP execution is proven at buffer level … `load_tensors` assigns every
layer to HTP0 (`raw/nativecheck-full.log`)".
`REPORT.md:158-162` — "**HTP execution proof:** `raw/nativecheck-full.log` (one lane-on
turn …)".

What `raw/nativecheck-full.log` actually contains (12 distinct `ggml-hex` message kinds in
the whole file, all of them registry/session/alloc):

```
327: … KALSA_NATIVE info ggml-hex: device 0: HTP0 (phys=0, virt=0, domain=cdsp:3)
365: … KALSA_NATIVE info ggml-hex: HTP0 op batching: n-bufs 16 n-tensors 8192 n-ops 1280 vmem 3102130176
2728: … sched_reserve:       HTP0 compute buffer size =   129.00 MiB
2729: … sched_reserve:        CPU compute buffer size =    11.04 MiB
```

There is **no per-dispatch, per-op or inference-time HTP line anywhere in the log**
(`grep -c "ggml-hex"` after the turn starts = 18, all of them the same init lines; no
`graph_compute`, no op counter). What is proven is *capability and assignment*
(backend registered, session created, 31/31 layers on HTP0, 129 MiB HTP compute buffer
reserved). That is not "execution proven". Two further limits the report does not state:

* The turn is a **short** prompt (`raw/nativecheck-full.log` tail:
  `"prompt_n":1735,"promptMs":9730.904`), and it is a **pre-campaign probe at 15:18:23**,
  five minutes before `raw/campaign.log:1` (`=== ARM npu1 auto on start 15:23:59 ===`).
  It is not one of the campaign turns, so it cannot generalise to the 35 rows.
* That single turn contains **two** `llama_context` constructions (`grep -c 'constructing
  llama_context'` = 2). The second one registers **OpenCL** (`ggml_opencl: … Adreno
  xmem F16x32 GEMM enabled`) and reserves **only** `sched_reserve: CPU compute buffer
  size = 129.00 MiB` (line 3316) — no HTP buffer. The report quotes only the first
  context and never discloses the second. `REPORT.md:22`'s parenthetical "OpenCL is not in
  the prefill context at all" is true of context #1 and silent about context #2.

Verdict: **REFUTED** as stated ("proven"), S1. The honest statement is "HTP0 owns all 31
layers and has a reserved compute buffer in the prefill context of one probe turn".

### 2.4 "Zero new crashes, byte-identical dropbox" — S1, CONFIRMED FALSE

`REPORT.md:151-153` — "native-crash/tombstone entries after the campaign are **byte-identical**
to the pre-campaign baseline — zero new crashes across 37 turns".

`diff raw/dropbox-baseline.txt raw/dropbox-final.txt`:

```
1,3d0
< /data/system/dropbox/SYSTEM_TOMBSTONE_PROTO_WITH_HEADERS@1790803377667.dat.gz
< 2026-09-30 17:22:57 SYSTEM_TOMBSTONE (compressed text, 11294 bytes)
< 2026-09-30 19:56:45 SYSTEM_TOMBSTONE_PROTO_WITH_HEADERS (compressed data, 11852 bytes)
```

8 lines vs 5 lines. The files are **not** byte-identical, and the final dump is a strict
**subset** of the baseline — three tombstone entries present before the campaign are
absent after it. A shrinking dump is what `dumpsys dropbox` rotation looks like, so this
comparison cannot distinguish "no new crash" from "old entries pruned, new one pruned
too". Additionally:

* Both dumps were produced by the same lossy filter as `raw/arm.sh:28`:
  `grep -E "^\d|data_app_native_crash|SYSTEM_TOMBSTONE" | tail -40` — `tail -40` can
  truncate, and the `^\d` alternative picks up date lines but nothing else.
* `raw/dropbox-*.txt` contain **no crash signature text at all** (no process, no signal,
  no fault address), so `REPORT.md:22` — "No SET_ROWS abort (the c26ba8bc crash is gone)" —
  is **unsupported**: the string `c26ba8bc` appears nowhere in `raw/`, and `SET_ROWS`
  appears only as *graph-node* names in `nativecheck-full.log:2267+`
  (`… used by node 'cache_v_l2 (view)' (SET_ROWS)`), i.e. normal graph logging.
* `raw/arm.sh:29` writes `arm-$ARM-tombstones.txt` for **every** arm, but only
  `raw/arm-npu1-tombstones.txt` and `raw/arm-npu1-dropbox.txt` were committed. The other
  7 arms' crash sweeps are missing from `raw/`.
* What *is* fair: `raw/arm-npu1-tombstones.txt` shows the newest tombstone dated
  `2026-09-30 23:53`, i.e. nothing new during the campaign, and every turn logged
  `dead_marker=none` (`raw/campaign*.log`).

Verdict: **CONFIRMED FALSE** on "byte-identical", S1. "Zero new crashes" is
**PLAUSIBLE** but not established by the committed evidence.

### 2.5 "Decode CPU in all 37 turns" — CONFIRMED (modulo the count)

Every one of the 34 committed governor lines has `"engine_decode":"CPU"`, and so does the
`cpu1-l1` line in `raw/cpulong.log:7`. Verdict: **CONFIRMED** for the substance, **CONFIRMED
error** in the "37" (35). S3 for the count.

### 2.6 The AUTO WARM→GPU turn "still executed at NPU speed" — S2, CONFIRMED but the reasoning is circular

`REPORT.md:82-89` / `REPORT.md:93` — `auto1-s1` at 170.2 tok/s is used as evidence that
"a 'GPU' turn on a lane-on load still runs the HTP context".

Two problems:

1. **Every** chunk of **every** lane-on turn reports `"actual":"gpu"` — including the
   turns labelled NPU. Across all 34 extracts: `303` occurrences of `"actual":"gpu"` and
   `27` of `"actual":"cpu"`, and **zero** of `"actual":"npu"`. E.g.
   `raw/npu2-s1` governor line (FAST, `engine_prefill:"NPU"`):
   `"route_chunks":[{"index":0,"requested":"auto","actual":"gpu","tokens":512,…,"forced":false}, …]`
   So the per-chunk field carries no information about the backend and cannot be the
   discriminator the report wants. The label-vs-device divergence the report describes as
   "one of the campaign's two real findings" is in fact present in **all 21** lane-on
   turns, not 2.
2. The speed argument is valid only as an indirect inference (170 ≈ NPU 171 ≫ GPU 115),
   and it is **not** what the report claims elsewhere: `REPORT.md:27` says GPU ran
   "OpenCL prefill … on every chunk with `route_mismatch:false`" — for lane-*off* turns
   only. Fine, but then the report should say the chunk field means nothing anywhere.

Verdict: **CONFIRMED** (the divergence exists and is bigger than reported),
**REFUTED** that this is a two-turn phenomenon, S2.

### 2.7 "12 of 13" / "GPU label running at NPU speed" is load-bearing for "the governor picks NPU" — S1

`REPORT.md:14` — "the governor picks NPU by itself". The only evidence is the single
`engine_prefill` summary field, whose per-chunk companion says `"actual":"gpu"` in all 21
lane-on turns, and whose value flips on 2 of 21 turns, both at `thermal_state":"WARM"`
while `platform_thermal_status` was `1`. The claim "Short and long prompts both resolve to
NPU whenever the state is FAST or COOLMODE" (`REPORT.md:37-38`) is arithmetically true but
rests on n=19 with **zero** negative examples in FAST/COOLMODE — it cannot falsify the
rule. Verdict: **PLAUSIBLE**, S1 (stated as a PASS clause with n=2 for the exception).

### 2.8 The APK v73 skel hash "equals the manifest pin" — S2, REFUTED as cited

`REPORT.md:142-144` — "the APK's `libggml-htp-v73.so` sha256 `ddfec439…fce6` equals the
node_modules/llama.rn HTP_SKELS manifest pin for engine `61c90948` (verified pre-install;
`raw/apk.sha256`)".

`raw/apk.sha256` is one line long:
`e53ed1f890fec13ee4f15583a679eaeaf8aaf8b99fa8aa6d5d7970e9dfb5f003  /tmp/s23-gov/apk-dl/kalsa-apk-arm64-v8a-debuggable-07476daef029d39dc85e6b4451d54ff8af1d4d46/app-release.apk`

There is **no skel hash in it**. The strings `ddfec439` and `HTP_SKELS` appear nowhere in
`raw/`. The hash is also elided to 8+4 hex chars, so it cannot be compared by anyone.
The nearest real support is CI-side: `raw/watch.log:14` — "✓ Assert the installed HTP
skels match the manifest and the engine pin". Same paragraph, other unreproducible claims:
"`unzip -l` lists `assets/ggml-hexagon/libggml-htp-{v73,v75,v79,v81}.so`" and "`strings` …
contains 153 `ggml-hex` hits" — no listing and no strings output are committed.
Also `REPORT.md:143` writes the engine id as `61c90948` while `REPORT.md:6` writes
`61c909481`. Verdict: **REFUTED** as cited; the underlying claim is **PLAUSIBLE** on the
strength of `raw/watch.log:14` alone. S2.

### 2.9 Energy — S2, mostly CONFIRMED with a wrong GPU figure

`REPORT.md:47` — "CPU short turns draw ~49 mAh vs 17 mAh for both NPU and GPU short turns".

Recomputed from the CSVs (first minus last `charge_counter_uAh`, all 34 files):

| group | values (mAh) | median |
|---|---|---:|
| CPU short | 48.75 (cpu1-s1), 41.25 (cpu1-s2), 52.50 (cpu2-s1) | 48.75 → "~49" ✔ |
| NPU short | 18.75, 15.00, 3.75, 18.75, 26.25, 7.50 | 16.9 → "~17" ✔ |
| GPU short | 15.00, 11.25, 26.25, 30.00, 18.75, 15.00 | **15.0**, not 17 ✘ |

Caveats the report does not give: (a) the counter quantises in **3.75 mAh** steps (visible
in `raw/npu1-s1.csv`: `2970000 → 2966250 → 2951250`), so a 17 mAh number is 4–5 counts and
single turns range 3.75–30 mAh; (b) the window is the *whole turn*, and decode (identical
CPU work in every arm, `predictedMs` ≈ 47–70 s) is ~80 % of a short turn, so the delta
mostly measures wall-clock, not engine; (c) `raw/energy-cc.txt:12`
(`cpu1-s1 135.8 -49 -674237.4`) — the `-49` column that superficially matches "49" is the
**battery-percentage** delta, not mAh; anyone re-deriving from that file will get the wrong
unit. `REPORT.md:45-46`'s "the 1 Hz `current_uA` snapshots are not physical — median 2 mA"
is confirmed (medians are −1342…−2132 µA). Verdict: CPU/NPU CONFIRMED, GPU figure
**CONFIRMED error** (15.0 not 17), S2.

### 2.10 "37 CSVs collected" — CONFIRMED FALSE (34), S2

See §1.1. The energy claim is also structurally impossible as stated: `cpu1-l1` has no CSV
in `raw/`, yet `raw/energy-per-turn.txt:11` and `raw/energy-cc.txt:11` both contain a
`cpu1-l1` row (`cpu1-l1 1 5.20` / `cpu1-l1 220.2 -90 -1171868.2`). Two derived files
reference evidence that was not committed.

---

## 3. Protocol validity

### 3.1 Per-turn preflight — CONFIRMED complete, and one gate is not what the report implies

All 41 preflight states exist and every completed turn has both files:
`raw/*-battery-pre.txt` (41) and `raw/*-state-pre.txt` (41 = 35 completed + 6 thermally
refused: `auto1-l2`, `cpu1-s3`, `cpu2-s2`, `gpu1-l3`, `gpu2-l2`, `npu2-l3`). Every one of
the 41 ends with `persist.traced.enable` = `0` (checked all). Every state file shows
`mWakefulness=Awake`. Every completed turn started at Thermal Status 0–2. Battery never
below 20 %.

`raw/gpu1-l2-state-pre.txt:4` shows a completed turn at `Thermal Status: 1`, `level: 35`
— i.e. the file set is honest.

One wording issue: `REPORT.md:148-149` lists "Kalsa foreground at send (topResumedActivity
gate)" as a *preflight* item; in the harness it is checked after the send tap is staged
(`raw/turn.sh:62`), which is the right place, but it is not a preflight gate.

### 3.2 The gpu1 watchdog citation is wrong — S2, CONFIRMED

`REPORT.md:96` — "| gpu1 | 4/6 (s1–s3, l1) | turn l2 preflight: Thermal Status 3,
SKIN 42.2 °C (`raw/arm-gpu1-preflight.txt`) |".

`raw/arm-gpu1-preflight.txt` is written **once per arm, before the arm's turns**
(`raw/arm.sh:8`), and the committed copy ends `… Thermal Status: 0`
(`raw/arm-gpu1-preflight.txt:27`). It therefore cannot be a turn-l2 preflight. The real
evidence for the gpu1 stop is `raw/campaign2.log:28-29`:
`gpu1-l2 THERMAL>=3 - STOP ARM` / `ARM gpu1 STOPPED (thermal)`, and the arm-level refusal
of the *first* gpu1 attempt is `raw/campaign.log:39-41`:
`ARM gpu1 route=gpu lane=off start level=70 plugged=0 Thermal Status: 3` /
`THERMAL >= 3 - ARM INVALID` / `=== ARM gpu1 rc=8 end 15:38:45 ===`.
(The 42.2 °C figure in `REPORT.md:96` actually comes from `raw/campaign2.sh:3-4`'s comment:
"Thermal Status 3, SKIN 42.2 C at 15:38".) Verdict: **CONFIRMED** mis-citation, S2.

### 3.3 The watchdog table has two wrong rows and one phantom fill — S2, CONFIRMED

`REPORT.md:94-102` vs the logs:

| row in report | reality | evidence |
|---|---|---|
| `| npu2 | 3/6 | l1 preflight ≥3 |` | npu2 ran **5** turns (s1,s2,s3 in ABBA + l1,l2 in fills); ABBA stopped at l1, fills stopped at l3 | `raw/campaign3.log:146` `npu2-l1 THERMAL>=3 - STOP ARM`; `raw/fills.log:12` `npu2-l3 THERMAL>=3 - STOP ARM` |
| `| gpu1 | 4/6 …` | 4 in ABBA, **+1** fill = 5 | `raw/fills.log:17-18` `gpu1-l2 energy=… dur=118s` |
| fills list "gpu2-s3/l1/**l2**/l3" (`REPORT.md:105`) | **gpu2-l2 never ran** (thermally refused) | `raw/fills.log:34` `gpu2-l2 THERMAL>=3 - STOP ARM`; `raw/gpu2-l2-state-pre.txt:4` `Thermal Status: 3`; no `gpu2-l2-kalsa.txt` exists |

`REPORT.md:106-107` "Remaining holes: cpu longs n=1, cpu shorts n=3 (not 6), gpu1-l3,
npu2-l3, auto1-l2/l3" **omits gpu2-l2**. Verdict: **CONFIRMED**, S2.

### 3.4 Cold vs warm load mixing — CONFIRMED as disclosed, but under-disclosed

`REPORT.md:126-131` discloses that only each arm's first turn is a cold load. That is
correct (13 cold loads = the 13 turns carrying a `KALSA_GOVERNOR_PLAN` line). It does not
disclose that the cold loads are also where the 1660-token system prewarm runs
(`raw/gpu2-l3-kalsa.txt:14`: `KALSA_PREWARM … {"op":"done","promptMs":15104.134,"promptN":1660,…}`,
≈9.9 s of HTP time on every cold load) — real cost that is in neither the TTFT nor the
energy table. Excluding cold turns also moves 7.9× → 7.08× (§1.7).

### 3.5 "Fresh chat per turn … prefill_chunks identical every turn; no KV reuse" — S1, REFUTED

`REPORT.md:129-130`. Two independent refutations:

1. **KV reuse happened.** `raw/gpu2-l3-kalsa.txt:17` `KALSA_KVPREFIX embd=1660
   text_tokens=3145 n_common=1660` (§1.3). It is the only such turn, and it is inside a
   reported median.
2. **Chunks are not identical.** Three distinct patterns across the 34 turns, e.g.
   `raw/npu1-s1`: `"prefill_chunks":"512+512+512+125+71+3"` (6 chunks);
   `raw/npu2-s3`: `"prefill_chunks":"128+128+128+128+128+128+128+128+128+128+128+128+125+71+3"`
   (15 chunks); `raw/auto1-l1`: 26 chunks, all 128 except 125/73/3. Same prompt, same arm
   family, different chunking.

This matters beyond bookkeeping: the **all-128 regime is ~9–10 % slower** and is
**perfectly confounded with COOLMODE**. Cross-tab of thermal state × chunk regime
(34 turns): COOLMODE/all-128 **6**, COOLMODE/512-mix **10**, FAST/512-mix **14**,
WARM/512-mix **4** — all-128 occurs **only** in COOLMODE. Within-arm examples:
`auto1-s2` 169.8 vs `auto2-s2` 152.6 (same prompt, same arm config, −10 %);
`npu2-s2` 168.5 vs `npu2-s3` 153.2 (−9 %). The report's medians pool the two regimes and
its thermal caveat cannot separate them. Verdict: **REFUTED**, S1.

The driver of the 128 vs 512 choice is **not recoverable from the committed evidence**:
`available_mib` is printed only in `KALSA_GOVERNOR_PLAN`, which is absent from **21 of 34**
turn extracts, and among the 13 that have it `available_mib` is flat (4310–4564 MiB) while
both regimes appear (e.g. `cpu2-s1` all-128 at 4433.94 MiB vs `cpu1-s1` 512-mix at 4310.81).

### 3.6 The "ABBA campaign" was three scripts with different abort semantics — S2, CONFIRMED

`raw/campaign.sh` aborts on any non-zero rc (`CAMPAIGN STOP rc=8`, `raw/campaign.log:42`);
`raw/campaign2.sh` does the same (`raw/campaign2.log:31`); only `raw/campaign3.sh:22`
keeps going (`if [ $rc -eq 9 ]; then … exit 9; fi`), with the comment
"rc=8 (thermal stop) now COOLS AND CONTINUES to the next arm". So npu1 was run by
campaign.sh, gpu1 by campaign2.sh, cpu1…npu2 by campaign3.sh. The ABBA *order* is real
(battery levels confirm it: 79→70→63→59→54→49→46→43), but calling it one ABBA sequence
with one watchdog hides that the harness was rewritten twice mid-campaign and that the
first two attempts aborted the whole schedule.

---

## 4. Harness bugs (`raw/turn.sh`, `raw/parse.sh`, `raw/summarize.sh`)

1. **`raw/parse.sh:23` — wrong denominator/numerator pairing.**
   `pts=$(awk "BEGIN{printf \"%.1f\", $pn/($pms/1000)}")` uses telemetry `prompt_n`, while
   the app reports `tokensEvaluated` separately. They diverge on `gpu2-l3`
   (`prompt_n:1485` vs `tokensEvaluated:3145`) and the script silently prefers the wrong
   one. No warning, no row flag. → the 87.6 row (§1.3).
2. **`raw/parse.sh:10-11` — `tail -1` on multi-round turns.** Only the last
   `KALSA_GOVERNOR`/`KALSA_TELEMETRY` line is kept. Every turn in this campaign had
   exactly one round (`governor_lines` = 1 for all 35 rows), so nothing was lost *here*,
   but any tool-call round would silently drop the earlier prefill. Latent data loss.
3. **`raw/parse.sh:12` — vacuous fallback counter** (§2.2). Same for
   `raw/parse.sh:13` `ngov=$(grep -c "KALSA_GOVERNOR {" $f)`: a turn with zero governor
   lines still emits a row, with empty `pe`/`de` (jq on empty input prints nothing, so the
   `// "NONE"` default never fires) and `prompt_n = -1`. It is then filtered out by
   `raw/summarize.sh:6` (`$4 != "-1"`), so the failure is silent.
4. **`raw/summarize.sh:10` — `pts[k "," c] = ($5=="NA") ? 0 : $5;`.** A turn with no
   throughput is folded into the median as **0 tok/s** instead of being excluded. Not
   triggered here (no NA rows), but it is a silent-corruption path.
5. **`raw/summarize.sh:7` — grouping by label, not by work.**
   `p=(substr(a[2],1,1)=="s") ? "short" : "long"` puts `gpu2-l3` (1485 tokens) in "long"
   because it is spelled `l3`. The report's `GPU long n=4` is the direct consequence.
6. **`raw/turn.sh:84` — energy CSV collection is order-dependent.**
   `f=$(… ls files/energy | sort | tail -1)` compared against `$OUT/.last-energy-file`:
   a turn that produces no new file (or one whose name sorts lower) silently gets **no
   CSV** and no message. That is exactly how the 34-vs-35 gap can happen.
7. **`raw/turn.sh:30` — retry loop breaks on the wrong condition.**
   `grep -q "riprovare" $OUT/$LABEL-ui-load.xml || break` — the loop breaks when the
   dead-marker string is *absent* (good), but it also breaks when the dump is missing or
   empty (grep exit 2), i.e. a failed `uiautomator dump` is indistinguishable from
   "marker cleared". Fail-open.
8. **`raw/turn.sh:73` — the hang guard can be satisfied by the wrong process.**
   `adb -s $S logcat -d 2>/dev/null | grep -q KALSA_TELEMETRY` scans the whole buffer
   (cleared at line 24, so OK) with no `--pid`. Combined with `2>/dev/null`, an adb
   failure yields an empty pipe and the loop just keeps polling — the guard still fires,
   so this is cosmetic. `set -e` is not used anywhere (only `set -u`), so **every**
   unchecked adb failure in the script is non-fatal: lines 13, 78, 79-82 all ignore
   adb's exit status.
9. **`raw/arm.sh:28` — the crash sweep is both lossy and unlogged.**
   `grep -E "^\d|data_app_native_crash|SYSTEM_TOMBSTONE" | tail -40` — the `tail -40`
   bound is why "byte-identical" could not survive contact with the baseline (§2.4).
10. **`raw/turn.sh:46` — the deep-link payload is shell-interpolated into a device-shell
    single-quoted string.** `am start … -d 'kalsa://share?text=$(cat enc-$PROMPT.txt)…'`.
    The campaign got away with it only because `raw/enc-short.txt` pre-encodes the
    apostrophe (`battery%27percentage`). Any unencoded shell metacharacter (`$`, `` ` ``,
    `!`, newline) would truncate the staged prompt silently — exactly the
    "STAGE NEVER LANDED" failure the report documents at `REPORT.md:119-122`. The fix is
    one level short of a fix.
11. **`raw/cpulong.sh:16`** — the `cpu2-l1` guard is a bare `A && B && C` compound, so its
    non-execution is reported as `rc=1` (`raw/cpulong.log:9`), which reads like a failed
    turn rather than a skipped one.
12. **`raw/turn.sh:83-88` runs after the turn** — for `cpu1-l1` the collect step produced
    nothing committed, and nothing in the pipeline noticed (no manifest check, no
    per-label completeness assertion). That is how a whole turn's evidence vanished while
    its derived rows survived.

---

## 5. Secrets / privacy

**No secrets and no user content found.** Scanned all 304 files for API-key/token/bearer
patterns (`sk-*`, `ghp_*`, `github_pat_*`, `Bearer <20+>`, `api[_-]?key`, `password`,
`secret`) — zero hits. The prompts are synthetic (`raw/prompt-short.txt`, 54 words about
battery throttling; `raw/prompt-long.txt`, 1264 words), the app ran in fresh chats with a
fixed system prefix (`KALSA_WINDOW … "textEst":104` for the short turns), and the
`-kalsa.txt` extracts carry only counters (`prompt_n`, `promptMs`, `windowTokens`,
model hash `3677660334`). The only device-identifying data are the serial
(`REPORT.md:5`) and the ADB endpoint (`raw/env.sh:2`) — already in the report, and the
endpoint is stale. `raw/arm-*-keys.txt` contain only `kalsa.bench.*` keys. Verdict:
**CLEAN**, S3 note: `raw/final-state.txt` and the `*-battery-pre.txt` files embed the
charge counter and per-minute `ACTION_BATTERY_CHANGED` history (battery wear telemetry),
which is harmless but is device-state data the report does not mention committing.

---

## 6. The three open questions — best evidence-based hypothesis

### 6.1 Why only ~1.5× GPU in-app when the bare bench says 4.7×

**Hypothesis (strong).** The bench measures a single dense prefill of a whole context with
one dispatch; the app measures a *chunked* prefill where the per-dispatch fixed cost
dominates. From `raw/npu2-s3` (all-128, short): chunk time grows
`572, 625, 630, 649, 656, 661, 754, 807, 864, 904, 963, 1042 ms` at cumulative contexts
128→1536, i.e. `ms ≈ 529 + 0.334 × (tokens already in context)`. From
`raw/auto1-l1` (all-128, long): `567 ms` at ctx 128 → `1769 ms` at ctx 3069, i.e.
`ms ≈ 515 + 0.409 × ctx`. The **~0.52–0.57 s intercept is a fixed per-dispatch cost**
(HTP/FastRPC submit + graph commit, plus the host-memory KV commit the report itself
names: `commit_bytes` 11.9 MB short / 21.3 MB long, e.g. `raw/npu2-l1` governor line).
With `n_ubatch = 256` (`raw/nativecheck-full.log:2171`) and chunks of 128, that fixed cost
is amortised over only 128 tokens ≈ 4.1–4.5 ms/token, versus ≈ 3.75 ms/token for 512-token
chunks (`raw/npu1-s1`: 1917 ms for 512 at ctx 0). So the in-app ratio is a property of
the chunk schedule, not of the silicon. The bench's 4.7× requires one dispatch for the
whole prefill; the governor's design forbids it.
**Confidence: high** for the fixed-cost decomposition (it fits 12- and 26-point sequences
to within a few percent), **medium** for attributing the intercept specifically to the KV
commit — `commit_bytes` is reported per turn, never per chunk, so the growing term cannot
be separated from the attention scan over the growing KV cache.

### 6.2 Why 128-token chunks grow 0.57 → 1.1 s with context

**Hypothesis.** Two terms, both visible above: (a) a constant ≈ 0.52–0.57 s per dispatch,
independent of chunk size and context (the HTP submit/commit round trip; compare the first
chunk of `raw/npu2-s3` 572 ms and of `raw/auto1-l1` 567 ms — identical, both at ctx≈0);
(b) a context-proportional attention/commit term of ≈ 0.33–0.41 ms per token of prior
context. At 128 tokens/chunk the fixed term is 4× more significant than at 512, which is
exactly why the all-128 turns are the slow ones. The 512-token turns show the same term at
a steeper slope (1.35–1.51 ms/token of prior context, `raw/npu1-s1`, `raw/auto2-l2`),
which is consistent with attention being batched per ubatch rather than per token.
Decisive test not yet run: log `commit_bytes` per chunk, or force `n_ubatch=512` for all
turns and re-measure. **Confidence: high on the decomposition, low on which term dominates
at large ctx.**

### 6.3 Why the first npu1 arm "failed to load"

**Not evidenced in `raw/`.** `raw/campaign.log` shows npu1 running **6/6 with no retries**:
`raw/campaign.log:2` `ARM npu1 route=auto lane=on start level=79 plugged=0 Thermal Status: 0`,
`raw/campaign.log:36` `ARM npu1 DONE dead_marker=none rc=0`. There is no
"retried dead marker", no `STAGE NEVER LANDED`, no failed-load line anywhere in
`campaign*.log`/`fills.log`/`cpulong.log`.

**Hypothesis (moderate).** The pre-campaign probes show the failure mode that is available:
`raw/npucheck-full.log` (15:14) and `raw/nativecheck-full.log` (15:18) both come up with
`ggml-hex: HTP0 failed to get URI (physical 0, virtual 0) : error 0x14. Falling back to
single session URI` (`raw/nativecheck-full.log:338`), and `error 0x14` means the HTP
skeleton accepts only a **single session URI** on this v73 device. `raw/arm.sh:8` +
`raw/sqlw.sh:6` force-stop the app and rewrite the DB before every arm; if a DSP session
from the previous process was still alive (FastRPC teardown is asynchronous), the next
process's `HTP0 allocating new session` can hit the same single-session limit and fail to
register the device → `npu_device:null` → the "load failed" symptom. This is consistent
with (i) the 12 non-empty `-fastrpc.txt` files being exactly the 12 cold loads, (ii)
`error 0x14` appearing on **lane-off** turns too (`raw/gpu1-s1-hexlog.txt:2`), i.e. the HTP
session path always runs, and (iii) the fix pattern the campaign already used: keys written
only while the app is dead, then a 30 s settle. `raw/arm-npu1-tombstones.txt` shows no
tombstone newer than `2026-09-30 23:53`, so this was a load failure, not a crash.
**Confidence: moderate — this is inference from the failure mode available, not from a log
of the event. The event itself is not in the committed evidence and the report never
mentions it.**

---

## 7. Smaller findings worth fixing

* `REPORT.md:109` — "the ABBA sequence ran **25→42 °C skin** across npu1". The lowest SKIN in
  any `raw/*-state-pre.txt` is **31.4** (`raw/npu1-s1-state-pre.txt:5`) and the highest is
  **42.6** (`raw/gpu2-l2-state-pre.txt`, an aborted turn). Across npu1's turns the range is
  31.4→41.3 start / 42.2 post. There is no 25 °C reading anywhere. **CONFIRMED error**, S3.
* `REPORT.md:150` — "staged text + enabled Invia verified in the UI dump before every send
  (`raw/*-ui.xml`)". **Zero `*.xml` files exist in `raw/`** (34 turns, 0 dumps). The
  screenshots are declared missing (`REPORT.md:165` "`-presend.png` NOT stored") but the XML
  dumps are cited as evidence and are not there. **CONFIRMED error**, S1 for the evidence
  chain (it is the only proof that the *right prompt* was sent each turn).
* `REPORT.md:158-162` — the HTP evidence turn is not disclosed as being pre-campaign and
  short-prompt; `raw/nativecheck-full.log` timestamps start at `15:18:23` while
  `raw/campaign.log:1` starts at `15:23:59`. S2.
* `REPORT.md:6` vs `:143` — engine id written `61c909481` and `61c90948`. S3.
* `REPORT.md:167` — "no new dropbox entries" — see §2.4; the final dump *lost* three.
* `REPORT.md:170` — "Phone unplugged … **Kalsa foreground with the model loaded**".
  `raw/final-state.txt:31`: `topResumedActivity=ActivityRecord{65997542 u0
  com.sec.android.app.launcher/com.android.quickstep.RecentsActivity t110}` — the launcher
  / recents was foreground, not Kalsa. Everything else on that line checks out (level 20,
  unplugged, `Thermal Status: 1`, `traced=0`, keys restored). **CONFIRMED error**, S2.
* `raw/env.sh:2` `S=192.168.1.152:34673` vs `REPORT.md:5` "192.168.1.152:34673" — the
  report header says the same port, but the AGENTS.md device list has
  `192.168.1.152:43089`; the session log quote in the report body (`wireless adb
  192.168.1.152:34673`) is consistent with `raw/`. No finding, noted for traceability.
* Unreferenced raw artifact: `raw/npucheck-full.log` (519 lines, a 15:14 probe) is in `raw/`
  but never mentioned in the report. S3.

## 8. What would have to change before this is citable

1. Fix the turn count (35 recorded / 34 with evidence / 34 CSVs) everywhere, or produce the
   missing `cpu1-l1` evidence files.
2. Drop `gpu2-l3` from the GPU-long set and restate the long ratio as 1.17×; state that the
   report's 1.20× came from a prefix-reuse turn.
3. Restate the AUTO pick count as 9 of 10 (or 19 of 21 including the NPU arm) and label the
   WARM→GPU evidence as n=2.
4. Replace "HTP execution is proven at buffer level" with "HTP0 owns all 31 layers and has a
   129 MiB compute buffer in the prefill context of one pre-campaign short-prompt probe
   turn"; disclose the second (OpenCL/CPU, decode) context.
5. Fix the dropbox sentence: the two dumps are **not** byte-identical (8 vs 5 lines) and the
   comparison cannot prove "zero new crashes"; drop the `c26ba8bc` claim or commit the
   tombstone text.
6. Correct the end state (launcher, not Kalsa) and either commit `raw/*-ui.xml` or remove the
   claim it supports.
7. Report the two ubatch regimes and the COOLMODE confound explicitly, with per-turn chunk
   strings; add `LOWBAT` to the thermal-mix caveat; report the measured pass-1/pass-2 deltas
   (−3 % to −10 %) instead of "within noise".
8. Re-derive the skel-manifest statement from `raw/watch.log:14`, or commit the hash.