# q52 — Marco B′ axis-B v2: loop gate under the PRODUCTION sampler (PREREG)

**Status: LOCKED at commit time (see git log for this file). Generations may
start only after this file is committed.** Owner approval: "condivido fare
cella v2" (2026-08-24). This cell exists because q49 v1 FAILED gate (i) on ONE
true greedy degeneration (`code_en_05`, temp 0) — a decoding regime that
production never runs (temp is hardcoded 0.7, `LlamaService.ts:2446`; see
`SAMPLER_PARAMS.md` §8).

PC-only, CPU (`-ngl 0`). PC-gentile: `-t 8`, process priority Idle, ONE
llama-cli at a time. #30 discipline: criteria first.

## Question (narrow, frozen)

Under the app's **production sampler**, does B′ (Q8_0 trunk) degenerate into
loops more than the shipped KEXP control? This is the ONLY question. Quality,
language fidelity and preference are NOT re-tested: they are inherited from
q43 (PPL PASS 5/5, B′ better on all 5 languages) and q49 (blind judge 6:1 for
B′, 53/60 TIE; language gate PASS).

## Arms (identical to q49, shas re-verified before first generation)

| arm | file | sha256 (full, locked) |
|---|---|---|
| control | `scratchpad/agents/q37-bprime-from-source/gguf/marco/Marco-Mini-Instruct-KEXP-fromsrc-trunk-control.gguf` | `f3e2826f78c78452afa0765613875c806f1ca3976f1f59ff4e8ff85bea5782ea` |
| q8_0 (B′) | `…/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf` | `bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419` |

On-disk sha256 (Python hashlib, never Get-FileHash) of both GGUFs must match
BEFORE the first generation. Mismatch = STOP.

## Prompts (frozen, reused from q49)

`../q49-marco-bprime-axisB/prompts.json`, sha256
`56574436b342d71464b58fd66982a2dbf8b9fb3f5fb14ddf12bf01cca2aacfb9`
(60 prompts). Re-verify the sha before use; do not copy-edit the file.

## Run matrix (frozen)

| set | prompts | seeds | arms | gens |
|---|---|---|---|---:|
| base | all 60 | 101, 102, 103 | both | 360 |
| loop-prone | `code_en_05`, `long_it_04` | 201–210 (10 extra) | both | 40 |

Total 400 generations, paired by (prompt, seed) across arms. Escalation seeds
301–310 are reserved (see Gate) and used ONLY if triggered.

## Locked generation settings — the PRODUCTION sampler

Effective production profile per `SAMPLER_PARAMS.md` §7 (source:
`ai-chat/src/engine/LlamaService.ts:2429-2448` + llama.rn 0.12.8 defaults):

```
build-llama-pc/bin/llama-cli.exe
  -m MODEL -f prompt.txt -o out.txt
  -n 1024
  --temp 0.7 --top-k 40 --top-p 0.95 --min-p 0.05
  --repeat-last-n 64 --repeat-penalty 1.0
  --mirostat 0
  --seed <seed from run matrix>
  -c 4096 -t 8 -ngl 0
  -cnv --single-turn --no-display-prompt --log-disable
  --no-warmup --reasoning off
```

Notes, frozen with the cell:
- `n_predict = 1024` for ALL prompts (production cap for every model in
  default thinking mode, `thinkingBudgets.ts:78`) — deliberately replaces the
  q49 per-prompt values; a uniform 1024 gives loops MORE room to express.
- `penalty_repeat = 1.0` means repetition penalty is **disabled** (the
  "mild repetition control" phrasing in SAMPLER_PARAMS.md §8 is wrong; 1.0 is
  a no-op — recorded here as the orchestrator's correction).
- Production stop-word list (6 strings, `LlamaService.ts:339-346`) is NOT
  passed via `-r`: the chat template's EOS covers the same markers, and
  omitting extra stops only gives generations MORE room to loop —
  conservative in the failing direction for this gate.
- typical_p/penalty_freq/penalty_present/mirostat/dry/xtc all at llama-cli
  defaults = disabled, which matches the production fall-throughs.
- Production seed is -1 (random); fixed seeds here are for pairing and
  reproducibility. Multi-thread CPU (-t 8) makes exact logits best-effort
  reproducible; pairing by (prompt, seed) is the design unit regardless.
- Same command both arms; only `-m` differs.

## Machine check (the only check)

For every generation, compute `loop` exactly as q49 machine check #1:
a 20-gram (20 whitespace-separated tokens, or 20 CJK chars for zh) occurring
≥ 3 times, OR a 20-token run repeating consecutively ≥ 2 extra times.

**True degeneration** (`true_loop=1`) := `loop=1` AND tail-anchored: the last
occurrence of the repeated block ends within the final 50 characters of the
response (the repetition runs to the end of generation — the model never
recovered). Repetition that appears mid-response but recovers is `loop=1,
true_loop=0` (recorded, does not gate).

## Gate (frozen)

Let `L_B` = count of B′ generations with `true_loop=1`, `L_C` = same for
control, over all 400 paired generations.

- **PASS** iff `L_B ≤ L_C`.
- **FAIL** iff `L_B ≥ L_C + 2`.
- **Escalation** iff `L_B = L_C + 1`: for each prompt where the B′ excess
  occurred, rerun that prompt at seeds 301–310, both arms. Then **PASS** iff
  B′ true_loops ≤ control true_loops within the escalation set, else **FAIL**.

No other gate. No blind judge in this cell. No quality adjectives in
REPORT.md.

## Consequence (owner-agreed, frozen)

- PASS → KEXP-Q8 (B′ trunk) proceeds toward the lineup; q43 PPL + q49 blind
  evidence carries over; Marco-B′ candidate for production recipe.
- FAIL → Q5_K trunk stays; B′ remains an NPU-only lab variant.

## Hygiene

Python hashlib sha256 only. One llama-cli process at a time, priority Idle,
`-t 8` (PC-gentile directive 2026-08-24). Runner must be resumable (skip
completed `gen/<arm>/<prompt>_<seed>.txt` that are non-empty) and detached
from the shell (survives compaction: [[background-kills-at-compaction]]).
`RUN_LOG.md` timestamps must show the commit-lock preceding the first
llama-cli spawn. Outputs: `gen/<arm>/<id>_s<seed>.txt`, `machine_checks.csv`
(columns: id, seed, arm, loop, true_loop, chars), `REPORT.md`.
