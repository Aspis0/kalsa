# Final narrow re-audit: R2 server publication

Target: /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-r2, branch kalsa-r2-publish, HEAD 36154ae887b5efb3e6a5290efaa4a8f55c610cb8.

This review was read-only. I did not push, dispatch, or upload.

## 1. Numeric KeyCount decision — CONFIRMED

The check now calls ListObjectsV2 with query KeyCount and output text at .github/workflows/kalsa-server.yml:704-715. It tests the API status at lines 722-725, then requires a plain non-negative integer at lines 726-729. Only after that does the caller compare the integer at lines 743-758 and consult force at lines 750-755. A failed or malformed count cannot reach the force branch.

The stub-aws harness reproduced the requested cases. It returned a numeric zero, a positive count, no output, a blank line, literal None, or status 254:

~~~text
(a) KeyCount 0, no Contents: publish uploads=3 count=0
(b) non-empty count, force=false: refuse uploads=0 count=3 force=false
(b') non-empty count, force=true: OVERWRITING: force=true
(b') non-empty count, force=true: publish uploads=3 count=3
(c) missing count, force=false: abort uploads=0 force=false
(c') missing count, force=true: abort uploads=0 force=true
(d) empty count, force=false: abort uploads=0 force=false
(e) None count, force=false: abort uploads=0 force=false
(e') None count, force=true: abort uploads=0 force=true
(f) failed API, force=false: abort uploads=0 force=false
(f') failed API, force=true: abort uploads=0 force=true
~~~

The isolated malformed-output check also observed:

~~~text
missing: raw_length=0 result=failed-check
empty: raw_length=0 result=failed-check
none: raw_length=4 result=failed-check
~~~

The previous real-dispatch failure, where absent Contents became the text None, is therefore rejected before any upload.

## 2. Numeric recount and exact key set — CONFIRMED

The post-upload recount calls the same key_count function at lines 859-863, so a missing, empty, None, malformed, or failed count aborts. Lines 873-878 require KeyCount 3 and three nonempty rows. Lines 879-885 then require each exact expected key: TAR, DIGEST, and MANIFEST. Lines 886-890 extract the remote archive size and compare it with local SIZE. The recount is numeric for the decision; the row text is only a second check for exactly the three expected keys.

## 3. Trap documentation — CONFIRMED

The comments at lines 692-698 explicitly document both failure modes: aws s3 ls can exit nonzero for an empty prefix, and the JMESPath Contents[] projection can print literal None when Contents is absent. Lines 704-705 state that both a nonzero AWS status and a non-integer KeyCount are failures.

## 4. Non-regression — CONFIRMED

Shape and ancestry:

~~~text
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git rev-list --parents -n1 HEAD
git diff --name-only 3a4d5143e8eed99999b5aa34185cc420ddc5ffc7..HEAD
~~~

~~~text
kalsa-r2-publish
36154ae887b5efb3e6a5290efaa4a8f55c610cb8
36154ae887b5efb3e6a5290efaa4a8f55c610cb8 3a4d5143e8eed99999b5aa34185cc420ddc5ffc7
.github/workflows/kalsa-server.yml
~~~

The forbidden release machinery, write permission, artifact/cache actions, local reusable actions, absolute paths, and credential-looking literals were scanned:

~~~text
rg -n -i 'gh release|--clobber|--verify-tag|upload-artifact|download-artifact|actions/cache|uses: ./|contents:[[:space:]]*write' .github/workflows/kalsa-server.yml
git diff 3a4d5143e8eed99999b5aa34185cc420ddc5ffc7..HEAD | rg -n '/Users/marco|BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|ghp_|github_pat_'
~~~

Both outputs were empty. Repository permissions remain contents: read at lines 47-48. R2 credentials are environment entries at lines 572-576, not AWS arguments. The prior shell-body interpolation scan was empty.

The previously approved hardening remains:

- release_tag is required at lines 24-26;
- namespace validation occurs at read time, lines 120-141, and before publication, lines 601-617;
- checkout uses the resolved tag ref at lines 156-164;
- the tag assertion compares HEAD with refs/tags/TAG peeled to a commit at lines 166-182;
- cp source and destination positionals are after option terminators at lines 841, 847, and 853; list-objects calls have no positional operands;
- double packing and equality comparison are at lines 410-422;
- archive normalization is at lines 396-407;
- every Mach-O dependency is checked at lines 465-509;
- --version is checked at line 463;
- /health is probed at lines 511-525;
- triggers remain workflow_dispatch, push to b11010-merge, and push on kalsa-server-* at lines 19-43.

Fast-forward state:

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

## 5. Residual risk

The check-then-upload sequence still has a documented single-writer race: two concurrent publishers could pass the empty check before either uploads. The recount is a count/key/size check rather than a full remote archive digest verification, so same-size corruption remains a low-probability residual risk.

## Required fixes

None.

## Final verdict

PUSH-SAFE for both the fast-forward push and the dispatch, subject to the existing single-writer and integrity residual risks above.

~~~text
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-r2 push origin 36154ae887b5efb3e6a5290efaa4a8f55c610cb8:b11010-merge
gh workflow run kalsa-server.yml --ref b11010-merge -f release_tag=kalsa-server-v1.0.0
~~~

Final line: PUSH-SAFE for (a) the fast-forward push of 36154ae8 onto b11010-merge and (b) the dispatch command above.
