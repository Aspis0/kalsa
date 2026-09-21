# Adversarial re-review: engine checkpoints and cache salt

Target: `/Users/marco/.paseo/worktrees/0f85s4e7/server-checkpoint-fix`, branch
`server-checkpoint-fix`, commit `82d38684f` on `f44560d66`. The target
worktree was read only. This report rechecks the ordered fixes in the first
review.

## Verdict summary

1. **RESOLVED** — the blob bounds use the remaining-file arithmetic without an
   off-by-one on the supported 64-bit target, and the per-blob and aggregate
   caps are checked before allocation.
2. **NOT RESOLVED** — malformed appendices with a recognized magic now fail in
   the controlled restore path, but any non-SCKP bytes after the core state are
   still treated as a legacy file and silently accepted.
3. **NEW ISSUE** — the post-flush size check catches short writes, but rollback
   is not atomic with the previous valid save: the underlying save already
   truncates the old file, and a normal mismatch returns success after leaving
   only the newly written base state.
4. **NOT RESOLVED** — the tests now exercise the requested main paths, but do
   not protect save-side `n_written`/rollback behavior, exact no-magic trailing
   rejection, the hard-cap branches, or all output/stream surfaces. Some
   assertions can pass for an empty or otherwise degenerate response.
5. **RESOLVED** — the source comment states the namespace-selector/not-
   authentication boundary and the non-loopback warning.
6. **NEW ISSUE** — an exact no-appendix legacy file still restores, but the
   strict-accounting promise is bypassed for non-SCKP trailing bytes.
7. **NOT RESOLVED** — the stated full-suite and real-model gates remain
   honest, but the uncovered list is incomplete: write fault injection,
   cross-backend restore, and malformed legacy/trailing cases are absent.

## 1. `ckpt_read_buf` bounds and arithmetic

**Verdict: RESOLVED**, with a portability caveat noted below.

The new code obtains `remaining` as the file length minus the core-state
offset, reads each length field into `n_read`, and checks the length before
`vector::resize`:

~~~text
Command:
cd /Users/marco/.paseo/worktrees/0f85s4e7/server-checkpoint-fix
nl -ba tools/server/server-context.cpp | sed -n '2393,2419p;2491,2515p'
~~~

Output:

~~~text
2393    static constexpr uint32_t SLOT_CKPT_MAX_RECORDS = 1024;
2394    // hard backstops; the primary bound is the number of bytes actually left in the file
2395    static constexpr size_t SLOT_CKPT_MAX_BUFFER = 1ull << 34; // 16 GiB per state blob
2396    static constexpr size_t SLOT_CKPT_MAX_TOTAL  = 1ull << 36; // 64 GiB per appendix
2406    // remaining is the number of bytes left in the file from the appendix start
2407    static bool ckpt_read_buf(std::ifstream & ifs, std::vector<uint8_t> & buf, size_t & n_read, size_t remaining, size_t & total) {
2408        uint64_t n = 0;
2409        if (!ckpt_read(ifs, &n, sizeof(n), n_read)) {
2410            return false;
2411        }
2412        // a blob cannot be larger than the bytes left in the file or the appendix budget
2413        if (n_read > remaining || n > remaining - n_read || n > SLOT_CKPT_MAX_BUFFER || n > SLOT_CKPT_MAX_TOTAL - total) {
2414            return false;
2415        }
2416        total += n;
2417        buf.resize(n);
2418        return n == 0 || ckpt_read(ifs, buf.data(), n, n_read);
2419    }
2491        ifs.seekg(0, std::ios::end);
2492        const std::streamoff end = ifs.tellg();
2493        if (end < 0 || (uint64_t) end < (uint64_t) offset) {
2494            return 0;
2495        }
2496        const size_t remaining = (size_t) ((uint64_t) end - (uint64_t) offset);
~~~

The subtraction is ordered safely: `n_read > remaining` is evaluated before
`remaining - n_read`; otherwise `n` must be no greater than the bytes left.
The aggregate invariant is also maintained: `total` starts at zero and is
incremented only after `n <= SLOT_CKPT_MAX_TOTAL - total`, so that subtraction
cannot underflow. A length exactly equal to the bytes remaining is accepted;
the subsequent full read advances `n_read` to `remaining`. A length one byte
larger is rejected before allocation. The 16 GiB per-buffer and 64 GiB
aggregate limits are also tested before `resize`.

The code converts the 64-bit length to `size_t` at `vector::resize`. The
repository's Android/desktop targets are 64-bit, so the stated arithmetic is
correct there; a 32-bit build would need an explicit `n > SIZE_MAX` check to
make the helper portable.

## 2. Malformed appendices, controlled restore, and legacy fast path

**Verdict: NOT RESOLVED.** The exception boundary itself is fixed, but the
legacy test is too broad.

The parser now throws for invalid version/count, truncated or oversized
buffers, and trailing bytes after a recognized appendix:

~~~text
Command:
nl -ba tools/server/server-context.cpp | sed -n '2502,2547p;2817,2827p'
~~~

Output:

~~~text
2506        if (!ckpt_read(ifs, &magic, sizeof(magic), n_read) || magic != SLOT_CKPT_MAGIC) {
2507            return 0; // no appendix: a checkpoint-free or legacy save file
2509        if (!ckpt_read(ifs, &version, sizeof(version), n_read) || version != SLOT_CKPT_VERSION ||
2510            !ckpt_read(ifs, &count,   sizeof(count),   n_read) || count > SLOT_CKPT_MAX_RECORDS) {
2511            throw std::runtime_error("invalid context checkpoint appendix");
2522                !ckpt_read_buf(ifs, cur.data_tgt,  n_read, remaining, total) ||
2523                !ckpt_read_buf(ifs, cur.data_dft,  n_read, remaining, total) ||
2524                !ckpt_read_buf(ifs, cur.data_spec, n_read, remaining, total)) {
2525                throw std::runtime_error("truncated or oversized context checkpoint appendix");
2531            throw std::runtime_error("trailing bytes after the context checkpoint appendix");
2817                        slot->prompt.clear();
2818                        slot->prompt.tokens = std::move(restored);
2822                        nread_ckpt = load_slot_checkpoints(filepath, nread, *slot);
2823                    } catch (const std::exception & err) {
2824                        slot->prompt_clear();
2825                        send_error(task, std::string("Unable to restore slot: ") + err.what(), ERROR_TYPE_INVALID_REQUEST);
2826                        break;
~~~

This proves the intended controlled error behavior: checkpoint loading is
inside the same `try`, and a thrown error clears the slot and returns an
`Unable to restore slot` error. The missing-magic case, however, returns zero
without checking `remaining`. Therefore all of these are silently accepted as
legacy/checkpoint-free after the core state:

~~~text
Command:
nl -ba tools/server/server-context.cpp | sed -n '2491,2508p'
~~~

Output:

~~~text
2491        ifs.seekg(0, std::ios::end);
2492        const std::streamoff end = ifs.tellg();
2493        if (end < 0 || (uint64_t) end < (uint64_t) offset) {
2494            return 0;
2495        }
2496        const size_t remaining = (size_t) ((uint64_t) end - (uint64_t) offset);
2506        if (!ckpt_read(ifs, &magic, sizeof(magic), n_read) || magic != SLOT_CKPT_MAGIC) {
2507            return 0; // no appendix: a checkpoint-free or legacy save file
~~~

An exact old file has `remaining == 0` and is valid. A four-byte non-SCKP
trailer has a readable magic that mismatches and also returns zero; a one-to-
three-byte trailer fails the magic read and returns zero. In both cases the
restore response reports only the core `nread`, not the full file size. The
legacy branch should distinguish `remaining == 0` from non-empty unknown data,
or the strict-accounting guarantee remains false.

## 3. Save accounting and rollback safety

**Verdict: NEW ISSUE.** The size check fixes the original silent-success
accounting path for a normal append, but it is not an atomic save and does not
preserve a previously valid file.

The new implementation flushes, closes, checks the stream and compares the
on-disk size against `base_size + n_written`:

~~~text
Command:
nl -ba tools/server/server-context.cpp | sed -n '2434,2480p;2739,2770p'
~~~

Output:

~~~text
2434    // returns the number of bytes appended, 0 if the appendix could not be written
2436    size_t save_slot_checkpoints(..., size_t base_size) const {
2460        ofs.flush();
2461        ofs.close();
2462        const bool write_ok = !ofs.fail();
2464        // verify that n_written matches the file, so a short write can never be reported as success
2466        const uintmax_t on_disk = std::filesystem::file_size(filepath, ec);
2467        if (!write_ok || ec || on_disk != (uintmax_t) base_size + n_written) {
2470            std::error_code ec_rollback;
2471            std::filesystem::resize_file(filepath, base_size, ec_rollback);
2472            if (ec_rollback) {
2473                throw std::runtime_error("failed to roll back a partial context checkpoint appendix: " + ec_rollback.message());
2475            return 0;
2751                    size_t nwrite_ckpt = 0;
2753                        nwrite_ckpt = save_slot_checkpoints(filepath, *slot, nwrite);
2754                    } catch (const std::exception & err) {
2755                        send_error(task, std::string("Unable to save slot: ") + err.what(), ERROR_TYPE_SERVER);
2768                    res->n_bytes  = nwrite + nwrite_ckpt;
~~~

The append-side success path can no longer return an appendix byte count that
differs from the observed file size. A rollback failure is thrown and reaches a
controlled save error. But the underlying core save is not transactional:

~~~text
Command:
nl -ba src/llama-context.cpp | sed -n '3297,3314p'
~~~

Output:

~~~text
3297    size_t llama_context::state_seq_save_file(llama_seq_id seq_id, const char * filepath, const llama_token * tokens, size_t n_token_count) {
3298        llama_file file(filepath, "wb");
3299
3300        file.write_u32(LLAMA_STATE_SEQ_MAGIC);
3301        file.write_u32(LLAMA_STATE_SEQ_VERSION);
3302
3303        // save the prompt
3304        file.write_u32((uint32_t) n_token_count);
3305        file.write_raw(tokens, sizeof(llama_token) * n_token_count);
3306
3307        // save the context state using stream saving
3308        llama_io_write_file io(&file);
3309        state_seq_write_data(io, seq_id, 0);
3310
3311        const size_t res = file.tell();
3312        GGML_ASSERT(res == sizeof(uint32_t) * 3 + sizeof(llama_token) * n_token_count + io.n_bytes());
3313
3314        return res;
~~~

The server calls that truncating save before it opens the appendix in append
mode (`server-context.cpp:2743-2753`). Thus a short appendix write and a
successful `resize_file(filepath, base_size)` leave the newly written base
state, not the prior valid save file. If the base write or a concurrent file
replacement is not exactly the assumed `base_size`, resizing to that value can
also extend/truncate the current file rather than restore the previous file.
There is no temporary-file/rename or backup of the old save. In addition, a
normal rollback returns zero and the caller still queues a successful save
result with only `nwrite`; it does not tell the caller that checkpoint state was
dropped.

The size comparison is therefore useful but does not satisfy the stronger
“rollback cannot corrupt a previously valid file” requirement. A transactional
save or an explicit save error on any appendix failure is still needed.

## 4. Test additions and vacuity

**Verdict: NOT RESOLVED.** The requested named tests are present and mostly
meaningful, but they do not cover all required behavior.

Checkpoint assertions now include framing, count, target data, restored byte
count, prompt timing, generated output, and the restoration log:

~~~text
Command:
nl -ba tools/server/tests/unit/test_slot_save.py | sed -n '633,710p;712,829p'
~~~

Output:

~~~text
669    # the appendix must be present, complete and correctly framed
670    appendix = _find_appendix(data)
673    assert version == SLOT_CKPT_VERSION
674    assert count == 2
675    assert len(records) == count
676    assert all(len(rec[3][0]) > 0 for rec in records)
689    assert res.body["n_read"] == os.path.getsize(ckpt_file)
698    assert res.body["timings"]["prompt_n"] == n_live
700    assert res.body["content"] == content_live
707    restored = re.search(r"restored (\d+) context checkpoint\(s)", log)
709    assert int(restored.group(1)) == count
712    def test_slot_restore_without_appendix_on_swa(swa_server):
760    def test_slot_restore_rejects_trailing_appendix_bytes(swa_server):
783    def test_slot_restore_rejects_oversized_appendix_length(swa_server):
809    def test_slot_restore_rejects_truncated_appendix(swa_server):
~~~

The cache-salt tests now name all requested surfaces:

~~~text
Command:
rg -n '^def test_|server_slots|/props|/slots|res\.headers|LLAMA_ARG_LOG_VERBOSITY|verbosity =' \
  tools/server/tests/unit/test_cache_salt.py
~~~

Output:

~~~text
104:def test_cache_salt_header_variants(salt_server):
124:def test_cache_salt_auto_slot_selection(salt_server):
139:def test_cache_salt_idle_slot_cache_is_namespaced(tmp_path):
175:def test_cache_salt_never_logged_or_exposed(tmp_path, monkeypatch, trace):
183:    server.server_metrics = True
184:    server.server_slots = True
188:    monkeypatch.setenv("LLAMA_ARG_LOG_VERBOSITY", "3")
198:    assert salt not in str(res.headers)
201:    res = server.make_request("GET", "/props", headers=_headers(salt))
204:    assert salt not in str(res.headers)
207:    res = server.make_request("GET", "/slots", headers=_headers(salt))
210:    assert salt not in str(res.headers)
213:    res = server.make_request("GET", "/metrics", headers=_headers(salt))
235:        assert "verbosity = 3 " in log
~~~

The `-lv 3` check is real: `LLAMA_ARG_LOG_VERBOSITY` is a registered alias for
`-lv/--log-verbosity`, and the test's child process inherits the monkeypatched
environment:

~~~text
Command:
rg -n -C 3 'set_env\("LLAMA_ARG_LOG_VERBOSITY"\)|env = \{|Popen\(' \
  common/arg.cpp tools/server/tests/utils.py
~~~

Output:

~~~text
common/arg.cpp:3934:        {"-lv", "--verbosity", "--log-verbosity"}, "N",
common/arg.cpp:3947:    ).set_env("LLAMA_ARG_LOG_VERBOSITY"));
tools/server/tests/utils.py:140:        env = {
tools/server/tests/utils.py:313:        self.process = subprocess.Popen(
~~~

However, the assertions leave real gaps:

- The checkpoint test never asserts the save response's `n_written` against
  the file size for a checkpointed save. The earlier ordinary slot test only
  exercises the no-checkpoint path.
- `_find_appendix` searches for any parseable `SCKP` occurrence rather than
  asserting its offset equals the core loader's returned `nread`; the later
  restore-size assertion makes the common case strong, but the helper itself is
  not a direct offset/accounting assertion.
- The test for `1 << 30` only exercises “larger than remaining file,” not the
  16 GiB or 64 GiB limit branches. There is no save fault injection for a
  short write, `flush` failure, `file_size` failure, or rollback failure.
- `test_slot_restore_without_appendix_on_swa` strips an appendix generated by
  the current implementation. It is a useful exact no-appendix compatibility
  test, but not an independently captured file from an older release.
- The generated-output assertion could pass if both responses were empty; the
  test does not assert non-empty content. Likewise, several `cache_n == 0`
  assertions could pass if caching were disabled or the prompt were not
  cached at all, although the paired same-namespace `> 0` assertions and the
  idle-slot log tag make the main tests non-vacuous in a normal run.
- The exposure test checks ordinary completion, `/props`, `/slots`, metrics
  body, error body, ordinary response headers, and logs. It does not inspect
  metrics response headers, streaming/SSE response headers, or every HTTP
  endpoint.

## 5. Namespace-selector/not-authentication comment

**Verdict: RESOLVED.** The comment is explicit and accurate:

~~~text
Command:
nl -ba tools/server/server-context.cpp | sed -n '4470,4487p'
~~~

Output:

~~~text
4470    // X-Kalsa-Cache-Salt is a private port header that selects the KV/prompt cache namespace.
4471    // It is a NAMESPACE SELECTOR, NOT AUTHENTICATION: a known salt is not a secret, and any
4472    // client that can reach the server can choose a namespace. Un-salted requests share one
4473    // namespace. Binding non-loopback (--host) therefore exposes namespace selection to any
4474    // reachable client, so non-loopback deployments must be protected by the port and/or auth.
4475    // The value is consumed here and never echoed, logged or exposed.
~~~

This fixes the documentation omission. It does not itself enforce the
non-loopback protection, which is correctly stated as an operational boundary.

## 6. Legacy and previously accepted files

**Verdict: NEW ISSUE.** Exact legacy compatibility is preserved; strict
accounting is not universal.

The new compatibility test creates a current appendix, removes it exactly, and
restores the core state:

~~~text
Command:
nl -ba tools/server/tests/unit/test_slot_save.py | sed -n '712,758p'
~~~

Output:

~~~text
712    def test_slot_restore_without_appendix_on_swa(swa_server):
738    # strip the appendix, leaving the file the pre-checkpoint servers wrote
740        f.write(data[:base_size])
745    res = server.make_request("POST", "/slots/1?action=restore", data={
749    assert res.body["n_read"] == base_size
757    assert res.body["timings"]["prompt_n"] == n_full_p2
~~~

That exact no-appendix file is accepted by the `remaining == 0` behavior. A
previously valid core file with arbitrary extra bytes is a different case: the
missing-magic return at `server-context.cpp:2506-2507` accepts it, so the new
strict-accounting rule neither rejects it nor reports the full size. The
existing test only covers trailing bytes after a recognized SCKP appendix:

~~~text
Command:
nl -ba tools/server/tests/unit/test_slot_save.py | sed -n '760,780p'
~~~

Output:

~~~text
760    def test_slot_restore_rejects_trailing_appendix_bytes(swa_server):
771        f.write(data + b"TRAILING-JUNK")
776    assert res.status_code != 200, "trailing bytes after a valid appendix must be rejected"
~~~

So valid exact legacy files still restore, but a stated strict trailing-byte
policy is incomplete and inconsistent across the legacy/appendix distinction.

## 7. Remaining coverage and ship gate

**Verdict: NOT RESOLVED.** The commit honestly states that the full
preset-backed suite and real recurrent/speculative qualification are not done:

~~~text
Command:
git show --format=fuller --no-patch 82d38684f
~~~

Relevant output:

~~~text
SHIP GATE (not done here): the full preset-backed suite and real-model
recurrent/speculative qualification still need a machine with all presets.
~~~

The test harness confirms why the full suite is a real dependency: its
autouse session fixture starts every preset before the tests, and the normal
binary path is environment-dependent:

~~~text
Command:
nl -ba tools/server/tests/conftest.py | sed -n '28,35p';
nl -ba tools/server/tests/utils.py | sed -n '149,156p;522,534p'
~~~

Output:

~~~text
28    @pytest.fixture(scope="session", autouse=True)
29    def load_server_presets(...):
35        ServerPreset.load_all()
151    elif "LLAMA_SERVER_BIN_PATH" in os.environ:
156        server_path = "../../../build/bin/llama-server"
524        """ Load all server presets to ensure model files are cached. """
526        servers: List[ServerProcess] = [
531        for server in servers:
533            server.start()
~~~

The list is not complete. It must also explicitly cover:

1. injected short writes, flush/close/file-size failures, successful rollback,
   rollback failure, and preservation of an already valid save;
2. restore of a save across CPU/GPU and other supported backend combinations;
3. a no-appendix file with one-to-three trailing bytes and with a non-SCKP
   four-byte trailer, plus invalid magic/version/count cases;
4. exact boundary tests for a zero-length blob, the remaining-byte boundary,
   the 16 GiB per-blob cap, and the 64 GiB aggregate cap;
5. speculative-state (`data_spec`) save/restore with a real speculative model,
   not only target-state output on the tiny SWA fixture.

## Ordered remaining required fixes

1. Make the legacy branch return zero only when the core state ends exactly at
   EOF; reject non-empty unknown bytes after the core state, while retaining
   exact no-appendix compatibility.
2. Make slot saves transactional or return a controlled save error for any
   appendix failure. Preserve the prior valid file until the complete new file
   has been verified; do not report a successful save after silently dropping
   checkpoints.
3. Add save-side fault-injection tests for short writes, flush/close,
   `file_size`, successful rollback, rollback failure, and preservation of the
   prior valid file. Assert checkpointed-save `n_written == file size`.
4. Add boundary and malformed-legacy tests, including the exact blob/appendix
   limits and unknown trailing bytes.
5. Run the full preset-backed suite and real recurrent/speculative and
   cross-backend qualification before shipping the server change.
