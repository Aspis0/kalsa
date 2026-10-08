# Audit — `devices` nullptr termination for the one-copy load (n2, hostile)

Audited: `~/Projects/llama.rn-kalsa-onecopy` @ `e97c8383` (detached, working tree clean,
parent `a67d5bb8`). Change under review: `cpp/rn-llama.cpp` (one line) +
`src/__tests__/nativeSourceGuards.test.ts` (+44).

Method: read the commit, the engine's device-list walk and its choke point, every
`.devices` / `tensor_buft_overrides` / `kv_overrides` site under `cpp/` (incl. `cpp/jsi/`),
the draft-load path, the vendored engine's retention points, and the guard parser.
Only command run: `npx jest src/__tests__/nativeSourceGuards.test.ts` → `EXIT=0`,
`Tests: 8 passed, 8 total`, including
`✓ every devices list in rn-llama.cpp is nullptr-terminated (2 ms)`.
No file was edited; this report is the only write.

The fixed line, for reference:
- `cpp/rn-llama.cpp:332  // Raw array contract: the loader stops at the first nullptr (llama_prepare_model_devices), never past this vector's storage.`
- `cpp/rn-llama.cpp:333  params.devices = { npu, gpu, nullptr };`
- engine witness: `vendor/llama.cpp/src/llama.cpp:163  while (params.devices[n_devs]) {`
  and `:181  for (ggml_backend_dev_t * dev = params.devices; *dev; ++dev) {`

---

## Findings

### F1 — P2 — CONFIRMED — the guard is blind to the other device-list builders, which are the exact same crash

The guard scans one file (`src/__tests__/nativeSourceGuards.test.ts:130  const sites = devicesListSites(cpp('rn-llama.cpp'))`).
The same raw handoff is built in two other files:

- `cpp/jsi/RNLlamaJSI.cpp:547  cparams.devices = overrideDevices;`
- `cpp/jsi/RNLlamaJSI.cpp:555  cparams.devices = defaultDevices;`

Both are terminated only by a push inside their builders, which nothing pins:
- `cpp/jsi/RNLlamaJSI.cpp:158  devices.push_back(nullptr);` (the tail of `getFilteredDefaultDevices`)
- `cpp/jsi/RNLlamaJSI.cpp:509-510  // A null-terminated empty list tells llama.cpp to use no offload devices, i.e. CPU` (comment
  above the push in `buildDeviceOverrides`)

The sibling override array has the same shape and is also uncovered:
`cpp/jsi/JSIParams.cpp:438  cparams.tensor_buft_overrides.push_back({nullptr, nullptr});`

Drop either push and the app takes the identical `while (params.devices[n_devs])` walk off the
end of a vector; the new guard stays green because the file is never read. The commit message's
claim is file-accurate but the invariant it pins is not file-scoped.

### F2 — P2 — CONFIRMED — the parser is neither sound nor complete; it pins a shape, not the invariant

Parser under review (`src/__tests__/nativeSourceGuards.test.ts`):
- `:100  const assignment = /(\w+)\.devices\s*=\s*([^;]+);/g`
- `:108  } else if (rhs.includes('.devices')) {` … `:114  sites.push({ site: statement, terminated: true })`
- `:120  terminated: after.startsWith(`${target}.devices.push_back(nullptr)`),`

Silent passes (an unterminated non-empty list would be accepted):
1. **Every copy site.** `:114` hard-codes `terminated: true` for any RHS containing `.devices`, so
   `X.devices = Y.devices;` is unconditionally blessed regardless of `Y` or of `X`'s type. This is
   the exemption (F3) generalized into a permanent hole.
2. **Arrow form is not matched at all.** `(\w+)\.devices` requires a dot; `cparams->devices = {...}`
   contains no `.` before `devices` (checked: `rg -- '->devices\s*=' cpp/ android/ ios/` → no hits
   today, so this is a future-edit hole).
3. **Non-`=` mutation is not matched.** `params.devices.assign(...)`, `.insert(...)`,
   `.push_back(dev)` sequences have no `=` and are invisible.
4. **Any struct's `devices` member.** The regex cannot know the target is `common_params`; a
   `devices` member of another type would be judged by the same shape.
5. **Comments are scanned as code.** A comment line containing `.devices = …` is a "site" that
   satisfies `:131  expect(sites.length).toBeGreaterThan(0)`, so deleting the real sites while
   leaving a comment keeps the non-vacuity check green. (No such comment exists today —
   hypothetical.)
6. **Real raw arrays are invisible.** `cpp/rn-llama.cpp:385-386`:
   `const ggml_backend_dev_t npu_leg_devices[] = { npu, gpu, nullptr };` /
   `const ggml_backend_dev_t gpu_leg_devices[] = { gpu, nullptr };`
   are walked to a sentinel by the engine:
   `vendor/llama.cpp/src/llama-governor-legs.cpp:58  for (const ggml_backend_dev_t * d = devices; d && *d; ++d) {`
   The guard's name ("every devices list in rn-llama.cpp is nullptr-terminated") overstates what
   it checks; dropping the `nullptr` from either array is not caught.

Safe-direction false failures (legitimate code fails the guard, which invites its deletion rather
than repair): `{ npu, gpu, nullptr, }` (trailing comma), `params.devices = std::vector<ggml_backend_dev_t>{ npu, gpu, nullptr };`,
`{ npu, gpu }; params.devices.push_back(nullptr);` (brace branch never looks at the next statement),
and any comment or statement between the assignment and the `push_back` (`:117` uses
`trimStart()` then `startsWith`). Verified by reading the regex precedence: `:105` takes the brace
branch first, so a brace init that is terminated on the next line is reported unterminated.

Not run: no mutation test (would require editing the tree). The pre-fix text
`params.devices = { npu, gpu };` does fail the brace branch (`/nullptr\s*}$/` → false), so the new
test would have caught the exact regression — that part is sound.

### F3 — P2 — CONFIRMED (code), PLAUSIBLE (reachability) — the exempted copy silently discards the caller's filtered list, so the draft load falls back to the sweep that includes HTP

Exempted site:
- `cpp/rn-llama.cpp:1500  params_dft.devices = draft_params.devices;`
  (context `:1499  common_params params_dft = params;` … `:1513  LOG_INFO("Loading MTP draft model: %s", …)`,
  `:1514  draft_model.reset(llama_model_load_from_file(params_dft.model.path.c_str(), mparams_dft));`)

Is the exemption correct? For today's tree, yes (see R4): the only writer of the draft list is
`vendor/llama.cpp/common/arg.cpp:4240  params.speculative.draft.devices = parse_device_list(value);`
(CLI), terminated at `arg.cpp:1151  devices.push_back(nullptr);`; the JSI never fills it
(`grep "devices" cpp/jsi/JSIParams.cpp` → only the CPU-freq path at `:55`), and the CLI parser is
unreachable from the binding (no `common_params_parse` anywhere under `cpp/`).

But three facts make the surrounding comment and behavior worse than the comment claims:
1. `common_params params_dft = params;` copies the caller's filtered list, then `:1500` overwrites
   it with the (normally empty) draft list. `common_model_params_to_llama` then leaves
   `mparams.devices = nullptr` (`vendor/llama.cpp/common/common.cpp:1610-1611`), i.e. the engine's
   implicit sweep — `vendor/llama.cpp/include/llama.h:320-321  // NULL-terminated list of devices to use for offloading (if NULL, all available devices are used)`.
   On Android the caller's list exists precisely to keep HTP out of that sweep
   (`cpp/jsi/RNLlamaJSI.cpp:555`, and the binding's own comments at `cpp/rn-llama.cpp:564-571`).
2. The vendored engine's own helper for this operation **keeps** the base devices when the draft
   list is empty: `vendor/llama.cpp/common/speculative.cpp:2456-2459` —
   `// default to global devices value` / `if (!params_spec.devices.empty()) {` /
   `result.devices           = params_spec.devices;`. The fork's manual line diverges from it.
3. The guard's justification says the empty draft list is "left empty, which the loader skips"
   (`nativeSourceGuards.test.ts:110-111`). The loader does not skip the empty list in the sense of
   inheriting the caller's devices; it replaces them with a global sweep.

Pre-existing (git log: the block came in with `987799a1 kalsa: native patch set`), not introduced
by `e97c8383`. Reachability: draft load runs only when the governor is off
(`cpp/rn-llama.cpp:1384  throw std::runtime_error("Governor mode does not support speculative or MTP decoding");`).
A pinned-list MTP run on the S23 with the governor off would show an HTP entry in the draft load's
device log; I did not run it, so the consequence (wrong buffer types vs. crash) is unproven —
PLAUSIBLE.

### F4 — P3 — CONFIRMED — the model retains a `devices` pointer into the caller's vector (latent dangling pointer)

- `vendor/llama.cpp/src/llama-model.h:809  llama_model_params params;`
- `vendor/llama.cpp/src/llama-model.cpp:1354  llama_model::llama_model(const llama_model_params & params) : params(params), pimpl(std::make_unique<impl>()) {`
- The engine fixes ownership for the neighbouring borrowed pointer and not for `devices`:
  `:1355-1359  // llama_model_params stores tensor_split as a borrowed pointer, but the model` /
  `pimpl->tensor_split_owned.assign(params.tensor_split, …)` /
  `this->params.tensor_split = pimpl->tensor_split_owned.data();` — there is no equivalent copy of
  `devices`.

Callers whose vector dies while the model survives:
- `cpp/rn-llama.cpp:331  common_params params = owner.params;` (one-copy; model kept in
  `owner.governor_onecopy_init`, `cpp/rn-llama.h:137`, and exposed at `cpp/rn-llama.cpp:420  owner.model = owner.governor_onecopy_init->model();`)
- `cpp/rn-llama.cpp:486-487  common_params prefill_params = owner.params;` / `common_params decode_params = owner.params;`
- `cpp/rn-llama.cpp:1499  common_params params_dft = params;` (draft model kept in
  `cpp/rn-llama.h:125  llama_model_ptr draft_model;`)

Verdict: CONFIRMED that the raw pointer is stored past the caller's scope; REFUTED as a live bug —
an exhaustive search finds no post-load reader (`params.devices` appears in the whole tree only at
`vendor/llama.cpp/src/llama.cpp:160,163,172,178,181`, all inside the load). Same load-scoped pattern
for `llama_model_base::ml` (`vendor/llama.cpp/src/llama-model.cpp:1658  this->ml = &ml;` vs. the
stack loader `vendor/llama.cpp/src/llama.cpp:319  llama_model_loader ml(...)`), unused after load.
It is a landmine for the next engine code that reads `model->params.devices` — and the fork clearly
knows the borrowed-pointer pattern (the tensor_split fix above).

### F5 — P3 — CONFIRMED — the added comment states the opposite of the engine contract

`cpp/rn-llama.cpp:332  // Raw array contract: the loader stops at the first nullptr (llama_prepare_model_devices), never past this vector's storage.`

The engine has no bounds check; it reads past the vector's storage exactly when the terminator is
missing (`vendor/llama.cpp/src/llama.cpp:163`). Read as written, the sentence asserts that the
loader is safe regardless of the list — the misreading that produced the SIGSEGV.

### F6 — P3 — CONFIRMED — altitude: the one-line engine assert is missing, and it is the choke point for every writer

The engine already aborts loudly for the two sibling raw arrays at the exact place where the raw
pointer is taken:
- `vendor/llama.cpp/common/common.cpp:1628  GGML_ASSERT(params.kv_overrides.back().key[0] == 0 && "KV overrides not terminated with empty key");`
- `vendor/llama.cpp/common/common.cpp:1635  GGML_ASSERT(params.tensor_buft_overrides.back().pattern == nullptr && "Tensor buffer overrides not terminated with empty pattern");`
- but `:1610-1611  if (!params.devices.empty()) {` / `mparams.devices = params.devices.data();` has
  no assert.

One line there (`params.devices.empty() || params.devices.back() == nullptr`) converts this entire
bug class ("the list is unterminated somewhere") into a deterministic abort that covers `cpp/`,
`cpp/jsi/`, the draft copy, and any future writer — a text guard over one file cannot. Since the
pin is the fork (`vendor/VERSIONS:7  LLAMA_CPP_REPO=https://github.com/Aspis0/kalsallama`), the
durable home is that repo, not the local patch dir. Aside (out of scope, verified by reading):
`scripts/patches/llama.cpp/common.cpp.patch` is superseded — its hunk-1 marker
`os << " | kalsa-native-patches";` is already at `vendor/llama.cpp/common/common.cpp:439`, and its
hunk-2 addition `mparams.vocab_only      = params.vocab_only;` already at `:1614`, so
`scripts/sync-vendor.sh:313  patch -p1 --fuzz=0 -d "$dest" < "$patch_file"` (under
`:18 set -eo pipefail`) cannot apply it; `scripts/kalsa-patches/` is referenced nowhere. That may
matter to whoever implements F6.

### F7 — P3 — CONFIRMED — test hygiene: no negative control, header contract not updated, duplicate pin

- No fixture test feeds an unterminated sample through `devicesListSites` and asserts it is flagged;
  the only non-vacuity evidence is `:131  expect(sites.length).toBeGreaterThan(0)` (5 sites today:
  `:333`, `:515`, `:573`, `:575`, `:1500`). A one-line negative control is the standard way to keep
  a shape-matching regex honest.
- The file's header still lists three concerns and not this one
  (`src/__tests__/nativeSourceGuards.test.ts:1-6  Source-text guards for binding-native invariants … the governor failure error prefix … the eval-failure log … logToJsCallback must not forward DEBUG lines`).
- The lane-off termination pattern is now pinned twice, by two different regexes:
  `src/__tests__/governorLaneKvPlacement.test.ts:120-126` (`test("the lane-off branch places no KV decision of its own")`,
  matching through `decode_params.devices.push_back(nullptr);`). The new guard subsumes its
  termination half.

---

## Checked and clean (REFUTED items)

- **R1 — REFUTED (the crash cause is fixed).** `params` is copied at `cpp/rn-llama.cpp:331` and is
  alive across `:367  owner.governor_onecopy_init = common_init_from_params(params, true);`, whose
  constructor calls `common_model_params_to_llama` and then `llama_model_load_from_file`
  (`vendor/llama.cpp/common/common.cpp:1200` constructor, `:1239` load). With the terminator as the last element the
  sentinel walk cannot leave the vector's storage.
- **R2 — REFUTED (the leg arrays are safe, lifetime included).** `cpp/rn-llama.cpp:385-386` are
  terminated, and the engine copies the list instead of retaining the pointer:
  `vendor/llama.cpp/src/llama-context.cpp:103  // copy the leg list including its NULL terminator, so the memory module`
  `:107  leg_devices.push_back(*legs);` `:110  leg_devices.push_back(nullptr);`.
  The raw arrays are also still alive while `rn_governor` (and therefore every leg context) is
  constructed at `cpp/rn-llama.cpp:410-411`.
- **R3 — REFUTED (no other unterminated sentinel-walked array in `cpp/` today).** Every remaining
  site was read: `cpp/rn-llama.cpp:515  prefill_params.devices = { resolved.device, nullptr };`;
  `cpp/rn-llama.cpp:572-576  const auto lane_off = lane_off_devices(owner.params.devices);` /
  `prefill_params.devices = lane_off;` / `prefill_params.devices.push_back(nullptr);` / the same
  pair for `decode_params`; `cpp/jsi/RNLlamaJSI.cpp:547,555` (pushes at `:158`);
  `cpp/jsi/JSIParams.cpp:436,438` (`{nullptr, nullptr}`). `kv_overrides` is never built under `cpp/`.
  The resolver helper drops the terminator by design (`cpp/rn-governor-params.cpp:225-236`
  iterates and skips `nullptr`), and its single call site pushes the terminator back
  (`cpp/rn-llama.cpp:572-576`).
- **R4 — REFUTED (the exemption's premise is factually true today).** Only
  `vendor/llama.cpp/common/arg.cpp:4240` writes `speculative.draft.devices` in the whole tree, and
  `arg.cpp:1141/1151  devices.push_back(nullptr);` terminates it; `common_params_parse` is not
  called anywhere under `cpp/`; `common_params_speculative_draft::devices` defaults empty
  (`vendor/llama.cpp/common/common.h:350`); `applySpeculativeDraftOptions` sets no device list.
  So `params_dft.devices` is empty in the shipped app and the copy cannot feed an unterminated
  non-empty list to `llama_model_load_from_file` — today.
- **R5 — REFUTED (the exemption's technical claim about the terminator is right).** Appending
  `nullptr` to an empty vector would create `[nullptr]`, which the engine reads as an explicit empty
  device list (`common.cpp:1610-1611`, `llama.cpp:160-182`), i.e. no offload, instead of the
  default sweep. The coder is right that the copy site must not blindly push; the correct handling
  is a non-empty/terminated check (F6), not a push.
- **Not a finding, noted:** `params.devices` capacity/size after `{ npu, gpu, nullptr }` is exactly
  three, so the crash pattern (`devices[2]` reading the heap bytes after the allocation) is gone;
  no behavior change elsewhere, since every other consumer walks to the sentinel or counts non-null
  entries (`vendor/llama.cpp/common/speculative.cpp:50-56` skips `nullptr` by index).
