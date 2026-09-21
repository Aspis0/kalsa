# Pre-push audit — commit `2a290390d` ("ci : drop the Metal packaging work from the kalsa-server release path")

Target: `/Users/marco/.paseo/worktrees/0f85s4e7/kalsa-v110`, branch `kalsa-slot-and-metal`.
Parent: `ac9a09dc6`. Reference commits: `4ccef2f85` (= tag `kalsa-server-v1.0.0`, a tag object
pointing at that commit), `916b8f0bc` (branch head that produced the published v1.0.0 archive in
run 35549848243). Reviewer: independent, adversarial. The repo was treated read-only: no commit,
no edit, no push, no tag; all scratch work under `/tmp`. Working tree verified clean at
`2a290390d` (`git status --porcelain` empty, `HEAD` = `2a290390d`).

## VERDICT: PUSH-SAFE

All nine claims CONFIRMED. No refutations. The findings below are informational or pre-existing
on the already-proven v1.0.0 path; nothing in them blocks the tag.

---

## 1. Scope: workflow only; `tools/` byte-identical — CONFIRMED

```
$ git show --name-status --format='commit %H%nparent %P%nsubject %s' 2a290390d
commit 2a290390d67311b580ef398fd545e6d060b39897
parent ac9a09dc69f9fa69ae0e80a82ebdd3be54ea83bd
subject ci : drop the Metal packaging work from the kalsa-server release path

M	.github/workflows/kalsa-server.yml

$ git diff --stat ac9a09dc6 2a290390d -- tools/
(empty output, exit 0)

$ git diff --stat ac9a09dc6 2a290390d
 .github/workflows/kalsa-server.yml | 183 +------------------------------------
 1 file changed, 4 insertions(+), 179 deletions(-)
```

Byte-identity of `tools/` proven at the git object level, which is stronger than `--stat`:

```
$ git rev-parse ac9a09dc6:tools 2a290390d:tools
14e1fb49ec2ed67ca631f39ef564501f9b33aeed
14e1fb49ec2ed67ca631f39ef564501f9b33aeed
```

Identical tree OIDs — git cannot store different content under the same tree object. The slot
feature and its tests (c2ebfc164: `tools/server/server-context.cpp`,
`tools/server/tests/unit/test_slot_header.py`; ac9a09dc6: those plus
`tools/server/tests/{requirements.txt,utils.py}`) survive untouched.

Judgement: the commit is exactly one file, 179 deletions and 4 insertions, all four insertions
being direct restorations of the pre-Metal values (see §9). Claim holds.

## 2. No Metal residue; the surviving `GGML_METAL_EMBED_LIBRARY` is the pre-existing `=ON` — CONFIRMED

Own greps against the split commit's workflow (`git show 2a290390d:.github/workflows/kalsa-server.yml`,
941 lines, extracted to `/tmp/kalsa-v110-split-workflow.yml`):

```
[GGML_METAL_EMBED_LIBRARY=OFF] ABSENT
[GGML_METAL_NDEBUG]            ABSENT
[default\.metallib]            ABSENT
[ggml-tensor\.metallib]        ABSENT
[metallib]                     ABSENT          (case-insensitive sweep below)
[kernels/]                     ABSENT
[xcodebuild]                   ABSENT
[xcode-select]                 ABSENT
[xcrun]                        ABSENT
[Metal SDK]                    ABSENT
[Xcode]                        ABSENT
[huggingface]                  ABSENT
[--model]                      ABSENT
[hf-repo]                      ABSENT
[tinyllamas]                   ABSENT
[stories260K]                  ABSENT
[cmake-configure]              ABSENT          (the tee log of the removed work)
[tensor_metallib]              ABSENT          (step output of the removed work)
```

Case-insensitive `grep -in metal` finds exactly five lines, and every one is pre-existing:

```
54:  KALSA_MATRIX_PAIRS: "arm64:metal"
72:            backend: 'metal'
82:          #  # Metal is off on x64: GitHub's Intel runners have no GPU, upstream
84:          #  defines: "-DGGML_METAL=OFF -DCMAKE_OSX_DEPLOYMENT_TARGET=13.3"
366:            -DGGML_METAL_EMBED_LIBRARY=ON \
```

Verification that these are the pre-existing values, not leftovers:

- `916b8f0bc:.github/workflows/kalsa-server.yml` (the v1.0.0-producing branch) has the identical
  five lines at the identical line numbers (54, 72, 82, 84, 366) — and §4 proves the split
  commit's file is byte-identical to that branch's file.
- `4ccef2f85:.github/workflows/kalsa-server.yml` (the tag's own file) has
  `-DGGML_METAL_EMBED_LIBRARY=ON` at line 102. The removed work's value was `=OFF`
  (visible in the c71977809 diff reverted here). So the surviving `=ON` at line 366 is exactly
  the v1.0.0 shape: metallib embedded in `libggml-metal`, no standalone metallib — confirmed
  empirically against the published archive in §7.
- `backend: 'metal'` / `KALSA_MATRIX_PAIRS` are manifest-metadata naming (the published v1.0.0
  `manifest.json` itself says `"backend": "metal"`); they arrived with the R2/manifest machinery
  that postdates the tag and predates the published run. Not Metal packaging logic.

Judgement: nothing of the removed work survives — no flags, no metallib assertions or reports,
no `kernels/` staging, no Xcode/Metal-SDK printing, no model-loading probe. Claim holds.

## 3. The health probe is the plain model-less liveness check — CONFIRMED

The restored block, split commit lines 511–525, verbatim:

```bash
"$EXE_PATH" --port 18999 --host 127.0.0.1 > "$DEST/server.log" 2>&1 &
SERVER_PID=$!
READY=0
for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:18999/health > /dev/null; then
    READY=1
    break
  fi
  sleep 1
done
kill "$SERVER_PID" || true
if [ "$READY" -ne 1 ]; then
  cat "$DEST/server.log"
  exit 1
fi
```

The server is started with only `--port`/`--host`; no model argument exists anywhere in the
workflow (`--model`, `--hf-repo`, `tinyllamas`, `stories260K` all ABSENT per §2), so it cannot
load or fetch a model; the only `curl` in the file targets `127.0.0.1`.

Empirical confirmation: the published v1.0.0 binary (see §7 for its provenance) was run on this
macOS arm64 machine with exactly these arguments:

```
$ ./kalsa-server --version
version: 0.4.1-dev (build 11179, commit 4ccef2f85)
$ ./kalsa-server --port 18999 --host 127.0.0.1 ... ; curl -sf http://127.0.0.1:18999/health
probe READY=1 (workflow requires READY=1)
server log: "load_models: Loaded 0 cached model presets" / "Available models (0)";
grep -ci 'huggingface|download|hf-repo' server.log -> 0
```

Judgement: the probe loads no model, fetches nothing, and passes on the real v1.0.0 artifact.
Claim holds.

## 4. The release path is the one that produced published v1.0.0 — CONFIRMED

### vs `4ccef2f85` (the tag's own frozen file)

```
$ git diff --stat 4ccef2f85:./.github/workflows/kalsa-server.yml 2a290390d:./.github/workflows/kalsa-server.yml
 .github/workflows/kalsa-server.yml | 836 +++++++++++++++++++++++++++++++------
 1 file changed, 700 insertions(+), 136 deletions(-)
```

Every delta hunk was read (full 836-line diff) and belongs to exactly the commits between the
tag and the split commit (named by `git log --oneline 4ccef2f85..2a290390d`); none is Metal work:

- Header/trigger/permissions comments, `workflow_dispatch` inputs (`release_tag`, `force`),
  "Resolve target ref", `fetch-tags: true`, "Assert the build is the tag", tag/version handling
  reworked onto `is_release` — the tag-dispatch + R2 machinery (`635ea0ed2`, `916b8f0bc`).
  Legitimate: the tag's own file is frozen; the published v1.0.0 manifest itself records
  `"trigger": "workflow_dispatch with release_tag"` and `"ref": "refs/tags/kalsa-server-v1.0.0"`,
  i.e. the published archive was produced by exactly this machinery.
- `KALSA_MATRIX_PAIRS` + "Check matrix identity" + `backend:` field — manifest-metadata
  invariant assertions (same machinery).
- Reusable `ui-build.yml` job, `download-artifact`, and the `release:` job with `gh release`
  removed; inline setup-node/npm UI build, `Provenance` step, `Publish to R2` with manifest,
  immutability check and recount — `3a4d5143e` (self-contained) and `635ea0ed2`/`f404d9180`/
  `916b8f0bc` (R2 + head-object). The brief pre-authorises these as legitimate post-tag
  machinery; the manifest ties them to the actual published artifact.
- Build flags unchanged from the tag: `-DGGML_METAL_EMBED_LIBRARY=ON`,
  `-DLLAMA_USE_PREBUILT_UI=OFF`, `-DLLAMA_BUILD_BORINGSSL=ON`, RPATH flags, plain
  `cmake --build`. No trace of the Metal work anywhere in this delta.

### vs `916b8f0bc` (the sharper test)

```
$ git diff 916b8f0bc:./.github/workflows/kalsa-server.yml 2a290390d:./.github/workflows/kalsa-server.yml
(empty output, exit 0)

$ git rev-parse 916b8f0bc:.github/workflows/kalsa-server.yml 2a290390d:.github/workflows/kalsa-server.yml
26ce5d05ada1ee563c47063fd6d39a7ae590b09d
26ce5d05ada1ee563c47063fd6d39a7ae590b09d
```

The delta is not merely "only slot-related test-rig additions" (the brief's expectation) — it is
EMPTY. Identical blob IDs. This is stronger than expected and correct: the slot test-rig never
lived in the workflow. c2ebfc164 touched only `tools/server/*`; ac9a09dc6's only workflow change
was the Metal probe hunk (verified: `git show ac9a09dc6 -- .github/workflows/kalsa-server.yml`
shows solely the `--hf-repo ggml-org/models --hf-file tinyllamas/stories260K.gguf -ngl 99` probe
and its fail-closed lookup classification), and this commit reverts exactly that. The slot
test-rig files live in `tools/server/tests/*`, which §1 proves untouched.

Empirical anchor: the published `https://dl.kalsa.io/kalsa-server/v1.0.0/manifest.json` names
run 35549848243, commit `4ccef2f85`, `pack_sha256 3fe62ebf…`, `size_bytes 11203439` — and the
archive downloaded from the manifest URL hashes to exactly that value (§7), so the machinery in
this workflow demonstrably produced the published bytes.

Judgement: the tagged commit's release path is byte-for-byte the workflow that produced the
published v1.0.0, plus nothing. Claim holds.

## 5. Every release control survives — CONFIRMED

All quotes are from `2a290390d:.github/workflows/kalsa-server.yml` at the lines given.

- **Tag-ref checkout** (L142 sets `REF="refs/tags/${TAG}"`; L156–164):
  ```yaml
      - name: Clone
        uses: actions/checkout@v6
        with:
          ref: ${{ steps.target.outputs.ref }}
          fetch-depth: 0
          # the assert step below resolves refs/tags/<tag>^{commit} locally
          fetch-tags: true
  ```
- **`HEAD == refs/tags/<tag>^{commit}` assertion** (L166–182):
  ```bash
  TAG_SHA="$(git rev-parse "refs/tags/${KALSA_TAG}^{commit}")"
  ...
  if [ "$HEAD_SHA" != "$TAG_SHA" ]; then
    echo "HEAD ${HEAD_SHA} is not ${KALSA_TAG} (${TAG_SHA}): a release builds only from its tag" >&2
    exit 1
  fi
  ```
- **Version derived from the tag, prefix stripped** (L219–228):
  ```bash
  if [ "${KALSA_IS_RELEASE}" -eq 1 ]; then
    VERSION="${REF_SAFE#kalsa-server-}"
    case "$VERSION" in
      ""|kalsa-server-*)
        echo "tag '$REF' leaves '${VERSION}', which is empty or still kalsa-server- prefixed" >&2
        exit 1
        ;;
    esac
  ```
- **Three `head-object` immutability checks with exit classification** (loop L741–752 over
  `"${TAR}" "${DIGEST}" "${MANIFEST}"`; classifier L731; abort L743–747):
  ```bash
  if grep -Eqi '404|Not Found|NoSuchKey' "${err}"; then
    HEAD_STATE="absent"
  else
    HEAD_STATE="error"
  fi
  ...
  error)
    echo "existence check FAILED for ${S3_PREFIX}/${name}: head-object returned neither a 404 nor a success (exit ${HEAD_RC}); nothing may be published, and force=true does not bypass a failed check" >&2
    exit 1
  ```
  The `force` bypass (L787–792) triggers only on `exists`, never on `error`:
  ```bash
  if [ "${FORCE}" = "true" ]; then
    echo "OVERWRITING: ${S3_PREFIX}/ holds an immutable version and force=true was dispatched; ..." >&2
  else
    echo "refusing to overwrite ${S3_PREFIX}/: those keys are immutable; dispatch with force=true to replace them" >&2
    exit 1
  fi
  ```
- **Post-upload recount** (L897–921): re-heads the same three keys; `absent` → exit 1;
  `error` → exit 1; `ContentLength` mismatch → exit 1; prints `recount OK: … bytes`.
- **Double pack with comparison** (L412–421):
  ```bash
  pack
  FIRST="$(shasum -a 256 "$TAR" | awk '{print $1}')"
  pack
  SECOND="$(shasum -a 256 "$TAR" | awk '{print $1}')"
  ...
  if [ "$FIRST" != "$SECOND" ]; then
    echo "packing is not reproducible: pack 1 ${FIRST}, pack 2 ${SECOND}" >&2
    exit 1
  fi
  ```
- **RPATH check over every Mach-O** (L468–509): enumerates every file, filters
  `file -b … | grep -q '^Mach-O'`, then per dependency: `@rpath/*` must exist inside the
  archive, `/usr/lib/*` and `/System/Library/*` allowed, anything else → `BAD=1`; broken
  symlinks → `BAD=1`; final `test "$BAD" -eq 0` (L509).
- **`--version` run** (L463): `"$EXE_PATH" --version` — with `set -euo pipefail`, a binary that
  will not start fails the step.
- **Archive-name normalization** (L394, with inputs from L217 and L239–248):
  ```bash
  TAR="kalsa-server-${KALSA_VERSION}-bin-macos-${KALSA_ARCH}.tar.gz"
  ```
  fed by `REF_SAFE="$(printf '%s' "$REF" | tr '/' '-')"` (L217), the
  `*[!A-Za-z0-9._-]*` allowlist hard error (L239–244) and length caps; the pack itself
  normalizes bytes (L402–407: fixed mtimes, `--numeric-owner --uid 0 --gid 0`, `--no-xattrs
  --no-mac-metadata`, `gzip:!timestamp`). The R2 step re-validates the tag/version charset
  (L601–623) and rejects unexpected workspace artifacts (L666–682).
- **`contents: read`** (L45–48):
  ```yaml
  # the repository is read-only for every job: a tagged run writes to R2, not
  # to this repository
  permissions:
    contents: read
  ```

Judgement: every control from the v1.0.0-producing path is present verbatim (the file IS that
path, §4). Claim holds.

## 6. Workflow validity — CONFIRMED

`actionlint` is installed and was run:

```
$ actionlint --version
1.7.12 (installed from Homebrew, go1.26.3)
$ git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-v110 show '2a290390d:.github/workflows/kalsa-server.yml' | actionlint -
exit=0, no output
```

`bash -n` on every `run:` block: all 14 blocks extracted with PyYAML from the split-commit blob;
each block written to a file with `${{ … }}` expressions replaced by an inert `__GHA_EXPR__`
placeholder (GitHub interpolates expressions before the shell runs; substitution was needed only
for the `Build` step's `${{ matrix.defines }}`), then `bash -n`:

```
[OK] bash -n exit=0 job=macos step='Resolve target ref'      expr_subst=False
[OK] bash -n exit=0 job=macos step='Assert the build is the tag'  expr_subst=False
[OK] bash -n exit=0 job=macos step='Determine version'       expr_subst=False
[OK] bash -n exit=0 job=macos step='Check matrix identity'   expr_subst=False
[OK] bash -n exit=0 job=macos step='Install UI dependencies' expr_subst=False
[OK] bash -n exit=0 job=macos step='Build UI'                expr_subst=False
[OK] bash -n exit=0 job=macos step='Run PWA unit tests'      expr_subst=False
[OK] bash -n exit=0 job=macos step='Check UI assets'         expr_subst=False
[OK] bash -n exit=0 job=macos step='Build'                   expr_subst=True
[OK] bash -n exit=0 job=macos step='Rename server binary'    expr_subst=False
[OK] bash -n exit=0 job=macos step='Pack artifacts'          expr_subst=False
[OK] bash -n exit=0 job=macos step='Verify artifacts'        expr_subst=False
[OK] bash -n exit=0 job=macos step='Provenance'              expr_subst=False
[OK] bash -n exit=0 job=macos step='Publish to R2'           expr_subst=False
total run blocks: 14, failures: 0
```

Judgement: actionlint clean, all 14 shell blocks syntax-valid. Claim holds.

## 7. Mutation test — CONFIRMED effective (removal is real; re-introduction is detectable)

Scratch copy only — `/tmp/kalsa-mutation/`; the repo was never touched. Two removed items were
re-introduced into a copy of the split-commit workflow:

```diff
--- original.yml  (2a290390d)          +++ mutated.yml
             -DLLAMA_BUILD_TESTS=OFF \
             -DGGML_METAL_EMBED_LIBRARY=ON \
+            -DGGML_METAL_NDEBUG=ON \          ← Mutation A
             -DLLAMA_USE_PREBUILT_UI=OFF \
...
           test -x "$BIN/kalsa-server"
           test ! -e "$BIN/llama-server"
+          test -f "$BIN/default.metallib"     ← Mutation B
```

Ground truth: the published v1.0.0 archive was downloaded and hash-verified
(`sha256 3fe62ebfe7fd9ddd21fa8857f68f2c34bfc8557fb1811b54f89012260c5c88a7` ==
manifest `pack_sha256`; 11,203,439 bytes == `size_bytes`), extracted, and its full listing read:
**no `default.metallib`, no `ggml-tensor.metallib`, no `kernels/`** — the Metal kernels ship
embedded inside `libggml-metal.0.24.0.dylib` (2,181,384 bytes), exactly the EMBED=ON shape.

**Mutation B is a real break, demonstrated end-to-end against the real published artifact.**
The mutated Verify step's opening assertions were executed in order against the extracted
v1.0.0 tree under the step's own `set -euo pipefail`:

```
PASS test -x kalsa-server
PASS test ! -e llama-server
FAIL test -f default.metallib -> exit 1
```

With the assertion restored, the Verify step aborts at exactly that line on a v1.0.0-shaped
archive — the release cannot publish. This matches ggml's build rules at the split commit:
`ggml/src/ggml-metal/CMakeLists.txt` installs `kernels/` and the metallibs into the bindir only
under `if (NOT GGML_METAL_EMBED_LIBRARY)` (L230–241); with `=ON` none of them are part of the
shaped archive.

**Mutation A is a source-derived demonstration, not a build-verified one.**
`-DGGML_METAL_NDEBUG=ON` flips the `ggml/CMakeLists.txt:239` option (default `OFF`) into
`add_compile_definitions(GGML_METAL_NDEBUG)` (`ggml/src/ggml-metal/CMakeLists.txt:24–26`), which
compiles the Metal debugging paths out of `ggml-metal-context.m:90` and `ggml-metal-device.m:1994`.
The shipped `libggml-metal` dylib therefore compiles to different bytes than any build of the
proven path, so the released `pack_sha256` could not be the v1.0.0 shape. A full local Metal
build to hash-verify this was out of scope (30+ min build); the claim rests on the compile
definition, which is unconditional when the flag is set.

Honesty statement, as required: neither mutation falsifies Claim 2 — absence at the commit is
already settled by the greps in §2. What the mutations establish is that the removal is
*effective*: re-introducing a removed item either hard-breaks the release (B, demonstrated
against the real artifact) or silently moves the artifact off the proven v1.0.0 shape (A,
source-derived).

## 8. Network dependencies on the release path — CONFIRMED, none newly introduced

Enumeration from the split-commit workflow and the tree at `2a290390d`:

| Dependency | Where | Classification |
|---|---|---|
| `actions/checkout@v6` (repo clone + tags, GitHub) | L157 | pre-existing (tag file and `916b8f0bc` both have it) |
| `actions/setup-node@v6` (Node 24 toolchain download) | L328 | pre-existing on the v1.0.0-producing path (`916b8f0bc`, byte-identical file); absent from the tag's own frozen file, where Node ran in the reusable ubuntu `ui-build` job — movement onto the macos leg is `3a4d5143e`, which predates the published run |
| `npm ci` (npm registry) | L333 | same as setup-node |
| `npx vitest` | L344 | no fetch: vitest 4.1.10 is a pinned devDependency (`tools/ui/package.json:103`), resolved from `node_modules` installed by `npm ci` |
| **BoringSSL via CMake FetchContent** | `vendor/cpp-httplib/CMakeLists.txt:45–68` | **network git clone of `https://boringssl.googlesource.com/boringssl` @ `0.20260903.0` during cmake configure.** Pre-existing: `-DLLAMA_BUILD_BORINGSSL=ON` is in the tag's own file (4ccef2f85 Build step) and in `916b8f0bc`; the vendored file's last change is upstream `38521ec33`, long predating the tag. See Finding 1. |
| Hugging Face UI-asset fallback | `scripts/ui-assets.cmake` | inert on this path, doubly shut: priority-1 early `return()` when `tools/ui/dist/index.html` exists (workflow enforces it at L347–351), and the fallback additionally requires `HF_ENABLED=ON` while the build sets `-DLLAMA_USE_PREBUILT_UI=OFF` → `-DHF_ENABLED=OFF` (`tools/ui/CMakeLists.txt:53`) |
| `cmake/download-models.cmake` (HF model downloads) | `tests/CMakeLists.txt:292`, `examples/eval-callback` | not on path: only ctest fixtures, and `-DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF` |
| `curl http://127.0.0.1:18999/health` | L515 | loopback only; pre-existing (the tag's file had the same probe) |
| R2: `head-object` ×6, `list-objects-v2` ×1 (advisory), `aws s3 cp` ×3 | L721, L759, L874–890 | release-only; pre-existing on the v1.0.0-producing path — this exact machinery published v1.0.0; legitimately postdates the tag |
| ~~HF model fetch `--hf-repo ggml-org/models --hf-file tinyllamas/stories260K.gguf`~~ | removed | **removed by this commit** (ac9a09dc6's Metal probe hunk) — this is the fetch that made the Metal half unacceptable for a release |

Only first-party actions are used (`actions/checkout@v6`, `actions/setup-node@v6`). Net: the
commit only deletes; zero network dependencies are newly introduced by it. The one live external
build-time fetch (BoringSSL) is inherited unchanged from the proven v1.0.0 path.

## 9. Style — CONFIRMED

- **File size**: the commit does not grow anything — it shrinks the workflow 1116 → 941 lines
  (net −175; 179 deletions, 4 insertions). "Already longer" is true: 941 lines at `916b8f0bc`
  (pre-Metal), 1104 at c71977809, 1116 at the parent; only 377 at the tag. The 941-line size
  predates this commit and is the v1.0.0 shape.
- **Comments**: the diff's only comment change trims the BoringSSL comment back to its pre-Metal
  WHY (pinned 0.20260903.0, static, so `-hf` HTTPS does not depend on runner OpenSSL). All
  surviving comments state WHY or traps (spot-checked L45–48, L88–93, L136–141, L319–326,
  L353–354, L684–713, L892–896). No narrating comments introduced.
- **Dead code**: none. `steps.metal`, `KALSA_TENSOR_METALLIB`, `metal_path`, `tensor_metallib`,
  `cmake-configure.log`, `SERVER_ARGS`, and the "Document the Metal fallback" step are all
  ABSENT from the split file. Remaining `backend` uses are the matrix-identity assertion and
  manifest metadata — matching the published v1.0.0 manifest's `"backend": "metal"`.
- **No unrelated refactoring**: read hunk by hunk, all 179 deletions and all 4 insertions are
  reversions of the Metal half to its pre-Metal values (`=ON` flag, restored plain configure
  line without `tee`, trimmed comment, restored plain server-start line). Nothing else moves.

---

## Findings (ordered by severity)

1. **LOW — pre-existing, NOT introduced by this commit; do not "fix" in this tag.**
   Every release build (including the one that produced v1.0.0) clones BoringSSL live from
   `https://boringssl.googlesource.com/boringssl` at tag `0.20260903.0` during cmake configure
   (`vendor/cpp-httplib/CMakeLists.txt:45–68`, enabled by `-DLLAMA_BUILD_BORINGSSL=ON`,
   `.github/workflows/kalsa-server.yml:368`). Release reproducibility therefore also depends on
   googlesource availability and on that upstream tag never moving. Pinning a vendored tarball
   with a hash would close it, but that is a future change — touching it now would invalidate
   the "proven v1.0.0 path" property this whole commit exists to restore.
2. **INFO — brief expectation exceeded.** The sharper diff (`916b8f0bc` vs split commit) is
   empty, not "slot test-rig only": the slot test-rig never touched the workflow (it lives in
   `tools/server/tests/*`, proven untouched in §1), and ac9a09dc6's sole workflow hunk was the
   Metal probe, fully reverted here. The tagged commit's release path is byte-identical to the
   one that produced the published v1.0.0.
3. **INFO — naming only.** `backend: 'metal'` (`kalsa-server.yml:72`) and
   `KALSA_MATRIX_PAIRS: "arm64:metal"` (`:54`) keep the string "metal" in matrix/manifest
   metadata. Identical to the published v1.0.0 manifest; not Metal packaging work. No action.
4. **INFO — vs the tag's frozen file.** Node download and `npm ci` sit on the macOS release leg
   here, whereas the tag's own 377-line file ran them in a reusable ubuntu job. This movement
   predates the published v1.0.0 run, which used it; classified pre-existing (§8). No action.

## Bottom line

Nothing must change before the tag. Commit `2a290390d` does exactly what it claims and nothing
else: the release path at the tagged commit is the byte-identical workflow that produced the
published, hash-verified `kalsa-server-v1.0.0`, every release control survives verbatim, the
removed Metal half is provably gone (and its re-introduction is detectable: it would break the
release against the real v1.0.0 shape), and the one unacceptable network fetch of the Metal half
is among the removed code.

*All checks completed; none skipped. Raw outputs trimmed only where marked; the trimmed regions
were read in full during the review. Review performed read-only; scratch files under `/tmp`
(`/tmp/kalsa-v110-split-workflow.yml`, `/tmp/kalsa-v100-check/`, `/tmp/kalsa-mutation/`).*
