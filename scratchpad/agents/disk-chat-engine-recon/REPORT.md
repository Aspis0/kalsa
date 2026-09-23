# Multi-slot behaviour of the published engine (kalsa-server v1.1.0) - desk recon

Scope: read-only map of what `tools/server/` does with slots, per-slot context and per-slot
memory. No engine edits, no app edits, no builds. Every finding carries a permalink at the exact
commit read, the quoted lines it rests on, and one of the labels
**READ IN THE CODE** / **INFERRED** / **NEEDS MEASUREMENT**.

Answers are given for the **published** engine: tag `kalsa-server-v1.1.0` =
commit `2a290390d67311b580ef398fd545e6d060b39897`.

---

## 1. The commit I read, and how I verified it

**READ IN THE CODE** - the tag is annotated and points at that commit:

```
$ git rev-parse kalsa-server-v1.1.0^{commit}
2a290390d67311b580ef398fd545e6d060b39897
$ git cat-file -t kalsa-server-v1.1.0
tag
$ git cat-file -p kalsa-server-v1.1.0
object 2a290390d67311b580ef398fd545e6d060b39897
type commit
tag kalsa-server-v1.1.0
tagger Marco Gualtieri ... 1789969467 -0400
```

and the tag message is the X-Kalsa-Slot release note:

> Slot inlet: the private X-Kalsa-Slot request header pins a request to a server slot, with the
> header taking precedence over the body id_slot and an invalid value falling back without a 400.

```
$ git log -1 --format='%H %ci %s' 2a290390d
2a290390d67311b580ef398fd545e6d060b39897 2026-09-21 00:47:02 -0400 ci : drop the Metal packaging work from the kalsa-server release path
```

### Working method (and one trap worth recording)

The local checkout is **not** at the published commit:

```
$ git log -1 --format='%H %s'
5c96b18ddca8c4adefce920f811232be4836f327 server : keep the cache namespace across a context shift
$ git diff --stat 2a290390d HEAD -- tools/server/ common/
 tools/server/server-context.cpp            | 14 +++++++++++
 tools/server/tests/unit/test_cache_salt.py | 38 +++++++++++++++++++++++++++++-
 tools/server/tests/unit/test_slot_save.py  | 11 +++++++++
```

`server-context.cpp` differs between the published commit and local `HEAD`, so reading the working
tree would give the wrong line numbers. I read the published tree instead, extracted read-only to
`/tmp/kalsa-pub` (nothing in the repo was touched; `git status` shows only two pre-existing
untracked files, `CMakeUserPresets.json` and `pkg-snapdragon/`):

```
git archive 2a290390d tools/server common src include | tar -x -C /tmp/kalsa-pub
```

All line numbers below are line numbers **at `2a290390d`**, and the permalinks resolve to
`https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/<path>#L<line>`.

### Correction to the task brief: there is no `tools/server/server-slot.h`

**READ IN THE CODE** - the file does not exist at the published commit, nor at `HEAD`, nor at the
commit the phone pins:

```
$ git ls-tree -r --name-only 2a290390d -- tools/server/ | grep -i slot
tools/server/tests/unit/test_slot_header.py
tools/server/tests/unit/test_slot_save.py
```

`struct server_slot` lives in `server-context.cpp` itself, inside the private implementation unit
(`struct server_context_impl`), not in a header:
[server-context.cpp:244](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L244)
for `struct server_slot`,
[server-context.cpp:116](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L116)
for `struct server_batch`,
[server-context.cpp:838](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L838)
for `struct server_context_impl`.
`server-task.h` is a real header and holds `server_prompt` / `server_prompt_cache`.

### The phone's pinned engine, for reference

**READ IN THE CODE** - the app's pin (`kalsa.rn#0288dc27` -> engine `4ccef2f85`) is an ancestor of
the published commit, 8 commits back:

```
$ git merge-base --is-ancestor 4ccef2f85 2a290390d && echo YES
YES
$ git log --oneline 4ccef2f85..2a290390d
2a290390d ci : drop the Metal packaging work from the kalsa-server release path
ac9a09dc6 server : guard slot actions and prove the inlet adds no exposure
c71977809 ci : ship precompiled Metal libraries in the kalsa-server archive
c2ebfc164 server : add X-Kalsa-Slot header inlet
916b8f0bc ci(server): decide the R2 existence check with head-object
f404d9180 ci(server): fix the R2 emptiness check to use KeyCount
635ea0ed2 ci : publish the verified engine to R2 instead of a GitHub release
3a4d5143e ci : make the kalsa-server release self-contained
```

So the phone's engine has **no** `X-Kalsa-Slot` inlet at all; that inlet arrives in `c2ebfc164`, and
`ac9a09dc6` is the hardening commit the tag message refers to. Anything in this report about the
inlet applies only to `2a290390d`.

### What is already measured elsewhere, and is cited rather than re-measured

From `~/Projects/kalsa-moe-experiments/scratchpad/agents/slot-save-restore-measure/REPORT.md`
(same engine, same Mac, host-only):

- one ~16k-token chat: **473 MiB** saved with the default 32 checkpoints, **407 MiB** with
  `--ctx-checkpoints 1`, **319 MiB** with `--ctx-checkpoints 0`; save median **0.55 s**, restore
  median **0.081 s**; `--ctx-checkpoints 1` is the right default; `0` is not a resume.
- the recorded trap: **`--slots` is not the slot count** - it only exposes the `/slots`
  monitoring endpoint and is already the default. The slot count is `-np/--parallel N`, and what
  enables save/restore is `--slot-save-path`.
- engine startup log for `-c 16384 -np 1`: `n_ctx = 16384`, `n_batch = 2048`,
  `llama_kv_cache: size = 224.00 MiB (16384 cells, 14 layers, K (f16) 112.00 MiB, V (f16) 112.00 MiB)`,
  `llama_kv_cache_iswa: creating SWA KV cache, size = 2560 cells ... 105.00 MiB (42 layers)`,
  `srv load_model: initializing, n_slots = 1, n_ctx_slot = 16384, kv_unified = 'false'`.

I do not redo any of that. I also do not benchmark a phone: there is no device work in this brief.

---

## 2. Q1 - two streams at once: what the engine actually does

### 2.1 What `-np` really is

**READ IN THE CODE.**

- `-np/--parallel N` sets `params.n_parallel`. Default is `-1`:
  [common/arg.cpp:1400](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/common/arg.cpp#L1400)
  ```cpp
  params.n_parallel = -1;     // auto by default
  ```
  and the flag's own help text, from the same file
  ([common/arg.cpp:2541-2547](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/common/arg.cpp#L2541)):
  `"number of server slots (default: %d, -1 = auto)"`.
- `-1` is resolved at startup to **4 slots and a unified KV cache**
  ([server.cpp:152-157](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server.cpp#L152)):
  ```cpp
  if (params.n_parallel < 0) {
      SRV_TRC("%s", "n_parallel is set to auto, using n_parallel = 4 and kv_unified = true\n");

      params.n_parallel = 4;
      params.kv_unified = true;
  }
  ```
- `n_parallel` is three things at once. It is the slot count
  ([server-context.cpp:1259-1261](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1259)):
  ```cpp
  for (int i = 0; i < params_base.n_parallel; i++) {
      slots.emplace_back();
  }
  ```
  it is the number of sequences in the `llama_context`
  ([common/common.cpp:1735](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/common/common.cpp#L1735)):
  ```cpp
  cparams.n_seq_max         = params.n_parallel;
  ```
  and it is the divisor of `n_ctx` when the KV cache is not unified (2.2). It is also the batch
  sizing floor ([server-context.cpp:1353](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1353)):
  ```cpp
  batch.init(std::max(n_batch, params_base.n_parallel), n_embd);
  ```
  and it is reported as `total_slots` in `/props`
  ([server-context.cpp:4929](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L4929)).
- **The slot index is the KV sequence id.** Every batch entry is tagged with `{ t.id_slot }` as its
  sequence
  ([server-context.cpp:212](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L212)):
  ```cpp
  common_batch_add(batch, t.token, t.pos, { t.id_slot }, t.output);
  ```
  and the slot's memory calls pass `slot.id` as the sequence id
  ([server-context.cpp:339-345](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L339),
  `void prompt_clear() { ... mem.seq_rm(id, -1, -1); ... }`). `slot.id` is assigned as `slot.id = i`
  ([server-context.cpp:1295](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1295)).
  So "slot N" and "KV sequence N" are the same thing; there is no indirection.

The recorded trap is confirmed against the code: `--slots` is unrelated to the count. It is a
monitoring-endpoint switch (`get_slots` handler registered by default) and the slot count is
`n_parallel` only.

### 2.2 One `n_ctx`, split or pooled - the arithmetic

**READ IN THE CODE**, in `src/llama-context.cpp`, which is where `n_ctx` becomes a per-sequence
number
([llama-context.cpp:289-305](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/src/llama-context.cpp#L289)):

```cpp
cparams.n_ctx = GGML_PAD(cparams.n_ctx, 256);

if (cparams.kv_unified) {
    cparams.n_ctx_seq = cparams.n_ctx;
} else {
    cparams.n_ctx_seq = cparams.n_ctx / cparams.n_seq_max;
    cparams.n_ctx_seq = GGML_PAD(cparams.n_ctx_seq, 256);

    if (cparams.n_ctx_seq == 0) {
        throw std::runtime_error("n_ctx_seq == 0");
    }

    if (cparams.n_ctx != cparams.n_ctx_seq * cparams.n_seq_max) {
        cparams.n_ctx =  cparams.n_ctx_seq * cparams.n_seq_max;
        LLAMA_LOG_WARN("%s: n_ctx is not divisible by n_seq_max - rounding down to %u\n", __func__, cparams.n_ctx);
    }
}
```

The server's per-slot window is that number, optionally capped
([server-context.cpp:4267-4276](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L4267)):

```cpp
// context size of a single slot, capped by --kv-unified-per-slot and by the training context of the model
int n_ctx_slot() const {
    int res = llama_n_ctx_seq(ctx_tgt);

    if (params_base.kv_unified_per_slot > 0) {
        res = std::min(res, params_base.kv_unified_per_slot);
    }

    return std::min(res, llama_model_n_ctx_train(model_tgt));
}
```

and it is written onto every slot at load
([server-context.cpp:1300](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1300),
`slot.n_ctx = n_ctx_slot();`), then reported per slot by `/slots`
([server-context.cpp:695-696](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L695), `{"id", id}, {"n_ctx", n_ctx},`).

So the answer to "is one `n_ctx` shared" is: **it depends on `--kv-unified`, and the app can pick.**

- `kv_unified = false` (the default when `-np` is given explicitly): `n_ctx` is **partitioned**.
  `n_ctx_seq = n_ctx / n_parallel`. Two slots at `-c 16384` get **8192 tokens each**.
- `kv_unified = true` (forced when `n_parallel` is left at `-1`, or passed with `--kv-unified`):
  `n_ctx_seq = n_ctx`, so each slot *may* grow to `-c`, but all slots **share** one pool of
  `n_ctx` cells and compete for them.

The measured startup log in the sibling report (`-c 16384 -np 1`, `kv_unified = 'false'`,
`n_ctx_slot = 16384`, `llama_kv_cache: size = 224.00 MiB (16384 cells, 14 layers ...)`,
`llama_kv_cache_iswa: creating SWA KV cache, size = 2560 cells ... 105.00 MiB (42 layers)`) is the
`n_ctx_seq = n_ctx / 1` case, where both modes coincide.

### 2.3 KV bytes per token, settled exactly

The measured KV sizes in the sibling report are reproduced exactly by the model's own metadata plus
the cache geometry in the code, so the arithmetic can be stated rather than guessed.

Model metadata, read directly from the published model file's GGUF header (read-only header parse,
`/tmp/kalsa-pub/gguf_meta.py`; no server was run, no build):

```
gguf version 3 n_tensors 1057 n_kv 46
afmoe.attention.head_count    = 8
afmoe.attention.head_count_kv = 2
afmoe.attention.key_length    = 128
afmoe.attention.value_length  = 128
afmoe.attention.sliding_window = 2048
afmoe.block_count             = 56
afmoe.context_length          = 131072
afmoe.rope.dimension_count    = 128
```

Layers: `afmoe` loads `afmoe.attention.sliding_window` and then
([models/afmoe.cpp:13-22](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/src/models/afmoe.cpp#L13)):

```cpp
// Set up interleaved sliding window attention (ISWA)
// Pattern: 3 sliding - 1 full (global_attn_every_n_layers = 4)
if (hparams.n_swa > 0) {
    hparams.swa_type = LLAMA_SWA_TYPE_STANDARD;
    uint32_t swa_period = 4;
    ml.get_key_or_arr(LLM_KV_ATTENTION_SLIDING_WINDOW_PATTERN, swa_period, false);
    hparams.set_swa_pattern(swa_period);
```

and `set_swa_pattern` with the default (non-dense-first) branch marks SWA as
`il % n_pattern < (n_pattern - 1)`
([llama-hparams.cpp:14-16](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/src/llama-hparams.cpp#L14)).
With 56 layers and period 4, layers `il % 4 == 3` are **full attention**: 14 of 56. The other 42 are
SWA. That matches the measured `14 layers` / `42 layers` split in the startup log exactly.

Cells and bytes, with `n_embd_k_gqa = n_embd_v_gqa = head_count_kv * key_length = 2 * 128 = 256`
and f16 K/V:

```
per layer, per cell        = (256 + 256) * 2 = 1024 B
full-attention (14 layers) = 14 * 1024 = 14336 B per cell
SWA          (42 layers)   = 42 * 1024 = 43008 B per cell
16384 * 14336 = 234,881,024 B = 224.00 MiB   (measured: 224.00 MiB)  <- exact
 2560 * 43008 = 110,100,480 B = 105.00 MiB   (measured: 105.00 MiB)  <- exact
```

Both checks land on the byte. Three consequences worth stating because they are not obvious:

1. **A context token costs 56 KiB = 57344 B of KV** across all 56 layers, but only the
   full-attention half grows with position: **14336 B of it per token, unbounded**; the other
   43008 B per token lives in a bounded ring.
2. The SWA component's cell count is **not** `n_swa`. It is
   ([llama-kv-cache-iswa.cpp:84](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/src/llama-kv-cache-iswa.cpp#L84)):
   ```cpp
   uint32_t size_swa = GGML_PAD(std::min(size_base, hparams.n_swa*(unified ? n_seq_max : 1) + n_ubatch), 256);
   ```
   With `n_swa = 2048` and the default `n_ubatch = 512` this is `2048 + 512 = 2560`, padded to 256
   -> 2560 cells. So the sibling report's phrasing "`n_swa = 2560`" is off: the model's sliding
   window is **2048**; 2560 is `n_swa + n_ubatch`. The measurement was right, the label was wrong.
3. Note `unified ? n_seq_max : 1` in that expression: **the unified SWA pool is one shared ring sized
   for `n_seq_max` windows**, while the non-unified SWA caches are `n_seq_max` separate rings each
   sized for one window. That is why the two modes do not cost the same.

Bit width of the tensors, for completeness
([llama-kv-cache.cpp:253-254](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/src/llama-kv-cache.cpp#L253)):
```cpp
ggml_tensor * k = has_k ? ggml_new_tensor_3d(ctx, type_k, n_embd_k_gqa, kv_size, n_stream) : nullptr;
ggml_tensor * v = has_v ? ggml_new_tensor_3d(ctx, type_v, n_embd_v_gqa, kv_size, n_stream) : nullptr;
```
with
([llama-kv-cache.cpp:88](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/src/llama-kv-cache.cpp#L88))
`n_stream = unified ? 1 : n_seq_max`. The `n_stream` axis is what makes non-unified memory scale
with slot count.

### 2.4 The cost table for this model (derived, one line of arithmetic each)

**INFERRED** from the code paths in 2.2 and 2.3 plus the read metadata. The `-c 16384 -np 1` row is
**READ IN THE CODE + matches the measured log byte for byte**; every other row is arithmetic that no
one has run yet (see section 5). `PAD(x,256)` = round up to the next multiple of 256.

| flags | `n_ctx_seq` = per-slot window | base cells | SWA cells | base MiB | SWA MiB | **total KV** |
|---|---|---|---|---|---|---|
| `-c 16384 -np 1` (measured) | 16384 | 16384 | 2560 | 224.0 | 105.0 | **329.0** |
| `-c 16384 -np 2` | **8192** | 16384 | 5120 | 224.0 | 210.0 | **434.0** |
| `-c 16384 -np 4` | **4096** | 16384 | 10240 | 224.0 | 420.0 | **644.0** |
| `-c 32768 -np 2` | 16384 | 32768 | 5120 | 448.0 | 210.0 | **658.0** |
| `-c 16384 -np 2 --kv-unified` | 16384 (shared) | 16384 | 4608 | 224.0 | 189.0 | **413.0** |
| `-c 16384 -np 4 --kv-unified` | 16384 (shared) | 16384 | 8704 | 224.0 | 357.0 | **581.0** |
| default auto (`-np` unset, `-c` unset) | not a constant - see the note below | - | - | - | - | **fit-sized, >= 7.0 GiB before shrinking** |

Reading of the table:

- **Going from 1 to 2 slots at a fixed `-c 16384` halves each slot's window to 8192** and adds
  105.0 MiB of KV (the second SWA ring). The full-attention pool does not grow; the window shrinks.
- **Giving two slots 16k each needs `-c 32768` and 658 MiB of KV**, i.e. the second 16k stream costs
  roughly another full 329 MiB.
- Unified is *cheaper* than partitioned at the same `-c` (413 vs 434 MiB at 2 slots) because the SWA
  ring is pooled, but the per-slot window is then only a *promise*, not a reservation: two slots
  cannot each hold 16384 tokens at the same time.
- The auto default (`n_parallel` unset) is **not a fixed size**. `--fit` is on by default
  ([common/common.h:476](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/common/common.h#L476),
  `bool fit_params = true;` with `fit_params_min_ctx = 4096`), and when `-c` is unset it starts the
  measurement at the **maximum** the model allows and then shrinks to fit free memory
  ([common/fit.cpp:267-274](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/common/fit.cpp#L267)):
  ```cpp
  const uint32_t n_ctx_max       = (uint32_t) std::min<uint64_t>(uint64_t(hp_nct)    * n_seq_max, UINT32_MAX);
  const uint32_t n_ctx_min_total = (uint32_t) std::min<uint64_t>(uint64_t(n_ctx_min) * n_streams, UINT32_MAX);

  // llama_context would use only hp_nct in total for n_ctx == 0, resolve the context before measuring anything else:
  if (n_ctx_auto) {
      cparams->n_ctx = n_ctx_max;
  ```
  So with nothing passed on this model the starting point is `n_ctx_train * n_seq_max = 131072 * 4 = 524288`
  cells (which alone is `524288 * 14336 = 7.0 GiB` of base KV plus 357 MiB of SWA ring), reduced to
  whatever fits but never below `4096 * n_streams`. **That is a flag an app must pass, not a default it
  can inherit**; the resulting size is machine-dependent and is not derivable from the source alone.
  `NEEDS MEASUREMENT` if the app ever ships without `-c`.

### 2.5 How two slots partition compute

**READ IN THE CODE.** There is exactly one decode path and one batch per step; `update_slots()` is
called from the single queue-processing thread, and `iterate()` is a plain loop
([server-context.cpp:2963-2973](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L2963)):

```cpp
void iterate(std::vector<server_slot> & slots, std::function<void(server_slot &)> callback) {
    for (auto & slot : slots) {
```

So there are no per-slot threads and no per-slot streams. The mechanism is **one fused batch per
server step**, filled in a fixed order:

1. **Generating slots' next tokens are added first**
   ([server-context.cpp:3332-3334](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3332)):
   ```cpp
   // update the batch with the sampled/drafted tokens
   iterate(generating, [&](server_slot & slot) {
       slot.handle_last_sampled_token(batch);
   });
   ```
   Because `handle_last_sampled_token` pushes exactly one token (plus any speculative draft), active
   generations always get their slot in the batch.
2. **Then pending prompt tokens fill the rest of the batch, in slot-id order**, up to `n_batch`
   ([server-context.cpp:3344-3347](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3344)):
   ```cpp
   if (params_base.cont_batching || batch.size() == 0) {
       bool add_ok = true; // false means the batch is full, skip remaining slots

       iterate(slots, [&](server_slot & slot) {
           if (!add_ok || batch.size() >= n_batch) {
               return; // batch is full, skip remaining slots
           }
   ```
   and the fill loop for one slot
   ([server-context.cpp:3764](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3764)):
   ```cpp
   while (slot.prompt.n_tokens() < slot.task->n_tokens() && batch.size() < n_batch) {
   ```
   The per-slot loop has **no share cap and no round robin**. A slot with a long prompt fills the
   batch to `n_batch` and the next slots in the iteration get literally nothing that step
   (`return`, not `break`, for the outer lambda - so it continues to the next slot, which then also
   returns because the batch is full).
3. **The fused batch is submitted in chunks of `n_batch` to one `llama_decode`**
   ([server-context.cpp:3103-3110](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3103)):
   ```cpp
   int32_t n_batch = llama_n_batch(ctx_tgt);
   for (int32_t off = 0; off < batch.size(); off = off_next) {
       const int32_t n_tokens = std::min(n_batch, batch.size() - off);
   ```
4. **The step then waits for compute when any token needs output**
   ([server-context.cpp:3919-3925](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3919)):
   ```cpp
   queue_tasks.yield_to_queue([&]() {
       ret = llama_decode(ctx_tgt, batch_view);
       if (ret == 0 && has_output) {
           llama_synchronize(ctx_tgt);
       }
   });
   ```
   `has_output` is true in every step where a generating slot's token needs its logits, which is
   every decode step. So consecutive steps of the two slots do **not** overlap in the compute
   stream: slot A's step N and slot B's step N are the same `llama_decode`, and there is no attempt
   to keep two graphs in flight.

**So the answer to "batched together, interleaved, or one blocks the other" is: batched together,
fused into one `llama_decode` per step, serialized by a synchronize at every step that produces
output, and not round-robined during prefill.**

Two further restrictions on batching, both `READ IN THE CODE`:

- Only slots that are *compatible with the batch* are admitted. `can_batch_with`
  ([server-context.cpp:454-459](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L454)):
  ```cpp
  bool can_batch_with(server_slot & other_slot) const {
      GGML_ASSERT(task);

      return task->type == other_slot.task->type
          && inp_embd.size() == other_slot.inp_embd.size()
          && are_lora_equal(lora, other_slot.lora);
  }
  ```
  A slot that fails this is skipped for that step
  ([server-context.cpp:3357](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3357),
  `if (slot_batched && !slot_batched->can_batch_with(slot)) { return; }`), so two slots with
  different LoRA adapters are effectively serialized step by step. Two plain completions with no
  adapters always share the batch.
- `n_batch` is clamped to `n_ctx` for causal models
  ([llama-context.cpp:246](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/src/llama-context.cpp#L246)):
  ```cpp
  cparams.n_batch = cparams.causal_attn ? std::min(cparams.n_ctx, params.n_batch) : params.n_batch;
  ```
  With `-c 16384` and the default `n_batch = 2048` this does not bind, but with a small `-c` it does.

### 2.6 What each stream concretely gives up

**READ IN THE CODE unless marked.**

1. **Window, in the non-unified case: half of `-c` per extra slot**, rounded down to a multiple of
   256 (2.2). Two chats at `-c 16384 -np 2` are two 8192-token windows. A request whose prompt is
   at or above the window is *rejected*, not truncated
   ([server-context.cpp:3444-3453](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3447)):
   ```cpp
   if (slot.task->n_tokens() >= slot.n_ctx) {
       send_error(slot,
                  string_format("request (%d tokens) exceeds the available context size (%d "
                                "tokens), try increasing it",
                                slot.task->n_tokens(), slot.n_ctx),
                  ERROR_TYPE_EXCEED_CONTEXT_SIZE);
   ```
   Once *inside* the window, growing past it triggers a **context shift** that discards half the
   live history, but only when `--context-shift` was passed: it defaults to **disabled**
   ([common/common.h:571](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/common/common.h#L571),
   `bool ctx_shift = false; // context shift on infinite text generation`), so by default a full
   window is a hard stop, not a silent truncation. The shift path itself is
   ([server-context.cpp:3176-3185](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3176)):
   ```cpp
   const int n_left    = slot.prompt.n_tokens() - n_keep;
   int       n_discard = slot.task->params.n_discard ? slot.task->params.n_discard : (n_left / 2);
   ...
   SLT_WRN(slot, "slot context shift, n_keep = %d, n_left = %d, n_discard = %d\n", n_keep, n_left, n_discard);
   ```
   With `n_keep` defaulting to the whole original prompt length, `n_discard = n_left/2` is half of
   the *generated* history, so an 8192-token window drops the middle of a long chat twice as early
   as a 16384-token window does. With the default `--no-context-shift`, the same event is instead a
   hard stop with `"context shift is disabled"`
   ([server-context.cpp:3142-3152](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3142))
   and a terminal `ERROR_TYPE_SERVER` on the stream. Which of the two the app gets is a flag, and
   the difference between them is the difference between a truncated chat and a broken one.
2. **Prefill progress: head-of-line blocking by slot id.** In the non-unified case each slot's
   prefill competes for the single `n_batch`-sized batch, and the lowest-id unfinished prefill wins.
   Two cold prefills at `-c 16384 -np 2` share one 2048-token batch per step, so wall-clock prefill
   is fully serialized in the best case (2048 tokens to slot 0, then 2048 to slot 1, ...) and
   potentially fully monopolized by slot 0 (see 2.5 step 2: nothing forces slot 0 to give up the
   batch). **Which of those two happens depends on the checkpoint breaks in the fill loop and must
   be measured.** `NEEDS MEASUREMENT`.
3. **Decode throughput: not halved, but not free either.** The two slots' decode steps are one
   `llama_decode` with two tokens. On a MoE model with a bandwidth-bound weight read, the marginal
   cost of the second token is small, so per-stream decode should stay well above half the
   single-stream rate. **The actual per-stream rate must be measured** (`NEEDS MEASUREMENT`); I will
   not quote a fraction derived from nothing. What the code settles is only that the two streams are
   served by one graph, not two.
4. **KV bytes: +105 MiB for the second slot's SWA ring at `-c 16384`** (2.3, 2.4), or +329 MiB if
   `-c` is doubled so the window is preserved.
5. **Routing risk when the app does not pin slots.** Without `id_slot`/`X-Kalsa-Slot`, a request is
   routed by longest-common-prefix similarity to an *idle* slot, and only if that fails, by LRU
   ([server-context.cpp:1573-1648](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1573)).
   A slot busy generating is skipped by the similarity scan
   ([server-context.cpp:1582-1585](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1582),
   `if (slot.is_processing()) { ... continue; }`). So with two concurrent chats and no pinning, the
   second chat's request lands on the *other* slot with an empty prompt, or on the LRU slot whose
   content is then saved to the RAM prompt cache and cleared
   ([server-context.cpp:1663-1671](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1663)).
   Pinning via `X-Kalsa-Slot` avoids all of this: a pinned busy slot makes the request *wait*
   ([server-context.cpp:2615-2619](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L2615),
   `if (slot->is_processing()) { ... queue_tasks.defer(std::move(task)); break; }`).

---

## 3. Q2 - do idle slots occupy RAM?

### 3.1 Where the memory is allocated: nowhere per slot

**READ IN THE CODE.** There is no per-slot KV allocation. The KV memory is created once, inside the
`llama_context`, and every slot points at it.

- The slot's memory object is a pair of context pointers, not a buffer
  ([common/common.cpp:1654-1657](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/common/common.cpp#L1654)):
  ```cpp
  void common_memory::init(llama_context * ctx_tgt, llama_context * ctx_dft) {
      this->ctx_tgt = ctx_tgt;
      this->ctx_dft = ctx_dft;
  }
  ```
- Initialising a slot only copies those pointers
  ([server-context.cpp:1295-1300](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1295)):
  ```cpp
  slot.id      = i;
  slot.ctx_tgt = ctx_tgt;
  slot.ctx_dft = ctx_dft;
  slot.mem.init(ctx_tgt, ctx_dft);
  slot.spec    = spec.get();
  slot.n_ctx   = n_ctx_slot();
  ```
- The real allocation happens when the `llama_context` is created
  ([src/llama-context.cpp:396](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/src/llama-context.cpp#L396)):
  ```cpp
  memory.reset(model.create_memory(params_mem, cparams));
  ```
  sized from `cparams.n_ctx_seq` and `cparams.n_seq_max` (2.2, 2.3). The tensors are allocated and
  cleared eagerly in the cache constructor, and the backend buffer size is logged
  ([llama-kv-cache.cpp:305-316](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/src/llama-kv-cache.cpp#L305)):
  ```cpp
  buf = ggml_backend_alloc_ctx_tensors_from_buft(ctx.get(), buft); // real buffer
  ...
  LLAMA_LOG_INFO("%s: %10s KV buffer size = %8.2f MiB\n", __func__, ggml_backend_buffer_name(buf), ggml_backend_buffer_get_size(buf)/1024.0/1024.0);

  ggml_backend_buffer_clear(buf, 0);
  ```

Three consequences, all **READ IN THE CODE**:

1. **Every configured slot's capacity is allocated at startup**, hit or miss. `-np 4` pays for four
   slots' worth of pool on load, even if only one chat is ever served. There is no lazy per-slot
   allocation path anywhere in `tools/server/`.
2. There is no "slot owns N bytes" object to free. The only per-slot state that can be released is
   the *live cells of its sequence* inside the shared pool, via `seq_rm`.
3. Because the pool is sized by `-c` and `-np` at load, **slot memory cannot be reclaimed to the
   OS**; it can only be re-assigned inside the pool.

### 3.2 Does an idle slot keep what it held? Yes

**READ IN THE CODE.** `release()` returns the slot to `SLOT_STATE_IDLE` and drops the task, but for a
normal (non-child) slot it does **not** touch the KV
([server-context.cpp:550-569](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L550)):

```cpp
void release() {
    if (is_processing()) {
        GGML_ASSERT(task);

        SLT_INF(*this, "stop processing: n_tokens = %d, truncated = %d\n", prompt.n_tokens(), truncated);

        t_last_used = ggml_time_us();

        state = SLOT_STATE_IDLE;

        // do not keep context of the child slots - the parent's context is enough
        if (task->is_child()) {
            prompt_clear();
        }

        callback_on_reset(*this);

        reset();

        callback_on_release(id);
    }
}
```

Note the asymmetry: *child* slots are cleared on release, normal slots are not. So the endpoint of a
chat leaves its tokens and its KV cells in place, and that is the intended behaviour (`/slots` keeps
reporting `n_prompt_tokens` on an idle slot precisely because of this).

Also note that `prompt.clear()` is **not** a free. Only `prompt_clear()` is
([server-context.cpp:339-345](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L339)):

```cpp
void prompt_clear() {
    SLT_TRC(*this, "clearing prompt with %zu tokens\n", prompt.tokens.size());

    mem.seq_rm(id, -1, -1);

    prompt.clear();
}
```

whereas `server_prompt::clear()` touches only bookkeeping
([server-task.h:577-581](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-task.h#L577)):

```cpp
void clear() {
    tokens.clear();
    checkpoints.clear();
    cache_salt.clear();
}
```

### 3.3 Bytes held by an idle slot, with geometry

**INFERRED** (arithmetic from 2.3 plus the measured anchors `224.00 MiB`, `105.00 MiB` in the
sibling report; the live-cell counts are the part not directly measured).

Live cells of a sequence with `N` tokens:

```
base cells (14 full-attention layers) : N                       (one cell per position)
ring cells (42 SWA layers)            : min(N, n_swa) = min(N, 2048)   live inside the 2560-cell ring
bytes/cell: 14336 (base), 43008 (SWA)
```

| idle slot holding | base | ring (live) | **live KV** | pool allocated for it at `-np 1` |
|---|---|---|---|---|
| 3,455-token chat | 47.2 MiB | 84.0 MiB | **131.2 MiB** | 329.0 MiB |
| 16,110-token chat | 220.2 MiB | 84.0 MiB | **304.2 MiB** | 329.0 MiB |
| a slot that never ran | 0 | 0 | **0** (but the pool is still allocated) | 329.0 MiB |

Sanity anchor: `16110 * 14336 = 230,952,960 B = 220.2 MiB` and the measured save file's state
payload for exactly that 16,110-token slot was `319,317,084 B` (304.5 MiB), which is the same
quantity plus the packed token list and padding. The two numbers agree to within 0.3 MiB, so the
geometry is sound rather than merely plausible.

At `-np 2` (each slot given an 8192-token window by `-c 16384`), the per-slot pool share is
`112.0 MiB base + 105.0 MiB ring = 217.0 MiB`, and two full 8192-token chats occupy
`2 * (8192*14336 + 2048*43008) = 2 * (117.4 + 84.0) = 402.8 MiB` of live cells out of the 434.0 MiB
allocated.

**On Apple unified memory this is system RAM**, which is the only reason the question has any teeth:
there is no separate VRAM to page out to.

### 3.4 What actually frees the KV of an idle slot

Every free path goes through `prompt_clear()` -> `seq_rm(id, -1, -1)`. The complete list of call
sites at this commit ([grep of `prompt_clear()`](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp)):
lines 561, 1668, 1700, 2652, 2875, 2911, 3420, 3959. Grouped by trigger:

| trigger | frees? | code |
|---|---|---|
| `POST /slots/N?action=erase` | **yes**, that slot only | [server-context.cpp:2906-2911](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L2906): `slot->prompt_clear();` |
| new task, and slot selection falls back to LRU / low-similarity, and the incoming prompt is *not* recoverable from the RAM cache | **yes** | [server-context.cpp:1663-1671](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1663): `ret->prompt_save(*prompt_cache); if (!ret->prompt_load(*prompt_cache, task.tokens, task.params.cache_salt)) { ret->prompt_clear(); }` |
| new task, `--cache-idle-slots` **and** `--kv-unified` | **yes**, for every idle slot, on every new task | [server-context.cpp:2640-2653](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L2640) |
| `llama_decode` fails for lack of KV space, `--kv-unified` on | **yes**, one idle slot per retry | [server-context.cpp:1685-1710](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1685) |
| request's salt differs from the slot's | **yes** | [server-context.cpp:3418-3421](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3418) |
| context shift (discarded middle only) | partial | [server-context.cpp:3184-3185](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3184) |
| restore failure | **yes** | [server-context.cpp:2874-2875](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L2874) |
| child slot release | **yes** | [server-context.cpp:559-562](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L559) |
| abort / decode error paths | **yes**, all slots | [server-context.cpp:3959](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3959) |

Explicitly **not** a free path:

- **`POST /slots/N?action=save` does not clear.** It writes the file and returns
  ([server-context.cpp:2749-2819](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L2749));
  no `seq_rm` anywhere in the handler. Save and erase are separate calls.
- **`restore` does not free either**; it overwrites the sequence in place
  ([server-context.cpp:2868-2869](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L2868)):
  ```cpp
  slot->prompt.clear();
  slot->prompt.tokens = std::move(restored);
  ```
  after `llama_state_seq_load_file(...)` wrote the state into the KV. Note it uses `prompt.clear()`
  (bookkeeping) *before* the load and `prompt_clear()` (bookkeeping + `seq_rm`) only on the error
  path.
- **The `X-Kalsa-Slot` inlet does not free anything.** It computes an `id_slot` and assigns it to
  the task ([server-context.cpp:4635-4638](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L4635)):
  ```cpp
  task.id_slot = json_value(data, "id_slot", -1);
  if (id_slot_header >= 0) {
      task.id_slot = id_slot_header;
  }
  ```
  Everything that then frees memory is the *slot selection* path, not the inlet. So the inlet is
  memory-neutral by itself, but it decides which free path runs: pinning to slot 0 while slot 0 is
  idle defers the request if the slot is busy, and uses slot 0 directly if it is not
  ([server-context.cpp:1564-1571](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1564)).
  For the slot *action* routes the header cannot redirect at all: a valid header that disagrees with
  the URL slot is a 400
  ([server-context.cpp:5103-5109](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L5103)).
  Also note `get_slot_by_id` wraps out-of-range ids
  ([server-context.cpp:1532-1534](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1532)):
  ```cpp
  // note: allow id_slot to be out of bounds (wrap around)
  id_slot = id_slot % slots.size();
  ```
  so `X-Kalsa-Slot: 5` on a 2-slot server silently selects slot 1.

### 3.5 The second copy: the RAM prompt cache, on by default

**READ IN THE CODE.** This is the part that is easy to miss, because both defaults are on:

- `--cache-idle-slots` defaults to **enabled**
  ([common/common.h:629](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/common/common.h#L629)):
  ```cpp
  bool    cache_idle_slots    = true;  // save and clear idle slots upon starting a new task
  ```
  and `--cache-ram` defaults to **8192 MiB**
  ([common/common.h:633](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/common/common.h#L633)):
  ```cpp
  int32_t cache_ram_mib       = 8192;  // -1 = no limit, 0 - disable, 1 = 1 MiB, etc.
  ```
- On **every new task**, all idle slots are copied into that cache
  ([server-context.cpp:2640-2653](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L2640)):
  ```cpp
  if (params_base.cache_idle_slots) {
      for (auto & slot : slots) {
          if (!slot.is_processing()) {
              SLT_TRC(slot, "%s", "saving idle slot to prompt cache\n");

              if (slot.prompt_save(*prompt_cache)) {
                  SLT_DBG(slot, "%s", "__TEST_TAG_CACHE_IDLE_SLOT__\n");
                  prompt_cache->update();
              }

              if (params_base.kv_unified) {
                  // [TAG_IDLE_SLOT_CLEAR]
                  slot.prompt_clear();
              }
          }
      }
  }
  ```
  Note the condition on the *clearing* half only: **the RAM copy is taken in both KV modes, but the
  KV is released only under `--kv-unified`.** The code comments say why, and this is the crux of Q2
  ([server-context.cpp:1437-1442](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1437)):
  ```cpp
  if (params_base.kv_unified) {
      SRV_TRC("%s", "idle slots will be saved to prompt cache and cleared upon starting a new task\n");
  } else {
      // without a unified KV cache, clearing a slot frees no reusable room, so we only
      // publish a RAM-cache copy of idle slots (their KV stays in VRAM) [TAG_IDLE_SLOT_CLEAR]
      SRV_TRC("%s", "idle slots will be saved to prompt cache upon starting a new task\n");
  }
  ```
  So with the phone's style of launch (`-np N` given explicitly, hence `kv_unified = false`), an idle
  chat costs **KV in the pool *and* a full copy in RAM**. The clearing only happens in the unified
  mode, and when it happens the cost moves from the pool to RAM rather than disappearing.
- The RAM copy is a real copy of the sequence state plus its checkpoints
  ([server-context.cpp:304-325](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L304)):
  ```cpp
  const size_t cur_size_tgt = llama_state_seq_get_size_ext(ctx_tgt, id, LLAMA_STATE_SEQ_FLAGS_NONE);
  ...
  auto * cur = prompt_cache.alloc(prompt, cur_size_tgt, cur_size_dft);
  ...
  llama_state_seq_get_data_ext(ctx_tgt, cur->data.main.data(), cur_size_tgt, id, LLAMA_STATE_SEQ_FLAGS_NONE);
  ```
  and the entry's accounted size is state + checkpoints
  ([server-task.h:605-613](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-task.h#L605)):
  ```cpp
  size_t size() const {
      size_t res = data.size();

      for (const auto & ckpt : prompt.checkpoints) {
          res += ckpt.size();
      }

      return res;
  }
  ```
  Per the sibling report's measurements, a 16k chat is 495,529,160 B on disk (304.5 MiB state +
  168.0 MiB of checkpoints at the default checkpoint count). The RAM cache entry for that chat is
  therefore of the same order, ~470 MiB, against the 8 GiB default budget: **on the order of 17
  such chats fit before the oldest entry is evicted**
  ([server-task.cpp:1883-1894](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-task.cpp#L1883),
  `while (!states.empty() && size() > limit_size) { SRV_WRN(" - cache size limit reached, removing oldest entry ...`).
  Eviction is oldest-first and the pool itself is never shrunk.

### 3.6 The one path that frees KV without a request: `try_clear_idle_slots`

**READ IN THE CODE.** When `llama_decode` fails because it cannot find room in the KV cache, the
engine purges idle slots one at a time instead of only halving the batch
([server-context.cpp:3966-3975](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3966)):

```cpp
// retry with half the batch size to try to find a free slot in the KV cache
if (!try_clear_idle_slots()) {
    n_batch /= 2;
}

SRV_WRN("failed to find free space in the KV cache, retrying with smaller batch size, off = %d, n_batch = %d, ret = %d\n", off, n_batch, ret);
```

and the purge itself is **unified-only** and one slot per attempt
([server-context.cpp:1685-1710](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1685)):

```cpp
bool try_clear_idle_slots() {
    bool res = false;

    if (!params_base.kv_unified) {
        return res;
    }

    for (auto & slot : slots) {
        if (slot.is_processing()) {
            continue;
        }

        if (slot.prompt.n_tokens() > 0) {
            SRV_WRN("purging slot %d with %zu tokens\n", slot.id, slot.prompt.tokens.size());

            slot.prompt_clear();

            res = true;

            // clear slots one by one
            break;
        }
    }

    return res;
}
```

This is the concrete answer to "what frees an idle chat's KV without an explicit erase": **only in
unified mode, only under memory pressure, only one slot at a time, and it is announced with a
`purging slot N with M tokens` warning.** In non-unified mode the function returns immediately and
the engine just halves the batch. In this fork the "purging" is not accompanied by a prompt-cache
save, so a chat purged this way is *gone* rather than parked in RAM - unless `--cache-idle-slots`
already copied it at the previous new-task boundary.

Two practical corollaries of 3.4-3.6 for the desktop app:

- Under the app's explicit `-np N` (non-unified) launch, an idle chat's KV is held until either an
  erase, a namespace change, a slot re-selection that cannot recover the prompt from the RAM cache,
  or process exit. There is no idle-timeout reclaimer in the code.
- Under an auto/unified launch, the same chat's KV is released at the next new task, but its state is
  copied into RAM first, so the memory does not go away - it moves, and it stays until eviction or
  exit.

---

## 4. Q3 - a different context window per slot?

### 4.1 What the code permits: one window, computed once, copied to every slot

**READ IN THE CODE.** There is exactly one assignment to `slot.n_ctx` in the whole server, at load
time, from one function that takes no slot argument
([server-context.cpp:1300](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1300),
`slot.n_ctx = n_ctx_slot();`), verified by grep for every assignment:

```
$ grep -n '\.n_ctx *=\|->n_ctx *=' tools/server/server-context.cpp
1300:            slot.n_ctx   = n_ctx_slot();
2059:        res->n_ctx           = n_ctx;
```

Line 2059 is the error-response field (`res->n_ctx = n_ctx;` inside `send_error`, i.e. the *reporting*
of the window, used at
[server-task.cpp:1503-1506](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-task.cpp#L1503)
to fill `n_prompt_tokens` / `n_ctx` on an over-context error). So: one global `n_ctx`, one derived
`n_ctx_seq`, one per-slot window, identical for all slots.

`n_ctx_slot()` and the only per-slot-window knob, `--kv-unified-per-slot`, are quoted in 2.2. Note
what that knob is: a **uniform cap**, applied identically to every slot. There is also no per-request
window: the request schema's numeric context fields are
([server-schema.cpp:44-70](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-schema.cpp#L44)):

```
n_predict n_indent n_keep n_discard n_cmpl n_cache_reuse ...
```

and `n_ctx` is not among them. The full list of request-schema numerics at this commit is:
`sse_ping_interval n_predict n_indent n_keep n_discard n_cmpl n_cache_reuse t_max_prompt_ms
t_max_predict_ms top_k top_p min_p top_n_sigma xtc_probability xtc_threshold typical_p temperature
dynatemp_range dynatemp_exponent repeat_last_n repeat_penalty frequency_penalty presence_penalty
dry_multiplier dry_base dry_allowed_length dry_penalty_last_n mirostat mirostat_tau mirostat_eta
adaptive_target adaptive_decay seed n_probs min_keep speculative.* reasoning_budget_tokens`.
`id_slot` is not in the schema either; it is read ad hoc from the body
([server-context.cpp:4635](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L4635)).

**`causal_attn` is also a context-wide property, not a slot property.**
([llama-context.cpp:225-227](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/src/llama-context.cpp#L225)):
```cpp
cparams.causal_attn = hparams.causal_attn;
...
cparams.causal_attn = params.attention_type == LLAMA_ATTENTION_TYPE_CAUSAL;
```
and the only mutator flips it for the whole context
([llama-context.cpp:1203-1210](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/src/llama-context.cpp#L1203)):
```cpp
void llama_context::set_causal_attn(bool value) {
    LLAMA_LOG_DEBUG("%s: value = %d\n", __func__, value);

    if (cparams.causal_attn == value) {
        return;
    }

    cparams.causal_attn = value;
```
`tools/server/` never calls it (grep for `causal_attn` in `tools/server/*.cpp` returns nothing), so
in the published server it is fixed for the process by `--attention-type` and the model.

**Context shift is global; only its amount is per request.** `params.ctx_shift` defaults to `false`
([common/common.h:571](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/common/common.h#L571))
and is set by `--context-shift` / `--no-context-shift`
([common/arg.cpp:1736-1744](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/common/arg.cpp#L1736)).
`n_keep` and `n_discard` are per-request and only steer the discard window
([server-context.cpp:3168-3180](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3168)).

The one place where a *derived* per-slot pool budget exists is the `--kv-unified-per-slot` auto-sizing
([server.cpp:162-170](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server.cpp#L162)):
```cpp
const bool ctx_pool_auto_sized = params.kv_unified_per_slot > 0 &&
                                 params.n_ctx == 0 &&
                                 (uint32_t) params.fit_params_min_ctx != UINT32_MAX;

if (ctx_pool_auto_sized) {
    params.n_ctx = params.n_parallel * params.kv_unified_per_slot;
```
That sizes the pool as *slots x one cap*. It does not allow slot 0 to have 16k while slot 1 has 4k;
it makes both 8k if you pass `--kv-unified-per-slot 8192`.

**Answer to "one global n_ctx for the server, or a per-slot window": one global `n_ctx` for the
context, one derived per-slot window applied uniformly. There is no per-slot window in the published
engine.**

### 4.2 What breaks if two slots want different windows

Everything below is **READ IN THE CODE** for the mechanism, and **INFERRED** as a consequence,
because today the difference cannot be configured. Each item is a place where a per-slot window
*assumption* is baked in, i.e. the precise list a coder would have to touch.

1. **Rejection, and no rerouting.** Slot selection commits to a slot before the window is checked:
   `get_available_slot` picks by LCP similarity, then LRU
   ([server-context.cpp:1564-1650](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1564)),
   and only later does the launch reject an over-long prompt
   ([server-context.cpp:3444-3453](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3447)):
   ```cpp
   if (slot.task->n_tokens() >= slot.n_ctx) {
       send_error(slot,
                  string_format("request (%d tokens) exceeds the available context size (%d "
                                "tokens), try increasing it",
                                slot.task->n_tokens(), slot.n_ctx),
                  ERROR_TYPE_EXCEED_CONTEXT_SIZE);
       slot.release();
       return;
   }
   ```
   With equal windows, a request that exceeds the window cannot succeed on any slot, so rejecting is
   correct. With unequal windows it would be wrong: the request would fail on the slot the router
   happened to pick even though another slot had room. Note the comparison is `>=`, not `>`.
2. **Restore rejects across a window change.** The restore handler refuses a saved chat that does not
   fit the destination slot
   ([server-context.cpp:2860-2862](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L2860)):
   ```cpp
   if (restored.size() > (size_t) slot->n_ctx) {
       throw std::runtime_error("Restored prompt does not fit in the slot context");
   }
   ```
   A chat saved from a 16k slot cannot be restored into an 8k slot. This is a *desirable* check, but
   it means the on-disk chat state is bound to a window class, and the app must remember which class
   each file came from. The server does not record the window in the file: the check is against the
   *current* `slot->n_ctx`.
3. **Save/restore across a different pool geometry is not validated up front.** The sequence state
   file carries the cell count of the sequence as it was saved, and the loader feeds that count into
   a ubatch reservation
   ([llama-kv-cache.cpp:2418-2422](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/src/llama-kv-cache.cpp#L2418)):
   ```cpp
   llama_ubatch ubatch = balloc.ubatch_reserve(cell_count, 1);
   ```
   Restoring a state whose `cell_count` exceeds the destination cache fails as a
   `llama_state_seq_load_file` returning 0, which the server surfaces as
   `"No available space in KV cache or invalid slot save file"`
   ([server-context.cpp:2853-2856](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L2853)).
   Practical reading: a saved chat is only portable across server restarts that keep `-c` and `-np`
   (hence `n_ctx_seq`) the same, or that grow them. **NEEDS MEASUREMENT** for the exact boundary
   (does a 16k state load into an 8192-cell pool cleanly with an error, or partially?), see section 5.
4. **Prompt similarity is window-blind.** The LCP router compares tokens
   ([server-context.cpp:1601-1605](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1601)):
   ```cpp
   // fraction of the Longest Common Prefix length with respect to the input prompt length
   const size_t lcp_len = tokens.get_common_prefix(task.tokens);
   const float f_sim_cur = float(lcp_len) / task.tokens.size();
   ```
   so it can select a slot with a smaller window for a long prompt. Item 1 then fails the request.
   Pinning with `X-Kalsa-Slot` makes the choice deterministic but not window-aware either.
5. **Slot erasure is unaffected.** `action=erase` never consults `n_ctx`; it is
   `prompt_clear()` and a `n_erased` count (3.4).
6. **The SWA ring cannot differ per slot.** `size_swa` is computed once per cache from
   `cparams.n_ctx_seq` (2.3), and the per-stream views all come off one `n_stream`-wide tensor
   ([llama-kv-cache.cpp:262-266](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/src/llama-kv-cache.cpp#L262)):
   ```cpp
   for (uint32_t s = 0; s < n_stream; ++s) {
       k_stream.push_back(has_k ? ggml_view_2d(ctx, k, n_embd_k_gqa, kv_size, k->nb[1], s*k->nb[2]) : nullptr);
       v_stream.push_back(has_v ? ggml_view_2d(ctx, v, n_embd_v_gqa, kv_size, v->nb[1], s*v->nb[2]) : nullptr);
   }
   ```
   Every stream is a view of the same `kv_size`. A per-slot window would require either separate
   tensors per slot or a cell-allocation policy, neither of which exists.
7. **The prompt cache's token budget is global.** `limit_tokens` is the whole context
   ([server-context.cpp:1364](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1364),
   `prompt_cache = std::make_unique<server_prompt_cache>(params_base.cache_ram_mib, n_ctx);`).

### 4.3 Can the app-facing inlet ask for a window today?

**No. READ IN THE CODE.** The private port surface added by `c2ebfc164` is exactly two headers:

- `x-kalsa-cache-salt`
  ([server-context.cpp:4503-4522](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L4503))
- `x-kalsa-slot`
  ([server-context.cpp:4523-4566](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L4523)), documented in its own comment as
  "a SLOT SELECTOR, NOT AUTHENTICATION" with the contract that a malformed value "is treated as
  ABSENT".

Neither carries a size. The only way to change a window from the app side today is to change the
`-c`/`-np`/`--kv-unified`/`--kv-unified-per-slot` flags the server was launched with and restart it,
which changes the window for every slot at once.

Per-request knobs that *are* available and are relevant to the same problem:

- `n_keep` (with `-1` = "retain all tokens from the prompt")
  ([server-schema.cpp:54](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-schema.cpp#L54))
  and `n_discard` ("Number of tokens after n_keep that may be discarded when shifting context (0 =
  half context)", [server-schema.cpp:58](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-schema.cpp#L58)).
  These let one chat protect its system prompt while another lets it slide, but neither changes how
  many tokens fit.
- `cache_prompt` (bool) and `n_cache_reuse` (min chunk size for KV-shift reuse)
  ([server-schema.cpp:31](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-schema.cpp#L31), [:67](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-schema.cpp#L67)).
  `n_cache_reuse` needs `llama_memory_can_shift` and is gated on it
  ([server-context.cpp:3467-3475](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3467)).
- `n_cmpl` is capped by `n_parallel`
  ([server-schema.cpp:63-65](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-schema.cpp#L63),
  `->set_hard_limits(1, params_base.n_parallel)`), which is the clean statement of the coupling: the
  slot count *is* the parallelism budget, and `n_cmpl > n_parallel` is refused at parse time.

---

## 5. What still needs a measurement (the next coder's brief)

Everything above is code reading plus arithmetic that reproduces the one measured datapoint exactly.
The following items cannot be settled from the source, with the exact harness for each. All of them
are read-only at the repo level: they start the published binary on a private port under `/tmp` and
never touch the repo or the app. Ports 8391 and 8393 were used by the sibling report; use 8395+.
macOS has no `timeout(1)`, so wrap HTTP calls as
`perl -e 'alarm shift; exec @ARGV' <secs> ...`.

Common preamble for every run below:

```sh
KALSA="/Users/marco/Library/Application Support/kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.0/kalsa-server"
MODEL="/Users/marco/Library/Application Support/kalsa-brain/runtime/models/Trinity-Nano-Preview-Q4_K_M.gguf"
mkdir -p /tmp/kalsa-2slot/slots
```

### M1 - are two concurrent streams fused into one `llama_decode` per step?

This is the one question with a **decisive built-in instrument**, so it should be first. The metrics
endpoint exposes three counters that answer it directly
([server-task.cpp:1546-1549](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-task.cpp#L1546),
[:1586-1589](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-task.cpp#L1586)):

- `llamacpp:n_decode_total` - "Total number of llama_decode() calls, excluding speculative decoding and multimodal decoding"
- `llamacpp:n_busy_slots_per_decode` - "Average number of busy slots per llama_decode() call"
- `llamacpp:tokens_predicted_seconds` - the aggregate generation throughput gauge

It requires the `--metrics` flag, which is **off by default**
([common/common.h:674](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/common/common.h#L674),
`bool endpoint_metrics = false;`), and `/metrics` answers 501 without it.

```sh
"$KALSA" -m "$MODEL" --host 127.0.0.1 --port 8395 -c 16384 -np 2 --metrics --slots \
  --no-cache-idle-slots --slot-save-path /tmp/kalsa-2slot/slots -lv 4 \
  >> /tmp/kalsa-2slot/server.log 2>&1 &
sleep 25   # model load
curl -s http://127.0.0.1:8395/metrics > /tmp/kalsa-2slot/m_before.txt
```

Then two completions that differ in `X-Kalsa-Slot` and nothing else, fired concurrently, with
`temperature 0`, `stream false`, `cache_prompt false`, identical prompts, and a fixed `n_predict`
(large enough that prefill is not the whole story, e.g. 400 and 4000 on a ~2k prompt):

```sh
# slot 0
curl -s -H 'X-Kalsa-Slot: 0' -H 'Content-Type: application/json' \
  -d '{...,"n_predict":400,"temperature":0,"cache_prompt":false}' \
  http://127.0.0.1:8395/completion > /tmp/kalsa-2slot/c0.json &
# slot 1, same body
curl -s -H 'X-Kalsa-Slot: 1' -H 'Content-Type: application/json' -d '...' \
  http://127.0.0.1:8395/completion > /tmp/kalsa-2slot/c1.json &
wait
curl -s http://127.0.0.1:8395/metrics > /tmp/kalsa-2slot/m_after.txt
```

Read-outs and how to interpret them:

- `n_busy_slots_per_decode` close to **2.0** -> the two streams share every `llama_decode`; the
  fused-batch reading in 2.5 is confirmed. Close to 1.0 -> they are being serialized, and the fusion
  reading is wrong. This is a single number and there is no way to fake it.
- `n_decode_total` delta for 400 tokens each: ~400 if fused, ~800 if serialized.
- `tokens_predicted_seconds` vs the single-stream baseline of **71.33 tok/s** measured in the sibling
  report (same model, same Mac, `-c 16384 -np 1`). Report the aggregate and the per-stream
  (`delta_tokens / wall_each`) explicitly.
- **Prediction to falsify:** aggregate decode between 1.0x and 2.0x of the single-stream rate, and
  per-stream between 0.5x and 1.0x. If the aggregate lands at or below 1.0x, the second stream is
  pure cost on this hardware.

Repeat once with `--kv-unified` in place of the plain `-np 2` to check whether the mode changes the
batching (it should not, and if it does, that is a finding).

### M2 - prefill fairness / head-of-line between two slots

The code permits a long prefill on a low-id slot to take the whole `n_batch` every step (2.5). Whether
that happens in practice, and how bad it is, needs a timed run.

Fresh process (so nothing is in the prompt cache and both prefills are genuinely cold), `-np 2`,
`--no-cache-idle-slots`, `-lv 4`, and two concurrent requests with `stream true` whose **first data
line is timestamped**:

```sh
# slot 0: ~14000-token prompt;  slot 1: ~1000-token prompt
# timestamp the first SSE chunk per stream:
( curl -sN -H 'X-Kalsa-Slot: 0' -H 'Content-Type: application/json' -d '{"prompt":"<long>","n_predict":64,"stream":true,"cache_prompt":false,"temperature":0}' \
    http://127.0.0.1:8395/completion | while IFS= read -r l; do printf '%s %s\n' "$(python3 -c 'import time;print(time.time())')" "$l" >> /tmp/kalsa-2slot/s0.sse; break; done ) &
( curl -sN -H 'X-Kalsa-Slot: 1' -H 'Content-Type: application/json' -d '{"prompt":"<short>","n_predict":64,"stream":true,"cache_prompt":false,"temperature":0}' \
    http://127.0.0.1:8395/completion | while IFS= read -r l; do printf '%s %s\n' "$(python3 -c 'import time;print(time.time())')" "$l" >> /tmp/kalsa-2slot/s1.sse; break; done ) &
wait
```

Run three variants and compare time-to-first-token:

1. slot 0 long, slot 1 short, slot 0 launched ~1 s **first**
2. same prompts, slot 1 launched ~1 s first (arrival order reversed)
3. one at a time (sequential control) for the same two prompts

Variant 1 vs 2 is the discriminator: if TTFT follows **slot id** rather than arrival order, the
head-of-line claim in 2.5.2 is confirmed. Also grep the log for the interleaving:

```sh
grep -nE "new prompt, n_ctx_slot|prompt eval time|slot context shift|slot release" /tmp/kalsa-2slot/server.log
```

**Prediction to falsify:** in variant 1, slot 1's TTFT ~= slot 0's full prefill wall-clock; in
variant 2 the reverse. If instead both TTFTs land near the same time, the batch is being shared and
the head-of-line reading is wrong - which would be a useful correction to 2.5.2.

### M3 - idle-slot memory, from the log and from `/slots`, not from guesswork

The authoritative numbers are the allocator's own log lines, because RSS on macOS is not a reliable
proxy for ggml buffer allocation:

```sh
grep -nE "n_seq_max|n_ctx |n_ctx_seq|KV buffer size|llama_kv_cache|creating .* KV cache|n_slots =|n_ctx_slot" \
  /tmp/kalsa-2slot/server.log
```

Four launches, each fresh, each stopped after startup, no requests, and compare the lines against the
table in 2.4 (this is a startup-only check, no benchmarking):

```sh
# A: -c 16384 -np 1        -> expect n_ctx_seq 16384, base 224.00 MiB, swa 2560 cells / 105.00 MiB
# B: -c 16384 -np 2        -> expect n_ctx_seq  8192, base 224.00 MiB, swa 5120 cells / 210.00 MiB
# C: -c 16384 -np 2 --kv-unified -> expect n_ctx_seq 16384, base 224.00 MiB, swa 4608 cells / 189.00 MiB
# D: -c 16384 -np 4 --kv-unified -> expect n_ctx_seq 16384, base 224.00 MiB, swa 8704 cells / 357.00 MiB
for i in 1 2 3 4; do ...; done   # one launch per variant, port 8396, log per variant
```

That test checks the arithmetic in 2.4, which is currently **INFERRED** from a single measured
datapoint. It is cheap - it is just four startups and four greps.

Occupancy (does an idle slot keep its cells?) is then checkable without RSS:

```sh
# after one 16k-token chat on slot 0:
curl -s http://127.0.0.1:8395/slots | python3 -m json.tool
#   expect: n_prompt_tokens ~16110, is_processing false  -> the slot still holds the chat
curl -s -X POST 'http://127.0.0.1:8395/slots/0?action=erase' -H 'Content-Type: application/json' -d '{}'
curl -s http://127.0.0.1:8395/slots | python3 -m json.tool   # n_prompt_tokens null
```

And the RAM-copy half of 3.5, which needs both settings of the (default-on) flag, with the prompt
cache's own accounting line at `-lv 4`:

```sh
grep -E "cache state:|cache size limit|removing oldest entry|prompt state size|purging slot" /tmp/kalsa-2slot/server.log
```

Run the same 16k chat twice: once with `--cache-idle-slots` (default) and once with
`--no-cache-idle-slots`, and in each case send a *second, unrelated* short request afterwards. The
`- cache state: N prompts, X MiB` line is the answer for the RAM copy. Under the default (non-unified)
launch, the KV must **not** be released; re-check `/slots` after the second request.

### M4 - save/restore across a window change

Direct test of the two guards in 4.2. Save at one geometry, restore at another, and record which
error fires (`"Restored prompt does not fit in the slot context"` vs `"No available space in KV cache
or invalid slot save file"`):

```sh
# producer: -c 32768 -np 1   (n_ctx_seq 32768), build a 16k chat, then:
curl -s -X POST 'http://127.0.0.1:8397/slots/0?action=save' -H 'Content-Type: application/json' -d '{"filename":"ctx32k.bin"}'
# consumer: -c 16384 -np 2   (n_ctx_seq 8192), same --slot-save-path:
curl -s -X POST 'http://127.0.0.1:8395/slots/0?action=restore' -H 'Content-Type: application/json' -d '{"filename":"ctx32k.bin"}'
# and the growing direction, consumer: -c 65536 -np 2 (n_ctx_seq 32768) -> expected to succeed
```

Also a chat whose token count exceeds the destination window but whose saved cell count is smaller:
save a 9000-token chat at `n_ctx_seq 32768`, restore into `n_ctx_seq 8192`. That separates the
`restored.size() > slot->n_ctx` guard from the cell-count guard.

### M5 - confirm the flag semantics the report leans on

Small, cheap, and each one falsifies a claim above:

1. `--kv-unified-per-slot` is a uniform cap: launch `-c 16384 -np 2 --kv-unified-per-slot 4096` and
   check `GET /slots` reports `n_ctx: 4096` for **both** slots; send a 5000-token prompt and read the
   error's `n_ctx` field (expected 4096).
2. `X-Kalsa-Slot` wraps: on a 2-slot server, `X-Kalsa-Slot: 5` should be served by slot 1 (3.4), and
   the log should say `selected slot by id (5)` while `/slots` shows slot 1 busy. That is a one-line
   check of `id_slot % slots.size()`.
3. `--slots` is not the slot count: launch with `--no-slots` and confirm the server still creates
   `n_parallel` slots and still serves `X-Kalsa-Slot` (the monitoring route disappears, the behaviour
   does not).
4. No `-np` at all: launch with `-c 16384` but **no** `-np`, and confirm (a) the startup log says
   `n_parallel is set to auto, using n_parallel = 4 and kv_unified = true`, and (b) `n_ctx_seq` equals
   the whole `-c` rather than `-c/4`, i.e. the auto default really is 4 slots over one shared pool
   (2.1, 2.4).
5. The `--fit` interaction, only if the app ships without `-c`: launch with neither `-c` nor `-np` and
   record the `n_ctx` the fit step chose (`grep -E "context size unset|n_ctx |n_ctx_seq" server.log`).
   This is the one row of the 2.4 table that is not a constant, so it cannot be checked from the
   source.

---

## 6. UNKNOWN list

Stated plainly, with what would settle each.

1. **The launch flags the desktop app actually uses for the engine.** Whether `kv_unified` is on or
   off is the single most consequential unknown in this report: it decides whether idle slots keep
   their KV (3.4) or have it cleared at every new task (3.5), and it changes the per-slot window
   arithmetic (2.2). I grepped `~/Projects/kalsa-brain` (Rust/Tauri), `~/Projects/kalsa`,
   `~/Projects/llama.rn-kalsa` and `~/Projects/kalsa-device-build` for `ctx-size`, `slot-save-path`,
   `parallel`, `kv-unified` and `kalsa-server` and found **no** engine launch invocation. Settled by
   reading the code that spawns `kalsa-server`, or by reading the `-lv 4` startup line of a real
   desktop session (`srv load_model: initializing, n_slots = ..., n_ctx_slot = ..., kv_unified = ...`).
2. **Whether an idle slot's KV is ever returned to the OS.** The code has no path that frees the
   pool; only cells inside it are re-assigned (3.4). I did not verify at the allocator level that
   `ggml_backend_buffer` memory is never unmapped, nor whether `llama_memory_clear` is reachable from
   the server. Settled by `vmmap <pid> | grep -i` before/after an erase, or by reading
   `ggml_backend_free` reachability from `server_context_impl`.
3. **The true per-stream decode rate with two concurrent streams** on this Mac, and the true prefill
   sharing. M1 and M2 settle both. I deliberately quote no ratio.
4. **Whether head-of-line prefill monopolization actually occurs** (2.5.2). The code permits it; the
   checkpoint breaks in the fill loop might prevent it in practice. M2 settles it. If it occurs, it is
   the most user-visible consequence of running two chats at once, and it is not documented anywhere.
5. **`--context-shift`'s practical effect on a per-slot window.** The default is `false` (4.1), so on a
   default launch a full slot is a hard stop. Whether a shipped app launch enables it is part of
   unknown 1. The discard arithmetic itself (`n_discard = n_left/2`, `n_keep` default = whole prompt)
   is read in the code but has not been observed.
6. **Whether `--kv-unified-per-slot` smaller than `n_swa + n_ubatch` (2560 on this model) leaves slack
   or a mismatch.** `slot.n_ctx` would be the cap, while the SWA component is still sized from the
   uncapped `cparams.n_ctx_seq` (2.3). No error path was found for this, but I did not trace whether a
   capped slot can still overrun its SWA ring. Settled by `--kv-unified-per-slot 1024` plus a 2000-token
   prompt.
7. **Whether the LoRA-change path intentionally frees KV.** `launch_slot_with_task` calls
   `slot.prompt.clear()` (token bookkeeping only) rather than `prompt_clear()` when a LoRA change
   invalidates the cache
   ([server-context.cpp:1729-1737](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L1729)):
   ```cpp
   if (lora_should_clear_cache(slot.lora, task_loras)) {
       SLT_TRC(slot, "clearing cache for lora change. %zu loras -> %zu\n", ...);
       slot.prompt.clear();
   ```
   The KV cells for that sequence are not removed by that call. The app does not use LoRA today as far
   as this recon shows, so it is out of scope, but it is the one place where the "clear" and "free"
   verbs come apart in a way that does not look deliberate.
8. **Behaviour under `n_cmpl > 1` (multiple completions of one prompt).** The parent/child slot
   machinery (`SLOT_STATE_WAIT_OTHER`, `copy_state_to`, child slots cleared on release) exists in the
   code ([server-context.cpp:727](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L727),
   [:3997-4015](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L3997),
   `get_free_slots` at
   [:2268](https://github.com/Aspis0/kalsallama/blob/2a290390d67311b580ef398fd545e6d060b39897/tools/server/server-context.cpp#L2268)) and consumes slots
   from the same pool, which changes the per-stream arithmetic in 2.4 for `n>1`. Not mapped here; it
   is a different front, but it is the next thing that shares this pool.

---

## Appendix - how a reader can reproduce this recon

```sh
cd ~/Projects/kalsallama
git rev-parse kalsa-server-v1.1.0^{commit}          # 2a290390d67311b580ef398fd545e6d060b39897
rm -rf /tmp/kalsa-pub && mkdir -p /tmp/kalsa-pub
git archive 2a290390d tools/server common src include | tar -x -C /tmp/kalsa-pub
python3 /tmp/kalsa-pub/gguf_meta.py                 # the KV geometry inputs, read from the model header
```

No file in `~/Projects/kalsallama` was modified; the only untracked files in `git status` are the
pre-existing `CMakeUserPresets.json` and `pkg-snapdragon/`. No server was started, no build was run,
and nothing was written upstream - no push, no tag, no PR, no issue, no comment.
