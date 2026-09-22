# After a real unload, does the chat come back from disk — and what does it cost?

T4's last unproven acceptance criterion (`docs/PLAN-DISK-TIER.md`): *a switch after
an unload restores from disk instead of returning an empty conversation*. This run
answers it on the fork build (`0.4.1-dev`, build 11193, commit `833cde99b`; sha in
`results.json`), model `Trinity-Nano-Preview-Q4_K_M.gguf`, `--slot-save-path`,
`--ctx-checkpoints 1`, `--cache-ram 0`, `--parallel 1`, `-c 8192`,
`--sleep-idle-seconds 30`, salt header on completions **and** on save/erase/restore.

Script: `dev/measure-unload-restore.py`; every number below is a field of
`results.json`, and `warm_after_unload`, `cold_without_the_file` and `conclusion`
are computed by that script from the recorded timings — none is written by hand.
Four engines, one per arm, each with an empty slot directory, launched under
`nice -n 10`.

**The release is observed, never assumed.** The harness waits, with a deadline, for
the two stderr lines the supervisor itself watches
(`crates/kalsa-supervisor/src/child.rs:42-43`): `server is entering sleeping
state` and `server is exiting sleeping state`. All four arms produced both lines.

## 1. The verdict, and the numbers under it

`warm_after_unload = true`, `cold_without_the_file = true`, and the derived
conclusion reads:

> after a real release the saved chats came back warm and the no-file controls
> stayed cold, so the warmth travelled with the file. Numbers: 600 tokens: saved
> cache_n=595/600 n_restored=615 restore=4219.83ms (resident 5.97ms, reload est.
> 4161.0ms), control cache_n=0/600; 1900 tokens: saved cache_n=1895/1900
> n_restored=1915 restore=4278.85ms (resident 19.75ms, reload est. 4203.5ms),
> control cache_n=0/1900

Second send of the same chat, after the release was announced (`n_predict=16` in
every send):

| chat | arm | `cache_n` | `prompt_n` | `prompt_ms` | wall |
|---|---|---|---|---|---|
| 600 | cold baseline after boot | 0 | 600 | 3 206.7 | 3 446.0 ms |
| 600 | **saved**: file + restore | **595** | 5 | **58.0** | 296.4 ms |
| 600 | **control**: no file | **0** | 600 | 3 190.2 | 7 671.4 ms |
| 1 900 | cold baseline after boot | 0 | 1 900 | 14 933.2 | 15 256.3 ms |
| 1 900 | **saved**: file + restore | **1 895** | 5 | **89.4** | 414.0 ms |
| 1 900 | **control**: no file | **0** | 1 900 | 15 142.3 | 19 685.0 ms |

The saved arm reused 99.2 % and 99.7 % of the prompt from the slot; the control
reused nothing and re-evaluated the whole chat. The control's wall time also
carries the model reload, because the same wake happens there — it is the
`cache_n`/`prompt_n` columns that carry the verdict, not the walls.

## 2. The release, and what the restore costs

| arm | release line after last task | reload line | triggered by |
|---|---|---|---|
| saved 600 | 30.28 s | during the restore request | restore |
| control 600 | 30.28 s | during the second send | completion |
| saved 1900 | 30.29 s | during the restore request | restore |
| control 1900 | 30.30 s | during the second send | completion |

30 s is the configured `--sleep-idle-seconds`; the line arrived within 0.3 s of it
in every arm, so the unload was real and inside the run's own clock.

The plan says a restore after a genuine unload is *restore **plus** a model load*,
and the UI must say so. The split, per arm:

| chat | file | save | restore, model resident | restore after release | reload line at | ≈ model reload | `n_restored` / `n_read` |
|---|---|---|---|---|---|---|---|
| 600 | 32 379 628 B | 33.5 ms | 5.97 ms | **4 219.8 ms** | +52.9 ms | **4 161.0 ms** | 615 / 32 379 628 |
| 1 900 | 101 737 228 B | 86.6 ms | 19.75 ms | **4 278.9 ms** | +55.6 ms | **4 203.5 ms** | 1 915 / 101 737 228 |

The reload estimate is `restore wall − time to the reload line − the same restore
with the model resident`. The line prints *before* `load_model()`
(`tools/server/server-context.cpp:969-970`), so everything after it is load plus
the file restore, and the resident baseline prices the file restore at 6–20 ms.
The engine's own `restore_ms` inside the post-release response — the restore task,
model already back — is 10.9 ms (600 tokens) and 16.0 ms (1 900).
**Of the ~4.2 s a user waits, ~4.16–4.20 s is the model coming back; the disk
round trip itself is milliseconds.** That is the sentence T4 says the interface
owes the user, now with a number on it.

## 3. Why the warmth is the file's (from the engine's own log)

Raw logs are gitignored and never committed; the named lines are quoted:

- save: `appended 1 context checkpoint(s) (12.994 MiB)`;
- after the wake, the restore task reads the file: `restored 1 context checkpoint(s)
  from '/tmp/kalsa-unload-restore/saved_600/slots/chat600.bin'` — and the response
  carried `n_read = 32 379 628`, the full file;
- the control instead got `different cache namespace - clearing cached prompt`,
  `clearing prompt with 0 tokens`, `cached n_tokens = 0`, then evaluated all 600
  tokens in 3.19 s.

Nothing RAM-side could have carried the state: the reload runs `load_model()`,
which does `slots.clear()`
(`tools/server/server-context.cpp:1243`) — tokens, context checkpoints and the
namespace stamp are destroyed and the slots rebuilt — and the restore re-stamps
the namespace from the caller's header (`:2879-2884`). Both arms slept under the
same observed release; the file plus the restore is the only difference between
them, and only the arm that had them came back warm.

## 4. What this does not say

- **These are measurements of one machine, not performance promises.** Walls come
  from a run at `nice -n 10` with a 1-minute load average between 4.2 and 5.7 (other work
  was on the box; `loadavg` rides every send in `results.json`). Token counts and
  reuse fractions are the load-invariant part; milliseconds are not.
- One run per point (`n=1`), one model, one context size, `--sleep-idle-seconds 30`
  rather than the shipped 300. The reload estimate rests on a single resident
  baseline per size.
- This drove the **engine** with the door's request shapes (salt on every slot
  action, exactly as `slot_action` in `measure-slot-restore.py` sends them). It did
  not drive the app's door or the T4 idle-save timer: the panel's own sentence and
  the timer's cadence remain app-side tests, not results of this run.
- The control's coldness is measured; *why* there is nothing to re-apply is read
  from the engine's source and log (`slots.clear()` on reload), not separately
  ablated — no no-file arm can carry a namespace stamp across a reload, because
  the reload destroys the stamp with the slot.
- `provenance.engine_commits` is empty: the boot line says `build 11193
  (833cde99b)` without the word "commit", which the scan keys on. The commit is in
  `provenance.engine_version`.
