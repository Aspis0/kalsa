# Adversarial v1.1.0 pre-push audit — ROUND 2 (fix recheck)

Independent reviewer, different model from the coder. Read-only except one temporary
source mutation, applied and reverted (proof below). Round 1 lives in
`REPORT-v110.md` and is not edited.

- Target worktree: `/Users/marco/.paseo/worktrees/0f85s4e7/kalsa-v110`
- Branch: `kalsa-slot-and-metal`
- HEAD: `ac9a09dc69f9fa69ae0e80a82ebdd3be54ea83bd` (3rd commit — "server : guard slot
  actions and prove the inlet adds no exposure")
- Verified against: `REPORT-v110.md` round-1 findings A2, A4, A6, B4 (and the two
  withdrawn Metal findings).

## Lineage — CONFIRMED

```text
$ git rev-parse HEAD    -> ac9a09dc69f9fa69ae0e80a82ebdd3be54ea83bd  (3rd commit)
$ git rev-parse HEAD^   -> c719778096d7c9a2e8114e500c46cda06d5e3e16  (required parent) ✓
$ git rev-parse HEAD^^  -> c2ebfc164eaa7dfe9c5346ca7a4df9f0f5497953  (X-Kalsa-Slot inlet) ✓
$ git rev-parse HEAD^^^ -> 916b8f0bcfcb829011f129b4dff8acfd01ab7814  (base) ✓
```

The three commits are, oldest first: `c2ebfc164` (slot inlet), `c71977809` (Metal
libs), `ac9a09dc6` (this recheck's target). Branch tip is `kalsa-slot-and-metal`, correct.

Files changed across all three commits (`git diff --name-status 916b8f0bc..HEAD`):

```text
M .github/workflows/kalsa-server.yml
M tools/server/server-context.cpp
A tools/server/tests/unit/test_slot_header.py
M tools/server/tests/requirements.txt
M tools/server/tests/utils.py
```

All five files are justified by the declared fixes. No stray files. A diff-wide grep for
`/Users/marco`, `AKIA`, `-----BEGIN`, `secret_access`, `password`, `api[_-]?key` returns
nothing. Commit messages and code are English.

---

## A2 (BLOCKING in round 1) — slot-action header guard — FIXED, CONFIRMED

`POST /slots/:id_slot` now reads `X-Kalsa-Slot` and refuses a valid header that disagrees
with the URL slot. `server-context.cpp:5093-5121`:

```cpp
5093  std::string id_slot_str = req.get_param("id_slot");
5095  int id_slot;
5096  try { id_slot = std::stoi(id_slot_str); }
5098  catch (...) { res->error("Invalid slot ID"); return res; }
5105  const int32_t id_slot_header = get_slot_from_header(req);
5106  if (id_slot_header >= 0 && id_slot_header != id_slot) {
5107      res->error("Requested slot does not match the slot in the request URL",
                     ERROR_TYPE_INVALID_REQUEST);   // 400
5108      return res;
5109  }
5111  std::string action = req.get_param("action");
5113  if (action == "save")    return handle_slots_save(req, id_slot);
5116  if (action == "restore") return handle_slots_restore(req, id_slot);
5119  if (action == "erase")   return handle_slots_erase(req, id_slot);
```

**Check-before-mutation: CONFIRMED.** The header guard (5105-5109) runs before `action`
is even parsed (5111) and before any of the three mutating handlers
(`handle_slots_save/restore/erase`, 5113-5121). A rejected request returns at 5108 and
touches no slot file. `handle_slots_save/restore/erase` are the *only* state-mutation
sites and every one is gated. A rejected request cannot have partially saved, restored or
erased anything.

**Behaviour matrix (round-1 A2 requirement):**
- valid header == URL slot → proceeds (agreement)
- valid header != URL slot → 400, no mutation
- absent / malformed header → `get_slot_from_header` returns -1, `>= 0` is false → today's
  behaviour, no refusal

Behaviourally proven — I ran the new tests against a freshly built binary (clean venv from
`requirements.txt`):

```text
test_slot_action_header_mismatch_refused[save]    PASSED
test_slot_action_header_mismatch_refused[restore] PASSED
test_slot_action_header_mismatch_refused[erase]   PASSED
test_slot_action_header_agree_proceeds            PASSED
test_slot_action_header_absent_unchanged          PASSED
6 passed
```

The mismatch tests assert `status==400` for all three actions; agree asserts `200` and
`id_slot==0`; absent asserts `200` (URL decides, no refusal). No other route's behaviour
changed: the server-context.cpp diff is exactly two hunks — the comment block and this
guard (`git show HEAD -- tools/server/server-context.cpp`). **A2: FIXED.**

---

## A4 (BLOCKING in round 1) — leak surface / decorative test — FIXED, CONFIRMED BY MUTATION

The leak test was rewritten to use a **valid** header and assert the raw string never
surfaces. `test_slot_header.py`:

```python
VALID_HEADER = "0000000000000000001"          # parses to 1 via from_chars, unique literal
res = _complete(server, slot=VALID_HEADER)
assert res.body["id_slot"] == 1               # the header DID reach the task
assert VALID_HEADER not in str(res.body)      # ... but the raw literal never appears
assert VALID_HEADER not in str(res.headers)
...
assert VALID_HEADER not in log                # at -lv 3 AND --verbose (trace param)
assert "kalsa-slot" not in log.lower()
```

Choosing a valid value with leading zeros is the right idea: `id_slot==1` proves the value
is consumed as a real slot selector (round 1's complaint that the sentinel never entered
`task.id_slot`), while the 19-char literal `"0000000000000000001"` cannot collide with an
incidental `1` in a timing/size, so `not in log` is a real assertion.

The new `test_slot_reporting_is_upstream_behaviour` proves the exposure round 1 flagged
(the `selected slot by id (1)` log line and the `id_slot` response field) is **pre-existing
upstream behaviour**, present with AND without the header:

```python
with_header_id, log_with    = _run_and_read_log(..., {"X-Kalsa-Slot": "1"})
no_header_id,  log_without  = _run_and_read_log(..., None)
assert "selected slot by id (1)" in log_with
assert "selected slot by id (1)" in log_without
```

This substantiates the reworded guarantee in `server-context.cpp:4525-4536` ("This inlet
adds no new exposure" / "The body can decide only when there is no valid header"). The
guarantee wording is now precise and matches the code.

### MUTATION PROOF — the guard can fail

A guard that cannot fail is not a guard. I forced a leak and confirmed the test catches it.

1. Baseline (unmodified HEAD, freshly built): `test_slot_header_never_logged_or_exposed`
   → **2 passed in 4.84s** (both `[False]`=`-lv 3` and `[True]`=`--verbose`).
2. Mutation applied to `get_slot_from_header` (server-context.cpp, after the header match):
   ```cpp
   SRV_INF("MUTATION raw x-kalsa-slot = %s\n", std::string(v).c_str());
   ```
   Rebuilt `llama-server` (~5s incremental), re-ran the same test →
   **2 failed in 4.79s** (the `VALID_HEADER not in log` assertion fires because the raw
   `0000000000000000001` now reaches the log).
3. Mutation reverted, rebuilt. `git status --porcelain` empty, `git diff HEAD` empty, HEAD
   still `ac9a09dc6`, source byte-identical to committed.

Baseline PASS → mutated FAIL → reverted clean is a clean differential: the only change was
logging the raw header, and the test flipped. **The A4 test is a real guard. A4: FIXED.**

---

## A6 (BLOCKING-ish in round 1) — `ModuleNotFoundError: wget` — FIXED, CONFIRMED

`utils.py` diff:

```python
-import wget
+import urllib.request
...
-wget.download(url, out=output_file)
+urllib.request.urlretrieve(url, output_file)
```

`requirements.txt`: `-wget~=3.2` removed. Semantics identical (download `url` to a local
path); `urllib.request` is stdlib, so no new network requirement — the network call already
existed. No remaining `wget` reference anywhere under `tools/server/tests/`
(`grep -rn wget` → empty). **A6: FIXED.**

**Clean-environment completeness (round-1 required-fix 5 / task point 4):** I built a fresh
venv and ran `pip install -r requirements.txt`, then imported every listed package plus
`xdist`:

```text
all requirements import OK
```

`pytest-xdist~=3.6` is present at `requirements.txt:3`. The coder's disclosure that it
"had to install pytest-xdist in a throwaway venv" was a redundant manual install, **not** a
documentation gap — a clean `pip install -r requirements.txt` already provides it. The
"documented command needs an undocumented package" defect class is **not** present here.
The documented command (`tests.sh`, which invokes `pytest -n auto`) is satisfied by the
committed requirements. I ran the full file from this clean venv: **32 passed in 20.53s.**

---

## B4 (insufficient evidence in round 1) — Metal health probe — FIXED at workflow level,
## but introduces a new release-time network dependency (task point 3)

The probe is now fail-closed. `kalsa-server.yml:603-635`:

```yaml
SERVER_ARGS=(--port 18999 --host 127.0.0.1)
if [ "${KALSA_BACKEND}" = "metal" ]; then
  SERVER_ARGS+=(--hf-repo ggml-org/models --hf-file tinyllamas/stories260K.gguf -ngl 99)
fi
...
LOOKUP="$(metal_path "$DEST/server.log")"
if [ "${LOOKUP}" = "no Metal library lookup in the log" ]; then
  echo "the Metal backend never looked for a library: the probe did not initialise Metal" >&2
  cat "$DEST/server.log" >&2
  exit 1
fi
```

The round-1 gap ("`/health` succeeds without initialising Metal; no-lookup is accepted as
a non-error") is closed: on the metal backend the probe now loads a tiny model with
`-ngl 99`, forcing `ggml_metal` initialisation, and **exits 1** when no lookup line is
seen. The SDK-skip assertion for the optional `ggml-tensor.metallib` is preserved
(unchanged in the diff). This is the correct shape for a fail-closed check.

**New risk the previous reviewer did not assess — HF fetch on the release path:** the probe
now downloads `ggml-org/models :: tinyllamas/stories260K.gguf` from Hugging Face at release
time (metal job only). This is a genuine new failure mode: an HF outage, rate-limit, or a
repo/file rename fails the Metal build for reasons unrelated to the artefact being shipped.
It couples release reproducibility to a third-party service that is measurably flakier than
the GitHub infrastructure the release already depends on.

- **Severity:** robustness/flakiness, not correctness or security. The artefact produced is
  unaffected; the risk is a spurious red build.
- **Better shape:** ship a ~1 MB `stories260K.gguf` fixture in-repo (or reuse an existing
  test asset) and load it from a local path with `-ngl 99` — zero network. If a remote
  fetch is kept, wrap it with retries and treat a *download* failure distinctly from a
  *Metal-init* failure, so a network flake is not misreported as a Metal regression (and
  vice versa).
- **Does it block the push?** No. It does not affect the three commits' correctness and the
  probe is otherwise sound. It does weigh on the *tag* decision (below), because the Metal
  job has still never had a green run on a real macOS runner, and this change adds one more
  reason it could go red at tag time.

The B4 workflow logic can only be executed on an actual macOS Metal runner with the release
context; it cannot be run here. So B4 is **fixed in the workflow source** (fail-closed,
model-loading) but **not yet demonstrated by a green runner execution**.

---

## Withdrawn Metal findings stay withdrawn

The third commit does not touch `ggml/src/ggml-metal/CMakeLists.txt` nor the Metal flags —
`git show HEAD -- .github/workflows/kalsa-server.yml | grep GGML_METAL_(EMBED_LIBRARY|NDEBUG)`
is empty, so the flags carry over from `c71977809` unchanged. Round 1's corrected reading
stands and I found no new evidence against it: `GGML_METAL_EMBED_LIBRARY=OFF` is the active
metallib-generation branch (`else()` at CMakeLists.txt:117), and the workflow restores the
`kernels/` sources and headers into `build/bin` before packing. These remain **withdrawn**.

---

## House rules (task point 6) — PASS

Current line counts at HEAD vs base `916b8f0bc`:

```text
tools/server/server-context.cpp             5826 -> 5881   (+55 over 3 commits; +19/-3 in 3rd)
tools/server/tests/utils.py                  726 -> 726    (net 0; +2/-2 in 3rd)
.github/workflows/kalsa-server.yml           941 -> 1116   (+175 over 3 commits; +14/-2 in 3rd)
tools/server/tests/unit/test_slot_header.py    0 -> 309    (new file)
```

- No **new** over-limit file created by this change. `server-context.cpp` (5881),
  `utils.py` (726) and `kalsa-server.yml` (1116) were already far over the 350-450
  guideline before this feature — the coder's declared figures are accurate. The workflow
  and the .cpp are pre-existing monoliths (upstream llama.cpp / a single CI YAML); this
  change adds only small deltas and does not refactor them.
- The new `test_slot_header.py` is **309 lines — within** the guideline.
- Comments explain *why* (the security boundary, the leading-zero literal rationale, the
  model-load-for-Metal-init rationale), not narrate the next line. No unrequested refactor:
  the server diff is two hunks; the workflow diff is only the health probe.
- Imports: `<charconv>` (used by `from_chars`), `urllib.request` (used), no gratuitous
  additions.

---

## Non-regression (task point 5) — release controls intact

The third commit does not touch the previously-approved release controls; they persist from
the earlier commits. Static confirmation in `kalsa-server.yml`:

- tag-ref checkout and `HEAD == refs/tags/<tag>^{commit}` assertion: `:114`, `:142`,
  `:159-182` (`TAG_SHA="$(git rev-parse "refs/tags/${KALSA_TAG}^{commit}")"`).
- `release_tag` required + namespace-validated: `:24-25`, `:106`, `git check-ref-format`
  at `:138`, `kalsa-server-*` namespace at `:11/:39`.
- three `head-object` immutability checks + loud-overwrite refusal: `:896`, `:965`
  ("refusing to overwrite ... immutable"), existence-check fail-closed at `:920`.
- post-upload recount via head-object: `:1067`, `:1083-1087`.
- double pack + reproducibility comparison: `:476-491` ("packing is not reproducible" /
  "digest reproducible across two packs").
- archive normalization, all-Mach-O RPATH check, `--version`, no upload/download-artifact,
  no `actions/cache`, read-only repo permissions: unchanged since round 1 (not in this
  diff). The Metal flags `-DGGML_METAL_EMBED_LIBRARY=OFF -DGGML_METAL_NDEBUG=ON` and the
  metallib generation are unchanged.

Push relationship: `origin/b11010-merge` = `916b8f0bc` = exactly the base of the three
commits, so HEAD is a clean 3-commit fast-forward (`git merge-base --is-ancestor
origin/b11010-merge HEAD` → true). A branch push publishes nothing — the R2 upload runs
only on a `kalsa-server-*` tag or a dispatch with `release_tag`.

---

## Verdicts

Round-1 blocking findings, rechecked:

```text
A2 slot-action header guard (check-before-mutation)  FIXED / CONFIRMED (tests + code path)
A4 leak test is a real guard (valid header)          FIXED / CONFIRMED BY MUTATION
A4 exposure is pre-existing upstream, not new        CONFIRMED (with/without-header test)
A6 wget import removed, command runs                 FIXED / CONFIRMED (32 passed, clean venv)
requirements.txt complete for a clean environment    CONFIRMED (pip install -r + xdist)
B4 Metal probe fail-closed + model load              FIXED IN SOURCE; not yet run on a runner
B4 HF fetch on release path (new)                    SHOULD-FIX (flakiness), non-blocking
```

**The three commits are: PUSH-SAFE.**

Every round-1 blocking finding (A2, A4) is genuinely fixed and I proved it against a built
binary, including a mutation that makes the A4 guard fail. Lineage, file set, absence of
secrets/paths, English, house rules, and the inherited release controls all check out. The
push is a clean fast-forward and publishes nothing by itself.

Exact push command (run from the target worktree
`/Users/marco/.paseo/worktrees/0f85s4e7/kalsa-v110`):

```bash
git push origin ac9a09dc69f9fa69ae0e80a82ebdd3be54ea83bd:refs/heads/b11010-merge
```

(equivalently `git push origin kalsa-slot-and-metal:b11010-merge` — same fast-forward).

### Metal in the `kalsa-server-v1.1.0` tag — RECOMMEND SPLIT TO A LATER VERSION

The **slot inlet half** (X-Kalsa-Slot, the A-findings) is fully proven and tag-ready; the
CPU release artefact is unaffected by the Metal changes, so `kalsa-server-v1.1.0` can carry
the slot feature safely.

The **Metal half** should not ride this tag yet. Two open items, neither a correctness bug:
1. The Metal build + fail-closed health probe has never had a green run on a real macOS
   runner — the workflow logic is now correct but unexecuted, and a tag is the wrong place
   to discover a red Metal job.
2. The probe now depends on a live Hugging Face fetch on the release path; replace it with
   an in-repo tiny-gguf fixture (or a retried, distinctly-classified fetch) first.

Cut `kalsa-server-v1.1.0` for the slot feature; ship Metal under a later tag once a real
macOS runner produces a green metal build+probe and the model source is made local.

**PUSH-SAFE for the three commits.**
