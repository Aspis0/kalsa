# Adversarial review: engine checkpoints and cache salt

Target: /Users/marco/.paseo/worktrees/0f85s4e7/server-checkpoint-fix, branch
server-checkpoint-fix, f44560d66 (parent 51b9e6a7f, base 8537d097c). The
target worktree was read only. The review covers the two commits named in the
request.

## Verdict summary

1. REFUTED — valid checkpoint append/read paths agree and legacy files are
   accepted, but accounting is not guaranteed for malformed, truncated, or
   trailing data. The reader also allocates from an attacker-controlled length
   outside the restore exception boundary.
2. CONFIRMED, with a trust-boundary caveat — the live-slot, prompt-cache,
   similarity, idle-cache, and child-slot paths carry or compare the salt, and
   the changed code does not serialize it into the listed outputs. The salt is
   a namespace selector, not authentication; /slots remains a separate
   unsalted persistence API and the server can be bound non-loopback.
3. REFUTED — the tests cover the main happy paths, but the checkpoint test does
   not assert the appendix magic/count or restored checkpoint state, and
   never_logged_or_exposed omits response headers, /props, and /slots.
4. UNVERIFIABLE — the full test_slot_save.py suite could not run locally because
   the preset-loading prerequisite was unavailable. The uncovered multimodal,
   legacy, erase, and checkpoint cases matter to the claims.
5. CONFIRMED — the new production divergence is concentrated in the three
   upstream-owned server files, but it is a material recurring rebase surface:
   193 added and 10 removed production lines, plus 213 test lines.
6. UNVERIFIABLE — no successful full real-model/SWA/recurrent and speculative
   run is available here. This needs qualification before a phone bump if
   these server paths ship on the device.

## 1. Checkpoint appendix format, compatibility, and accounting

### Valid path: confirmed

The appendix is in-file and has the claimed fields. The writer emits the
SCKP magic, version, count, then each checkpoint's positions and three
length-prefixed byte vectors:

~~~text
Command:
cd /Users/marco/.paseo/worktrees/0f85s4e7/server-checkpoint-fix
nl -ba tools/server/server-context.cpp | sed -n '2388,2497p;2697,2788p'
~~~

Relevant output:

~~~text
2390  static constexpr uint32_t SLOT_CKPT_MAGIC   = 0x504b4353; // "SCKP"
2391  static constexpr uint32_t SLOT_CKPT_VERSION = 1;
2424  size_t save_slot_checkpoints(...)
2425      if (slot.prompt.checkpoints.empty()) {
2426          return 0;
2434      const uint32_t magic   = SLOT_CKPT_MAGIC;
2435      const uint32_t version = SLOT_CKPT_VERSION;
2436      const uint32_t count   = (uint32_t) slot.prompt.checkpoints.size();
2441      ckpt_write(ofs, &cur.n_tokens, sizeof(cur.n_tokens), n_written);
2442      ckpt_write(ofs, &cur.pos_min,  sizeof(cur.pos_min),  n_written);
2443      ckpt_write(ofs, &cur.pos_max,  sizeof(cur.pos_max),  n_written);
2444      ckpt_write_buf(ofs, cur.data_tgt,  n_written);
2445      ckpt_write_buf(ofs, cur.data_dft,  n_written);
2446      ckpt_write_buf(ofs, cur.data_spec, n_written);
2455      return n_written;
2459  size_t load_slot_checkpoints(..., size_t offset, ...)
2468      if (... magic != SLOT_CKPT_MAGIC) {
2469          return 0;
2471      if (... version != SLOT_CKPT_VERSION ||
2472          ... count > 1024) {
2477      for (uint32_t i = 0; i < count; ++i) {
2480          if (!ckpt_read(... n_tokens ...) ||
2481              !ckpt_read(... pos_min ...)  ||
2482              !ckpt_read(... pos_max ...)  ||
2483              !ckpt_read_buf(... data_tgt ...) ||
2484              !ckpt_read_buf(... data_dft ...) ||
2485              !ckpt_read_buf(... data_spec ...)) {
2489          checkpoints.push_back(std::move(cur));
2494      slot.prompt.checkpoints = std::move(checkpoints);
2496      return n_read;
2707  const size_t nwrite_ckpt = save_slot_checkpoints(filepath, *slot);
2718  res->n_bytes  = nwrite + nwrite_ckpt;
2774  // nread is the end offset of the llama state payload within the file
2775  const size_t nread_ckpt = load_slot_checkpoints(filepath, nread, *slot);
2786  res->n_bytes  = nread + nread_ckpt;
~~~

The offset is correct on the valid path: the underlying loader returns its
current file position, not merely the state payload length:

~~~text
Command:
nl -ba src/llama-context.cpp | sed -n '3243,3295p'
~~~

~~~text
3283  const size_t state_size = file.size() - file.tell();
3285  const size_t nread = state_seq_read_data(io, seq_id, 0);
3291  GGML_ASSERT(... == file.tell());
3294  return file.tell();
~~~

ckpt_read increments only after a complete read at
server-context.cpp:2393-2398, and the valid writer/reader field order matches.
A file with no appendix is accepted because a missing or non-SCKP magic at
server-context.cpp:2468-2469 returns zero; the core state loader has already
restored the legacy payload. No appendix is written for an empty checkpoint
list at server-context.cpp:2424-2427.

### Accounting is not true in every branch: refuted

The code never checks that a successfully parsed appendix ends at EOF. A file
with a valid appendix followed by bytes therefore restores successfully but
returns only the bytes consumed through the last checkpoint:

~~~text
Command:
rg -n 'file_size|tellg|eof' tools/server/server-context.cpp || true
rg -n 'n_read += size|n_written += size' tools/server/server-context.cpp
~~~

~~~text
2397:        n_read += size;
2413:        n_written += size;
~~~

There is no file-size comparison after server-context.cpp:2489-2496 and no
EOF check after the last length-prefixed buffer. Thus
n_read != os.path.getsize(file) is possible even though restore returns
success. An invalid magic, version, count, or truncated record returns zero
from load_slot_checkpoints; the response then reports only the core nread at
server-context.cpp:2774-2787, again without proving the file was fully
consumed.

Write-side failure has the same accounting weakness. ckpt_write increments
n_written by the requested size without checking ofstream::write
(server-context.cpp:2411-2414). If flush() fails, the function returns zero
at server-context.cpp:2448-2451, but the state file may already contain a
partial appendix and the save response still reports success with only the
core nwrite (server-context.cpp:2707-2719).

### Corrupt-length denial of service: required fix

ckpt_read_buf accepts any length up to 16 GiB and calls vector::resize before
checking that the bytes exist (server-context.cpp:2401-2408). The checkpoint
load call is after the only restore try/catch (server-context.cpp:2742-2772),
so std::bad_alloc or std::length_error from a crafted/corrupt slot file is not
converted into the existing restore error path. With up to 1024 records and
three buffers per record, the format does not impose a meaningful total
allocation bound.

The valid format is therefore internally consistent, but the broad claim that
accounting holds in every branch is false, and malformed input can terminate
or destabilize the server rather than being rejected as a bad slot file.

## 2. Cache-salt gates, reuse paths, and exposure

### Reuse paths: confirmed in source

The salt is read case-insensitively in server-context.cpp:4396-4413 and copied
into every completion/infill task at server-context.cpp:4429 and :4475-4483.
The following paths are covered:

~~~text
Command:
cd /Users/marco/.paseo/worktrees/0f85s4e7/server-checkpoint-fix
rg -n -C 3 'cache_salt|prompt_save|prompt_load|cache_idle_slots|copy_state_to|spec_draft\.clear|spec_ckpt\.clear' \
  tools/server/server-context.cpp tools/server/server-task.cpp tools/server/server-task.h
~~~

Relevant output:

~~~text
server-context.cpp:1584: if (slot.prompt.cache_salt != task.params.cache_salt) continue;
server-context.cpp:1663: if (!ret->prompt_load(*prompt_cache, task.tokens, task.params.cache_salt)) ...
server-context.cpp:3315: if (slot.prompt.cache_salt != slot.task->params.cache_salt) {
server-context.cpp:3317:     slot.prompt_clear();
server-context.cpp:3318:     slot.prompt.cache_salt = slot.task->params.cache_salt;
server-task.cpp:1714: if (it->prompt.cache_salt != prompt.cache_salt) continue;
server-task.cpp:1745: if (it->prompt.cache_salt == prompt.cache_salt && len == ...) ...
server-task.cpp:1787: /*.cache_salt  =*/ prompt.cache_salt,
server-task.cpp:1802: const bool cache_salt_match = prompt.cache_salt == cache_salt;
server-task.cpp:1813: if (it->prompt.cache_salt != cache_salt) continue;
server-context.cpp:2561: if (params_base.cache_idle_slots) {
server-context.cpp:2566:     if (slot.prompt_save(*prompt_cache)) ...
server-context.cpp:733: other.prompt = prompt.clone();
server-context.cpp:383: spec_draft.clear();
server-context.cpp:386: spec_ckpt.clear();
~~~

The live slot is gated during similarity selection and again immediately before
processing. That second check covers the LRU/requested-slot path even when
similarity selection does not run. RAM-cache allocation, removal, and load all
compare the namespace. Idle-slot caching calls the same salted
prompt_save/alloc path. Child-slot state copying clones the parent
server_prompt, including its salt, and the parent and children share the same
task parameters. Speculative draft/checkpoint state is per active slot and is
cleared by server_slot::reset() at server-context.cpp:370-387;
copy_state_to() is only used for children of the same parent task.

### Exposure surfaces: confirmed in changed source, not fully tested

The salt appears in task_params and server_prompt, but not in their JSON
serialization. task_params::to_json() at tools/server/server-task.cpp:30-146
has no cache_salt field, while /slots uses ptask->params.to_json() at
server-context.cpp:687-720. The HTTP response stores only explicitly set
headers; server-stream.cpp:611-615 uses the request only for cancellation
and the unrelated conversation-id header. The changed code does not copy
request headers into response headers.

The source also has no salt in metrics, props, or error text:

~~~text
Command:
rg -n -i 'cache.?salt|x-kalsa-cache-salt' tools/server \
  --glob '*.{cpp,h}' --glob '!server-context.cpp' --glob '!server-task.cpp' --glob '!server-task.h' || true
rg -n '"cache_salt"' tools/server/server-task.cpp \
  tools/server/server-context.cpp tools/server/server-http.cpp || true
rg -n 'x-kalsa-cache-salt' tools/server/server-context.cpp
~~~

~~~text
(no output)
(no output)
4397:    static const std::string key = "x-kalsa-cache-salt";
~~~

The relevant generic log lines are namespace-neutral (server-context.cpp:1585,
server-task.cpp:1814, and server-context.cpp:3316), and the startup line at
server-context.cpp:1366-1370 contains no value. This supports the no-log,
no-metric, no-body, and no-header claim for the engine implementation.

The boundary is not authentication. The commit's “un-salted requests are
localhost-only” note is only true under the default: common/common.h:635
defaults to 127.0.0.1, but common/arg.cpp:3318-3323 exposes --host and the
server documentation explicitly shows --host 0.0.0.0 (tools/server/README.md:
451-454). Anyone who can reach such a server can choose a salt, and a known
salt is not a secret. The /slots save/restore routes also do not read the
header (server-context.cpp:5452-5505); they are not an automatic cache-reuse
path, but must remain private or be explicitly declared outside the tenant
namespace contract.

## 3. Test protection and vacuity

Verdict: REFUTED for the coverage claim, although the positive assertions are
meaningful where they apply.

The test map is:

~~~text
Test                                      Assertions protected
test_cache_salt_separates_namespaces     test_cache_salt.py:38-48:
                                         A then B on the same live slot gives
                                         cache_n == 0 for B.
test_cache_salt_same_namespace_shares    test_cache_salt.py:50-58:
                                         same salt gives cache_n > 0.
test_cache_salt_unsalted_is_its_own...   test_cache_salt.py:61-74:
                                         salted to empty misses; empty to empty shares.
test_cache_salt_ram_cache_is_namespaced  test_cache_salt.py:77-98:
                                         A is cached, B misses, A hits through
                                         server_prompt_cache.
test_cache_salt_never_logged_or_exposed  test_cache_salt.py:101-136:
                                         body, metrics body, error body, captured
                                         --verbose log, and startup sentence.
test_slot_restore_preserves_context...   test_slot_save.py:565-625:
                                         n_live < n_full, file-size accounting,
                                         and final prompt timing.
~~~

The checkpoint test can pass without proving that an appendix with two
checkpoints was written: n_written == os.path.getsize() is also true for a
normal checkpoint-free state file, and the final assertion checks only a timing
count, not that the restored recurrent state produces the expected continuation.
It also never asserts the claimed “2 checkpoints” result. The existing
ordinary slot test only adds file-size assertions at test_slot_save.py:41 and
:59.

The test that claims stronger-than--lv 3 logging uses server.debug = True
(test_cache_salt.py:104-112), which maps to --verbose in tests/utils.py:235-236;
that part is meaningful. Its name is broader than what it checks because
ServerResponse.headers is never inspected.

## 4. Coverage limits

Verdict: UNVERIFIABLE. The repository's documented test command is
cmake --build build -j --target llama-server && ./tools/server/tests/tests.sh
(tools/server/tests/README.md:60-64), but the test session first invokes
ServerPreset.load_all() (tools/server/tests/conftest.py:28-35), which starts
every preset listed in ServerPreset (tools/server/tests/utils.py:522-534).
The local environment did not have the required presets/models for the full
run. A server binary exists in build/bin/llama-server, but the harness's
default relative path is ../../../build/bin/llama-server from the test process
unless LLAMA_SERVER_BIN_PATH is set (tests/utils.py:149-156 and
tests/README.md:31).

test_slot_save.py contains these cases:

~~~text
Command:
rg -n '^def test_' tools/server/tests/unit/test_slot_save.py
~~~

~~~text
20:def test_slot_save_restore()
82:def test_slot_restore_legacy_token_list()
136:def test_slot_erase()
191:def test_slot_save_restore_text_only_on_multimodal(mmproj_server)
229:def test_slot_save_restore_with_image(mmproj_server)
307:def test_slot_save_restore_with_two_images(mmproj_server)
373:def test_slot_save_restore_image_across_restart(mmproj_server)
422:def test_slot_save_restore_image_payload_larger_than_context(mmproj_server)
499:def test_slot_restore_media_file_without_mmproj(mmproj_server)
565:def test_slot_restore_preserves_context_checkpoints(swa_server)
~~~

Without that run, the unverified surfaces are the legacy plain-token rewrite,
erase behavior, all multimodal save/restore and restart cases, oversized media
handling, no-mmproj failure cleanup, and the new recurrent/SWA checkpoint case.
The legacy and multimodal cases matter because the change modifies the shared
slot-save/restore result accounting and executes after the common state file
has been written. The checkpoint case is the core feature and therefore the
most material gap.

The five cache-salt tests likewise require a running server/model and were not
treated as source-level proof of the output-surface claims.

## 5. Upstream-owned rebase tax

Verdict: CONFIRMED as a concentrated but material tax. The exact diff against
8537d097c is:

~~~text
Command:
cd /Users/marco/.paseo/worktrees/0f85s4e7/server-checkpoint-fix
git diff --numstat 8537d097c..HEAD
~~~

~~~text
167  5  tools/server/server-context.cpp
17   4  tools/server/server-task.cpp
9    1  tools/server/server-task.h
136  0  tools/server/tests/unit/test_cache_salt.py
77   0  tools/server/tests/unit/test_slot_save.py
~~~

All production edits are in the three upstream-owned files named in the
request; no unrelated production file was touched. The recurring conflict
surface is nevertheless broad inside server-context.cpp: checkpoint helper and
slot-save/restore code at :2388-2496 and :2670-2788, slot selection and
processing at :1555-1670 and :3314-3319, and route handling at :4394-4483.
server-task.cpp and .h add the cache state field and API. The decision to carry
this upstream tax is already made; this is a risk note, not a request to
relocate the work in this review.

## 6. Ship safety and real-model qualification

Verdict: UNVERIFIABLE. There is no evidence in the target worktree of a
successful full test run or a real-model report covering the new persistence
path. Before a phone bump, if this server code is included in the phone
runtime, run a rebuilt target with:

1. An actual SWA/recurrent model and explicit checkpoint settings; save a slot
   containing multiple checkpoints, restore it after a divergent prompt, and
   compare both prompt reuse and generated output against the live path.
2. A speculative-decoding model; exercise data_spec through save, restore,
   partial draft acceptance, and a subsequent request.
3. A legacy checkpoint-free file and a file with no appendix on the same
   recurrent model.
4. Truncated, trailing-byte, and oversized-length appendices; these must return
   a controlled restore error without changing the slot or killing the server.
5. Salted, unsalted, and mixed-case headers through the actual proxy, plus
   direct checks that response headers, /props, /slots, metrics, and -lv 3
   logs contain no salt. If the server can bind non-loopback, verify that the
   proxy/authentication boundary prevents arbitrary clients from selecting or
   guessing a namespace.

No timing claim is made by these commits, so a device performance run is not
needed for the format itself; a real target-model run is needed to qualify
recurrent and speculative correctness.

## Ordered required fixes

1. Bound checkpoint allocations by the remaining file size and a realistic
   total limit, catch allocation/read failures inside the restore error path,
   and reject malformed appendices without terminating the server.
2. Make appendix accounting strict: validate that a successful parse consumes
   exactly the file, and make partial append failures return an error or use an
   atomic/recoverable save so n_written cannot silently disagree with the file.
3. Strengthen the checkpoint test with an explicit enabled checkpoint count,
   magic/version/count and restored-count assertions, plus output correctness;
   add a relevant legacy no-appendix recurrent-model test.
4. Extend cache-salt tests to mixed-case/empty headers, automatic slot
   selection, idle-slot caching, response headers, /props, /slots, and the
   actual -lv 3 threshold. Document or enforce that the header is not an
   authentication boundary and that non-loopback deployments must be protected.
5. Run the full preset-backed suite and the real-model recurrent/speculative
   qualification before the phone bump.
