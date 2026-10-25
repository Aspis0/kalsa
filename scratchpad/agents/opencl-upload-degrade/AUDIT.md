# Independent audit: OpenCL weight-upload abort -> throw degradation

Reviewed by an independent read-only pass over the worktree
`/Users/marco/Projects/kalsallama-wt-opencl-degrade`, the saved diff
`opencl-upload-degrade.diff`, the report `REPORT.md` (sections 1-5), and the
upstream repos at ref `1068eb03d301a1dcb657f4e6923fe77678e651ee`. No file in
either tree was modified; no device was touched.

## Verdict up front

Yes - this change may be built into an APK for a device test as it stands. The
diff is exactly what the report says it is (one file, +113/-32, verified
byte-identical to the saved diff and to the working tree), the exception route
to the existing governor fallback is mechanically sound with no `noexcept`, no
swallowing catch, and no async-worker hazard on the path, and the staging-buffer
release added before each of the 5 write-failure throws is provably safe (valid
`cl_mem`, never a sub-buffer, mirrors the pre-existing success-path release).
Caveats to carry into the device test: (1) the exact Android/Adreno compile and
link has never been done - the APK build itself is the first real build of this
code, so treat a first link failure as expected friction, not a defect of the
design; (2) the change removes only the staging/upload allocation and write
class of aborts - 262 kernel-execution checks remain inside the same function
and `clEnqueueNDRangeKernel` / `clWaitForEvents` can still kill the process
mid-load under exactly the memory-pressure scenario this change targets, so a
device test that still aborts is not evidence this change failed; (3) two of
the 30 converted sites (the BF16 staging create and the generic pool write) are
also reachable at decode time through `llama-graph.cpp`, where a throw follows
the binding's decode path (which is not try/catch-wrapped in the binding)
rather than the load-fallback channel - strictly no worse than the previous
abort, but worth knowing. A positive device result should therefore be framed
as: the upload-failure class now degrades; the kernel-execution class remains
open, exactly as the report discloses.

## 1. SCOPE - CONFIRMED

- During this audit the author committed the change onto the local ref
  `kalsa-opencl-upload-degrade` = `909243206a`, whose parent is exactly
  `1068eb03d301a1dcb657f4e6923fe77678e651ee` (`git log --format=%P` verified).
  As instructed, the audit relies on the saved diff plus file content, not the
  index. Facts that make the evidence chain safe: `git diff 1068eb03d
  909243206` is byte-identical to the saved `opencl-upload-degrade.diff`, the
  working tree of the worktree is clean, so working-tree content == commit
  content == saved diff. `git show --stat`: one file
  (`ggml/src/ggml-opencl/ggml-opencl.cpp`), 113 insertions, 32 deletions -
  matches the claim exactly.
- Nothing else from this author is in the worktree: `git status --porcelain`
  is empty; the build dir lives outside the worktree at
  `/Users/marco/Projects/kalsallama-wt-opencl-degrade-build` as stated.
- The shared tree `/Users/marco/Projects/kalsallama` still shows exactly its
  original 7 modified files plus 3 untracked entries (same list as before this
  audit began), and the change's fingerprints are absent from it:
  `throw_set_tensor_upload_error` grep count 0, no
  `clReleaseMemObject(data_device);` anywhere. Consistent with "untouched"
  (a bit-for-bit proof of the pre-existing dirty files is not possible without
  a prior snapshot, but nothing contradicts the claim).
- Report defect (cosmetic, worth fixing): section 2.3's "Full diff" block
  accidentally inlines TWO diff generations - first without the leak fix
  (`index 97ebf0d18..d84d6081a`), then with it (`..1debeec10`). The saved
  `.diff` file is the final one and is authoritative. Also the closeout's
  "no new ref, no commit" is now stale (expected; the task anticipated the
  commit).

## 2. THE EXCEPTION ROUTE - CONFIRMED (precedent: PARTIAL, see below)

Route verified hop by hop:

- `ggml/src/ggml-backend.cpp:335` `ggml_backend_tensor_set` calls
  `buf->iface.set_tensor(...)` directly at `:347`. Grep: zero `catch` in the
  whole file - nothing swallows the throw there.
- `ggml/src/ggml-backend-impl.h`: `struct ggml_backend_buffer_i` (:46) holds
  raw C function pointers (`set_tensor` at :55); `grep -c noexcept` = 0 in the
  header. Throwing through this pointer is well-defined C++ as long as the
  unwind path is C++ - and it is: every frame
  (`ggml-backend.cpp`, `llama-model-loader.cpp`, `llama-model.cpp`,
  `llama.cpp`, `common.cpp`, app `rn-llama.cpp`) is a C++ TU. No C frame, no
  `extern "C"` problem.
- Intermediate catches: `src/llama-model-loader.cpp` has exactly one catch
  (`:1164-1166`, `std::out_of_range` in key parsing, different function);
  `src/llama-model.cpp` has zero catches; `common/common.cpp` catches only
  filesystem errors (`:1150`, `:1162`) and a scoped `std::stoi` (`:2053`), none
  on this path; the `llama_model_load_from_file_impl` /
  `llama_model_load_from_file` wrappers (`src/llama.cpp:379-470`) have no
  try/catch.
- The named catch exists: `src/llama.cpp` `llama_model_load` opens its try at
  `:318`, calls `model->load_tensors(ml)` at `:369`, and catches at `:374-376`
  ("error loading model: ...", returns `{-1, nullptr}`), with the model held by
  a `unique_ptr` inside the try, so the weight buffer, buffer context, and all
  tensor extras are destroyed during unwind before the catch runs. From there
  the app side is exactly as reported: `rn-llama.cpp:97-101` try/catch around
  `common_init_from_params`, and `:102-104` the nullptr/model-null check, both
  funneling into `log_governor_fallback` (:63-69, prints
  `KALSA_GOVERNOR_FALLBACK`); JS `governorRuntime.ts:35-45` (`isGovernorFallback`)
  and `:57-78` (`initWithGovernorFallback` retries `args.cpuParams`), wired at
  `LlamaService.ts` with `cpuParams.n_gpu_layers = 0`. All line numbers
  verified by reading the files.
- Thread hazard ruled out: OpenCL reports `.async = false`
  (`ggml-opencl.cpp:14382` at ref, `:14463` in the working tree) and
  `.set_tensor_async = NULL` (ref `:9974`); the loader's async-upload worker
  requires `props.caps.async && host_buffer && events`
  (`llama-model-loader.cpp:1546-1549`), so it is not created for OpenCL and
  both sync call sites (`:1663`, `:1735`) run on the loading thread. A throw
  here cannot cross a thread boundary.
- Baseline confirmed: `GGML_ASSERT` is not NDEBUG-gated
  (`ggml/include/ggml.h:288`), `ggml_abort` ends in `abort()` at
  `ggml/src/ggml.c:272`. The "abort kills the process today" premise holds.
- Precedent, decided precisely: the author's cited precedent
  (`ggml_backend_opencl_buffer_type_alloc_buffer` retries 4 ways and returns
  `nullptr` at working-tree `:14360`; caller throws
  `"unable to allocate %s buffer"` at `src/llama-model.cpp:1792` and `:1808`)
  is real, but no exception crosses the ggml iface in it - a nullptr crosses
  and the throw originates in llama's own frame. The report words this
  correctly ("adjacent fact ... reaches the existing throw"); it never claims
  a throw-through-iface precedent. For the audit question: a true
  throw-out-of-a-ggml-buffer-iface-callback precedent DOES exist in this
  codebase - `ggml_backend_sycl_split_buffer_init_tensor`
  (`ggml/src/ggml-sycl/ggml-sycl.cpp:1211` at ref, registered as
  `.init_tensor` at `:1407`) throws `std::runtime_error` from inside an iface
  callback. So the pattern is established for the iface family (alloc/init
  slots, other backends) and NOVEL for the OpenCL `set_tensor` slot
  specifically. Novel but mechanically sound, per the checks above.

## 3. THE LEAK FIX - CONFIRMED (all four sub-questions)

The 5 release-before-throw sites in the working tree: `:10990` (Q1_0 staging
write), `:11194` and `:11198` (Q4_0 MoE host-repack d/q writes), `:12793`
(Q2_K), `:12876` (Q3_K). Verified:

(a) `data_device` is guaranteed non-NULL and a live `cl_mem` at each site. At
`:10985-10987`, `:12789-12791`, `:12872-12874` the immediately preceding
`if (err != CL_SUCCESS) throw` guarantees the preceding `clCreateBuffer`
succeeded (per the OpenCL spec, `CL_SUCCESS` implies a valid non-NULL result);
at `:11194/:11198` the value came from `ggml_cl_create_temp_upload_buffer`
which is NULL-checked at `:11076`. So each release targets a valid object; no
release of NULL, no release of an already-released object. The helper itself
releases every partial attempt on all its failure paths (write-fail release,
map-fail release, unmap-fail release, working-tree `:10875-10905`), so the ten
helper-NULL throws leak nothing.

(b) Not sub-buffers. `grep clCreateSubBuffer` over the file shows every carve
assigns to `extra->d/q/s/...` or compute-path locals (`b_sub_buf` etc.);
nowhere is a sub-buffer assigned to `data_device`. The five sites' buffers are
raw `clCreateBuffer` staging (Q1_0/Q2_K/Q3_K) or the helper's temp buffer
(Q4_0 repack). Note the Q4_0 repack path carves `extra->d/q` FROM
`data_device` (`:11101/:11110`) - releasing the parent while those
sub-buffers live is refcount-safe, and is exactly what the pre-existing
success path already does at `:11204` (`CL_CHECK(clReleaseMemObject(data_device))`).
The failure-path releases mirror an established, in-file pattern.

(c) Plain release, return ignored - correct. `CL_CHECK` ends in
`GGML_ASSERT`/`abort`, which on the failure path would defeat the whole
change; `clReleaseMemObject` on a valid object has no meaningful failure mode
here, and ignoring the status cannot abort. The one residual: the buffer
context destructor (`:10024`) releases pool members with `CL_CHECK`, so a
hypothetically failing release during unwind could still abort - pre-existing
behavior on the destruction path, negligible.

(d) "Bounded to one tensor" is sound. The first throw exits
`load_all_data`'s tensor loop with no catch until `src/llama.cpp:374`; the
model `unique_ptr` inside the try destroys the buffers during unwind, and the
buffer-context destructor deletes every typed extra pool, idle and in-use
(`:10024-10060`; extras enter the in-use vector at creation,
`:10134-10143`), so the failed load's pool and extras are reclaimed before the
governor retries. At most one staging buffer (the failing tensor's) is alive
at throw time. The prior leak was real and process-lifetime (the OpenCL
context outlives the load and would have been inherited by the same-process
CPU retry), so the fix matters, not just decorates.

## 4. THE 30 CONVERSIONS - CONFIRMED

- Count and names: grep finds exactly 31 occurrences - 1 definition
  (`:10911`) + 30 call sites, every one inside
  `ggml_backend_opencl_buffer_set_tensor` (function extent verified by brace
  walk: `:10948-12989`). Every call passes `tensor->name`; the helper
  null-guards it and formats a stable
  `ggml_opencl: set_tensor: <what> failed for tensor '<name>'` message.
- Classification matches the report's table exactly:
  10 helper-NULL asserts at `:11076/:11400/:11532/:11702/:11855/:11966/:
  :12070/:12153/:12364/:12562` (Q4_0 through Q6_K; several verified by
  reading the surrounding branch labels, e.g. `try.q4_k.staging` at
  `:12149-12153`, `q5_K` at `:12360-12364`, `q6_K` at `:12558-12562`);
  4 raw staging creates (`:10985` Q1_0 - the fork-added `GGML_TYPE_Q1_0`
  branch confirmed at `:10968` -, `:12789` Q2_K, `:12872` Q3_K, `:12956` BF16);
  6 weight writes (`:10991`, `:11195/:11199`, `:12794/:12877`, `:12983`);
  5 scale/min creates (`:11610/:11614`, `:12021`, `:12465/:12469`);
  5 weight images (`:11363/:11373`, `:12235`, `:12330`, `:12450`).
- No converted site is a genuine-abort case: all 30 are resource failures
  (allocation or transfer), where continuing with a half-written tensor would
  be worse than failing. The true invariants - `GGML_ASSERT(extra)`,
  size arithmetic, alignment - were left as asserts (51 of them, counted).
- The ten sites from the order: the preprocessor ifdef-stack walk shows all
  ten sit under exactly one conditional, `#ifdef GGML_OPENCL_SOA_Q`
  (opened at `:10967`), and `ggml/src/ggml-opencl/CMakeLists.txt:20` defines
  `GGML_OPENCL_SOA_Q` unconditionally. None is nested under
  `GGML_OPENCL_USE_ADRENO_KERNELS`. The author's ifdef claim is confirmed.
- One caveat the report does not spell out: `set_tensor` is not load-only.
  `ggml_backend_tensor_set` is also called at decode time
  (`src/llama-graph.cpp:73/81/98/104/113/142/144/172/369`,
  `src/bmoe/router_hook.cpp:183`). Of the converted sites, the generic pool
  write (`:12983`) and the BF16 path could in principle be hit while feeding
  input tensors on a decode where the graph inputs landed in an OpenCL buffer.
  There, the throw does not reach the load-fallback channel - it exits
  `llama_decode`, and the binding's main decode call
  (`rn-llama.cpp:654`) is not try/catch-wrapped, so it would terminate the
  process as an uncaught exception. That is the same gross outcome as the
  previous abort (and strictly better in the load case), so it is a note, not
  a defect.

## 5. WHAT IS LEFT - PARTIAL, and honestly disclosed

Counts re-derived independently inside `set_tensor` (`:10948-12989`): 51
`GGML_ASSERT` and 309 `CL_CHECK`-bearing lines, of which the kernel-execution
classes are 173 `clSetKernelArg` + 29 `clEnqueueNDRangeKernel` + 29
`clWaitForEvents`, plus 27/3 success-path releases and 1 audit readback =
262, matching the author's number. The classification is also right in kind:
`clSetKernelArg` failures are programming errors, not memory pressure, and
the 46 sub-buffer carves alias the already-allocated pool rather than
allocating new device memory, so "invariant, not memory pressure" is a fair
characterization.

But the honest risk answer is: yes, a second process-killing path remains in
the SAME function and IS reachable from a model load under memory pressure on
an Adreno device. The convert kernels run during `set_tensor` at load (for
example the Q4_0 convert launch at `:11206-11215`), and on Adreno
`clEnqueueNDRangeKernel` can return `CL_OUT_OF_RESOURCES` /
`CL_MEM_OBJECT_ALLOCATION_FAILURE`, and `clWaitForEvents` can return
`CL_EXEC_STATUS_ERROR_FOR_EVENTS_IN_WAIT_KERNEL`, when device memory is
exhausted or the driver faults - exactly the regime this change targets.
Each of those is `CL_CHECK` -> abort. So the claim "no more abort from a
failed load" is complete for the staging-allocation and transfer class and
PARTIAL for the load as a whole. The author flags this as follow-up in
section 3.4 rather than hiding it; a device test must therefore not treat a
residual mid-load SIGABRT (with a `clSetKernelArg`/NDRange frame in the
backtrace) as a refutation of this change.

## 6. EVIDENCE STANDARD - CONFIRMED, not overstated

- The report states exactly: object-level compile passed (three TUs, exit 0),
  full-library link FAILS on the macOS host because Apple's OpenCL 1.2
  framework does not export `clCreateBufferWithProperties` /
  `clGetKernelSubGroupInfo`, which are referenced from UNMODIFIED code; no NDK
  on the machine; no Android build; no device test; no existing test can
  exercise the failure path (no fault injection exists). All of that checks
  out: both symbols are referenced at ref outside the diff
  (`clGetKernelSubGroupInfo` at ref `:3723`, `clCreateBufferWithProperties`
  at ref `:14258` inside `alloc_buffer`, which the change does not touch).
- Independently reproduced: I configured a fresh build dir
  (`/tmp/kalsallama-audit-build`, same flags plus the homebrew OpenCL headers)
  and compiled `ggml-opencl.cpp.o` - exit 0, 7 warnings, all in unedited
  regions (pragma message, unused `err` in the get_tensor area), matching the
  author's account.
- Not proven, plainly: nothing about linking, nothing about Android/Adreno
  object or binary compatibility, nothing about runtime behavior, and no
  end-to-end demonstration that a staging failure actually produces
  `KALSA_GOVERNOR_FALLBACK` + a successful `n_gpu_layers = 0` retry on a
  device. The JS half of the channel is unit-tested
  (`governorRuntime.test.ts`), the native half is verified by code reading
  only. The report claims none of the unproven parts as proven; its weakest
  sentence is the closeout's "no commit" which time has overtaken.

## Summary of verdicts

| # | Claim | Verdict |
|---|---|---|
| 1 | One file, nothing else; shared tree untouched | CONFIRMED (change now committed as `909243206a`, diff identical) |
| 2 | Throw propagates to `src/llama.cpp:374`, no hazards | CONFIRMED; iface-throw precedent exists (sycl `init_tensor`), novel for `set_tensor` |
| 3 | Leak fixed at 5 sites, safe and bounded | CONFIRMED (a, b, c, d all verified) |
| 4 | 30 conversions, useful names, no wrong-site conversion, 10 order sites staging-only and not Adreno-gated | CONFIRMED (note: 2 sites also reachable at decode time) |
| 5 | No more abort from a failed load | PARTIAL - upload class fixed; 262 kernel-execution aborts remain in the same function, reachable under memory pressure |
| 6 | Compile-verified, link/device unproven, stated without overstatement | CONFIRMED; compile independently reproduced |
