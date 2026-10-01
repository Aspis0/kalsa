# Binding HTP skew fix: hostile audit r3

**Verdict: FIX FIRST** — one BLOCKER survives, and it is the same class r2
raised as F1: a committed change to the file that actually defines the APK's
**host** Hexagon backend ships a protocol mismatch with the gate green
(`EXIT=0`, `/tmp/r3-bypass-shim.log`). Everything else r2 listed is closed or
closed-with-a-stated-limit, and two of the fixes are genuinely good work.

Scope: `llama.rn-kalsa-gov-platform`, branch `feat/governor-platform-status`,
diff `fa8d83ef..6c9b16ed` (9 commits). All mutations were made in throwaway
clones under `/tmp` (`git clone --local` off `/tmp/audit-htp-r3`, itself a
local clone of the real repo) and removed afterwards. **No source checkout was
edited, nothing was committed, nothing was pushed, no device was used, no full
suite was run.**

---

## 0. Verdict table

| r2 item | r3 status | verdict |
|---|---|---|
| F1 source fingerprint | **partially closed** — vendor side closed, host-build side open | **BLOCKER** (see N1) |
| F2 stale skel + appended stamp | closed | CONFIRMED closed, NOT blocker |
| F3 partial / extra DSP set | closed (set) — new hole next to it | NOT blocker (N2) |
| F4 ungated APK workflow | closed for `build-example-android.yml`; consumer path + app still open | NOT blocker |
| F5 "every branch" comment | closed (honest now) | NOT blocker |
| F7 mutable image tag | **closed and independently verified** | REFUTED as a finding |
| F9 dead retry bookkeeping | closed | NOT blocker |
| F14 data race on fallback | partially closed — sibling field still racy | NOT blocker |
| F17 LFS in CI | closed in design; runner-untested | PLAUSIBLE |
| F19 overclaiming comments | partially closed; **a new overclaim was added** | NOT blocker |

---

## 1. Re-running the r2 mutations

### M1 — `htp-ops.h` protocol edit, uncommitted → **closed**

> `scripts/assert-htp-skels.sh:78`: `if [ -n "$(git -C "$ROOT_DIR" status --porcelain -- "${HTP_SRC_PATHS[@]}")" ]; then`
> `scripts/htp-skels-common.sh:16-24`: the `HTP_SRC_PATHS` array.

```
sed -i.bak 's/    HTP_OP_FENCE,/    HTP_OP_FENCE = 1000,/' vendor/.../htp/htp-ops.h
./scripts/assert-htp-skels.sh > /tmp/r3-f1-dirty.log 2>&1; echo "EXIT=$?"
```

`EXIT=1` — `assert-htp-skels: uncommitted changes under the fingerprinted
sources (ggml headers / ggml-hexagon) -- commit or stash; rebuild the skels if
the sources moved (scripts/build-htp-skels.sh)`.

**CONFIRMED closed. NOT blocker.**

### M2 — same edit committed, clean tree → **closed**

Fresh clone `/tmp/r3-m1`, commit, then run:

```
./scripts/assert-htp-skels.sh > /tmp/r3-f1-committed.log 2>&1; echo "EXIT=$?"
```

`EXIT=1` — `manifest source fingerprint ef1816c != recomputed 9923a1d -- the
vendored sources moved without a skel rebuild`.

The fingerprint really is content-bound: `htp_src_fingerprint`
(`scripts/htp-skels-common.sh:52-57`) hashes `<path> <git tree/blob hash at
HEAD>`, so a commit under any fingerprinted path moves it. **CONFIRMED closed.
NOT blocker.**

### M3 — old skel + appended stamp + manifest digest updated → **closed**

Old bytes are the `fa8d83ef` v79 (885,512 B). Fresh clone `/tmp/r3-m3`: copy
the old skel in, append `KALSA_HTP_SRC=<current fp>` **after the original
section/segment bounds** (the existing `KALSA_HTP_ENGINE=` stamp is left alone,
so it still resolves through the old symbol table), recompute the manifest
sha256:

```
./scripts/assert-htp-skels.sh > /tmp/r3-f2-stale2.log 2>&1; echo "EXIT=$?"
```

`EXIT=1` — `libggml-htp-v79.so: htp_elf_symbol: …/libggml-htp-v79.so:
kalsa_htp_src_stamp has 0 definitions`.

The obvious variant (append *both* stamps) also fails, on the raw-occurrence
leg: `EXIT=1` — `libggml-htp-v79.so carries 2 engine stamps (want exactly 1)`
(`/tmp/r3-f2-stale.log`). **CONFIRMED closed. NOT blocker.** This is the part of
the round that is done properly: the stamp is read through `.symtab`, so r2's
raw-substring attack no longer works.

### M4 — partial set / extra skel → **closed both directions**

```
# v81 removed (file + manifest line)
/tmp/r3-m5: ./scripts/assert-htp-skels.sh > /tmp/r3-f3-partial.log 2>&1; echo "EXIT=$?"   # EXIT=1
# unlisted libggml-htp-v99.so dropped in
/tmp/r3-m6: ./scripts/assert-htp-skels.sh > /tmp/r3-f3-extra.log 2>&1; echo "EXIT=$?"     # EXIT=1
```

Both: `shipped skels [...] != the supported set [...] -- rebuild exactly v73 v75
v79 v81`. **CONFIRMED closed. NOT blocker.**

---

## 2. New bypasses — what I could still get past

### N1 — CONFIRMED, **BLOCKER**: the host Hexagon backend's *build definition* is outside the fingerprint, and a committed edit there ships a protocol mismatch with the gate green

The question was whether `HTP_SRC_PATHS` is complete. Split the answer.

**Headers: complete.** I resolved every `#include "..."` transitively from the
exact DSP translation units named in `htp/CMakeLists.txt:12-42` (`main.c`,
`act-ops.c`, … `allreduce-ops.c`), plus the host's `ggml-hexagon.cpp`,
`htp-drv.cpp` and `htp/v73/htp_iface_stub.c`:

```
python3 /tmp/depscan.py > /tmp/r3-depscan.log 2>&1; echo "EXIT=$?"   # EXIT=0
```

`total TU roots: 33  resolved headers: 100`, and the only non-repo includes are
toolchain headers (`hexagon_protos.h`, `AEEStdErr.h`, `HAP_farf.h`,
`qtest_stdlib.h`, `unistd.h`). Every repo-local header resolves **inside**
`HTP_SRC_PATHS`. The QAIC IDL
(`vendor/llama.cpp/ggml/src/ggml-hexagon/htp/htp_iface.idl`) and the toolchain
file (`htp/cmake-toolchain.cmake`) are inside `ggml-hexagon`, so they are
covered. Vendor patches are applied by `sync-vendor.sh:305`
(`patch -p1 --fuzz=0 -d "$dest"`) **into the tracked tree at sync time**, so
there is no build-time patch channel. That part of F1 is genuinely closed.

**Build definition: NOT covered.** The host APK build never uses
`vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt` — there is no
`add_subdirectory` for it anywhere:

```
grep -rn 'add_subdirectory' android/src/main/rnllama/CMakeLists.txt cmake/rnllama-sources.cmake
```

The host hexagon backend is compiled by hand in
`android/src/main/rnllama/CMakeLists.txt:103-134` (`target_sources` with
`ggml-hexagon.cpp` + `htp-drv.cpp`, the QAIC stub, and the
`target_include_directories` list at lines 128-135), and that file — plus
`cmake/rnllama-sources.cmake:87` which defines `RNLLAMA_GGML_HEXAGON_DIR` — is
**not in `HTP_SRC_PATHS` and nothing hashes it**. The comment at
`scripts/htp-skels-common.sh:14` ("matching `android/src/main/rnllama/CMakeLists.txt`")
asserts a correspondence the gate never checks.

Proof. Fresh clone `/tmp/r3-m10`, add
`android/src/main/rnllama/shim/htp-ops.h` (`#pragma once` + `#include "htp-ops.h"`)
and insert one line at `android/src/main/rnllama/CMakeLists.txt:132`:

```cmake
                ${CMAKE_CURRENT_SOURCE_DIR}/shim
                ${RNLLAMA_GGML_HEXAGON_DIR}/htp
```

```
git commit -qm "audit: shadow the protocol header for the host backend only"
./scripts/assert-htp-skels.sh > /tmp/r3-bypass-shim.log 2>&1; echo "EXIT=$?"
```

`EXIT=0` — `assert-htp-skels: ok (engine 61c9094, src ef1816c, 4 skels match
the manifest, each names its engine and sources)`. `vendor/` is untouched; the
host backend now resolves `htp-ops.h` through a different file than the DSP
skels were compiled from. A second, blunter variant in `/tmp/r3-m8` (repoint
`${HEXAGON_HOST_STUB}` at a different tracked stub) is also `EXIT=0`.

**Verdict: CONFIRMED. BLOCKER** against the goal as stated — "an APK must never
ship DSP skels built from sources that differ from what the host Hexagon backend
is built from". `android/src/main/rnllama/CMakeLists.txt` *is* such a source,
it is committed, it compiles, and it is reviewed. The incident class r2 caught
was engine-source drift; this is the same failure reached from the other side.
Fix: hash `android/src/main/rnllama/CMakeLists.txt` and
`cmake/rnllama-sources.cmake` too, or stamp the skel with a host-build identity
derived from them.

### N2 — CONFIRMED, NOT blocker: nothing binds a skel to its DSP version

`htp-skels-container.sh:76-84` builds each `v` with `-DDSP_VERSION="$v"` and
`-DPREBUILT_LIB_DIR="toolv19_$v"`. Neither reaches the stamp and neither is
fingerprinted. Fresh clone `/tmp/r3-m4`: swap the **bytes** of
`libggml-htp-v75.so` and `libggml-htp-v79.so`, update the two manifest digests:

```
./scripts/assert-htp-skels.sh > /tmp/r3-new-dspswap.log 2>&1; echo "EXIT=$?"
```

`EXIT=0`. A v75 device would then load v79-compiled DSP code and vice versa, and
the gate reports `ok`. Stamp `KALSA_HTP_DSP=<v>` alongside the other two stamps
(or fold it into the fingerprint). Narrow — `rm -rf /tmp/kalsa-htp` at
`htp-skels-container.sh:22` means the build dirs are fresh and cmake names the
install per version — but the class of failure (a recipe copying the wrong
output) is exactly what the gate exists for. **NOT blocker.**

### N3 — the gate's own limit, stated plainly: it is a review control, not a provenance proof

Fresh clone `/tmp/r3-m7`, flip 64 bytes at offset `0x20000` inside
`libggml-htp-v79.so`, update the manifest digest:

```
./scripts/assert-htp-skels.sh > /tmp/r3-byteflip.log 2>&1; echo "EXIT=$?"
```

`EXIT=0`. The manifest digest and the `.so` are edited in the same commit, so
that leg detects accidental drift only; the provenance claim rests entirely on
"these bytes carry a symbol whose string equals the fingerprint of the committed
sources". The writers say so in `scripts/assert-htp-skels.sh:29-31` and
`scripts/build-htp-skels.sh:10-11`, and that is honest. What is not honest is
the success line at `scripts/assert-htp-skels.sh:188`: "4 skels match the
manifest, each names its engine and sources" reads like provenance was
established. **NOT blocker** (acknowledged), but the wording should say the
skel *claims* those sources.

### N4 — REFUTED: narrowing the trust root does not work

Fresh clone `/tmp/r3-m9`: delete `vendor/llama.cpp/ggml/src/ggml-hexagon` from
`HTP_SRC_PATHS` *and* move `HTP_OP_FENCE` to `1000`:

```
./scripts/assert-htp-skels.sh > /tmp/r3-bypass-trustroot.log 2>&1; echo "EXIT=$?"
```

`EXIT=1` — `manifest source fingerprint ef1816c != recomputed 4fbb841`. Because
the path names are hashed alongside the tree hashes, the list is self-covering.
Good design; I could not break it.

### N5 — CONFIRMED, NOT blocker: two dead entries in `HTP_SRC_PATHS`

`scripts/htp-skels-common.sh:19` `ggml-feats.h` and `:21` `ggml-threading.h`
are included by nothing in the fingerprinted set (and `ggml-version.h`,
`ggml-backend-dl.h`, which *do* live in `ggml/src`, are correctly excluded —
`depscan` resolves them out). Harmless over-inclusion, but the list is billed as
"exactly the paths both sides compile", and two of the eight are fiction. Drop
them or say "plus".

---

## 3. Contexts without `.git`

Two separate questions, two different answers.

**Does the gate itself fail closed?** Yes, but with a misleading message. Copy
the tree without `.git`:

```
tar --exclude='.git' -cf - . | (cd /tmp/r3-nogit && tar -xf -)
cd /tmp/r3-nogit && ./scripts/assert-htp-skels.sh > /tmp/r3-nogit-gate.log 2>&1; echo "GATE_EXIT=$?"
```

`GATE_EXIT=1`, preceded by two raw `fatal: not a git repository` lines, then
`assert-htp-skels: cannot fingerprint the committed sources (git rev-parse
failed)`. Two things to fix, both cosmetic-but-confusing:

> `scripts/assert-htp-skels.sh:78`: the dirt check swallows the git failure —
> `git status` exits 128, `$( )` yields empty, `[ -n "" ]` is false, so the
> check **passes silently** and only the later fingerprint leg fails.

> `scripts/assert-htp-skels.sh:81` and `scripts/build-htp-skels.sh:39`: the
> `|| fail "cannot fingerprint"` guard is only reachable because `pipefail`
> makes the `for … done | htp_sha256_stdin` pipeline in
> `scripts/htp-skels-common.sh:52-57` inherit the `return 1` from the subshell.
> Without `set -o pipefail` in the caller the guard is dead and a partial
> fingerprint would be hashed silently. Both callers set it, so it is correct
> today — worth a comment, because nothing else documents it.

**Is the gate ever *run* there?** No.

```
grep -rn "assert-htp-skels" --include='*.yml' --include='*.gradle' --include='*.json' .
```

Four call sites, all of them the recipe or a workflow: `release.yml:55`,
`ci.yml:35`, `ci.yml:229`, `build-example-android.yml:83`. **Nothing in
Gradle.** `example/android/app/build.gradle:41-52` still only does
`htpArtifacts.filter { !it.exists() }`, and `android/build.gradle:56-60` copies
whatever matches `libggml-htp-*.so`. So in an npm-tarball install
(`package.json` `files` ships `bin`), a gradle consumer build, or
`expo run:android`, the fingerprint is **silently skipped** — not because it
cannot be computed, but because nobody asks. The skew guarantee is inherited
from publish time, which is defensible; it should be written down as such
instead of being left implicit.

**Shallow checkout is fine.** `git rev-parse HEAD:<path>` needs no history;
`fetch-depth: 1` (the default in `ci.yml`) suffices. `release.yml` and
`build-example-android.yml` use `fetch-depth: 0` anyway. **REFUTED as a risk.**

---

## 4. `scripts/htp_elf_symbol.py`

Correctness on the happy path is fine: LE is validated (`data[4] != 1 or
data[5] != 1` → fail), `sh_link`/`shndx` are bounds-checked
(`htp_elf_symbol.py:74`, `:93`), the string-table read is bounded by
`str_off + str_size` so a garbage `st_name` fails instead of running off the
section (`:83-84`), and `file_off` is range-checked against the section
(`:97-98`). All eight malformed inputs **exit 1**:

| input | result |
|---|---|
| empty file | `EXIT=1` `not an ELF file` |
| 100 KB of `/dev/urandom` | `EXIT=1` `not an ELF file` |
| real skel truncated to 200 B | `EXIT=1` **`struct.error` traceback** |
| `e_shoff = 0xffffffff` | `EXIT=1` **`struct.error` traceback** |
| `e_shentsize = 0` | `EXIT=1` `no .symtab section` |
| EI_DATA flipped to 2 | `EXIT=1` `not a 32-bit little-endian ELF` |
| missing file | `EXIT=1` `cannot read …` |
| no arguments | `EXIT=1` usage |

**N6 — CONFIRMED, NOT blocker: an uncaught `struct.error` is the gate's error
message.** `scripts/htp_elf_symbol.py:62-63`:

```python
    for i in range(e_shnum):
        base = e_shoff + i * e_shentsize
        sections.append(struct.unpack_from("<IIIIIIIIII", data, base))
```

`e_shoff` and `e_shentsize` come straight from the file (`:54-56`) with no range
check, and `struct.unpack_from` raises on a short buffer. The gate wraps it
(`assert-htp-skels.sh:157-160`, `got="$(python3 … 2>&1)"`), so the outcome is
`bad_identity++` and a red build — **fails closed, no misleading pass**. But a
Python traceback is what the operator sees on a truncated skel, and
`e_shentsize` is never validated against 40. Wrap the unpack in
`try/except struct.error` and `fail("truncated section header table")`.

Also worth knowing, not wrong: `e_shnum == 0` (the extended-numbering form) is
reported as `no section headers`. No real skel has >65,279 sections, so this is
the right trade.

---

## 5. Workflows

**Gate coverage — every APK/package path now runs it.** `ci.yml:35` (vendor
job, before anything else), `ci.yml:229` (after `npm run build:android`),
`release.yml:55` (before the artifact is assembled), and the new
`build-example-android.yml:83`, correctly placed **before** `assembleRelease` at
line 90 and before the upload at line 108. F4's specific complaint is fixed.

One gap that is not F4's but is in the same family: `ci.yml`'s
`build-android-libs` job (line 231) runs `assembleDebug` at line 286 and
produces the packaged JNI libs, and has **no gate in that job** — it relies on
the `vendor` job covering the same commit. Fine in practice, worth noting.

**The `actions/cache` LFS flow — fails loudly.** `ci.yml:59-70`:

```yaml
      - name: Cache the LFS test model
        uses: actions/cache@v4
        id: lfs-model
        with:
          path: tests/tiny-random-llama.gguf
          key: lfs-tiny-random-llama-${{ hashFiles('tests/tiny-random-llama.gguf') }}
      - name: Pull the LFS test model on a cache miss
        if: steps.lfs-model.outputs.cache-hit != 'true'
        run: git lfs pull --include tests/tiny-random-llama.gguf
```

The key is computed from the **pointer**, and the key insight is sound — I
confirmed a fresh checkout has a 133-byte pointer whose content is
`oid sha256:27fa9f48…` / `size 65973792`, so the hash moves only when the model
does. GitHub's default Linux shell is `bash -eo pipefail`, so an exhausted
quota makes `git lfs pull` non-zero and the **step fails**; it cannot fall
through to `tests/parallel_decoding_test.cpp:209-214` (which `FAIL`s, not
`SKIP`s, on a missing model). No `restore-keys`, so no stale model can be
served. Good change. Residual PLAUSIBLE, runner-untested as the writers admit:
`actions/checkout` only runs `git lfs install --local` when `lfs: true`, so
whether `git lfs pull` needs the smudge filter is unproven here (`git lfs` is not
installed on this machine: `git: 'lfs' is not a git command`). And if the repo is
public, GitHub LFS bandwidth is unmetered and r2's quota worry was moot.

**The digest pin is real and correct — r2 F7 REFUTED.** r2 flagged
`scripts/build-htp-skels.sh:19` as a mutable tag. It is now

> `scripts/build-htp-skels.sh:24`: `IMAGE="ghcr.io/snapdragon-toolchain/arm64-android@sha256:91714433626f0d94a926538a1e46ec43756c5b8e3262b91b95df1e812940aed1"`

and the digest is what the recipe actually uses (`build-htp-skels.sh:55` inspect,
`:57` pull, `:75` run) and is recorded in `bin/arm64-v8a/HTP_SKELS:44`
`TOOLCHAIN_IMAGE=`. I verified the reference resolves and carries the platform
the recipe asks for:

```
docker manifest inspect ghcr.io/...@sha256:91714433… > /tmp/r3-docker-manifest.log 2>&1
```

`"mediaType": "application/vnd.oci.image.index.v1+json"` with a
`"architecture": "amd64", "os": "linux"` manifest inside — an index, so
`--platform linux/amd64` (`build-htp-skels.sh:25`, `:75`) resolves. **Closed,
independently confirmed. NOT blocker.**

**TOCTOU in the npm publish path — PLAUSIBLE, NOT blocker.**
`release.yml:70-76` (`publish`) checks out fresh with default `ref` and does
**not** re-run the gate; it inherits `needs: build-android` (which gated) and
overlays the gated `bin/` via `actions/download-artifact` at line 118. If the
default branch advances between the two jobs, the `vendor/` tree published comes
from the new commit while `bin/` comes from the gated artifact, and nothing
notices. Add the gate to `publish` — it costs one checkout's worth of `git
rev-parse`.

**N7 — CONFIRMED, NOT blocker: a hardcoded `v73` in the container.**
`scripts/htp-skels-container.sh:113` copies the QAIC pair from
`/tmp/kalsa-htp/build-v73/$f` while the loop above iterates `$HTP_DSP_VERSIONS`.
Fails loudly if `v73` ever leaves the set, but the constant should derive from
the same list the driver exports.

---

## 6. F14 — the mutex fix

> `cpp/rn-llama.cpp:833-841`: `setGovernorNpuFallback` / `governorNpuFallback`,
> `std::lock_guard<std::mutex>` on `npu_fallback_mutex_`.
> `cpp/rn-llama.h:191-196`: `mutable std::mutex npu_fallback_mutex_;` +
> `std::string governor_npu_fallback_;`
> `cpp/jsi/RNLlamaJSI.cpp:901-902`: `const std::string npuFallback = ctx->governorNpuFallback(); const bool hasNpuFallback = !npuFallback.empty();`

**What is right.** Both readers take copies (`rn-llama.cpp:762`, `RNLlamaJSI.cpp:901`);
the returned value and the lambda capture are by value; `getenv` pointers are
copied into owned storage and the dangling-pointer class is gone; the old
`governor_npu_fallback_storage` + raw pointer pair is deleted with no stale
references (`grep -rn 'governor_npu_fallback\b\|governor_npu_fallback_storage' cpp/ src/ tests/ android/ example/` → nothing).

**Lock held across `setenv`/log — no.** `rn-llama.cpp:852-858` closes the lock
scope *before* the comment block, and `setenv` is at line 870 with `LOG_ERROR` at
872. Correct, and worth having written that way.

**Lock ordering — no cycle.** `governorStats()` (the governor's own lock) is
called at `RNLlamaJSI.cpp:896`, `governorNpuFallback()` at 901, sequentially, not
nested; `decode()` takes only `npu_fallback_mutex_` and releases it before
`LOG_ERROR` and before the `-2` branch's `governor->stats()` at `rn-llama.cpp:785`.
No path holds `npu_fallback_mutex_` while calling into the governor.

**Compile — verified, not assumed.** `std::mutex` makes `llama_rn_context`
non-copyable/non-movable, and no copy site exists (every use in
`cpp/rn-completion.h:80`, `cpp/rn-slot-manager.h:98`, `cpp/jsi/RNLlamaJSI.cpp:557`
is a pointer). `cpp/rn-llama.cpp` compiles:

```
clang++ -std=c++17 -fsyntax-only -DNDEBUG -DGGML_USE_CPU -DGGML_CPU_GENERIC \
  -Icpp -Ivendor/llama.cpp -Ivendor/llama.cpp/{include,ggml/include,ggml/src,common,src,vendor} \
  cpp/rn-llama.cpp > /tmp/r3-compile-rnllama.log 2>&1; echo "EXIT=$?"      # EXIT=0
```

`RNLlamaJSI.cpp` itself has no JSI headers here, so I compiled the changed call
site verbatim against the real header (`/tmp/r3-probe.cpp`, mirroring lines
896-903): `PROBE_EXIT=0`. Every changed symbol name exists with the right
signature and is public (`struct llama_rn_context`). The writers' caveat about
having no local arbiter for that file stands, but the two changed lines are
sound.

**N8 — CONFIRMED, NOT blocker: the sibling field is still the r2 bug.** The
audit that flagged `governor_npu_fallback` walked straight past
`governor_npu_device`, which is the same shape:

> `cpp/rn-llama.cpp:117`: `owner.governor_npu_device = device_plan.npu_device;` — unsynchronized write.
> `cpp/rn-llama.cpp:851`: `if (governor_npu_device == nullptr) {` — unsynchronized read, *outside* the new lock scope.
> `cpp/jsi/RNLlamaJSI.cpp:899-900`: `ctx->governor_npu_device != nullptr` then `const std::string npuDevice = … ctx->governor_npu_device` — bytes copied through an unsynchronized pointer on a JSI worker.

Unsynchronized read/write of a pointer across threads is a data race on both
phones' weak memory models, and `RNLlamaJSI.cpp:900` reads through the pointer
exactly the way the fix removed for the fallback. It does not dangle —
`rn-governor-params.cpp:187` sets `plan.npu_device = "HTP0"`, a string literal —
so this is staleness, not use-after-free. Give it the same accessors, or fold it
into the one guarded struct.

**Doc drift, NOT blocker.** `cpp/rn-llama.h:189-190` says "first writer wins"
only in the container comment at `rn-llama.cpp:850`; the load path
(`rn-llama.cpp:122`, `owner.setGovernorNpuFallback(...)`) deliberately
*overwrites*, which is correct (a fresh plan on a fresh load) but makes
"first writer wins" true only of `note_htp_runtime_fallback`.

**Guard tests — the seven `toContain` assertions all match the sources** (checked
with `grep -qF`; see `/tmp/r3-jest.log` for the *failed attempt* — jest needs
`node_modules`, absent from the throwaway clone, so I verified the literals
directly instead of claiming a green run).

---

## 7. Shell: `set -euo pipefail`, `grep -q`, bash 3.2

**macOS bash 3.2 — clean.**

```
env PATH=/usr/bin:/bin /bin/bash ./scripts/assert-htp-skels.sh > /tmp/r3-b32.log 2>&1; echo "B32_EXIT=$?"
```

`GNU bash, version 3.2.57(1)-release` → `B32_EXIT=0`. The constructs used are all
3.2-safe: `HTP_SRC_PATHS=(…)` arrays, `${var:0:7}`, `[[ =~ ]]`, `<<<` herestrings,
`comm -23 <(…)` process substitution, `${got#"$4"}` prefix strip, `local` in
functions, and the `command -v sha256sum` / `shasum -a 256` split at
`scripts/htp-skels-common.sh:30-43`. Nothing here needs 4.x.

**shellcheck — clean.**

```
shellcheck -S warning scripts/assert-htp-skels.sh scripts/build-htp-skels.sh scripts/htp-skels-common.sh scripts/htp-skels-container.sh
```

Only `SC2148` (no shebang in the sourced-only `htp-skels-common.sh`) and the
matching `SC2034`. Add `# shellcheck shell=bash` to silence honestly.

**`grep -q` under pipefail — no hazards.** Every pipeline that can legitimately
find nothing is guarded:

> `scripts/htp-skels-container.sh:41,45`: `if ! printf '%s' "$…" | grep -qE '…'; then` — inside `if !`, so pipefail cannot kill it.
> `scripts/assert-htp-skels.sh:149`: `raw="$(grep -aoE … || true)"`
> `scripts/assert-htp-skels.sh:150`: `count="$(printf '%s' "$raw" | grep -c "$4" || true)"` — `grep -c` exits 1 on zero matches; the `|| true` and `set -e` coexist correctly.
> `scripts/htp-skels-container.sh:118,121`: `… || true`.

**Traps.** `build-htp-skels.sh:62-63`: `WORK="$(mktemp -d …)"` then
`trap 'rm -rf "$WORK"' EXIT`, both under `set -u`, with `WORK` assigned before
the trap — correct. The one wrinkle: `sed -i.bak` at lines 100/107/113 leaves
`bin/arm64-v8a/HTP_SKELS.bak` behind if an `exit 1` lands between the `sed` and
the `rm`. It is untracked and the gate's `find … -name 'libggml-htp-*.so'` does
not match it, so it is inert. **NOT blocker.**

**F9 — CONFIRMED closed.** Every fallible step in
`scripts/htp-skels-container.sh` is now guarded so the bookkeeping is reachable
under errexit: extract (`:26`), configure (`:74`), the three-attempt build loop
(`:79-83`), install (`:93`). The advertised retry really runs. **NOT blocker.**

**N9 — CONFIRMED, NOT blocker: the retry does not do what its comment says.**
`scripts/htp-skels-container.sh:84-86`:

> `# The observed transient is the embed_kernel build step (a license-slot miss under emulation); a clean re-run of the same build dir has always succeeded.`

The loop is `cmake --build . --config Release` against the *same* build dir with
no clean and no `--clean-first`. If the transient is stale incremental state —
which is what "clean re-run" implies — the retry cannot fix it and the three
attempts are three identical runs. Add `--clean-first` or `rm -rf` the build dir
between attempts, or drop the claim.

---

## 8. Clean code

Sizes are fine: `assert-htp-skels.sh` 188, `build-htp-skels.sh` 120,
`htp-skels-container.sh` 123, `htp-skels-common.sh` 58, `htp_elf_symbol.py` 103.
No dead function, no dead public API, no leftover field. The consolidation of
the DSP list and the sha256 helpers into one sourced file is the right call and
`6c9b16ed` removing the duplicated copy is correct.

Comments that narrate history rather than state:

* `scripts/htp-skels-container.sh:35-36` — **"A rebuild is the only way to make the binary name a new engine or source state - editing any text file cannot satisfy the gate."** False, and it is the F19 mistake reintroduced in a new file: `bin/arm64-v8a/HTP_SKELS` and `scripts/htp-skels-common.sh` are text files, and editing the manifest is enough (M-byte-flip, `EXIT=0`). **NOT blocker, but delete the sentence.**
* `scripts/htp-skels-container.sh:84-86` — see N9.
* `scripts/assert-htp-skels.sh:12-13` — **"plus a pre-build step in every Android build workflow"**. It is a pre-*package* step in `release.yml:55` (after `build:android-libs` at line 51) and a post-build step in `ci.yml:229` (after `build:android` at line 222). Only `build-example-android.yml:83` is genuinely pre-build. Say "a step in every Android build workflow, before the artifact is assembled".
* `scripts/assert-htp-skels.sh:188` — see N3.
* `.github/workflows/ci.yml:80-83` (pre-existing, not in this diff) narrates run
  `35360547883`. Not this round's problem.

---

## 9. r2 items this round did not touch, still open

* **r2 F4, second half — the app.** `~/Projects/kalsa/package.json:52` and
  `package-lock.json:44` still pin
  `github:Aspis0/kalsa.rn#c84714498782bf1176a339ea8c873460f56049b1`, whose
  `vendor/VERSIONS` reads `LLAMA_CPP_COMMIT=d07d0181b3249189c6132e0c9d669ec7164de6cc`
  — a different engine from this branch's `61c9094…`, and matching
  `~/Projects/kalsa/native/kalsallama.pin:1`. That revision has no
  `HTP_SKELS` manifest at all and no gate. **The app that produced the incident
  is still on the pre-fix binding, with no skew gate in its `expo run:android`
  path.** Nothing in these 9 commits touches it. UNCLOSED.
* r2 F12, F13, F15 — untouched by design, listed in the writers' "known limits".
  F15's `setenv`/`getenv` globality is unchanged; F14's fix does not touch it.

---

## 10. What only CI or a device can settle

I ran no GitHub Actions and used no phone. Unproven here: the LFS
cache-hit/miss flow on a real runner, `git lfs pull` without
`git lfs install --local`, `docker pull --platform linux/amd64 <index-digest>`
(the *reference* resolves and carries the platform; I did not pull 2 GB), the
new `build-example-android.yml` step against `workflow_run.head_sha`, and
whether the four rebuilt skels behave on the S23. `RNLlamaJSI.cpp` as a whole
still has no local compile arbiter; its two changed lines are covered by the
probe above.
