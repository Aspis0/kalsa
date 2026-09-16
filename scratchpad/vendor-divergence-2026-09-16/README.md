# The installed llama.rn engine is not the one the committed patch builds

Found 2026-09-16 by a hostile audit of an unrelated change, then verified by the
orchestrator on disk. Preserved here because the divergent code is tracked
**nowhere else**: it lives only in `node_modules/` on this Mac, and the
project's own sanctioned way to re-apply patches — `rm -rf node_modules/llama.rn
&& npm install` — destroys it.

## The two directions of divergence

Both checked with grep in both trees, not inferred.

**The patch has something the installed tree does not.**
`patches/llama.rn+0.12.8.patch` contains `KALSA_KVSHIFT refused prompt=` (1
occurrence). `node_modules/llama.rn/cpp/rn-completion.cpp` has only
`KALSA_KVSHIFT refused embd=` at `:1096`. The patch's hunk replaces
`truncatePrompt(text_tokens); …` with `context_full = true; return;`.

**The installed tree has something the patch does not**, and it is a real fix:

```
node_modules/llama.rn/cpp/rn-completion.cpp:478
    // Prefix match FIRST. JS start=0 can send > n_ctx while sharing the
    // live KV prefix; throwing context_full here never computed n_common.
```

That is precisely the item PLAN.md carries as still open — "the `loadPrompt`
path still raises `context_full` before `n_common` is computed". Somebody fixed
it directly in the vendored tree and never folded it back.

`grep -rn "Prefix match FIRST" patches/ src/` → rc=1, zero matches.

**Timestamps agree with that story.** The patch is `2026-09-14 08:57`; the
installed file is `2026-09-14 09:25`, 28 minutes later.

## Why it matters beyond one file

A CI-built APK and a locally-built APK run different engines on the same input:

- CI (`npm ci` + `patch-package`, `package.json` postinstall): an over-long
  prompt sets `context_full = true` and never `truncated`.
- This Mac: no prompt-length guard on that path, so generation runs until
  `embd.size() >= n_ctx` and takes the refusal branch at
  `rn-completion.cpp:1078-1104`, which sets `truncated = true`.

`KALSA_NATIVE_VARIANT` (`LlamaService.ts:2095-2098`) does not distinguish these
two revisions, so no log explains the difference. Any measurement taken with a
locally built APK may not describe what CI builds.

## What must NOT be done to fix it

- **Do not run `patch-package llama.rn` to regenerate.** Regeneration is
  forbidden on this project.
- **Do not `npm install` before the live fix is captured elsewhere** — that is
  what deletes it. This directory is that capture.

The project rule is that native changes are born in the fork, then reach the app
through a pin bump and sync; the vendored tree is never hand-edited. Restoring
that invariant is an owner decision, not a cleanup.

## Files here

| file | what it is | sha256 |
|---|---|---|
| `rn-completion.cpp.installed` | the engine actually compiled on this Mac | `62f2a1eeeed23567d668c93efdd13c077860002133167fb8d4b5a8a28e2c6dc0` |
| `llama.rn+0.12.8.patch.committed` | the patch in the app repo at the time | see `git log patches/` |

`npx patch-package --dry-run` is **not** evidence here: it fails on an
already-patched tree by construction, and it exits 0 while printing
"finished with 1 error(s)".
