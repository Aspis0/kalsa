# q49 — Marco B′ axis-B behavioral certification (PREREG)

**Locked 2026-08-24T13:52:14Z, BEFORE any generation.** Frozen prompt file: `prompts.json`
sha256 `56574436b342d71464b58fd66982a2dbf8b9fb3f5fb14ddf12bf01cca2aacfb9` (60 prompts, 14902 bytes). Do not edit
`prompts.json` after this lock. Generations may start only after this file
exists on disk with this hash.

PC-only, CPU (`-ngl 0`). No devices. No git. #30 discipline: criteria first.

## Question

Is the last surviving B′ candidate — **Q8_0 trunk** (attn/trunk requantized from
the Q8_0 source, experts byte-identical Q2_K+Q3_K) — behaviorally equivalent to
the shipped KEXP control on instruction-following / language / degeneration?
q43 already PASS 5/5 on multilingual PPL. q37's N=1 factual suite was declared
**non-discriminating** (noise ranked Q8_0 below Q4_0 on one item) and is **not
reused**. This cell is a fresh ~60-prompt multilingual set.

## Arms

| arm | file | sha256 (full, locked) |
|---|---|---|
| control | `scratchpad/agents/q37-bprime-from-source/gguf/marco/Marco-Mini-Instruct-KEXP-fromsrc-trunk-control.gguf` | `f3e2826f78c78452afa0765613875c806f1ca3976f1f59ff4e8ff85bea5782ea` |
| q8_0 (B′) | `…/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf` | `bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419` |

On-disk sha256 (Python hashlib) of both GGUF files must match **before the first
generation**. Mismatch = STOP.

## Prompts (frozen)

`prompts.json` sha256 `56574436b342d71464b58fd66982a2dbf8b9fb3f5fb14ddf12bf01cca2aacfb9`. Counts by `cat`: {"code": 5, "factual": 25, "instruction": 10, "langfid": 6, "longform": 6, "reasoning": 8}.

| cat | n | languages | n_predict |
|---|---:|---|---|
| factual | 25 | 5 each IT/EN/ES/FR/ZH | 512 |
| instruction | 10 | 5 EN + 5 IT | 256 |
| code | 5 | EN | 256–512 |
| reasoning | 8 | 4 IT + 4 EN | 512 |
| longform | 6 | IT | 1024 |
| langfid | 6 | IT/FR/ES/ZH traps | 512 |

**Judging categories** (same `cat` field): factual, instruction, code, reasoning,
longform, langfid. No prompt from q37 (Spa 2000, tabellina 9, gift, vocali
armadio) is reused.

## Locked generation settings

```
build-llama-pc/bin/llama-cli.exe
  -m MODEL -f prompt.txt -o out.txt
  -n <per-prompt n_predict>
  --temp 0 --seed 42
  -c 4096 -t 16 -ngl 0
  -cnv --single-turn --no-display-prompt --log-disable
  --no-warmup --reasoning off
```

CPU only. One llama-cli process at a time. UTF-8 via `--file` / `-o` (not argv).
Same sampler both arms. Seed 42 both arms.

## Machine checks (computed here, not judgment)

1. **Loop / degeneration:** a 20-gram (20 whitespace-separated tokens, or 20 CJK
   chars for zh) that occurs ≥ 3 times in the response, OR a 20-token run that
   repeats consecutively ≥ 2 extra times. Column `loop=1/0`.
2. **Language of response:** script / stopword heuristic (CJK ratio for zh;
   function-word hits for it/en/es/fr). Column `lang_ok=1` iff detected language
   matches `prompts[].lang`. Ambiguous short format-only replies (instruction
   cat, < 20 letters) are `lang_ok=1` if they satisfy the format (language N/A).
3. **Format compliance:** instruction cat only, per `format` id, regex/structure
   checks. Column `format_ok=1/0`. Non-instruction rows: empty.

## Blind pairwise judge (separate agent; this cell does not self-judge quality)

For each prompt, `pairs/<id>.md` has Prompt + Response A + Response B.
A/B assignment is randomized per prompt; the map is `key.json` (judge must not
read it). Judge marks `winner=A|B|tie|undecidable` and a one-line reason.

**Decided pair** = winner is A or B (not tie, not undecidable).
`control_pref = n_control_wins / n_decided` after `key.json` is applied.

## Gate (frozen)

Cell **FAIL** if any of:

**(i) Loops.** Any B′ (`q8_0`) row with `loop=1`. Control loops are recorded but
do not alone FAIL B′ (they do invalidate that pair for (iii)).

**(ii) Language.** Any B′ row with `lang_ok=0` (must follow the **prompt**
language 100% of the time; the LFM failure mode). Instruction rows with
format-only short replies are exempt as defined above.

**(iii) Blind preference.** After the blind judge returns:

- Overall: `control_pref > 0.60` among decided pairs → FAIL.
- Per judging category: FAIL that category (and the cell) if
  `n_decided_cat ≥ 5` AND `control_wins_cat / n_decided_cat > 2/3`
  (the 8/12-style cap: 8/12 = 0.666…; 4/5 fails, 3/5 does not; 17/25 fails).

Cell **PASS** iff (i) and (ii) hold on the machine checks **and** the blind
judge does not trigger (iii). Ties do not count in the denominator.

No ship of t/s. No quality adjectives in REPORT.md before the blind judge.

## Hygiene

Python hashlib sha256 (never Get-FileHash). One process at a time. Disk: abort
if the run cannot write `gen/`. SESSION_LOG timestamps must show freeze before
the first `llama-cli` spawn.
