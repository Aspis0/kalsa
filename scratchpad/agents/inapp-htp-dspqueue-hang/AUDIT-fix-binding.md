# Hostile audit — the BINDING net (kalsa.rn `feat/governor-platform-status`)

Date: 2026-10-01. Subject: `~/Projects/llama.rn-kalsa-gov-platform`, `git diff c8471449..1a47c48f`
(5 commits: `0d49c6a7` vendor bump, `2c3e5236` four DSP skels + manifest, `e1ea0ea9` skew gate,
`7075128b` runtime fallback, `1a47c48f` sha256sum portability). Read: `FIX-binding.md` (writer),
`DIAGNOSIS.md`, `DEVICE-skel-swap.md`, `AUDIT-fix-engine-r3.md` (engine, same dir).
Read-only: nothing in the binding repo was edited, no commit, no branch, no device. Scratch:
`/tmp/audit-fxb` (gate mutations against stand-in binaries, reverse-apply probes, the suites in
`tests/build/`). Engine-side lines are `vendor/llama.cpp/...` in this same tree; app-side lines are
`~/Projects/kalsa/src/engine/...`.

## Verdict: FIX FIRST

The three structural moves are sound and the mtmd/glue adaptation is correct (F9 is a clean
REFUTED). What blocks the merge is not the code, it is the **gate**: it vouches for the skels with
a *text file* that the same person editing the vendor pin also edits, and the only build that
produces an APK **overwrites the very bytes the gate checks** with a different toolchain, in a
different job, after the gate has run. That is the exact failure the gate was written for, and it
is still open. Second blocker: the runtime fallback (F4) records `htp-runtime-error` for failures
that have nothing to do with HTP, and the string it records is read by nothing.

Findings: 14 CONFIRMED, 3 PLAUSIBLE, 5 REFUTED.

---

## 1. The skew gate

### F1 — CONFIRMED, blocker. The gate trusts a hand-edited string; the artifact carries no identity

`scripts/assert-htp-skels.sh:56-60`

```
if [ "$manifest_engine" != "$pin_engine" ]; then
  fail "skel engine sha ${manifest_engine:0:7} != vendored engine sha ${pin_engine:0:7} -- the DSP skels were not rebuilt from the vendored tree; rebuild them (see the provenance block in bin/arm64-v8a/HTP_SKELS)"
```

`ENGINE_COMMIT` lives in `bin/arm64-v8a/HTP_SKELS:14`, a comment-and-text file. The scenario the
gate exists for — bump the pin, do not rebuild the skels — is repaired by editing that one line,
and the gate goes green. Proven, not argued (`/tmp/audit-fxb/repo`, stand-in binaries so the run
is fast):

```
--- TEST A: stale skels, both strings edited to the new pin ---
assert-htp-skels: ok (engine 0123456, 4 skels match the manifest)
EXIT=0
--- TEST A2: only VERSIONS bumped, manifest left stale ---
assert-htp-skels: skel engine sha 61c9094 != vendored engine sha 0123456 ... EXIT=1
```

The baseline run also shows the gate never checks that the file is a *Hexagon skel at all*: 22
bytes of `OLD-SKEL-STALE-BYTES-v73` vouched by its own hash pass with `ok (engine 61c9094, 4 skels
match the manifest)`. The sha256 leg binds the manifest to the committed bytes — that leg is
correct and its mutation proofs hold — but it binds nothing to the engine.

Nothing else in the tree closes the loop. The only sha inside the vendored engine is
`vendor/llama.cpp/common/build-info.cpp:7` `char const * LLAMA_COMMIT = "61c9094";`, and
`scripts/assert-kalsa-vendor.sh:108-109` checks its **length**, not its value:

```
|| fail "LLAMA_COMMIT is '${commit}' (${#commit} chars, want 7): --short=7 grew on an ambiguous prefix"
```

and `scripts/assert-htp-skels.sh:22-24` says so out loud:

```
# those lines are informational and unchecked -- a gate on them could not be
# honest without rebuilding the skels, which is the skel build's job.
```

So "the vendored tree is the pin" is an assumption in all three gates. The fix is cheap and does
not need a rebuild to be *checkable* tomorrow: the DSP build already compiles
`htp/main.c` (CMakeLists `add_library(... main.c ...)`), so a `-DHTP_ENGINE_SHA="61c9094"` +
`const char htp_engine_sha[]` in that TU gives the skel a string, and the gate reads it out of the
`.so` instead of trusting a file. Until then the gate is a comment with a `fail()` in it.

**Failure scenario.** Next vendor bump: `LLAMA_CPP_COMMIT` moves, nobody has the Hexagon container
warm, the manifest line is edited to match, CI is green, the four `libggml-htp-*.so` are still the
previous engine's. First in-app prefill batch: control-plane RPCs succeed, the data-plane hangs —
DIAGNOSIS H2, the 2026-09 dspqueue hang, back on a phone that reports a matching `61c9094`.

### F2 — CONFIRMED, blocker. CI overwrites the gated bytes with a different toolchain, in a different job

The gate runs in the `vendor` job (`.github/workflows/ci.yml:18-34`), a fresh checkout, no Gradle.
The APK is built in `build-android-from-source`, which restores **`bin`** from cache
(`ci.yml:180-188`):

```
path: |
  bin
  vendor/llama.cpp/ggml/src/ggml-hexagon/htp/v73
key: ${{ runner.os }}-htp-${{ hashFiles('scripts/build-hexagon-htp.sh', ..., 'vendor/llama.cpp/ggml/src/ggml-hexagon/htp/**', ...) }}
```

and on a miss runs `prepareHTP` → `scripts/build-hexagon-htp.sh`, whose toolchain is not the one
the committed skels were built with:

```
scripts/build-hexagon-htp.sh:43   HEXAGON_SDK_VERSION="6.4.0.2"
scripts/build-hexagon-htp.sh:44   HEXAGON_TOOLS_VERSION="19.0.04"
scripts/docker-build-wrapper.sh:5 DOCKER_IMAGE="ghcr.io/snapdragon-toolchain/arm64-android:v0.3"
```

against the manifest's own provenance block:

```
bin/arm64-v8a/HTP_SKELS:30-32  TOOLCHAIN_SDK=6.6.0.0 / TOOLCHAIN_CLANG=19.0.07 / TOOLCHAIN_IMAGE=...:v0.7
```

`cmake --install` writes into `bin/arm64-v8a` (`build-hexagon-htp.sh:41` `HTP_OUTPUT_DIR`), so the
committed 6.6.0.0 skels are deleted and replaced by 6.4.0.2 builds **after** the gate passed, and
`syncRNLlamaHtpAssets` copies whatever is there (`android/build.gradle:56-60`) into the APK assets.
`release.yml:50,58-61` does the same and uploads `bin/` as the release artifact. The first android
run of this branch is a cache miss (the bump rewrote `htp/**`, which is in the key), so this is not
a corner case — it is the default path.

The `.so` itself corroborates: `strings` on all four committed skels yields
`/tmp/htp-skels/src/vendor/llama.cpp/ggml/src/ggml-hexagon/htp/main.c`. That is the writer's
bespoke `~/Projects/llama.rn-kalsa-htp-skels/0d49c6a7/container-build.sh` (`SRC=/tmp/htp-skels/src`),
which lives outside this repo. **No script in the repository can reproduce the committed bytes.**

### F3 — CONFIRMED. The cache key is blind to the host half of the protocol

`ci.yml:188` hashes `vendor/llama.cpp/ggml/src/ggml-hexagon/htp/**` (the DSP half) and never
`ggml/src/ggml-hexagon/ggml-hexagon.cpp` or `ggml/include/**` (the host half, which is where
`mdev`, fence slots and `HTP_OP_*` live) and never `vendor/VERSIONS`. A commit that changes only
the host hexagon source keeps the key, restores the previous `bin/`, and with
`ORG_GRADLE_PROJECT_rnllamaHtpArtifactsUpToDate: ${{ steps.htp-cache.outputs.cache-hit == 'true' }}`
(`ci.yml:211`) plus `example/android/app/build.gradle:53-57`

```
onlyIf {
    !(htpArtifactsUpToDate && htpArtifacts.files.every { it.exists() })
}
```

`prepareHTP` is skipped entirely. The APK ships a cached skel against a newer host, the gate is
green in the other job, and `bin/` on disk is not the committed `bin/`. The gate's own header
promise — "This gate turns that drift into a red build, at commit time and in CI" — does not hold
for this path.

### F4 — PLAUSIBLE. "At commit time" is not true; the gate is also unreachable from this branch

`lefthook.yml` runs `lint`, `types`, `commitlint` — none of the three asserts. So the script header
(`assert-htp-skels.sh:9-11`, "at commit time and in CI") overstates by one. And
`ci.yml:2-6` triggers on `push: [main, kalsa]` and `pull_request: [main]`: four pushes to
`feat/governor-platform-status` ran no workflow at all, and a **tag** push (what `release.yml`
builds from) matches neither. Whether the `vendor` job is a required check is a repo-setting fact I
cannot read from here; inside the workflow it is unconditional, which is what the commit message
claims and is true.

The gate is also in the repo that does not ship the APK. The app pins the binding by commit
(`REPOS.md`), and `~/Projects/kalsa/scripts/assert-engine-provenance.sh` contains no
`htp`/`skel` reference — `grep -n "htp\|skel"` returns nothing. `scripts/engine-build-id.js:38-44`
counts `bin/` as an engine input, so a skel change mints a new build id, but nothing in the app
repo checks skel/host agreement. The gate protects the example app's CI and the published npm
package; the kalsa APK inherits whatever the pinned commit shipped.

### F5 — CONFIRMED (small). The manifest recipe records a dead cmake option

`scripts/build-hexagon-htp.sh:156` and the container script both pass
`-DGGML_HEXAGON_FP32_QUANTIZE_GROUP_SIZE=128`, and the manifest repeats it as provenance. The
option exists nowhere: `grep -rni "fp32_quantize\|quantize_group" vendor/llama.cpp/` → no hits, and
`htp/CMakeLists.txt` declares no `option()` and no `set(... CACHE ...)` at all. cmake accepts the
unused `-D` with a warning nobody reads. The recorded recipe therefore documents a knob that does
nothing, at this pin.

What the archive recipe genuinely needs is small and I verified it: the DSP sources include exactly
three headers outside their own directory — `ggml.h` (`ggml/include`), `ggml-common.h`, `ggml-impl.h`
(both `ggml/src`). The writer shipped those plus four more, so the method was sound. It is just not
in the repo.

### F6 — CONFIRMED. `syncRNLlamaHtpAssets` ships the gated set, and only it

`android/build.gradle:49-60` deletes `libggml-htp-*.so` from the assets dir in `doFirst` and copies
`include "libggml-htp-*.so"` (flat, no `**`) from `bin/arm64-v8a`. The gate's `find -maxdepth 1`
(`assert-htp-skels.sh:66`) matches the same set, so **no ungated file can reach the assets** — the
one question in the brief that comes out clean. The untracked `libOpenCL.so` is correctly outside
both. Refuted sub-claim worth recording: a skel parked in a subdirectory is neither gated nor
copied, so it is inert, not a hole.

### F7 — PLAUSIBLE. `setenv` from the decode thread is a data race on `environ`

`cpp/rn-llama.cpp:841` `setenv("KALSA_HTP_FALLBACK", KALSA_HTP_RUNTIME_FALLBACK, /*overwrite=*/1)`
runs on the thread that called `decode`. glibc and bionic `setenv` may `realloc` the environ vector
with no lock; any concurrent `getenv` on any other thread is a torn read. Inside this repo the only
other `getenv` is `cpp/rn-llama.cpp:113`, on the load path, so the pairing is safe *today*; the
exposure is everything else in the process (the FastRPC/CAdie stack, the OpenCL ICD loader, any
future JSI module) and it is UB, not merely unlikely. The writer's own dangling-pointer note
(`rn-llama.h:188-191`) is correct and the fix is right — the reason is now copied into
`governor_npu_fallback_storage` before publication, and `getGovernorStats` copies again into
`std::string` before crossing into JSI (`cpp/jsi/RNLlamaJSI.cpp:901-902`), so no published pointer
dangles. But the *channel* should not be `environ` at all: a file-static `std::atomic<int>` in the
binding, read by `load_governor_models`, is the same design with no race, no realloc, and no
dependency on a Java process-wide clear (F9).

### F8 — CONFIRMED. The recorded reason is misattributed; a GPU OOM is reported as an HTP error

`cpp/rn-llama.cpp:753-754` fires the recorder on any real failure:

```
if (governor_decode_failed(result, governor->engine_failed()) && !was_failed) {
    note_htp_runtime_fallback();
```

and the only guard is `cpp/rn-llama.cpp:830` `if (governor_npu_device == nullptr || governor_npu_fallback != nullptr)` —
i.e. "the lane was *planned*", not "the lane *failed*". The engine's failure reason does not name
the engine that failed; `is_prefill` is in scope at `vendor/llama.cpp/src/llama-governor.cpp:259`
and is not used in the message at `:326-328`:

```
snprintf(decode_failure_reason_, sizeof(decode_failure_reason_),
         "llama_decode failed with rc=%d", rc);
```

Concretely, the non-HTP failure path: `llama_governor.cpp:125-133`

```
} catch (const std::exception & e) {
    // The OpenCL set_tensor path throws on device OOM (86f602f8a).
    snprintf(decode_failure_reason_, sizeof(decode_failure_reason_),
             "KV commit failed: %.80s", e.what());
    fail(decode_failure_reason_);
```

→ `llama-governor.cpp:293-297` `return failed ? -1 : fail("route Reject during phase handoff");`
→ binding sees rc `-1`, `governor_decode_failed(-1, true)` is true → the recorder runs. So an
**Adreno/OpenCL device OOM during the KV phase handoff** is stamped `npu_fallback =
"htp-runtime-error"`, is written into the app's `KALSA_GOVERNOR` line, and permanently kills the
HTP lane for the process — for a failure that never touched the DSP. Any CPU decode-side `-3`
(`src/llama-context.cpp:1935` `case GGML_STATUS_FAILED: return -3;`) does the same. This is the
angle-3 "CPU-route or lane-off failure misattributed to HTP" case, and it is real.

**Failure scenario.** S23 8 GB, prefill on HTP0, decode on CPU, OpenCL set_tensor OOMs at the
phase handoff. The phone's log says `npu_fallback:"htp-runtime-error"`. The next diagnosis reads
"HTP is broken on this phone", the lane is off until the app is killed, and the real fault (GPU
memory pressure) is never looked for.

### F9 — REFUTED. The env does stick, and the failed turn does not lose the message — but the report's mechanism is wrong

The report's claim is that the app's retry "lands on the non-HTP route through the env". It does
not. `~/Projects/kalsa/src/engine/LlamaService.ts:2231-2236`

```
if (runtimeGovernorState === "fallback-reload") {
  runtimeGovernorState = "fallback-consumed";
} else {
  runtimeGovernorState = "fresh";
}
const governorRuntimeOff = runtimeGovernorState === "fallback-consumed";
```

and `:2611` `enabled: !governorRuntimeOff` — the reload takes the **CPU-only `cpuParams` path**, no
governor, so `load_governor_models` never runs on it and the env is not consulted. The retry
recovers because the governor is off, not because the env degraded the plan. The setenv is not
useless: the *next* explicit model load re-arms the governor as `"fresh"` and
`decide_governor_prefill_device` (`cpp/rn-governor-params.cpp:177-192`) then keeps that load off
HTP. Same outcome, different mechanism, and the report describes the wrong one.

The stickiness itself holds, but by accident rather than by the stated design. The claim rests on
"Java writes `KALSA_HTP_FALLBACK` only during `loadNative`" — and Java *clears* it there:

```
android/src/main/java/com/rnllama/RNLlama.java:183-185
      // Refresh / Activity recreate): a stale KALSA_HTP_FALLBACK would keep
      // the loader on a false GPU degrade while HTP works.
      android.system.Os.setenv("KALSA_HTP_FALLBACK", "", true);
```

It only survives because `loadNative` short-circuits: `RNLlama.java:193` `if (libsLoaded) return
true;` and `libsLoaded` is set once at `:280` and never cleared. So the empty-clear can never run
after the native `setenv`. One future "re-provision the HTP libs" path that calls
`extractHtpLibrariesFromAssets` outside that guard silently resurrects the exact hang this commit
exists to stop. Worth a comment saying so at line 185.

The UX question in the brief: the user does **not** lose the message. `RNLlamaJSI.cpp:1364`
throws `"Governor decode failed: " + reason`, `governorRuntimeFallbackReason` requires that exact
prefix (`~/Projects/kalsa/src/engine/governorRuntime.ts:52-56`), the app returns
`{reason, turnToken, modelId}` instead of surfacing, and `LlamaService.ts:5824` re-enters
`streamAssistantTurn(messages, ...)` with history by value after
`callbacks.onDelta("", "")` clears the partial. No loop: `fallbackUsedForModel:
runtimeGovernorState !== "fresh"` is true on the retry, so the second failure goes to
`emitEngineError`. Acceptable UX, and it is pre-existing machinery, not this commit's.

**But the surfacing claim is false** (`FIX-binding.md` §4: "recording the field IS the surfacing").
`emitGovernorTelemetry` is only reached at the end of a *successful* turn
(`LlamaService.ts:5683`); the catch at `:5691-5694` that diverts the turn skips it, and the context holding
`governor_npu_fallback` is destroyed by the reload's dispose. The retry's reload suppresses the
plan line outright — `LlamaService.ts:2403` `if (governorBase != null && pricedModel != null &&
!governorRuntimeOff) {` — and runs on a governor-less context whose `npu_fallback` is `null`
anyway. The only line the app emits is `KALSA_GOVERNOR_RUNTIME_FALLBACK {reason}` at `:2844`,
carrying the *engine's* reason, not `"htp-runtime-error"`. **CONFIRMED: the new constant is written
to a field that no log line reads on any path reachable after the failure.** The one place it does
surface is `LlamaService.ts:1788` on a *third*, user-initiated load. An analyst chasing the original
hang has no field naming it.

### F10 — PLAUSIBLE, disclosed. Teardown is still unbounded, so the fallback's own recovery can hang

The bounded wait is real and correct — `vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:118`
`static uint32_t opt_rsp_timeout_ms = 30000;` with deadlines at `:3630` (batch response) and
`:7462` (event fence), the env parser is properly defensive (`:8486-8499`), and `GGML_STATUS_FAILED`
→ `llama-context.cpp:1935` → `-3` → `rn-llama.cpp:753` is verified end to end. The teardown is not
bounded: `ggml-hexagon.cpp:4419-4429`

```
this->mdev.sessions.clear();
int err;
if (this->valid_iface) {
    // Stop dspqueue/opbatch processing
    err = htp_iface_stop(this->handle);
```

is an unbounded synchronous FastRPC to a DSP that, by hypothesis, is wedged. The fallback's value
is entirely downstream of that call returning. The writer discloses this (F2 in
`AUDIT-fix-engine-r3.md`, restated in `FIX-binding.md` §6), so it is not hidden — but a
bounded-wait feature whose recovery path can still block on the same DSP is a half-fix, and the
acceptance run should include a 90 s outer bound on the reload (the recipe amendment r3 already
asks for) or the "fails cleanly" claim is untestable.

---

## 2. The skels

### F11 — CONFIRMED. Provenance is a prose block, and the v81 premise is wrong

The manifest's recipe is a paragraph (`HTP_SKELS:22-28`), not a command. The actual build script
is `~/Projects/llama.rn-kalsa-htp-skels/0d49c6a7/container-build.sh`, outside the repo, and it
cannot be run by anyone else (it needs the image, a hand-curated `git archive` of
`ggml/include` + seven ggml root headers + `ggml/src/ggml-hexagon`, and the artifact mount). Its
cmake flags *do* match `scripts/build-hexagon-htp.sh:145-156` one for one; the SDK/tools/image do
not (F2). So: built from the vendored tree at `61c909481` — accepted, nothing contradicts it; but
**not reproducible from anything committed here**, and the manifest's own toolchain lines
contradict the repo's build script.

`v81` is **not** newly added. It first appears in `130cc023` ("build: track lib/, bin/ and OpenCL
headers"), it is in `build-hexagon-htp.sh:112` `DSP_VERSIONS=("v73" "v75" "v79" "v81")`, in
`example/android/app/build.gradle:35` (the `htpArtifacts` list), in
`android/src/main/java/com/rnllama/RNLlama.java:26-31` `HTP_LIBS`, and it is in the manifest and
in every job. Expected and shipped; the base commit had it at 730,408 bytes and it is now
914,184. The brief's premise is REFUTED.

### F12 — CONFIRMED. Binary sanity is a debug-string count, not a protocol check

I reproduced the writer's numbers exactly: all four skels give `mdev=15 fence=7 sync-wait=2
ggml-hex:=13`. Those are counts of `strings` hits, taken from the r3 table
(`AUDIT-fix-engine-r3.md:386-395`), not a version marker. They distinguish "predates the
fence/mdev protocol" from "postdates it" — which is exactly what the stale S1/S2 skel needed — but
they cannot distinguish `61c909481` from any later hexagon-touching commit. A `HTP_ENGINE_SHA`
string (F1) would.

### F13 — REFUTED. Skel/host flag mismatch: none found, and the reason is structural

The layout-critical headers (`htp-ops.h`, `htp-ctx.h`, `work-queue.h`, `dma-queue.h`,
`hmx-queue.h`, `htp-fence.h`) are compiled into *both* the host backend and the DSP skel, and the
container archive shipped the whole `ggml/src/ggml-hexagon` tree, so both sides compiled the same
bytes. `HEXAGON_HTP_DEBUG=OFF` → `NDEBUG=1` on the DSP and is host-independent.
`GGML_HEXAGON_FP32_QUANTIZE_GROUP_SIZE` is the only mismatched-looking flag and it is a no-op
(F5). `GGML_HEXAGON_DEVICES=1` (`RNLlama.java:181`) matches the lane-only HTP0 resolve in
`load_governor_models`. The `GGML_HEXAGON_RSP_TIMEOUT_MS` knob is host-side and defaults sanely.
No mismatch.

### F14 — REFUTED (as a hazard), with a note. `GGML_HEXAGON_DEVICES=1` and the mdev machinery

`ggml-hexagon.cpp:3736` enqueues the mdev group only when `mdev.count > 1`, and
`RNLlama.java:181` pins one session, so the fence/mdev protocol the new skels carry is dormant in
this configuration. It is not dead code in the engine (multi-device is a planned spike), but no
device evidence in this change exercises the path the new skels were built for.

---

## 3. Vendor bump glue (`0d49c6a7`)

### F15 — REFUTED. The mtmd `logits_last` adaptation is correct

`decode_embd_batch` (`vendor/llama.cpp/tools/mtmd/mtmd-helper-common.h:74-91`) owns
`std::vector<int8_t> logits;` sized `n_tokens` in the ctor, and `render()` keys off the **global**
index — `mtmd-helper-common.h:166-168`

```
if (logits[i]) {
    llama_batch_ext_set_output_logits(batch.get(), idx, true);
}
```

so the patch's `batch_embd.logits[n_tokens - 1] = 1;` (`scripts/patches/llama.cpp/mtmd-helper.cpp.patch:27-29`)
is index-safe and slice-independent, and it is semantically identical to the old
`batch.logits[n_tokens-1] = true`. The second hunk (`return ret;` in place of
`llama_batch_free(text_batch)`) is correct because `text_batch` is a stack `common_batch` whose
`llama_batch_ext_ptr` (`common/common.h:1071`) owns and frees; the sibling text branch at
`mtmd-helper.cpp:257-261` already does the same. No leak, no behaviour change, and the patch
reverse-applies **exactly** (`git apply --check -R` → clean), so it is not a fuzz artifact.

### F16 — CONFIRMED, pre-existing but newly armed. Three patches now apply with fuzz; one is at the limit

`patch -p1 -R --dry-run --verbose` against the vendored tree, HEAD vs base `c8471449`:

| patch | base | HEAD |
|---|---|---|
| `barbet-llama-arch.cpp.patch` | Hunk #1 offset 2 | Hunk #1 **fuzz 1** (offset 3) |
| `ggml-metal-flash-attn-smem.patch` | offset 88 | Hunk #1 **fuzz 2** (offset 110) |
| `log.cpp.patch` | Hunk #2 fuzz 1 | Hunk #2 fuzz 1 (unchanged) |
| `mtmd-helper.cpp.patch` | — | exact, 0 fuzz |

b11304 moved the context lines on two of them, and the hex flash-attn hunk is now at
**fuzz 2, the maximum `patch` accepts** — one more line of upstream drift and it fails. When it
fails, `sync-vendor.sh:303` `patch -p1 -d "$dest" < "$patch_file"` under `set -eo pipefail`
(`:18`) aborts loudly, which is the good outcome; the bad outcome is the *current* one, a hunk that
applies at fuzz 2 into a spot the author never checked. Nothing in CI compares the vendored tree
against pin+patch: `assert-kalsa-vendor.sh` grades exactly two files plus seven filenames, and my
`git apply --check -R` sweep shows it would not notice. Worth a one-line note in the two patch
files before the next bump.

### F17 — CONFIRMED. The `llama_rn_slot` move ctor is sound; the riskiest glue is untested

`cpp/rn-slot.h:188` `llama_rn_slot(llama_rn_slot &&) = default;` — correct diagnosis (a
user-declared destructor suppressed the implicit move; `common_batch`'s `unique_ptr` member
suppresses the copy that `vector::resize` would otherwise need). `common/common.h:1075-1107` shows
`common_batch` is move-constructible via its defaulted default ctor + members, and
`rn-slot.cpp:517,601` `parent_ctx->decode(spec_batch.get())` reaches the new
`llama_rn_context::decode(llama_batch_ext *)` overload (`rn-llama.cpp:792-799`), which bypasses the
governor entirely — safe only because governor mode refuses speculative at load
(`rn-llama.cpp:870` throws on `has_speculative_mode(params_)`) and `n_parallel > 1`
(`:868`). Both invariants are in-tree and asserted in the comment; I did not find a path that
violates them.

What I could not verify is that any of it *runs* (F19). Also worth noting:
`llama_batch_ext` is "opaque" to the binding — the old code could set `batch.logits[i]`, the new
one cannot reach into the rendered batch at all, so any future need for per-token logits control in
the MTP path has to go through `common_batch::token::output` / `set_output`.

### F18 — CONFIRMED (small). Unrelated-line churn in the test commit

`7075128b` mangled a comment onto a signature:

```cpp
static bool test_prefill_device_plan() {    // Java-side HTP failure outranks a device that resolves.
```

Harmless to the compiler, but it is a line the bump did not need to touch, in the same hunk as the
new test. The house style in this repo (see `assert-kalsa-vendor.sh`'s long comment about greps
reading code, and the writer's own `lefthook` note) is the opposite.

---

## 4. Tests

### F19 — CONFIRMED, blocker for the evidence, not for the code. "28/28" is 14 skips

Ran the suites in `tests/build/`:

```
governor_params_test   Total 11  Passed 11  Failed 0     (new case: "runtime htp reason degrades the next load ... PASSED")
chat_parse_utf8_test   Total 18  Passed 18  Failed 0
parallel_decoding_test SKIP lines: 14
                      Passed 28  Failed 0  Success rate: 100%
                      cmn  common_init_: failed to load model '../tiny-random-llama.gguf'
```

`tests/parallel_decoding_test.cpp:208-211`

```
if (!ctx.loadModel(params)) {
    std::cout << "[SKIP: Model not loaded] ";
    return true; // Skip test if model can't load
}
```

A skip returns **true**, so it is counted as a pass. Half of `parallel_decoding_test` — including
the MTP case at `parallel_decoding_test.cpp:165` `params.speculative.types =
{ COMMON_SPECULATIVE_TYPE_DRAFT_MTP };` and every `init_mtp`/`refill_mtp_tokens` path this bump
rewrote — never executed, and the report's "parallel_decoding_test 28/28" does not mention it. The
honest line is "28/28, 14 of them skipped for want of a model".

### F20 — REFUTED. The LFS cases will be green in CI; they are simply unproven for this branch

`tests/.gitattributes` carries the filter and `git check-attr -a tests/tiny-random-llama.gguf`
returns `filter: lfs`, so `actions/checkout@v4` with `lfs: true` (`ci.yml:54-56`) will materialize
the 63 MB pointer. My "CI cannot fetch it" hypothesis is wrong; the report's explanation is right.
The residual is honest and already stated: no GitHub Actions run was triggered for these four
commits (`FIX-binding.md` §6), so the 4 `rnllama_tests` model cases are **unverified in CI** for
this branch, and a missing LFS object would make `run_tests.sh` exit 1 and the whole `test` job
red. The first push to a PR branch settles it; until then nobody has run this tree's tests with a
model.

### F21 — CONFIRMED. `kv_cache_reuse_test` is built nowhere CI can see

`tests/run_tests.sh:101` runs `./kv_cache_reuse_test`, but `build_and_test.sh` builds only
`rnllama_tests`, `parallel_decoding_test`, `chat_parse_utf8_test`, `governor_params_test` — so in
CI the binary is absent and that run is skipped. `tests/kv_cache_reuse_test.cpp:132-143` is the
*other* MTP exercise (`COMMON_SPECULATIVE_TYPE_DRAFT_MTP`) and it is doubly unrun. Pre-existing,
not this range's doing, but it is why the MTP rewrite has no executed coverage anywhere.

### F22 — CONFIRMED (as disclosed). Coverage is 4 source pins + 1 pure-function case

`src/__tests__/governorHtpRuntimeFallback.test.ts` — 4 tests, all `fs.readFileSync` + regex/`toContain`
on `cpp/rn-llama.cpp`. I ran it: 4/4 pass. It pins placement, the guard, the overwrite flag, the
storage copy, and the absence of `set_prefill_override`. That is the repo's stated convention
(`nativeSourceGuards`) and it is honest about being a pin — but note what it cannot catch: the
guard is satisfied by `governor_npu_device != nullptr` (F8's misattribution) and the tests bless it
with the comment "governor_npu_device is set only when the lane resolved to HTP0". The C++ case
(`tests/governor_params_test.cpp:160-177`) calls
`decide_governor_prefill_device(true, nullptr, KALSA_HTP_RUNTIME_FALLBACK)` with a literal — it
never exercises a real `setenv`→`getenv` round trip, which is the one thing that could have caught
the Java-clear interaction (F9). Verified 11/11 including the new case; the suite is model-free and
worth keeping.

---

## What I would change before merging

1. **F1** — put the engine sha *in the skel* (`-DHTP_ENGINE_SHA` → a `const char[]` in
   `htp/main.c`) and have the gate read it out of the `.so`. Without that, the gate is a comment.
2. **F2/F3** — either make the committed skels the ones that ship (stop `prepareHTP` from
   overwriting `bin/` in CI, or build them with the pinned toolchain and have the gate run in the
   *same* job as the APK), or drop the manifest and gate the build inputs instead. Add
   `ggml/src/ggml-hexagon/ggml-hexagon.cpp` + `ggml/include/**` + `vendor/VERSIONS` to the cache
   key. Remove the dead `GGML_HEXAGON_FP32_QUANTIZE_GROUP_SIZE` from the script and the manifest.
3. **F8** — put the failing engine in the reason. `is_prefill` is in scope at
   `llama-governor.cpp:259`; `"llama_decode failed with rc=%d"` → `"prefill/HTP decode failed with
   rc=%d"`, and gate the recorder on that (or on `stats.prefill_engine`) instead of on "the lane was
   planned". One line in the engine, one condition in the binding.
4. **F9** — emit the reason where a human will see it. `emitGovernorTelemetry` is skipped on the
   throwing turn and the plan line is suppressed on the retry; log
   `KALSA_GOVERNOR_RUNTIME_FALLBACK {reason:"htp-runtime-error", governor_reason:…}` from the
   reload, and add a comment at `RNLlama.java:185` that the empty-clear must stay behind
   `libsLoaded`. If the cross-load channel is going to be the env, that comment is load-bearing.
5. **F19** — fix the report's numbers before it is cited: "parallel_decoding_test 28/28 (14
   skipped)", and state that the MTP rewrite has no executed coverage. Do not let "28/28" and
   "compile arbiter" stand in for a test run.

`FIX-binding.md` §3's mutation proofs are real and I reproduced three of them; §5's exit codes
reproduce too. The gap is not in the testing, it is in what the gate is willing to believe.
