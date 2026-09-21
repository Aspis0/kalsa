# Pre-push audit: R2 server publication

Target: /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-r2, branch kalsa-r2-publish, HEAD e89d1f2330581e9a1a230ae9573ba78cf3c648b4.

This is a read-only review. I did not push, dispatch, upload, or contact the bucket.

## 1. Shape and containment — CONFIRMED

Commands:

~~~text
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git rev-list --parents -n1 HEAD
git log --first-parent --oneline 3a4d5143e8eed99999b5aa34185cc420ddc5ffc7..HEAD
git diff --name-only 3a4d5143e8eed99999b5aa34185cc420ddc5ffc7..HEAD
~~~

Output:

~~~text
kalsa-r2-publish
e89d1f2330581e9a1a230ae9573ba78cf3c648b4
e89d1f2330581e9a1a230ae9573ba78cf3c648b4 3a4d5143e8eed99999b5aa34185cc420ddc5ffc7
e89d1f233 ci(server): publish the verified engine to R2 instead of a GitHub release
.github/workflows/kalsa-server.yml
~~~

The diff is one file only. A scan of the diff for /Users/marco, private-key material, GitHub tokens, and secret-like credential strings was empty.

~~~text
git diff 3a4d5143e8eed99999b5aa34185cc420ddc5ffc7..HEAD | rg -n '/Users/marco|BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|ghp_|github_pat_'
~~~

Output: empty.

## 2. GitHub release removal and permissions — CONFIRMED

File lines 47-48 set workflow permissions to contents: read. There is no job-level contents: write.

~~~text
rg -n -i 'gh release|--clobber|--verify-tag|contents:[[:space:]]*write|permissions:|contents:' .github/workflows/kalsa-server.yml
47:  permissions:
48:    contents: read
~~~

No GitHub release command, clobber flag, or verify-tag flag remains. This is a genuine narrowing of the GitHub-token permission and removes GitHub-release mutation. It does not remove the separate R2 write capability supplied by the R2 secrets.

## 3. R2 credential hygiene — CONFIRMED

At lines 491-512, the publish step supplies the R2 credentials and endpoint through its environment. The aws commands at lines 593, 684, 690, and 696 use the endpoint through an environment variable and never put either credential on the command line.

~~~text
rg -n 'R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|R2_ENDPOINT|aws s3' .github/workflows/kalsa-server.yml
494:          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
495:          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
498:          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
593:        EXISTING="$(aws s3 ls --endpoint-url "${R2_ENDPOINT}" -- "${S3_PREFIX}/" 2>"${LS_ERR}")"
684:        aws s3 cp --endpoint-url "${R2_ENDPOINT}" -- ...
690:        aws s3 cp --endpoint-url "${R2_ENDPOINT}" -- ...
696:        aws s3 cp --endpoint-url "${R2_ENDPOINT}" -- ...
~~~

The secrets are not interpolated into run-body text. They are absent from process arguments, although normal same-user environment inspection remains a general limitation of environment-based secret delivery.

## 4. Immutable-prefix failure semantics — REFUTED

The intended normal path is present: lines 30-34 declare force with default false; lines 587-610 list the prefix; a nonempty listing aborts unless FORCE is true; and lines 601-607 print an unmistakable overwrite warning for the force path.

The failure path is unsafe. At lines 593-600, the aws s3 ls exit code is saved in LS_RC, but lines 608-610 proceed whenever stdout is empty and only print the nonzero code. LS_RC is never tested before upload. Thus a network error, bad endpoint, bad credentials, or access denial can be interpreted as no objects and permit publication. If stdout is nonempty, force can also bypass a failed check.

Reproduction with a stub aws that emits access denial and exits 254:

~~~text
An error occurred (AccessDenied) when calling the ListObjectsV2 operation
no objects under s3://kalsa-downloads/kalsa-server/v1.0.0/ (listing exit 254)
PROCEED_TO_HASH_AND_UPLOAD=1
aws_calls=1 ls_rc=254 stdout_bytes=0
~~~

Required fix: abort immediately when LS_RC is nonzero, before interpreting empty output or allowing force. For strict immutability, the check/upload sequence also needs an explicit race strategy if concurrent publishers are possible.

## 5. Manifest derivation and escaping — REFUTED

Most manifest values are computed at lines 632-680:

- tag_object from git rev-parse of the tag at line 635;
- commit from git rev-parse HEAD at line 636, made equivalent to the resolved tag commit by the assertion at lines 160-176;
- run_url from the GitHub context at line 639;
- built_at from UTC date at line 640;
- pack_sha256 and reproducible from the double-pack outputs at lines 641-642;
- size_bytes from stat of the actual archive at line 651;
- sha256 from a fresh digest of that archive at line 652;
- exe_sha256 from the extracted binary verification output at line 653;
- URL, file, home, and top directory from variables derived at lines 625-650.

jq is a real JSON writer and its argument inputs correctly escape values; this is not an unsafe shell heredoc.

However, format: tar.gz is a literal at line 648 and exe: kalsa-server is a literal at line 650. The acceptance criterion requires every field to be computed. These values match the current artifact but can drift from a future packaging change.

Required fix: derive format and executable name from the same packaging and verification source-of-truth variables, or assert the literals against those variables before writing the manifest.

## 6. Platform/backend identity — REFUTED

The current entry is internally consistent: ARCH comes from the matrix at lines 506-507, the archive filename uses it at line 558, PLATFORM is derived at line 625, and backend comes from the matrix and is written at line 644. The current matrix is arm64/metal at lines 64-67.

It is not future-proof. Backend is not encoded in the archive filename or R2 prefix. A future matrix entry with the same architecture and a different backend can target the same object names while changing only manifest metadata. There is no uniqueness assertion tying backend identity to artifact identity.

Required fix: encode backend in the artifact identity, or enforce and assert a unique architecture/backend mapping so matrix expansion cannot collide or desynchronise the manifest from the bytes.

## 7. Prior build hardening — CONFIRMED

Present on disk:

- required release_tag input at lines 24-26;
- namespace validation at read time, lines 114-135, and immediately before publication, lines 520-538;
- tag checkout at lines 150-158 and HEAD equals the peeled tag commit at lines 160-176;
- option terminators on AWS calls at lines 593, 688, 694, and 700;
- normalized double-pack and equality check at lines 327-350;
- archive size and digest rechecked against pack outputs at lines 612-623;
- RPATH validation over every Mach-O at lines 387-418;
- kalsa-server --version at line 385 and /health at line 437;
- no upload-artifact, download-artifact, or actions/cache;
- unchanged workflow_dispatch, b11010-merge push, and kalsa-server-* tag triggers at lines 20-43.

The double-pack check establishes equality for the two packs made in this run. It does not claim that a separate future build of the same tag will have the same bytes.

Command:

~~~text
awk '/run:/{in_run=1; next} in_run && /github[.]|env[.]/ {print FNR ":" $0} /^[^ ]/ {in_run=0}' .github/workflows/kalsa-server.yml
~~~

Output was empty. Separate scans for upload-artifact, download-artifact, actions/cache, and local uses were also empty.

## 8. Fresh-build digest and old GitHub release assumptions — CONFIRMED

The workflow contains no old digest 4442b12aa39ada682dbb8aebcdf17e78f1e48d382a9a3cde87c25fcdfcde9464, no GitHub release upload path, and no dependency on a pre-existing GitHub release. A fresh build can legitimately differ in linker UUIDs and similar bytes. The R2 manifest must therefore be treated as the authoritative record for the R2 object actually uploaded, not as a claim that it matches the old GitHub artifact.

## Required fixes, in order

1. Treat every nonzero aws s3 ls status as a hard error before examining empty output or allowing force. This is the blocking overwrite issue.
2. Compute or assert the manifest format and exe fields from the packaging and verification source of truth.
3. Tie backend identity to artifact identity, or add a hard matrix uniqueness/invariant check preventing same-architecture collisions.

## Final verdict

NOT PUSH-SAFE. The workflow must not be pushed or dispatched until item 4 is fixed; items 5 and 6 also violate the stated acceptance criteria.

After the fixes are reviewed, the intended commands are:

~~~text
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-r2 push origin e89d1f2330581e9a1a230ae9573ba78cf3c648b4:b11010-merge
gh workflow run kalsa-server.yml --ref b11010-merge -f release_tag=kalsa-server-v1.0.0
~~~

Final line: NOT PUSH-SAFE for the fast-forward push of e89d1f23 and the dispatch command above.
