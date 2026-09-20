# Kalsa application architecture

## Repository role and branches

`Aspis0/kalsa` is the React Native application.

| Branch | Reference | Status |
|---|---|---|
| `origin/main` | `16ba535` | Current main head; energy framework merge line |
| `main` | `0bfe985` | Stale local checkout, 42 commits behind `origin/main`; no silent fast-forward |
| `feat/moe-stream` | `74531a8` at verification | Active development |
| `chore/repo-reorg-v2` | `6b6c69c` | Six reorganization commits above `feat/moe-stream`; published as `origin/chore/repo-reorg-v2`; not adopted |

## Engine assembly

The Android engine comes from one source: `llama.rn` as a **git dependency on the fork
`Aspis0/kalsa.rn`**, pinned by commit in `package.json` and `package-lock.json`. The repository
was renamed on GitHub from the `llama.rn` fork — the old URL redirects, and the npm package
name is unchanged. The fork's `cpp/` **is** kalsallama, flattened, with the `LM_`/`lm_` symbol
prefixes already applied, plus the 36 `rn-*` / `jsi/` files kept as tracked source. `native/bmoe/`
(the MoE streamer) is still compiled by the fork's CMake through
`${RNLLAMA_LIB_DIR}/../../../native/bmoe` (`if(EXISTS)`).

There is no install step: `package.json` has no `postinstall`, no overlay runs, no patch is
applied. `npm ci` unpacks the fork and that is the engine.

Updating the engine is a fork-side operation:

```text
# in Aspis0/kalsa.rn (branch kalsa) — usage is `pin <sha> | bump | verify`
scripts/sync-kalsallama.sh pin <kalsallama-sha>   # flatten + scripts/kalsa-patches/* -> cpp/
scripts/sync-kalsallama.sh bump                   # same, following the pinned branch head
scripts/sync-kalsallama.sh verify                 # the regenerated tree must match cpp/
# in the app, after pushing the fork
sed -i '' 's/<old-sha40>/<new-sha40>/' package.json package-lock.json && npm install
```
Say which kalsallama sha the new fork commit carries in the app's bump commit message: the
app's diff shows a fork sha and nothing about the engine inside it.

The sha is edited in place because `npm pkg set` cannot address a dotted key:
`dependencies.llama.rn=` nests an object and `dependencies["llama.rn"]=` writes a quoted string —
both leave the real dependency on the old commit.

⛔ Never edit `node_modules/llama.rn` by hand, and never commit into the fork's `cpp/` what a
re-flatten would overwrite: an engine change belongs in kalsallama and comes back through `bump`;
a binding change belongs in the fork's `rn-*` / `jsi/` files, which the flatten never touches.
`scripts/assert-engine-provenance.sh` compares the installed tree against
`Aspis0/kalsa.rn@<sha>` as npm packs it (the gate also accepts the pre-rename
`Aspis0/llama.rn`, which GitHub redirects to it), and exits 1 naming the first differing path.

## What the old road guaranteed, and what replaces it

Until 2026-09-18 the engine was assembled from three sources: the `llama.rn` npm tarball, an
rsync overlay from `vendor/kalsallama-cpp/`, and `patches/llama.rn+0.12.8.patch` applied by
`patch-package`. All three are gone. What they guaranteed, and what stands in their place:

| The old road gave | Now | Replacement |
|---|---|---|
| `patch-package` shouts when upstream moves under us | nothing moves under us: the fork is pinned by sha | a fork merge shows conflicts instead of resolving them in silence |
| `assert-vendor-pristine.sh` (installed == npm + patch) | no longer meaningful | `scripts/assert-engine-provenance.sh` (installed == `fork@sha`) |
| `native/kalsallama.pin`: the app declared which ENGINE commit it wanted, and the sync refused to build otherwise | the app declares a fork commit; which engine that fork commit carries is the fork's business | partial — `assert-engine-provenance.sh` prints the installed `cpp/KALSALLAMA_SHA`, but nothing compares it to an expected value |
| `patch-package` exits 0 after printing "1 error(s)" — CI green on an unpatched engine | gone; this is the real gain | — |
| an overlay that wins every conflict silently | gone | git, in the fork |
| lockfile `integrity` sha512 and an offline `npm ci` from cache | a git dep: the sha40 is the identity, GitHub must be reachable, and the lockfile `integrity` of a git dep is verified by nobody | `assert-engine-provenance.sh`, which refetches the commit and compares file by file — run by hand, not in CI |
| `KALSA_LLAMA_FROM_SOURCE=0` (prebuilt jniLibs) | the fork publishes no binaries | none — `plugins/withLlamaFromSource.js` throws on opt-out |
| iOS: the upstream `rnllama.xcframework` | the fork does not carry it | `RNLLAMA_BUILD_FROM_SOURCE=1`, built from source (not done yet) |
| an engine build id that never moved | moves whenever the engine does | intended: the KV sidecars regenerate once |

## Entry points

- `docs/KALSA.md`: current application and harness state.
- `docs/HARNESS_FINDINGS.md`: findings register and evidence record.
- `docs/KNOWN_ISSUES.md`: known issues.
- `scripts/campaign/`: on-device measurement campaign harness.

## Evidence read

`package.json` (the `llama.rn` git dependency, no `postinstall`); `package-lock.json`
(`packages["node_modules/llama.rn"].resolved`); `node_modules/llama.rn/cpp/KALSALLAMA_SHA`;
`scripts/engine-build-id.js`; `scripts/assert-engine-provenance.sh`;
`plugins/withLlamaFromSource.js`; and, in `Aspis0/kalsa.rn`, `scripts/sync-kalsallama.sh` with
`scripts/kalsa-patches/`.
