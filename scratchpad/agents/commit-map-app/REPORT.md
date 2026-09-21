# Commit map — `Aspis0/kalsa` (the app), 2026-09-04 → 2026-09-21

Auditor: Explorer, read-only. Method: `git log`/`git show`/`git for-each-ref`, `git cherry`,
`git diff-tree`, `git grep` over every local and remote ref of this worktree
(`/Users/marco/.paseo/worktrees/1vffp1wo/s23-repack-timing`, `git remote` =
`https://github.com/Aspis0/kalsa.git`). Every claim below carries a hash or a `file:line`.

## 0. Method, scope, and three caveats read before anything else

**Caveat 1 — the clone is shallow.** `git rev-parse --is-shallow-repository` → `true`; the single
shallow boundary is `a5ae74bc781155c20ad1590383fb01bbe152859d` (`.git/shallow`, one line). Every
"root commit" and every missing merge base below is a graft artifact of that boundary, not a fact
about the repository. Any statement of the form "X contains Y" is limited to the commits present
locally; I did not fetch.

**Caveat 2 — the branch the mission names is not the checked-out branch.** The mission says the
worktree is on `qwen-repack-policy`. It is not: `git rev-parse --abbrev-ref HEAD` → `s23-repack-timing-2026-09-21`
at `964dd53`. `qwen-repack-policy` is a separate local branch at `fc3627d` (it is an ancestor of
neither nor by the current branch; both are two commits ahead of `origin/main` and share `964dd53`).

**Caveat 3 — three divergent lines live in the same repo.** `origin/main`, `origin/brain` (a Tauri/Rust
desktop app: top-level `Cargo.toml`, `src-tauri/`, `crates/`, `chat/`) and `origin/chat` (the Vite UI
line that `brain` builds on). The shallow graft makes `origin/brain` and `origin/chat` look unrelated
to `origin/main` (`merge-base` = none locally); the real shared ancestor is below the shallow
boundary. I report them, and I keep them out of the app-line totals.

### The universe I checked, and why

- **Mainline (the mission's ~370).** Non-merge commits reachable from `origin/main`, `--since=2026-09-04`:
  **368** = 354 `Marco Gualtieri` + 14 `kalsa-orchestrator`. The mission's exact figure (356 + 14 = 370)
  is `qwen-repack-policy`'s ancestry, which is `origin/main` plus `964dd53` and `fc3627d`; those two
  are counted in the branch list below.
- **Branch-unique on app-line branches** (commits on a branch that also contains `origin/main`):
  `main` 3, `app-integration-2026-09-20` 12, `qwen-repack-policy` 2, `s23-repack-timing-2026-09-21` 1,
  `kv-hold-protocol`/`kv-residuals` 4, `kv-hold-budget` 2, `qwen-think-in-history` 4,
  `protocol-abc` 2, `baseline-67c73d26c` 1, `origin/wip/ciswire-corpus` 1, `kv-land` 1 genuinely
  new patch (25 of its 26 are patch-equivalent to mainline; `git cherry -v origin/main kv-land`).
- **Divergent lines:** `origin/brain` 232 (207 Marco + 25 crescent), `origin/remote-brain` 184
  (183 Marco + 1 Saurias92), `origin/chat` 25 (crescent). Counts are "not reachable from
  `origin/main`" and are inflated by the shallow graft.
- **Duplication is large.** 117 subjects appear on both mainline and side branches; the governor
  bring-up on 09-04 exists as two hashes per commit (e.g. `c5c55a4`/`3e4de20`, `803b499`/`0b9490b`,
  `f98a9fa`/`3451346`, `523f5e3`/`ef8a10e`). They are rebases/cherry-picks, not independent work.

The full grouped list of all 368 mainline commits is the **coverage table in §4**; every commit
appears there exactly once. Branch-unique and divergent-line commits are in **Appendix A** and
**Appendix B**. Nothing was dropped.

---

## 1. Answer first

### What the three weeks of commits mostly were

1. **The energy / T20C measurement campaign and its audits (the largest single block, 42 energy
   commits + 8 bench-oracle + the campaign tests).** Instrumentation was built, audited, repaired,
   re-audited: a 1 Hz power/clock sampler (`c5fae2f`), a per-phase prefill/decode disaggregator
   (`572d3be`, `f936c16`), a CodeCarbon-compatible schema (`2dbc9a9`), a core-placement sweep
   (`da3192e`), and repeated hostile audits (`c08b9d6`, `3712f2b`, `36832c0`, `791d3c2`, `f2f9ea1`).
   The headline result is not a speed-up; it is that most claims were found **not shippable** and
   were corrected.
2. **The KV / session / restore correctness block (SESSION 25 + KV 20 + PREFILL 18 + CONTEXT 17 +
   PROTOCOL 9 ≈ 89 commits).** Hashed persistable history (`f0862e6`), hybrid save/load alignment
   (`c498639`, `b889991`), the pre-warmed static prefix persisted and restored (`235444f`, `f62272b`),
   the window ceiling-slide (`8a2579c`, `244c6c0`, `e2d6ae4`), the emission-source provenance field
   (`56facf7`), and the ciswire char-3-gram recall leg (`e0d1836`).
3. **Engine pin and fork plumbing (ENGINE-PIN 22).** The migration from a vendored
   `vendor/kalsallama-cpp/` tree plus `patches/llama.rn+0.12.8.patch` to the binding fork's own
   `vendor/` layout (`0fc723b`, `38b5cf0`, `50b8196`), and a long pin-bump ladder for the Android
   engine (`5a15067` … `bad7b89`).
4. **Governor bring-up and thermal safety (GOVERNOR 34 + THERMAL 8 + BATTERY-ETA 3).** The governor
   runtime, native thermo bridge, per-generation correctness gate, and the C3 OS-thermal hard gate.

The remainder: UI/i18n 17, memory 16, docs-only 15, lifecycle 14, CI 10, chat store 8, documents 7,
models 5, telemetry 5, tools 4, routing 3, search 2, hygiene 1.

### The three biggest accomplishments

1. **The session/restore contract became testable and mostly correct.** `f0862e6` hashes
   persistable history on save and load; `c498639` aligns hybrid save/load and clears KV flags on a
   failed restore; `b889991` refuses inconsistent hybrid saves; `da5582d` compares the native save to
   `lastChatNPast`; `d3959aa`/`202e364` restore interrupted turns and G1 chats. On the device side,
   `d934eb0` fixed the re-send defect that had blocked T20C for a week, and `docs/KV-WINDOW-AND-THERMAL-2026-09-17.md:1-20`
   records a real Galaxy S23 run: 6 sends, 6 `KALSA_SEND`, zero duplicates.
2. **The engine path stopped being a hand-patched tree.** `38b5cf0` deletes `native/kalsallama.pin`
   and the patch road; `0fc723b`/`50b8196` move the app onto the fork's `vendor/` layout;
   `5a15067` pins `95c3493b`, the pin at which the q4_K MoE OpenCL kernels build again. The installed
   tree confirms it: `node_modules/llama.rn/vendor/VERSIONS` names `LLAMA_CPP_COMMIT=8537d097`,
   matching the plan's claim.
3. **The thermal hard gate shipped and is provably fail-open.** `2113bfe` adds the C3 hard gate;
   `platformThermalStatus.ts:73-82` and `useThermalHardGate.ts:51-96` gate on the OS severity, not
   on an untyped Celsius value, and never block when the API is missing.

### What was NOT done (relative to the plan)

- **G2 is not claimed** (PLAN, "Where the schedule stands on 2026-09-21"); M1 is not done. Nothing in
  these 368 commits claims either.
- **No governor defect 5.1/5.2/5.3 fix exists.** No commit sends `t_idle_valid`
  (`native/GovernorBatteryModule.kt:62-66`, live on `origin/main`); the parser default is still
  `false` (`src/engine/governorInputs.ts:166`). The order-of-work items 1–3 in the device plan are
  untouched.
- **The governor is off by default and has never been proven to engage on a device.**
  `LlamaService.ts:2235` reads the AsyncStorage toggle; the key is written only by
  `SettingsScreen.tsx:499-504`. No commit in the window carries a device log of an engaged governor.
- **The NPU lane stays dead:** `npu_lane_enabled: false` hard-set at `governorInputs.ts:139`.
- **No voice commits at all** in the window (`git log origin/main --since=2026-09-04 -- src/voice` → 0).
- **The S23 repack timing run still waits for an unplugged device** (PLAN, Open items), and the
  `0288dc27` pin bump sits unmerged on `app-integration-2026-09-20`.

---

## 2. Area-by-area map

Short status per plan area, then the commits. "Proven on device" means a committed artefact or a
documented device run exists; otherwise the result is code + tests only. The plan-area crosswalk is
approximate by construction: one commit can serve two areas, and each commit is listed once under
its primary group.

### Session and restore (SESSION 25, CHAT-STORE 8)

**What it accomplished.** History persistence by content hash, hybrid save/load alignment, a
recovery path for interrupted turns, and the pre-tool `.kvs` restore point after a tool turn
(`a36074e`). `095466e` derives engine identity from native build inputs and `e2e09f5` binds the
saved KV to model file and engine build, so a stale KV cannot be restored onto a different engine.
`f4e1b17`–`b6a1cd7` make the chat store non-shrinking and quarantine unreadable raws.

**Device proof.** Partial. `docs/KV-WINDOW-AND-THERMAL-2026-09-17.md:1-29` is an S23 unplugged run;
`185d254`'s body reports 6 independent `KALSA_KVDIVERGE` records; `23c2117` and `4d2f6fb` were each
fixed after a real device run found the verdict blind. The `device-restore-out` evidence is gitignored
and not in the tree, so most of this is code + tests, verified once on device on 2026-09-17.

**SESSION**

- `809d191` (09-19) fix(context): keep KvCacheProfile a leaf so the session harness typechecks
- `9b08ae0` (09-18) fix(engine): tighten session privacy guard
- `f781042` (09-18) fix(engine): redact session stems in telemetry
- `9308793` (09-18) fix(engine): make session eviction reporting honest
- `d15fba3` (09-18) fix(app): the switch catch releases the chat gen too, and sync invalidation is restored
- `4acc10c` (09-18) fix(chat): preservation means THIS raw, stale writes adopt nothing, and the .kvs waits for the write to land
- `185d254` (09-18) test(device): the verdict was blind to the session KV, which is half the question
- `02d5348` (09-17) test(device): make the restore protocol exercise the foreground re-kick, and judge it
- `a3aca53` (09-17) test(memory): restore the facts-tail harness and put it where CI can see it
- `4c5553f` (09-17) fix(prewarm): close the restore window at the native load, not at the call site
- `0b3d4bb` (09-17) fix(prewarm): guard the KV before the restore replaces it, not after
- `235444f` (09-17) feat(engine): persist the prewarmed static prefix, restore it instead of recomputing
- `5de99f3` (09-17) fix(session): unbreak the harnesses the calibration change red-lined
- `4f0370e` (09-17) fix(session): the disk gate demanded 4.5x the truth and could never unlearn it
- `d3959aa` (09-12) fix(session): restore interrupted turns that still have visible text
- `202e364` (09-12) fix(session): restore G1 chats that lack modelEmittedText
- `da5582d` (09-12) fix(session): compare native save to lastChatNPast, not nCtx
- `f0862e6` (09-12) fix(session): hash persistable history on save and load
- `c498639` (09-11) fix(session): align hybrid save/load; clear KV flags on failed restore
- `b889991` (09-11) fix(session): refuse inconsistent hybrid KV saves; EMA 5 samples
- `b85e775` (09-10) fix(engine): replay think via reasoning_content; restore hybrid KV prefix
- `2619db0` (09-10) fix(session): hash load prompt-env the same way as save
- `095466e` (09-10) fix(session): derive engine identity from native build inputs
- `e2e09f5` (09-10) fix(session): bind the saved KV to the model file and the engine build
- `a36074e` (09-09) feat(session): keep the pre-tool .kvs prefix as a warm restore point after a tool turn; feed prefill speed

**CHAT-STORE**

- `c45f044` (09-18) fix(chat): the quarantine sweep matches slot hashes, not the whole prefix
- `b6a1cd7` (09-18) fix(chat): declarations die with the visit, deletion sweeps what the index forgot, and no callback fires twice
- `1e54b1d` (09-18) fix(chat): an unreadable raw is announced, deletion is index-based, and the turn cannot hang on a KV promise
- `3fcb85a` (09-18) fix(chat): the guard now tracks message identity, not counts — and preserves before it refuses
- `f4e1b17` (09-18) fix(chat): a history write may never shrink the store — unreadable raws are quarantined, not overwritten
- `753a8ef` (09-17) fix(chat): stop serving the first turn's reasoning as the answer
- `c906727` (09-10) fix(chat): show sheet Copy for non-empty text; withhold decode EMA for 3 samples
- `c370c98` (09-10) feat(chat): add Regenera on the assistant action sheet

### KV cache (KV 20, PREFILL 18)

**What it accomplished.** The emission-source field on every message (`56facf7`, `81618cc`,
`379e833`), the frozen pre-upgrade hash projection (`99344d9`), the pre-warm path that persists and
restores the static prefix instead of re-prefilling it (`235444f`, `f62272b`, `57bad0c`, `899f355`),
and the ciswire KV-cache measurement harness with the char-3-gram dense leg (`e0d1836`, `f81cec9`,
`e7712de`).

**Device proof.** The harness is a device script (`scripts/device-ciswire-cache.sh`); the actual
Xiaomi ciswire recall run is still pending per the PLAN roadmap item 1. The window-slide cost was
measured on the S23 (`9bd5d0d` body; `docs/KV-WINDOW-AND-THERMAL-2026-09-17.md`). Otherwise tests.

**KV**

- `2ba2ba8` (09-18) docs(kv): name the frozen-hash scope and the count helper's exit status
- `dadd5c3` (09-18) test(kv): the removal detector accepts bracket-carrying receivers
- `b261c63` (09-18) ci(kv): actually land the jest/harness step split
- `503c343` (09-18) ci(kv): the 15-minute bound moves to the jest step; the harness step stays unbounded
- `4ea5bef` (09-18) ci(kv): the jest step that guards main is bounded at 15 minutes
- `99344d9` (09-18) test(kv): freeze the pre-upgrade projection — flag-free records hash as 204298f hashed them
- `fec0f0d` (09-18) test(kv): the emissionSource semantics return to jest — the matrix, the budget, the echo
- `723d313` (09-18) test(kv): the emissionSource audit sees removals, and reads each writer's own region
- `1b5a9a9` (09-18) fix(kv): the settle wait measures seconds, and its log survives the run
- `1dd84db` (09-18) docs(kv): the SIGPIPE captures show three classes of kick, not one
- `89dfee8` (09-18) ci(kv): jest joins the push-to-main gate
- `559711d` (09-18) fix(kv): the settle wait must not read its capture through a grep -q pipe
- `81618cc` (09-18) fix(kv): compactor carries emissionSource — the audit caught its own absence
- `99f8c91` (09-18) test(kv): the hash round-trip fixture must not reconcile by trimming
- `56facf7` (09-18) feat(kv): record where an emission came from — emissionSource on the message
- `379e833` (09-18) fix(kv): load applies the save path's own emission policy
- `5fb1bfa` (09-18) test(kv): pin the two shapes the suite only looked like it covered
- `bc6bd22` (09-18) fix(kv): seed the think tag only when the emission does not already carry it
- `7b5b79b` (09-18) fix(kv): the history was missing the one token the template seeds
- `8ec99c9` (09-18) docs(kv): record that little-core generation was already half-attempted

**PREFILL**

- `be1696a` (09-20) fix(ci): read KV reuse from KALSA_KVPREFIX — the engine bump retired the line we parsed
- `f4d79b9` (09-17) fix(prewarm): facts-in-system and the static prefix prewarm cannot coexist
- `0ec90cc` (09-17) fix(prewarm): make the foreground handler say why it did not re-kick
- `4c6b041` (09-17) test(device): count the prefix hash miss — the failure the verdict could not see
- `ac01f2e` (09-17) fix(prewarm): bind the budget key once, and refuse to call a failed capture a measurement
- `ee285fa` (09-17) feat(prewarm): stop paying a full prefill for a prewarm that will never land
- `f0e4e2b` (09-17) fix(prewarm): re-kick the prefix on foreground — the contract promised it, nothing did it
- `3a504a6` (09-17) fix(prewarm): re-queue once after learning a template needs the filler
- `899f355` (09-17) fix(prewarm): recognise the refusal Qwen's template actually raises
- `f4b28d6` (09-17) test(e2e): record what the prewarm actually did, and the engine's own prefix match
- `57bad0c` (09-17) fix(prewarm): stop appending a filler turn that costs the whole prefix
- `f62272b` (09-17) feat(window): re-warm the static prefix after a slide instead of re-prefilling it
- `c029807` (09-17) fix(native): let a cleared cache reuse the system prefix it already computed
- `b6c2104` (09-15) wip(engine): checkpoint prefix measure and slide marker
- `c4d3f6f` (09-14) fix(engine): the n_ctx ceiling must price the static prefix
- `88152e1` (09-12) fix(engine): one unprefixed KV heal per engine hold
- `1d22dd1` (09-11) fix(engine): keep anchored KV prefix; short think on calc turns
- `e168b4a` (09-09) fix(prewarm): do not gate success on prompt_ms — dense models never sync perf counters at n_predict=0

### Prefill/decode routing (CONTEXT 17, ROUTING 3, plus governor routing)

**What it accomplished.** Context size and KV-cache quality became user-selectable (`6fc94e9`,
hardened by `4c4bb10`); the window slides at the `n_ctx` ceiling on purpose (`8a2579c`), prices the
static prefix (`c4d3f6f`) and dense content (`24c2e3e`, `ff6a7c0`), and re-warms the static prefix
after a slide (`f62272b`). Per-model thinking budgets chosen by measured decode speed (`acade04`,
`899e76b`), and the first-turn-reasoning-as-answer defect fixed (`753a8ef`).

**Device proof.** `24c2e3e`/`ff6a7c0` are **unpushed** on local `main`; no device run is recorded for
the token-aware slide. The slide itself was priced on the S23 (`b9f51c8` body). Mostly code + tests.

**CONTEXT**

- `e0d1836` (09-19) feat(context): ciswire recalls dropped turns via the char-3-gram dense leg
- `4c4bb10` (09-19) fix(context): harden context-size + KV-cache choice against two hostile audits
- `6fc94e9` (09-19) feat(context): let the user choose context size and KV cache quality
- `2bec6fa` (09-19) fix(context): the app could load a context too small to hold a conversation
- `bf9156c` (09-19) fix(context): pin the anchored floor's edge, and state its limit
- `8a6e409` (09-19) fix(context): keep the last exchange when a long turn exceeds the rebuild target
- `76d1a97` (09-18) build(engine): llama.rn e8505ca2 — the MTP draft context stops dying on a cache it cannot share
- `6412e6f` (09-17) test(device): close the kick window on the kick's outcome, not on a stopwatch
- `e2d6ae4` (09-17) fix(window): the slide re-warm must never be able to fail the turn
- `a6794ed` (09-17) docs: the state-checkpoint machinery we ship, and the slide that deletes it
- `b9f51c8` (09-17) campaign: price the window slide, do not just prove it correct
- `244c6c0` (09-15) fix(engine): retain adopted window boundary
- `07dee2e` (09-15) docs(moe): record window-slide root cause
- `8a2579c` (09-14) fix(engine): slide the window at the n_ctx ceiling, on purpose
- `f441b3d` (09-13) fix(engine): keep ciswire JS window aligned with live KV
- `c7801f9` (09-11) fix(engine): clamp off-mode window to live KV start
- `33502b2` (09-09) feat(documents): gate full_context on the phone's prefill budget, not only on context size

**ROUTING**

- `899e76b` (09-10) fix(thinking): nPredict 2048 for the 512/1024 budgets, harness guard updated
- `acade04` (09-10) feat(thinking): budget per model chosen by measured decode speed
- `f77ea7b` (09-09) fix(prompt): answer in the language the user writes in, locale only as fallback

### Tools (TOOLS 4)

**What it accomplished.** The typed tool registry (`2de4abd`), the `write_note` tool (`e697d33`),
`web_fetch` egress gating (`17c6afc`), and the `toolchoice=none` paths that also drop tools from the
system prompt and KV prewarm (`1ec63a0`, `19b67b6`).

**Device proof.** None found in the window; tests only. `19b67b6` is a bench-harness guard.

**TOOLS**

- `edc6c2d` (09-19) t20c-jelly: mark tool-round telemetry invalid + lock tool flags to 0
- `e811754` (09-16) fix(telemetry): a model-invented tool name must not reach a committed log
- `e697d33` (09-05) feat(notes): B4 — write_note tool for AI-created markdown notes
- `2de4abd` (09-05) refactor(tools): B6 — typed tool registry and safer add-tool DX

### Documents / voice (DOCUMENTS 7, VOICE 0)

**What it accomplished.** Real PDF text extraction and share-to-Kalsa intents (`5707cfe`),
language-of-the-user answering (`4b29466`), `full_context` gated on the phone's prefill budget
(`33502b2`), and `documentChatTool.ts` split into 15 modules (`5fb7711`).

**Device proof.** None in the window. No voice work at all.

**DOCUMENTS**

- `87afd45` (09-17) docs(repos): llama.rn is not dead, the app has six branches, three clones share one remote
- `84f6195` (09-13) fix(engine): do not digest-share while native chat KV is live
- `5fb7711` (09-09) refactor(documents): split documentChatTool.ts into 15 modules, no behaviour change
- `4b29466` (09-09) fix(documents): tell the model to answer in the user's language, not the document's
- `f5da438` (09-09) docs: archive every historical document under archived/; two living docs remain in kalsa-moe-experiments (PLAN, ALIVE)
- `5707cfe` (09-09) fix(documents,share): real PDF text extraction, lenient doc selection, share-to-Kalsa intents
- `aa12471` (09-05) fix(documents): export isDocumentUnreadable for rebuild gate

### Memory scheduling (MEMORY 16)

**What it accomplished.** Extraction budgeted by measured speed and aborted by the next send
(`e455afc`), cancellation forwarded to extraction (`f99fe45`), facts ranked by timestamp
(`accf9db`), the extraction cap derived from the injection cap (`7b6ef0a`), the dead system-prompt
builder deleted (`5a8d6a8`), and sensitive facts stored locally with egress blocked (`b28294b`).

**Device proof.** Harnesses exist (`memoryFactsTailHarness.mjs`); no device run of the memory path is
recorded in the window.

**MEMORY**

- `904991e` (09-17) fix(memory): build the extraction prompt in one pass — user text was rewriting it
- `7b6ef0a` (09-17) refactor(memory): derive the extraction cap from the injection cap
- `accf9db` (09-17) fix(memory): rank deferred facts by timestamp — the day label was dropping the newest
- `5a8d6a8` (09-17) fix(memory): delete the dead system-prompt builder, and stop Settings quoting it
- `dbc568f` (09-17) build: llama.rn at the fork's audited head (engine 134a35cf2, rn-* rewired for its memory and mtmd APIs): the first engine update
- `b9a2eca` (09-14) copy(memory): say that facts already in past chats stay
- `2f2b09a` (09-11) fix(engine): re-apply baked facts; heal wiped tails with one cold prefill
- `31495c3` (09-11) fix(engine): snapshot live chat KV before memory extract
- `f99fe45` (09-10) fix(memory): forward chat cancellation to extraction
- `3ca6145` (09-10) fix(lifecycle): native background timer and trim-memory bridge for the dispose grace
- `e455afc` (09-10) fix(memory): extraction budgeted by measured speed, aborted by the next send
- `0b75254` (09-09) perf: fail fast on stalled generation, memory admission on cold load, background dispose grace
- `e7aa0c6` (09-05) fix(privacy): F3 — document egress filter + echo-of-memory-fact test
- `e93e804` (09-04) feat(memory): B1-C — inline edit for saved facts
- `6c6ca56` (09-04) feat(memory): B1-B — clearer Memory settings UX
- `b28294b` (09-04) fix(privacy): B1-A′ — store sensitive facts locally, block egress

### Lifecycle / background (LIFECYCLE 14)

**What it accomplished.** A local Expo module `kalsa-lifecycle` with a native background timer and
trim-memory bridge (`3ca6145`, `1e02fe3`), dispose grace for the idle engine (`cb1d92d`), stall
recovery and watchdogs moved off suspended timers (`c45fd1f`), the idle net made incapable of
beating the engine's own watchdog (`41e9372`), and bounded model-switch dispose (`1807aad`).

**Device proof.** `c45fd1f`'s message says the dispose grace "never fired on device", which is why
the native module exists; the fix itself is code + tests. `1e02fe3` is a build fix (blanket `android/`
ignore).

**LIFECYCLE**

- `9abb4e9` (09-18) fix(app): the dispose IIFE's finally now arms at the top of the body
- `edcc43e` (09-17) test(device): name why a foreground re-kick stopped, instead of calling it silent
- `ecc0c08` (09-17) build: engine id binds the installed tree; from-source is the only variant
- `9643db1` (09-16) fix(engine): bound the auxiliary native calls no watchdog was covering
- `854cd50` (09-16) test(app): cover the foreground-idle wiring, not just its predicate
- `8509619` (09-15) docs(moe): record foreground idle debug build
- `c37b419` (09-15) fix(app): preserve active foreground generation
- `91d7b73` (09-14) fix(engine): drop rate stall; 45s gap is the hang detector
- `96d3d06` (09-13) fix(engine): do not rate-stall a live think at 1.8s gaps
- `5abdafa` (09-13) fix(engine): stall 45s think gap; do not wipe live chat KV
- `e8c8886` (09-13) fix(engine): do not wipe or idle-unload live chat KV
- `cb1d92d` (09-12) fix(app): dispose idle engine without skipping background unload
- `1807aad` (09-10) fix(engine): bound model-switch dispose so a hung stop cannot freeze the UI
- `1e02fe3` (09-10) fix(lifecycle): commit the Android sources of kalsa-lifecycle (blanket android/ ignore swallowed them)

### UI (UI 17, BATTERY-ETA 3)

**What it accomplished.** The A1 leaf-fold drawer (`f9d4f75`), the battery ETA slope under the chat
model bar (`68e2d76`) and its audit fixes (`47cb83a`), the C3 thermal copy in EN/IT, the C7 copy, the
C6 miniapp templates, and accessibility testIDs for the device harness (`e89bd2a`).

**Device proof.** The miniapp path has screenshots/testIDs; the dev harness exists. Display-only.

**UI**

- `3431db4` (09-10) fix(session): evict other-model KV first; testID drawer rows
- `e89bd2a` (09-10) chore(a11y): testIDs and button semantics on message actions (more/copy/edit) for the device harness
- `9d3db10` (09-06) fix(i18n): C6d — qualità not qualidade
- `a310f99` (09-06) fix(i18n): C6d — Italian empty-state copy (no PT nenhuma)
- `869c28d` (09-06) fix(miniapp): C6d — restore block titles + IT copy
- `3c9e2a3` (09-06) fix(miniapp): C6d — reuse planner glass cards for timeline/quality/citations
- `d5008e3` (09-06) fix(miniapp): C6c — F5 slot/block size caps reject oversized
- `b56d5bc` (09-06) fix(miniapp): C6c — slot docs, icons, checklist/pros_cons polish
- `2fdaef4` (09-06) feat(miniapp): C6c — N-question quiz + kpi/checklist/pros_cons templates
- `c26ad2f` (09-06) fix(miniapp): C6b - prompt steers create_miniapp; tighten builders
- `f659bda` (09-06) feat(miniapp): C6b — create_miniapp tool + builders
- `8e788ec` (09-06) fix(miniapp): C6 — compile, i18n, template mount
- `ab6f4a0` (09-05) feat(miniapp): C6 — prompt types, templates, requiresAi, bio cleanup
- `5d8b2eb` (09-05) fix(i18n): clarify Italian thermal hard-gate unload copy
- `7ea2f28` (09-05) fix(i18n): polish EN/IT thermal and orphan copy
- `9c46a34` (09-05) fix(i18n): C3 — Italian thermal copy
- `f9d4c75` (09-04) feat(ui): A1 leaf-fold drawer — origami menu from settings

**BATTERY-ETA**

- `00a3846` (09-18) fix(campaign): preserve battery hard abort on unknown status
- `47cb83a` (09-05) fix(battery): C7 — audit F1–F6 ETA/charging/epoch
- `68e2d76` (09-05) feat(battery): C7 — slope ETA under chat model bar

### Telemetry (TELEMETRY 5)

**What it accomplished.** Session stems redacted (`f781042`), session privacy guard tightened
(`9b08ae0`), the conversation kept out of logcat (`4553062`), model-invented tool names kept out of
committed logs (`e811754`), deterministic embed progress (`1edf5c6`), and the Worker origin moved to
`telemetry.kalsa.io` (`213850e`, on `app-integration`).

**Device proof.** Telemetry guard tests only; no end-to-end device telemetry receipt in the window.

**TELEMETRY**

- `4553062` (09-16) fix(native): stop publishing the user's conversation to logcat
- `5fd704c` (09-16) fix(harness): the telemetry guard was testing a build from six days ago
- `1edf5c6` (09-10) chore(embed): add deterministic progress telemetry
- `17c6afc` (09-05) fix(privacy): B3 — gate web_fetch sensitive URL/query egress
- `826fe50` (09-04) feat(engine): add greedy bench sampling telemetry

### Engine pin and fork plumbing (ENGINE-PIN 22)

**What it accomplished.** See §3.3 for the pin ladder. The structural change is the move off the
flattened `vendor/kalsallama-cpp/` tree and `patch-package` onto the fork's `vendor/` layout
(`0fc723b`, `38b5cf0`, `50b8196`), plus `engine-build-id.js`/`engineIdentity` deriving the engine id
from real build inputs (`ecc0c08`, `ed1994e`, `52f88b3`), and the provenance gate (`7e3197b`,
`24e53e1`).

**Device proof.** Proven in CI and by the installed tree (`node_modules/llama.rn/vendor/VERSIONS`);
the app-side pin bumps are build-time, not device claims.

**ENGINE-PIN**

- `50b8196` (09-19) refactor(engine): port the app to the vendored engine layout, drop native/bmoe
- `bad7b89` (09-19) chore(engine): bump llama.rn pin to the vendor-migration tip [skip ci]
- `5a15067` (09-19) build(engine): pin llama.rn 95c3493b — the q4_K MoE OpenCL kernels build again
- `10194d9` (09-18) build: llama.rn at fada1ebe (the cpu params the dropped CLI layer used to resolve; -1 and 0 both safe)
- `cb10497` (09-18) build: llama.rn at 4126b729 (iqp.cpp reaches the flatten, the vendored hash sources reach the target)
- `86febd3` (09-17) build: llama.rn at da845d16 (reasoning_budget_end is a vector of token sequences at this pin)
- `58f5db4` (09-17) build: llama.rn at the fork head that builds (engine 70b4302bb: the OpenCL blocks the 2026-09-04 merge left open, the jsi API drift, the version headers)
- `92001b3` (09-17) fix(bmoe): arm() to the load_mode enum -- pin 134a35cf2 removed common_params.use_mmap
- `f39c757` (09-17) build: llama.rn at the fork's step-1 commit (engine 67c73d26c) for the binary-equivalence build
- `52f88b3` (09-17) build: engine id covers every build input the Android engine reads
- `ed1994e` (09-17) build: engine id excludes build output for real and covers the JS bridge
- `ad7ff7d` (09-17) fix(engine): the overlay allow-list never learned about nine upstream files
- `0fc723b` (09-17) build: llama.rn comes from the Aspis0 fork; no overlay, no patch-package
- `4cf44d8` (09-17) build: re-sync the vendored tree to the bumped pin (CI was red on my bump)
- `c4d23be` (09-17) build: bump kalsallama pin to 134a35cf2 (871 commits, incl. upstream cherry-picks)
- `7e3197b` (09-16) feat(scripts): detect a hand-edited vendored engine at source level
- `7f9fcc4` (09-16) chore: point the kalsallama pin at main
- `4004117` (09-14) fix(native): refuse llama.rn ctx_shift that halves hybrid KV
- `8be587c` (09-10) fix(patch): repair llama.rn hunk header so patch-package can parse
- `e6d6aa0` (09-09) native(llama.rn): synchronize before reading perf counters in the completion result
- `c4c5280` (09-07) build: bump kalsallama pin to 67c73d26c (f32 product in the Adreno q4_0 and q4_K GEMMs)
- `8a56edc` (09-05) build: bump kalsallama pin to e31b9144c (perf reset clears async timing)

### Tests and CI (TESTS 25, CI 10, PROTOCOL 9)

**What it accomplished.** 18 orphan harnesses wired into CI (`f4dbfa0`), a push-to-main jest gate
(`89dfee8`, `87b36f8`), the 15-minute bound moved off the harness step (`503c343`, `b261c63`), the
engine provenance gate (`7e3197b`), overlay-includes/build gates (`2e1ba1c`, `da7106c`, `c0a7162`),
and protocol timing pins on a virtual clock (`7a06c25`, `fe588e0`, `ff1389c`).

**Device proof.** CI is code; the device harnesses (`device-restore-protocol.sh`,
`restoreVerdict.mjs`, `prefixPrewarmHarness.mjs`) are the device-facing half and were run once on the
S23 on 2026-09-17. The T20C campaign scripts are the device driver.

**TESTS**

- `e7712de` (09-19) test(device): make the ciswire harness robust on slow devices [skip ci]
- `f81cec9` (09-19) test(device): add the ciswire KV-cache measurement harness + ignore build/scratch
- `f14b0c0` (09-19) fix(campaign): strengthen two identity selftests to assert the refusal, not just its message
- `8456ddf` (09-19) fix(campaign): a malformed deviceModel switched off the check it asks for
- `9c6601b` (09-19) fix(campaign): bind the run to the phone the config names
- `be401ba` (09-19) test(campaign): derive T20C evidence dir and refuse foreign configs
- `398a186` (09-18) test(campaign): route T20C harness by configured device
- `7d607c8` (09-18) test(campaign): pin completion progress backstop
- `429cd92` (09-18) test(engine): lock eviction decision boundaries
- `038baa2` (09-18) docs(campaign): name the conversation dump that c63a952's subject overstated
- `23c2117` (09-18) test(device): the first real run found the verdict counting two cycles as one
- `4d2f6fb` (09-18) test(device): the verdict could not see the failure it exists to catch
- `e677fc8` (09-17) test(device): watch the temperature DURING a cycle, not only between cycles
- `079b0a3` (09-17) test(device): print reuse and prompt time per cycle, and defer the threshold
- `b5d8b87` (09-17) test(device): tell a one-time identity change from a cache that is broken
- `8e11f14` (09-17) test(device): a broken run must exit non-zero, and a run without markers must not start
- `07c2e94` (09-17) test(device): stop the re-kick verdict passing work that never happened
- `c1951a8` (09-17) test: revive the two orphan harnesses that rotted while nobody ran them
- `d934eb0` (09-17) campaign: stop re-sending a turn the engine already started
- `9bd5d0d` (09-16) fix(campaign): a Hermes bundle cannot be content-checked, so stop pretending
- `2d46737` (09-16) fix(campaign): verify the JS that actually runs, not the JS we assume
- `90f25f0` (09-16) feat(campaign): count truncated answers, and refuse to score what a build cannot report
- `1f4b5c3` (09-16) feat(campaign): compute the T20C verdict instead of grepping for it
- `0bfe985` (09-16) fix(campaign): prove Metro bundle provenance
- `bbc9442` (09-14) chore: never publish the CisWire campaign captures

**CI**

- `5429799` (09-20) fix(ci): print the turn's reuse number again, labelled when it is not size-matched
- `f6283d2` (09-18) docs(ci): the keystore this comment pointed at is not in the repo, and its advice deletes measurements
- `87b36f8` (09-18) ci: from this merge on, a red jest makes main's e2e red
- `3cabcf1` (09-18) fix(gate): say what the engine's ndk property really is, and raise the floors to today's counts
- `8f12450` (09-18) fix(gate): the temp log used a BSD mktemp spelling the Linux runner rejects
- `da7106c` (09-18) build(gate): parse the OpenCL blocks, follow the engine's own NDK pin, and report the failure
- `2e1ba1c` (09-18) build(gate): the includes gate parses with the NDK clang, and a missing compiler is a failure
- `50edd14` (09-18) ci: the harness I wired could never have run on the CI's Node
- `f4dbfa0` (09-17) ci: wire the 18 orphan harnesses — no self-checking harness runs nowhere now
- `e5f8335` (09-05) ci: F2 — typecheck+jest gate on push to feat/**

**PROTOCOL**

- `7a06c25` (09-18) test(protocol): the timing pins run on a virtual clock — the pass-count race is gone
- `fe588e0` (09-18) test(protocol): the shared-deadline fixture expires at a fixed pass, not a wall window
- `7114626` (09-18) test(protocol): pin the warn-once log gate; name its mid-run limitation
- `ff1389c` (09-18) test(protocol): the shared-deadline pin discriminates by pass count, not wall time
- `643aacc` (09-18) test(protocol): the wait-shell driver models rp_main's successful setup
- `aa70675` (09-18) fix(protocol): a broken protocol log warns once; the shared stderr silence is named
- `afb81dd` (09-18) privacy(protocol): the conversation never touches disk; fatal_state truncates texts
- `ec6aed1` (09-18) test(protocol): pin all three terminal ops, the shared deadline, and floor-based timing
- `bb731b1` (09-18) fix(protocol): the settle budget validator closes overflow and octal

### Governor / thermal / battery (GOVERNOR 34, THERMAL 8, BATTERY-ETA 3)

**What it accomplished and what it did not.** Detailed in §3.2 and §3.4. The app-side governor is a
parameter builder and a thermo reader; the policy itself lives in the binding fork (`scripts/governor-params-test.cpp`
is the only governor `.cpp` in the app tree). The C3 OS-thermal hard gate is the only thermal
control that actually blocks work.

**GOVERNOR**

- `38b5cf0` (09-18) chore(engine): delete the old road — one source, one gate, no patch-package
- `92189ed` (09-16) chore: drop the duplicate PLAN/ALIVE copy; the lab repo is canonical
- `90b8e05` (09-16) docs: record the governor finding and correct two earlier claims
- `41e9372` (09-16) fix(app): make the idle net incapable of beating the engine's own watchdog
- `c45fd1f` (09-16) fix: restore stall recovery, route engine watchdogs off suspended timers
- `523f5e3` (09-08) governor: enable the GPU prefill route on V75 (owner decision on ALIVE 60)
- `07a279b` (09-07) Merge feat/moe-stream into feat/governor-in-app
- `c8d137e` (09-06) build: bump kalsallama pin to 3bec271fd (governor on opencl picks + Adreno non-contiguous src0 gate, 750 MUL_MAT 925/0)
- `7e3d6d6` (09-06) build: bump kalsallama pin to 9c28322ac (bench_force_gpu_prefill lever)
- `79c04a9` (09-06) governor: map SM7675/SM8635 to V73, pass bench_force_gpu_prefill (bench lever; V73 stays allowlisted off)
- `55008c3` (09-05) feat(thermal): C3 — summer-aware advisory bands + governor hint type
- `f44c36f` (09-05) refactor(engine): F4 — add kvBytesPerToken:6656 to lfm2.5-2.6b (governor-measured)
- `f98a9fa` (09-05) feat(governor): per-generation GPU-prefill correctness gate (V75 off until the 750 f16-batched defect is handled)
- `0265333` (09-05) build: bump kalsallama pin for per-turn prefill route reset
- `0517dc2` (09-05) build: bump kalsallama pin for Wait prefill degradation
- `e8c2b1f` (09-05) fix(governor): clear KV and skip sessions
- `64931c1` (09-05) fix(governor): report prefill timing and route facts
- `ac4820d` (09-04) build: bump kalsallama pin to e1a0f5028 (chunked governor prefill)
- `803b499` (09-04) fix(governor): send gpu_prefill_measured for V75/V79; truthful prewarm result
- `fcaf0df` (09-04) fix(governor): admit safe final prefill tails
- `db1606c` (09-04) fix(governor): shouldUseMTP returns false in governor mode instead of throwing
- `c5c55a4` (09-04) fix(android): correct ReactPackage import in GovernorBatteryModule
- `04ba9a9` (09-04) build: bump kalsallama pin to e131345b7 (governor init failure reason)
- `2646e77` (09-04) fix governor native bridge diagnostics
- `4df562d` (09-04) harden governor fallback and turn telemetry
- `1c4b142` (09-04) fix governor device probes and fit gate
- `81bcaf2` (09-04) wire governor runtime and thermo inputs
- `05ad253` (09-04) add governor thermo native bridge
- `74390c5` (09-04) fix governor fallback logging and reload cleanup
- `42ddcf4` (09-04) normalize governor init fallback stage
- `1766cd3` (09-04) document governor post-load convergence
- `b3a6137` (09-04) fix governor owner failure and thermo paths
- `67c9f7f` (09-04) feat: add governor owner and context routing
- `414b494` (09-04) build: overlay governor v0.3 sources

**THERMAL**

- `cf1220c` (09-18) test(campaign): cover completion expiry and thermal trends
- `00a0d10` (09-18) fix(campaign): make thermal recovery stop-safe
- `59e30ca` (09-18) fix(campaign): enforce thermal hard aborts
- `05f1c21` (09-18) fix(campaign): survive thermal throttling in T20C
- `e108d0e` (09-17) test(device): the owner settled the thermal stop at 44.0 C
- `2cdbc14` (09-17) test(device): stop the restore protocol on the owner's thermal rules, and state its verdict
- `2113bfe` (09-05) feat(thermal): C3 — hard gate on OS CRITICAL unloads LLM
- `cc22682` (09-05) fix(thermal): C3 — address advisory nits

### Other engine-core and residual commits (ENGINE-CORE 30, MODELS 5, SEARCH 2, DOCS-ONLY 15, HYGIENE 1)

These are the engine/app fixes that are not KV, session, prefill or governor by name: the disk/space
and warm-cache eviction machinery around model loading (`4b82f78`, `4daaa6f`, `2fdae47`, `d3639a6`,
`f6f07ae`, `4537177`, `c4e3e95`, `bcfdb9a`, `a526b7b`), the model-switch lock/throw paths
(`9c4c2a3`, `d15fba3`, `0eaa090`, `9abb4e9`), truncated-answer observability (`5398805`), and the
residual docs. No device artefact exists for these beyond the T20C run; they are code + tests.

**ENGINE-CORE**

- `c7e3f9c` (09-18) refactor(engine): the delete-authorizing disk decision had no test that could reach it
- `9f96a45` (09-18) fix(engine): preserve older qwen think spans
- `a526b7b` (09-18) fix(engine): make eviction outcomes explicit
- `bcfdb9a` (09-18) fix(engine): make space eviction reflect current disk state
- `c4e3e95` (09-18) fix(engine): handle exact disk gate equality
- `4daaa6f` (09-18) fix(engine): the space eviction pays at most the measured deficit and only when it can cover it — and a negative free reading can no longer authorize deletion
- `2fdae47` (09-18) fix(engine): the audit's eight findings — the disk gate now frees space before failing, the marker cannot lie about its regime, and the pool total is visible
- `4b82f78` (09-18) feat(engine): the pool's one destructive operation now leaves a marker, and a save can no longer evict another model's warm cache
- `0eaa090` (09-18) fix(app): log a failed model switch before rethrowing — the rethrow reaches no handler
- `9c4c2a3` (09-18) fix(app): selectModel releases the switch lock if the tail throws
- `ccaddd7` (09-18) fix(engine): fourth-pass audit — comments now assert only what the code proves, the selection clear is awaited
- `4537177` (09-18) fix(engine): the fit branch passes the decider's reason through, the gate runs after acquisition, and the retry advice stops lying
- `d3639a6` (09-18) fix(engine): six audit fixes — the marker now survives only a death, refusals stop claiming causes the code does not know
- `f6f07ae` (09-18) fix(engine): the load path now runs the same fit gate as the send path, and a death marker catches the kills fit cannot predict
- `c0a7162` (09-17) build: make the gate parse what the build compiles — main does not build
- `24d86c1` (09-17) fix(native): drop the cold-cache checkpoint branch — it destroys what it reads
- `5398805` (09-16) feat(engine): make a truncated answer observable, and name it for what it is
- `34b44f0` (09-14) fix(engine): the assemble boundary is a fact, not a promise
- `1dd07e1` (09-14) fix(scripts): let device-preflight pick a serial in a two-phone lab
- `2bbef14` (09-14) fix(engine): allow 15 min no-EMA prefill after APK-upgrade KV mismatch
- `a21746e` (09-14) fix(engine): live KV assemble start is 0, not leftover digest B
- `7aabfe8` (09-14) fix(engine): do not inject ciswire digest while live KV is held
- `9151f78` (09-14) fix(engine): 180s min prefill deadline when EMA is missing
- `32dfe3c` (09-14) fix(engine): never treat a returned completion as empty KV
- `b907290` (09-13) fix(engine): drop KV hold only after native clear succeeds
- `94dd4e5` (09-13) fix(engine): drop last-save KV hint on native-empty paths
- `d39fa51` (09-12) fix(engine): length-1 bake rematch sticks to the previous last user
- `e925608` (09-09) fix(embed): log [embed] done and the error on the job exception path
- `f692062` (09-09) quality: allow llama-server binary and port overrides via env (KALSA_LLAMA_SERVER, KALSA_QUALITY_PORT)
- `659a644` (09-05) fix(bench): read __DEV__ via isDevBuild for Node harness tsc

**MODELS**

- `07cacea` (09-18) fix(registry): the default model is LFM2.5-2.6B, not Qwen3.5-4B — a fallback a 7 GB phone cannot hold is not a fallback
- `7836db7` (09-09) feat(models): MiniCPM5-2B Q4_K_M opt-in dev catalog entry + one-time sha256 verification
- `bd8e4e9` (09-05) fix(models): F1 — merge orphan Keep set across prompts
- `92632a7` (09-05) refactor(models): F1 — orphan sweep becomes detect-only migration
- `7b71d18` (09-05) refactor(models): C1+C2 — data-driven catalog and RAM recommendations

**SEARCH**

- `070b5f9` (09-05) feat(semantic): B5 — E5 Option D tests and safe index rebuild
- `15ee404` (09-04) feat(search): B2 chat search — debounce, tail blob, highlights

**DOCS-ONLY**

- `a34d7f7` (09-17) docs: correct the KV cost - 6656 B/token, already quantized, not 29.2 KB/token
- `59e0e2a` (09-17) docs: say in the index that the living docs are not in this repo
- `de53b6b` (09-17) docs: record the 2026-09-17 run, and retract the LFM2 recurrent claim
- `a43e74a` (09-17) docs(engine): the n_ctx comments pointed away from the real behaviour
- `c6a0d6f` (09-16) docs(engine): the save duration was measured all along
- `a53b884` (09-16) docs: add REPOS.md, the map of the five repositories
- `1c1d806` (09-16) docs: record the one-branch-per-repo cleanup
- `775a56a` (09-16) docs: record the NPU salvage and the test-backend-ops build defect
- `9e93be6` (09-15) docs: final n-gram verdict — no for the app, with numbers
- `119b30b` (09-15) docs: correct provenance of the n-gram speculative types
- `c6e2376` (09-15) docs(moe): record verified debug build
- `283675d` (09-09) docs: §7.45 measured after the v2b repair; MiniCPM5 @256 bare-'>' budget gap
- `dfa8f45` (09-09) docs: §7.44 verified on device with e168b4a
- `5e149f6` (09-09) docs: HARNESS_FINDINGS §7.41-7.45 (product track 2026-09-09) and KALSA.md state line
- `332aeed` (09-09) docs: add the chat-optimisation proposal (owner plan, rev 2, 2026-09-09)

**HYGIENE**

- `2ed2a88` (09-18) chore(git): ignore device output as a class, name the five dirs that are evidence

### Energy measurement (ENERGY 42, BENCH-ORACLE 8)

**What it accomplished.** The T20C/energy framework: 1 Hz sampler (`c5fae2f`), per-phase
disaggregation (`572d3be`, `f936c16`, `95cf975`), shared schema + CodeCarbon export (`2dbc9a9`,
`2964da5`), emulation/awake fixes (`40ca30d`, `f343179`), core-placement sweep (`da3192e`,
`279b9a0`, `686fc63`), and the n-gram speculative A/B (`fcf9172`, `48eec64`) with a final negative
verdict (`9e93be6`). The audit trail is unusually complete: `c08b9d6`, `3712f2b`, `36832c0`, `791d3c2`,
`f2f9ea1`, `63a809e`.

**Device proof.** Yes, with declared limits. `device-v3-out/`, `device-sweep-pilot-out/`,
`device-s23-out/`, `device-ngram-spec-out*/` are committed device datasets; `docs/ENERGY-FRAMEWORK-STATUS.md`
and `docs/S23-ENERGY-BLOCKER.md` declare the residual blockers. The audits repeatedly push the claims
back below what the data supports.

**ENERGY**

- `9bdec94` (09-16) fix(energy): gate the prefill-slope fit on leverage, not on R-squared
- `c7b9261` (09-16) docs: reconcile final T20C and energy handoff
- `4d69e42` (09-16) docs: restore energy recovery details
- `5221650` (09-16) docs: refresh stale energy findings
- `0efea91` (09-16) docs: update energy framework index and status
- `40ca30d` (09-16) fix(energy): hold device awake per arm and invalidate dozed blocks
- `9780366` (09-16) bench(energy): core-placement pilot — the little-cluster lever fails on latency
- `791d3c2` (09-16) docs(energy): preserve the sweep flip-check (SHIP) — fixes F1-F5, no collisions
- `279b9a0` (09-16) fix(energy): gate sweep frontier on placement evidence
- `686fc63` (09-16) fix(energy): record placement from inside the wrapped CLI command
- `4dc7baa` (09-16) fix(energy): close sweep instrument audit gaps
- `c08b9d6` (09-16) docs(energy): hostile audit of the sweep instrument (NO-SHIP)
- `da3192e` (09-16) feat(energy): add core placement sweep instrument
- `3879c4c` (09-16) bench(energy): S23 cold run — sampler blocked by SELinux; framework data exists
- `6a9e0c8` (09-16) docs(energy): correct Jelly campaign claims
- `343179e` (09-16) fix(energy): charge-check baseline arm
- `3712f2b` (09-16) docs(energy): hostile audit of the v3 campaign (NO-SHIP at claim level)
- `b3a4fed` (09-16) bench(energy): stamped v3 Jelly dataset — 3 back-to-back runs, raw data + report
- `f2f9ea1` (09-16) docs(energy): preserve the round-2 flip-check and round-3 micro flip-check audits
- `662509f` (09-16) docs(energy): S23 released to us at 23:30; hold it until the Jelly dataset clears
- `c1c6653` (09-15) test(energy): number phase splitter fixtures
- `c1cb693` (09-15) fix(energy): close phase splitter flip residuals
- `708499f` (09-15) fix(energy): close phase stamp audit findings
- `36832c0` (09-15) docs(energy): hostile audit of the 2a phase-stamp commit (SHIP, F1-F9)
- `522903c` (09-15) bench(energy): phase-stamp sidecars + schema v3 three-bucket split
- `27c4260` (09-15) docs(energy): fix the Next-steps numbering after the F3 addendum
- `2cd8a47` (09-15) docs(energy): F3 addendum — the Android affinity lever exists and was already measured
- `b2a5891` (09-15) docs(energy): record the provisional slowdown reading rule for 2b
- `63a809e` (09-15) docs(energy): 2b self-audit (NO-GO as proposed) + revised plan
- `0d06ee0` (09-15) docs(energy): framework status/recovery doc + session artifacts
- `8a16ddf` (09-15) docs(energy): G99 per-phase baseline findings
- `f88a961` (09-15) docs(energy): audit R4 note fixes (N1, N4, N5, N6)
- `cc612ef` (09-15) fix(energy): publish decode coverage (audit R1-R6)
- `e50772f` (09-15) ci(energy): wire energy harnesses into bench/apk workflows (audit F9)
- `95cf975` (09-15) fix(energy): anchor decode phase to rep end; counts manifest, guards, cadence honesty (audit F1-F8)
- `f936c16` (09-15) bench(energy): skip *.phases.csv in aggregate; unlock per-phase numbers with exact token counts
- `572d3be` (09-15) bench(energy): per-phase (prefill/decode) energy disaggregation tool
- `2964da5` (09-15) bench(energy): audit fixes F1-F13 (schema provenance, export completeness, silent-failure hardening)
- `2dbc9a9` (09-15) bench(energy): shared schema module + CodeCarbon-compatible emissions export
- `ce0eb32` (09-15) bench(energy): fix pkill self-match that killed every campaign sampler
- `c84f48d` (09-15) bench(energy): fixes from deepseek audit (F1-F5, F7, F8)
- `c5fae2f` (09-15) bench(energy): 1 Hz power/clock sampler for the Jelly campaign

**BENCH-ORACLE**

- `48eec64` (09-15) bench(ngram): first-pass verdict + tuned pass support (PURE/COPY, SPEC_EXTRA)
- `fcf9172` (09-15) bench(ngram): device A/B harness for the fork's n-gram speculative types
- `8269aa2` (09-06) bench: return a Promise from stopCompletion (restore the JS contract broken in 8b6d548)
- `8b6d548` (09-06) bench: restore llama_synchronize in the oracle hook and keep steps with no logits visible instead of truncating
- `1cf865a` (09-06) bench: guard the logit-oracle hook against null logits and exhausted forced ids (SIGSEGV on the GPU-prefill arm)
- `19b67b6` (09-06) bench: toolchoice=none also drops tools from the system prompt and the KV prewarm; guard structured execution
- `1ec63a0` (09-06) bench: toolchoice=none drops tools from the completion and skips the fallback parser
- `28424c3` (09-06) bench: raw pre-sampler top-N probs + forced-id sequence (logit oracle, bench-only)

---

## 3. The numbered answers

### 3.1 Who does what, and what is proven on a device

| Plan area | Commits | Result | Proven on device? |
|---|---|---|---|
| Session and restore | 25 + 8 chat-store | hashed history, hybrid save/load, interrupted-turn recovery, pre-tool `.kvs` restore point | **Partial**: one S23 run, `docs/KV-WINDOW-AND-THERMAL-2026-09-17.md`; evidence dir gitignored |
| KV cache | 20 | emissionSource, frozen hash projection, persisted pre-warm prefix, ciswire recall leg + harness | **Partial / pending**: harness is device-facing; the Xiaomi ciswire run is still a PLAN roadmap item |
| Prefill/decode routing | 17 context + 3 routing | user-selectable ctx/KV, ceiling-slide, static-prefix pricing, per-model think budgets | **No** for the unpushed token-aware slide; the earlier slide was priced on S23 |
| Tools | 4 | tool registry, `write_note`, egress gating, `toolchoice=none` | No device artefact in window |
| Documents / voice | 7 / 0 | PDF extraction, language, budget-gated `full_context` | No; no voice work at all |
| Memory scheduling | 16 | measured-speed extraction budget, cancellation, fact ranking, local-only sensitive facts | No device artefact; harnesses only |
| Lifecycle / background | 14 | `kalsa-lifecycle` native timer + trim bridge, dispose grace, watchdog routing | **Partial**: `c45fd1f` states the grace never fired pre-fix on device |
| UI | 17 + 3 battery ETA | drawer, battery ETA, thermal copy, miniapp, a11y testIDs | Display/harness; screenshots for miniapp only |
| Telemetry | 5 | redaction, logcat privacy, embed progress, Worker origin | No device receipt artefact; guard tests |
| Engine pin / fork | 22 | vendor-layout migration, pin ladder, engine id from build inputs, provenance gate | Build-time/CI; installed tree confirms `8537d097` |
| Tests / CI | 25 + 10 + 9 protocol | orphan harnesses wired, push-to-main jest gate, provenance/build gates, virtual-clock timing | CI is code; device harnesses run once on S23 2026-09-17 |
| Governor / thermal | 34 + 8 + 3 | params + thermo bridge, per-generation gate, C3 hard gate | **No**: no engaged-governor device log; hard gate is OS-driven and fail-open |
| Energy | 42 + 8 | sampler, per-phase split, schema, placement sweep, n-gram A/B | **Yes, with declared limits**: committed device datasets + audits |

### 3.2 The governor in the app

Every commit that touches the governor, its Settings toggle, or the battery module. Hashes are on
`origin/main`; side-branch duplicates are noted in the table where they exist.

| hash | date | what it changes | what it serves |
|---|---|---|---|
| `414b494` | 09-04 | overlays governor v0.3 sources, pin `8665e9a9` | governor bring-up |
| `67c9f7f` | 09-04 | adds governor owner + context routing | governor bring-up |
| `b3a6137` | 09-04 | fixes governor owner failure and thermo paths | defects |
| `1766cd3` | 09-04 | documents governor post-load convergence | docs |
| `42ddcf4` | 09-04 | normalizes governor init fallback stage | fallback |
| `74390c5` | 09-04 | fixes fallback logging and reload cleanup | fallback |
| `05ad253` | 09-04 | adds the native thermo bridge (`GovernorBatteryModule.kt`) | device plan 1.1/1.3 |
| `81bcaf2` | 09-04 | wires governor runtime + thermo inputs (`governorRuntime.ts`, `governorInputs.ts`) | governor bring-up |
| `1c4b142` | 09-04 | fixes device probes and fit gate | device plan 0.4 |
| `4df562d` | 09-04 | hardens fallback and turn telemetry | defects |
| `2646e77` | 09-04 | native bridge diagnostics | defects |
| `04ba9a9` | 09-04 | pin `e131345b7` (init failure reason) | engine pin |
| `c5c55a4` | 09-04 | corrects the `ReactPackage` import in `GovernorBatteryModule.kt` | battery module |
| `db1606c` | 09-04 | `shouldUseMTP` returns false in governor mode | routing |
| `fcaf0df` | 09-04 | admits safe final prefill tails | defects (5.5 family) |
| `803b499` | 09-04 | sends `gpu_prefill_measured` for V75/V79 | device plan 0.3 |
| `ac4820d` | 09-04 | pin `e1a0f5028` (chunked governor prefill) | engine pin |
| `64931c1` | 09-05 | reports prefill timing and route facts | telemetry |
| `e8c2b1f` | 09-05 | clears KV and skips sessions | KV interaction |
| `0517dc2`, `0265333`, `8a56edc` | 09-05 | pins for Wait degradation, per-turn route reset, perf reset | engine pin |
| `f98a9fa` | 09-05 | per-generation `GPU_PREFILL_CORRECT` gate, V75 off | device plan 0.2 |
| `7b71d18` | 09-05 | data-driven catalog + RAM recommendations | governor input |
| `f44c36f` | 09-05 | `kvBytesPerToken:6656` for LFM2.5 | device plan 0.4 |
| `7e3d6d6` | 09-06 | pin `9c28322ac` (`bench_force_gpu_prefill` lever) | engine pin |
| `79c04a9` | 09-06 | maps SM7675/SM8635 to V73, passes the bench lever | device plan 0.1 |
| `c8d137e` | 09-06 | pin `3bec271fd` (governor on OpenCL picks) | engine pin |
| `523f5e3` | 09-08 | **enables** V75 GPU prefill (owner decision) | device plan 0.2 |
| `c4c5280` | 09-07 | pin `67c73d26c` (f32 product) | engine pin |
| `55008c3`, `cc22682` | 09-05 | C3 advisory bands + governor hint type | thermal |
| `90b8e05` | 09-16 | records the governor finding, corrects two claims | docs |
| `41e9372` | 09-16 | idle net cannot beat the engine watchdog | lifecycle |
| `775a56a` | 09-16 | records the NPU salvage and test-backend-ops defect | docs |
| `9643db1` | 09-16 | bounds auxiliary native calls no watchdog covered | lifecycle |
| `5a15067` | 09-19 | pin `95c3493b` (q4_K MoE OpenCL builds) | engine pin |
| `235444f` | 09-17 | persists the pre-warmed static prefix | prefill |
| `8540472` | 09-20 | corrects stale model/engine/branch facts | docs (app-integration) |

Duplicates: `3451346`=`f98a9fa`, `55c68a8`=`79c04a9`, `ef8a10e`=`523f5e3`, `3e4de20`=`c5c55a4`,
`0b9490b`=`803b499`, `b57af0f`=`4df562d`, `f05dccf`=`1c4b142`, `4443f71`=`81bcaf2`,
`2797b90`=`05ad253`, `d3f1d99`=`74390c5`, `a7f2f7b`=`42ddcf4`, `8da4bc3`=`1766cd3`,
`f413c6c`=`b3a6137`, `094ece4`=`67c9f7f`, `f384c66`=`04ba9a9`, `85719d8`=`ac4820d`,
`29b84a8`=`64931c1`, `ac7ed23`=`e8c2b1f`, `623407a`=`db1606c`, `a28b17a`=`fcaf0df`.

**Defect 5.2, reproduced from the app side.** `native/GovernorBatteryModule.kt:40-71` is `readThermo`.
It reads `EXTRA_TEMPERATURE`, `EXTRA_PRESENT`, `EXTRA_LEVEL`, `EXTRA_SCALE`, `EXTRA_PLUGGED` and
returns exactly four fields plus a validity flag:

```
:62  val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
:63  result.putInt("battTempTenthsC", temperature)
:64  result.putInt("battLevelPct", percent)
:65  result.putBoolean("plugged", plugged)
:66  result.putBoolean("sensorValid", present && temperature > 0)
```

It never sends `t_idle_c` and never sends `t_idle_valid`. On the JS side
`src/engine/governorInputs.ts:166` does `const idleValid = Boolean(input.t_idle_valid)`, and
`undefined` becomes `false`; `ThermoProfile.t_idle_valid` is optional (`governorInputs.ts:34-35`).
In the fork's native parser the same default is `false` (`cpp/rn-governor-params.cpp:86`, referenced
by the device plan) and `profile_is_valid` requires it when `plugged`, so `plugged = true` ⇒
`Invalid` ⇒ `Abort` ⇒ sticky `failed = true`. **The omission is still live on `origin/main` and on
`app-integration-2026-09-20`; `git diff origin/main HEAD -- native/GovernorBatteryModule.kt` is empty
and the file's only window history is `05ad253`, `1c4b142`, `c5c55a4`, `c45fd1f` — none of which adds
the field.** The fix named in the plan (send real idle temperature, or stop requiring it on the
plugged branch, and make `failed` non-terminal) has not been attempted in the app.

**What the app can measure today, and what it merely displays.**

- Measures: battery temperature in tenths °C, level %, plugged, sensor validity
  (`GovernorBatteryModule.kt:57-66`); high-rate `current_uA` and `charge_counter_uAh` with
  per-property validity status (`GovernorBatteryModule.kt:86-93,151-199`); a 1 Hz CSV trace of those
  values (`GovernorBatteryModule.kt:95-138,257-275`); battery-discharge ETA from a measured slope
  (`src/engine/batteryEta.ts`, wired at `src/app/AppShell.tsx:2757`); OS thermal severity
  (`modules/kalsa-thermal/.../KalsaThermalModule.kt:43-50`).
- Displays only: the advisory `thermal_zone0` bands (`useThermalMonitor.ts`, consumed only in
  `SettingsScreen.tsx:1046`); the `preferGpuPath` governor hint, which has **no consumer outside its
  own tests** (`thermalThresholds.ts:187`; `git grep preferGpuPath origin/main` → definition + tests);
  and the battery ETA bar.
- Present but **unused**: `src/engine/governorBatterySampler.ts` exports
  `readGovernorBatteryHighRate`, `startGovernorBatterySampling`, `stopGovernorBatterySampling`, and
  `git grep` over all of `origin/main` finds **no caller**. The high-rate power path is dead code in
  the app.
- Not measured anywhere in the app: CPU frequency caps (`scaling_max_freq`), GPU busy (`gpubusy`),
  SoC-zone temperature, per-process power. Those are the exact inputs the device plan (Part 1) names.

### 3.3 The engine pin and the fork

Files that ever carried the pin in this window: `native/kalsallama.pin` (old layout, deleted),
`package.json`/`package-lock.json` (`llama.rn` dependency), and the fork's own `vendor/VERSIONS`
(not in the app tree, but installed under `node_modules/llama.rn/`).

**Old layout, `native/kalsallama.pin` (the `branch` field moved; file deleted at `38b5cf0`):**

| commit | date | engine commit |
|---|---|---|
| `414b494` | 09-04 | `8665e9a9` |
| `04ba9a9` | 09-04 | `e131345b7` |
| `fcaf0df` | 09-04 | `6f0a33c0d` |
| `ac4820d` | 09-04 | `e1a0f5028` |
| `64931c1` | 09-05 | `6ed44f567` |
| `e8c2b1f` | 09-05 | `3a161adf` |
| `0517dc2` | 09-05 | `a6642b73` |
| `0265333` | 09-05 | `39c35bd1` |
| `8a56edc` | 09-05 | `e31b9144c` |
| `7e3d6d6` | 09-06 | `9c28322ac` |
| `c8d137e` | 09-06 | `3bec271fd` |
| `c4c5280` | 09-07 | `67c73d26c` |
| `7f9fcc4` | 09-16 | `67c73d26c` (branch → `main`) |
| `c4d23be` | 09-17 | `134a35cf2` |
| `38b5cf0` | 09-18 | file deleted (old road removed) |

**New layout, `package.json` `"llama.rn"` (fork `Aspis0/llama.rn`):**

| commit | date | binding sha | engine it declares |
|---|---|---|---|
| `0fc723b` | 09-17 | `file:///.../llama.rn-kalsa#987799a1` | — |
| `ecc0c08` | 09-17 | `987799a1` | — |
| `f39c757` | 09-17 | `4b823e95` | `67c73d26c` (binary-equivalence build) |
| `dbc568f` | 09-17 | `628f4517` | `134a35cf2` (first engine update) |
| `58f5db4` | 09-17 | `a431ef93` | `70b4302bb` |
| `86febd3` | 09-17 | `da845d16` | — |
| `cb10497` | 09-18 | `4126b729` | — |
| `10194d9` | 09-18 | `fada1ebe` | — |
| `38b5cf0` | 09-18 | `fada1ebe` | (also deletes `native/kalsallama.pin`) |
| `76d1a97` | 09-18 | `e8505ca2` | — |
| `5a15067` | 09-19 | `95c3493b` | q4_K MoE OpenCL kernels build |
| `bad7b89` | 09-19 | `0f313bab` | vendor-migration tip; **current `origin/main`** |

Fork rename: `f5be12c` (09-20, on `app-integration`) changes the dependency URL from
`github:Aspis0/llama.rn` to `github:Aspis0/kalsa.rn` at the **same** sha `0f313bab`; the npm package
name stays `llama.rn`. `96eb9d9` then moves the sha to `0288dc27`, whose only change is
`vendor/VERSIONS` plus generated version files, declaring `kalsallama@4ccef2f85` (the
`kalsa-server-v1.0.0` tag). Neither is merged.

**Current pin.** `origin/main:package.json:49` =
`github:Aspis0/llama.rn#0f313bab464ef28a58a8b4b2a37a5d4c1968b54e`. The installed tree at that pin,
`node_modules/llama.rn/vendor/VERSIONS`, declares `LLAMA_CPP_COMMIT=8537d097c32e7307d82540b6da8eb448d7e07107`.
The prepared next pin is `0288dc27` (engine `4ccef2f85`), on `app-integration-2026-09-20`, unmerged.

### 3.4 The thermal wall, from the app side

The file and lines that decide the stop:

- **Android imposes the severity.** `modules/kalsa-thermal/android/src/main/java/expo/modules/kalsathermal/KalsaThermalModule.kt:43-50`
  reads `PowerManager.getCurrentThermalStatus()`. That value is the OS's own classification; the app
  does not compute it.
- **The app turns it into a stop.** `src/engine/thermalHardGate.ts:32-34,49-51` maps Android status
  `>= 4` (CRITICAL/EMERGENCY/SHUTDOWN) to "gated"; `src/hooks/useThermalHardGate.ts:34-98` holds the
  event-driven boolean plus a foreground re-query; `src/app/AppShell.tsx` refuses at
  `:1577` (embedder), `:4005-4014` (`ensureEngineForModel` — refuses every model load) and at
  `:4657-4660` (a pre-send re-query). The gate fails **open**: `platformThermalStatus.ts:73-82`
  returns `false` on a missing/throwing API.
- **The engine decides its own thermal policy, and has no exit.** Device-plan defect 5.6: under
  CRITICAL the fork's `admit_prefill` aborts and the first decode latches `failed`; the policy lives
  in `Aspis0/kalsallama`/the binding fork, not in the app (`scripts/governor-params-test.cpp` is the
  only governor `.cpp` in the app repo). From the app side, the visible effect is the sticky failure
  and the `KALSA_GOVERNOR_FALLBACK` retry path (`governorRuntime.ts:35-80`).
- **The app's own 45-second stall watchdog is not thermal.** `src/engine/stallWatchdog.ts:15`
  (`GENERATION_STALL_GAP_MS = 45_000`), wired at `LlamaService.ts:4029-4110`; it stops a generation
  that stalls, independent of temperature.
- **The campaign harness stops on thermal rules, not the app.** `scripts/device-restore-protocol.sh:121-122`
  sets `RP_TEMP_STOP_DECI=440` and `RP_THERMAL_STOP=3`; the stop is decided at `:136-141`. That is test
  tooling. `e108d0e` records the owner's 44.0 °C choice and that 44.0 governs over the old 43.0.

So "after many turns everything stops" is **imposed by Android** (severe thermal mode), **enforced by
the app** at the three AppShell guards above, and separately **latched by the engine's governor** as
a terminal failure. The app has no control that keeps a long session alive; it has a gate that stops
new work earlier.

### 3.5 Commits that changed nothing observable

- **Two tree-empty commits**, both on the divergent lines and **not ours**: `656c18c`
  ("Round 1: Vite+React+TS skeleton…", `origin/chat`/`origin/brain`) and `d38c9c7`
  ("feat: desktop skeleton with a process supervisor", `origin/brain`) — `git diff-tree` reports zero
  files for both. Author: crescent.
- **No whitespace-only commit exists on the mainline.** I scanned all 368 with
  `git diff -w --numstat <c>^ <c>` for every commit touching ≤ 6 lines: zero commits had an
  empty whitespace-ignoring diff.
- **A fix undone by its own author, explicitly:** `8b6d548` ("restore `llama_synchronize`…") broke the
  JS `stopCompletion` Promise contract; `8269aa2` ("return a Promise from `stopCompletion` (restore the
  JS contract broken in 8b6d548)") restores it. The second names the first.
- **A policy reversed on purpose (not a no-op):** `f98a9fa` set
  `GPU_PREFILL_CORRECT.V75 = false` ("V75 off until the 750 f16-batched defect is handled"); `523f5e3`
  set it back to `true` after the owner's decision and the f32 fix. Both are real edits; the pair is a
  deliberate reversal, not a mistake, and `523f5e3` documents the accepted residual risk
  (`n=1`, q4_K unmeasured, raw oracle still FAIL on R2).
- **A bump that immediately fixed its own CI:** `c4d23be` bumped the kalsallama pin and `4cf44d8`
  re-synced the vendored tree ("CI was red on my bump").
- **Comment/documentation corrections that undo earlier text:** `a43e74a` ("the `n_ctx` comments
  pointed away from the real behaviour… Three source comments asserted things the code does not do"),
  `de53b6b` (retracts the LFM2 recurrent claim), `038baa2` (narrows `c63a952`'s subject),
  `92189ed` (drops a duplicate PLAN/ALIVE copy). These are not revert-of-revert pairs; they are the
  record correcting itself.

### 3.6 Commits whose message claims more than the diff supports

Three solid cases, quoted both sides.

**(a) `c63a952` — the subject is broader than the diff.**
Message: *"privacy(protocol): the conversation never touches disk; fatal_state truncates texts"* and
in the body *"the file no longer exists anywhere in the tree"*. The diff
(`git show --stat c63a952`) touches only `scripts/ci-lib.sh`, `scripts/device-prefill-threads.sh`,
`scripts/device-share-send.sh`. The follow-up `038baa2` states both sides exactly:
> "c63a952's subject — 'the conversation never touches disk' — was too broad … What it did NOT touch:
> this campaign family. `campaign_snapshot_messages` still writes the WHOLE conversation — user text
> and every modelEmittedText — to `$OUT/.messages.json`, a dotfile in the kept output directory,
> called from `oneTurn.sh:69` and `turn.sh:49` and :276."

`c63a952` is on the mainline (09-18 14:30); `038baa2` (09-18 14:38) is the correction.

**(b) `8269aa2` — a one-file patch described as restoring a JS contract.**
Message: *"bench: return a Promise from stopCompletion (restore the JS contract broken in 8b6d548)"*.
Diff: `patches/llama.rn+0.12.8.patch | 20 ++++++++++++++++++++`, one file. The claim is accurate as a
statement about the patch's effect, but the diff by itself cannot show the contract is restored; the
verification is in the message, not the change.

**(c) `5fb7711` — "no behaviour change" is asserted, not proven by the diff.**
Message: *"refactor(documents): split documentChatTool.ts into 15 modules, no behaviour change"*. The
diff is a pure move/split; whether behaviour is unchanged is a test claim. The companion `0def01f`
carries the same subject on a side branch. I could not run the suite here.

Related, self-documented: `a43e74a` records that three shipped source comments "asserted things the
code does not do" about `n_ctx`; `96eb9d9` asserts "59 suites, 717 tests, all pass" and gate output,
which the pin-only diff cannot show.

### 3.7 What is unmerged and unpushed right now

**Unpushed local commits (no matching remote ref):**

| branch | tip | ahead of `origin/main` | content | effect if merged |
|---|---|---|---|---|
| `main` | `ff6a7c0` | 3 | `745bf82` `CW_CORPUS` knob (dense/prose) in `scripts/device-ciswire-cache.sh`; `24c2e3e` token-aware ceiling-slide pricing (`src/context/windowProfile.ts`, +287/−2); `ff6a7c0` wires it into `AppShell`'s send guard (+89/−7) | enables the pending Xiaomi ciswire measurement and makes the window slide price dense content. **Fast-forward from `origin/main`** (`main` contains `origin/main`; `git rev-list --left-right --count origin/main...main` → `0 3`); the PLAN's "one commit ahead / `745bf82`" is now stale. |
| `s23-repack-timing-2026-09-21` | `964dd53` | 1 | disable ARM weight repack for `qwen3.5-4b` only (`ModelRegistry.ts`, `loadPolicy.test.ts`) so the Xiaomi fit gate admits the load | unblocks the qwen 4B load on the Xiaomi; must be measured (decode speed) since repack is the ARM mul_mat path. |
| `qwen-repack-policy` | `fc3627d` | 2 (`964dd53`, `fc3627d`) | `fc3627d` corrects repack-precedence docs and adds an end-to-end `loadGate` guard | pushes the qwen repack policy and its guard. **Pushed to `origin/qwen-repack-policy`, not merged.** |

**Merged-content branches (pushed or local, no unique commit vs `origin/main`):**
`anchored-floor`, `boot-loop-breaker`, `evict-marker`, `gate-ndk-app`, `governor-kv-contract`,
`kv-land-rebase-trial`, `llama-rn-cleanup`, `log-privacy`, `persist-guard`, `qwen-think-older-turns`,
`save-wiring-coverage`, `t20c-jelly`, `t20c-thermal-aware`, `step5-bump`, `pin-bump-vendor-migration`,
`llama-rn-fork`, `kv-marker-migration`. Their content is already in `origin/main`; they are bookmarks.
`kv-land` has one patch not on mainline (`e68d11a`, "ci(kv): actually land the jest/harness step
split") which mainline already carries as `b261c63` with the same subject.

**Pushed but unmerged (unique work):**

| ref | tip | ahead | what it adds |
|---|---|---|---|
| `origin/app-integration-2026-09-20` | `96eb9d9` | 12 | the fork rename to `Aspis0/kalsa.rn` (`f5be12c`), the `0288dc27` pin → engine `4ccef2f85` (`96eb9d9`), the telemetry Worker origin move to `telemetry.kalsa.io` (`213850e`), engine-provenance rename coverage (`24e53e1`, `6dd71c2`), and five docs corrections (`8540472`, `fc8a9c2`, `2377a7f`, `39f403a`, `d633cd4`). This is the "prepared and awaiting review" pin bump named in the PLAN. |
| `origin/kv-hold-protocol` / `kv-residuals` | `9a2cd9c` | 4 | device protocol waits out the boot prewarm (`9a2cd9c`), emissionSource on the message (`a44f6e0`), window budget charges the replay field (`a5389d2`), load applies the save policy (`ab5bcac`). Mainline already has close relatives (`89dfee8`, `56facf7`, `379e833`); these are the branch versions. |
| `origin/kv-hold-budget` | `a5389d2` | 2 | the last two of the above. |
| `origin/qwen-think-in-history` | `346debd` | 4 | qwen thinking-history round trips (`59349ca`, `5e600a6`, `1bd26b8`, `346debd`). Mainline carries `9f96a45` ("preserve older qwen think spans") and `b85e775`; this is the fuller branch. |
| `origin/protocol-abc` | `870b9d7` | 2 | `a0624bb` fatal-resolution-before-PASS fix; `870b9d7` exercises production key functions and corrects the privacy bound. |
| `origin/baseline-67c73d26c` | `3ce0992` | 1 | the binary-equivalence baseline (engine `67c73d26c`). |
| `origin/wip/ciswire-corpus` | `d36e3c7` | 1 | remote-only snapshot of `CW_CORPUS=prose` (duplicates local `main`'s `745bf82` intent). |

**Exists on `origin` but not locally:** `origin/brain`, `origin/chat`, `origin/wip/ciswire-corpus`.
(The `origin` symbolic ref itself, `origin/HEAD → origin/main`, is `5429799`.)

**Divergent lines.** `origin/brain` (232 commits in the window, 207 Marco + 25 crescent) is a
Tauri/Rust desktop app present in the same repo (`Cargo.toml`, `src-tauri/`, `crates/`); it has no
local branch and is unrelated to the phone app's plan areas. `origin/remote-brain` (184) is the
predecessor of `brain` (last commit 09-16). `origin/chat` (25, crescent) is the Vite UI line `brain`
builds on. Because the clone is shallow, I cannot show their true merge base with `origin/main`.
Full lists in Appendix B.

---

## 4. Coverage table — every mainline commit once

368 commits, grouped by the primary area I assigned. Plan-area crosswalk: SESSION+CHAT-STORE+PROTOCOL→
session/restore; KV+PREFILL→KV cache; CONTEXT+ROUTING→prefill/decode routing; GOVERNOR+THERMAL→
governor; TESTS+CI→tests/CI. Each commit appears exactly once.

### GOVERNOR (34)

- `38b5cf0` (09-18) chore(engine): delete the old road — one source, one gate, no patch-package
- `92189ed` (09-16) chore: drop the duplicate PLAN/ALIVE copy; the lab repo is canonical
- `90b8e05` (09-16) docs: record the governor finding and correct two earlier claims
- `41e9372` (09-16) fix(app): make the idle net incapable of beating the engine's own watchdog
- `c45fd1f` (09-16) fix: restore stall recovery, route engine watchdogs off suspended timers
- `523f5e3` (09-08) governor: enable the GPU prefill route on V75 (owner decision on ALIVE 60)
- `07a279b` (09-07) Merge feat/moe-stream into feat/governor-in-app
- `c8d137e` (09-06) build: bump kalsallama pin to 3bec271fd (governor on opencl picks + Adreno non-contiguous src0 gate, 750 MUL_MAT 925/0)
- `7e3d6d6` (09-06) build: bump kalsallama pin to 9c28322ac (bench_force_gpu_prefill lever)
- `79c04a9` (09-06) governor: map SM7675/SM8635 to V73, pass bench_force_gpu_prefill (bench lever; V73 stays allowlisted off)
- `55008c3` (09-05) feat(thermal): C3 — summer-aware advisory bands + governor hint type
- `f44c36f` (09-05) refactor(engine): F4 — add kvBytesPerToken:6656 to lfm2.5-2.6b (governor-measured)
- `f98a9fa` (09-05) feat(governor): per-generation GPU-prefill correctness gate (V75 off until the 750 f16-batched defect is handled)
- `0265333` (09-05) build: bump kalsallama pin for per-turn prefill route reset
- `0517dc2` (09-05) build: bump kalsallama pin for Wait prefill degradation
- `e8c2b1f` (09-05) fix(governor): clear KV and skip sessions
- `64931c1` (09-05) fix(governor): report prefill timing and route facts
- `ac4820d` (09-04) build: bump kalsallama pin to e1a0f5028 (chunked governor prefill)
- `803b499` (09-04) fix(governor): send gpu_prefill_measured for V75/V79; truthful prewarm result
- `fcaf0df` (09-04) fix(governor): admit safe final prefill tails
- `db1606c` (09-04) fix(governor): shouldUseMTP returns false in governor mode instead of throwing
- `c5c55a4` (09-04) fix(android): correct ReactPackage import in GovernorBatteryModule
- `04ba9a9` (09-04) build: bump kalsallama pin to e131345b7 (governor init failure reason)
- `2646e77` (09-04) fix governor native bridge diagnostics
- `4df562d` (09-04) harden governor fallback and turn telemetry
- `1c4b142` (09-04) fix governor device probes and fit gate
- `81bcaf2` (09-04) wire governor runtime and thermo inputs
- `05ad253` (09-04) add governor thermo native bridge
- `74390c5` (09-04) fix governor fallback logging and reload cleanup
- `42ddcf4` (09-04) normalize governor init fallback stage
- `1766cd3` (09-04) document governor post-load convergence
- `b3a6137` (09-04) fix governor owner failure and thermo paths
- `67c9f7f` (09-04) feat: add governor owner and context routing
- `414b494` (09-04) build: overlay governor v0.3 sources

### THERMAL (8)

- `cf1220c` (09-18) test(campaign): cover completion expiry and thermal trends
- `00a0d10` (09-18) fix(campaign): make thermal recovery stop-safe
- `59e30ca` (09-18) fix(campaign): enforce thermal hard aborts
- `05f1c21` (09-18) fix(campaign): survive thermal throttling in T20C
- `e108d0e` (09-17) test(device): the owner settled the thermal stop at 44.0 C
- `2cdbc14` (09-17) test(device): stop the restore protocol on the owner's thermal rules, and state its verdict
- `2113bfe` (09-05) feat(thermal): C3 — hard gate on OS CRITICAL unloads LLM
- `cc22682` (09-05) fix(thermal): C3 — address advisory nits

### BATTERY-ETA (3)

- `00a3846` (09-18) fix(campaign): preserve battery hard abort on unknown status
- `47cb83a` (09-05) fix(battery): C7 — audit F1–F6 ETA/charging/epoch
- `68e2d76` (09-05) feat(battery): C7 — slope ETA under chat model bar

### ENERGY (42)

- `9bdec94` (09-16) fix(energy): gate the prefill-slope fit on leverage, not on R-squared
- `c7b9261` (09-16) docs: reconcile final T20C and energy handoff
- `4d69e42` (09-16) docs: restore energy recovery details
- `5221650` (09-16) docs: refresh stale energy findings
- `0efea91` (09-16) docs: update energy framework index and status
- `40ca30d` (09-16) fix(energy): hold device awake per arm and invalidate dozed blocks
- `9780366` (09-16) bench(energy): core-placement pilot — the little-cluster lever fails on latency
- `791d3c2` (09-16) docs(energy): preserve the sweep flip-check (SHIP) — fixes F1-F5, no collisions
- `279b9a0` (09-16) fix(energy): gate sweep frontier on placement evidence
- `686fc63` (09-16) fix(energy): record placement from inside the wrapped CLI command
- `4dc7baa` (09-16) fix(energy): close sweep instrument audit gaps
- `c08b9d6` (09-16) docs(energy): hostile audit of the sweep instrument (NO-SHIP)
- `da3192e` (09-16) feat(energy): add core placement sweep instrument
- `3879c4c` (09-16) bench(energy): S23 cold run — sampler blocked by SELinux; framework data exists
- `6a9e0c8` (09-16) docs(energy): correct Jelly campaign claims
- `343179e` (09-16) fix(energy): charge-check baseline arm
- `3712f2b` (09-16) docs(energy): hostile audit of the v3 campaign (NO-SHIP at claim level)
- `b3a4fed` (09-16) bench(energy): stamped v3 Jelly dataset — 3 back-to-back runs, raw data + report
- `f2f9ea1` (09-16) docs(energy): preserve the round-2 flip-check and round-3 micro flip-check audits
- `662509f` (09-16) docs(energy): S23 released to us at 23:30; hold it until the Jelly dataset clears
- `c1c6653` (09-15) test(energy): number phase splitter fixtures
- `c1cb693` (09-15) fix(energy): close phase splitter flip residuals
- `708499f` (09-15) fix(energy): close phase stamp audit findings
- `36832c0` (09-15) docs(energy): hostile audit of the 2a phase-stamp commit (SHIP, F1-F9)
- `522903c` (09-15) bench(energy): phase-stamp sidecars + schema v3 three-bucket split
- `27c4260` (09-15) docs(energy): fix the Next-steps numbering after the F3 addendum
- `2cd8a47` (09-15) docs(energy): F3 addendum — the Android affinity lever exists and was already measured
- `b2a5891` (09-15) docs(energy): record the provisional slowdown reading rule for 2b
- `63a809e` (09-15) docs(energy): 2b self-audit (NO-GO as proposed) + revised plan
- `0d06ee0` (09-15) docs(energy): framework status/recovery doc + session artifacts
- `8a16ddf` (09-15) docs(energy): G99 per-phase baseline findings
- `f88a961` (09-15) docs(energy): audit R4 note fixes (N1, N4, N5, N6)
- `cc612ef` (09-15) fix(energy): publish decode coverage (audit R1-R6)
- `e50772f` (09-15) ci(energy): wire energy harnesses into bench/apk workflows (audit F9)
- `95cf975` (09-15) fix(energy): anchor decode phase to rep end; counts manifest, guards, cadence honesty (audit F1-F8)
- `f936c16` (09-15) bench(energy): skip *.phases.csv in aggregate; unlock per-phase numbers with exact token counts
- `572d3be` (09-15) bench(energy): per-phase (prefill/decode) energy disaggregation tool
- `2964da5` (09-15) bench(energy): audit fixes F1-F13 (schema provenance, export completeness, silent-failure hardening)
- `2dbc9a9` (09-15) bench(energy): shared schema module + CodeCarbon-compatible emissions export
- `ce0eb32` (09-15) bench(energy): fix pkill self-match that killed every campaign sampler
- `c84f48d` (09-15) bench(energy): fixes from deepseek audit (F1-F5, F7, F8)
- `c5fae2f` (09-15) bench(energy): 1 Hz power/clock sampler for the Jelly campaign

### BENCH-ORACLE (8)

- `48eec64` (09-15) bench(ngram): first-pass verdict + tuned pass support (PURE/COPY, SPEC_EXTRA)
- `fcf9172` (09-15) bench(ngram): device A/B harness for the fork's n-gram speculative types
- `8269aa2` (09-06) bench: return a Promise from stopCompletion (restore the JS contract broken in 8b6d548)
- `8b6d548` (09-06) bench: restore llama_synchronize in the oracle hook and keep steps with no logits visible instead of truncating
- `1cf865a` (09-06) bench: guard the logit-oracle hook against null logits and exhausted forced ids (SIGSEGV on the GPU-prefill arm)
- `19b67b6` (09-06) bench: toolchoice=none also drops tools from the system prompt and the KV prewarm; guard structured execution
- `1ec63a0` (09-06) bench: toolchoice=none drops tools from the completion and skips the fallback parser
- `28424c3` (09-06) bench: raw pre-sampler top-N probs + forced-id sequence (logit oracle, bench-only)

### ENGINE-PIN (22)

- `50b8196` (09-19) refactor(engine): port the app to the vendored engine layout, drop native/bmoe
- `bad7b89` (09-19) chore(engine): bump llama.rn pin to the vendor-migration tip [skip ci]
- `5a15067` (09-19) build(engine): pin llama.rn 95c3493b — the q4_K MoE OpenCL kernels build again
- `10194d9` (09-18) build: llama.rn at fada1ebe (the cpu params the dropped CLI layer used to resolve; -1 and 0 both safe)
- `cb10497` (09-18) build: llama.rn at 4126b729 (iqp.cpp reaches the flatten, the vendored hash sources reach the target)
- `86febd3` (09-17) build: llama.rn at da845d16 (reasoning_budget_end is a vector of token sequences at this pin)
- `58f5db4` (09-17) build: llama.rn at the fork head that builds (engine 70b4302bb: the OpenCL blocks the 2026-09-04 merge left open, the jsi API drift, the version headers)
- `92001b3` (09-17) fix(bmoe): arm() to the load_mode enum -- pin 134a35cf2 removed common_params.use_mmap
- `f39c757` (09-17) build: llama.rn at the fork's step-1 commit (engine 67c73d26c) for the binary-equivalence build
- `52f88b3` (09-17) build: engine id covers every build input the Android engine reads
- `ed1994e` (09-17) build: engine id excludes build output for real and covers the JS bridge
- `ad7ff7d` (09-17) fix(engine): the overlay allow-list never learned about nine upstream files
- `0fc723b` (09-17) build: llama.rn comes from the Aspis0 fork; no overlay, no patch-package
- `4cf44d8` (09-17) build: re-sync the vendored tree to the bumped pin (CI was red on my bump)
- `c4d23be` (09-17) build: bump kalsallama pin to 134a35cf2 (871 commits, incl. upstream cherry-picks)
- `7e3197b` (09-16) feat(scripts): detect a hand-edited vendored engine at source level
- `7f9fcc4` (09-16) chore: point the kalsallama pin at main
- `4004117` (09-14) fix(native): refuse llama.rn ctx_shift that halves hybrid KV
- `8be587c` (09-10) fix(patch): repair llama.rn hunk header so patch-package can parse
- `e6d6aa0` (09-09) native(llama.rn): synchronize before reading perf counters in the completion result
- `c4c5280` (09-07) build: bump kalsallama pin to 67c73d26c (f32 product in the Adreno q4_0 and q4_K GEMMs)
- `8a56edc` (09-05) build: bump kalsallama pin to e31b9144c (perf reset clears async timing)

### ENGINE-CORE (30)

- `c7e3f9c` (09-18) refactor(engine): the delete-authorizing disk decision had no test that could reach it
- `9f96a45` (09-18) fix(engine): preserve older qwen think spans
- `a526b7b` (09-18) fix(engine): make eviction outcomes explicit
- `bcfdb9a` (09-18) fix(engine): make space eviction reflect current disk state
- `c4e3e95` (09-18) fix(engine): handle exact disk gate equality
- `4daaa6f` (09-18) fix(engine): the space eviction pays at most the measured deficit and only when it can cover it — and a negative free reading can no longer authorize deletion
- `2fdae47` (09-18) fix(engine): the audit's eight findings — the disk gate now frees space before failing, the marker cannot lie about its regime, and the pool total is visible
- `4b82f78` (09-18) feat(engine): the pool's one destructive operation now leaves a marker, and a save can no longer evict another model's warm cache
- `0eaa090` (09-18) fix(app): log a failed model switch before rethrowing — the rethrow reaches no handler
- `9c4c2a3` (09-18) fix(app): selectModel releases the switch lock if the tail throws
- `ccaddd7` (09-18) fix(engine): fourth-pass audit — comments now assert only what the code proves, the selection clear is awaited
- `4537177` (09-18) fix(engine): the fit branch passes the decider's reason through, the gate runs after acquisition, and the retry advice stops lying
- `d3639a6` (09-18) fix(engine): six audit fixes — the marker now survives only a death, refusals stop claiming causes the code does not know
- `f6f07ae` (09-18) fix(engine): the load path now runs the same fit gate as the send path, and a death marker catches the kills fit cannot predict
- `c0a7162` (09-17) build: make the gate parse what the build compiles — main does not build
- `24d86c1` (09-17) fix(native): drop the cold-cache checkpoint branch — it destroys what it reads
- `5398805` (09-16) feat(engine): make a truncated answer observable, and name it for what it is
- `34b44f0` (09-14) fix(engine): the assemble boundary is a fact, not a promise
- `1dd07e1` (09-14) fix(scripts): let device-preflight pick a serial in a two-phone lab
- `2bbef14` (09-14) fix(engine): allow 15 min no-EMA prefill after APK-upgrade KV mismatch
- `a21746e` (09-14) fix(engine): live KV assemble start is 0, not leftover digest B
- `7aabfe8` (09-14) fix(engine): do not inject ciswire digest while live KV is held
- `9151f78` (09-14) fix(engine): 180s min prefill deadline when EMA is missing
- `32dfe3c` (09-14) fix(engine): never treat a returned completion as empty KV
- `b907290` (09-13) fix(engine): drop KV hold only after native clear succeeds
- `94dd4e5` (09-13) fix(engine): drop last-save KV hint on native-empty paths
- `d39fa51` (09-12) fix(engine): length-1 bake rematch sticks to the previous last user
- `e925608` (09-09) fix(embed): log [embed] done and the error on the job exception path
- `f692062` (09-09) quality: allow llama-server binary and port overrides via env (KALSA_LLAMA_SERVER, KALSA_QUALITY_PORT)
- `659a644` (09-05) fix(bench): read __DEV__ via isDevBuild for Node harness tsc

### SESSION (25)

- `809d191` (09-19) fix(context): keep KvCacheProfile a leaf so the session harness typechecks
- `9b08ae0` (09-18) fix(engine): tighten session privacy guard
- `f781042` (09-18) fix(engine): redact session stems in telemetry
- `9308793` (09-18) fix(engine): make session eviction reporting honest
- `d15fba3` (09-18) fix(app): the switch catch releases the chat gen too, and sync invalidation is restored
- `4acc10c` (09-18) fix(chat): preservation means THIS raw, stale writes adopt nothing, and the .kvs waits for the write to land
- `185d254` (09-18) test(device): the verdict was blind to the session KV, which is half the question
- `02d5348` (09-17) test(device): make the restore protocol exercise the foreground re-kick, and judge it
- `a3aca53` (09-17) test(memory): restore the facts-tail harness and put it where CI can see it
- `4c5553f` (09-17) fix(prewarm): close the restore window at the native load, not at the call site
- `0b3d4bb` (09-17) fix(prewarm): guard the KV before the restore replaces it, not after
- `235444f` (09-17) feat(engine): persist the prewarmed static prefix, restore it instead of recomputing
- `5de99f3` (09-17) fix(session): unbreak the harnesses the calibration change red-lined
- `4f0370e` (09-17) fix(session): the disk gate demanded 4.5x the truth and could never unlearn it
- `d3959aa` (09-12) fix(session): restore interrupted turns that still have visible text
- `202e364` (09-12) fix(session): restore G1 chats that lack modelEmittedText
- `da5582d` (09-12) fix(session): compare native save to lastChatNPast, not nCtx
- `f0862e6` (09-12) fix(session): hash persistable history on save and load
- `c498639` (09-11) fix(session): align hybrid save/load; clear KV flags on failed restore
- `b889991` (09-11) fix(session): refuse inconsistent hybrid KV saves; EMA 5 samples
- `b85e775` (09-10) fix(engine): replay think via reasoning_content; restore hybrid KV prefix
- `2619db0` (09-10) fix(session): hash load prompt-env the same way as save
- `095466e` (09-10) fix(session): derive engine identity from native build inputs
- `e2e09f5` (09-10) fix(session): bind the saved KV to the model file and the engine build
- `a36074e` (09-09) feat(session): keep the pre-tool .kvs prefix as a warm restore point after a tool turn; feed prefill speed

### CHAT-STORE (8)

- `c45f044` (09-18) fix(chat): the quarantine sweep matches slot hashes, not the whole prefix
- `b6a1cd7` (09-18) fix(chat): declarations die with the visit, deletion sweeps what the index forgot, and no callback fires twice
- `1e54b1d` (09-18) fix(chat): an unreadable raw is announced, deletion is index-based, and the turn cannot hang on a KV promise
- `3fcb85a` (09-18) fix(chat): the guard now tracks message identity, not counts — and preserves before it refuses
- `f4e1b17` (09-18) fix(chat): a history write may never shrink the store — unreadable raws are quarantined, not overwritten
- `753a8ef` (09-17) fix(chat): stop serving the first turn's reasoning as the answer
- `c906727` (09-10) fix(chat): show sheet Copy for non-empty text; withhold decode EMA for 3 samples
- `c370c98` (09-10) feat(chat): add Regenera on the assistant action sheet

### KV (20)

- `2ba2ba8` (09-18) docs(kv): name the frozen-hash scope and the count helper's exit status
- `dadd5c3` (09-18) test(kv): the removal detector accepts bracket-carrying receivers
- `b261c63` (09-18) ci(kv): actually land the jest/harness step split
- `503c343` (09-18) ci(kv): the 15-minute bound moves to the jest step; the harness step stays unbounded
- `4ea5bef` (09-18) ci(kv): the jest step that guards main is bounded at 15 minutes
- `99344d9` (09-18) test(kv): freeze the pre-upgrade projection — flag-free records hash as 204298f hashed them
- `fec0f0d` (09-18) test(kv): the emissionSource semantics return to jest — the matrix, the budget, the echo
- `723d313` (09-18) test(kv): the emissionSource audit sees removals, and reads each writer's own region
- `1b5a9a9` (09-18) fix(kv): the settle wait measures seconds, and its log survives the run
- `1dd84db` (09-18) docs(kv): the SIGPIPE captures show three classes of kick, not one
- `89dfee8` (09-18) ci(kv): jest joins the push-to-main gate
- `559711d` (09-18) fix(kv): the settle wait must not read its capture through a grep -q pipe
- `81618cc` (09-18) fix(kv): compactor carries emissionSource — the audit caught its own absence
- `99f8c91` (09-18) test(kv): the hash round-trip fixture must not reconcile by trimming
- `56facf7` (09-18) feat(kv): record where an emission came from — emissionSource on the message
- `379e833` (09-18) fix(kv): load applies the save path's own emission policy
- `5fb1bfa` (09-18) test(kv): pin the two shapes the suite only looked like it covered
- `bc6bd22` (09-18) fix(kv): seed the think tag only when the emission does not already carry it
- `7b5b79b` (09-18) fix(kv): the history was missing the one token the template seeds
- `8ec99c9` (09-18) docs(kv): record that little-core generation was already half-attempted

### PREFILL (18)

- `be1696a` (09-20) fix(ci): read KV reuse from KALSA_KVPREFIX — the engine bump retired the line we parsed
- `f4d79b9` (09-17) fix(prewarm): facts-in-system and the static prefix prewarm cannot coexist
- `0ec90cc` (09-17) fix(prewarm): make the foreground handler say why it did not re-kick
- `4c6b041` (09-17) test(device): count the prefix hash miss — the failure the verdict could not see
- `ac01f2e` (09-17) fix(prewarm): bind the budget key once, and refuse to call a failed capture a measurement
- `ee285fa` (09-17) feat(prewarm): stop paying a full prefill for a prewarm that will never land
- `f0e4e2b` (09-17) fix(prewarm): re-kick the prefix on foreground — the contract promised it, nothing did it
- `3a504a6` (09-17) fix(prewarm): re-queue once after learning a template needs the filler
- `899f355` (09-17) fix(prewarm): recognise the refusal Qwen's template actually raises
- `f4b28d6` (09-17) test(e2e): record what the prewarm actually did, and the engine's own prefix match
- `57bad0c` (09-17) fix(prewarm): stop appending a filler turn that costs the whole prefix
- `f62272b` (09-17) feat(window): re-warm the static prefix after a slide instead of re-prefilling it
- `c029807` (09-17) fix(native): let a cleared cache reuse the system prefix it already computed
- `b6c2104` (09-15) wip(engine): checkpoint prefix measure and slide marker
- `c4d3f6f` (09-14) fix(engine): the n_ctx ceiling must price the static prefix
- `88152e1` (09-12) fix(engine): one unprefixed KV heal per engine hold
- `1d22dd1` (09-11) fix(engine): keep anchored KV prefix; short think on calc turns
- `e168b4a` (09-09) fix(prewarm): do not gate success on prompt_ms — dense models never sync perf counters at n_predict=0

### CONTEXT (17)

- `e0d1836` (09-19) feat(context): ciswire recalls dropped turns via the char-3-gram dense leg
- `4c4bb10` (09-19) fix(context): harden context-size + KV-cache choice against two hostile audits
- `6fc94e9` (09-19) feat(context): let the user choose context size and KV cache quality
- `2bec6fa` (09-19) fix(context): the app could load a context too small to hold a conversation
- `bf9156c` (09-19) fix(context): pin the anchored floor's edge, and state its limit
- `8a6e409` (09-19) fix(context): keep the last exchange when a long turn exceeds the rebuild target
- `76d1a97` (09-18) build(engine): llama.rn e8505ca2 — the MTP draft context stops dying on a cache it cannot share
- `6412e6f` (09-17) test(device): close the kick window on the kick's outcome, not on a stopwatch
- `e2d6ae4` (09-17) fix(window): the slide re-warm must never be able to fail the turn
- `a6794ed` (09-17) docs: the state-checkpoint machinery we ship, and the slide that deletes it
- `b9f51c8` (09-17) campaign: price the window slide, do not just prove it correct
- `244c6c0` (09-15) fix(engine): retain adopted window boundary
- `07dee2e` (09-15) docs(moe): record window-slide root cause
- `8a2579c` (09-14) fix(engine): slide the window at the n_ctx ceiling, on purpose
- `f441b3d` (09-13) fix(engine): keep ciswire JS window aligned with live KV
- `c7801f9` (09-11) fix(engine): clamp off-mode window to live KV start
- `33502b2` (09-09) feat(documents): gate full_context on the phone's prefill budget, not only on context size

### ROUTING (3)

- `899e76b` (09-10) fix(thinking): nPredict 2048 for the 512/1024 budgets, harness guard updated
- `acade04` (09-10) feat(thinking): budget per model chosen by measured decode speed
- `f77ea7b` (09-09) fix(prompt): answer in the language the user writes in, locale only as fallback

### PROTOCOL (9)

- `7a06c25` (09-18) test(protocol): the timing pins run on a virtual clock — the pass-count race is gone
- `fe588e0` (09-18) test(protocol): the shared-deadline fixture expires at a fixed pass, not a wall window
- `7114626` (09-18) test(protocol): pin the warn-once log gate; name its mid-run limitation
- `ff1389c` (09-18) test(protocol): the shared-deadline pin discriminates by pass count, not wall time
- `643aacc` (09-18) test(protocol): the wait-shell driver models rp_main's successful setup
- `aa70675` (09-18) fix(protocol): a broken protocol log warns once; the shared stderr silence is named
- `afb81dd` (09-18) privacy(protocol): the conversation never touches disk; fatal_state truncates texts
- `ec6aed1` (09-18) test(protocol): pin all three terminal ops, the shared deadline, and floor-based timing
- `bb731b1` (09-18) fix(protocol): the settle budget validator closes overflow and octal

### MEMORY (16)

- `904991e` (09-17) fix(memory): build the extraction prompt in one pass — user text was rewriting it
- `7b6ef0a` (09-17) refactor(memory): derive the extraction cap from the injection cap
- `accf9db` (09-17) fix(memory): rank deferred facts by timestamp — the day label was dropping the newest
- `5a8d6a8` (09-17) fix(memory): delete the dead system-prompt builder, and stop Settings quoting it
- `dbc568f` (09-17) build: llama.rn at the fork's audited head (engine 134a35cf2, rn-* rewired for its memory and mtmd APIs): the first engine update
- `b9a2eca` (09-14) copy(memory): say that facts already in past chats stay
- `2f2b09a` (09-11) fix(engine): re-apply baked facts; heal wiped tails with one cold prefill
- `31495c3` (09-11) fix(engine): snapshot live chat KV before memory extract
- `f99fe45` (09-10) fix(memory): forward chat cancellation to extraction
- `3ca6145` (09-10) fix(lifecycle): native background timer and trim-memory bridge for the dispose grace
- `e455afc` (09-10) fix(memory): extraction budgeted by measured speed, aborted by the next send
- `0b75254` (09-09) perf: fail fast on stalled generation, memory admission on cold load, background dispose grace
- `e7aa0c6` (09-05) fix(privacy): F3 — document egress filter + echo-of-memory-fact test
- `e93e804` (09-04) feat(memory): B1-C — inline edit for saved facts
- `6c6ca56` (09-04) feat(memory): B1-B — clearer Memory settings UX
- `b28294b` (09-04) fix(privacy): B1-A′ — store sensitive facts locally, block egress

### TOOLS (4)

- `edc6c2d` (09-19) t20c-jelly: mark tool-round telemetry invalid + lock tool flags to 0
- `e811754` (09-16) fix(telemetry): a model-invented tool name must not reach a committed log
- `e697d33` (09-05) feat(notes): B4 — write_note tool for AI-created markdown notes
- `2de4abd` (09-05) refactor(tools): B6 — typed tool registry and safer add-tool DX

### DOCUMENTS (7)

- `87afd45` (09-17) docs(repos): llama.rn is not dead, the app has six branches, three clones share one remote
- `84f6195` (09-13) fix(engine): do not digest-share while native chat KV is live
- `5fb7711` (09-09) refactor(documents): split documentChatTool.ts into 15 modules, no behaviour change
- `4b29466` (09-09) fix(documents): tell the model to answer in the user's language, not the document's
- `f5da438` (09-09) docs: archive every historical document under archived/; two living docs remain in kalsa-moe-experiments (PLAN, ALIVE)
- `5707cfe` (09-09) fix(documents,share): real PDF text extraction, lenient doc selection, share-to-Kalsa intents
- `aa12471` (09-05) fix(documents): export isDocumentUnreadable for rebuild gate

### LIFECYCLE (14)

- `9abb4e9` (09-18) fix(app): the dispose IIFE's finally now arms at the top of the body
- `edcc43e` (09-17) test(device): name why a foreground re-kick stopped, instead of calling it silent
- `ecc0c08` (09-17) build: engine id binds the installed tree; from-source is the only variant
- `9643db1` (09-16) fix(engine): bound the auxiliary native calls no watchdog was covering
- `854cd50` (09-16) test(app): cover the foreground-idle wiring, not just its predicate
- `8509619` (09-15) docs(moe): record foreground idle debug build
- `c37b419` (09-15) fix(app): preserve active foreground generation
- `91d7b73` (09-14) fix(engine): drop rate stall; 45s gap is the hang detector
- `96d3d06` (09-13) fix(engine): do not rate-stall a live think at 1.8s gaps
- `5abdafa` (09-13) fix(engine): stall 45s think gap; do not wipe live chat KV
- `e8c8886` (09-13) fix(engine): do not wipe or idle-unload live chat KV
- `cb1d92d` (09-12) fix(app): dispose idle engine without skipping background unload
- `1807aad` (09-10) fix(engine): bound model-switch dispose so a hung stop cannot freeze the UI
- `1e02fe3` (09-10) fix(lifecycle): commit the Android sources of kalsa-lifecycle (blanket android/ ignore swallowed them)

### UI (17)

- `3431db4` (09-10) fix(session): evict other-model KV first; testID drawer rows
- `e89bd2a` (09-10) chore(a11y): testIDs and button semantics on message actions (more/copy/edit) for the device harness
- `9d3db10` (09-06) fix(i18n): C6d — qualità not qualidade
- `a310f99` (09-06) fix(i18n): C6d — Italian empty-state copy (no PT nenhuma)
- `869c28d` (09-06) fix(miniapp): C6d — restore block titles + IT copy
- `3c9e2a3` (09-06) fix(miniapp): C6d — reuse planner glass cards for timeline/quality/citations
- `d5008e3` (09-06) fix(miniapp): C6c — F5 slot/block size caps reject oversized
- `b56d5bc` (09-06) fix(miniapp): C6c — slot docs, icons, checklist/pros_cons polish
- `2fdaef4` (09-06) feat(miniapp): C6c — N-question quiz + kpi/checklist/pros_cons templates
- `c26ad2f` (09-06) fix(miniapp): C6b - prompt steers create_miniapp; tighten builders
- `f659bda` (09-06) feat(miniapp): C6b — create_miniapp tool + builders
- `8e788ec` (09-06) fix(miniapp): C6 — compile, i18n, template mount
- `ab6f4a0` (09-05) feat(miniapp): C6 — prompt types, templates, requiresAi, bio cleanup
- `5d8b2eb` (09-05) fix(i18n): clarify Italian thermal hard-gate unload copy
- `7ea2f28` (09-05) fix(i18n): polish EN/IT thermal and orphan copy
- `9c46a34` (09-05) fix(i18n): C3 — Italian thermal copy
- `f9d4c75` (09-04) feat(ui): A1 leaf-fold drawer — origami menu from settings

### TELEMETRY (5)

- `4553062` (09-16) fix(native): stop publishing the user's conversation to logcat
- `5fd704c` (09-16) fix(harness): the telemetry guard was testing a build from six days ago
- `1edf5c6` (09-10) chore(embed): add deterministic progress telemetry
- `17c6afc` (09-05) fix(privacy): B3 — gate web_fetch sensitive URL/query egress
- `826fe50` (09-04) feat(engine): add greedy bench sampling telemetry

### MODELS (5)

- `07cacea` (09-18) fix(registry): the default model is LFM2.5-2.6B, not Qwen3.5-4B — a fallback a 7 GB phone cannot hold is not a fallback
- `7836db7` (09-09) feat(models): MiniCPM5-2B Q4_K_M opt-in dev catalog entry + one-time sha256 verification
- `bd8e4e9` (09-05) fix(models): F1 — merge orphan Keep set across prompts
- `92632a7` (09-05) refactor(models): F1 — orphan sweep becomes detect-only migration
- `7b71d18` (09-05) refactor(models): C1+C2 — data-driven catalog and RAM recommendations

### SEARCH (2)

- `070b5f9` (09-05) feat(semantic): B5 — E5 Option D tests and safe index rebuild
- `15ee404` (09-04) feat(search): B2 chat search — debounce, tail blob, highlights

### TESTS (25)

- `e7712de` (09-19) test(device): make the ciswire harness robust on slow devices [skip ci]
- `f81cec9` (09-19) test(device): add the ciswire KV-cache measurement harness + ignore build/scratch
- `f14b0c0` (09-19) fix(campaign): strengthen two identity selftests to assert the refusal, not just its message
- `8456ddf` (09-19) fix(campaign): a malformed deviceModel switched off the check it asks for
- `9c6601b` (09-19) fix(campaign): bind the run to the phone the config names
- `be401ba` (09-19) test(campaign): derive T20C evidence dir and refuse foreign configs
- `398a186` (09-18) test(campaign): route T20C harness by configured device
- `7d607c8` (09-18) test(campaign): pin completion progress backstop
- `429cd92` (09-18) test(engine): lock eviction decision boundaries
- `038baa2` (09-18) docs(campaign): name the conversation dump that c63a952's subject overstated
- `23c2117` (09-18) test(device): the first real run found the verdict counting two cycles as one
- `4d2f6fb` (09-18) test(device): the verdict could not see the failure it exists to catch
- `e677fc8` (09-17) test(device): watch the temperature DURING a cycle, not only between cycles
- `079b0a3` (09-17) test(device): print reuse and prompt time per cycle, and defer the threshold
- `b5d8b87` (09-17) test(device): tell a one-time identity change from a cache that is broken
- `8e11f14` (09-17) test(device): a broken run must exit non-zero, and a run without markers must not start
- `07c2e94` (09-17) test(device): stop the re-kick verdict passing work that never happened
- `c1951a8` (09-17) test: revive the two orphan harnesses that rotted while nobody ran them
- `d934eb0` (09-17) campaign: stop re-sending a turn the engine already started
- `9bd5d0d` (09-16) fix(campaign): a Hermes bundle cannot be content-checked, so stop pretending
- `2d46737` (09-16) fix(campaign): verify the JS that actually runs, not the JS we assume
- `90f25f0` (09-16) feat(campaign): count truncated answers, and refuse to score what a build cannot report
- `1f4b5c3` (09-16) feat(campaign): compute the T20C verdict instead of grepping for it
- `0bfe985` (09-16) fix(campaign): prove Metro bundle provenance
- `bbc9442` (09-14) chore: never publish the CisWire campaign captures

### CI (10)

- `5429799` (09-20) fix(ci): print the turn's reuse number again, labelled when it is not size-matched
- `f6283d2` (09-18) docs(ci): the keystore this comment pointed at is not in the repo, and its advice deletes measurements
- `87b36f8` (09-18) ci: from this merge on, a red jest makes main's e2e red
- `3cabcf1` (09-18) fix(gate): say what the engine's ndk property really is, and raise the floors to today's counts
- `8f12450` (09-18) fix(gate): the temp log used a BSD mktemp spelling the Linux runner rejects
- `da7106c` (09-18) build(gate): parse the OpenCL blocks, follow the engine's own NDK pin, and report the failure
- `2e1ba1c` (09-18) build(gate): the includes gate parses with the NDK clang, and a missing compiler is a failure
- `50edd14` (09-18) ci: the harness I wired could never have run on the CI's Node
- `f4dbfa0` (09-17) ci: wire the 18 orphan harnesses — no self-checking harness runs nowhere now
- `e5f8335` (09-05) ci: F2 — typecheck+jest gate on push to feat/**

### DOCS-ONLY (15)

- `a34d7f7` (09-17) docs: correct the KV cost - 6656 B/token, already quantized, not 29.2 KB/token
- `59e0e2a` (09-17) docs: say in the index that the living docs are not in this repo
- `de53b6b` (09-17) docs: record the 2026-09-17 run, and retract the LFM2 recurrent claim
- `a43e74a` (09-17) docs(engine): the n_ctx comments pointed away from the real behaviour
- `c6a0d6f` (09-16) docs(engine): the save duration was measured all along
- `a53b884` (09-16) docs: add REPOS.md, the map of the five repositories
- `1c1d806` (09-16) docs: record the one-branch-per-repo cleanup
- `775a56a` (09-16) docs: record the NPU salvage and the test-backend-ops build defect
- `9e93be6` (09-15) docs: final n-gram verdict — no for the app, with numbers
- `119b30b` (09-15) docs: correct provenance of the n-gram speculative types
- `c6e2376` (09-15) docs(moe): record verified debug build
- `283675d` (09-09) docs: §7.45 measured after the v2b repair; MiniCPM5 @256 bare-'>' budget gap
- `dfa8f45` (09-09) docs: §7.44 verified on device with e168b4a
- `5e149f6` (09-09) docs: HARNESS_FINDINGS §7.41-7.45 (product track 2026-09-09) and KALSA.md state line
- `332aeed` (09-09) docs: add the chat-optimisation proposal (owner plan, rev 2, 2026-09-09)

### HYGIENE (1)

- `2ed2a88` (09-18) chore(git): ignore device output as a class, name the five dirs that are evidence

---

## 5. What I could NOT verify

1. **Full history.** The clone is shallow (`a5ae74b` boundary). Merge bases for `origin/brain` and
   `origin/chat` are missing locally, so their relationship to `origin/main` and the exact size of
   their unique contribution are approximations (`origin/main..<ref>` over a shallow graph). I did
   not fetch or unshallow.
2. **The mission's branch premise.** HEAD is `s23-repack-timing-2026-09-21`, not `qwen-repack-policy`.
3. **Test results.** Commit messages assert passing suites (e.g. `96eb9d9`: 59 suites / 717 tests;
   `87b36f8`, `89dfee8`). I did not run jest or any Android build; claims about green suites are
   quoted, not reproduced.
4. **The device-resident evidence.** Most device runs write to gitignored `out/` or
   `device-*-out/` directories; only some were committed. I could confirm the committed campaigns
   (`device-v3-out/`, `device-sweep-pilot-out/`, `device-s23-out/`, `device-ngram-spec-out*/`) but not
   the gitignored 2026-09-17 T20C run referenced by `docs/KV-WINDOW-AND-THERMAL-2026-09-17.md`.
5. **Governor device proof.** I found no committed logcat or trace showing the governor actually
   engaged on any phone. The plan's own Part 7 says the same ("No in-app GPU measurement on the
   Xiaomi … No NPU inside the app").
6. **The engine-side policy.** The plan cites `src/llama-governor-policy.cpp`,
   `src/llama-governor-runtime.cpp` and `src/llama-ext.h`; none of those exist in the app tree
   (`git ls-tree -r origin/main` finds only `scripts/governor-params-test.cpp`). The defects 5.1/5.3/
   5.4/5.5/5.6 line citations are in the fork, which is not in this worktree, so I map them from the
   app side only.
7. **`t_idle_valid` requirement.** I confirmed the app never sends it and defaults it to `false`, and
   I quote the fork's `profile_is_valid` requirement from the device plan; I did not read the fork's
   source in this worktree to re-confirm `cpp/rn-governor-params.cpp:86` and
   `llama-governor-policy.cpp:59-63` line by line.
8. **The exact "overstated" set.** I found the documented cases (§3.6) by searching bodies and
   subjects; a systematic `git diff -G`-based contradiction hunt over 368 commits is not something I
   completed, so the list is the strongest examples, not a proof of exhaustiveness.
9. **`vendor/VERSIONS` for pins other than the installed one.** I could read only the installed
   `node_modules/llama.rn` (pin `0f313bab` → engine `8537d097`). The engine commits named by every
   intermediate binding pin come from commit messages, not from checked-out `vendor/VERSIONS` files.

---

## Appendix A: branch-unique commits (app-line branches that contain origin/main)

### origin/main..main (3 commits)
- `ff6a7c0` (2026-09-21) fix(context): wire the token-aware ceiling-slide into AppShell's send guard
- `24c2e3e` (2026-09-20) fix(context): let the window ceiling-slide price dense content (pure machinery)
- `745bf82` (2026-09-20) feat(device): add CW_CORPUS knob to the ciswire harness (dense default, prose variant)

### origin/main..qwen-repack-policy (2 commits)
- `fc3627d` (2026-09-20) fix(engine): align repack precedence docs and guard the qwen load policy
- `964dd53` (2026-09-20) feat(engine): disable ARM weight repack for qwen3.5-4b only

### origin/main..s23-repack-timing-2026-09-21 (1 commits)
- `964dd53` (2026-09-20) feat(engine): disable ARM weight repack for qwen3.5-4b only

### origin/main..app-integration-2026-09-20 (12 commits)
- `96eb9d9` (2026-09-20) chore(engine): pin llama.rn to 0288dc27 (engine 4ccef2f85)
- `213850e` (2026-09-20) feat(telemetry): move the Worker origin to telemetry.kalsa.io
- `6dd71c2` (2026-09-20) docs(ci): stop describing the fork as a cpp/ flatten in the overlay-includes gate
- `24e53e1` (2026-09-20) test(engine): cover the provenance gate's rename handling off-network
- `f5be12c` (2026-09-20) chore(engine): point the fork dependency at Aspis0/kalsa.rn
- `39f403a` (2026-09-20) docs: correct the kalsa tracked-file count and name its source
- `2377a7f` (2026-09-20) docs: fix the REPOS branch facts and annotate the archive's pre-move paths
- `fc8a9c2` (2026-09-20) docs: fix the lab branch claim, the model answer and a dead doc pointer
- `8540472` (2026-09-20) docs: correct the stale model, engine and branch facts
- `d633cd4` (2026-09-20) chore(docs): archive the frozen energy audits and dated findings

### origin/main..kv-hold-protocol (4 commits)
- `9a2cd9c` (2026-09-18) fix(kv): the device protocol waits out the boot prewarm before bouncing
- `a44f6e0` (2026-09-18) feat(kv): record where an emission came from — emissionSource on the message
- `a5389d2` (2026-09-18) fix(kv): the window budget charges the replay field it actually builds
- `ab5bcac` (2026-09-18) fix(kv): load applies the save path's own emission policy

### origin/main..kv-hold-budget (2 commits)
- `a5389d2` (2026-09-18) fix(kv): the window budget charges the replay field it actually builds
- `ab5bcac` (2026-09-18) fix(kv): load applies the save path's own emission policy

### origin/main..qwen-think-in-history (4 commits)
- `346debd` (2026-09-18) fix(engine): require exact qwen history round trips
- `1bd26b8` (2026-09-18) fix(engine): harden qwen history edge cases
- `5e600a6` (2026-09-18) test(engine): update qwen history harness expectations
- `59349ca` (2026-09-18) fix(engine): preserve qwen thinking history

### origin/main..protocol-abc (2 commits)
- `870b9d7` (2026-09-20) test(ci): exercise the production key functions, and correct the privacy bound
- `a0624bb` (2026-09-19) fix(ci): fatal resolution failure could finish PASS after capture

### origin/main..baseline-67c73d26c (1 commits)
- `3ce0992` (2026-09-17) baseline: 5de99f3 with the engine of the last green build (vendor + pin at 4f0370e, kalsallama 67c73d26c)

## Appendix B: divergent lines (shallow clone; ancestry incomplete)

### origin/brain tip 8393db7, 232 non-merge commits listed (236 total incl. merges) not reachable from origin/main
- `8393db7` (2026-09-21) launch: size the context per device, and let the machine set the ceiling
- `7292a3a` (2026-09-21) door: refuse the engine's slot routes to guests
- `0d0d227` (2026-09-20) door: answer the webview's CORS preflight, and say what varies by origin
- `559fb09` (2026-09-20) door: per-device slots, lease-gated revocation, sealed cache headers
- `d7593e6` (2026-09-20) runtime: the extractor takes the fork's kalsa-server beside llama-server
- `3308f5e` (2026-09-20) dev: the KV-paging spike, without the 252 MB of slot snapshots or the logs
- `54f0a63` (2026-09-20) fix(door): the forwarded head carried the request line twice
- `eab85fd` (2026-09-20) docs: section 12 claimed the screen was closed, but only the fields were
- `1aa02a5` (2026-09-20) docs: the plan is re-read against the code, and two sections had gone false
- `0197a1f` (2026-09-19) feat(chat): the whole disk is browsable, and nothing leaves without a word
- `39aeb2f` (2026-09-19) chore: the contract guard fails on dead commands instead of printing them
- `485aa48` (2026-09-19) feat(files): the file engine is connected, and the whole disk is in scope
- `2642cc3` (2026-09-19) fix: three defects the audits confirmed and nobody closed
- `b29b05c` (2026-09-19) feat(brain): the app says whether the model is in memory, and the owner sets the clock
- `1d2c47c` (2026-09-19) feat(app): the app is Kalsa, the first page is Home, and the screen changes as one
- `e74b520` (2026-09-19) fix(brain): the travelling bar moves its box, and its words keep their size
- `50c39de` (2026-09-19) feat(brain): the writing bar travels into the conversation, and a test can watch it
- `985b8e5` (2026-09-19) refactor(app): the machine's things, the app's things, and a menu of destinations
- `e401350` (2026-09-19) feat(brain): the second option can be chosen, and a stale choice never strands the brain
- `882f987` (2026-09-19) test(chat): a command the page asks for must exist in the binary
- `78d9fb9` (2026-09-19) feat(chat): thinking can be turned off, but only where the model can hear it
- `811f4eb` (2026-09-19) fix(chat): a source you can click, opened by Rust after the same check
- `e00f761` (2026-09-19) fix(chat): a round that spends itself on calls still owes the reader words
- `d70fd4a` (2026-09-19) fix(brain): only the pick may call itself the largest that fits
- `d9913cc` (2026-09-19) fix(settings): the web-search switch is saved when it is touched, not when a form is valid
- `c34bd6b` (2026-09-19) fix(store): an index it cannot read is not permission to delete anything
- `0088bc8` (2026-09-19) refactor(web): the search is plumbing plus one dialect, so a second one is a module
- `0ec7f1e` (2026-09-19) fix(web): three defects a mock could not have shown, found by using it
- `4bd39da` (2026-09-19) feat(chat): the assistant can search the web, and the page never touches the network
- `6099684` (2026-09-19) fix(catalog): the second option earns its place, or it is not offered
- `c400468` (2026-09-18) fix(chat): a policy from the first commit was blocking every request the frontend made
- `66cf03f` (2026-09-18) feat(advanced): the expert settings become real knobs — and every one is proved to reach the model
- `6176d99` (2026-09-18) fix(brain): the walk reaches the screen — the window was never allowed to hear it
- `3fe475f` (2026-09-18) perf(build): the sha256 gate is optimised in dev too, or the app reads as hung
- `b0ae9e6` (2026-09-18) fix(shots): the chat harness looks for the chat, which is no longer the landing view
- `767c91d` (2026-09-18) docs: the plan catches up with the code, and names what the screen has not been watched do
- `5b92487` (2026-09-18) fix(brain): a refused turn-off is said on the page the button is on
- `b361eb6` (2026-09-18) feat(brain): two options on the first screen, with the working under them
- `dc0979c` (2026-09-18) feat(brain): the home page answers what this computer runs, priced at a context it can hold
- `e162187` (2026-09-18) feat(catalog): a second option, a context the model was trained for, and the traffic a router really reads
- `79e391c` (2026-09-18) feat(probe): the chip's published figure, where the probe cannot measure the path
- `974cef3` (2026-09-18) docs(probe): the Metal correction is 1.6x measured, not the 3-4x we reasoned
- `047c6f3` (2026-09-18) feat(brain): the app says why it failed, goes back one step, and talks to itself
- `cb12169` (2026-09-18) fix(chat): four defects an audit found in the brain page, all confirmed on disk
- `84854ab` (2026-09-18) feat(chat): the brain is the first page, and the chat opens from its bar
- `8ff923a` (2026-09-18) docs: the owner settled the crescent, the return, and the empty bar
- `71337e3` (2026-09-18) fix(shell): the window opens without a dev server standing behind it
- `107020c` (2026-09-18) feat(shell): the app serves the chat, and the old frontend is gone
- `a9edab9` (2026-09-18) test(dev): the copy guard follows the panels into the surfaces
- `97bc69b` (2026-09-18) feat(chat): the four panels become the four surfaces the chat already declared
- `58186fe` (2026-09-18) docs: say at the top which two of the night's findings are already closed
- `f639d2b` (2026-09-18) docs: both battery suspects were mine, and measuring refuted both
- `b55aaf2` (2026-09-18) perf(shell): the guard waits in the kernel instead of asking ten times a second
- `e491529` (2026-09-18) fix(download): a server that goes quiet ends the attempt instead of the app
- `6578407` (2026-09-18) docs: the night run -- six things asked, two testable, six defects measured
- `dfcc71e` (2026-09-18) docs: a measured rate outranks every prediction, so its conditions are load-bearing
- `94fee7a` (2026-09-18) test(catalog): the tests catch up with a second measured, downloadable row
- `128ec9c` (2026-09-18) feat(chat): the crescent opens under the pointer, and says so at rest
- `fa8f579` (2026-09-17) fix(shell): saving the advanced settings published the file twice
- `d319390` (2026-09-17) fix(shell): a lock you can defeat by deleting a file is not a lock
- `165b058` (2026-09-17) fix(shell): the guard now has the same reach as the file it guards
- `627844c` (2026-09-17) docs: the chat is in this repo now, and the switch is still two moves
- `2b85eac` (2026-09-17) feat(shell): one app writes the store, and a hard kill gives the guard back
- `02653dc` (2026-09-17) docs: the crescent exists, and the objection is that it cannot be seen
- `c46108f` (2026-09-17) feat(pairing): the desk pairs a house, and the panel can see it
- `81f4890` (2026-09-17) feat(door): pairing a device no longer hangs up on everyone else
- `b37fbbb` (2026-09-17) docs: the bar becoming your first message stays; the crescent goes
- `794053a` (2026-09-17) docs: the brain-to-chat transition was built, measured, and rejected
- `4a6a1db` (2026-09-17) feat(pairing): the credential store holds a house, not a phone
- `c6b468c` (2026-09-17) chore: the agent runners' local settings are not this project's
- `06e148a` (2026-09-17) docs: the PC joins the house as a device, and that reorders the work
- `c7a4e88` (2026-09-17) feat(brain): the shell can name its model and say who is busy
- `3dca395` (2026-09-17) docs: pairing is not a storage limit, it is a product model
- `ce4af50` (2026-09-17) docs: the switch cost was measured, and the brain's screen is two fields short
- `1001ce1` (2026-09-17) fix(kalsa-files): the crate now keeps the promises its doc comments make
- `d87042e` (2026-09-17) docs: the brain is the home, and the chat happens inside it
- `fa498bf` (2026-09-17) docs: retire the 21x framing where it was still load-bearing
- `581a159` (2026-09-17) chore: Cargo.lock records kalsa-files, which still has no callers
- `85a7b75` (2026-09-17) measure(multi-device): the second cliff run, the switch, and 16k unified
- `e69beb6` (2026-09-17) chore: the log rule was too narrow -- a file name is not a guarantee
- `022d9c3` (2026-09-17) docs: the turn question is answered by measurement -- a slot per person, or thrash
- `168182f` (2026-09-17) chore: verbose llama-server logs can never be committed from dev/results
- `d6daf16` (2026-09-17) measure(multi-device): the household shape, measured on the shipped b10950
- `89517f0` (2026-09-17) docs: update the plan -- two items closed with their commits, three added
- `1459c71` (2026-09-17) docs: the small model that reads the room -- a memory feature, not a speed feature
- `6ac3dd2` (2026-09-17) docs: the room's AI hears everything and pays late -- privacy was the wrong argument
- `29f2a4f` (2026-09-17) docs: the room's turns -- addressing, serialization, rotation, and what is visible
- `d6bfe55` (2026-09-17) docs: the four household rules, and the two places upstream will not enforce them
- `f45a8d7` (2026-09-17) Round 25: named reserve in refusal text, continuous context budget meter
- `31cc0d8` (2026-09-17) catalog: pin Google Gemma 4 12B, the table's first dense row — and measure it
- `ac319c4` (2026-09-17) Round 24: file attachments pinned in context with honest fit checks, local-only extraction
- `e0652c7` (2026-09-17) docs: the per-token KV cost is affine, not linear — a scalar cannot carry it
- `8aefd76` (2026-09-17) docs: what llama-fit-params really measures, and where it must not replace the budget
- `02a2139` (2026-09-17) feat(door): a credential per device, not one shared by every phone
- `dd4a12d` (2026-09-17) test(launch): what a person asks must never reach a log, and now a test says so
- `f5d9d1a` (2026-09-17) docs: the server does queue — unbounded and silent, which is why the queue has to be the door's
- `8c87ba9` (2026-09-17) feat(files): the folders a person keeps documents in, with the boundary first
- `0993b34` (2026-09-17) docs: the gap list, read from the code — one credential for everybody, slots that wrap, and a buffer measurement that today made more urgent
- `88f0dee` (2026-09-17) docs: the bridge measured on the SIM, on the road — direct every time, median 55 ms, never a relay
- `25d4a1c` (2026-09-17) Round 23: empty-string precedence, non-stream reasoning, throttled persistence, incremental ticker, document-wide stillness
- `32effaf` (2026-09-17) Round 22: reasoning separated from answers, thought cloud with meaningful motion
- `21e0d34` (2026-09-17) docs: prior art verified — no one browses your disk, and the preview pane has six critical CVEs behind it
- `320a2ae` (2026-09-17) docs: the PC does not need RAG — prefill and KV measured, attachments go in the context
- `fa694fd` (2026-09-17) docs: websearch, documents, deep research and previews — what the phone already owns
- `570525f` (2026-09-17) docs: final state of the desktop chat, verified by running it against a real model
- `6d25ded` (2026-09-17) Round 21: reorder log chronologically, certify full suites green after preview strip
- `5f49118` (2026-09-17) Round 20: hygiene log, Cmd+K focus assertion
- `0c485dd` (2026-09-17) Round 19: remove screenshots and references of the retired arc-conversations product
- `e2bfc77` (2026-09-17) Round 18: crescent navigates six surfaces, conversation sidebar with search, remote images blocked, CSP
- `931179d` (2026-09-17) Round 17: honest chat client (URL composition, non-SSE, truncation, idle timeout), per-conversation streams
- `6177294` (2026-09-17) docs: the new contrast check proven by mutation, not by its own green
- `92ace96` (2026-09-17) Round 16: split store into index plus per-conversation payloads, migration, quota banner, storage events, verify suite
- `5f85878` (2026-09-17) Round 15: fix undefined white token, computed-style contrast check, message validation, error boundary, verify harness
- `a88dd51` (2026-09-17) docs: the audit's findings, and which ones I re-verified myself
- `4ab86e8` (2026-09-17) docs: the crescent is navigation over surfaces, not a list of conversations
- `3e7a761` (2026-09-17) docs: the desktop chat exists, works against the real server, and should be the frontend
- `4c0cef8` (2026-09-17) Round 14: final review, all twelve states covered, handoff notes for real endpoint and Tauri bundle
- `205b657` (2026-09-17) Round 13: production perf check, Tauri app icons from the crescent mark
- `378c641` (2026-09-16) Round 12: sample crescent motion curve, measure 200-message thread performance
- `e763e97` (2026-09-16) docs: what the open-source chats already solved, and what we can take
- `63b9774` (2026-09-16) Round 11: verify dark crescent open state with screenshot
- `5b86140` (2026-09-16) Round 10: crescent handle carries accent breath and count when conversations exist
- `2a42f1c` (2026-09-16) Round 9: orphaned empty responses become retryable, hover timestamps, verified with screenshot
- `ebe19ae` (2026-09-16) Round 8: live-region announcements, Tauri CLI probe, full 27-shot regression green
- `f82aacf` (2026-09-16) Round 7: clip crescent glow overflow on narrow windows, verify few/active/narrow arc states
- `1816ade` (2026-09-16) Round 6: verify 401-recovery flow and mid-stream conversation switch with screenshots
- `88ab2c0` (2026-09-16) Round 5: verify settings, validation, delete-confirm, keyboard focus with screenshots
- `aa446a8` (2026-09-16) Round 4: verify first-token wait, dark 401, copy confirm, 5000-line paste, reduced-motion with screenshots
- `44e5c83` (2026-09-16) Round 3: crescent label width for long titles, verify paging/keyboard/200msgs/narrow/wide/dark with screenshots
- `29f3a47` (2026-09-16) Round 2: verify 401, stop-midway, heavy-markdown states with screenshots, no app changes needed
- `656c18c` (2026-09-16) Round 1: Vite+React+TS skeleton, green oklch tokens, empty states, streaming chat, crescent nav, shot harness
- `2f90c6d` (2026-09-16) launch: the smoke test handed the real binary a disabled flag
- `e59f021` (2026-09-16) launch: the flags we never passed were deciding for us
- `96aadee` (2026-09-16) door: a proxy does not forward the promises of a connection it closes
- `7d097eb` (2026-09-16) pairing: the square carries the node id, and the MAC cannot be shifted
- `98d2e90` (2026-09-16) launch: measure what the prompt cache actually does across turns
- `bfb77aa` (2026-09-16) startup: the crate that finds weights already on this machine is called
- `7dc93f7` (2026-09-16) door, road: four records that lied, and the tunnel that cut every long answer
- `2f3c5ac` (2026-09-16) door: an answer belongs to the job, not to the socket
- `dd1f454` (2026-09-16) catalog: the upper tiers finally use the memory they are given
- `ddf8b7d` (2026-09-16) catalog: a row nobody can download is not a row the chooser can elect
- `54df7b6` (2026-09-16) road: the second road opens with the door and dies with it
- `5e21d1a` (2026-09-16) supervisor: a start that was refused must not publish its plan
- `62634c2` (2026-09-16) iroh: a second road to the same door, behind one replaceable seam
- `771e3e5` (2026-09-16) supervisor: learn about the model's release from the server that did it
- `6bca322` (2026-09-16) desk: an advanced panel that reaches the real argv, and a UI worth reading
- `af95cb7` (2026-09-16) catalog: make the chooser's verdict readable at any memory tier
- `29b63d0` (2026-09-16) door: an authenticated boundary in front of the local server
- `b42a518` (2026-09-16) pairing: make the accept loop's retry a type error to remove
- `38f15a0` (2026-09-15) pairing: expose recovery states in the UI
- `7091867` (2026-09-15) pairing: keep desk and listener states aligned
- `2249ddc` (2026-09-15) pairing: bound the HTTP listener
- `b9f6e03` (2026-09-15) pairing: make completion delivery durable
- `07d3fea` (2026-09-15) chore(pairing): the counter is test-only, and so is its import
- `76cacb7` (2026-09-15) pairing: document idempotent seal retries
- `edcbf5b` (2026-09-15) pairing: expose re-pair action
- `1f98dfe` (2026-09-15) pairing: harden transport and lifecycle
- `981cfc8` (2026-09-15) pairing: encrypt delivery and replace atomically
- `a7f2c96` (2026-09-14) style: cargo fmt across the workspace
- `e4260ef` (2026-09-14) supervisor: record precedes child; pid-less orphans adopted blind, never signalled
- `d13535d` (2026-09-14) feat(pairing): the transport, so the computer finally knows the phone
- `0fea188` (2026-09-14) sentinel: delete idle.rs, the second unload clock
- `60df749` (2026-09-14) sentinel+launch: server owns release timing; sentinel reports via note_unload, runs no clock
- `0e09778` (2026-09-14) kalsa-runtime: refuse builds contradicting exe_sha256 with ExeMismatch instead of re-downloading
- `176c9f4` (2026-09-14) kalsa-runtime: record exe_sha256 for all six engine rows (measured via crate download+extract+hash)
- `a185203` (2026-09-14) fix(audit): the budget follows the build that won, and the binding is a guarantee again
- `b1b9462` (2026-09-14) fix(catalog): a floor speaks words, not figures; a measured decode beats the prediction; the MoE traffic debt is on the record
- `481fffa` (2026-09-14) fix(pairing): the audit's nine — one error for every completion, the whole square inside the MAC, honest ceilings, atomic store
- `bb0fd06` (2026-09-14) test(catalog): the prediction meets the measured decode, on the real machine
- `9ed8f80` (2026-09-14) model: the walk chooses on its own, and the page says so
- `2c47a63` (2026-09-14) the walk's progress is wired: the status page listens to brain_progress
- `db4f280` (2026-09-14) the walk's own failure words reach the screen, and stay there
- `fa5893e` (2026-09-14) chore: lock the sentinel test's serde_json dev-dependency
- `cb579aa` (2026-09-14) test(runtime): the real-engine child dies on every way out
- `5b693d5` (2026-09-14) test(sentinel): the thermal guard meets a real llama-server, and the line holds
- `0490d72` (2026-09-14) test(download): the real catalog row, downloaded, killed, resumed and verified
- `09cf473` (2026-09-14) style: cargo fmt over catalog, reuse and sentinel
- `be00b7c` (2026-09-14) feat(pairing): completion is proven, not assumed — the phone MACs its declaration, the computer seals the credential
- `b2ed919` (2026-09-14) test(runtime): the real engine serves a real model
- `fd89615` (2026-09-14) fix(launch): the argv is proved against the real server, not just against strings
- `7f59661` (2026-09-14) test(runtime): run the real release against this real machine
- `019733b` (2026-09-14) fix(launch): keep up with the row shape, and pin the q8_0 debt where it lives
- `771f114` (2026-09-14) feat(catalog): Apertus carries its measured per-token cache - 160 KiB at the launcher's q8_0
- `3f2b739` (2026-09-14) fix(shell): the measurement travels whole, and a plan is a promise kept
- `19772cf` (2026-09-14) fix(catalog): the row the KV assumption under-counts is dark until measured
- `21b91d4` (2026-09-14) fix(launch): the fixtures ride real catalog rows, and the assumption says what it is
- `be934c6` (2026-09-14) fix(catalog): the execution path travels with the figure; floors never refuse; unreadable cards are refused; the cache is charged; prefill is an estimate
- `15d903b` (2026-09-14) fix(download): publish the bytes that were verified, not the path they were verified at
- `36dd349` (2026-09-14) fix(runtime): a build validates against its own marker, in any order
- `6e209a6` (2026-09-14) fix(runtime): trust is re-earned from bytes, never remembered
- `52b5470` (2026-09-14) the dump shows every visible line, and the bans read them all
- `db321a6` (2026-09-14) pairing: the square on screen, the phone does the rest
- `27e7e8a` (2026-09-14) fix(pairing): the quiet zone is geometry, not a viewBox wish — and the window rides real time
- `2129d15` (2026-09-14) the wire is input, not a promise: a render must degrade, never throw
- `f13b20f` (2026-09-14) a size nobody announced is a state, not a zero
- `f2a780d` (2026-09-14) feat(catalog): the exact file, pinned, with the promises the download checks
- `6508780` (2026-09-14) feat(launch): the server starts with a decision, not a default
- `c8acebc` (2026-09-14) the once promise is a registry, and the percentage must be true
- `c6b9a6e` (2026-09-14) feat(reuse): a model another tool already fetched is not fetched twice
- `42af816` (2026-09-14) feat(shell): Turn on is the walk, not a promise
- `dc99103` (2026-09-14) the first run says what is happening, why, and that it happens once
- `74766f8` (2026-09-14) feat(pairing): the square — the payload as the QR the shell draws
- `1c23105` (2026-09-14) feat(pairing): the computer can forget its phone, and the refusal names itself
- `d299b42` (2026-09-14) test(pairing): the leak sweep renders each secret's own Debug
- `5029097` (2026-09-14) test(runtime): a standing verdict must never launch anything
- `dbaa564` (2026-09-14) feat(pairing): pairing is a QR scan — a one-time code, a binding to this brain, and the phone's declaration kept optional
- `9eb9a6d` (2026-09-14) fix(runtime): the archive is what the table says it is
- `8e9d1b7` (2026-09-14) no action means no button, and a button always says what it does
- `d8ae797` (2026-09-14) delete dark mode: one palette we check beats two where one is decoration
- `8b22c12` (2026-09-14) dev(states): review dark mode without switching the OS
- `ecea22e` (2026-09-14) fix(catalog): span_of returns None for an empty set, not a fabricated pair
- `f6d6fea` (2026-09-14) dev(states): every state in one place, rendered by the real pages
- `a2536f2` (2026-09-14) refactor(catalog): the prediction carries its shape, so no formatter can be picked wrong
- `d789d79` (2026-09-14) feat(runtime): detection narrows, a disposable child decides
- `054efe2` (2026-09-14) fix(catalog): plain reason for the user, details for the working; floors print as floors; battery is a device property
- `7dfdb2c` (2026-09-14) feat(shell): a name, and no state without an exit
- `d02bf7e` (2026-09-14) feat(sentinel): the machine is guarded by its throughput, and every step down is announced
- `c2d43ef` (2026-09-14) fix(supervisor): the reason is data, and main.rs owns the words
- `7060d25` (2026-09-14) feat(catalog): published dense equivalents, an unmeasured state, and a user-facing name
- `1012862` (2026-09-14) docs: the README described a repo that no longer exists
- `d70aa67` (2026-09-14) feat(shell): three pages, and every invented value in one place
- `1f3cdf1` (2026-09-14) fix(catalog): claim capability on parameters, within the same shape
- `76e1b15` (2026-09-14) fix(download): the transfer is decided by bytes in hand, not by the socket
- `264128d` (2026-09-14) fix(download): the digest is the promise, and the part file is defended
- `fb16f28` (2026-09-14) feat(catalog): budget by the path, refuse spills, justify by capability or relief
- `9a9b2a7` (2026-09-14) feat(download): get a model file onto this machine, once, safely
- `11ea1af` (2026-09-14) fix(probe): the compute figure is a floor, and prefill no longer wears a memory band
- `68f2175` (2026-09-14) fix(probe): find the plateau, believe the best sample, and say which path it measured
- `5f581f4` (2026-09-14) feat(catalog): which model this machine should run, and why
- `872413a` (2026-09-14) feat(probe): measure the machine once, predict a model before downloading it
- `b968825` (2026-09-14) fix(supervisor): recognise our own orphan instead of killing strangers
- `d38c9c7` (2026-09-14) feat: desktop skeleton with a process supervisor

### origin/remote-brain tip ce71e78, 184 non-merge commits listed (189 total incl. merges) not reachable from origin/main
- `ce71e78` (2026-09-16) docs(brain): the mutation round, and the fix that no test defended
- `ffdd831` (2026-09-15) docs(brain): what the iroh spike measured, and the claim it did not test
- `6a4aeed` (2026-09-14) docs(brain): the bridge is decided — Tailscale is the free tier, iroh is the product
- `5357816` (2026-09-14) docs(brain): the census, the hostile round, and where the moat actually is
- `9d21c91` (2026-09-14) docs(brain): the night it ran for real
- `f828dd3` (2026-09-14) docs(brain): the security round, the measurement that reopened a row
- `279250e` (2026-09-14) docs(brain): what is built, and the two corrections the build forced
- `81d3451` (2026-09-14) docs(brain): pairing is a scan, and battery is two questions not one
- `7abe9e1` (2026-09-14) docs(brain): no formula converts a MoE into a dense size
- `0a3e2e3` (2026-09-14) chore: Gradle output under modules/ is not a native source
- `33d0dcc` (2026-09-14) fix(log): the server's own words no longer ship, in any build
- `0421ef0` (2026-09-14) fix(remote): log what we choose, key the attempt by what it reads, bound it in time
- `5792e0b` (2026-09-14) docs(brain): measured energy corrects which half of inference to move
- `6db2d8c` (2026-09-14) docs(brain): split the work by cost asymmetry, not by intelligence
- `83d7a09` (2026-09-14) docs(brain): the PC can win on capability or on the phone's battery
- `655416b` (2026-09-14) docs(brain): the 8 GB tier exists, because a MoE splits fits-in from runs-fast
- `37361e2` (2026-09-14) docs(brain): backend sizes kill the one-package idea, and support is a capability test
- `c551bbd` (2026-09-14) docs(brain): the GPU decides the memory budget, not just the speed
- `9ca47a1` (2026-09-14) fix(remote): read the server's context window, and own-property markers only
- `d1ef0c5` (2026-09-14) fix(remote): stale snapshots, redacted logs, and the token that never landed
- `6edb867` (2026-09-14) fix(app): a superseded ensure is not a failure
- `534bdc0` (2026-09-14) docs(brain): do not fork Jan, take its process supervision
- `312b583` (2026-09-14) fix(remote): stop advertising a context window the client cannot know
- `af5de37` (2026-09-14) refactor(remote): the remote model is the user's computer, whatever it runs
- `a805d3d` (2026-09-14) docs(brain): the tunnel is mandatory, the LAN is not a transport
- `7b3a32e` (2026-09-14) fix(remote): do not resolve error codes through Object.prototype
- `444d88a` (2026-09-14) fix(settings): no stale hydration, no silent loss, saved in the right order
- `895d844` (2026-09-14) fix(remote): a superseded operation never writes UI state
- `ad312bd` (2026-09-14) docs(brain): throughput decay is a sentinel, not an interlock
- `6c22751` (2026-09-14) docs(brain): reuse weights already on disk, never adopt someone else's process
- `d736a1c` (2026-09-14) docs(brain): embed the runtime, never make the user install a second thing
- `546adf7` (2026-09-14) docs(brain): specify Kalsa Brain, the desktop server for the phone
- `e32fd59` (2026-09-14) fix(remote): report the cause that actually happened
- `40708d7` (2026-09-14) fix(remote): close the other paths that could destroy the token or leak it
- `fa7f6ce` (2026-09-14) fix(copy): drop the local-model postscript from the network error
- `1d90e9e` (2026-09-14) fix(copy): never show internal text, never state a false cause
- `4112f09` (2026-09-14) fix(settings): track the remote draft dirty per field
- `e657550` (2026-09-14) fix(chat): never print a remote-brain error code in the conversation
- `c6e80e5` (2026-09-14) fix(settings): never commit an unhydrated remote draft
- `e8aa9c8` (2026-09-14) fix(engine): persist a local model when remote boot has no URL
- `09c4249` (2026-09-14) fix(ui): wait for remote settings hydration before selecting Mac
- `02c0b9f` (2026-09-14) fix(app): read __DEV__ from globalThis; restore absent vs undefined
- `41996b2` (2026-09-14) fix(engine): fail-closed URL policy inside the SSE transport
- `094fb5b` (2026-09-14) fix(engine): gate remote URL before reading SecureStore
- `589b8a5` (2026-09-14) fix(ui): never show remote_brain_* codes to the user
- `b564fff` (2026-09-14) fix(engine): demote orphan remote-without-URL to local on upgrade
- `732230e` (2026-09-14) fix(android): permit loopback cleartext in release network-security-config
- `2eb2ab3` (2026-09-14) fix(engine): allow loopback http in release; empty URL is not https_required
- `5b021ab` (2026-09-14) fix(app): route the Mac button through selectModelById
- `2a9f725` (2026-09-14) docs(server): record spawn/lock residual; stamp child pid into the lock
- `2eb782e` (2026-09-14) fix(app): boot catch forces local backend through the gated setter
- `d55da50` (2026-09-14) fix(app): defer Mac selection while a send claim is held
- `5d630f7` (2026-09-14) fix(app): bound native dispose on the remote model switch
- `0608791` (2026-09-14) fix(app): apply local boot backend through the gated setter
- `48b0f0f` (2026-09-14) fix(app): surface switch dispose rejection instead of swallowing it
- `d4a1ea0` (2026-09-14) fix(engine): abort queued native init when generation/intent is stale
- `de96fe6` (2026-09-14) fix(server): serialize stale-lock reclaim under a mkdir mutex
- `a45fbab` (2026-09-14) fix(server): reclaim a dead run.sh lock with atomic rename
- `0aeb655` (2026-09-14) fix(app): do not reprobe after a failed model-switch dispose
- `31aac53` (2026-09-14) fix(app): selecting the previous local model while remote is not a no-op
- `5bf1e76` (2026-09-14) fix(engine): hydration is read-only; only setEngineBackendMode writes cache
- `9c8cd2c` (2026-09-14) fix(engine): freeze SSE after any terminal finish_reason, not only [DONE]
- `441ec9d` (2026-09-14) fix(server): never steal a run.sh lock that has no pid file
- `6e48705` (2026-09-14) fix(app): skip modelIndex probe during switch so local intent cannot be overwritten
- `f9ea867` (2026-09-14) test(engine): hydrate truncated from storage JSON and mid-stream A/B
- `d1fa670` (2026-09-14) fix(engine): fire onDone/onError even if finalize or onModel throws
- `58f09b2` (2026-09-14) fix(engine): skip post-terminal abort consume and closed activeStream
- `f6fcf50` (2026-09-14) fix(server): do not steal a run.sh lock that has no pid yet
- `7bbd8e0` (2026-09-14) fix(app): capture ensure intent before thermal so stale remote cannot commit
- `65a04e5` (2026-09-14) fix(engine): freeze terminal SSE state after [DONE]
- `372190e` (2026-09-13) fix(server): treat http(s)://[::1] as loopback in test-sse
- `0a394fa` (2026-09-13) fix(server): refuse non-loopback mtplx --no-auth and honor terminal onerror
- `49640d5` (2026-09-13) fix(engine): treat non-2xx remote SSE as failure even with [DONE]
- `b07589d` (2026-09-13) fix(chat): restore truncated marker after reload
- `13a4143` (2026-09-13) fix(engine): catch stringify/send failures inside the transport
- `51be011` (2026-09-13) fix(engine): stop delivering SSE frames after reentrant abort
- `7c83fa2` (2026-09-13) fix(engine): release remote inFlight before UI callbacks
- `0da4480` (2026-09-13) fix(app): stale remote ensure cannot reassert remote after local select
- `4505130` (2026-09-13) fix(engine): per-stream generation so dispose cannot clobber a later turn
- `83609f6` (2026-09-13) fix(engine): explicit finish_reason wins over [DONE] synthetic stop
- `643f456` (2026-09-13) test(engine): cover remote stream/lifecycle edges and pin index.js entry
- `76f56fe` (2026-09-13) fix(engine): strip think tags on remote stream and keep status monotonic
- `9a839bd` (2026-09-13) fix(server): lock run.sh attach/spawn and verify /v1/models
- `61a6eba` (2026-09-13) fix(app): disable research and translate in remote mode
- `20c341d` (2026-09-13) fix(security): lock remote URL policy and scrub tailnet identifiers
- `a6c76a0` (2026-09-13) fix(engine): send kalsa system prompt on remote OpenAI turns
- `2ba308b` (2026-09-13) fix(engine): keep virtual remote model id separate from server model id
- `780bcd3` (2026-09-13) fix(engine): abort remote stream on dispose and switch backends in order
- `11ef174` (2026-09-13) fix(engine): remote inactivity timeout and abort-before-send
- `7a0fb9d` (2026-09-13) fix(engine): remote stream succeeds only on onload plus terminal marker
- `fc0e59f` (2026-09-13) fix(app): wait for remote SSE to finish and hydrate backend first
- `2c3c452` (2026-09-13) feat(engine): add remote Mac brain backend and settings
- `29b19b3` (2026-09-13) feat(server): serve Ornith via existing mtplx OpenAI endpoint
- `0cc8004` (2026-09-13) docs(server): Tailscale Serve is disabled on this tailnet
- `8ac8662` (2026-09-13) docs(server): record local Ornith is MTPLX safetensors, not GGUF
- `b74b341` (2026-09-13) feat(server): add mac-brain llama-server scripts and docs
- `0693577` (2026-09-13) fix(engine): stall 45s think gap; do not wipe live chat KV
- `a8bef03` (2026-09-13) fix(engine): do not wipe or idle-unload live chat KV
- `f34548a` (2026-09-12) fix(engine): length-1 bake rematch sticks to the previous last user
- `4a1504f` (2026-09-12) fix(engine): one unprefixed KV heal per engine hold
- `3dd5f6b` (2026-09-12) fix(session): restore interrupted turns that still have visible text
- `326e971` (2026-09-12) fix(session): restore G1 chats that lack modelEmittedText
- `b47872b` (2026-09-12) fix(session): compare native save to lastChatNPast, not nCtx
- `258e3e9` (2026-09-12) fix(session): hash persistable history on save and load
- `145b3ac` (2026-09-12) fix(app): dispose idle engine without skipping background unload
- `3e241cc` (2026-09-11) fix(engine): re-apply baked facts; heal wiped tails with one cold prefill
- `0e1e4fd` (2026-09-11) fix(engine): clamp off-mode window to live KV start
- `96abaf9` (2026-09-11) fix(engine): keep anchored KV prefix; short think on calc turns
- `b473f39` (2026-09-11) fix(session): align hybrid save/load; clear KV flags on failed restore
- `b4ef9f2` (2026-09-11) fix(session): refuse inconsistent hybrid KV saves; EMA 5 samples
- `a119a29` (2026-09-11) fix(engine): snapshot live chat KV before memory extract
- `6624e87` (2026-09-10) fix(patch): repair llama.rn hunk header so patch-package can parse
- `6815ae9` (2026-09-10) fix(engine): replay think via reasoning_content; restore hybrid KV prefix
- `6194e8d` (2026-09-10) fix(session): evict other-model KV first; testID drawer rows
- `0c6cdfa` (2026-09-10) fix(session): hash load prompt-env the same way as save
- `c32b46f` (2026-09-10) fix(chat): show sheet Copy for non-empty text; withhold decode EMA for 3 samples
- `9c3bbaf` (2026-09-10) fix(engine): bound model-switch dispose so a hung stop cannot freeze the UI
- `d0fd4f1` (2026-09-10) feat(chat): add Regenera on the assistant action sheet
- `bb2972a` (2026-09-10) chore(embed): add deterministic progress telemetry
- `73837cc` (2026-09-10) fix(memory): forward chat cancellation to extraction
- `f58c4bd` (2026-09-10) fix(session): derive engine identity from native build inputs
- `1ee3639` (2026-09-10) fix(session): bind the saved KV to the model file and the engine build
- `1cbc2a5` (2026-09-10) chore(a11y): testIDs and button semantics on message actions (more/copy/edit) for the device harness
- `d48c86b` (2026-09-10) fix(lifecycle): commit the Android sources of kalsa-lifecycle (blanket android/ ignore swallowed them)
- `a6d800e` (2026-09-10) fix(lifecycle): native background timer and trim-memory bridge for the dispose grace
- `53a05cb` (2026-09-10) fix(memory): extraction budgeted by measured speed, aborted by the next send
- `36c6e9d` (2026-09-10) fix(thinking): nPredict 2048 for the 512/1024 budgets, harness guard updated
- `8140fce` (2026-09-10) feat(thinking): budget per model chosen by measured decode speed
- `fd67024` (2026-09-09) perf: fail fast on stalled generation, memory admission on cold load, background dispose grace
- `d28cc16` (2026-09-09) fix(embed): log [embed] done and the error on the job exception path
- `0def01f` (2026-09-09) refactor(documents): split documentChatTool.ts into 15 modules, no behaviour change
- `d66effa` (2026-09-09) fix(documents): tell the model to answer in the user's language, not the document's
- `53c5be4` (2026-09-09) feat(session): keep the pre-tool .kvs prefix as a warm restore point after a tool turn; feed prefill speed
- `910290b` (2026-09-09) feat(documents): gate full_context on the phone's prefill budget, not only on context size
- `2ffed30` (2026-09-09) docs: archive every historical document under archived/; two living docs remain in kalsa-moe-experiments (PLAN, ALIVE)
- `1c3a8f1` (2026-09-09) docs: §7.45 measured after the v2b repair; MiniCPM5 @256 bare-'>' budget gap
- `b97322e` (2026-09-09) native(llama.rn): synchronize before reading perf counters in the completion result
- `51e179d` (2026-09-09) docs: §7.44 verified on device with 45f04d9
- `45f04d9` (2026-09-09) fix(prewarm): do not gate success on prompt_ms — dense models never sync perf counters at n_predict=0
- `81d0bff` (2026-09-09) quality: allow llama-server binary and port overrides via env (KALSA_LLAMA_SERVER, KALSA_QUALITY_PORT)
- `7618fb4` (2026-09-09) docs: HARNESS_FINDINGS §7.41-7.45 (product track 2026-09-09) and KALSA.md state line
- `8672ded` (2026-09-09) fix(documents,share): real PDF text extraction, lenient doc selection, share-to-Kalsa intents
- `b7b941e` (2026-09-09) fix(prompt): answer in the language the user writes in, locale only as fallback
- `e35f7fb` (2026-09-09) feat(models): MiniCPM5-2B Q4_K_M opt-in dev catalog entry + one-time sha256 verification
- `e2abf7a` (2026-09-09) docs: add the chat-optimisation proposal (owner plan, rev 2, 2026-09-09)
- `ef8a10e` (2026-09-08) governor: enable the GPU prefill route on V75 (owner decision on ALIVE 60)
- `41d7009` (2026-09-07) build: bump kalsallama pin to 67c73d26c (f32 product in the Adreno q4_0 and q4_K GEMMs)
- `670a683` (2026-09-07) Merge feat/moe-stream into feat/governor-in-app
- `468f579` (2026-09-06) bench: return a Promise from stopCompletion (restore the JS contract broken in 68af878)
- `68af878` (2026-09-06) bench: restore llama_synchronize in the oracle hook and keep steps with no logits visible instead of truncating
- `88581fc` (2026-09-06) bench: guard the logit-oracle hook against null logits and exhausted forced ids (SIGSEGV on the GPU-prefill arm)
- `e06479b` (2026-09-06) bench: toolchoice=none also drops tools from the system prompt and the KV prewarm; guard structured execution
- `4a84e03` (2026-09-06) bench: toolchoice=none drops tools from the completion and skips the fallback parser
- `6cf658a` (2026-09-06) bench: raw pre-sampler top-N probs + forced-id sequence (logit oracle, bench-only)
- `ed9521f` (2026-09-06) build: bump kalsallama pin to 3bec271fd (governor on opencl picks + Adreno non-contiguous src0 gate, 750 MUL_MAT 925/0)
- `9bc56b6` (2026-09-06) build: bump kalsallama pin to 9c28322ac (bench_force_gpu_prefill lever)
- `55c68a8` (2026-09-06) governor: map SM7675/SM8635 to V73, pass bench_force_gpu_prefill (bench lever; V73 stays allowlisted off)
- `270f3b3` (2026-09-05) build: bump kalsallama pin to e31b9144c (perf reset clears async timing)
- `3451346` (2026-09-05) feat(governor): per-generation GPU-prefill correctness gate (V75 off until the 750 f16-batched defect is handled)
- `a57a614` (2026-09-05) build: bump kalsallama pin for per-turn prefill route reset
- `e0dbc39` (2026-09-05) build: bump kalsallama pin for Wait prefill degradation
- `ac7ed23` (2026-09-05) fix(governor): clear KV and skip sessions
- `29b84a8` (2026-09-05) fix(governor): report prefill timing and route facts
- `85719d8` (2026-09-04) build: bump kalsallama pin to e1a0f5028 (chunked governor prefill)
- `0b9490b` (2026-09-04) fix(governor): send gpu_prefill_measured for V75/V79; truthful prewarm result
- `a28b17a` (2026-09-04) fix(governor): admit safe final prefill tails
- `623407a` (2026-09-04) fix(governor): shouldUseMTP returns false in governor mode instead of throwing
- `3e4de20` (2026-09-04) fix(android): correct ReactPackage import in GovernorBatteryModule
- `f384c66` (2026-09-04) build: bump kalsallama pin to e131345b7 (governor init failure reason)
- `cf6bf41` (2026-09-04) feat(engine): add greedy bench sampling telemetry
- `c5e05cf` (2026-09-04) fix governor native bridge diagnostics
- `b57af0f` (2026-09-04) harden governor fallback and turn telemetry
- `f05dccf` (2026-09-04) fix governor device probes and fit gate
- `4443f71` (2026-09-04) wire governor runtime and thermo inputs
- `2797b90` (2026-09-04) add governor thermo native bridge
- `d3f1d99` (2026-09-04) fix governor fallback logging and reload cleanup
- `a7f2f7b` (2026-09-04) normalize governor init fallback stage
- `8da4bc3` (2026-09-04) document governor post-load convergence
- `f413c6c` (2026-09-04) fix governor owner failure and thermo paths
- `094ece4` (2026-09-04) feat: add governor owner and context routing
- `36edb85` (2026-09-04) build: overlay governor v0.3 sources
- `99a0a9d` (2026-08-28) Correct bench dev model startup and metadata
- `51d8e3d` (2026-08-27) Add opt-in dev GGUF model catalog
- `6e99270` (2026-08-27) ci: build and verify pinned engine APK

### origin/chat tip f45a8d7, 25 commits not reachable from origin/main
- `f45a8d7` (2026-09-17) Round 25: named reserve in refusal text, continuous context budget meter
- `ac319c4` (2026-09-17) Round 24: file attachments pinned in context with honest fit checks, local-only extraction
- `25d4a1c` (2026-09-17) Round 23: empty-string precedence, non-stream reasoning, throttled persistence, incremental ticker, document-wide stillness
- `32effaf` (2026-09-17) Round 22: reasoning separated from answers, thought cloud with meaningful motion
- `6d25ded` (2026-09-17) Round 21: reorder log chronologically, certify full suites green after preview strip
- `5f49118` (2026-09-17) Round 20: hygiene log, Cmd+K focus assertion
- `0c485dd` (2026-09-17) Round 19: remove screenshots and references of the retired arc-conversations product
- `e2bfc77` (2026-09-17) Round 18: crescent navigates six surfaces, conversation sidebar with search, remote images blocked, CSP
- `931179d` (2026-09-17) Round 17: honest chat client (URL composition, non-SSE, truncation, idle timeout), per-conversation streams
- `92ace96` (2026-09-17) Round 16: split store into index plus per-conversation payloads, migration, quota banner, storage events, verify suite
- `5f85878` (2026-09-17) Round 15: fix undefined white token, computed-style contrast check, message validation, error boundary, verify harness
- `4c0cef8` (2026-09-17) Round 14: final review, all twelve states covered, handoff notes for real endpoint and Tauri bundle
- `205b657` (2026-09-17) Round 13: production perf check, Tauri app icons from the crescent mark
- `378c641` (2026-09-16) Round 12: sample crescent motion curve, measure 200-message thread performance
- `63b9774` (2026-09-16) Round 11: verify dark crescent open state with screenshot
- `5b86140` (2026-09-16) Round 10: crescent handle carries accent breath and count when conversations exist
- `2a42f1c` (2026-09-16) Round 9: orphaned empty responses become retryable, hover timestamps, verified with screenshot
- `ebe19ae` (2026-09-16) Round 8: live-region announcements, Tauri CLI probe, full 27-shot regression green
- `f82aacf` (2026-09-16) Round 7: clip crescent glow overflow on narrow windows, verify few/active/narrow arc states
- `1816ade` (2026-09-16) Round 6: verify 401-recovery flow and mid-stream conversation switch with screenshots
- `88ab2c0` (2026-09-16) Round 5: verify settings, validation, delete-confirm, keyboard focus with screenshots
- `aa446a8` (2026-09-16) Round 4: verify first-token wait, dark 401, copy confirm, 5000-line paste, reduced-motion with screenshots
- `44e5c83` (2026-09-16) Round 3: crescent label width for long titles, verify paging/keyboard/200msgs/narrow/wide/dark with screenshots
- `29f3a47` (2026-09-16) Round 2: verify 401, stop-midway, heavy-markdown states with screenshots, no app changes needed
- `656c18c` (2026-09-16) Round 1: Vite+React+TS skeleton, green oklch tokens, empty states, streaming chat, crescent nav, shot harness
