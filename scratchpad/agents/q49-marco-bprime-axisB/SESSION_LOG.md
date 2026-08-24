# q49 SESSION_LOG — Marco B′ axis-B behavioral certification

PC-only. No devices. No git.
Cell dir: `scratchpad/agents/q49-marco-bprime-axisB/`
Binding order: PREREG + prompts frozen FIRST, generations only after.

All timestamps UTC.

## 2026-08-24T13:50:00Z — cell open, freeze not yet written

Intent: axis-B (#30) for Marco B′ Q8_0-trunk vs control. q43 PPL PASS 5/5 already banked. q37 single-prompt suite declared non-discriminating — this cell is a fresh multilingual set, not a reuse.

Next: write `prompts.json` then `PREREG.md` containing its sha256, then log freeze, then generate.

## 2026-08-24T13:52:14Z — FREEZE

- wrote `prompts.json` n=60 bytes=14902 sha256=`56574436b342d71464b58fd66982a2dbf8b9fb3f5fb14ddf12bf01cca2aacfb9`
- wrote `PREREG.md` citing that sha. Categories={"code": 5, "factual": 25, "instruction": 10, "langfid": 6, "longform": 6, "reasoning": 8}
- no llama-cli has been spawned yet.

## 2026-08-24T13:53:00Z — GGUF + llama-cli pins (still no generation)

On-disk Python hashlib:

| artifact | bytes | sha256 |
|---|---:|---|
| control GGUF | 6385238912 | `f3e2826f78c78452afa0765613875c806f1ca3976f1f59ff4e8ff85bea5782ea` MATCH |
| q8_0 GGUF | 6509642624 | `bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419` MATCH |
| llama-cli.exe | 10752 | `035ac1a68cff7ffaee243946f66443a95cf436dd8185b14fb458f58f689c1518` |
| llama-cli-impl.dll | 1678848 | `29c93b7e36f3cba84bf000b72b35bdb3305182d2c09b0bd7a463f901c0f1ad74` |

`llama-cli` already present in `build-llama-pc` (q41-era). No ninja rebuild.

Next: spawn `run_q49.py` (first llama-cli after this line).

## 2026-08-24T13:54:43Z — generations start (pre-throttle)

First llama-cli spawn: `fact_it_01 control` `-t 16` (default). Freeze was 13:52:14Z. Order holds.

## 2026-08-24T14:17:00Z — THROTTLE (owner: usable PC > cell speed)

Killed the `-t 16` runner after **68** completed gens (last clean `DONE`: `inst_it_04 q8_0`). Next remaining: `inst_it_05` control.

From this point, CONSTANT for all remaining gens:
- `-t 8` (was 16)
- `IDLE_PRIORITY_CLASS` on the llama-cli process (`subprocess.Popen(creationflags=IDLE_PRIORITY_CLASS)`)
- 10 s pause after every generation
- still one process at a time; no parallel hashing/greps during a gen

temp 0 + seed 42: outputs of the remaining gens are still deterministic. The 68 already done at `-t 16` stay; thread count does not change greedy tokens. REPORT will note the cutover at `inst_it_05`.

## 2026-08-24T14:19:06Z — throttled resume confirmed

`START inst_it_05 control n=256 threads=8 prio=Idle` then `PAUSE 10s` after each DONE.

## 2026-08-24T14:56:09Z — ALL_GEN_DONE n=120

All rc=0. `make_bundle.py` wrote `pairs/` (60), `key.json`, `machine_checks.csv`. Mechanical REPORT written. No git.



