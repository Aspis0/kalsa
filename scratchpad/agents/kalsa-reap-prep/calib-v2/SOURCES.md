# calib-v2 sources — licences and provenance

Seven equal-token domains (~450k tokens each with the Qwen3.6 tokenizer,
3,152,546 total): IT FR ES EN ZH CODE MATH. Reuse of the v1 calibration rows
keeps their row-level licence tags (see `calib/SOURCES.md` for that table:
aya apache-2.0, aya `translated_dolly` cc-by-sa-3.0, gsm8k mit, mbpp cc-by-4.0,
hermes apache-2.0). New material:

| source | exact origin | license | used for |
|---|---|---|---|
| v1 calibration rows | `~/kalsa-models/reap-calib/kalsa-reap-calib.jsonl` (sha in `CALIB_MANIFEST.sha256`) | per-row tags carried over | IT/FR/ES/ZH whole; EN chat+multiturn → EN; EN MBPP-train + toolcall → CODE; EN GSM8K-train reasoning → MATH (seeded downsample to the token target) |
| `HuggingFaceFW/fineweb-2` | pinned `af9c13333eb981300149d5ca60a8e9d659b276b9`, configs `ita_Latn` / `fra_Latn` / `spa_Latn` / `cmn_Hani`, split train, streaming, `language_score ≥ 0.9`, 200–12,000 chars | **ODC-By 1.0** | web text top-up for IT/FR/ES/ZH (note: Mandarin is `cmn_Hani`; there is no `zho_*` in fineweb-2) |
| `HuggingFaceFW/fineweb` | pinned `9bb295ddab0e05d785b879661af7260fed5140fc`, config `sample-10BT`, split train, same filters | **ODC-By 1.0** | web text top-up for EN (fineweb-2 has no English subset by design) |
| `openai/gsm8k` | pinned `740312add88f781978c0658806c59bc2815b9866`, **train split only** | **MIT** | MATH top-up: problems + full worked solutions (test split is an eval set, never touched) |
| kalsallama engine repo | `~/Projects/kalsallama` @ commit `63a51b6d67a890797b44f3c9f029b94127363fe7`, C/C++ from `src/`, `ggml/src/`, `include/` and Python from the repo tree; files 3 KB–400 KB, test/vendor dirs skipped, sequential non-overlapping ~4 KB chunks with `path#L<first>-L<last>` provenance, leading licence headers stripped | **MIT** (ggml + llama.cpp fork) | the CODE backbone (filled first, ~300k of the domain's 450k tokens, split ~1/3 each across engine C/C++, engine Python, CPython stdlib by round-robin) |
| CPython stdlib | `/opt/homebrew/opt/python@3.14/Frameworks/Python.framework/Versions/3.14/lib/python3.14` (CPython **3.14.6**, Homebrew; the same files the Mac's default `python3` runs), same chunking rules | **PSF-2.0** | part of the CODE backbone (see above) |

Every HF download pins the revision in code (`calib-v2/sources_v2.py`,
`calib-v2/evalsets.py`), so the pin is enforced, not just recorded. Exact
per-source token shares per domain: `CALIB-COUNTS-v2.json` (`by_source_tokens`).

Used as BAN SETS ONLY (never as calibration content): FLORES-200 dev AND
devtest (local v3 copy `scratchpad/agents/moe-expert-usage-v3/raw/corpus/flores`,
CC-BY-SA-4.0), `openai/gsm8k` test, `openai/openai_humaneval` @
`7dce6050a7d6d172f3cc5c32aa97f52fa1a2e544` (MIT), `evalplus/humanevalplus` @
`d32357cf319e50e9c8d8dab5ea876c72b0fd321b` (apache-2.0), `mbpp` full+sanitized
test splits, `corpus/postcutoff/` (CC-BY-SA-4.0), `corpus/multi5/`.

Licence notes:

- **ODC-By 1.0** (fineweb, fineweb-2): attribution + no-DRM; no share-alike.
  Explicitly acceptable for this calibration per the owner (DESIGN.md §4).
- **MIT / PSF-2.0** (engine, stdlib, gsm8k): permissive; redistribution of
  extracted chunks for calibration is the intended use. Chunk provenance
  (`path#L<first>-L<last>`) is kept on every row so chunks can be traced back.
- v1's per-row tags travel with reused rows unchanged; rows dropped by the
  eval-overlap screen are gone from v2 entirely (25 MBPP-train rows shared
  13-grams with MBPP test; 5 GSM8K-train rows with GSM8K test; 6 web/aya rows
  with HumanEval(+)/MBPP — see PHASE0-CALIB.md).
