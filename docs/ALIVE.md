> Archived full history: archived/ALIVE-2026-09-full.md (7773 lines, mixed IT/EN, frozen 2026-09-20).

# Kalsa: ALIVE (living measured state)

Owner decision 2026-09-09 (recorded at `archived/PLAN-2026-09-full.md:1`): two living documents
only, `PLAN.md` and this one. The full diary
(every dated cell, table row and verdict to 2026-09-20) is in
`archived/ALIVE-2026-09-full.md`. This file keeps only the short measured state and the pointers
to the records.

## How to read this file

Each row names what is proven and the artefact that proves it. Nothing here is a summary of a
summary: where the record is a dated document, this file points at the document and does not
restate its numbers. Numbers that move under concurrent work are not copied here; the command or
document that produced them is named instead.

## Proven, with the record

| what | record |
|---|---|
| The engine pin the app ships is `llama.rn@0f313bab` → `kalsallama` `8537d097c` (`b11010-merge`), and the q4_K MoE OpenCL mask fix is inside it | `PLAN.md`, "The q4_K MoE OpenCL fix is in the shipped engine"; `vendor/VERSIONS` at `0f313bab` |
| The migration to upstream's `vendor/` layout: the measured upstream bump, the gates, the repaired consumers | `analysis/FORK-VENDOR-MIGRATION.md` |
| ciswire char-3-gram retrieval: recall, KV and prefill behaviour, and device thermal on S23 and Jelly | `analysis/CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md` |
| Xiaomi/Qwen: the fit-gate vision refusal, the ciswire char-vs-token overflow, and what did run | `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md` |
| The governor KV session contract (deferred commit, watermark, invariants) | `analysis/README-governor-kv-contract.md`; the `file:line` pins in its header are stale, so re-pin before quoting |
| How to run the Qwen `<think>` replay probe | `analysis/README-qwen-think-replay.md` |
| The governor device plan, rewritten in English on 2026-09-20, and the audited Italian body | `analysis/GOVERNOR-DEVICE-PLAN.md`; `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md`; re-verification at `scratchpad/agents/governor-audit-recheck/REPORT.md` |
| Per-cell preregistration, raw evidence and reports | `scratchpad/agents/<cell>/` |
| Measurement method and rules for the lab | `PLAN.md`; `README.md` in this repo |
| The engine release pipeline and the manifest contract | this file, "Engine release pipeline"; current position in `PLAN.md` |

## Standing cautions

- The governor plan was re-verified and rewritten on 2026-09-20. It states its sourcing rule and
  applies it: every number carries an artefact citation or an explicit UNSOURCED label. The audited
  Italian body is archived byte-for-byte and is not a current source.
- The `README-governor-kv-contract.md` line pins were written against older trees and no longer
  match the current commits; re-pin before quoting a `file:line`.
- A device number is only as good as the phone state it was read in. The archived diary carries
  the per-run provenance, including the thermal and DSP-daemon caveats that travel with every S23
  number.

## Engine release pipeline (`kalsa-server`)

The macOS engine binary. How it works and how to do it again; current position, decisions and the
open items are in `PLAN.md`, "Engine release: current position and next steps".

### Source and release identity

| item | value |
|---|---|
| Source of truth | `Aspis0/kalsallama` (private), integration branch `b11010-merge` |
| Branch tip (`origin/b11010-merge`) | `2a290390d67311b580ef398fd545e6d060b39897` (`ci : drop the Metal packaging work from the kalsa-server release path`) |
| Release tag (current) | `kalsa-server-v1.1.0`, annotated |
| Tag object | `c105c218236799f2f651517f5a0aeabcf4a8d8a1` |
| Tag target commit | `2a290390d67311b580ef398fd545e6d060b39897` |
| Release tag (previous) | `kalsa-server-v1.0.0`, annotated; tag object `d30c8d475d5eb47a544304ba592138d066bbc2e3`, commit `4ccef2f85dbc27e095e11ffcbad4628be9961790` |

The tags are IMMUTABLE: never moved, never forced, never re-created. A tag is a
snapshot of the release path, not of the code: the workflow file inside a tag is frozen, which
is why a rebuild of an existing tag is done by dispatching with `release_tag` against
`b11010-merge`. For v1.1.0 the tagged tree already carries the current workflow, so the tag push
itself publishes.

### Published state (v1.1.0 is current, v1.0.0 stays available)

Both versions serve HTTP 200 anonymously and were verified consumer-side by downloading from the
public URL, not by reading the run log.

| check | v1.1.0 (current) | v1.0.0 |
|---|---|---|
| Home | `https://dl.kalsa.io/kalsa-server/v1.1.0` | `https://dl.kalsa.io/kalsa-server/v1.0.0` |
| Archive | `kalsa-server-v1.1.0-bin-macos-arm64.tar.gz` | `kalsa-server-v1.0.0-bin-macos-arm64.tar.gz` |
| Archive size | 11205316 bytes | 11203439 bytes |
| Archive sha256 | `9ee5d9f5199475844c99ac93272d429711b2f58d2a7c5d652c7495a391c5f034` | `3fe62ebfe7fd9ddd21fa8857f68f2c34bfc8557fb1811b54f89012260c5c88a7` |
| `.sha256` sibling | agrees | agrees |
| Archive top directory | `kalsa-server-v1.1.0` | `kalsa-server-v1.0.0` |
| Producing run | run `35565687271` | run `35549848243` |
| Cached slot inlet in the shipped dylib | yes | no |

Shape is the same in both: no `default.metallib`, no `ggml-tensor.metallib`, no `kernels/`
entries; the metallib is embedded in `libggml-metal.*.dylib`; the manifest records
`backend: metal`.

The archive holds **58 tar entries: 1 directory plus 57 file entries**, and the file entries are
**41 regular files** (40 Mach-O binaries — the executables and their dylibs — plus `LICENSE`) and
**16 symlinks** (the unversioned and `.0` aliases of the versioned dylibs). v1.0.0 measures the
same 58/1-57/41/16. These are MEASURED counts: an earlier report of "57 entries, 56 files" was a
transcription error, and pinning a transcribed count is how a bundler comes to reject a correct
archive. Every Mach-O's dependency resolves through `@rpath`, `@loader_path` or a system path.

### Where the code actually lives (two traps found on 2026-09-21)

1. **`exe_sha256` cannot tell two versions apart.** `kalsa-server` is a thin LAUNCHER and is
   byte-identical in v1.0.0 and v1.1.0, so the manifest's `exe_sha256` is the same
   (`327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde`) in both. The server
   implementation is `libllama-server-impl.dylib`, and that DID change
   (`d7491bbf96d895c7a3680cfe710e3cf12f57ca240b20b4ee51ea0f19a01742fc` at v1.0.0 →
   `4b7d69fbb8505bb06a5a3b713bafe0d614883361c7d3ad0c4b5137e5809773fd` at v1.1.0). Version
   identity is therefore the ARCHIVE sha256 (or `tag_object`/`commit`), never `exe_sha256`. The
   desktop's first-launch marker re-check stays as a secondary integrity check on the launcher
   only.
2. **The port header literal in the binary is LOWERCASE.** The wire header is `X-Kalsa-Slot`
   (HTTP header names are case-insensitive) but the compiled key is `x-kalsa-slot`, because the
   code lowercases the received name before matching (`tools/server/server-context.cpp:4538`;
   the salt one is `x-kalsa-cache-salt` at line 4504). So a display of presence must be
   case-insensitive or lowercase: `strings -a <top>/libllama-server-impl.dylib | grep -c
   'x-kalsa-slot'` returns 1 for v1.1.0 and 0 for v1.0.0. A capitalised grep returns 0 on a GOOD
   build, which is the worst class of check: one that fails the correct artifact.

### Workflow

`.github/workflows/kalsa-server.yml`, self-contained. No workflow artifacts and no caches; job
permissions are read-only, so the path needs no write access to the repository.

| trigger | behaviour |
|---|---|
| `workflow_dispatch` | input `release_tag` (required); release-only |
| `push` to `b11010-merge` | branch build, no publish |
| `push` on tags `kalsa-server-*` | tag build |

macOS job steps, in order:

1. Checkout `refs/tags/<tag>`.
2. Assert `HEAD == $(git rev-parse refs/tags/<tag>^{commit})`.
3. Build the web UI INSIDE the job: `actions/setup-node@v6`, node 24, `npm ci` and `npm run build`
   in `tools/ui`.
4. cmake with `-DLLAMA_USE_PREBUILT_UI=OFF`, so the UI can never be fetched from Hugging Face.
5. Rename the binary to `kalsa-server` (the CMake target stays `llama-server`).
6. Pack TWICE and compare the two sha256 values.
7. Verify every Mach-O's `@rpath` closure inside the archive.
8. Run `kalsa-server --version`; probe `/health`.
9. Publish.

### Publish target and immutability

- Cloudflare R2 bucket `kalsa-downloads`, prefix `kalsa-server/v<version>/`, three objects: the
  `.tar.gz`, its `.sha256`, and `manifest.json`.
- Public URL:
  `https://dl.kalsa.io/kalsa-server/v1.0.0/kalsa-server-v1.0.0-bin-macos-arm64.tar.gz`.
- Secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`
  (= `https://8a991014729a52a958cef2c5cbf0de50.r2.cloudflarestorage.com`) are passed ONLY as
  environment variables, never as command-line arguments. The token is scoped to the single bucket
  `kalsa-downloads` only: object read/head plus write, plus listing for the advisory check, and NO
  repository permission of any kind. The `head-object` gate needs the read/head permission; without
  it every check aborts.
- Before upload the step checks that the version prefix is empty and refuses to publish if anything
  is there, unless the `force` dispatch input is true (which prints a loud warning that every pinned
  URL will start serving different bytes). `force` never bypasses a FAILED check.
- The existence check does NOT list. Three traps make list-based checks unusable here: `aws s3 ls`
  exits NONZERO on an empty prefix (aws/aws-cli#5544); a JMESPath `Contents[]` projection prints the
  literal string `None` for an absent array; and Cloudflare R2's `ListObjectsV2` omits `KeyCount`,
  unlike AWS. The decision therefore comes from three `head-object` calls on the exact keys: a clean
  `404`/`NoSuchKey` means absent, exit 0 means present, and any other failure aborts and is never
  bypassed by `force`. R2 documents a missing key as HTTP 404 / `NoSuchKey` / error 10007
  (`https://developers.cloudflare.com/r2/api/error-codes/`).
- After upload a recount asserts all three objects exist and that the archive size equals the local
  one.

### Cache behaviour

Cloudflare's cache stores HTTP 404 responses automatically for a domain with caching enabled, and
an overwritten object keeps being served in its OLD form until TTL expiry or an explicit purge.
Source: `https://developers.cloudflare.com/r2/reference/consistency/`.

Measured on `dl.kalsa.io`: a request to a not-yet-published path returns `cf-cache-status:
DYNAMIC`, so the 404 is NOT cached and no path is poisoned today. The publish step checks the bucket
through the S3 API, which bypasses the cache entirely; a client-side 404 must therefore be
re-checked with a cache-busting query before it is believed.

### Releasing a new version

Push an annotated tag `kalsa-server-vX.Y.Z`; the tag trigger builds, verifies and publishes, and
the tag's own workflow file is what runs. To rebuild or republish an EXISTING tag (whose workflow
file is frozen), dispatch against the branch instead:

```
gh workflow run kalsa-server.yml --ref b11010-merge -f release_tag=kalsa-server-vX.Y.Z
```

v1.1.0 was published by the first path (run `35565687271`, `trigger: push on a tag`); v1.0.0 by the
second (run `35549848243`, `trigger: workflow_dispatch with release_tag`). Before any tag: the branch
must have a GREEN `push` run at the commit being tagged, because a branch run exercises build, pack,
reproducibility and verification without touching the bucket.

### Manifest contract (the desktop consumes this)

One manifest per version, published at
`https://dl.kalsa.io/kalsa-server/v<version>/manifest.json`. It holds a LIST of artifacts because
platforms and backends will grow; today it holds exactly one entry. All values are computed in the
run, never typed by hand.

```json
{
  "version": "v1.1.0",
  "tag": "kalsa-server-v1.1.0",
  "tag_object": "c105c218236799f2f651517f5a0aeabcf4a8d8a1",
  "commit": "2a290390d67311b580ef398fd545e6d060b39897",
  "ref": "refs/tags/kalsa-server-v1.1.0",
  "trigger": "push on a tag",
  "run_url": "https://github.com/Aspis0/kalsallama/actions/runs/35565687271",
  "built_at": "2026-09-21T05:49:19Z",
  "reproducible": true,
  "pack_sha256": "9ee5d9f5199475844c99ac93272d429711b2f58d2a7c5d652c7495a391c5f034",
  "artifacts": [
    {
      "platform": "macos-arm64",
      "backend": "metal",
      "home": "https://dl.kalsa.io/kalsa-server/v1.1.0",
      "file": "kalsa-server-v1.1.0-bin-macos-arm64.tar.gz",
      "url": "https://dl.kalsa.io/kalsa-server/v1.1.0/kalsa-server-v1.1.0-bin-macos-arm64.tar.gz",
      "format": "tar.gz",
      "top_dir": "kalsa-server-v1.1.0",
      "exe": "kalsa-server",
      "size_bytes": 11205316,
      "sha256": "9ee5d9f5199475844c99ac93272d429711b2f58d2a7c5d652c7495a391c5f034",
      "exe_sha256": "327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde"
    }
  ]
}
```

v1.0.0's manifest differs only in the version, tag, tag object, commit, trigger, run URL,
`built_at`, the `v1.0.0` home/file/url/top_dir, `size_bytes` 11203439 and `sha256`
`3fe62ebf…88a7`.

Notes:

- `exe` exists because the shipped binary is `kalsa-server` while the CMake target remains
  `llama-server`.
- The filename carries no backend because it is part of the desktop contract. A uniqueness
  invariant asserts that no two matrix entries share an architecture. If a future backend needs the
  same architecture, the filename must gain a backend suffix and the manifest must change in the
  same commit.
- A fresh CI build of the same tag does NOT reproduce an earlier archive byte-for-byte: the UI
  assets are rebuilt and the archive size and digest change. The manifest published with each
  artefact is therefore the authoritative record for THAT object; never read a digest as a claim
  about a different build. Note the asymmetry: the ARCHIVE differs between two builds, while the
  launcher executable hash does not change even between DIFFERENT versions (see "Where the code
  actually lives" above), so the executable hash is neither a version nor a build identifier.
- The release path has exactly one build-time network fetch, the BoringSSL `FetchContent` clone in
  `vendor/cpp-httplib/CMakeLists.txt:45-68`. It is inherited unchanged from the v1.0.0 path and is
  a build-time fetch in a pipeline the desktop does not run; it is recorded here and was
deliberately NOT changed in the v1.1.0 tag.

## The full diary

`archived/ALIVE-2026-09-full.md`, 7773 lines, English narrative with Italian table rows, frozen
2026-09-20. Read it from the tail. `archived/PLAN-2026-09-full.md` holds the matching plan
history.
