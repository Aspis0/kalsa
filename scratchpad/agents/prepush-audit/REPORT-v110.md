# Adversarial v1.1.0 pre-push audit

Target: /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-v110
Branch: kalsa-slot-and-metal
HEAD: c719778096d7c9a2e8114e500c46cda06d5e3e16
Base: 916b8f0bcfcb829011f129b4dff8acfd01ab7814

The requested lineage is correct:

~~~text
$ git rev-parse HEAD^
c2ebfc164eaa7dfe9c5346ca7a4df9f0f5497953
$ git rev-parse HEAD^^
916b8f0bcfcb829011f129b4dff8acfd01ab7814
$ git diff --name-status 916b8f0bc..HEAD
M       .github/workflows/kalsa-server.yml
M       tools/server/server-context.cpp
A       tools/server/tests/unit/test_slot_header.py
~~~

## Part A — X-Kalsa-Slot

### A1. Read point and precedence — REFUTED

The new helper is at server-context.cpp:4529-4555 and is called beside the existing
cache-salt helper at server-context.cpp:4570-4571:

~~~text
const std::string cache_salt = get_cache_salt(req);
const int32_t     id_slot_header = get_slot_from_header(req);
~~~

Both helpers therefore run at the same point relative to each other. They do not run before
the request body is parsed. Every wrapper that reaches handle_completions_impl parses or
transforms req.body first. For example:

- /completion, /completions and /v1/completions parse at server-context.cpp:5213-5234.
- chat completions parse and convert at server-context.cpp:5237-5251.
- responses parse and convert at server-context.cpp:5294-5310.
- transcriptions parse and convert at server-context.cpp:5316-5342.
- Anthropic messages parse and convert at server-context.cpp:5344-5360.
- infill validates and rewrites the body at server-context.cpp:5153-5205.

Only after those operations does handle_completions_impl read both headers. This is later
than the desktop requirement “before the body” and is the exact seam the addendum warned
about.

On the inference routes that do reach the helper, the valid-header precedence itself is
correct: server-context.cpp:4627 first loads body id_slot, then server-context.cpp:4628-4629
replaces it when the parsed header is non-negative. No later code in that function replaces
that task field before queueing. A valid header therefore beats body id_slot on those routes.

### A2. Route coverage and seam matrix — REFUTED, BLOCKING

The complete public route registration is server.cpp:246-286. Grouped by whether the new
helper is reached:

| routes | body handling | X-Kalsa-Slot result |
|---|---|---|
| POST /completion, /completions, /v1/completions | wrappers parse, then call handle_completions_impl | applied to task.id_slot |
| POST /chat/completions, /v1/chat/completions | convert, parse, then call handle_completions_impl | applied |
| POST /responses, /v1/responses | convert, parse, then call handle_completions_impl | applied |
| POST /audio/transcriptions, /v1/audio/transcriptions | convert, parse, then call handle_completions_impl | applied |
| POST /v1/messages | convert, parse, then call handle_completions_impl | applied |
| POST /infill | validates and rewrites body, then calls handle_completions_impl | applied, but late |
| POST /slots/:id_slot with action save, restore, or erase | post_slots reads the URL id_slot at server-context.cpp:5078-5105; handlers queue that path id at :5611, :5647, and :5676 | BYPASSES the helper; header is ignored |
| GET /slots | creates a SLOT_GET task at server-context.cpp:5036-5075 | bypasses; no slot selection is made |
| POST /v1/chat/completions/control | reads body control id/action at server-context.cpp:5257-5292 | bypasses; no task slot |
| POST chat/responses/messages input-token endpoints | call handle_count_tokens, not handle_completions_impl, at server-context.cpp:5253-5255 and :5312-5314, with registrations at server.cpp:276-280 | bypasses; no slot task |
| GET/POST /health, /v1/health, /metrics, /props, /models, /v1/models | administrative/status handlers at server.cpp:246-252 | bypasses; no slot task |
| POST /embedding, /embeddings, /v1/embeddings, /rerank, /reranking, /v1/rerank, /v1/reranking | embedding/rerank handlers at server.cpp:265-271 | bypasses; no task.id_slot |
| POST /tokenize, /detokenize, /apply-template | utility handlers at server.cpp:272-274 | bypasses; no slot task |
| GET/POST /lora-adapters | adapter handlers at server.cpp:282-283 | bypasses; no slot task |

The /slots/:id_slot actions are the blocking case. They accept a body, parse its filename,
and dispatch a slot action, but never read X-Kalsa-Slot. The request-selected URL slot
therefore wins regardless of the forwarded header. A client can choose that URL slot itself,
and the desktop door cannot seal the slot through this inlet on those forwarded requests.
This directly fails the addendum’s requirement that slot-action endpoints be covered.

### A3. Absent, invalid, and disagreement behavior — MIXED

For a completion route, server-context.cpp:4627-4629 gives the exact behavior:

- absent header: id_slot comes from body, or remains -1 for the existing LCP/LRU selection;
- valid header: header replaces the body value;
- invalid header: get_slot_from_header returns -1, so the body value is used;
- no later cache or early-return can overwrite a valid header value after this assignment.

The literal statement that the body can decide only when the header is absent is not true:
invalid, empty, whitespace, signed, non-numeric, and overflow header values are deliberately
treated as absent and also allow body id_slot to decide. The precise rule is “only when
there is no valid header value.”

The parser is bounded and non-throwing for the requested hostile values. It uses
std::from_chars into int32_t at server-context.cpp:4544-4551, requires full-string
consumption, rejects negative values, and rejects overflow through the error code. The
invalid test set includes empty, negative, decimal, hexadecimal, non-numeric, trailing
whitespace, a huge integer, and 4096 digits at test_slot_header.py:13-29. This part is
CONFIRMED.

### A4. Leak surface — REFUTED, BLOCKING

The raw header string is not stored, but the valid parsed value is not actually invisible.
For a valid X-Kalsa-Slot:1 on an inference route:

- server-context.cpp:1565-1569 logs selected slot by id (1);
- non-OAI final responses include id_slot at server-task.cpp:340-346;
- non-OAI streaming responses include id_slot at server-task.cpp:1049-1057.

The metrics formatter at server-task.cpp:1528-1612 does not expose a slot label, so there
is no direct metrics leak of the slot value in that formatter. There is nevertheless a
logging and response-body exposure for valid values, which violates the stated “never
logged” and “never echoed in a response body” acceptance criterion. Header values do not
reach response headers or error strings directly in this diff, but that does not cure the
log/response violations.

The new leak test is decorative for this requirement. At test_slot_header.py:164-226 it
uses the sentinel LEAKSENTINELSLOT987654321, which is invalid and therefore never enters
task.id_slot. It proves that an invalid raw string is not copied, but it does not send a
valid numeric header and cannot catch the existing “selected slot by id (1)” log or the
ordinary id_slot response field. It also tests /props, /slots, /metrics, and an unrelated
error response, but not the slot-action route.

### A5. Additivity — CONFIRMED

The server diff is additive apart from the required include and the new call/override:

~~~text
$ git diff --unified=3 916b8f0bc..HEAD -- tools/server/server-context.cpp
+#include <charconv>
+static int32_t get_slot_from_header(...)
+const int32_t id_slot_header = get_slot_from_header(req);
+if (id_slot_header >= 0) { task.id_slot = id_slot_header; }
~~~

No checkpoint file, cache-salt implementation, task structure, or existing checkpoint
logic is changed. The helper is inserted immediately after get_cache_salt; the cache-salt
body itself is unchanged. The additivity claim is therefore true, but it does not resolve
the route coverage or leak findings.

### A6. Tests — UNVERIFIABLE, with a blocking coverage gap

The repository-documented command was run exactly:

~~~text
$ cd /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-v110/tools/server/tests
$ ./tests.sh unit/test_slot_header.py -v -x
server_binary=present
ImportError while loading conftest ...
ModuleNotFoundError: No module named 'wget'
exit code: 4
~~~

No tests ran and there are no pass/fail counts. The focused file does contain unit-level
coverage for header-to-slot, header-over-body, absent/body, invalid/fallback, case-insensitive
names, and an attempted leak check at test_slot_header.py:76-226. It has no end-to-end
coverage for /slots/:id_slot, no valid numeric leak assertion, and no route matrix coverage.

## Part B — Apple/Metal build

### B1. Flags and inherited release gates — MIXED

The requested flags are present at workflow lines 381-382:

~~~text
-DGGML_METAL_EMBED_LIBRARY=OFF
-DGGML_METAL_NDEBUG=ON
~~~

The previously reviewed release controls remain visible: dispatch and branch/tag triggers
at lines 20-43, repository contents read permission at 47-48, tag-ref checkout at
156-164, HEAD versus refs/tags/<tag> assertion at 166-182, double-pack comparison at
467-479, archive normalization at 453-464, all-Mach-O RPATH validation at 557-601,
--version at 522, and /health at 603-617. No upload-artifact, download-artifact, or
actions/cache occurrence exists in the workflow. Static inspection confirms these controls,
but the Metal build cannot pass its own artifact assertion.

### B2. The committed OFF setting cannot produce default.metallib — REFUTED, BLOCKING

The workflow comment at .github/workflows/kalsa-server.yml:371-374 claims that
GGML_METAL_EMBED_LIBRARY=OFF compiles and produces default.metallib. The checkout’s actual
CMake contradicts that claim:

- ggml/src/ggml-metal/CMakeLists.txt:56 gates the entire metallib generation block on
  if (GGML_METAL_EMBED_LIBRARY).
- The only set(METALLIB_FILES ...) is inside that block at :189.
- The custom commands producing default.metallib and ggml-tensor.metallib are inside it
  at :192-226.
- The OFF branch at :117-129 copies kernel sources to the runtime directory; it does not
  create a metallib.
- The later install block at :230-241 refers to METALLIB_FILES after the variable was
  defined only in the skipped ON block.

On a clean GitHub runner, cmake --build therefore cannot create build/bin/default.metallib
from this CMake with the workflow’s OFF flag. The immediate workflow assertion at
:389-392 exits before packaging. This is a source-level proof; no build was run, per the
request.

### B3. SDK/version and tensor decision — PARTIALLY CONFIRMED, UNREACHABLE

The build prints xcodebuild -version and xcrun --show-sdk-version at workflow:361-365.
CMake itself emits the exact skipped message from
ggml/src/ggml-metal/CMakeLists.txt:154-159:

~~~text
Metal SDK <version> does not support the tensor API, skipping ggml-tensor.metallib
~~~

The workflow captures configure output through tee with pipefail and checks that exact
message at :399-407 when the tensor file is absent. If the file exists, it records
produced and sets the output to 1; if absent without the CMake skip message, it fails.
That distinction is logically sound, but it is unreachable because default.metallib is
asserted first and cannot be produced with OFF.

### B4. Packaging and lookup declaration — REFUTED as a shipping path

The intended packaging checks are present:

- pack checks default.metallib at workflow:446-450;
- verify checks default and optional tensor libraries and reports kernels at :539-555;
- the tar name remains kalsa-server-<version>-bin-macos-<arch>.tar.gz and the transform
  keeps top directory kalsa-server-<version> at :444 and :463;
- the manifest contract remains the existing derived archive/executable contract.

The CMake OFF branch does copy the kernels fallback sources, but it does not produce the
required default.metallib. Consequently the archive is never made on a clean runner and
these static packaging assertions cannot establish a usable v1.1.0 artifact.

The /health probe is present at workflow:603-617. The workflow starts the extracted binary
with the files beside it and prints a lookup classification at :619-627. However,
“no Metal library lookup in the log” is accepted as a non-error, and the server is started
without a model-load argument. A successful /health therefore does not prove that the
Metal backend initialized or that a metallib was loaded. The loader’s real messages are
at ggml-metal-device.m:392-429 and :495-539; the workflow’s grep patterns match those
messages, but it does not fail when no lookup occurs.

The fallback documentation step similarly reports a path but does not fail on the
“no Metal library lookup” result. This is insufficient evidence for the requested
bundle/next-to-binary/runtime-source assertion even after the CMake production issue is
fixed.

## Part C — house rules

### C1. File size — DECLARED, no new over-limit file

Before and after line counts:

~~~text
tools/server/server-context.cpp       5826 -> 5865 (+39)
tools/server/tests/unit/test_slot_header.py 0 -> 226
.github/workflows/kalsa-server.yml     941 -> 1104 (+163 net)
~~~

server-context.cpp and the workflow were already far above the 350-450 guideline; this
change adds only 39 and 166 inserted lines respectively and does not refactor them.
The new test is 226 lines. The pre-existing oversized files should be explicitly accepted
as such by the owner; this change does not create a new oversized source file.

### C2. Comments/imports/refactoring — MIXED

<charconv> is required for std::from_chars. The Python imports http.client, json, os,
pytest, and utils are used. The slot comments explain the security boundary and validation,
rather than merely narrating the following statement.

The workflow adds many explanatory comments, mostly tied to decisions or failure modes.
There is one inaccurate comment at workflow:371-374 because it describes the opposite of
the checked-in CMake behavior, and a grammatical comment at :410 (“the set the cmake”).
The inaccurate comment is a correctness finding, not a harmless style issue. No unrelated
refactor is present in the server diff.

## Required fixes, ordered

1. Move X-Kalsa-Slot extraction into the common request/door layer before body parsing, or
   otherwise guarantee it is read before every forwarded body and every slot-action route.
   Specifically cover /slots/:id_slot save, restore, and erase; do not leave them on the
   path-id-only decision.
2. Decide and enforce the leak contract. If the numeric slot is truly private, remove or
   redact it from the existing selection log and non-OAI response fields, and add a valid
   numeric sentinel test at -lv 3 and verbose levels. If those ordinary slot identifiers
   are intentionally public, narrow the acceptance criterion and the test name instead.
3. Correct the Metal build mechanism so a clean checkout actually produces
   default.metallib and optional ggml-tensor.metallib. The current OFF setting skips the
   CMake generation block and fails the first artifact assertion.
4. Make the Metal health verification load a model or otherwise initialize ggml-metal, and
   fail unless the log proves one of the required lookup paths. Keep the SDK skip message
   assertion for the tensor library.
5. Add end-to-end tests for slot-action/header precedence and valid-value exposure. The
   focused test command must run with the repository dependencies installed.

## Final verdict

NOT PUSH-SAFE as the two commits. The X-Kalsa-Slot route seam and valid-value leak are
blocking isolation failures, and the Metal workflow cannot produce its required default
library from the checked-in CMake with GGML_METAL_EMBED_LIBRARY=OFF.

Metal is NOT verified enough to ship in this tag. It should be split into a later version
after the CMake mode is corrected and a real macOS runner proves both precompiled-library
loading and the source fallback with a model-initializing health/inference check.

NOT PUSH-SAFE.

## Correction after rebuttal: Metal control flow and packaging

This section corrects the factual basis of B2/B3/B4 without rewriting the
original review above. A2, A4, A6, and Part C are unchanged.

### Corrected B2 — CMake OFF mode: CONFIRMED, not REFUTED

I re-read the target at `c719778096d7c9a2e8114e500c46cda06d5e3e16` directly.
The reproducing command is:

~~~text
$ grep -nE '^\s*(if|else|elseif|endif)\s*\(' ggml/src/ggml-metal/CMakeLists.txt | awk -F: '$1>=50 && $1<=250'
56:if (GGML_METAL_EMBED_LIBRARY)
117:else()
133:    if (NOT METAL_SDK)
135:    endif()
137:    if (CMAKE_OSX_SYSROOT MATCHES "[Ss]imulator")
139:    else()
141:    endif()
143:    if (GGML_METAL_SHADER_DEBUG)
150:    else()
152:    endif()
155:    if (METAL_SDK_VERSION VERSION_GREATER_EQUAL 26.0)
157:    else()
159:    endif()
161:    if (GGML_METAL_MACOSX_VERSION_MIN)
164:    elseif (NOT GGML_METAL_TARGET_OS STREQUAL "macos" AND CMAKE_OSX_DEPLOYMENT_TARGET)
167:    endif()
169:    if (GGML_METAL_STD)
172:    endif()
192:    if (GGML_METAL_HAS_TENSOR_LIB)
212:    endif()
228:endif() # GGML_METAL_EMBED_LIBRARY
230:if (NOT GGML_METAL_EMBED_LIBRARY)
241:endif()
~~~

The `else()` at line 117 is the active `GGML_METAL_EMBED_LIBRARY=OFF` branch.
In that branch:

- `:117-129` stages headers and kernel sources;
- `:143-152` selects `-O3` unless shader debug is enabled;
- `:154-159` reads the SDK version and sets/skips the tensor library at SDK 26;
- `:174-187` compiles each kernel to AIR;
- `:189-212` defines `default.metallib` and the optional tensor AIR/library;
- `:214-227` links `default.metallib` and makes `ggml-metal-lib` an `ALL` target.

Therefore the workflow's `-DGGML_METAL_EMBED_LIBRARY=OFF` at
`.github/workflows/kalsa-server.yml:381` is the mode that produces the
precompiled libraries. The old B2 statement that OFF skips generation was
incorrect and is withdrawn. The old B3 “unreachable” conclusion was also based
on that error.

### Corrected B3 — SDK/tensor decision: CONFIRMED and reachable

The CMake message at `CMakeLists.txt:158` is emitted only for SDK versions below
26.0. At `:155-156`, SDK 26 or newer enables `GGML_METAL_HAS_TENSOR_LIB`, which
causes the `ggml-tensor.metallib` custom command at `:204-209` to be added. The
workflow captures configure output at `kalsa-server.yml:375-386` and
distinguishes the outcomes at `:394-407`:

- tensor file present: it records `produced` and sets `TENSOR=1`;
- tensor file absent with the exact CMake skip message: it records the skip;
- tensor file absent without that message: it exits 1.

That logic is reachable after the corrected OFF-branch reading. No build was
run, as required by the audit scope.

### Corrected B4 — packaging: CONFIRMED with an explicit-copy trap

The CMake link command at `CMakeLists.txt:214-222` removes the staged runtime
`ggml-common.h`, `ggml-metal-impl.h`, and `kernels/` at `:217-219` after linking.
Thus, an archive made blindly from `build/bin` immediately after CMake would
not contain the source fallback. The separate CMake install rule at `:230-241`
does install the source `kernels/` tree and `${METALLIB_FILES}`.

The workflow does not use the install tree, but it explicitly compensates for
that trap at `kalsa-server.yml:410-418`:

~~~text
mkdir -p build/bin/kernels
cp ggml/src/ggml-metal/kernels/*.metal build/bin/kernels/
cp ggml/src/ggml-metal/kernels/*.h     build/bin/kernels/
cp ggml/src/ggml-metal/ggml-metal-impl.h build/bin/
cp ggml/src/ggml-common.h                build/bin/
~~~

The `set -euo pipefail` at `:360` makes a failed copy abort. Packaging then
archives all of `build/bin` at `:456-464`; its Metal preflight checks the
metallibs at `:446-450`, and verification checks the staged `kernels/` at
`:539-555`. I agree with the packaging rule: the workflow must package from an
install tree or copy the fallback sources explicitly. This workflow chooses the
second option, so the CMake cleanup is a real trap but not a current packaging
omission.

### B4 health evidence remains insufficient: REFUTED as acceptance evidence

The independent criticism still stands. The workflow launches the extracted
server with only `--port` and `--host` at `kalsa-server.yml:603-604`; it supplies
no model-load argument. `/health` at `:607-617` can therefore succeed without
initializing the Metal backend or loading a metallib. The classifier at
`:527-536` returns the literal `no Metal library lookup in the log` when no
lookup is seen, and the caller merely prints it at `:619-627` while allowing
`grep` to fail via `|| true`. The fallback documentation step has the same
non-gating behavior at `:647-685`.

This is not caused by the corrected B2 interpretation. It is a separate
verification gap. The required fix remains: load a real model or otherwise
force `ggml_metal` initialization, then fail the job when no required lookup
path is observed. A successful `/health` alone is not evidence of Metal
initialization.

### Corrected Metal verdict and final verdict

Corrected Metal sub-verdicts:

```text
B2 CMake OFF generation: CONFIRMED
B3 SDK/tensor production-or-skip distinction: CONFIRMED
B4 archive contents: CONFIRMED, because the workflow explicitly restores kernels/
B4 backend initialization proof: REFUTED / insufficient
```

The two commits remain **NOT PUSH-SAFE** overall because the unchanged A2 and A4
slot isolation findings are blocking, and because B4 still does not prove that
the shipped Metal backend initializes or loads a library. The reason is no
longer “OFF cannot produce default.metallib”; that reason was factually wrong.

Metal is still not verified enough for this tag. It should remain out of the
ship decision until the model-initializing lookup check is made fail-closed and
run on a real macOS runner. The separate A2/A4/A6 and Part C conclusions remain
as recorded above.

**Corrected final verdict: NOT PUSH-SAFE as the two commits; Metal should ship
only after the B4 verification fix and runner evidence.**
