# Kalsa: PLAN

This is the living plan for rules, workstream state, next steps, and owner decisions. Measurements belong in docs/ALIVE.md.

Archives: archived/PLAN-2026-09-full.md, archived/PLAN-2026-10-09-full.md, archived/ALIVE-2026-09-full.md, archived/ALIVE-2026-10-09-full.md, archived/PLAN-2026-10-16-full.md, archived/ALIVE-2026-10-16-full.md. The two new archives freeze the former living documents. [archived/PLAN-2026-10-16-full.md:2-5; archived/ALIVE-2026-10-16-full.md:138-140]

## What Kalsa is

Kalsa is an Android and iOS chat app that runs language models on the phone itself, no server in the loop, plus a desktop app (kalsa-brain) it pairs with. The engine is our llama.cpp fork, consumed through our llama.rn binding fork pinned by commit; the app is React Native. Device measurements are the arbiter; this lab repo holds the method, the raw evidence and the audits. [archived/PLAN-2026-10-16-full.md:11-16]

Standing goal (owner): a kernel that uses NPU, GPU and CPU per phase according to temperature, battery and device profile, optimised for Snapdragon, and for MediaTek/Jelly where possible. Scope (owner, 2026-09-29): DENSE models in Q4_0 (one-copy NPU prefill reader, governor) first; MoE and our own quantisations later. Accelerator order (owner, 2026-09-29): Snapdragon, then iPhone, then Exynos, Mali, Tensor. [archived/PLAN-2026-10-16-full.md:12-18]

## Standing rules

### NOTHING GOES UPSTREAM (owner, 2026-09-21, permanent and absolute)

Nothing goes upstream. Ever. No pull requests, no issues, no comments, no reviews, no patches,
no discussion posts, no mailing list, no Discord, nothing. Reading upstream is allowed and
useful (git fetch upstream, logs, issue pages); writing anything upstream is forbidden, by us
and by any agent acting for us. The fork is ours and stays ours. Where an earlier record says
“push this as a PR”, the fork-only equivalent applies: keep it in the branch. This rule sits
ABOVE the push/tag/release rule: push, tag and release additionally require the owner's explicit
OK. The coordinator pushes after an audit; agents do not push. [archived/PLAN-2026-10-16-full.md:24-30]

### A coder's refspec is a proposal, not a decision (2026-09-23)

The shipping line moves only when the audit's checklist is cleared. A push command written
against a shipping ref is a proposal for the owner: on 2026-09-23 a coder's push block named the
shipping ref, what ran created a new ref instead, and the shipping ref was verified unmoved
(scratchpad/agents/cok-residual/REPORT.md sec. 9). Review the REFSPEC, not just the patch.
[archived/PLAN-2026-10-16-full.md:34-37]

### Two living documents only (owner, 2026-09-09)

PLAN.md and docs/ALIVE.md are the only two living documents. Dated findings and contracts
under analysis/, and per-cell evidence under scratchpad/agents/, sit outside archived/ on
purpose. Every other .md is frozen, in archived/ or in place. The count is whatever
git ls-files '*.md' | rg -v '^(archived/|PLAN\.md$|docs/ALIVE\.md$)' | wc -l prints, so it
cannot go stale. Archive blobs are byte-fidelity copies, original language kept.
[archived/PLAN-2026-10-16-full.md:41-45]

### The four repos, their checkouts and the delivery chain

The authoritative map is REPOS.md in the app repo. The live checkouts:

| repo | local checkout | role |
|---|---|---|
| Aspis0/kalsa | governor/app work: worktree ~/Projects/kalsa-wt-gov. ~/Projects/kalsa is shared and holds another session's uncommitted UX work - do not edit it. ~/Projects/kalsa-brain = branch brain (desktop) | the app |
| Aspis0/kalsallama | worktree ~/Projects/kalsallama-upstream-b11514 (the live tree). ~/Projects/kalsallama's local main is stale (5b596ce43) | the llama.cpp fork: OpenCL MoE kernels, Hexagon, repack, governor |
| Aspis0/kalsa.rn | ~/Projects/llama.rn-kalsa-onecopy | the React Native binding fork, upstream vendor/ layout |
| Aspis0/kalsa-moe-experiments | ~/Projects/kalsa-moe-experiments | the lab: this repo |

One repo is archived read-only: Aspis0/kalsa-forkbigmoeonedge, a lab submodule for provenance.
Engine and binding forks are main-only (retired lines are archive/<name> tags).

The delivery chain: engine commit -> binding vendor bump (vendor/VERSIONS names the engine
commit; HTP DSP skels are rebuilt from the same tree, with a skew gate) -> app pin
(package.json pins kalsa.rn#<sha>) -> provenance gate (npm ci + assert-engine-provenance,
must exit 0) -> CI APK -> device verification. The app pin moves only with the owner's OK.
[archived/PLAN-2026-10-16-full.md:49-64]

### Other standing rules (owner, 2026-10-02)

- Audits are triaged: fix P0/P1 and P2 that touch app/users/performance; the rest goes to the
  root BACKLOG-LOW-PRIORITY.md (current; scratchpad/BACKLOG-LOW-PRIORITY.md holds older
  leftovers) and work moves on.
- ONE max-recall cross-file review per piece of work, then triage as above.
- An artefact whose hash is cited must be archived before any cleanup touches build output.
- Measurement hygiene: heat and speed claims only unplugged on our phones (never benchmark
  charging); every timing ratio states the screen state of both arms; every published number
  carries its load condition. QDC boards are always powered: speed indicative, heat none.
- Endurance criterion (owner 2026-10-08): start at skin <= 31 C (S23), run until skin 43 C,
  report mean tok/s next to it. Safety kills only: skin 44 C, battery < 30 %. No leg-headroom stop.
- S23 before every session: persist.traced.enable must be 0 (the DSP-daemon spin fix).
- No apk.yml dispatch without telling kalsa-brain first (agreed 2026-10-07).
[archived/PLAN-2026-10-16-full.md:68-79]

### No claim without a cited line (owner, 2026-10-15)

> “Basta cercare e usare explorers e non c'è bisogno di allucinare niente. Basta citare le righe
> lette.”

- If you cannot cite file:line for it, you did not read it — do not assert it. Search first,
  then speak. A claim about our own code or our own history is never made from memory, from a
  subagent's summary, or from a plausible-sounding inference.
- A delegated report is not evidence. Re-open every load-bearing citation on disk, with a real
  exit code, before it enters a document or a commit. A delegate correcting the coordinator is
  checked twice, like any other claim.
- “Not verified” is a valid, expected answer and is written down as such. Never fill a gap with
  the likely story.
- What this rule is for, from 2026-10-15 where all three coordinator claims of the day were wrong on
  first pass and each was dissolved by one cited line: `governorInputs.ts:395` (the NPU lane was not
  hardcoded off), `xiaomi14-3way/REPORT.md:18` (SM8650/v75 NPU prefill does exist),
  `xiaomi-stage0-obs-aa789620/raw/harness.log:63` (same APK, so not a regression). Each was stated
  confidently and none was read.
[archived/PLAN-2026-10-16-full.md:81-93]

### Product and release gates

Critical path: G0 baseline → G1 model → G2 complete chat → G3 correct profiles → G4 sustained quality → M1.
The dates are planning estimates, not publication promises. [archived/PLAN-2026-10-16-full.md:100-104]

| Gate | Recorded status in the frozen ledger | Source |
|---|---|---|
| G2 | S23 met on 2026-10-10: 20/20 in-app turns, no crash or recovery, status never 3; recovery without duplicate was seen on `867affaa`. Other phones open. An earlier run stopped at turn 4 on Android SEVERE. | archived/PLAN-2026-10-16-full.md:110 |
| G3 | Partial: S23 passed in-app; Xiaomi was correct in lab, but the ledger said in-app still two-copy until the SM8650 row shipped; Jelly Star out of scope. The SM8650 row status conflicts with the pinned binding record; see [ALIVE contradictions](docs/ALIVE.md#contradictions-still-open). | archived/PLAN-2026-10-16-full.md:111; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-legs-table.cpp:89-91 |
| G4 | Open: in-APK consumption measured on S23; Meter overhead is under the 1% bar; the 2026-09-28 governor blind spot has no later verification. | archived/PLAN-2026-10-16-full.md:112 |
| M1 | Not met as of 2026-10-09: no APK with the 2026-10-09 pin; G2 open. | archived/PLAN-2026-10-16-full.md:113 |

Rules kept with the table: G3 - NPU without evidence stays out; M2 - the second model must add
useful capability, not be the automatic loser of the first comparison; a release candidate has
no dependency on hidden debug flags; never promote an incomplete build. The GPU/V75/q4_K
generations, the NPU and the governor were evidence-gated in the 24-29 Sep window, NOT "after M1";
a separate gate on 12 Oct reopens the MiniCPM5 fine-tuning decision (LFM licence revenue threshold
one input). Owner decision 2026-09-21: governor work moved forward because G2's long-session
criterion is unreachable without thermal control in the loop; Meter is part of governor work.
[archived/PLAN-2026-10-16-full.md:117-124]

Owner policy 2026-10-15: “no OOM, no reboot, degrade gently.” Degrading means stepping down a
leg, never dropping to zero layers and hoping. [archived/PLAN-2026-10-16-full.md:215-220]

Owner direction: CPU is out of prefill; NPU first; decode hops by heat; never truncate reasoning
silently; persistent SEVERE means a sustainable slow rate, the pause is only an emergency brake.
[archived/PLAN-2026-10-16-full.md:280-282]

## Current state

### Governor, NPU, and GPU

**Implemented; in-app unverified (2026-10-15):** the app lane-only path is in app commit d598a4b9 and binding commit d4754cb5. [/Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:534-537]

The governor is ON by default in the app since 2026-10-02 (absent `kalsa.governor.enabled` =
ON; an explicit "0"/"false" from Settings stays OFF). mmproj models stay OUT of the governor
until it has a vision lane (owner 2026-09-25; app gate `!options.mmprojPath`).
[archived/PLAN-2026-10-16-full.md:159-161]

Production decode uses live per-leg zone headroom for one-copy loads. The app omits
`decode_hop_tokens`; the binding fills it from the SoC legs row, whose SM8550 and SM8650 rows
specify hop 32. The S23 in-app record shows NPU↔GPU hops. Xiaomi's 2026-10-15 turn logged zero
hops and zero headroom windows because the NPU did not lose enough margin to trigger a hop.
Production also uses the battery-derived FAST/WARM/COOLMODE thermal state and decode pacing;
the Xiaomi turn logged battery thermal source, FAST, and 273 decoded NPU tokens.
[/Users/marco/Projects/kalsa/src/engine/governorInputs.ts:445-448,545-570; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-governor-params.cpp:337-338,357-359; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-llama.cpp:464-466; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-legs-table.cpp:80-91; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-governor.cpp:91-105,314-320; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-thermal-legs.cpp:116-127; /Users/marco/Projects/llama.rn-kalsa-onecopy/vendor/llama.cpp/src/llama-governor-policy-hop.cpp:182-253; /Users/marco/Projects/llama.rn-kalsa-onecopy/vendor/llama.cpp/src/llama-governor-policy.cpp:226-237,290-315; scratchpad/agents/s23-g2-inapp-1f0e967b/REPORT.md:55; scratchpad/agents/xiaomi-inapp-npu-2026-10-15/REPORT.md:33]

**Done (2026-10-16): governor attribution reaches the uploaded log.** Engine `06bf27e38` puts per-turn
prefill attribution in the stats, binding `6d14bf73` rebuilds the HTP skels for it, and app `c648c94a`
lets the KALSA_GOVERNOR_* lines through the log-report allow-list. An S23 production turn on app
`8b89c094` logged LOAD, COMPLETION (one per round), LEARNED, TURN and COST, and none of them carry chat
text: `"ep":"NPU","ed":"NPU",...,"npu":"HTP0",...,"therm":"FAST"`. The `hn`/`hg` fields still carry float
noise (`41.30000305175781`). [scratchpad/agents/s23-search-gate-8b89c094/REPORT.md]

**Learning governor:** M4 (app `647bee72`), M6 (replay, lab `0cd92b4c`) and M7 (learned store, app
`e7684925`, no decision change) are done. M5, the logit-oracle check of NPU vs GPU prefill, comes before
M9; its S23 port is in progress in `scratchpad/agents/s23-oracle-m5/`. The expected verdict, stated before
the run: FAIL R2 with about 95% same-top, as on SM8850. The merged step plan is
`scratchpad/agents/learning-governor/LEARNING-MERGE.md` (M5 at line 603, the oracle at section 4).

### Engine

**Done (2026-10-08; merge 904d38fad):** The b11514 merge and its audit fixes are recorded on engine main. The hostile merge audit is on file. [archived/PLAN-2026-10-16-full.md:240-249; scratchpad/agents/onecopy-three-legs/audit-merge-b11514-n2.md:1-6]

**Open:** Carry the owner-approved fixes through the vendor, APK, and device verification chain. [/Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-governor-params.cpp:333-359; /Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:534-539]

### GPU numerics

**Done (audit dated 2026-09-23):** The q4_K small-batch _cok accumulator fix is recorded in engine main. [scratchpad/agents/cok-accumulator-audit/REPORT.md:3,5-8; archived/PLAN-2026-10-16-full.md:253]

**Open:** It is not shippable until an app-shaped control/treatment, tail-speed run, decode check, and exact final APK chain are verified. [archived/PLAN-2026-10-16-full.md:253-259; scratchpad/agents/cok-accumulator-audit/REPORT.md:250]

### Desktop / kalsa-brain

**Done (2026-10-08):** The b11514 merge has macOS and Windows checks recorded. [scratchpad/agents/onecopy-three-legs/b11514-mac-checks-904d38fad.md:1-3; scratchpad/agents/onecopy-three-legs/b11514-windows-checks.md:1-3; archived/PLAN-2026-10-16-full.md:263-267]

**Open:** Verify the publication state of the `Version 0.0.6` commit on branch `brain`. [kalsa-brain commit 7ca211b4] The engine stderr allowlist remains flagged by review. [/Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:543-548]

### App / UX

**Done (2026-10-15):** The S23 cut-four check found governor-off session save/load and cached reuse working. [/Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:524-526]

**Open:** With the governor on, snapshot save/load errors are mislabeled as save_error/load_error instead of governor_mode. The Xiaomi in-app prewarm also logged save_error. [/Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:524-526; scratchpad/agents/xiaomi-inapp-npu-2026-10-15/REPORT.md:18-21]

### Privacy (2026-10-16)

**Done:** an egress census of desktop, phone and servers sits behind the privacy roadmap (kalsa-brain
`fd2bd6bb`). Web search asks once, at the first search and before the query leaves, naming the
provider: phone `c648c94a` + `772ee31a` (a cancelled or timed-out turn never sends), desktop `587f2560`
(branch `brain`, unreleased; it ships with 0.0.7 when the owner decides). The phone search gate no
longer blocks ordinary requests (app `90d541f3`, `8b89c094`, `85a3f6fc`); S23 on `8b89c094`: "Cerca sul
web le notizie di oggi su Samsung" searched, `blockedPrivacy:0`. Report Worker `556e6768` scrubs what a
reader would decode. [/Users/marco/Projects/kalsa-brain/dev/egress-2026-10-16/E-phone.md; /Users/marco/Projects/kalsa-brain/dev/egress-2026-10-16/E-servers.md; scratchpad/agents/s23-search-gate-8b89c094/REPORT.md]

**Open:** phone `web_fetch` reaches the network without any notice; a forced text-only round still
executes a text-dialect tool call (S23 round 2, `toolChoice:"none"`, `web_fetch` executed); phone-originated
desk-mode searches bypass the desktop notice; the consent-prompt P2s and the report Worker's accepted
limits. [scratchpad/agents/s23-search-gate-8b89c094/REPORT.md; /Users/marco/Projects/kalsa-brain/docs/BACKLOG.md, section "Phone log report, web-search notice, report Worker"]

### LlamaService split

Owner decision (2026-10-15): split `src/engine/LlamaService.ts` by mapping it first, then making
one reviewed cut at a time with an S23 check, coordinated with the governor work. Cuts 1–4 have
landed as app commits `4f571791`, `8c5ecb02`, `b03e4b10`, and `3fa9da9b`. The cut-4 S23 check
confirmed session save/load and cached reuse with the governor off; governor-on snapshot errors
still need classification. [/Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:522,524-526; app commits 4f571791, 8c5ecb02, b03e4b10, 3fa9da9b]

Open cuts: secondary engine jobs; static prefix prewarm; prompt/message builders; split
`streamAssistantTurn`; split `initEngine`. [(owner, 2026-10-16, chat)]

### iOS / Metal

**Done (2026-10-02):** The engine comparison on an M1 Max Mac is recorded. [scratchpad/agents/ios-engine-choice/REPORT.md:1-5]

**Open:** Real-iPhone performance, jetsam, and frame measurements remain unmeasured. [scratchpad/agents/ios-engine-choice/REPORT.md:1-5,226; archived/PLAN-2026-10-16-full.md:293-298]

### MoE

**Parked (2026-10-01):** The owner paused MoE until after alpha; no Runpod spend until the owner reopens it. [scratchpad/agents/kalsa-moe-design-fable/PARKED.md:1-4]

**Open:** Owner budget approval before resuming. [scratchpad/agents/kalsa-moe-design-fable/PARKED.md:1-4,31]

### Pairing

**Done (2026-09-28):** Public pairing and assetlinks endpoints returned HTTP 200 in the reachability check. [scratchpad/agents/pair-worker-reachability/2026-09-28.txt:1-15]

**Open:** No wire change without Marco; LAN direct path remains on kalsa-brain's plan. [scratchpad/agents/pair-worker-reachability/2026-09-28.txt:1-15; archived/PLAN-2026-10-16-full.md:313-316]

### Release

**Done (2026-10-09):** The phone delivery chain, provenance gate, and APK run are recorded in the archive. [archived/PLAN-2026-10-16-full.md:320-329,333-339]

**Open:** The approved governor fixes still need to pass the owner-controlled pin, provenance, APK, and device chain. [archived/PLAN-2026-10-16-full.md:320-329,333-339]

## Next steps

1. **FIX 1 — lane-only load.** When the combined GPU+NPU plan does not fit but the NPU lane alone fits, keep the NPU lane instead of dropping it. **Done 2026-10-16:** engine kalsallama `c8c128b03`, binding kalsa.rn `7cd9b79a`/`7d15f8fe`, app kalsa `7939f3ae` + `c2bffdef`. S23 verified in-app: lane_only, gpu_leg false, prefill and decode on HTP0, no OpenCL. [scratchpad/agents/s23-fix2-heat-2026-10-16/REPORT.md]

2. **FIX 2 — NPU-first prefill, GPU when the NPU zone is too hot.** **Done 2026-10-16, on:** engine `6530dadd6` (the prefill route carries the engine; layers_device names the leg) and `946daec00` (rule behind `prefill_thermal_handoff`), binding `a51ef5cc`/`f385ebdd` (zone headroom pushed once per turn, `KALSA_GOVERNOR_PREFILL_THERMAL`), app `9b3a556a` (switch on, owner 2026-10-16, knowing GPU prefill fails R2 on V75/V81) and `647bee72` (observation row: engine_prefill, prefill_ms, prefill_dev; bench knob `kalsa.bench.guard_headroom`). S23 heat loop: the rule does not fire in normal use (NPU stays >40 C from its 95 C trip when the battery reaches the 43 C stop); owner accepted keeping it as is. [scratchpad/agents/s23-fix2-heat-2026-10-16/REPORT.md]

3. Measure physical lane-only memory at the app's ctx 16384. The bench cell measured ctx 2048; the app test's ctx-16384 price is a unit-test calculation, not a physical measurement. [scratchpad/agents/xiaomi-lane-only-memory-cell-2026-10-15/REPORT.md:1-6,21-24; /Users/marco/Projects/kalsa/src/engine/governorLaneOnly.test.ts:58-75]

4. Explain Xiaomi in-app NPU decode telemetry at 7.3742767820380415 tok/s versus the bench median at 23.33 tok/s. Keep the result as an open discrepancy; the in-app turn used pacing. [scratchpad/agents/xiaomi-inapp-npu-2026-10-15/REPORT.md:24-33; scratchpad/agents/xiaomi14-3way/REPORT.md:20]

5. Resolve the Xiaomi decode ordering: the 3-way bench measured CPU 29.21, NPU 23.33, GPU 15.49 tok/s; another per-leg cell measured GPU 21.26, NPU 16.52, CPU 14.71 tok/s under different run lengths and without a cool wait. [scratchpad/agents/xiaomi14-3way/REPORT.md:20,24-25; scratchpad/agents/xiaomi-legheat-76/REPORT.md:11-18,27-31,61-65]

6. J/token has never been measured as a valid device/model/backend/phase grid. The owner deferred it on 2026-10-16. [scratchpad/agents/governor-archive-mining/SYNTHESIS.md:49-51; scratchpad/agents/q48-olmoe-q40-npu/REPORT.md:120; (owner, 2026-10-16, chat)]

7. Complete the app-shaped _cok verification before shipment. [scratchpad/agents/cok-accumulator-audit/REPORT.md:250]

8. Collect Xiaomi Stage 0 normal-use completions, then proceed to Stage 2. [archived/PLAN-2026-10-16-full.md:440-442]

9. Re-run the safety candidates with the required budget-up sample before acting on them. [archived/PLAN-2026-10-16-full.md:455-457]

10. Complete the M1 dossier with raw results, limits, and reproduction instructions. [archived/PLAN-2026-10-16-full.md:395-397]

11. Correct the app snapshot error classification and verify the user-facing error path. [/Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:526; scratchpad/agents/xiaomi-inapp-npu-2026-10-15/REPORT.md:18-21]

12. Fix the desktop engine stderr allowlist and verify the `Version 0.0.6` publication state. [/Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:543-548; kalsa-brain commit 7ca211b4]

13. Measure on a real iPhone; reopen MoE only with the owner's budget approval. [archived/PLAN-2026-10-16-full.md:293-298,302-305; scratchpad/agents/kalsa-moe-design-fable/PARKED.md:1-4]

### Restored open records

- Keep the 8 Elite board-throttle signal in the governor gap list: `sys-therm-8` reaching its trip
  raised the `gpu` cooling device while CDSP cooling stayed idle; this is a one-run correlation,
  not an ablation, and the governor does not watch that signal. [archived/PLAN-2026-10-16-full.md:145-148; scratchpad/agents/qdc-8elite-npu-long-69/REPORT.md:24-40]
- A non-native TILE32 weight can be refused with `split_failed`; treat this as a live load hazard.
  [archived/PLAN-2026-10-16-full.md:218-220; /Users/marco/Projects/llama.rn-kalsa-onecopy/vendor/llama.cpp/ggml/src/ggml-backend.cpp:1554-1562]
- q44 partial-offload constants still "need a second model/device before shipping". The 17.25B
  full-GPU-offload Xiaomi reboot with 6.7 GB free is **DO-NOT-RETRY**. [archived/PLAN-2026-10-16-full.md:184-187,195-196; scratchpad/agents/q16-xiaomi/REPORT.md:396-403,413-417]
- QRD8750 reached 48 C after the app went to TOP_SLEEPING, with no telemetry; a stall was not ruled
  out. [archived/PLAN-2026-10-16-full.md:385-387]
- Meter still needs a `run-as` debuggable bench APK; that tracked build is owed for ship.
  [archived/PLAN-2026-10-16-full.md:376-377]
- Keep the second-device S23 J(1) cell at the app's context open. [/Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:539]
- Keep the remaining backlog items open:

  | ID | Open issue | Source |
  |---|---|---|
  | H1 | Shared campaign restore can force-stop a live app after an adb drop. | BACKLOG-LOW-PRIORITY.md:54-56 |
  | H2 | Reconnects duplicate logcat lines and can count duplicates as progress. | BACKLOG-LOW-PRIORITY.md:57-58 |
  | H3 | mDNS parsing expects two fields, while adb 37 emits three. | BACKLOG-LOW-PRIORITY.md:59-60 |
  | H4 | The EXIT trap force-stops the app during teardown. | BACKLOG-LOW-PRIORITY.md:61-62 |
  | H5 | Unknown PID rounds abort without a per-serial reconnect path. | BACKLOG-LOW-PRIORITY.md:63-65 |
  | H6 | An executed tool call can end without another round; the harness waits 600 s then force-stops the healthy app. | BACKLOG-LOW-PRIORITY.md:88-92 |
  | E3 | A latched COOLMODE can run at duty 1.0 after platform status cools; revisit if G2 shows a re-escalation sawtooth. | BACKLOG-LOW-PRIORITY.md:66-69 |
  | E4 | Pacing duty reports requested delay, not actual sleep. | BACKLOG-LOW-PRIORITY.md:70-71 |
  | E5 | Bench start/full validation needs both flags; `--battery-temp` lacks an upper bound. | BACKLOG-LOW-PRIORITY.md:72-74 |
  | E6 | WARN wording and two integration-test cases disagree with the actual SEVERE/min-duty behavior. | BACKLOG-LOW-PRIORITY.md:75-77 |
  | B8 | Native-only resends can use stale app battery input for COOLMODE state. | BACKLOG-LOW-PRIORITY.md:78-82 |
  | B9 | `failure_reason()` exposes a string that decode may assign while JSI reads it. | BACKLOG-LOW-PRIORITY.md:83-84 |
  | B10 | A resolved headroom symbol can be reported available even when reads stay NaN. | BACKLOG-LOW-PRIORITY.md:85-87 |

  [archived/PLAN-2026-10-16-full.md:344,362-368; BACKLOG-LOW-PRIORITY.md:54-92]

## Open owner decisions

- Owner-suspended: vision lazy loading (mmproj eager); ciswire window counted in characters;
  catalog gate threshold. Records: `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md`,
  `archived/PLAN-2026-10-16-full.md:464-466`.
- Learning governor: continue from Stage 0 into Stage 2 after the Xiaomi normal-use collection; the owner still has a repeat-cell decision before Stage 3. [archived/PLAN-2026-10-16-full.md:418-425,440-442]
- Confirm whether the app interface should be redone from scratch while keeping only the palette. [archived/PLAN-2026-10-16-full.md:458-460]
- Approve the MoE budget before resuming. [scratchpad/agents/kalsa-moe-design-fable/PARKED.md:1-4,31]
- Resolve beta signing, assetlinks, CI gate, and APK-size scope. The existing APK-size target is an estimate, not a measurement. [archived/PLAN-2026-10-16-full.md:461-463]

## Unverified

- `Version 0.0.6` is a version commit on branch `brain`; external publication is not established by the local record opened here. [kalsa-brain commit 7ca211b4]

## Where the record lives

- scratchpad/agents/<cell>/: per-cell preregistration, scripts, raw data, and report.
- analysis/: dated findings and contracts.
- archived/: frozen history and full living-document snapshots.
- PLAN.md: rules, status, next steps, owner decisions.
- docs/ALIVE.md: measured state.
- root BACKLOG-LOW-PRIORITY.md and scratchpad/BACKLOG-LOW-PRIORITY.md: triaged audit leftovers.
- scratchpad/COORDINATOR-STATE.md: cross-session state.
- REPOS.md in the app repo: authoritative checkout map. [archived/PLAN-2026-10-16-full.md:49-64,469-483]
