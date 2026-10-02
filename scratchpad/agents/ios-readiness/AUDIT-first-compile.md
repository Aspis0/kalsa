# Hostile audit: first iOS compile (`kalsa-ios`, `ios/first-build` @ `ffd5867c`)

Scope: the two `node_modules/llama.rn` patches, the two build logs, and everything the
compile hides. Baseline for diffing is the engine commit actually vendored in the iOS
worktree (`61c9094811cb200fd475491f18f594fbde77634b`), extracted read-only with
`git -C ~/Projects/kalsallama archive 61c90948`.

Verdict in one line: **both patches are correct and neither is dangerous, but the
patch record misidentifies the pin, misattributes Patch 1 to the wrong repository, and
cites a log that does not contain the build it claims.** Nothing is silently wrong in
`node_modules`. The real defects are in how the result is documented and in one Podfile
line that has been quietly rewriting the pod's C++ standard.

Severity key: **S1** blocks the next session's ability to reproduce or fix this.
**S2** will cause a wrong decision. **S3** is noise worth fixing on the next touch.

---

## Verdict table

| # | Finding | Verdict | Sev |
|---|---|---|---|
| 1 | "Pristine" copy is a **different engine commit**; the stated baseline is false | CONFIRMED | S1 |
| 2 | Patch 1's root cause is misattributed: the engine has never had `FATTN_SMEM` | CONFIRMED | S1 |
| 3 | Patch 1 is byte-identical in semantics to the macro it replaces | CONFIRMED | — (good) |
| 4 | "Wrong smem → silent wrong output / crash" | REFUTED for real models; PLAUSIBLE-low residual | S3 |
| 5 | "macOS kalsa-server Metal builds would also fail" | REFUTED | — (good) |
| 6 | Patch 2's macro set is right; its *shape* (inverted guard) is wrong | CONFIRMED | S2 |
| 7 | Patch 2 does not fix the class of bug (podspec compiles every arch dir for every slice) | CONFIRMED | S2 |
| 8 | Recommended fix: `EXCLUDED_ARCHS` in the Podfile; podspec `exclude_files` per arch is impossible | CONFIRMED | S2 |
| 9 | arm64 NEON kernels intact; x86_64 dangling `_generic` gone | CONFIRMED | — (good) |
| 10 | `/tmp/ios-build.log` is an **incremental** log, not the full simulator build | CONFIRMED | S2 |
| 11 | `error: … exit code 0` is **device-side only** and is non-fatal | CONFIRMED | S3 |
| 12 | llama-rn compiles as **`gnu++20`**, not the podspec's `c++20`; `-O3 -DNDEBUG` beat `-O0` | CONFIRMED | S2 |
| 13 | 68 `ggml_metallib_*` symbols = **34 libraries**, not 68 kernels | CONFIRMED | S3 |
| 14 | Nothing beyond the two recorded diffs is patched in `node_modules` | CONFIRMED | — (good) |
| 15 | The 957 `unguarded-availability` hits are an echoed flag, **not** diagnostics | REFUTED | S3 |
| 16 | The device build is unsigned — nothing has ever run on any iOS target | CONFIRMED | S2 |
| 17 | Pod floor is 15.1 vs app 16.4; no availability checking against the real floor | CONFIRMED | S3 |

---

## S1-1 — The stated baseline is false: the "pristine" copy is a **newer engine**

The brief says `~/Projects/kalsa/node_modules/llama.rn` is "(same pin)". It is not.

```
~/Projects/kalsa-ios/node_modules/llama.rn/vendor/VERSIONS:9:
  LLAMA_CPP_COMMIT=61c9094811cb200fd475491f18f594fbde77634b
~/Projects/kalsa/node_modules/llama.rn/vendor/VERSIONS:9:
  LLAMA_CPP_COMMIT=5b596ce432ee08acdc6559ed656292038ce75f24
```

Corroborated by the generated stamps: `lib/commonjs/version.js` carries
`BUILD_COMMIT = '61c9094'` / `BUILD_NUMBER = '11585'` in the iOS tree and
`'5b596ce'` / `'11598'` in the other. `5b596ce43` is `origin/main`'s current tip in
`~/Projects/kalsallama`; `61c90948` is its **ancestor**
(`git merge-base --is-ancestor 61c9094 origin/main` → true).

**Failure scenario.** `diff -rq` between the two `node_modules` trees — the obvious way to
answer "is anything else patched?" — returns **30 differing paths**, of which 26 are pure
version drift. Anyone who runs that command concludes the binding has been locally
patched in 26 places and either wastes a day auditing phantom edits or, worse, "fixes"
them by reverting the vendored tree to the newer engine and silently changes the pin.
Note `BINDING-PATCHES.md` inherits this error: it states the engine "vendored commit
`5b596ce43` per the app repo's recent build pins", which is not what is installed here.

**Correct baseline for any future diff:** engine `61c90948` **plus** the binding's own
overlay series (see S2-7 for what those look like). Finding 14 uses that baseline and it
comes out clean.

---

## S1-2 — Patch 1's root cause is misattributed; the fix is aimed at the wrong repo

`BINDING-PATCHES.md` claims:

> "The engine repo at the pin (`kalsallama`, vendored commit 5b596ce43 …) carries this bug."
> and "The owning session must fold equivalent fixes into the binding/engine repos".

The engine has never contained `FATTN_SMEM`. Three checks, all empty:

```
git -C ~/Projects/kalsallama grep -n 'FATTN_SMEM' 61c9094811cb…   → no output
git -C ~/Projects/kalsallama grep -n 'FATTN_SMEM' origin/main     → no output
grep -rln 'FATTN_SMEM' ~/Projects/kalsallama (excluding .git)      → no output
```

What engine `61c90948` actually has, at
`ggml/src/ggml-metal/ggml-metal-ops.cpp:3510-3522`, is the lambda and **no while-loop at
all**:

```cpp
auto fa_smem = [&](int32_t nsg) -> size_t { … };
// simdgroups per threadgroup (a.k.a. warps)
int32_t nsg = ne00 >= 512 ? 8 : 4;
const size_t smem = fa_smem(nsg);
```

Upstream `cdc06426e` ("metal : optimize sparse FA + clean-up (#29377)", an ancestor of the
pin) is what deleted the macro:

```
-#define FATTN_SMEM(nsg) (GGML_PAD((nqptg*(ne00 + 2*GGML_PAD(ne20, 64) + 2*(2*ncpsg)) + is_q*(16*32*(nsg)))*(sizeof(float)/2), 16))
+        auto fa_smem = [&](int32_t nsg) -> size_t {
+            const size_t smem_half = nqptg*(ne00 + 2*dv_pad + 4*ncpsg) + is_q*(16*32*nsg);
```

The **while-loop is a binding overlay patch shipped inside `Aspis0/kalsa.rn`'s vendored
tree**, written against a pre-`cdc06426e` llama.cpp, and it was never updated when the
engine moved. The giveaway is in the *other* copy: `~/Projects/kalsa`'s newer-engine tree
still carries the bug verbatim at `ggml-metal-ops.cpp:3518`:

```cpp
        while (nsg > 1 && FATTN_SMEM(nsg) > props_dev->max_theadgroup_memory_size) {
```

i.e. the bug survives an engine bump, which an engine bug could not do.

**Failure scenario.** The session that owns the fix reads the record, opens `kalsallama`,
greps for `FATTN_SMEM`, finds nothing, and closes the item as "already fixed upstream" —
while `Aspis0/kalsa.rn`'s overlay still carries it. The next `npm ci` on any machine that
builds iOS fails again, now with nobody looking for it. The fix must go into the
**binding** repo's vendor overlay, and separately the binding should stop re-deriving
engine internals by hand (see S2-7).

**Related record defect.** The loop that the agent edited was itself never recorded
anywhere. `BINDING-PATCHES.md` presents the diff as a rename inside a pre-existing
loop; the loop is unattributed. A future fold-in will patch a file that has no
provenance for that loop.

**Nit (record accuracy).** The recorded Patch 2 hunk headers imply +10 lines
(`@@ -1,3 +1,12 @@` and `@@ -4316,3 +4325,4 @@`). Real sizes are 4319 → 4327, i.e.
**+8**, and the trailing hunk's original line number should be 4319, not 4316. Since the
instruction is for a human to hand-apply this to the binding repo, wrong line numbers are
a real cost.

---

## S3-4 — Patch 1 semantics: identical, and the overflow hazard is not real

**Semantics — CONFIRMED identical.** The old macro computed

```
GGML_PAD((nqptg*(ne00 + 2*GGML_PAD(ne20,64) + 2*(2*ncpsg)) + is_q*(16*32*nsg))*(sizeof(float)/2), 16)
```

The lambda it now calls, `ggml-metal-ops.cpp:3510-3513`:

```cpp
const size_t dv_pad = GGML_PAD(ne20, 64);
auto fa_smem = [&](int32_t nsg) -> size_t {
    const size_t smem_half = nqptg*(ne00 + 2*dv_pad + 4*ncpsg) + is_q*(16*32*nsg);
    return GGML_PAD(smem_half*sizeof(ggml_fp16_t), 16);
};
```

`2*GGML_PAD(ne20,64) == 2*dv_pad`; `2*(2*ncpsg) == 4*ncpsg`;
`ggml.h:370` is `typedef uint16_t ggml_fp16_t` so `sizeof(ggml_fp16_t) == 2 ==
sizeof(float)/2`. Same expression, same padding, same type width. Not "close enough" —
identical.

**Overflow — REFUTED for any model this app can run.** With
`OP_FLASH_ATTN_EXT_NQPSG 8` and `OP_FLASH_ATTN_EXT_NCPSG 64`
(`ggml-metal-impl.h:126-127`), for a head_dim of 128: `fa_smem(8)` =
`GGML_PAD((8*(128+256+256) + 512*8)*2, 16)` = **18,432 B**, under the 32 KB every
Apple-silicon-class GPU reports. The clamp is a no-op there, and it can only ever *reduce*
`smem`, so it cannot manufacture an overflow upstream did not already have. It is in fact
a small safety improvement on 16 KB devices, where `fa_smem(8)` = 18,432 B would have
overflowed.

**I explicitly checked and then discarded a second worry** — that a clamped `nsg` of 2 or
1 would fail a pipeline lookup. It would not: `nsg` is a compile-time *constant* baked
into the pipeline name (`ggml-metal-device.cpp:1775`,
`ggml_metal_cv_set_int32(cv, nsg, FC_FLASH_ATTN_EXT + 22)`), so an unusual value just
triggers a runtime kernel compile. REFUTED.

**Residual, PLAUSIBLE-low.** The loop exits at `nsg == 1` with `smem` still oversized if
`fa_smem(1) > max_theadgroup_memory_size`, and the **non-vec path has no smem assertion at
all** — contrast `ggml-metal-ops.cpp:3785`
`GGML_ASSERT(smem <= props_dev->max_theadgroup_memory_size);` in the vec path. It would
reach `ggml_metal_encoder_set_threadgroup_memory_size(enc, smem, 0)` at `:3575` with an
oversized value. Reaching it needs `ne00 + 2*GGML_PAD(ne20,64) ≳ 1792`, i.e. head_dim
≳ 1024, which no model on the supported list has. Two things to note for whoever folds
this in: the clamp is unlogged (a silent perf change), and the loop is binding-local
decoration with no upstream counterpart, so it deserves its own comment saying so.

**What actually happens on failure** (for the record, since the brief asks crash vs silent):
`GGML_ASSERT` is *not* `assert()` — `ggml.h:288` maps it to `ggml_abort`, and
`ggml/src/ggml.c:253` always calls `abort()` at line 272 even when a callback is
registered. The binding's callback (`cpp/rn-llama.cpp:304-315`) only logs first. So a vec-path
smem violation is a hard SIGABRT with a message, **not** silent numerical corruption. The
non-vec path's failure would surface as a Metal validation failure on the dispatch. I did
not execute this (no builds, no device), so it stays PLAUSIBLE.

---

## S3-5 — "macOS kalsa-server Metal builds would also fail" — REFUTED

The vendored `ggml-metal` tree has essentially **never been compiled outside this iOS
attempt**:

- `llama-rn.podspec:31` — `s.platforms = { :ios => "13.0", :tvos => "13.0" }`. There is no
  macOS platform, and the prebuilt path is an iOS/tvOS xcframework.
- `kalsa-server` is built from the **engine repo directly**, not from the binding.
  `kalsa-moe-experiments/PLAN.md:574-576`: "`kalsa-server-v1.1.4` (a34fcc615 -> 61c909481)
  … manifest commit 61c909481". Engine `61c90948` is exactly the commit that is clean.

So the FATTN_SMEM bug is **confined to the binding's vendored tree**. No desktop or
server Metal build from this pin exists, and none would have caught it. That is also the
real lesson: the first time anyone compiled this vendored Metal at all, it did not
compile — a much broader untested-code risk than the one line that was fixed.

---

## S2-6 — Patch 2: right macro, wrong shape

`ggml/src/ggml-cpu/arch/arm/quants.c:1-7`:

```c
// x86_64 simulators: upstream CMake never compiles arch/arm for x86 targets.
…
#if defined(__x86_64__) || defined(__i386__) || defined(_M_IX86) || defined(_M_X64)
#else
#define GGML_COMMON_IMPL_C
```

**The macro set is correct** — it is character-for-character the test `arch-fallback.h:92`
uses for its own x86 section, so it is consistent with the file's own conventions.
CONFIRMED as a test.

**The shape is wrong.** `#if <x86> / #else <body> / #endif` means the file body compiles
for **every non-x86 architecture**: arm64, and also powerpc, riscv, s390, loongarch,
wasm. `arch-fallback.h` has sections for all six (`:82`, `:92`, `:128`, `:183`, `:238`,
`:286`, `:343`), so on any of the others the same dangling-`_generic` breakage returns,
and this guard would wave it through. Today only `arm64` and `x86_64` slices exist, so it
happens to work — that is luck, not design. The idiomatic form used everywhere else in
this tree is the positive `#if defined(__aarch64__) || defined(__ARM_NEON)`, i.e. name
the architectures whose kernels this file *is*.

Secondary effect: on x86_64 the TU is now **empty**, which C11 §6.9p1 does not permit
(a translation unit needs at least one external declaration). Clang accepts it and the
symptom is visible in the log (`libtool: warning: 'quants-9b4aaa9c….o' has no symbols`,
`/tmp/ios-build.log:8612`). Benign today, but it adds a second class of empty `.o` to a
target that already has four (see S2-7).

**Root cause, verified independently** (the reported mechanism is accurate):
`arch-fallback.h` is included **only** by `ggml/src/ggml-cpu/quants.c:9`, never by
`arch/arm/quants.c`. Its x86 section renames the generic at line 94
(`#define ggml_vec_dot_q2_0_q8_0_generic ggml_vec_dot_q2_0_q8_0`) because x86 has no
native `q2_0_q8_0` (`grep 'ggml_vec_dot_q2_0_q8_0\b' arch/x86/quants.c` → no match). When
`arch/arm/quants.c` is compiled for x86_64, that rename is not in scope, so its non-NEON
fallback emits a reference to `_generic` that nothing defines, while `quants.c` supplies a
*second* `ggml_vec_dot_q2_0_q8_0`. The archive member that wins the link carries the
dangling reference. That is a **podspec-glob** bug, not an engine bug.

---

## S2-7 — Patch 2 treats one symptom of a systemic podspec bug

`llama-rn.podspec:47` globs `"#{llama_cpp}/ggml/src/ggml-cpu/**/*.{h,c,cpp}"` — every arch
directory for every slice — while upstream's CMake and the binding's own
`cmake/rnllama-sources.cmake` select per-arch sources (the podspec's own comment at
`:53-58` says it mirrors that file). The log shows how much already leaks:

```
/tmp/ios-build.log:7994-7998  libtool: warning: 'amx.o' has no symbols
                             libtool: warning: 'cpu-feats-dc83f079….o' has no symbols
                             libtool: warning: 'cpu-feats-19fb2065….o' has no symbols
                             libtool: warning: 'mmq.o' has no symbols
                             libtool: warning: 'qwen3tts.o' has no symbols
```

`quants.o` is the sixth such object, appearing only in the x86_64 `Libtool` invocation
(`:8612`), which is Patch 2 working as intended. Four other arch files are already
compiled to nothing in both slices.

**Failure scenario.** A future ggml bump adds one more unguarded function to
`arch/arm/quants.c`, or a new arch directory, or flips one `arch/x86` name — and the
simulator link fails again with a `_generic` dangling symbol that looks like a binding
regression rather than a podspec scoping problem. The next session repeats this
investigation from zero, in `node_modules`, where the fix cannot be committed.

---

## S2-8 — Recommendation: `EXCLUDED_ARCHS` in the Podfile. `exclude_files` per arch is not a thing.

**podspec `exclude_files` — REFUTED as an option.** `s.exclude_files` is a static
pattern list with no arch conditional; CocoaPods has no per-arch file selection
mechanism. Excluding `arch/arm/*` unconditionally would delete the kernels the arm64
device build needs (and would break Android's CMake path if it read the podspec).
There is no version of this that works.

**Do this instead**, in the existing `post_install` in `~/Projects/kalsa-ios/ios/Podfile`
(next to the `LLAMA_RN_CXX20` block at `:81-88`), scoped to the pod:

```ruby
target.build_configurations.each do |config|
  config.build_settings['EXCLUDED_ARCHS[sdk=iphonesimulator*]'] = 'x86_64'
end
```

Reasons, in priority order:

1. **It is the only fix that is committable.** `grep -rn EXCLUDED_ARCHS
   ios/Pods/Pods.xcodeproj/project.pbxproj` → **0 hits**; the x86_64 slice is being
   built today (`Libtool` ran both, and the app is fat `x86_64 arm64`). The Podfile is
   tracked and clean (`git status --porcelain ios/` is empty; Podfile mtime
   `23:03:43` precedes `project.pbxproj` `23:04:36`). A `node_modules` patch is destroyed
   by the next `npm ci` — `BINDING-PATCHES.md` says so in its own header.
2. **The slice is dead weight here.** This Mac is Apple Silicon; the simulator runs arm64
   natively. `ls .../Objects-normal/arm64/*.o | wc -l` → **433**, and the same **433**
   for `x86_64`. That is roughly half of a 263-307 s pod build spent producing code that
   can never execute on this machine.
3. **It kills the class, not the instance** (S2-7), and it does so without patching a
   third-party tree.
4. **It is scoped to the simulator SDK**, so device builds and any Intel-Mac build keep
   `x86_64`.

Cost, stated honestly: you lose early warning on x86-only breakage, and Intel-Mac
developers lose the simulator. If Intel-Mac support is wanted later, keep the binding-side
fix and gate the exclusion on `ENV['KALSA_APPLE_SILICON_ONLY']`.

**Keep Patch 2 anyway.** The binding is genuinely wrong on x86_64 regardless, and Android
CI or any Intel Mac would hit it.

---

## Item 2 verification — arm64 NEON intact, x86_64 dangling symbols gone

All from the DerivedData the logs point at.

**Per-slice symbols** (`nm -g` / `nm -gU` on
`…/llama-rn.build/Objects-normal/<slice>/Binary/libllama-rn.a`):

```
slice arm64:   T _ggml_vec_dot_q2_0_q8_0          T _ggml_vec_dot_q2_0_q8_0_generic
slice x86_64:  T _ggml_vec_dot_q2_0_q8_0          (no _generic — correct, x86 has none)
```

**Final dylibs:** unresolved `_generic` references = **0** in both
`…/Debug-iphonesimulator/KalsaAIChat.app/KalsaAIChat.debug.dylib` and
`…/Debug-iphoneos/…/KalsaAIChat.debug.dylib`. The ~2,813 remaining undefined symbols in
each are system-framework imports (Swift/Foundation/ExpoCamera), which is normal for a
bundle-loaded dylib. No duplicate symbols anywhere in either log.

**arm64 slice really is NEON**, not a scalar fallback — disassembly of
`_ggml_vec_dot_q2_0_q8_0` in the device dylib:

```
1112 ld1    360 sshll    101 sshll2    221 fmla    217 addv    3450 mul
```

**Patch 2 produces an empty TU on x86_64, full code on arm64:**

```
178,760 B  arm64/quants-9b4aaa9c….o   (arch/arm/quants.c, patched file)
    680 B  x86_64/quants-9b4aaa9c….o   (same source, guard → empty)
```

CONFIRMED on every point.

---

## S2-10 — `/tmp/ios-build.log` is an incremental tail, not the full simulator build

Task counts:

| log | CompileC | SwiftCompile | Ld | Libtool | lines |
|---|---|---|---|---|---|
| `/tmp/ios-build.log` | **2** | **0** | 4 | 2 | 10,275 |
| `/tmp/ios-device-build.log` | 857 | 147 | 4 | 40 | 69,014 |

The simulator log's only two compiles are exactly Patch 2's two TUs:

```
:3997  CompileC …/Objects-normal/arm64/quants-9b4aaa9c….o …/arch/arm/quants.c normal arm64 c
:8598  CompileC …/Objects-normal/x86_64/quants-9b4aaa9c….o …/arch/arm/quants.c normal x86_64 c
```

`BINDING-PATCHES.md` cites `/tmp/ios-build.log` as the evidence for "first full simulator
build 306.8 s". That log is the incremental re-link *after* Patch 2; the full build's log
was not kept.

**The conclusion still holds, the cited artifact does not.** The full simulator build
demonstrably happened: `/tmp/kalsa-ios-dd/…/llama-rn.build/Objects-normal/{arm64,x86_64}`
each hold 433 objects, and the fat `KalsaAIChat.debug.dylib` (109,428,672 B,
`Architectures … are: x86_64 arm64`) is on disk with all 68 embed symbols. So: keep
`BUILD SUCCEEDED`; fix the citation, and **keep both logs** next time — an incremental tail
is exactly the log that cannot answer the next question.

Note also that the two logs' warning profiles differ by two orders of magnitude
(27 vs 4,310), so the simulator log is not a representative sample of anything.

---

## S3-11 — The `exit code 0` error is device-side, and it is non-fatal

```
/tmp/ios-device-build.log:8695  error: the following command failed with exit code 0 but produced no further output
/tmp/ios-device-build.log:8696  SwiftCompile normal arm64 (in target 'ExpoModulesJSI' from project 'ExpoModulesJSI')
```

**Non-fatal — CONFIRMED.** The build continues and reaches `** BUILD SUCCEEDED **)` at
`:69009`, 8,314 lines later. It is Xcode 27 reporting a `SwiftCompile` task that emitted
no diagnostics; the process exit code was 0.

Two corrections to how it is described in the brief: it is **not** in the simulator log
(`grep -c 'command failed' /tmp/ios-build.log` → **0**), and the surrounding lines
(`:8690 umbrella header for module 'jsi' does not include header 'jsilib.h'`,
`:8697 cannot infer ownership of foreign reference value`) are warnings, not the cause.

**Operational note:** the line is prefixed `error:`, so any CI gate that greps for
`error:` will false-fail on a green build. Add an allowlist entry for
`command failed with exit code 0`.

Full error inventory, both logs: simulator **0**, device **1** (the line above). No
`Undefined symbols`, `duplicate symbol`, `ld:`, or `metal` failures in either.

---

## S2-12 — The C++ standard is `gnu++20`, not the podspec's `c++20`; `-O3 -DNDEBUG` beat `-O0`

The authoritative flags are in the response file the log references, still on disk:

`/tmp/kalsa-ios-dd/Build/Intermediates.noindex/Pods.build/Debug-iphonesimulator/llama-rn.build/Objects-normal/arm64/82b82416624d2658e5098eb0a28c15c5-common-args.resp`,
in order:

```
'-std=gnu++20'  -O0  -O3 -DNDEBUG -funroll-loops  -O3 -DNDEBUG -funroll-loops  '-std=c++20'  '-std=gnu++20'
```

Last `-std` wins ⇒ **effective C++ dialect is `gnu++20`** for all llama-rn C++ TUs. Last
`-O` wins ⇒ **`-O3 -DNDEBUG -funroll-loops`**, in a **Debug** configuration. C TUs get
`'-std=gnu11'` from the same family, which is fine.

Where the override comes from — `ios/Podfile:81-88`:

```ruby
# LLAMA_RN_CXX20: Force C++20 on all Pods
installer.pods_project.targets.each do |target|
  target.build_configurations.each do |config|
    config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'gnu++20'
    config.build_settings['CLANG_CXX_LIBRARY'] = 'libc++'
    config.build_settings['OTHER_CPLUSPLUSFLAGS'] = '$(inherited) -std=gnu++20'
```

These target-level settings shadow `llama-rn.debug.xcconfig`, which is where the podspec's
intent lives:

```
CLANG_CXX_LANGUAGE_STANDARD = c++20
OTHER_CPLUSPLUSFLAGS = $(inherited) -O3 -DNDEBUG -funroll-loops -std=c++20 -DRCT_NEW_ARCH_ENABLED=1 -ivfsoverlay …/React-VFS.yaml
```

and the resulting target block in `project.pbxproj` confirms
`CLANG_CXX_LANGUAGE_STANDARD = "gnu++20"; OTHER_CPLUSPLUSFLAGS = ("$(inherited)", "-std=gnu++20");`

**Does the code need C++20?** No, not beyond what `gnu++20` already provides. Across
`ggml/src`, `src`, `common`, `tools/mtmd`: zero `std::span`, zero `std::bit_cast`, zero
`consteval`, zero `std::source_location`, zero concepts, zero `<=>`, zero `std::format`.
The single C++20-gated construct is a feature test, `ggml/src/ggml-backend-reg.cpp:97`
`#if defined(__cpp_lib_char8_t)`. So the override is **functionally harmless today** —
REFUTED as a build hazard.

**What is actually wrong, in order of seriousness:**

1. The Podfile line applies to **every** pod target and silently rewrites a value that
   `react_native_post_install` had already composed (the `-ivfsoverlay React-VFS.yaml`
   VFS overlay and `-DRCT_NEW_ARCH_ENABLED=1`). It works today only because
   `$(inherited)` re-chains it. It is one `post_install` refactor away from silently
   dropping the VFS overlay for every pod in the app.
2. It defeats the podspec's stated intent (`-std=c++20`, strict). The binding cannot
   rely on strict-mode diagnostics and nobody will notice when that stops being true.
   Narrow the override to `CLANG_CXX_LANGUAGE_STANDARD` and drop the `OTHER_CPLUSPLUSFLAGS`
   assignment — the podspec already sets `-std=c++20`, and `$(inherited)` would then be
   the only thing needed.
3. **`-DNDEBUG` in a Debug pod.** I checked whether this kills ggml's checks and the
   answer is *no* for the ones that matter: `ggml.h:288` defines
   `GGML_ASSERT(x) → GGML_ABORT(…) → ggml_abort(…)`, and `ggml/src/ggml.c:253` calls
   `abort()` unconditionally at `:272`. 109 `GGML_ASSERT` sites in `ggml-metal-ops.cpp`
   survive. **But the 26 plain `assert()` calls in that file do not** — and those are the
   Metal shape/padding invariants (`ggml-metal-ops.cpp:3433`, `:3462`, `:3463`, `:3603`,
   `:3635`: `assert(ne12 == ne22); assert(ne13 == ne23);`, …). Partial instrumentation in
   exactly the file both patches touch. If you want the Debug pod to be debuggable, gate
   `base_optimizer_flags` on the configuration — the podspec already has the comment
   `# base_optimizer_flags = ""` at `:16-17` waiting for exactly this.

Confirmed present on the compile line (from the device log's clang invocation for a
llama-rn TU): `-DGGML_USE_METAL -DGGML_METAL_EMBED_LIBRARY=1 -DGGMLMetalClass
-DGGML_USE_CPU -DGGML_USE_ACCELERATE -DGGML_USE_BLAS -DGGML_BLAS_USE_ACCELERATE
-DGGML_USE_CPU_REPACK -DRNLLAMA_BUILD_FROM_SOURCE`, with
`-target arm64-apple-ios15.1`.

---

## S3-13 — The 68-symbol claim: correct, but it is 34 libraries

```
Debug-iphonesimulator/KalsaAIChat.debug.dylib : 68 ggml_metallib_* (68 unique), _OBJC_CLASS_$_RNLlama present
Debug-iphoneos/KalsaAIChat.debug.dylib       : 68 ggml_metallib_* (68 unique), _OBJC_CLASS_$_RNLlama present
```

CONFIRMED on both sides. The precision matters for the record: 68 = **34 kinds ×
(`_start` + `_end`)**, not 68 kernels. `ggml-metal-device.m` declares 34 `X(...)` entries,
34 `ggml-metal-embed-*.s` files exist, and the Podfile guard checks exactly those 34 — so
the embed set is complete and the guard's `missing` list was empty.

The embed path is unconditionally on: `ggml-metal-device.m:407`
`static NSString * ggml_metal_find_metallib(NSBundle * bundle, NSString * name)` is
compiled as dead code (`warning: unused function 'ggml_metal_find_metallib'`, device log
`:30602`) because `GGML_METAL_EMBED_LIBRARY` is 1. There is **no** flag to disable embed
without disabling Metal (`RNLLAMA_DISABLE_METAL=1` kills Metal entirely).

---

## Item 5 — Nothing else is patched. CONFIRMED, once the baseline is fixed

Method: `git -C ~/Projects/kalsallama archive 61c90948 | tar -x -C /tmp/base61`, then
`diff -rq` against the vendored tree, excluding the generated `ggml-metal-embed-*.s`
(those are produced by `scripts/gen-metal-embed.js`, which the Podfile runs on every
`pod install` — they differ between the two `node_modules` copies by design).

Exactly **four** files differ from engine `61c90948`, and only two are this session's work:

| file | verdict |
|---|---|
| `ggml/src/ggml-cpu/arch/arm/quants.c` | **Patch 2** |
| `ggml/src/ggml-metal/ggml-metal-ops.cpp` | **Patch 1** |
| `ggml/src/ggml-hexagon/ggml-hexagon.cpp` | pre-existing binding overlay, self-marked `// llama.rn: sessions are created on demand upstream…` |
| `ggml/src/ggml-metal/kernels/mul_mv.metal` | pre-existing binding overlay: `ushort tiitg` → `uint tiitg` in three kernel entry points |

Plus `Only in …`: generated `ggml/src/ggml-version.h` and `common/build-info.cpp`;
binding-added `common/parsers/function-gemma.cpp` and `ggml/src/ggml-hexagon/htp/v73`.

Everything else that differs from the pristine copy (`common/`, `src/llama-governor*`,
`src/llama-kv-cache*`, `cpp/rn-llama.*`, `cpp/jsi/*`, `src/types.ts`, `lib/**`) is the
binding's own overlay series plus **version drift**, not local edits — the overlay is
self-identifying (`// Kalsa patch (MoE streaming): …` in `common/common.h`;
`#if defined(__ANDROID__) && defined(RNLLAMA_ANDROID_ENABLE_LOGGING)` in `common/log.cpp`).

**One thing worth flagging anyway.** The iOS tree's binding is genuinely *older* than the
one in `~/Projects/kalsa` (11585 vs 11598), and the difference is a real fix that the iOS
pin is missing — `cpp/rn-llama.h` in the newer copy:

```cpp
-    const char * governor_npu_device = nullptr;
-    void setGovernorNpuDevice(const char * device);
-    std::string governorNpuDevice() const;
+    // … a data race on the old bare fields — so
+    // every access goes through the mutex-guarded accessors, and readers hold copies.
```

iOS impact is nil (Android-only NPU lane), but it means the iOS worktree is pinned to a
binding older than the main repo's, and any iOS finding about `governor_npu_device`
threading would have been a real one. Not a build defect; a pin-awareness note.

`bin/arm64-v8a/*.so` and `HTP_SKELS` differ — downloaded Android prebuilts, irrelevant
here.

---

## S2-16 / runtime — what compile success hides

**Nothing has ever run on iOS. That is the biggest gap in this whole exercise.**
`codesign -dv /tmp/kalsa-ios-dd-device/…/KalsaAIChat.app` → `code object is not signed at
all`. The device build is a compile-only proof. No Metal init, no context creation, no
model load, no first token has happened on any iOS target. Everything below is code
reading, not observation.

**Metal on the simulator — safe, but slower than expected.** `MTLCreateSystemDefaultDevice()`
returns the host GPU. `ggml-metal-device.m:1329-1335` maps `gpu_family` by descending
`supportsFamily:`; on the x86_64 slice that loop never matches, and the `Common`-family
loop at `:1337-1343` (guarded `#if TARGET_CPU_X86_64`) only logs, so `gpu_family` stays
`0`. `ggml_metal_tuning::fa_vec_pick` (`:1137-1170`) misses the table and returns
`fa_vec_baseline_cfg` — **degraded performance, correct results, no assert**. REFUTED as
a crash. Same fallback covers any unfamiliar family on real hardware.

**bf16 / tensor API — self-correcting.** `has_bfloat` and `has_tensor` are probed at
runtime (`:1139-1145`) and then *verified* by compiling a dummy kernel (`:1214-1257`),
falling back to `false` with a warning. The probe is honest. No finding.

**Embed path cost.** With embed on, kernels are compiled from the embedded sources at
first use (`ggml-metal-device.m:485-490`, `ggml_metal_library_compile_all` over all 34
libraries). Expect a multi-second stall on the first Metal dispatch. Not a defect, but it
will read as a hang and someone will file it as one.

**Accelerate / BLAS — linked correctly.** All five defines present; `OTHER_LDFLAGS =
… -framework "Accelerate" -framework "Foundation" -framework "Metal" -framework
"MetalKit"`; `ggml-blas.o` compiled (1 TU); 1,894 Accelerate/vector symbols present and
11 `cblas`/`vDSP` imports left undefined in the dylib for the system to resolve at
launch. Correct. Also `GGML_USE_CPU_REPACK` is on — fine on arm64, and the repark source
compiles to an empty TU on x86_64, which is another reason to stop building that slice.

**Model file access — entirely unverified.** No simulator run, no model on disk, no
sandbox/entitlement exercise. A clean link says nothing about it.

**Simulator cost of the status quo:** 433 x86_64 objects that cannot execute on an
Apple Silicon Mac, and ~half the pod build time (S2-8).

---

## S3-17 / S2 — Deployment targets, and the warning inventory

**Pod floor 15.1, app floor 16.4.** `llama-rn`'s Debug config in `project.pbxproj` has
`IPHONEOS_DEPLOYMENT_TARGET = 15.1`, and its sources compile with
`-target arm64-apple-ios15.1`, while `ios/Podfile:40` says
`platform :ios, podfile_properties['ios.deploymentTarget'] || '16.4'` and
`llama-rn.podspec:31` declares `13.0`. Pods are split 188×15.1 / 78×16.4 in the pbxproj.
Harmless today (pod floor below app floor), but nothing in llama.cpp is availability-
checked against the app's real floor, and the podspec's declared `13.0` is fiction.

**Availability warnings: 957 — all false positives.** `grep -c unguarded-availability`
returns 957, which looks alarming. It is not: those are the `-Wunguarded-availability`
**flag echoed inside echoed compiler command lines**, not diagnostics. The actual counts
of real availability problems are `only available on iOS` → **0** and `introduced in iOS` →
**0**. I am flagging this explicitly so the next session does not spend time on it.

**Real warning inventory** (device log, 4,310 total): 1,187 `-Wunused-function`,
1,141 `-Wdocumentation` (570 × 2 on `mu` / `candidates` parameters), 86
`-Wdocumentation-deprecated-sync`, 48 `-Wdeprecated-enum-enum-bitwise-conversion`,
37 `-Wambiguous-macro`, 36 `-Wreorder-init-list`, 27 `-Wobjc-missing-super-calls`.
Simulator log (27 total) is the incremental tail plus `libtool … has no symbols`.
**None of these predict runtime failure in the Metal or model paths.** The simulator log
additionally notes `Metadata extraction skipped, no AppIntents.framework dependency found`
— expected for an app with no AppIntents.

---

## What I could not settle

- Whether an oversized threadgroup-memory dispatch on the non-vec FA path produces a
  Metal validation failure or something worse (S3-4, PLAUSIBLE). Needs a device or
  simulator run with an artificial `max_theadgroup_memory_size`.
- Everything in the runtime section, by construction — nothing has been executed on iOS.
- Whether `BINDING-PATCHES.md`'s Patch 2 diff applies cleanly as written (its hunk headers
  are off by +2 lines; the recorded Patch 1 diff's blank-line context note is a
  hand-waving excuse for a hunk git would not emit).

## Recommended order of work

1. Correct `BINDING-PATCHES.md`: fix the pin (`61c90948`, not `5b596ce43`), move Patch 1's
   ownership from `kalsallama` to `Aspis0/kalsa.rn`'s vendor overlay, and note that the
   `while`-loop itself is an unattributed binding patch. Fix the Patch 2 hunk line numbers.
2. Add `EXCLUDED_ARCHS[sdk=iphonesimulator*] = 'x86_64'` to the Podfile `post_install`
   (S2-8). Keep Patch 2 as well.
3. Turn Patch 2's guard positive (`#if defined(__aarch64__) || …`) and attribute the loop.
4. Narrow the Podfile's C++ override to `CLANG_CXX_LANGUAGE_STANDARD` and drop the
   `OTHER_CPLUSPLUSFLAGS` clobber (S2-12).
5. Narrow the podspec's `ggml-cpu/**/*` glob to the per-arch file set its own comment says
   `cmake/rnllama-sources.cmake` already uses (S2-7) — in the binding repo, where it can be
   committed.
6. Install on a device and run one model end to end. The compile is not the milestone.
