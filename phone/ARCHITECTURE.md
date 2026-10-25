# Kalsa application architecture

## Repository role and branches

`Aspis0/kalsa` is the React Native application.

| Branch | Reference | Status |
|---|---|---|
| `origin/main` | `5429799` | Current main head; the vendored-engine line |
| `main` | `745bf82` | Local checkout, 1 commit ahead of `origin/main`; no silent fast-forward |

## Engine assembly

The Android engine comes from one source: `llama.rn` as a **git dependency on the fork
`Aspis0/kalsa.rn`**, pinned by commit in `package.json` and `package-lock.json`. The repository
was renamed on GitHub from the `llama.rn` fork — the old URL redirects, and the npm package
name is unchanged. The fork no longer flattens the engine into `cpp/`: the vendored upstream
trees live in `vendor/`, where `vendor/VERSIONS` pins each commit, `vendor/llama.cpp/` carries
the engine (beside `vendor/codec.cpp/` and the OpenCL headers/loader), and `cpp/` holds only
the binding glue (`rn-*`, `jsi/`, `bmoe_stream.*`). `native/bmoe/` is gone from `origin/main`:
that tree keeps only `native/GovernorBatteryModule.kt`.

There is no install step: `package.json` has no `postinstall`, no overlay runs, no patch is
applied. `npm ci` unpacks the fork and that is the engine.

Updating the engine is a fork-side operation:

```text
# in Aspis0/kalsa.rn (branch vendor-migration) — edit the pin, then re-vendor
$EDITOR vendor/VERSIONS          # set LLAMA_CPP_REF (tag, branch or commit)
npm run sync:vendor              # fetch, export the subset, apply scripts/patches/, write *_COMMIT
scripts/assert-kalsa-vendor.sh   # grade the result, not the patch application
# in the app, after pushing the fork
sed -i '' 's/<old-sha40>/<new-sha40>/' package.json package-lock.json && npm install
# and record the engine the new fork commit carries (the gate fails without it)
printf '%s\n' <engine-sha40> > native/kalsallama.pin
```
Say which kalsallama sha the new fork commit carries in the app's bump commit message: the
app's diff shows a fork sha and nothing about the engine inside it.

The sha is edited in place because `npm pkg set` cannot address a dotted key:
`dependencies.llama.rn=` nests an object and `dependencies["llama.rn"]=` writes a quoted string —
both leave the real dependency on the old commit.

⛔ Never edit `node_modules/llama.rn` by hand, and never hand-edit `vendor/`: an engine change
belongs in kalsallama and comes back through `npm run sync:vendor`; a binding change belongs in
the fork's `rn-*` / `jsi/` files, which the sync never touches.
`scripts/assert-engine-provenance.sh` compares the installed tree against
`Aspis0/kalsa.rn@<sha>` as npm packs it (the gate also accepts the pre-rename
`Aspis0/llama.rn`, which GitHub redirects to it), and exits 1 naming the first differing path.
It also fails if `package.json` and `package-lock.json` name different fork shas, and on the
success path it compares the installed `vendor/VERSIONS` `LLAMA_CPP_COMMIT` against
`native/kalsallama.pin` (one line, the engine sha the app expects): missing pin, empty or
malformed commit line, or a differing sha is a fatal.

## What the old road guaranteed, and what replaces it

Until 2026-09-18 the engine was assembled from three sources: the `llama.rn` npm tarball, an
rsync overlay from `vendor/kalsallama-cpp/`, and `patches/llama.rn+0.12.8.patch` applied by
`patch-package`. All three are gone. What they guaranteed, and what stands in their place:

| The old road gave | Now | Replacement |
|---|---|---|
| `patch-package` shouts when upstream moves under us | nothing moves under us: the fork is pinned by sha | a fork merge shows conflicts instead of resolving them in silence |
| `assert-vendor-pristine.sh` (installed == npm + patch) | no longer meaningful | `scripts/assert-engine-provenance.sh` (installed == `fork@sha`) |
| `native/kalsallama.pin`: the app declared which ENGINE commit it wanted, and the sync refused to build otherwise | the app declares a fork commit; which engine that fork commit carries is the fork's business | `native/kalsallama.pin` is back as one line, and `assert-engine-provenance.sh` compares it against the `LLAMA_CPP_COMMIT` the installed `vendor/VERSIONS` declares: missing, empty or differing values are fatal, both shas printed |
| `patch-package` exits 0 after printing "1 error(s)" — CI green on an unpatched engine | gone; this is the real gain | — |
| an overlay that wins every conflict silently | gone | git, in the fork |
| lockfile `integrity` sha512 and an offline `npm ci` from cache | a git dep: the sha40 is the identity, GitHub must be reachable, and the lockfile `integrity` of a git dep is verified by nobody | `assert-engine-provenance.sh`, which refetches the commit and compares file by file — run after `npm ci` in apk.yml, e2e-emulator.yml and build-kalsa-apk.yml |
| `KALSA_LLAMA_FROM_SOURCE=0` (prebuilt jniLibs) | the fork publishes no binaries | none — `plugins/withLlamaFromSource.js` throws on opt-out |
| iOS: the upstream `rnllama.xcframework` | the fork does not carry it | `RNLLAMA_BUILD_FROM_SOURCE=1`, built from source (not done yet) |
| an engine build id that never moved | moves whenever the engine does | intended: the KV sidecars regenerate once |

## Entry points

- `scripts/campaign/`: on-device measurement campaign harness.
- `docs/`: dated findings; `docs/README.md` names the living documents, which are in the lab repo.
- `archived/docs/`: frozen history, including `KALSA.md`, `HARNESS_FINDINGS.md` and
  `KNOWN_ISSUES.md`. These are **not** current entry points.

## Evidence read

`package.json` (the `llama.rn` git dependency, no `postinstall`); `package-lock.json`
(`packages["node_modules/llama.rn"].resolved`); `node_modules/llama.rn/vendor/VERSIONS`
(the `LLAMA_CPP_COMMIT=` line, the engine sha the installed tree declares);
`scripts/engine-build-id.js`; `scripts/assert-engine-provenance.sh`;
`plugins/withLlamaFromSource.js`; and, in `Aspis0/kalsa.rn`, `vendor/VERSIONS`,
`scripts/sync-vendor.sh` and `scripts/patches/`.
