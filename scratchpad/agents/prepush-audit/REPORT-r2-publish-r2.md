# Re-audit: R2 server publication

Target: /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-r2, branch kalsa-r2-publish, HEAD 635ea0ed25988fb8bf1cc9b3b75d2fbc1a6c1acc.

This review was read-only. I did not push, dispatch, upload, or contact the bucket.

## 1. Failure semantics and recount — CONFIRMED

The existence check is at .github/workflows/kalsa-server.yml:700-716. It captures the command status in LS_RC and tests LS_RC at lines 713-716 before interpreting EXISTING at lines 717-728 and before consulting FORCE at lines 720-725. A nonzero status exits even when FORCE is true.

The post-upload recount is at lines 827-853. It rejects a failed recount at lines 836-840, requires each of TAR, DIGEST, and MANIFEST at lines 841-847, extracts the remote archive size at line 848, and compares it with local SIZE at lines 849-852.

I ran an inline stub-aws harness matching the workflow branches. The stub returned status 0 with no rows, status 0 with one row, or status 254 with an access error; upload calls were counted:

~~~text
(a) empty prefix: publish uploads=3 ls_rc=0
(b) objects force=false: abort uploads=0 ls_rc=0 force=false
(b') objects force=true: OVERWRITING: force=true
(b') objects force=true: publish uploads=3 ls_rc=0
(c) failed check force=false: abort uploads=0 ls_rc=254 force=false
(c') failed check force=true: abort uploads=0 ls_rc=254 force=true
~~~

This closes the prior blocking failure-semantics issue. The warning at line 721 explicitly says that force publication changes bytes behind pinned URLs.

## 2. ListObjectsV2 substitution — CONFIRMED, with live CLI subcheck UNVERIFIABLE

The workflow now uses ListObjectsV2 at lines 702-707 and 828-833. The query asks only for key and size rows. The branch behavior is sound: a successful empty response is the publish case, while every nonzero response is fatal before any upload. The same API is used for the recount.

The installed-CLI check was:

~~~text
if command -v aws >/dev/null 2>&1; then command -v aws; aws --version; else echo 'aws: not installed'; fi
aws: not installed
~~~

Therefore I could not run the real AWS CLI against a test endpoint. The stub above independently exercised the required status/output distinction. Cloudflare documents ListObjectsV2 as an implemented R2 S3 operation and documents that object read/write permissions include listing objects:

- https://developers.cloudflare.com/r2/api/s3/api/
- https://developers.cloudflare.com/r2/api/tokens/

The substitution is preferable to aws s3 ls for this gate because it gives the script a direct API status and an empty result set rather than relying on the high-level command's empty-prefix behavior. It introduces no unsafe blind spot in this code. AWS CLI pagination remains enabled because the command does not use no-paginate, so the prefix check is not limited to the first page.

The operational prerequisite changed: the R2 credential must permit ListBucket/ListObjectsV2 on kalsa-downloads. If it does not, the command returns nonzero, the workflow prints the failed-check error at line 714, exits at line 715, and performs zero uploads. That is safe but the release fails until the token is granted list permission.

## 3. Recount strength — CONFIRMED; optional hardening noted

The recount is sufficient to detect missing objects and archive truncation or expansion. It does not prove that a remote archive with the same byte count has the same digest. In practice the successful aws upload plus HTTPS/S3 transport already provides a useful integrity boundary, and the local archive was hashed before upload.

The cheapest additional defense would be a post-upload GET of the public digest object and a comparison of its parsed SHA-256 with local ARCHIVE_SHA. That confirms the sidecar and manifest-facing digest, but still does not hash the remote archive. The strongest check would hash the downloaded archive, at the cost of downloading the full server bundle. I do not treat the current size-only recount as a blocking defect, but the residual same-size-corruption risk should be understood.

## 4. Manifest derivation — CONFIRMED

The manifest is written by jq -n at lines 755-803, with all values passed through jq arguments rather than an unescaped shell heredoc.

Field-to-source mapping:

- version: VERSION at line 756, derived by the tag step.
- tag: TAG at line 757, from the validated release input or tag trigger.
- tag_object: git rev-parse of refs/tags/TAG at line 758.
- commit: git rev-parse HEAD at line 759; the earlier tag assertion makes this the resolved tag commit.
- ref and trigger: KALSA_REF and KALSA_TRIGGER at lines 760-761.
- run_url: KALSA_RUN_URL at line 762, populated from the GitHub context at line 579.
- built_at: BUILT_AT at line 763, populated from UTC date at line 750.
- reproducible: KALSA_REPRODUCIBLE at line 764, emitted by the double-pack step at lines 432-435.
- pack_sha256: KALSA_ARCHIVE_SHA at line 765, emitted from the second pack hash.
- platform: PLATFORM at line 766, derived as macos-ARCH at line 645.
- backend: KALSA_BACKEND at line 767, from the matrix at line 585.
- home, file, and url: HOME_URL, TAR, and TAR_URL at lines 768-770, derived at lines 636-641.
- format: FORMAT at line 771, derived from TAR by the suffix case at lines 654-662.
- top_dir: TOP_DIR at line 772, derived at line 646.
- exe: EXE_NAME at line 773, sourced from the verification step at lines 453-460.
- size_bytes: SIZE at line 774, stat of the actual archive at line 732.
- sha256: ARCHIVE_SHA at line 775, freshly computed from that archive at line 733.
- exe_sha256: KALSA_EXE_SHA at line 776, computed from the extracted binary at line 455.

The previously hardcoded format and executable fields are no longer literals. The manifest uses the verified packaging and verification outputs.

## 5. Backend/artifact identity — CONFIRMED

The invariant is declared at the workflow level as KALSA_MATRIX_PAIRS = arm64:metal at line 54. The matrix identity step at lines 253-317 validates pair syntax, rejects duplicate pairs at lines 287-291, rejects duplicate architectures at lines 293-297, checks matrix count at lines 299-303, and checks that the current job is declared at lines 305-315.

I ran the collision branch with KALSA_PAIRS set to arm64:metal arm64:cpu and a two-job total. Its exact failure was:

~~~text
two matrix entries share an architecture: arm64; they would publish to the same object names
collision_test_exit=1
~~~

The public filename remains architecture-only, as required: the contract comment is at lines 262-269 and the actual TAR construction is at line 637. The guard prevents a future same-architecture backend from silently reusing that filename and prefix.

## 6. Non-regression — CONFIRMED

Shape:

~~~text
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git rev-list --parents -n1 HEAD
git diff --name-only 3a4d5143e8eed99999b5aa34185cc420ddc5ffc7..HEAD
~~~

~~~text
kalsa-r2-publish
635ea0ed25988fb8bf1cc9b3b75d2fbc1a6c1acc
635ea0ed25988fb8bf1cc9b3b75d2fbc1a6c1acc 3a4d5143e8eed99999b5aa34185cc420ddc5ffc7
.github/workflows/kalsa-server.yml
~~~

The following scans found no forbidden release machinery, artifact/cache actions, local uses, secrets, or absolute checkout paths:

~~~text
rg -n -i 'gh release|--clobber|--verify-tag|upload-artifact|download-artifact|actions/cache|uses: ./|contents:[[:space:]]*write' .github/workflows/kalsa-server.yml
git diff 3a4d5143e8eed99999b5aa34185cc420ddc5ffc7..HEAD | rg -n '/Users/marco|BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|ghp_|github_pat_'
~~~

Both outputs were empty. Repository permissions remain read-only at lines 47-48. The R2 secrets enter only the environment at lines 572-576; no credential is an aws argument. The precise shell-body scan for GitHub or env expressions was empty:

~~~text
awk '/^        run: \|/ { in_run=1; next } /^      - name:/ { in_run=0 } in_run && /\$\{\{[[:space:]]*(github|env)\./ { print FNR ":" $0 }' .github/workflows/kalsa-server.yml
~~~

Other preserved hardening:

- required release_tag: lines 24-26;
- namespace validation at read time: lines 120-141, and immediately before use: lines 601-617;
- tag-ref checkout: lines 156-164;
- HEAD equals refs/tags/TAG peeled commit: lines 166-182;
- option terminators before cp source/destination positionals: lines 811, 817, and 823; the list calls have no positional operands;
- double pack and hash comparison: lines 410-422;
- archive normalization: lines 396-407;
- RPATH checks for every Mach-O: lines 465-509;
- --version: line 463;
- /health: lines 511-525;
- unchanged workflow_dispatch, b11010-merge push, and kalsa-server-* tag triggers: lines 19-43.

Fast-forward check:

~~~text
git -C /Users/marco/Projects/kalsallama rev-parse origin/b11010-merge
git rev-parse HEAD^1
git merge-base --is-ancestor 3a4d5143e8eed99999b5aa34185cc420ddc5ffc7 HEAD && echo fast_forward=true
~~~

~~~text
3a4d5143e8eed99999b5aa34185cc420ddc5ffc7
3a4d5143e8eed99999b5aa34185cc420ddc5ffc7
fast_forward=true
~~~

## Required fixes

None. The three prior required fixes are resolved. The digest recount enhancement is optional defense in depth, not a release blocker. Before dispatch, the owner must ensure the R2 secret has permission to list objects in kalsa-downloads; if it does not, the workflow will fail safely before uploading.

## Final verdict

PUSH-SAFE for the fast-forward push and dispatch, subject to the stated R2 list-permission prerequisite.

~~~text
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-r2 push origin 635ea0ed25988fb8bf1cc9b3b75d2fbc1a6c1acc:b11010-merge
gh workflow run kalsa-server.yml --ref b11010-merge -f release_tag=kalsa-server-v1.0.0
~~~

Final line: PUSH-SAFE for (a) the fast-forward push of 635ea0ed onto b11010-merge and (b) the dispatch command above.
