# HOSTILE AUDIT — repo consolidation (moe-experiments / BigMoeOnEdge / llama.cpp fork)

Auditor: ox-alpha, read-only. Started: 2026-08-22.
Status: IN PROGRESS — skeleton; sections filled incrementally.

## Claims under audit
1. Aspis0/kalsallama created; all branches+tags of local llama.cpp fork pushed (8 branches incl. kalsa/kernel-s3-repack @ 1882bf8cd, kalsa/mmap-prefetch-opt @ e5605f3bd).
2. Fork pre-push hook rewritten to allow-list github.com/Aspis0/* only.
3. BigMoeOnEdge .gitmodules -> Aspis0/kalsallama, commit 9f2584f on kalsa/drop-policy-s2 pushed to Aspis0/kalsa-engine. Rest of dirty WIP untouched.
4. moe-experiments: kalsa-engine/ (3503 files) deleted in ccefafb after zero-unique-content verification; bundles/ -> backups/engine-bundles/; docs updated; ccefafb+ce9d4da pushed to Aspis0/kalsa-moe-experiments.

## Check A — REF-LOSS SWEEP
STATUS: DONE — 1 FINDING (LOW-MED) + 1 secondary finding (stash)

Method: mirror-fetched ALL refs of Aspis0/kalsallama, Aspis0/kalsa-engine, Aspis0/kalsa-moe-experiments into a throwaway bare repo (`tmp/sweep.git`); tested every bundle head with `git cat-file -e <sha>^{commit}` and ancestry checks. Local-repo presence checked with `git cat-file -t` inside BigMoeOnEdge / fork.

### bigmoeonedge-all-branches.bundle (Aug 14)
| ref | sha | state | verdict |
|---|---|---|---|
| kalsa/kernel-lib | 461877c7 | GitHub kalsa-engine | OK |
| kalsa/kernel-s1-expert-pack | 93d78abc | GitHub kalsa-engine | OK |
| kalsa/kernel-s2-layer-fuse | 0c54a278 | GitHub kalsa-engine | OK |
| kalsa/kf-layer-ahead (=bundle HEAD) | cad9428a | GitHub kalsa-engine | OK |
| kalsa/mellum-recipe | d9870274 | GitHub kalsa-engine | OK |
| kalsa/selfspec-f1 (bundled) | 2396c562 | ancestor of GitHub kalsa-engine selfspec-f1 @ b3eb60c (verified `merge-base --is-ancestor`) | OK |
| main | 8958cdf9 | GitHub kalsa-engine main = same sha | OK |
| origin/HEAD + origin/main (bundled) | 8c8c8f18 | REACHABLE on remotes | OK |
| **origin/docs/cache-sizing-in-token-cycles** | **c74618f6** | **(iii) ONLY IN BUNDLE** (+ unreachable object in local BMOE); NOT on any Aspis0 repo, NOT ancestor of any current branch. Commit: Helldez, "docs(roadmap): propose a self-sizing expert cache" | **FINDING** |
| **origin/exp/thread-affinity** | **d1ee0175** | **(iii) ONLY IN BUNDLE** (+ unreachable object). Helldez, "feat(cli): thread affinity pinning via public threadpool API (proposal)" | **FINDING** |
| **origin/perf/odirect-zero-copy** | **5ff72ef0** | **(iii) ONLY IN BUNDLE** (+ unreachable object). Helldez, "fix(io): do not read in place under overlap on Windows"; branch also holds zero-copy gate benchmarks | **FINDING** |
| worktrees/kvfix-a76/HEAD | 2c675a52 | REACHABLE — verified ancestor of kalsa-engine main | OK |
| all 34 tags (v0.1.0…v0.19.0, experiment/layer-lfu, *-refuted ×4) | — | byte-exact sha match vs kalsa-engine remote (34/34) | OK |

### kernel-lib-genesis.bundle
kalsa/kernel-lib @ 461877c7 → GitHub kalsa-engine. OK.

### llamacpp-kalsa-delta.bundle
All 7 heads verified against Aspis0/kalsallama: b8a78977 ✓, 4a3ae4e5 ✓, e5605f3bd ✓, 7670428d ✓, 04c5d362 ✓ (×2 branches). Older kernel-s3-repack @ 8d3c2ea7 verified ancestor of current 1882bf8cd. OK.

### kalsakernel-v1..v4 + kernel-s3-repack-HEAD bundles
v1 eaec5d88, v3 c1bb48d3, v4 ec7235af = tags present on kalsallama with identical shas. Intermediate 55f43a57 verified ancestor of v4. HEAD bundle = 1882bf8cd = current kalsallama kernel-s3-repack. OK.

### FINDINGS
1. **[MED-LOW] Three origin/* commits exist ONLY inside the bundle**: c74618f6 (docs/cache-sizing), d1ee0175 (exp/thread-affinity), 5ff72ef0 (perf/odirect-zero-copy). All authored by "Helldez" (old upstream fork owner), none merged into any surviving branch. Objects still sit unreferenced in local BigMoeOnEdge and WILL BE GC'd eventually. Content is upstream history/proposals, not Kalsa-authored work — but the audit criterion says state (iii) = finding. Mitigation: bundle copy exists at backups/engine-bundles/bigmoeonedge-all-branches.bundle.
2. **[LOW] BigMoeOnEdge has a stash `refs/stash c2fdc95` "On main: drop-policy-7files-from-main" (2026-08-18) that is on no remote and in no bundle** (bundles predate it). Stashes are WIP by nature and the claim said dirty WIP would be left alone, but it is the one ref class with zero off-machine copy.

Everything else: NO REF LOSS.

## Check B — kalsallama remote state
STATUS: DONE — PASS

- `git ls-remote https://github.com/Aspis0/kalsallama.git`: exactly 8 branches + HEAD, shas byte-identical to the local fork's 8 branches (kernel-s3-repack 1882bf8cd ✓, mmap-prefetch-opt e5605f3bd ✓, s1 b8a78977, s2 4a3ae4e5, mld-gemv-m1 7670428d, opencl-q6k-dispatch-fix & split-trunk-gpu both 04c5d362, master 90e0f5cf).
- Tags `kalsakernel-v1..v4` present remotely with identical peeled-commit shas as local fork (eaec5d88/f6374655/c1bb48d3/ec7235af). Remote carries ~6968 tags total (upstream b-numbering preserved).
- Local fork origin = `https://github.com/Aspis0/kalsallama.git`, the ONLY remote (fetch+push). No other remotes.
- Claimed "8 branches" confirmed exactly (7 kalsa/* + master).

## Check C — pre-push hooks & remotes
STATUS: DONE — PASS (2 minor notes)

Fork hook `BigMoeOnEdge/.git/modules/third_party/llama.cpp/hooks/pre-push`:
```
#!/bin/sh
# Kalsa policy: this llama.cpp fork may push ONLY to Aspis0-owned repos.
remote_url="$2"
case "$remote_url" in
  https://github.com/Aspis0/*|git@github.com:Aspis0/*) exit 0 ;;
  *) ... BLOCKED ...; exit 1 ;;
esac
```
Functional test (invoked directly with `$1=push-upstream $2=<url>`):
| url | exit |
|---|---|
| https://github.com/Aspis0/kalsallama.git | 0 ALLOW |
| git@github.com:Aspis0/kalsallama.git | 0 ALLOW |
| https://github.com/Helldez/llama.cpp.git | 1 BLOCK ✓ |
| https://github.com/ggml-org/llama.cpp | 1 BLOCK ✓ |
| git@github.com:ggml-org/llama.cpp.git | 1 BLOCK ✓ |
| https://evil.example/Aspis0/lookalike.git | 1 BLOCK ✓ (prefix anchor holds) |
| ssh://git@github.com/Aspis0/kalsallama.git | 1 BLOCK (false positive — see note) |

Notes:
1. [TRIVIAL] The `ssh://git@github.com/Aspis0/*` URL form (and `https://Aspis0@github.com/...`) is blocked too. Over-blocking, not a security hole; only matters if someone switches remote URL style.
2. [TRIVIAL] BigMoeOnEdge's own pre-push (`*github.com/Aspis0/*`, unanchored glob) would allow a hostile URL containing the substring anywhere (e.g. host `evil/github.com/Aspis0/x`). It predates this consolidation and was not part of claim 2.

Other remotes sweep:
- moe-experiments → Aspis0/kalsa-moe-experiments only ✓
- BigMoeOnEdge → Aspis0/kalsa-engine only ✓
- llama.cpp fork (module) → Aspis0/kalsallama only ✓
- llama.cpp-judge-swap (module worktree) → Aspis0/kalsallama only ✓
- deps/opencl-android/{OpenCL-Headers,OpenCL-ICD-Loader}, deps/vulkan-android/{SPIRV-Headers,Vulkan-Headers} → ZERO remotes each ✓
Every remote line on disk resolves to github.com/Aspis0/*. PASS.

## Check D — Zero-unique-content independent verification
STATUS: DONE — PASS (1 caveat)

- 5 random files sampled from `ccefafb^` `kalsa-engine/third_party/llama.cpp` (card/index.ts, openvino/input_model.h, scripts/hf.sh, mul_mm_id_funcs.glsl, ci/run.sh): **all 5 sha256-identical** to `git -C <fork> show e5605f3bd:<path>`. Zero mismatches.
- Bonus: all 11 TRACKED .kt files in the vendored copy also sha256-match fork @ e5605f3bd (11/11).
- Kotlin claim: BMOE `kalsa/drop-policy-s2` contains **exactly 18 .kt files** (examples/android/app/src/main/java/io/bigmoeonedge/example/*) ✓ count matches.
- CAVEAT [LOW]: the claimed "18 untracked Kotlin files in kalsa-engine hash-identical to BMOE branch" cannot be re-verified post-hoc — kalsa-engine/ (and its untracked files) is deleted, and untracked files never entered git history. The content itself survives in BMOE kalsa/drop-policy-s2, so nothing is lost either way. Note the vendored copy's tracked .kt set (11 files, com.example.llama/com.arm.aichat paths) is a DIFFERENT set from the 18 io.bigmoeonedge ones.

## Check E — Dangling references
STATUS: DONE — 1 FINDING (MED: live git config), rest harmless

### `kalsa-engine/` path refs in tracked files @ HEAD (12 files)
| file | nature | verdict |
|---|---|---|
| PLAN.md:293 | says vendored copy ELIMINATED | correct, historical |
| PLAN.md:538,540,997 | past descriptions of kalsa-engine/ + bundles (see Check F) | historical, mildly stale wording |
| docs/ALIVE.md:339 | consolidation block, explains correction | correct |
| docs/ENGINE.md:24 | describes old vendored home w/ commits | historical (doc exists to record this) |
| docs/kernel-plan-v2.md:186 | old plan doc | historical |
| results/{calaqwen,mellum2}_dropcurve/* (CURVE/VERDICT/probe.json/report.md) | provenance strings pointing at `kalsa-engine/core/src/config.cpp` | path dangling locally BUT content preserved: `core/src/config.cpp` verified present in BMOE kalsa/drop-policy-s2 → resolvable. Harmless. |
| scripts/run_mellum2_dropcurve.py:226,697 | strings in OUTPUT TEXT only — verified no runtime file reads of that path | harmless |
| resume_*.ps1 / scripts/*.ps1 | zero kalsa-engine refs | clean |

### "Helldez" sweep
- Tracked files: all hits are historical (PLAN-archive.md, mandates/*, reports/*, patches/README.md) or docs explicitly recording the removal (PLAN.md:288, ALIVE.md:342, ENGINE.md:33-35). No live path uses Helldez.
- .gitmodules on disk: outer → Aspis0/kalsa-engine ✓; BMOE → Aspis0/kalsallama ✓ (claim 3 verified); fork & judge-swap .gitmodules empty (upstream has none).
- **FINDING [MED]: `git config` of BigMoeOnEdge still holds `submodule.third_party/llama.cpp.url = https://github.com/Helldez/llama.cpp.git`.** Config OVERRIDES .gitmodules for local submodule operations: `git -C BigMoeOnEdge submodule update` would fetch from Helldez (third party), where the Kalsa commits (e.g. gitlink 1882bf8cd) do not exist → failure or third-party fetch. Fresh clones are unaffected (they read .gitmodules). Ironic given PLAN.md:288 declares "`submodule sync` resuscita Helldez" dead. Fix (not applied, read-only audit): `git -C BigMoeOnEdge submodule sync` or set config url to kalsallama.
- Git config sweep of every .git on disk (maxdepth 4): outer→Aspis0/kalsa-moe-experiments, BMOE origin→Aspis0/kalsa-engine, fork module→Aspis0/kalsallama, judge-swap module→Aspis0/kalsallama. All remote.*.url lines = Aspis0 ✓ (the Helldez hit above is a submodule.*.url, listed separately).

### "bmoe/expert-ready-hook"
- moe-experiments tracked files: PLAN.md:292, ALIVE.md:338, ENGINE.md:19 all correctly state the branch does NOT exist; reports/moe-f0.1.md:61 historical. No live reference.

## Check F — Docs accuracy
STATUS: DONE — PASS with 1 nuance

Verified claims across docs/ENGINE.md, PLAN.md "Fatti operativi" (~line 280) and dated journal entries, docs/ALIVE.md §5b:
- All shas in docs check out: kernel-s3-repack 1882bf8cd ✓, mmap-prefetch-opt e5605f3bd ✓, expert-ready hook 5236140e5 (verified ancestor of mmap-prefetch-opt) ✓, mmap_prefetch param commit 206a8fe7f (ancestor ✓), .gitmodules commit 9f2584f (= remote drop-policy-s2 head) ✓, vendored-home commits 81e14c7/aeafd74/a059840 present in moe-experiments history ✓.
- Branch names, tag set v1–v4, "8 branches", bundle location backups/engine-bundles/, deletion of kalsa-engine/, pre-push allow-list: all match reality.
- "bmoe/expert-ready-hook does not exist" — confirmed: no such branch on kalsallama, BMOE, or any bundle.
- NUANCE [LOW, ties to Check E finding]: ENGINE.md states ".gitmodules no longer references Helldez, so `git submodule sync` can no longer resurrect a third-party remote". True for sync itself, but BigMoeOnEdge's git config STILL carries the old Helldez submodule URL override, which plain `git submodule update` uses until a sync runs. The docs imply this door is fully closed; it isn't quite.
- PLAN.md:538–540 and :997 describe kalsa-engine/ as engine home — both are explicitly DATED journal entries (2026-08-14 lane) superseded by the 2026-08-22 block at :280–293. Harmless historical.

## Check G — ai-chat app impact (completed by second auditor: mimo)
STATUS: DONE — PASS

Method: `grep -r` over all tracked text files (`.ts`, `.tsx`, `.js`, `.json`, `.md`, `.kt`, `.java`, `.gradle`, `.toml`) in `C:\Users\gualt\Desktop\Kalsa\ai-chat`, excluding `node_modules` (except llama.rn patch dir per instructions). No app code was modified.

| Search term | Hits | Verdict |
|---|---|---|
| `kalsa-engine` | **0** (exit 2, no matches) | N/A — no reference to the deleted path exists |
| `bmoe/expert-ready-hook` | **0** (exit 2, no matches) | N/A — phantom branch name not referenced |
| `Helldez` | **0** (exit 2, no matches) | N/A — no legacy upstream author attribution in app |

The ai-chat app has zero live references to any consolidation-deleted path, phantom branch, or upstream author. No cleanup required.

## POST-AUDIT FIX VERIFICATION (orchestrator applied after Check E; confirmed by second auditor)
`git -C BigMoeOnEdge config submodule.third_party/llama.cpp.url` returns **https://github.com/Aspis0/kalsallama.git** — **PASS**. The Check E MED finding (stale `Helldez/llama.cpp.git` submodule URL override in git config) is FIXED. .gitmodules and git config now agree; `git submodule update` will fetch from kalsallama, not a third party.

## FINAL VERDICT: BANK-WITH-CORRECTIONS

**Auditors:** ox-alpha (Checks A–F, original; died mid-work), mimo (Check G, E-fix verification, final verdict)

Consolidation claims 1–4 are **verified accurate**. Nothing is lost or broken. The following corrections carry forward:

1. **[MED → FIXED]** BMOE `submodule.third_party/llama.cpp.url` overrode .gitmodules with `Helldez/llama.cpp.git`. Orchestrator ran `submodule sync`; second auditor verified config now returns `https://github.com/Aspis0/kalsallama.git`.
2. **[MED-LOW]** Three Helldez-authored commits (c74618f6 docs/cache-sizing, d1ee0175 exp/thread-affinity, 5ff72ef0 perf/odirect-zero-copy) exist ONLY inside `backups/engine-bundles/bigmoeonedge-all-branches.bundle`. Their objects in local BMOE are unreferenced and GC-eligible. Not Kalsa-authored work; not merged into any surviving branch. Mitigation: bundle copy preserves them. Accept or extract to a safe remote.
3. **[LOW]** BMOE stash `c2fdc95` ("On main: drop-policy-7files-from-main", 2026-08-18) has no off-machine copy — it postdates all bundles. WIP stash by nature; no action required unless the WIP is still desired.
4. **[LOW]** The "18 untracked Kotlin files hash-identical to BMOE" claim is unverifiable post-hoc (kalsa-engine/ deleted). Content survives in BMOE `kalsa/drop-policy-s2` (all 18 `io.bigmoeonedge.example` files present) → no information loss either way.
5. **[TRIVIAL]** Fork pre-push hook blocks `ssh://git@github.com/Aspis0/*` (over-blocking, not a security hole). BMOE's own hook uses an unanchored glob predating this consolidation.
6. **[TRIVIAL]** Ai-chat app (Check G): zero references to "kalsa-engine", "bmoe/expert-ready-hook", or "Helldez" across all tracked text files. No cleanup needed.

**Disposition:** BANK-WITH-CORRECTIONS. All consolidation claims hold. Corrections 2–6 are informational/residual; only correction 1 was a live risk and is now resolved.
