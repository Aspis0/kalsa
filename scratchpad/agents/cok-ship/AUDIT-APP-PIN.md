# AUDIT — app pin `ca2dcc0b4` (binding `e437b1af`, engine `319b539`)

Read-only. App worktree `~/Projects/kalsa-wt-bench-apk`, HEAD
`ca2dcc0b4907ce443148c9d772098775b3b6dbf5`, parent/origin-main
`d69b4ceffbd4883f935a7451e8d89d4ab023ca5d`, 1 commit ahead, no push, `git status --porcelain` = 0.
Coder account: `cok-ship/APP-PIN.md`.

## 1. Lockfile diff and integrity — CONFIRMED

`git show ca2dcc0b -- package-lock.json` is exactly three lines, all in the one `llama.rn` entry:

```
root deps:  "llama.rn": "github:Aspis0/kalsa.rn#5b966218…"  →  "… #e437b1af3de7af563526f5777dbf25d86f9b3215"
resolved:   git+ssh://git@github.com/Aspis0/kalsa.rn.git#e437b1af3de7af563526f5777dbf25d86f9b3215
integrity:  sha512-c75QM9FTFjqgX9sqbwfsJTgWNyxy3xzdVeC+Asdz7PqhJ2z9qZV+Kdf4gzo5+sQ6VDNjaOi1ztDiQam8zc8x1g==
```

No other lockfile line changed; `package.json:49` carries the same sha; `native/kalsallama.pin`
carries `319b539377605f6c572e234b28678b74bd78deb5`.

Independent reproduction of the integrity (codeload → extract → `npm pack`, npm 11.16.0 /
node 26.3.0):

```
curl https://codeload.github.com/Aspis0/kalsa.rn/tar.gz/e437b1af…  → sha512(fork.tgz)        = fee82d83…6061   (raw tarball)
npm pack in the extracted tree                                     → sha512(llama.rn-0.13.0-rc.4.tgz) = 73be5033d153163aa05fdb2a6f07ec253816372c72df1cdd55e0be02c773ecfaa1276cfda9957e29d7f8833a39fac43a54336368e8b5ced0e241a9bccdcf31d6
lockfile integrity base64-decoded                                                                  = 73be5033…31d6   ← exact match
```

So the integrity is over the **`npm pack` tarball** (npm's convention for git deps), not the raw
codeload `.tar.gz`. The convention was re-verified against the previous entry: packing
`codeload/5b966218…` gives `a0b35c0e2f240caa2f2970d6258952e112698355739ad0002e61d5b8b28c9352c1a5fa8a4e1db137430e75363def8f6f6979dc61b36810d1d5fc67daba197c91`, i.e. exactly the
integrity that commit had. `version` stayed `0.13.0-rc.4` (unchanged line).

## 2. Provenance gate — CONFIRMED

```
$ bash scripts/assert-engine-provenance.sh > /tmp/pa-prov.log 2>&1; echo $?
0
$ cat /tmp/pa-prov.log
[provenance] lockfile pins Aspis0/kalsa.rn@e437b1af3de7
[provenance] OK: 1119 files match Aspis0/kalsa.rn@e437b1af3de7
[provenance] engine inside it: kalsallama@319b53937760 == native/kalsallama.pin
```

The log names both commits, and the comparison is file-for-file against the codeload tarball at
the pinned binding sha. The binding sha is actually reachable: `git ls-remote origin
refs/heads/kalsarn-governor-engine` (from `~/Projects/llama.rn-kalsa`) returns
`e437b1af3de7af563526f5777dbf25d86f9b3215`, so the gate's `curl codeload…` resolves (it did).

## 3. No stale pins anywhere — CONFIRMED

```
git grep -n "1577495b9" -- .   → no hits
git grep -n "5b966218"  -- .   → no hits
grep -rn "1577495b9\|5b966218" . --exclude-dir=.git       → no hits
grep -rln "1577495b9\|5b966218" node_modules/             → no hits
git grep -n "319b539" -- .     → native/kalsallama.pin:1:319b539377605f6c572e234b28678b74bd78deb5   (only hit)
```

`build-kalsa-apk.yml`'s step "Assert native patch and pinned engine" runs
`bash scripts/assert-native-patch.sh`, which checks **markers, not shas**: it greps every release
`librnllama*.so` for `kalsa-native-patches` and `q23k` (defaults `PATCH_MARKER`/`ENGINE_MARKER`) and
requires `librnllama_jni*.so` to exist. The `q23k` marker is still in the pinned engine —
`grep -rln q23k node_modules/llama.rn/vendor/llama.cpp` → `ggml/src/ggml-cpu/{ggml-cpu.c,repack.cpp,traits.cpp,repack-q23k.h}`, and
`git -C ~/Projects/llama.rn-kalsa grep -l q23k e437b1af -- vendor/llama.cpp` shows the same four
paths at the binding commit. Nothing in that step pins the old shas.

The app's engine identity is computed, not hardcoded: `app.config.js:144`
`next.extra = { ...next.extra, engineBuildId: computeEngineBuildId(__dirname) }`, and
`scripts/engine-build-id.js:206-232 collectEngineBuildInputs` reads the installed
`node_modules/llama.rn` (version, commit, `kalsallamaSha`, engine-tree digest) plus `native/` — so
the bump flows into the APK's `engineBuildId`.

## 4. `node_modules/llama.rn` — CONFIRMED real, at the new pin

```
$ ls -la node_modules | grep llama
drwxr-xr-x   17 marco  staff     544 Sep 23 15:13 llama.rn        → real directory
[ -L node_modules/llama.rn ] → false ; [ -d ] → true
$ grep LLAMA_CPP_REF/COMMIT node_modules/llama.rn/vendor/VERSIONS
LLAMA_CPP_REF=319b539377605f6c572e234b28678b74bd78deb5
LLAMA_CPP_COMMIT=319b539377605f6c572e234b28678b74bd78deb5
$ cat node_modules/llama.rn/src/version.ts
export const BUILD_NUMBER = '11202'
export const BUILD_COMMIT = '319b539'
```

The gate's 1119-file manifest match against the packed e437b1af tree is the stronger statement: the
installed copy **is** the pinned binding tree, not a locally modified or stale one.

## 5. Shape vs the previous pin commit — CONFIRMED

`git diff --numstat d69b4ce ca2dcc0` = `1/1 native/kalsallama.pin`, `3/3 package-lock.json`,
`1/1 package.json` (+5/−5). `git show --stat e206a945b` is the same three files and the same
`1/1, 3/3, 1/1` numstat, with the same message shape
(`deps : pin llama.rn to binding <short>, engine pin to <short>`).

## Findings

| # | verdict | sev | finding |
|---|---|---|---|
| A1 | CONFIRMED | — | Lockfile diff is only the llama.rn entry (spec, `resolved` with the sha, `integrity`); the new integrity exactly reproduces as the `npm pack` sha512 of the codeload tree at `e437b1af`. |
| A2 | CONFIRMED | — | Gate exits 0 and names both `e437b1af3de7` and `kalsallama@319b53937760`; 1119 files match the packed tree. |
| A3 | CONFIRMED | — | No tracked or installed file pins `1577495b9`/`5b966218`; `319b539` appears only in `native/kalsallama.pin`. The `build-kalsa-apk.yml` marker check still sees `q23k` in the new engine. |
| A4 | CONFIRMED | — | `node_modules/llama.rn` is a real directory at the new binding (VERSIONS/version.ts = 319b539/11202). |
| A5 | CONFIRMED | — | Shape, message, and 3-file/+5−5 diff match `e206a945b`; parent = `origin/main` `d69b4ce`, 1 ahead, no push. |
| A6 | NOTE | — | The lockfile integrity is over the packed tarball, not the raw codeload `.tar.gz` (`fee82d83…`); that is npm's convention and was re-verified against the previous entry. CI's `npm ci` (node 20) is the remaining version-crossing verifier; the reproduction matched under npm 11.16.0. |

**Verdict: SHIP.** All four checks pass on the evidence above: the integrity reproduces from the
pinned tarball, the provenance gate is green and names both commits, no stale pin exists anywhere in
the tree (the APK workflow's engine assertion is marker-based and the marker is intact), and the
installed engine is a real directory at `e437b1af`. No blocker; A6 is a note only.
