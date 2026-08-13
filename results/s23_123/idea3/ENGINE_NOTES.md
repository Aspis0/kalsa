# Idea3 — is disk session save possible today?

Date: 2026-08-13. Sources: `BigMoeOnEdge/core/src/engine/session.cpp`,
`BigMoeOnEdge/core/include/bmoe/session.h`, `BigMoeOnEdge/cli/main.cpp`,
`BigMoeOnEdge/docs/session.md`, `third_party/llama.cpp/include/llama.h`,
`third_party/llama.cpp/src/llama-context.cpp`,
`third_party/llama.cpp/src/llama-memory-hybrid.cpp`,
`third_party/llama.cpp/src/llama-arch.cpp`.
Device `--help` / `BMOE_DONE` numbers are filled from the S23 cell E pull
(`idea3/help_save_load_cache.txt`, `idea3/kv_fields.json`). Do not treat
this file as a measurement of disk I/O — no save file was written.

## Verdict

**Not through bmoe today.** llama.cpp can serialize this hybrid (attn KV +
recurrent/SSM) to a session file. `bmoe-cli` / `Session` never call that
API. `--session` is in-RAM only: one process, JSON turns, expert LRU stays
warm. There is no `--save` / `--load-session` / `--save-kv` flag.

`--cache-mb` in `--help` is the **expert LRU**, not a KV persist path.

## What session.cpp actually keeps

### Recurrent rewind (~701)

```701:704:BigMoeOnEdge/core/src/engine/session.cpp
    // Rejecting a draft means rewinding the KV to the last accepted position. With recurrent-state
    // snapshots the rewind is a cheap restore; without them llama.cpp has to fall back to replaying
    // the sequence, which would hand back exactly the decode the speculation just saved.
    if (cfg.spec.enabled()) cparams.n_rs_seq = (uint32_t) cfg.spec.draft_max;
```

This is **speculation rollback**, not disk save. `n_rs_seq` asks llama.cpp
for recurrent-state snapshots so a rejected draft can restore SSM state.
The MTP draft context forces `n_rs_seq = 0` (`session.cpp:717`) — nothing
is rolled back on the draft side.

`llm_arch_supports_rs_rollback` (`llama-arch.cpp:966-973`) returns true
for `LLM_ARCH_QWEN35` and `LLM_ARCH_QWEN35MOE`. So on this 35B the clamp
at `llama-context.cpp:80-83` does **not** zero `n_rs_seq`. Spec rewind
is the in-RAM path that exists.

### KV reuse is chat-only

```1167:1173:BigMoeOnEdge/core/src/engine/session.cpp
    // Reuse the KV prefix already decoded from earlier turns (chat mode only)
    size_t n_common = 0;
    if (chat_on && !im.kv_tokens.empty()) {
```

`--session` does not set `--chatml`. Without `chat_on`, `n_common` stays 0
and the second `clear_kv=false` turn prefills the whole prompt again
(`docs/session.md`). `BMOE_DONE` emits `n_prompt` and `n_past`, not
`n_common`. Accounting (`session.cpp:1629-1630`):

- `n_prompt` = tokens actually prefilled this turn (`n_prompt - n_common`)
- `n_past` = `kv_tokens.size()` if `chat_on`, else `n_prompt + n_gen`

Hybrid `seq_rm` (`llama-memory-hybrid.cpp:143-149`) tries the **recurrent**
cache first and can refuse a partial remove; session then clears the whole
KV (`session.cpp:1180-1182`). That is why a mid-sequence rewind is not a
safe typeahead primitive on this model.

## llama.h save/load — present, unused

```821:846:BigMoeOnEdge/third_party/llama.cpp/include/llama.h
    LLAMA_API bool llama_state_load_file(...);
    LLAMA_API bool llama_state_save_file(...);
```

(Deprecated aliases: `llama_load_session_file` / `llama_save_session_file`.)

`llama_context::state_save_file` (`llama-context.cpp:2999-3013`) writes
magic + token list + `state_write_data`. That calls
`memory->state_write(io)`. For Qwen3.6 hybrid memory:

```190:194:BigMoeOnEdge/third_party/llama.cpp/src/llama-memory-hybrid.cpp
void llama_memory_hybrid::state_write(...) {
    if ((flags & LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY) == 0)
        mem_attn->state_write(io, seq_id, flags);
    mem_recr->state_write(io, seq_id, flags);
}
```

So a **llama.cpp** session file on this arch is attn KV + recurrent/SSM.
That is enough to restore the transformer memory. It is **not** wired.

Repo grep of `BigMoeOnEdge/core` and `cli/`: **zero** calls to
`llama_state_save_file` / `llama_state_load_file` /
`llama_save_session_file` / `llama_load_session_file`.
`Session` has no save/load method (`session.h`). `print_usage` in
`cli/main.cpp` documents `--session`, `--cache-mb`, `--progress` — no
save/load path.

## What a disk save would still miss

Even if someone called `llama_state_save_file` tomorrow:

1. **Expert LRU is not in the llama state.** After load you re-pay the
   cache warm ramp (`docs/session.md`). Disk KV does not replace
   `--session` for flash MoE.
2. **bmoe `kv_tokens` / `chat_history` are engine-side.** A raw llama
   file does not restore chat-mode prefix match.
3. **Spec `n_rs_seq` snapshots** are for in-process draft reject, not
   the session file format.

## Device `--help` and cell E (S23, 2026-08-13)

Raw: `idea3/E/help.txt`, `idea3/E/help_save_load_cache.txt`,
`idea3/E/kv_fields.json`, `idea3/E/stdout.txt`.

`--help` rc=0. `grep -niE save|load|cache` → 18 hits. All are expert-cache
/ mmap / `--load-all` / `--session` (stdin JSON). **No** `--save`,
`--load-session`, `--save-session`, `--load-kv`, `--save-kv`.
`S23_123.master.log`: `E help has no --save/--load session flag (cache-* is
the expert LRU, not KV persist)`.

`--session` two JSON turns, no `--chatml` (`think_ctl=template` on READY,
`chat_on` stays false):

| id | tokens | n_prompt | n_past | prefill_s | text |
|---:|---:|---:|---:|---:|---|
| 1 | 0 | 75 | 75 | 14.791 | empty (first token EOG) |
| 2 | 16 | 100 | 116 | 18.834 | `<think>…` + trade-off sentence |

`n_common` is **absent** from `BMOE_DONE` (`n_common_in_schema=false`,
grep `[]`). Turn 2 `n_prompt=100` is a full re-prefill of the longer
prompt, not a delta. `n_past=116` matches the `!chat_on` formula
`n_prompt + n_gen` (`session.cpp:1630`), not a stacked KV size.

Disk save: **not possible today via this binary.** llama.cpp can write
hybrid attn+recurrent state; bmoe never calls it.
