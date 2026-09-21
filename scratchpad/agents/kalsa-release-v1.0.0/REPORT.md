# kalsa-server-v1.0.0 — release evidence (collected 2026-09-20)

Collected by the KV orchestrator session from the real published release. Nothing
here is inferred: every number was measured on the downloaded artefact.

## Asset block (fields of `crates/kalsa-runtime/src/assets.rs`, struct `Asset`)

```
home:       https://github.com/Aspis0/kalsallama/releases/download/kalsa-server-v1.0.0
file:       kalsa-server-v1.0.0-bin-macos-arm64.tar.gz
format:     TarGz
size_bytes: 11203213
sha256:     4442b12aa39ada682dbb8aebcdf17e78f1e48d382a9a3cde87c25fcdfcde9464
exe_sha256: 327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde
```

`exe_sha256` is over the extracted `kalsa-server` binary at
`kalsa-server-v1.0.0/kalsa-server`.

## Extras (not `Asset` fields)

- **Run URL**: https://github.com/Aspis0/kalsallama/actions/runs/35538846239
  (workflow `Kalsa Server`, event `workflow_dispatch`, conclusion `success`,
  2026-09-20T21:29:13Z -> 21:35:23Z).
- **Build was forced to the tag ref**: the run logged
  `building refs/tags/kalsa-server-v1.0.0 (release: 1, trigger: workflow_dispatch with release_tag)`
  and the assertion step printed
  `commit: 4ccef2f85dbc27e095e11ffcbad4628be9961790`, equal to
  `git rev-parse refs/tags/kalsa-server-v1.0.0^{commit}`.
- **Reproducibility pair** (in-workflow, two packs of the same tree):
  `pack sha256 (two identical packs): 4442b12aa39ada682dbb8aebcdf17e78f1e48d382a9a3cde87c25fcdfcde9464`.
  **EQUAL** to the published archive `sha256` above (same 64 hex characters).
- **Archive layout**: tar top-level directory is exactly `kalsa-server-v1.0.0/`.
- **Dylib closure**: 56 Mach-O files in the extracted tree; **0** missing
  `@rpath/...` dependencies (every dependency resolves inside the extracted tree).
- **Companion `.sha256`**: present as a release asset
  (`kalsa-server-v1.0.0-bin-macos-arm64.tar.gz.sha256`, 109 bytes). Its content is
  `4442b12aa39ada682dbb8aebcdf17e78f1e48d382a9a3cde87c25fcdfcde9464  kalsa-server-v1.0.0-bin-macos-arm64.tar.gz`,
  matching the archive. The release holds exactly these two assets.
- **`size_bytes` cross-check**: 11203213 from the downloaded file, 11203213 from
  the release asset metadata API. Agreement is exact.
- **Tag immutability**: `git ls-remote origin refs/tags/kalsa-server-v1.0.0` still
  returns tag object `d30c8d475d5eb47a544304ba592138d066bbc2e3`, pointing at commit
  `4ccef2f85dbc27e095e11ffcbad4628be9961790`. Never moved, never forced.
- **Release flags**: `isDraft: false`, `isPrerelease: false`.
  Note for the record: the release's `targetCommitish` metadata reads `main` (the
  repository default branch). That field is only used by GitHub when a tag has to
  be created; it is not the build source. The build source is proven by the run's
  assertion and by the tag itself.

## Provenance text published inside the release notes

```
kalsa-server macOS build assets for kalsa-server-v1.0.0

tag: kalsa-server-v1.0.0
tag object: d30c8d475d5eb47a544304ba592138d066bbc2e3
commit: 4ccef2f85dbc27e095e11ffcbad4628be9961790
ref: refs/tags/kalsa-server-v1.0.0
trigger: workflow_dispatch with release_tag
run: https://github.com/Aspis0/kalsallama/actions/runs/35538846239
version: v1.0.0
size_bytes: 11203213
pack sha256 (two identical packs): 4442b12aa39ada682dbb8aebcdf17e78f1e48d382a9a3cde87c25fcdfcde9464
```

## How it was produced

The original tag-triggered workflow (`kalsa-server.yml` as frozen at the tag) could
not complete: it depends on the upstream reusable UI job that hard-codes
`runs-on: ubuntu-slim` (hard 15-minute job limit) and on workflow artefacts, which
the account's private-repo storage quota was refusing. The self-contained version
of the workflow (`3a4d5143e8eed99999b5aa34185cc420ddc5ffc7` on `b11010-merge`) builds
the UI inside the macOS job, uses no artefacts or caches at all, publishes from the
same job, and was dispatched with `release_tag=kalsa-server-v1.0.0`, which forces the
checkout of `refs/tags/kalsa-server-v1.0.0` and asserts the resolved commit.
