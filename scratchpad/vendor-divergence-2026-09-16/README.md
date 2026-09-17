# The installed llama.rn engine is not the one the committed patch builds

Found 2026-09-16 by a hostile audit of an unrelated change, then verified on
disk. Preserved here because the divergent code is tracked **nowhere else**: it
lives only in `node_modules/` on this Mac, and the project's own sanctioned way
to re-apply patches — `rm -rf node_modules/llama.rn && npm install` — destroys
it.

**This file was rewritten later the same evening.** The first version drew the
wrong conclusion from a partial comparison; see "What the first pass got wrong".

## How the comparison was made

Not by eyeballing greps. The CI-equivalent tree was reconstructed exactly:

1. `npm pack llama.rn@0.12.8` into a temp dir, extract.
2. Copy it into a scratch project (`/tmp/.../proj/node_modules/llama.rn`) with
   the committed patch in `patches/` and a minimal `package.json`.
3. Run the repo's own patch-package against that scratch project:
   `patch-package 8.0.1 … llama.rn@0.12.8 ✔`, exit 0. **The live tree is never
   touched**, which is what makes this safe where regeneration is not.
4. sha256 every file in both trees and compare.

`git apply -p3` **fails** on this patch (8 errors) while patch-package succeeds.
That is a strictness difference, not a broken patch — do not conclude the patch
is malformed from a `git apply` failure.

## Which files may legitimately differ

`scripts/sync-kalsallama.sh:592-597` overlays the pinned fork into
`node_modules/llama.rn/cpp/` with `rsync -a --delete`, excluding `rn-*`,
`jsi/`, `ggml-ext.h`, `anyascii.*`, `VENDOR_SHA`. So the installed tree is
**npm + fork overlay at the pin + patch**, and a whole-tree diff is meaningless
(772 published files vs 4018 installed, most of the delta being the fork and
local `.cxx` build output).

The files the overlay never writes are owned by the patch alone. Comparing only
those — 124 paths — yields exactly **two** divergences:

| file | expected (npm + patch) | installed |
|---|---|---|
| `cpp/rn-completion.cpp` | `98ae01be…` | `62f2a1ee…` |
| `cpp/rn-completion.h` | `9c5a6b66…` | `5ca064bf…` |

Nothing else. The exact diffs are in this directory.

## What the divergence actually is

Both changes make the installed tree **newer than CI, not broken**.

**1. The over-eager prompt guard, removed.** The patch adds, in `loadPrompt`:

```c++
if (num_prompt_tokens >= (size_t)parent_ctx->n_ctx) {
    …
    context_full = true;
    return;
}
```

The installed tree deletes that block. The prefix match itself
(`find_common_prefix_length`) is **present in both** — so the local change is a
deletion that lets execution reach code that was always there. Its comment says
why: `JS start=0 can send > n_ctx while sharing the live KV prefix; throwing
context_full here never computed n_common.`

**2. A privacy leak in the committed patch, closed.** In the patch's version the
`#endif` falls *before* the diagnostic log call, so this runs in **release**
builds:

```c++
rnllama::log("WARNING", __func__, __LINE__,
    "KALSA_KVDIVERGE … shared_ids=[%s] embd_ids=[%s] text_ids=[%s]%s", …);
```

The patch defends it in a comment: *"Token ids stay in both builds: they locate
the divergence, which is the whole point of the diagnostic. The words never
were."* That reasoning is wrong — detokenizing those ids recovers the user's
words verbatim, and WARNING-level logcat is collected by Android bug reports.
The installed tree moves the whole ids+text block inside
`RNLLAMA_ANDROID_ENABLE_LOGGING` and emits counts only in release.

## What the first pass got wrong

- It reported **one** divergent file. There are two; `rn-completion.h` was not
  captured and an `npm install` would have lost it.
- It framed the fix as something the installed tree *adds*. It is a deletion.
- It concluded the repair is "restore the fork → pin → sync invariant". That
  invariant **does not cover these files**: the overlay excludes `rn-*`, so
  `rn-completion.*` never comes from the fork. There is no invariant to restore
  — there is a process gap, because the only channel that can change these
  files is the patch, and regenerating it is forbidden.
- Consequence of that error: discarding the local tree to "get back to CI" would
  **reintroduce the privacy leak**.

## Why it still matters

A CI-built APK and a locally built APK run different engines on the same input:

- CI: an over-long prompt raises `context_full`, the turn fails loudly and JS
  recovers; and release logcat carries recoverable user content.
- This Mac: no prompt guard, so generation runs to `embd.size() >= n_ctx` and
  takes the refusal branch at `rn-completion.cpp:1078-1104`, setting
  `truncated = true` — a mutilated answer inside a turn that counts as complete.

So the **local** engine is the quieter of the two: a T20C measured here can read
20/20 answered where CI would have recorded a recovery.

`KALSA_NATIVE_VARIANT` (`LlamaService.ts:2176-2181`) logs only `androidLib` and
`nGpuLayers`, so no line in any log distinguishes the two revisions.
`scripts/assert-native-patch.sh` cannot either: it greps the built `.so` for
`kalsa-native-patches` and `q23k`, which both revisions carry.

## What must NOT be done

- **Do not run `patch-package llama.rn` against the live tree.** Regeneration
  there is forbidden on this project.
- **Do not `npm install` before this capture is complete** — that is what
  deletes the live fix. This directory is that capture.

Folding the local changes into the patch is possible without either: regenerate
the diff from the scratch project described above, where the live tree is never
an input. That is an owner decision, not a cleanup.

## Files here

| file | what it is | sha256 |
|---|---|---|
| `rn-completion.cpp.installed` | the engine actually compiled on this Mac | `62f2a1eeeed23567d668c93efdd13c077860002133167fb8d4b5a8a28e2c6dc0` |
| `rn-completion.h.installed` | its header, divergent by one comment | `5ca064bf53cff1775503cbb7662a3a33c9a33dfd429a839e82c0ba0eec178fd5` |
| `ci-vs-installed.rn-completion.cpp.diff` | CI-equivalent vs installed, unified | — |
| `ci-vs-installed.rn-completion.h.diff` | same, for the header | — |
| `llama.rn+0.12.8.patch.committed` | the patch in the app repo at the time | see `git log patches/` |

`npx patch-package --dry-run` is **not** evidence here: it fails on an
already-patched tree by construction, and it exits 0 while printing
"finished with 1 error(s)".
