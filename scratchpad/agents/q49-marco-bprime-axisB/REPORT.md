# q49 REPORT — Marco B′ axis-B (mechanical only)

No quality judging in this file. Blind pairwise is for a **separate** agent
(`pairs/*.md`; do **not** open `key.json`).

**Freeze order (binding):** `prompts.json` sha256
`56574436b342d71464b58fd66982a2dbf8b9fb3f5fb14ddf12bf01cca2aacfb9`
(60 prompts, 14902 B) written **before** PREREG lock
`2026-08-24T13:52:14Z`. First `llama-cli` spawn `2026-08-24T13:54:43Z`.
See `SESSION_LOG.md`.

## Arms / binary

| item | sha256 | notes |
|---|---|---|
| control GGUF | `f3e2826f78c78452afa0765613875c806f1ca3976f1f59ff4e8ff85bea5782ea` | 6385238912 B, match q43 |
| q8_0 GGUF | `bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419` | 6509642624 B |
| llama-cli.exe | `035ac1a68cff7ffaee243946f66443a95cf436dd8185b14fb458f58f689c1518` | `build-llama-pc`, already present, no ninja |
| llama-cli-impl.dll | `29c93b7e36f3cba84bf000b72b35bdb3305182d2c09b0bd7a463f901c0f1ad74` | |
| prompts.json | `56574436…` | frozen |

Settings: `--temp 0 --seed 42 -c 4096 -ngl 0 -cnv --single-turn --no-warmup --reasoning off`.
120/120 gens **rc=0**.

**Thread cutover (does not change greedy tokens):** gens 1–68 (`fact_it_01` … `inst_it_04` both arms) ran `-t 16`. From `inst_it_05` onward: `-t 8`, `IDLE_PRIORITY_CLASS`, 10 s pause. Owner throttle 2026-08-24T14:17Z.

## Counts

| cat | n prompts | langs |
|---|---:|---|
| factual | 25 | 5× IT/EN/ES/FR/ZH |
| instruction | 10 | 5 EN + 5 IT |
| code | 5 | EN |
| reasoning | 8 | 4 IT + 4 EN |
| longform | 6 | IT |
| langfid | 6 | IT/FR/ES/ZH |
| **total** | **60** | |
| gen files | **120** | 60×2 arms |
| blind pairs | **60** | `pairs/<id>.md` |

## Machine checks (`machine_checks.csv`)

Heuristic language detector (stopwords + CJK script), 20-gram loop rule as PREREG, regex format ids. **Not** a judge.

| arm | loop=1 | lang_ok=0 | format fail / pass (instruction n=10) |
|---|---:|---:|---|
| control | 1 | 1 | 3 / 7 |
| q8_0 (B′) | **2** | 1 | 3 / 7 |

### Loops (PREREG (i) — B′ any loop=1 is a frozen FAIL)

| arm | id | note |
|---|---|---|
| **q8_0** | `code_en_05` | real degeneration: `echo -e 'Error: '` / `'All arguments: '` repeated dozens of times (1429 chars). control of the same prompt is a short `die()` (91 chars, loop=0). |
| control | `long_it_04` | 20-gram repeat in the condominium-minutes longform |
| q8_0 | `long_it_04` | same prompt, both arms loop |

Under frozen **(i)**, B′ fails the cell on `code_en_05`. The bundle is still handed to the blind judge for (iii); that pair and `long_it_04` should be treated as degeneration, not style.

### Language (PREREG (ii))

After script detection: 1 remaining `lang_ok=0` on **both** arms: `fact_es_02` ("La capital de Ecuador es Quito.") — Spanish text, FR/ES stopword clash (`la`/`de`/`es`). Treat as **checker false negative**, not an LFM-style language leak. No B′-only language miss in the columns.

Instruction short replies: exempt. Code-only replies: `lang_ok=1` with `exempt_code`.

### Format (instruction, not a gate by itself)

Same 3 fails on **both** arms (not a B′ delta):

| id | format | typical miss |
|---|---|---|
| `inst_en_03` | csv `name,year` | header `Name,Year` (case) |
| `inst_en_05` | `# PROTOCOL\\nOK` | extra wrapping / spacing |
| `inst_it_04` | `- alfa/- beta/- gamma` | bullet punctuation |

7/10 format_ok both arms, identical.

## Blind-judge package

- `pairs/*.md` — prompt + A + B, A/B randomized per id (`sha256(id|q49-marco-bprime-axisB)` first byte).
- `key.json` — **judge must not read**.
- Frozen (iii): overall control preference of decided pairs ≤ 60%; per category, if n_decided≥5, control wins/decided ≤ 2/3 (8/12-style).

## Anomalies

1. `code_en_05` B′ loop is the only **asymmetric** degeneration in the machine columns.
2. `long_it_04` loops both arms — pair likely undecidable for preference.
3. Language checker is brittle on 1-sentence Romance; `fact_es_02` documented above.
4. Thread throttle mid-cell at `inst_it_05`; outputs remain temp-0/seed-42.
5. `code_en_05` q8_0 hit n=512 and filled with the loop (wall 78 s Idle).

No git. No devices.
