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
| Branch tip at last read | `635ea0ed25988fb8bf1cc9b3b75d2fbc1a6c1acc` plus a pending fix commit (not pushed) |
| Release tag | `kalsa-server-v1.0.0`, annotated |
| Tag object | `d30c8d475d5eb47a544304ba592138d066bbc2e3` |
| Tag target commit | `4ccef2f85dbc27e095e11ffcbad4628be9961790` |

The tag is IMMUTABLE: never moved, never forced, never re-created.

### Published state (v1.0.0, live)

All three objects serve HTTP 200 anonymously and were verified consumer-side:

| check | value |
|---|---|
| Home | `https://dl.kalsa.io/kalsa-server/v1.0.0` |
| Archive | `https://dl.kalsa.io/kalsa-server/v1.0.0/kalsa-server-v1.0.0-bin-macos-arm64.tar.gz` |
| `.sha256` sibling | `https://dl.kalsa.io/kalsa-server/v1.0.0/kalsa-server-v1.0.0-bin-macos-arm64.tar.gz.sha256` |
| Manifest | `https://dl.kalsa.io/kalsa-server/v1.0.0/manifest.json` |
| Archive size | 11203439 bytes |
| Archive sha256 | `3fe62ebfe7fd9ddd21fa8857f68f2c34bfc8557fb1811b54f89012260c5c88a7` |
| `.sha256` sibling | agrees with the archive digest |
| Extracted `exe_sha256` | `327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde` |
| Archive top directory | `kalsa-server-v1.0.0` |
| `kalsa-server --version` | prints `commit 4ccef2f85` |
| Producing run | `https://github.com/Aspis0/kalsallama/actions/runs/35549848243` |

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
  and can only write objects; it cannot touch any repository.
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

Create and push an annotated tag `kalsa-server-vX.Y.Z`, then dispatch:

```
gh workflow run kalsa-server.yml --ref b11010-merge -f release_tag=kalsa-server-vX.Y.Z
```

### Manifest contract (the desktop consumes this)

One manifest per version, published at
`https://dl.kalsa.io/kalsa-server/v<version>/manifest.json`. It holds a LIST of artifacts because
platforms and backends will grow; today it holds exactly one entry. All values are computed in the
run, never typed by hand.

```json
{
  "version": "v1.0.0",
  "tag": "kalsa-server-v1.0.0",
  "tag_object": "d30c8d475d5eb47a544304ba592138d066bbc2e3",
  "commit": "4ccef2f85dbc27e095e11ffcbad4628be9961790",
  "ref": "refs/tags/kalsa-server-v1.0.0",
  "trigger": "workflow_dispatch with release_tag",
  "run_url": "https://github.com/Aspis0/kalsallama/actions/runs/35549848243",
  "built_at": "2026-09-21T01:16:13Z",
  "reproducible": true,
  "pack_sha256": "3fe62ebfe7fd9ddd21fa8857f68f2c34bfc8557fb1811b54f89012260c5c88a7",
  "artifacts": [
    {
      "platform": "macos-arm64",
      "backend": "metal",
      "home": "https://dl.kalsa.io/kalsa-server/v1.0.0",
      "file": "kalsa-server-v1.0.0-bin-macos-arm64.tar.gz",
      "url": "https://dl.kalsa.io/kalsa-server/v1.0.0/kalsa-server-v1.0.0-bin-macos-arm64.tar.gz",
      "format": "tar.gz",
      "top_dir": "kalsa-server-v1.0.0",
      "exe": "kalsa-server",
      "size_bytes": 11203439,
      "sha256": "3fe62ebfe7fd9ddd21fa8857f68f2c34bfc8557fb1811b54f89012260c5c88a7",
      "exe_sha256": "327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde"
    }
  ]
}
```

Notes:

- `exe` exists because the shipped binary is `kalsa-server` while the CMake target remains
  `llama-server`.
- The filename carries no backend because it is part of the desktop contract. A uniqueness
  invariant asserts that no two matrix entries share an architecture. If a future backend needs the
  same architecture, the filename must gain a backend suffix and the manifest must change in the
  same commit.
- A fresh CI build of the same tag does NOT reproduce an earlier archive byte-for-byte (linker
  UUIDs and similar differ): the executable hash matched (`327fb363…`) while the archive size and
  digest changed. The manifest published with each artefact is therefore the authoritative record
  for THAT object; never read a digest as a claim about a different build.

## The full diary

`archived/ALIVE-2026-09-full.md`, 7773 lines, English narrative with Italian table rows, frozen
2026-09-20. Read it from the tail. `archived/PLAN-2026-09-full.md` holds the matching plan
history.
