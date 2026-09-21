# Final pre-integration review

Targets reviewed read-only:

- CI: `/Users/marco/.paseo/worktrees/0f85s4e7/kalsa-server-ci`, branch
  `kalsa-server-ci`, HEAD `add4e4937` on `bd1c9510c`.
- Engine: `/Users/marco/.paseo/worktrees/0f85s4e7/server-checkpoint-fix`,
  branch `server-checkpoint-fix`, HEAD `45a0016e9`.

## Verdict summary

### Target A — server CI

1. **CONFIRMED** — manual dispatch and push to `b11010-merge` are enabled;
   the `kalsa-*` tag slot is commented.
2. **CONFIRMED** — only the new Kalsa workflow is in the diff; upstream
   `release.yml` is untouched.
3. **CONFIRMED** — the reusable UI workflow artifact is required before the
   build, the source `index.html` is checked, and `LLAMA_USE_PREBUILT_UI=OFF`
   disables the HF fallback while the prebuilt source directory has priority.
4. **CONFIRMED** — the workflow uses workspace-relative build paths and the
   requested flags; the checked-in Mac build cache shows those flags in use.
5. **REFUTED** — the existing artifact proves the requested naming/layout,
   rename, dylib inclusion, and checksum shape, but the workflow never packs
   twice or compares hashes. Stable SHA-256 reproducibility is not established,
   and archive ordering/owner normalization is not explicitly controlled.
6. **UNVERIFIABLE** — source and an existing artifact confirm the target name,
   version command, direct RPATH check, and health probe are wired correctly,
   but the live health probe could not bind a local port in this sandbox and no
   CI run result is present.
7. **REFUTED** — arm64-only is explicitly justified and the trigger is correct,
   but the version inserted into filenames is not bounded or shell-safe for
   arbitrary manual refs.

### Target B — engine round-3 fix

8. **CONFIRMED** — unknown non-SCKP trailer data now throws while an exact
   EOF-at-core-state file remains a legacy success.
9. **CONFIRMED, with new failure-path and cleanup/security issues** — save
   writes to a same-directory temporary path and renames only after validation,
   preserving the old target when the guarded part fails. The core save call is
   outside that guard and can throw on open/write failure; cleanup errors are
   ignored, and the predictable `.tmp` path is not exclusive/no-symlink-safe.

## Target A: server CI workflow

### A1. Trigger

**Verdict: CONFIRMED.**

~~~text
Command:
cd /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-server-ci
nl -ba .github/workflows/kalsa-server.yml | sed -n '11,20p'
~~~

Output:

~~~text
11  on:
12    workflow_dispatch: # allows manual triggering
13    push:
14      branches:
15        - b11010-merge
16    # KALSA-OWNED: the kalsa-* release tag trigger goes here later. The push
17    # trigger ORs branches and tags, so uncommenting the tags key is enough:
18    # tags:
19    #   - 'kalsa-*'
~~~

There is no active tag trigger. Manual dispatch is available on the selected
ref, while push automation is limited to the stated merge branch.

### A2. Upstream release workflow

**Verdict: CONFIRMED.**

~~~text
Command:
git diff --name-only b11010-merge..HEAD
git diff --quiet b11010-merge..HEAD -- .github/workflows/release.yml; echo "release-diff-exit=$?"
~~~

Output:

~~~text
.github/workflows/kalsa-server.yml
release-diff-exit=0
~~~

The only changed path is the new Kalsa-owned workflow.

### A3. UI artifact and network fallback

**Verdict: CONFIRMED.** The macOS job waits for the reusable UI job, downloads
`llama-ui.zip` into the source `tools/ui/dist`, and fails before CMake if
`index.html` is absent:

~~~text
Command:
nl -ba .github/workflows/kalsa-server.yml | sed -n '28,35p;66,76p;85,95p'
nl -ba tools/ui/CMakeLists.txt | sed -n '44,56p'
nl -ba scripts/ui-assets.cmake | sed -n '520,527p;543,547p'
~~~

Relevant output:

~~~text
29  ui-build:
35    uses: ./.github/workflows/ui-build.yml
66  - name: Download UI build
68      name: llama-ui.zip
69      path: tools/ui/dist
72  - name: Check UI assets
76    test -f tools/ui/dist/index.html
85  cmake -B build \
87    -DLLAMA_BUILD_SERVER=ON \
92    -DLLAMA_USE_PREBUILT_UI=OFF \
...
44  add_custom_target(llama-ui-assets ALL
53      "-DHF_ENABLED=${LLAMA_USE_PREBUILT_UI}"
56      -P "${PROJECT_SOURCE_DIR}/scripts/ui-assets.cmake"
523  if(EXISTS "${SRC_DIST_DIR}/index.html")
524      message(STATUS "UI: using pre-built assets from ${SRC_DIST_DIR}")
525      emit_files("${SRC_DIST_DIR}")
526      return()
546  if(NOT provisioned AND HF_ENABLED)
~~~

The order matters: the script consumes the downloaded source assets and
returns before it reaches the HF branch. `LLAMA_USE_PREBUILT_UI=OFF` becomes
`HF_ENABLED=OFF`, so the `latest` candidate cannot be reached in this build.
This does not prohibit unrelated build-time dependency downloads; it closes
the UI asset fallback that could otherwise change the shipped UI.

The local Mac build cache independently records the same setting and the
prebuilt source path:

~~~text
Command:
rg -n 'LLAMA_USE_PREBUILT_UI|HF_ENABLED|UI_SOURCE_DIR' build/CMakeCache.txt \
  build/tools/ui/CMakeFiles/llama-ui-assets.dir/build.make
~~~

Output:

~~~text
build/CMakeCache.txt:796:LLAMA_USE_PREBUILT_UI:BOOL=OFF
build/tools/ui/CMakeFiles/llama-ui-assets.dir/build.make:71: ... -DUI_SOURCE_DIR=/Users/marco/.paseo/worktrees/0f85s4e7/kalsa-server-ci/tools/ui ... -DHF_ENABLED=OFF ...
~~~

### A4. Workspace build and Mac flags

**Verdict: CONFIRMED.** All build commands are relative to the default
GitHub Actions workspace; only verification extraction deliberately uses a
temporary directory. The requested flags and RPATH settings are present:

~~~text
Command:
nl -ba .github/workflows/kalsa-server.yml | sed -n '78,96p'
rg -n 'CMAKE_BUILD_WITH_INSTALL_RPATH|CMAKE_INSTALL_RPATH|CMAKE_OSX_DEPLOYMENT_TARGET|GGML_METAL_EMBED_LIBRARY|LLAMA_BUILD_(SERVER|TOOLS|EXAMPLES|TESTS)|LLAMA_USE_PREBUILT_UI' build/CMakeCache.txt
~~~

Output:

~~~text
78  # Build in the workspace, never in /tmp
85  cmake -B build \
87    -DLLAMA_BUILD_SERVER=ON \
88    -DLLAMA_BUILD_TOOLS=ON \
89    -DLLAMA_BUILD_EXAMPLES=OFF \
90    -DLLAMA_BUILD_TESTS=OFF \
91    -DGGML_METAL_EMBED_LIBRARY=ON \
92    -DLLAMA_USE_PREBUILT_UI=OFF \
94    -DCMAKE_INSTALL_RPATH='@loader_path' \
95    -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON
96  cmake --build build --config Release -j "$(sysctl -n hw.logicalcpu)"
69:CMAKE_BUILD_WITH_INSTALL_RPATH:UNINITIALIZED=ON
177:CMAKE_INSTALL_RPATH:UNINITIALIZED=@loader_path
232:CMAKE_OSX_DEPLOYMENT_TARGET:UNINITIALIZED=13.3
526:GGML_METAL_EMBED_LIBRARY:BOOL=ON
734:LLAMA_BUILD_EXAMPLES:BOOL=OFF
743:LLAMA_BUILD_SERVER:BOOL=ON
746:LLAMA_BUILD_TESTS:BOOL=OFF
749:LLAMA_BUILD_TOOLS:BOOL=ON
796:LLAMA_USE_PREBUILT_UI:BOOL=OFF
~~~

This is source-level confirmation plus a local Mac configure record, not a
fresh execution of the GitHub runner.

### A5. Packaging and reproducibility

**Verdict: REFUTED** for the reproducibility claim; the packaging shape itself
is confirmed.

The workflow creates the requested names, fixes file timestamps, disables
AppleDouble metadata, disables the gzip timestamp, and emits a sibling
checksum:

~~~text
Command:
nl -ba .github/workflows/kalsa-server.yml | sed -n '98,132p'
~~~

Output:

~~~text
98  - name: Rename server binary
103    cd build/bin
104    if [ -L llama-server ]; then
107      mv "$TARGET" kalsa-server
109      mv llama-server kalsa-server
118    cp LICENSE ./build/bin/
121    find ./build/bin -exec touch -h -t 202001010000.00 {} +
122    TAR="kalsa-server-${{ steps.tag.outputs.name }}-bin-macos-${{ matrix.build }}.tar.gz"
126    COPYFILE_DISABLE=1 tar -czf "$TAR" \
127      --options 'gzip:!timestamp' \
128      --no-mac-metadata \
129      -s ",^\.,kalsa-server-${{ steps.tag.outputs.name }}," \
130      -C ./build/bin .
131    shasum -a 256 "$TAR" > "$TAR.sha256"
~~~

An existing local artifact confirms the resulting layout and rename shape:

~~~text
Command:
ART=$(find build/artifacts -maxdepth 1 -name 'kalsa-server-*.tar.gz' -print -quit)
tar -tzf "$ART" | awk -F/ 'NF==2 {print $1}' | sort -u
tar -tzf "$ART" | grep -E '/(kalsa-server|llama-server)$' || true
tar -tzf "$ART" | grep -E '/(llama-cli|llama-bench|governor-bench)$' | head -5
shasum -a 256 "$ART"; cat "$ART.sha256"
~~~

Output:

~~~text
kalsa-server-kalsa-server-ci-b11170-bd1c951
kalsa-server-kalsa-server-ci-b11170-bd1c951/kalsa-server
kalsa-server-kalsa-server-ci-b11170-bd1c951/llama-cli
kalsa-server-kalsa-server-ci-b11170-bd1c951/llama-bench
kalsa-server-kalsa-server-ci-b11170-bd1c951/governor-bench
469b949be61183dbd8e5009627e76313a95e6fe53de392af1eb32a12feaf764a  build/artifacts/kalsa-server-kalsa-server-ci-b11170-bd1c951-bin-macos-arm64.tar.gz
469b949be61183dbd8e5009627e76313a95e6fe53de392af1eb32a12feaf764a  kalsa-server-kalsa-server-ci-b11170-bd1c951-bin-macos-arm64.tar.gz
~~~

That artifact is evidence of shape, not a current GitHub run result. The
workflow does not create a second archive from the same tree, compare the two
hashes, normalize archive member order, or normalize uid/gid/mode metadata.
Fixed mtimes and gzip headers are necessary but do not establish a stable
digest across two packs. The comment claiming that identical inputs produce a
stable digest is therefore stronger than the steps prove.

The archive's direct and transitive Mach-O RPATH closure was checked locally
as an additional shape check:

~~~text
Command:
ART=$(find build/artifacts -maxdepth 1 -name 'kalsa-server-*.tar.gz' -print -quit)
DEST=$(mktemp -d); tar -xzf "$ART" -C "$DEST"; ROOT=$(find "$DEST" -mindepth 1 -maxdepth 1 -type d -print -quit)
checked=0; missing=0; for f in "$ROOT"/*; do file "$f" | grep -q 'Mach-O' || continue; checked=$((checked + 1)); while read -r lib; do test -e "$ROOT/${lib#@rpath/}" || { echo "MISSING $(basename "$f") $lib"; missing=$((missing + 1)); }; done < <(otool -L "$f" | tail -n +2 | awk '{print $1}' | grep '^@rpath/'); done; printf 'mach-o-files-checked=%s missing=%s\n' "$checked" "$missing"
~~~

Output:

~~~text
mach-o-files-checked=56 missing=0
~~~

The workflow itself only runs the RPATH loop over the server binary, not over
each packaged dylib. The local artifact passed the stronger recursive check.

### A6. Verification and CMake target

**Verdict: UNVERIFIABLE** for the complete live verification; the wiring is
confirmed statically.

The workflow checks the extracted top-level path, executable/rename state,
version output, direct RPATH dependencies, and `/health` with a 60-second
retry loop:

~~~text
Command:
nl -ba .github/workflows/kalsa-server.yml | sed -n '134,169p'
nl -ba tools/CMakeLists.txt | sed -n '25,30p;59,67p'
~~~

Output:

~~~text
136  TAR="kalsa-server-${{ steps.tag.outputs.name }}-bin-macos-${{ matrix.build }}.tar.gz"
138  tar -xzf "$TAR" -C "$DEST"
139  BIN="$DEST/kalsa-server-${{ steps.tag.outputs.name }}"
140  test -x "$BIN/kalsa-server"
141  test ! -e "$BIN/llama-server"
142  "$BIN/kalsa-server" --version
145  otool -L "$BIN/kalsa-server" | ... | grep '^@rpath/' > "$DEST/deps.txt"
153  test "$MISSING" -eq 0
155  "$BIN/kalsa-server" --port 18999 --host 127.0.0.1 ... &
159  if curl -sf http://127.0.0.1:18999/health > /dev/null; then
166  if [ "$READY" -ne 1 ]; then
25  if (LLAMA_BUILD_SERVER)
28      add_subdirectory(server)
61  set(TARGET llama-server)
63  add_executable(${TARGET} main.cpp)
~~~

The local extracted binary ran `--version`, and its build files still name the
CMake target `llama-server`. A local attempt to reproduce the health probe was
blocked by the execution sandbox's port restriction:

~~~text
Command:
ART=$(find build/artifacts -maxdepth 1 -name 'kalsa-server-*.tar.gz' -print -quit); DEST=$(mktemp -d /tmp/kalsa-ci-health.XXXXXX); tar -xzf "$ART" -C "$DEST"; ROOT=$(find "$DEST" -mindepth 1 -maxdepth 1 -type d -print -quit); "$ROOT/kalsa-server" --port 18997 --host 127.0.0.1 >"$DEST/server.log" 2>&1 & pid=$!; ready=0; for _ in $(seq 1 20); do if curl -sf http://127.0.0.1:18997/health >/dev/null; then ready=1; break; fi; sleep 1; done; printf 'health_ready=%s\n' "$ready"; kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
~~~

Output:

~~~text
couldn't bind HTTP server socket, hostname: 127.0.0.1, port: 18997
health_ready=0
~~~

No successful CI run artifact or log was available, so the actual 200 response
cannot be confirmed here. Also, the workflow's `otool` loop checks direct
server dependencies; a future change introducing a missing dependency of a
dylib would not be caught by that step, although the existing artifact passed
the recursive local check.

### A7. x64 and version safety

**Verdict: REFUTED** because the version input is not bounded, despite the
explicit x64 decision being documented.

The matrix has only arm64; x64 is disabled with a cost/ship-scope reason:

~~~text
Command:
nl -ba .github/workflows/kalsa-server.yml | sed -n '41,56p'
~~~

Output:

~~~text
41  matrix:
43    - build: 'arm64'
44      os: macos-26
46  # TODO: x64 is present but disabled ...
48  #       at 10x the Linux rate ... the desktop client ships arm64 only.
51  #- build: 'x64'
52  #  os: macos-15-intel
~~~

That satisfies the stated x64 requirement. The artifact version is generated
by a shared action that only replaces `/` and otherwise interpolates the
branch/ref into a shell script and filename:

~~~text
Command:
nl -ba .github/actions/get-tag-name/action.yml | sed -n '14,22p'
for ref in 'foo bar' 'foo$(id)' 'foo#bar'; do
  git check-ref-format "refs/heads/$ref" >/dev/null 2>&1 && echo "allowed: $ref" || echo "rejected: $ref"
done
~~~

Output:

~~~text
15  BUILD_NUMBER="$(git rev-list --count HEAD)"
17  if [[ "${{ env.BRANCH_NAME }}" == "master" || "${{ env.BRANCH_NAME }}" == "b${BUILD_NUMBER}" ]]; then
20    SAFE_NAME=$(echo "${{ env.BRANCH_NAME }}" | tr '/' '-')
21    echo "name=${SAFE_NAME}-b${BUILD_NUMBER}-${SHORT_HASH}" >> $GITHUB_OUTPUT
rejected: foo bar
allowed: foo$(id)
allowed: foo#bar
~~~

For the fixed push branch this produces a safe-looking name. But
`workflow_dispatch` can run on another ref, and a branch containing shell
metacharacters such as `foo$(id)` is a valid Git ref. The expression expansion
inside the double-quoted shell source is not a bounded artifact-version
contract and can become command substitution/injection. The action should
consume the value through an environment variable and validate/allowlist the
result before using it in filenames and shell.

## Target B: engine round-3 confirmation

### B1. Unknown trailer versus legacy EOF

**Verdict: CONFIRMED.** The new branch checks the remaining length before
reading magic. Only an exact core-state EOF is accepted as legacy; every
non-empty non-SCKP suffix, including a one-byte to three-byte short suffix,
throws. The call remains inside the restore `try`/`catch`, which clears the
slot and sends the controlled error.

~~~text
Command:
nl -ba tools/server/server-context.cpp | sed -n '2491,2510p;2831,2841p'
nl -ba tools/server/tests/unit/test_slot_save.py | sed -n '844,878p'
~~~

Output:

~~~text
2491  const size_t remaining = ...;
2501  if (remaining == 0) {
2502      return 0; // the state payload ends the file: a genuine legacy save
2504  if (!ckpt_read(...) || magic != SLOT_CKPT_MAGIC) {
2505      throw std::runtime_error("malformed slot save file: unknown data after the state payload");
2836  nread_ckpt = load_slot_checkpoints(filepath, nread, *slot);
2837  } catch (const std::exception & err) {
2838      slot->prompt_clear();
2839      send_error(task, std::string("Unable to restore slot: ") + err.what(), ...);
~~~

~~~text
844  def test_slot_restore_rejects_unknown_trailing_data(swa_server):
857      # exact no-appendix (legacy) file: accepted
859      assert res.status_code == 200
869      for trailer in (b"NOPE", b"XY"):
875          assert res.status_code != 200, f"unknown trailing data {trailer!r} must be rejected"
~~~

The new test covers both a readable wrong magic and a short non-empty suffix.

### B2. Atomic save

**Verdict: CONFIRMED**, with new issues in failure containment.

The save path writes the complete core state to `filepath + ".tmp"`, appends
and size-checks the appendix there, then renames that same-directory path over
the target. The old target is not opened with `"wb"` and is therefore left in
place when the guarded appendix/rename path fails:

~~~text
Command:
nl -ba tools/server/server-context.cpp | sed -n '2729,2771p'
nl -ba src/llama-context.cpp | sed -n '3297,3301p'
nl -ba src/llama-mmap.cpp | sed -n '87,91p;358,366p'
nl -ba tools/server/server-context.cpp | sed -n '2541,2546p'
nl -ba tools/server/server-queue.cpp | sed -n '138,155p'
~~~

Output:

~~~text
2729  std::string filename = task.slot_action.filename;
2730  std::string filepath = task.slot_action.filepath;
2733  const std::string tmppath = filepath + ".tmp";
2746  std::filesystem::remove(tmppath, ec);
2748  const size_t nwrite = llama_state_seq_save_file(ctx_tgt, tmppath.c_str(), ...);
2751  if (nwrite == 0) {
2752      std::filesystem::remove(tmppath, ec);
2757  size_t nwrite_ckpt = 0;
2759  nwrite_ckpt = save_slot_checkpoints(tmppath, *slot, nwrite);
2762  std::filesystem::rename(tmppath, filepath, ec_rename);
2766  } catch (...) {
2768      std::filesystem::remove(tmppath, ec_remove);
3297  size_t llama_context::state_seq_save_file(...) {
3298      llama_file file(filepath, "wb");
~~~

Additional output:

~~~text
2748  const size_t nwrite = llama_state_seq_save_file(ctx_tgt, tmppath.c_str(), ...);
   89      throw std::runtime_error(format("failed to open %s: %s", fname, strerror(errno)));
  365      throw std::runtime_error(format("write error: %s", strerror(errno)));
~~~

The core save call at line 2748 is outside the `try` beginning at line 2758.
`llama_file` throws for an open or write error, so that failure can escape
`process_single_task` without `send_error` and without the catch cleanup. The
old target is normally still intact, but the temp file can remain and the
request/worker failure is not controlled.

Because the temporary path is formed by appending to the target path, it stays
in the target directory and does not create a cross-filesystem rename. The
commit therefore resolves the previous destructive rollback issue for ordinary
process and I/O failures.

New concerns remain:

- Both the pre-save removal and the catch cleanup ignore removal errors. A
  failed/unremovable `.tmp` can leak and can make later saves fail in a less
  diagnosable way.
- A core state open/write exception occurs before the catch shown above. It can
  bypass the HTTP error response and leave the temp file behind.
- The temp name is predictable and is opened through `fopen(..., "wb")` via
  `llama_file`; there is no exclusive-create or no-follow protection. A local
  attacker able to race or prearrange the slot directory could redirect the
  temporary write through a symlink before the rename.
- The code does not fsync the temporary file or its parent directory, so this
  proves atomic replacement, not crash durability.

These are not cross-filesystem errors, and none was covered by a fault-
injection test in the commit.

## Ordered required fixes

1. Sanitize the tag/version input before shell interpolation and artifact
   naming; use an environment variable rather than inserting a ref directly
   into shell source, and allowlist `[A-Za-z0-9._-]` (or constrain manual
   dispatch to the intended ref).
2. Make reproducibility an executable check: pack the same normalized tree
   twice, compare SHA-256, and normalize archive ordering and ownership/mode
   metadata as supported by the macOS tar implementation.
3. Extend CI dependency verification recursively over every packaged Mach-O
   dylib, and record a successful `/health` run from the actual macOS job.
4. Put the core state write inside the same guarded save/cleanup path so open
   and write exceptions become controlled errors; use an exclusive/unique
   temporary file and report or retry cleanup failures. Decide whether fsync
   durability is required for slot saves and test the failure paths.
