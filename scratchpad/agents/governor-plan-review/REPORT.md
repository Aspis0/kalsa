# Governor plan adversarial review

Review target: LAB branch `governor-audit-recheck` at `a343f2d7`. This review is read-only with
respect to the plan, source trees, and evidence. The only file created is this report.

## Verdict summary

| item | verdict | conclusion |
|---|---|---|
| 1. Frozen-body fidelity | **CONFIRMED** | The archived body is byte-identical to the parent blob and has the same 1,054 lines. |
| 2. Quantitative sourcing | **REFUTED** | Several numbers have path-only or no citations, the thermal command is not a current reproducible census, and the GPU incident citation points at the wrong current line. |
| 3. Corrected numbers | **CONFIRMED** | The requested corrected values match the re-verification record and the available raw artifacts, with the census-scope caveat recorded below. |
| 4. Design shape and document order | **CONFIRMED** | Rules 1–3, fail-closed probes, and Parts 0–5 are present before Part 6. The plan does not claim that the current implementation already satisfies Rule 1. |
| 5. Six citation drifts | **CONFIRMED** | The six requested source ranges now resolve to the cited code/report rows. |
| 6. Language and checkout paths | **REFUTED** | No prohibited absolute checkout path remains, but line 709 still contains Italian in the new document. |
| 7. Living-document pointers | **REFUTED** | The archive and report pointers are true; the blanket “every number is cited” and strict “in English” claims are false until the findings above are fixed. |

## 1. Archive fidelity — CONFIRMED

The comparison requested in the review is exact:

```text
$ shasum -a 256 archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md
00eb3783f2e78fb26a8f17daab756714229a29f6dbfcabcd63bcdc46053667e0  archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md

$ git show a343f2d7^:analysis/GOVERNOR-DEVICE-PLAN.md | shasum -a 256
00eb3783f2e78fb26a8f17daab756714229a29f6dbfcabcd63bcdc46053667e0  -

$ cmp -s <(git show a343f2d7^:analysis/GOVERNOR-DEVICE-PLAN.md) \\
    archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md; echo $?
0

$ wc -l <(git show a343f2d7^:analysis/GOVERNOR-DEVICE-PLAN.md) \\
    archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md
    1054 /dev/fd/11
    1054 archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md
```

No lost line or byte was found.

## 2. Quantitative sourcing — REFUTED

The new plan establishes a strict contract at `analysis/GOVERNOR-DEVICE-PLAN.md:14-15`:
each quantitative input must have an exact `file:line` citation or be marked `UNSOURCED` with a
settlement method. The document does not meet its own contract.

### 2.1 Numbers with no exact citation or UNSOURCED label

These are not merely formatting complaints: the plan promises exact sourceability, but the cited
locations below are paths, commands, or prose without the required line pin.

```text
$ rg -n 'Three phones|3 x 3 x 2|Four probes|1252|165\.42|279→290|31\.459|100%|tens of seconds|43 °C|25%' \\
    analysis/GOVERNOR-DEVICE-PLAN.md
analysis/GOVERNOR-DEVICE-PLAN.md:24:**In: Android.** Three phones (Xiaomi 14, Galaxy S23, Jelly Star), three engines (CPU, GPU, NPU),
analysis/GOVERNOR-DEVICE-PLAN.md:25:two phases (prefill, decode). That is 3 x 3 x 2 = 18 cells today and the count grows; that is the
analysis/GOVERNOR-DEVICE-PLAN.md:193:Four probes, each producing a **measurement** rather than a table entry, and each failing closed.
analysis/GOVERNOR-DEVICE-PLAN.md:206:gives 1252 samples reading `Thermal Status: 0`, 6 reading `1`, 4 reading `2` and **29 reading `3`**
analysis/GOVERNOR-DEVICE-PLAN.md:281:gives HTP pp512 median **165.42 t/s** against CPU **51.90 t/s** = **3.19×**, unplugged
analysis/GOVERNOR-DEVICE-PLAN.md:391:the 2B battery pairs in this file are correct: `279→290`, `290→290`, `290→318`, `322→319`,
analysis/GOVERNOR-DEVICE-PLAN.md:416:| prefill pp128 | 31.459 | 181.652 | GPU 5.77× faster |
analysis/GOVERNOR-DEVICE-PLAN.md:469:**Contaminant to subtract from every S23 number:** `adsprpcd` / `cdsprpcd` spin at 100% of a core
analysis/GOVERNOR-DEVICE-PLAN.md:542:**(b) First-run calibration.** A short prefill per engine, measure ΔT, save. Cost: tens of seconds
analysis/GOVERNOR-DEVICE-PLAN.md:629:Thermal status >= 3, or battery >= 43 °C unplugged, or level < 25%.
```

Specific examples:

- `analysis/GOVERNOR-DEVICE-PLAN.md:24-26` gives the 3 × 3 × 2 = 18 inventory with no artifact
  citation or UNSOURCED settlement method.
- `:206-210` cites a command and the re-verification report only as “Finding 4”, not as a
  `file:line` source for the four counts.
- `:280-285` cites `NOTES.txt` without its lines. The actual supporting lines are available:

  ```text
  $ nl -ba results/htp_prefill/xiaomi_v75/cell1/NOTES.txt | sed -n '32,46p'
      35    rep3  165.42
      36    median 165.42
      44    51.90 t/s
      45    HTP median / CPU = 165.42 / 51.90 = 3.19x
  ```

- `:390-401` gives the six 2B temperature pairs from a path only; it does not cite the relevant
  lines in `results/xiaomi_ab/task_a/battery_notes.txt`.
- `:406-410` gives the 4B deltas from a path only. The re-verification table identifies the exact
  raw lines as `results/xiaomi_ab/task_a_4b_clean/battery_notes.txt:1,17,26,35,44,53,62,71,80,89,98,107,116`.
  The plan itself does not.
- `:412-417` gives the 2B speed table from two JSON paths only, with no line-addressable evidence.
- `:469-472` gives “100%” and “33 h” from a memory path only, with no line pin.
- `:542-543` gives the calibration cost as “tens of seconds” without evidence or an UNSOURCED
  label and settlement method.
- `:592-593` gives exact 34.0, 36.0, and 43.0 °C values but does not cite the threshold source at
  the claim. The current policy source is `llama-governor-policy.cpp:10-12,42-49`.
- `:620-630` states exact token sizes and stop thresholds without a direct artifact citation or
  UNSOURCED label at those claims.

These are enough to falsify the blanket sourcing assertion; the list is not a claim that every
internal list index or date needs an external citation.

### 2.2 The thermal census is numerically inherited but not reproducible as written

The re-verification report records the intended tracked census as `0=1252, 1=6, 2=4, 3=29` at
`scratchpad/agents/governor-audit-recheck/REPORT.md:146,150`. The new plan repeats those numbers at
`:206` and `:610`. However, the command written in both records uses the literal placeholder `N`,
and the current branch now contains the plan, the frozen body, and the report themselves.

```text
$ git grep -I -h 'Thermal Status: N' | wc -l
       5

$ git grep -I -h -o -E 'Thermal Status: [0-3]' -- '*.md' '*.txt' '*.log' '*.csv' \\
    | sed 's/.*: //' | sort | uniq -c
1252 0
   8 1
   4 2
  32 3
```

The second command is a current tracked-tree check, but it does not produce the plan's `6 / 29`
because the current documentation contributes self-matches. The plan must either cite the
pre-existing census as an exact report line and define its historical scope, or provide a current
command that explicitly excludes the plan, archived evidence, and reports as appropriate and
reproduces the claimed population. As written, it presents a historical result as if its command
were a current proof.

### 2.3 A cited GPU line does not support the incident as stated

At `analysis/GOVERNOR-DEVICE-PLAN.md:229-232`, the plan says that
`gemv_moe_q4_k_f32_ns.cl:216` called a seven-parameter helper with four arguments. The current
source at that citation does not show that call:

```text
$ nl -ba ggml/src/ggml-opencl/kernels/gemv_moe_q4_k_f32_ns.cl | sed -n '214,220p'
   214        half d_val   = src0_d[expert_d_offset + sb * ne01 + i01];
   215        half dm_val  = src0_dm[expert_d_offset + sb * ne01 + i01];
   216
   217        global const uchar * sc = src0_s + (expert_id * ne01 + i01) * scales_per_row + sb * K_SCALE_SIZE;
   218        uchar sv, mn;
   219        get_scale_min_k4(j, sc, &sv, &mn, mask_d6, mask_d4, mask_hi2);
   220
 $ nl -ba ggml/src/ggml-opencl/kernels/gemv_moe_q4_k_f32_ns.cl | sed -n '15,23p'
    15 inline void get_scale_min_k4(
    16     int j,
    17     global const uchar * q,
    18     uchar * d,
    19     uchar * m,
    20     uchar mask_d6,
    21     uchar mask_d4,
    22     uchar mask_hi2
    23 ) {
```

The current call has seven arguments and the cited `:216` is blank. The historical four-argument
failure may have existed in an earlier blob, but the new text supplies neither that old blob's
commit/file:line citation nor a clear “historical source” qualifier. This is a citation drift and
an unsupported surviving quantitative claim, not a failure of the current fixed call.

### 2.4 What did pass the quantitative check

The following values are correctly stated and supported in substance: `0.992`, the NPU whole-cell
temperature decomposition, the clean 4B deltas, the 18/08 decode sample count, the local Mali
identity, the narrative status of `cpu7 1824000`, and the explicit UNSOURCED status of
`gpubusy ~7.5%`. They do not rescue the document's global sourcing contract because several other
number-bearing claims remain unpinned.

## 3. Corrected numbers — CONFIRMED

The requested corrections agree with the re-verification record and the raw material:

- **`0.992` provenance.** `scratchpad/agents/q16-xiaomi/REPORT.md:4,26,336,378` identifies
  `houji` / SM8650 / Adreno 750; `scratchpad/agents/q16-xiaomi-audit/REPORT.md:137` gives
  `0.992469912994216`; the other value is `0.9929437564` in
  `scratchpad/agents/qdc-governor-s5/REPORT.md:235` for QRD8750. The plan's `:435-443` says this
  correctly.
- **NPU temperature.** `battery_series.csv:2-6` is 32.9, 33.3, 33.3, 33.3, 34.2 °C, so the
  whole-cell rise is +1.3 °C, with HTP +0.4 °C and CPU +0.9 °C. The plan's `:280-285` is correct;
  its missing exact `NOTES.txt` line pin is a sourcing-format defect, not a numerical defect.
- **Thermal-status census.** The four values `1252 / 6 / 4 / 29` match the re-verification report's
  tracked-scope result at `REPORT.md:146,150`. The current-command reproducibility problem is
  reported in §2.2.
- **Clean 4B deltas.** The re-verification report at `REPORT.md:197` gives CPU +2.4 / +3.5 / +1.7
  and GPU +0.4 / −0.7 / −0.3. The clean raw file shows the corresponding tenths: 289→313,
  313→317, 317→352, 354→347, 351→368, and 368→365.
- **18/08 decode.** `results/gpu_prefill_recheck_xiaomi/report.md:42` says “2 interleaved pairs”;
  `:48-53` contains CPU 26.968 / 26.039, GPU 17.413 / 17.514, and the 0.66× ratio. The plan's
  `:425-428` corrects the old “10 repetitions per direction” claim.
- **Mali.** `q26-mali-gate/REPORT.md:5,69` supports Mali-G57 MC2. `q26b-mali-probe/REPORT.md:307`
  says `1.0e9 assumed max` and separately gives a 680–1100 MHz third-party range; the plan
  correctly rejects 1100 MHz as the G99 clock rather than silently retaining it as a device fact.
- **`cpu7 1824000`.** The value is no longer treated as part of the fully unsourced pair. The plan
  cites `archived/PLAN-2026-09-full.md:1573` as narrative evidence and separately says raw sysfs
  evidence is still missing at `:212-216` and `:648-649`.
- **`gpubusy ~7.5%`.** The plan keeps it explicitly UNSOURCED at `:644-647` and names a 60-sample
  raw sysfs trace as the settlement method.

## 4. Design shape and ordering — CONFIRMED

The requested shape is present before Part 6:

```text
$ rg -n '^## (Design shape|Part 0|Part 1|Part 2|Part 3|Part 4|Part 5|Part 6)' \\
    analysis/GOVERNOR-DEVICE-PLAN.md
57:## Design shape (kept from the audited plan)
99:## Part 0: What exists today, line by line
191:## Part 1: What the phone must tell the governor
309:## Part 2: How the governor decides
386:## Part 3: The three phones
533:## Part 4: Thermal calibration per device
554:## Part 5: Defects to fix before measuring
595:## Part 6: The measurement plan
```

`analysis/GOVERNOR-DEVICE-PLAN.md:59-64` states Rule 1, `:66-78` states the matrix-as-data Rule
2, `:80-85` states the one-selector Rule 3, and `:87-90` states fail-closed probes. The document
also explicitly records the existing generation branches as defects in `:359-376` and
`:577-581`; it does not falsely claim that the current implementation already obeys Rule 1.

## 5. Six citation drifts — CONFIRMED

The new references resolve as requested:

```text
$ rg -n 'governorInputs\.ts:62-75|governorInputs\.ts:84-121|governorInputs\.ts:123-144|\\
llama-governor-policy\.cpp:184-226|:228-256|q58-s23-npu-spike-sweep/REPORT\.md:29|\\
REPORT\.md:31|REPORT\.md:33|REPORT\.md:35' analysis/GOVERNOR-DEVICE-PLAN.md
81:functions, `admit_prefill` (`src/llama-governor-policy.cpp:184-226`) and `select_decode`
82:(`:228-256`), which duplicate the structure and have *different* defects: the first aborts at
103:`src/engine/governorInputs.ts:62-75`, `generationFor()`, takes `profile.socModel`, uppercases it and
135:`buildGovernorParams()` (`governorInputs.ts:123-144`) emits **ten** keys, not nine: the nine fixed
157:`governorInputs.ts:84-121`. It rejects with `NoFit` if the model lacks `kvBytesPerToken`, if total
182:`scratchpad/agents/q58-s23-npu-spike-sweep/REPORT.md:29, :31, :33, :35` (rows 128 / 512 / 1024 /
```

The source-side checks agree: `generationFor` is lines 62–75, `gpuFit` 84–121,
`buildGovernorParams` 123–144, `admit_prefill` 184–226, `select_decode` 228–256, and q58 CPU
rows 29 / 31 / 33 / 35 contain 1.900 / 3.250 / 3.250 / 5.150 °C. The six requested drifts are
fixed. The separate GPU incident citation in §2.3 is not one of these six and remains wrong.

## 6. Language and absolute paths — REFUTED

The checkout-path check is clean:

```text
$ if rg -n '/Users/marco|/Users/' analysis/GOVERNOR-DEVICE-PLAN.md; then echo MATCH; else echo 'no matches'; fi
no matches
```

The language check is not clean. The rewritten document still has an Italian phrase on line 709:

```text
$ awk 'NR == 709 { print FNR }' analysis/GOVERNOR-DEVICE-PLAN.md
709
```

That occurrence is in the new verification table, not only in the frozen archive. The current
instruction says no Italian in the new document; the phrase must be translated or removed. A
historical quotation exception would not apply unless the rule is explicitly changed, because this
is a newly edited status row in the live English plan.

## 7. PLAN.md and docs/ALIVE.md — REFUTED

The structural pointers are true:

- `PLAN.md:117-123` points to the rewritten plan, frozen archive, and re-verification record.
- `docs/ALIVE.md:28` points to the same three records.
- The archive hash and parent hash are equal, as shown in §1.
- The re-verification report exists and is the 472-line report named by both living documents.

The blanket claims are not all true:

- `PLAN.md:117` calls the plan English, but line 709 contains Italian.
- `PLAN.md:124` and `docs/ALIVE.md:34-36` say every number has an artifact citation or an
  UNSOURCED settlement method. Sections §2.1–§2.3 show that this is false.
- `PLAN.md:166-167` says “all seven audit findings held” while the re-verification record presents
  nine numbered entries, including 8a and 8b. This may mean the seven original audit findings, but
  the wording does not say that and has no source pointer to a seven-item set. Verdict on that
  narrower wording: **UNVERIFIABLE**, not a proven numerical contradiction.

## Required fixes, in order

1. Repair the unsupported and path-only quantitative claims throughout the new plan. Add exact
   `file:line` pins or mark each genuinely unresolved value UNSOURCED with its settlement method;
   at minimum this includes `:24-26`, `:206-210`, `:280-285`, `:390-417`, `:469-472`, `:542-543`,
   `:592-593`, and `:620-630`.
2. Correct the GPU incident at `analysis/GOVERNOR-DEVICE-PLAN.md:229-232`: cite the historical
   pre-fix source that actually had the four-argument call, or describe the current seven-argument
   call accurately. Do not cite current `:216` as the failed call.
3. Make the thermal census reproducible on the current branch. Replace the literal `N` placeholder
   and define exclusions/scope so the command cannot count the new plan, archive, and report as
   measurements while still claiming `1252 / 6 / 4 / 29`.
4. Remove the Italian phrase at `analysis/GOVERNOR-DEVICE-PLAN.md:709` or translate it, then
   rerun the no-Italian check over the entire new document.
5. After fixes 1–4, either retain or narrow the blanket claims at `PLAN.md:117,124` and
   `docs/ALIVE.md:28,34-36`; do not leave them claiming a property the plan still violates.
