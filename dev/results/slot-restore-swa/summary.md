# Slot restore, with and without `--swa-full` — what the round-trip costs

Date: 2026-09-21 · Machine: Apple M1 Max, 64 GiB unified · Engine: the shipped fork,
`kalsa-server` build 11187 (`2a290390d`), engine sha256 `327fb363…`, Metal ·
Model: `Trinity-Nano-Preview-Q4_K_M.gguf`, sha256 `287562a3…`, 14 full-attention + 42
sliding-window layers · `--ctx-size 16384`, KV q8_0/q8_0, `--threads 4/4`, batch 2048/ubatch 512 ·
Raw artifact: `results.json`, beside this file. Raw engine logs were **not** committed
(`provenance.raw_log_committed = false`); no prompt or completion text is in the artifact, and
the harness's sentinel does not appear in the log.

## The question

`PLAN-CHAT-ON-DISK.md` §5 and `MULTI-DEVICE-SHAPE.md` §9 both made `--swa-full` (or a guaranteed
checkpoint per save) a **tested precondition** of the disk tier, on the strength of the paging
spike's single-slot run: `n_restored=613`, then `cached=0` — "paging gives nothing back". The
question this run settles is which mechanism actually decides whether a restored chat comes back
warm.

## The method

Three engines, the same sliding-window model, two chat sizes (~600 and ~1900 tokens) and two salt
modes:

1. **slot save/restore, `--swa-full` off** — `--cache-ram 0`, `--slot-save-path`,
   `--ctx-checkpoints 1`, port 19312;
2. **slot save/restore, `--swa-full` on** — identical argv plus the flag, port 19313;
3. **control: the RAM prompt cache** — `--cache-ram 384`, no save and no restore, port 19314.

`--cache-ram 0` on engines 1 and 2 is what makes the result readable: with the RAM prompt cache
off, the **only** possible source of warmth is the save file. A warm answer cannot be the cache
answering for the file.

## The result

| engine | tokens | salt | `n_restored` | next `cache_n` | tokens re-evaluated | file bytes | warm |
|---|---:|---|---:|---:|---:|---:|---|
| `--swa-full` off | 600 | yes | 607 | **0** | 600 | 32 135 692 | **no** |
| `--swa-full` off | 600 | no | 607 | 595 | 5 | 32 135 692 | yes |
| `--swa-full` off | 1900 | yes | 1907 | **0** | 1900 | 101 493 292 | **no** |
| `--swa-full` off | 1900 | no | 1907 | 1895 | 5 | 101 493 292 | yes |
| `--swa-full` on | 600 | yes | 607 | **0** | 600 | 18 510 048 | **no** |
| `--swa-full` on | 600 | no | 607 | 599 | 1 | 18 510 048 | yes |
| `--swa-full` on | 1900 | yes | 1907 | **0** | 1900 | 58 149 648 | **no** |
| `--swa-full` on | 1900 | no | 1907 | 1899 | 1 | 58 149 648 | yes |

Control, RAM prompt cache, same two sizes: warm return 595 and 1895, switch-back 595 and 1895 —
the control is warm, so the harness can detect warmth at all.

## The finding

**The salt decides, and `--swa-full` does not.** The tokens come back in every case
(`n_restored` is the full conversation in all eight rows), and the state is then destroyed by the
next request **only when the caller carries a cache salt**: with the salt the reused-token count
is 0 and the whole prompt is re-prefilled; without it, 1895 of 1900 tokens are reused without the
flag and 1899 of 1900 with it. That is the same in both flag settings, so the flag is not the
variable.

The mechanism is named in the artifact itself
(`answers.blocking_mechanism`): *"the restore wipes `slot.prompt.cache_salt`, so the next request
with the same salt logs `different cache namespace - clearing cached prompt`."* That is
`server-context.cpp:2879` clearing the namespace and `:3432-3434` wiping what was restored —
exactly the hole `5c96b18dd` left open, and exactly what task T1 of `PLAN-DISK-TIER.md` fixes.

## What this corrects

- **`--swa-full` is not a precondition of the disk tier.** The paging spike's `cached=0` was this
  salt bug, not a sliding-window limitation, and the tier does not pay the flag's price: measured
  on this engine, `--swa-full` takes the SWA cache from 2560 to 16384 cells
  (`llama_kv_cache_iswa`, both lines in the run log), which at a single 64k slot is 25.6× the
  SWA KV — the ~1.4 GiB derived in `PLAN-DISK-TIER.md` §2. That price is now moot.
- **The flag is not free of side effects, and it moves the file, not the warmth.** A save under
  `--swa-full` carries no context checkpoint (the run log restores one checkpoint with the flag
  off and none with it on), so its file is smaller: 18.5 MB against 32.1 MB at 600 tokens, and
  58.1 MB against 101.5 MB at 1900.

## The disk footprint, measured

On this model the save file is **linear in the conversation at these sizes** and costs
**≈ 31 KB/token with `--swa-full`** and **≈ 53 KB/token without it** (18.5/0.6k, 58.1/1.9k,
32.1/0.6k, 101.5/1.9k MB). At the 4 096-token per-device floor that is ≈ 127 MB or ≈ 218 MB per
chat. The saturating regime that the plan predicts for the sliding-window layers begins above the
2 048-token window, so at these two sizes it is not visible and is **not** measured here.

## What this does not settle

- Nothing above ~1900 tokens: the saturating part of the curve, and the sizes a household
  actually reaches, are outside this run.
- The production launch carries `--cache-ram 6144`; this run set it to 0 on purpose. The RAM
  prompt cache is an **additional** path that can serve a restore, not a substitute for the fix.
- The timings in the artifact (`next_ms`, `prompt_ms`) are not usable: the run happened at a
  1-minute load average of ~12 with the CPU 81-91 % idle, and only the **counts** are load-invariant.
  No timing claim is made from this run. The re-evaluation rate is consistent with the committed
  figures in `MULTI-DEVICE-SHAPE.md` §5, which is a sanity check, not a result.
