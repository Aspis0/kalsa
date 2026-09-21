# Re-audit: head-object R2 publication

Target: /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-r2, branch r2-head-on-top, HEAD 916b8f0bcfcb829011f129b4dff8acfd01ab7814.

This was a read-only review. I did not push, dispatch, or upload.

## 1. No listing-based decision — CONFIRMED

The tree identity and scope are:

~~~text
git rev-parse HEAD^{tree}
git rev-parse 40e63416^{tree}
git diff --name-only f404d9180445772b6c857e0444f1f3fb3de5b19c..HEAD
~~~

~~~text
fe4abcedb7946cf21518c2c8a5a0fc845e6a0ac3
fe4abcedb7946cf21518c2c8a5a0fc845e6a0ac3
.github/workflows/kalsa-server.yml
~~~

The head-only decision is at .github/workflows/kalsa-server.yml:740-751: each of the three exact keys calls head_object, and only HEAD_STATE values populate EXISTING_KEYS. The force/refusal decision at lines 784-795 reads EXISTING_KEYS, not listing output.

The listing at lines 754-782 is explicitly advisory. It can print foreign keys and can fail or return malformed JSON without affecting the decision. Contents and the old KeyCount approach occur only in comments or that advisory listing:

~~~text
rg -n 'Contents|KeyCount|list-objects-v2|head-object' .github/workflows/kalsa-server.yml
689:          # write, one head-object each, and classifies the exit:
700:          # decision belongs to head-object alone
704:          # ... R2 omits KeyCount ...
721:            HEAD_OUT="$(aws s3api head-object ...
759:          LIST_JSON="$(aws s3api list-objects-v2 ...
773:            jq -r '.Contents[]? ...
776:              '.Contents[]? ...
892:          # the recount asks for the same three keys again with head-object.
905:            head_object ...
~~~

## 2. Head classification and force behavior — CONFIRMED

The helper at lines 718-738 implements the required classification:

- exit 0 sets HEAD_STATE=exists;
- nonzero stderr containing 404, Not Found, or NoSuchKey sets HEAD_STATE=absent;
- every other nonzero sets HEAD_STATE=error.

Lines 743-746 abort on error before the force branch. Lines 748-751 record the exact conflicting key, and lines 784-792 either name those keys and refuse or print the loud force overwrite warning. A denied head cannot be bypassed by force.

Branch-equivalent stub harness results:

~~~text
all-404: publish uploads=3
one-present force=false: refuse key=kalsa-server/v1.0.0/archive.tar.gz uploads=0
one-present force=true: OVERWRITING key=kalsa-server/v1.0.0/archive.tar.gz
one-present force=true: publish uploads=3
non404 force=false: abort uploads=0 force=false
non404 force=true: abort uploads=0 force=true
~~~

The text classifier is intentionally based on the documented R2 missing-key responses. A future endpoint that emits an unrelated error containing one of those strings would be a small residual false-absent risk; structured error parsing would be stronger, but the current required R2 404/NoSuchKey behavior is correctly handled.

## 3. Post-upload recount — CONFIRMED

The recount calls head_object again for all three names at lines 897-905. It derives local sizes for TAR, DIGEST, and MANIFEST at lines 897-904, rejects error or absent states at lines 906-915, compares each returned ContentLength at lines 916-919, and prints each successful remote/local size match at line 920.

The size-mismatch stub case reproduced:

~~~text
post-size-mismatch: abort-after-upload uploads=3 key=archive.tar.gz.sha256 expected=20 actual=19
~~~

## 4. Trap and permission comments — CONFIRMED

Lines 701-709 document all requested traps:

- aws s3 ls can return nonzero on an empty prefix, including aws/aws-cli#5544;
- a JMESPath Contents[] projection can print literal None when Contents is absent;
- R2 omits KeyCount, so querying it can also print None;
- head-object needs GetObject permission, the S3 permission used for HeadObject, in addition to upload permission;
- denied heads abort deliberately rather than being read as absent.

## 5. Non-regression — CONFIRMED

Shape:

~~~text
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git rev-list --parents -n1 HEAD
git diff --name-only f404d9180445772b6c857e0444f1f3fb3de5b19c..HEAD
~~~

~~~text
r2-head-on-top
916b8f0bcfcb829011f129b4dff8acfd01ab7814
916b8f0bcfcb829011f129b4dff8acfd01ab7814 f404d9180445772b6c857e0444f1f3fb3de5b19c
.github/workflows/kalsa-server.yml
~~~

The scan for forbidden release machinery, widened repository permission, artifacts, caches, and local reusable actions produced only the expected read permission:

~~~text
rg -n -i 'gh release|--clobber|--verify-tag|upload-artifact|download-artifact|actions/cache|uses: ./|contents:[[:space:]]*write' .github/workflows/kalsa-server.yml
rg -n 'permissions:|contents:' .github/workflows/kalsa-server.yml
47:permissions:
48:  contents: read
~~~

A diff scan for secrets and absolute local paths was empty:

~~~text
git diff f404d9180445772b6c857e0444f1f3fb3de5b19c..HEAD | rg -n '/Users/marco|BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|ghp_|github_pat_'
~~~

The prior shell-body interpolation scan was empty. The preserved hardening is at these lines:

- required release_tag: 24-26;
- namespace validation at read time: 120-141;
- namespace validation immediately before publication: 601-617;
- tag-ref checkout: 156-164;
- HEAD equals refs/tags/TAG peeled commit: 166-182;
- cp positionals after option terminators: 878, 884, and 890; head/list calls use options only;
- double pack and comparison: 410-422;
- archive normalization: 396-407;
- RPATH validation over every Mach-O: 465-509;
- --version: 463;
- /health: 511-525;
- unchanged workflow_dispatch, b11010-merge push, and kalsa-server-* tag triggers: 19-43.

The current remote tip and ancestry are:

~~~text
git -C /Users/marco/Projects/kalsallama rev-parse origin/b11010-merge
git rev-parse HEAD^1
git merge-base --is-ancestor f404d9180445772b6c857e0444f1f3fb3de5b19c HEAD && echo fast_forward_from_parent=true
~~~

~~~text
f404d9180445772b6c857e0444f1f3fb3de5b19c
f404d9180445772b6c857e0444f1f3fb3de5b19c
fast_forward_from_parent=true
~~~

## 6. Public URL probe recommendation

The S3-API recount is sufficient to prove that the three objects exist at the write endpoint and have the expected sizes. Given the measured dl.kalsa.io response is cf-cache-status DYNAMIC, I do not consider the lack of a public probe a blocking defect for this first publish.

I recommend a cheap post-upload public URL HEAD/GET probe as defense in depth because the desktop fetches through dl.kalsa.io, not the S3 endpoint; it would detect route, DNS, or public-domain failures that an S3 recount cannot. It should remain supplemental rather than replace the S3 heads, because public caching can legitimately serve stale 404 or old bytes during force overwrites.

## 7. Five-case spot check

All requested behavior cases were reproduced with the branch-equivalent stub harness:

- all three heads 404: publish;
- one head present: refuse without force, warn and publish with force;
- non-404 head failure: abort with and without force;
- post-upload size mismatch: abort;
- failed advisory listing: continue publishing after the heads pass.

The actual R2 bucket and upload path were not contacted. The public-domain cache behavior is taken from the supplied curl measurement.

## Required fixes

None. The public URL probe is recommended defense in depth, not required for this push.

## Final verdict

PUSH-SAFE for the fast-forward push and dispatch.

~~~text
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-r2 push origin 916b8f0bcfcb829011f129b4dff8acfd01ab7814:b11010-merge
gh workflow run kalsa-server.yml --ref b11010-merge -f release_tag=kalsa-server-v1.0.0
~~~

Final line: PUSH-SAFE for (a) the fast-forward push of 916b8f0 onto b11010-merge and (b) the dispatch command above.
