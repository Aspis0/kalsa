# HOSTILE AUDIT — bench-dev-models (e687d777) vs origin/main

- Clone: /Users/marco/Projects/kalsa-devmodels (read-only)
- HEAD: e687d777a4c86c2930f1a3dd621de1d3cd004bb6 ("Add opt-in dev GGUF model catalog"), 1 commit ahead of origin/main
- Report: incremental append. Verdicts: CONFIRMED / PLAUSIBLE / REFUTED.

---

## DIFF STAT

11 files, +300/−10. Files match the claimed list exactly:
.github/workflows/build-kalsa-apk.yml (+1/−1), app.config.js (+1), plugins/withDebuggableRelease.js (new +22),
src/app/AppShell.tsx (+28/−10 net), src/bench/benchConfig.ts (+33), src/engine/ModelDownloader.ts (+33),
src/engine/ModelRegistry.ts (+16), src/engine/devModelCatalog.ts (new +122), src/engine/modelHost.ts (new +43),
src/i18n/en.ts (+5), src/i18n/it.ts (+5).

Verification runs: `npx tsc --noEmit` on the clone → exit 0 (clean). `find . -name "*.test.*" -o -name "*.spec.*"` outside node_modules → 0 files.

---

## F1 — PRODUCTION REGRESSION: three startup effects now await an AsyncStorage read (lever ABSENT ≠ unchanged)

**Verdict: CONFIRMED (behavioral delta; small but real, and it violates the stated "lever absent → unchanged" contract).**

AppShell.tsx inserts a new effect (lines 645–658) that must resolve an AsyncStorage read before anything is configured:

```
646:  const [modelCatalogReady, setModelCatalogReady] = useState(false);
647:  useEffect(() => {
648:    let mounted = true;
649:    void getDevModelsEnabled()
650:      .catch(() => false)
651:      .then((enabled) => {
652:        if (!mounted) return;
653:        configureModelRegistry(enabled);
654:        setModelCatalogReady(true);
```

Three previously-at-mount effects are now gated:

- `2420: if (!modelCatalogReady) return;` — model restore effect (deps changed `2433: }, [modelCatalogReady]);`)
- `2884: if (!modelCatalogReady) return;` — eager engine kick effect (deps `2916: }, [modelIndex, modelCatalogReady]);`)
- `3956: if (!modelCatalogReady || activeOverlay?.kind !== "settings") return;` — settings disk-scan effect

The eager kick is the TTFT/prewarm path. QUOTES from the gated effect:
```
2891:        const model = MODEL_REGISTRY[checkedIndex];
2892:        const ok = await isModelBundleDownloaded(model);
...
2898:            if (claimEagerKick(model.id, generation)) {
```
`claimEagerKick` (ttftFlags.ts:90–95) is one-shot per process+generation; previously claimed at mount, now claimed only after AsyncStorage resolves + a re-render. **The prewarm/ensureEngineForModel sequence is delayed by one AsyncStorage round-trip + state update + effect re-run on EVERY production cold start, lever absent included.**

Also: the model chip is disabled while state is "checking" —
```
4736:                modelState === "checking" ||
4737:                (modelState === "ready" &&
```
inside `disabled={...}` at 4731–4738 — so the "dead chip" window at startup is extended by the lever read.

**Consumers of MODEL_REGISTRY that run BEFORE configureModelRegistry resolves** (the inconsistency window when lever is ON):
- AppShell.tsx:2371–2373 — lazy useState initializer runs at FIRST RENDER (pre-configure):
```
2371:  const [modelIndex, setModelIndex] = useState(() =>
2372:    Math.max(0, MODEL_REGISTRY.findIndex((m) => m.id === getDefaultModel().id)),
```
  With lever ON, this computes over the base 4-entry array. Harmless today (default model index is 0 in both states) but proves the render-1/steady-state divergence exists.
- Module-load-time consumers: NONE found. Full grep of `MODEL_REGISTRY|getDefaultModel|getModelById|isHybridOrKvUnifiedModel` outside ModelRegistry.ts: LlamaService.ts (runtime calls 596/1056/1781/2091), SettingsScreen.tsx (component render 798/1765, mounted only as AppShell overlay), AiChatPage.tsx:1819 (runtime), WhisperService.ts:19 imports only `WHISPER_MODEL`. No module-scope derived values. **So: no cache-before-configure bug exists today — the regression is purely the added latency, not state divergence.**
- Settings disk-scan (3960: `MODEL_REGISTRY.map(...)`) re-runs when the flag flips (dep added), so a fast settings-open cannot observe the un-configured array.

Pre-existing-shape note: the stale-index race in the eager kick (restore's setModelIndex vs the kick's `checkedIndex` guard at 2895 `if (mounted && modelIndexRef.current === checkedIndex)`) is the same shape as on main; the flip re-run covers the restored model. Net new: only the delay.

---
## F2 — configureModelRegistry: push/splice on the exported array

**Verdict: PLAUSIBLE (idempotent and provably non-interleaved today; the splice is latent-fragile by design, plus a swallowed-failure path that permanently gates the three effects).**

ModelRegistry.ts:208–218:
```
208:let devModelsAdded = false;
210:/** Append/remove the opt-in catalog while keeping existing sync consumers intact. */
211:export function configureModelRegistry(devModelsEnabled: boolean): void {
212:  if (devModelsEnabled === devModelsAdded) return;
...
215:    MODEL_REGISTRY.push(...DEV_MODEL_REGISTRY);
...
216:    MODEL_REGISTRY.splice(-DEV_MODEL_REGISTRY.length, DEV_MODEL_REGISTRY.length);
```

- **Double invocation / Strict Mode / repeated AppShell mounts:** safe. Guard at 212 makes configure idempotent; AppShell's mount effect only calls configure when `mounted` (651–654). The AppShell effect's cleanup (`656–658`) does NOT revert the registry — the catalog stays appended after unmount, which is what makes re-mounts idempotent.
- **onPersistenceFailure remounts:** no such path exists. App.tsx:147 renders `<AppShell />` bare; `onPersistenceFailure` is never passed anywhere (grep: only AppShell.tsx:629/639/980–998 define/consume the prop via ref, no remount). REFUTED as a live risk.
- **Hot reload (Metro HMR):** ModelRegistry.ts exports no component; an edit forces a full module re-evaluation, re-creating BOTH the array and the flag together. Consistent. REFUTED as a divergence source.
- **Can anything append between push and splice?** push (when enabled=true) and splice (only in a LATER call with enabled=false) are in different invocations; JS is single-threaded. Exhaustive grep for mutations: `MODEL_REGISTRY.(push|splice|pop|shift|unshift|=)` → only lines 215/216. So splice(-6,6) always removes exactly the 6 entries pushed earlier. **No interleaving path exists today — the invariant holds by exhaustive absence, not by structural protection.**
- **Latent fragility:** the design keys off a boolean, not the array. If `devModelsAdded === true` ever coexists with a MODEL_REGISTRY of length < 6 (future filtering code, manual truncation), `splice(-6, 6)` clamps the negative start to 0 and deletes BASE entries. Nothing today triggers it → PLAUSIBLE, latent.
- **Swallowed failure path:** AppShell.tsx:649–655 —
```
649:    void getDevModelsEnabled()
650:      .catch(() => false)
651:      .then((enabled) => {
652:        if (!mounted) return;
653:        configureModelRegistry(enabled);
654:        setModelCatalogReady(true);
```
`.catch()` only guards getDevModelsEnabled. If `configureModelRegistry` throws, the `.then` body rejects an unobserved void promise, `setModelCatalogReady(true)` never runs, and all three gated effects stay dead for the whole session (no model restore, no eager kick, no settings scan) with zero surfaced error. Requires the latent splice fault to fire → PLAUSIBLE, consequence severe, probability ~0 today.

---
## F3 — WRONG METADATA on the three Marco entries: `hybrid: true` on qwen3moe MoE (attention-only) — CONFIRMED with two live runtime consequences

**Ground truth (campaign's own records, kalsa-moe-experiments):**
- ops/memory-backup-2026-08-27/kalsa-model-nicknames.md:18:
  `- **Marco / Marco1c** = Marco-Mini-Instruct-KEXP.gguf (qwen3moe, 28 layer,`
- mandates/trial-marco.md:31–33: `mradermacher/Marco-Mini-Instruct-i1-GGUF → i1-Q4_K_M.gguf` `(10 505 424 704 B …)` with upstream config `ATH-MaaS/Marco-Mini-Instruct`. The i1 size matches devModelCatalog.ts dev-marco-i1 `sizeBytes: 10_505_424_704` EXACTLY (same artifact), so the identity (qwen3moe MoE) transfers.

**What the catalog claims instead (devModelCatalog.ts:36–48 + entries 71–100):**
```
36:const LFM25_DEFAULTS: CatalogDefaults & {
37:  hybrid: true;
38:  thinking: { short: number; extended: number };
...
41:  vendor: "Liquid AI",
43:  kvCache: { k: "q8_0", v: "q4_0" },
44:  hybrid: true,
```
and all three Marco entries spread LFM25_DEFAULTS (e.g. `79:    ...LFM25_DEFAULTS,` / `hfRepo: "LiquidAI/LFM2.5-8B-A1B-GGUF",`). Vendor "Liquid AI" and the LiquidAI hfRepo are fiction for Marco files (inert while unpublished — F4 — but misleading). The `hybrid: true` is NOT inert. Consumers quoted:

**(a) High-RAM n_ctx upgrade fires on a non-hybrid model → unmodeled 2x KV.**
contextProfile.ts:137–143:
```
141:    if (
142:      hybrid &&
143:      typeof totalMemoryBytes === "number" &&
144:      totalMemoryBytes >= HIGH_RAM_BYTES
145:    ) {
146:      nCtx = Math.max(catalogCtx, HIGH_RAM_N_CTX);
```
On any dev phone reporting ≥ 7.5e9 bytes totalMemory (the campaign Jelly Star is 8 GB), every Marco entry inits at n_ctx 16384 instead of the catalog 8192 — full-attention MoE KV at 16k (k q8_0 / v q4_0), double what the catalog values imply. Compounding: `kvBytesPerToken` is absent on ALL six dev entries, and the estimator contract (ModelRegistry.ts:81–88: "Absent → estimator callers must pass 0 / treat KV as unknown rather than fabricating a value") makes the fit gate count ZERO KV — the gate is blind to exactly the memory the wrong flag creates. On the S23 (7 GB reported / tier mid, < 7.5e9) the upgrade does not fire, which hides the bug from the S23-only campaign.

**(b) Prewarm-after-restore skip logic is inverted for Marco.**
ModelRegistry.ts:291–299:
```
296:export function isHybridOrKvUnifiedModel(id: string): boolean {
297:  const model = MODEL_REGISTRY.find((entry) => entry.id === id);
298:  return model?.hybrid === true || model?.kvUnified === true;
```
→ returns TRUE for Marco entries (hybrid:true). Consumed at LlamaService.ts:594–600:
```
596:      isHybridOrKvUnifiedModel(activeModelId ?? ""),
```
feeding prefixPrewarm.ts:95–105:
```
95: Dense restore populated real chat KV. A system+user"." prewarm would
96: seq_rm-succeed and delete the restored tail; first send then re-prefills
97: the whole history. Hybrid/kvUnified restores are not real (n_past=0) —
98: never skip those.
101:export function shouldSkipPrewarmAfterRestore(
102:  kvHoldsChatSession: boolean,
103:  hybridOrKvUnified: boolean,
104:): boolean {
105:  return kvHoldsChatSession === true && hybridOrKvUnified === false;
```
Marco (dense-attention MoE) performs a REAL dense restore (sessionPersistence.ts:69–81: `n_past: input.hybridOrKvUnified ? 0 : tokens_on_disk` — for Marco the flag is true → meta records n_past 0, and per LlamaService:590 "hybrid restore reports ok:true while native n_past=0"). With the flag true, `shouldSkipPrewarmAfterRestore` returns false → the static-prefix prewarm is NOT skipped after a restore that DID populate real KV → seq_rm deletes the restored tail / re-prefills — the exact dense-restore failure the comment warns about. CONFIRMED behavioral bug on the dev phone after any Marco session restore.

**(c) Consistency smell that betrays blind copying:** Marco entries set `hybrid: true` but NOT `kvUnified` (LFM25_DEFAULTS:36–48 has no kvUnified; only QWEN35_4B_DEFAULTS:27 sets it). So AppShell init passes `kvUnified: model.kvUnified` → undefined → no `kv_unified` engine param (AppShell.tsx:3168/3648), while isHybridOrKvUnifiedModel says hybrid. If the implementer believed LFM2.5-style hybrid, kvUnified should have been set like Qwen's. It wasn't — the attention-only truth leaked through one field and the flag didn't.

**(d) `thinking` on Marco — REFUTED as a risk.** thinkingBudgets.ts:64–75: budgets are consulted only in bench modes `budget256`/`budget512`; production resolves mode "default" → `enable_thinking: false` (72–80, 86–93). Marco's 256/512 equals the absent-default (256/512/1024). Zero behavioral difference. (The brief's "campaign treats thinking as always-on with budgets only for hybrids" concerns the CLI campaign, not this app path.)

**(e) OLMoE contextLength 8192 vs trained 4096 — CONFIRMED wrong, drives a real clamp.**
devModelCatalog.ts:39–53 (TEXT_DEFAULTS: `contextLength: 8192, engineCtx: 8192`), applied to dev-olmoe (~101–113, `revision: "main"`). deviceTuning.ts:492–498 hard-clamps the requested n_ctx to it:
```
494:    typeof model.contextLength === "number" &&
495:    Number.isFinite(model.contextLength) &&
496:    model.contextLength > 0
497:  ) {
498:    requested = Math.min(requested, Math.floor(model.contextLength));
```
OLMoE-1B-7B-0924 trains at 4096 (model card; no rope scaling in the GGUF). Engine init at n_ctx 8192 = 2x beyond trained window (llama.cpp warns and proceeds; rope positions past 4096 degrade; KV double-sized). Nothing divides-by/asserts on these fields (tsc clean; CTX_FLOOR only floors), so no crash — but the catalog number directly drives the engine. (4096 figure is from the model card, not from reading the GGUF header — flag as high-confidence.)

**(f) dev-olmoe `revision: "main"`** (~107) — every other entry pins a SHA; registry header (ModelRegistry.ts:5–6) documents "revision = SHA del repo pinnato (URL immutabili)". Inert today (unpublished short-circuit precedes any hfRepo use) but violates the stated invariant.

**(g) dev-qwen4b-c1 omits `mtp`** (entry ~64–76) although its hfRepo is the MTP repo (`unsloth/Qwen3.5-4B-MTP-GGUF`) and the base entry sets `mtp: { nMax: 3 }`. The `/bench speculative mtp` arm can't run on this dev quant. Minor parity gap.

**probeStateCache: REFUTED as a consumer** — grep across src/ finds no such symbol in this codebase; `hybrid`/`kvUnified` are consumed at AppShell.tsx:3168/3648 (init params), contextProfile.ts:142 (ctx), LlamaService.ts:596 (prewarm skip), 1781 (KV diag telemetry only), sessionPersistence.ts:69–81 (n_past meta). Full consumer list accounted for.

---
## F4 — Download path: no route to the real hfRepo while KALSA_HF_ORG is null — CONFIRMED SAFE (proof chain below)

modelHost.ts:6: `export const KALSA_HF_ORG: string | null = null;` — compile-time constant, no env read.

Resolution order (modelHost.ts:11–43):
```
11:  if (spec?.hfRepo) {
12:    return { status: "published", hfRepo: spec.hfRepo, ... };
...
17:  if (model.hfArtifactRepo) {
18:    if (KALSA_HF_ORG === null) {
19:      return { status: "unpublished", artifact: spec?.file ?? model.file, owner: "kalsa" };
```
- All 6 dev entries carry `hfArtifactRepo: DEV_ARTIFACT_REPO` and no mmproj. The main-file spec built by downloadModelBundle is `{ file, sizeBytes }` ONLY — ModelDownloader.ts:415: `const modelOutcome = await downloadFile(model, { file: model.file, sizeBytes: model.sizeBytes }, options, ...)` — NO hfRepo, so the spec branch is skipped and resolution hits the unpublished branch.
- **Top-of-function guard, before any network:** ModelDownloader.ts:370–382:
```
370:  const modelResolution = resolveModelArtifact(model);
371:  if (modelResolution.status === "unpublished") {
372:    throw new UnpublishedArtifactError(modelResolution.artifact);
```
  This precedes every `downloadFile`/`FileSystem.createDownloadResumable` call (resume task construction is inside downloadFile, line ~218). No dev download can even start, hence no resume state can ever be written for a dev id.
- **The only way to reach a real repo would be a spec carrying its own hfRepo.** Spec producers (exhaustive): downloadModelBundle main file (no hfRepo) and `model.mmproj` (line 427: `downloadFile(model, model.mmproj, ...)`) — dev entries have no mmproj. `deleteModelFiles` builds specs but performs no network. `hfFileUrl` external callers: none (grep: only ModelDownloader.ts:222 internal). mmproj-spec risk therefore structurally absent for dev entries.
- **Resume-key logic is id/revision-scoped:** ModelDownloader.ts:77–81:
```
79:  const revision = spec?.revision ?? model.revision;
80:  return `${RESUME_KEY_PREFIX}${model.id}.${revision}.${file}`;
```
  A stale resume blob embeds its own URL (expo DownloadResumable state), but a dev resume key can only exist if a dev download started — impossible per the guard above. Directory scoping also isolates: modelLocalPath is `${MODELS_DIR}${model.id}/${file}` (line 43), so a dev slot cannot be populated by a base model's file.
- **Base-model behavior unchanged:** for entries without hfArtifactRepo, resolveModelArtifact returns `hfRepo: model.hfRepo, revision: spec?.revision ?? model.revision` (lines 35–42), which reproduces the old `spec?.hfRepo ?? model.hfRepo` / `spec?.revision ?? model.revision` composition for every existing case (including the Qwen mmproj spec with its own repo+revision). Same URLs, zero behavioral delta.
- **friendlyNetworkError additions (ModelDownloader.ts:109–114):**
```
111:  if (error instanceof UnpublishedArtifactError) {
112:    return new Error(strings.errors.artifactUnpublished.replace("{artifact}", error.artifact));
113:  }
114:  const unpublishedPrefix = strings.errors.artifactUnpublished.split("{artifact}")[0];
115:  if (message.startsWith(unpublishedPrefix)) {
```
  Works for AppShell's confirmDownload catch (3431 try → friendlyNetworkError). Cosmetic edge: any error whose message happens to start with the localized prefix ("Cannot download " / "Impossibile scaricare ") bypasses network-pattern translation. Harmless.
- Future-flip caveat (not a defect today): if KALSA_HF_ORG becomes non-null, the published branch hardcodes `revision: "main"` (line 26) and resumable blobs from a prior mixed build could theoretically resume against a different URL — mitigated by the exact-size final check (info.size !== file.sizeBytes → delete+throw, lines 351–360) and the >1% expected-size resume discard (198–207). Same-size wrong-source files would pass both — accept for dev.

**F4 verdict: CONFIRMED — no code path hits the real hfRepo for the 6 dev entries while KALSA_HF_ORG === null; production download URLs unchanged.**

---

## F5 — Fit gate: minRamTier "low" lets everything past the tier check; the 10.5 GB i1 survives only via the transient RAM probe

**Verdict: CONFIRMED (mechanics), with a misleading-UI note and a doc-contract violation in the field choice.**

- Tier gate (deviceProfile.ts:142–144):
```
143:  if (modelMinRamTier !== undefined && !ramTierMeets(ramTier, modelMinRamTier)) {
144:    return { allowed: false, reason: "blocked_tier" };
```
  With `minRamTier: "low"` on all six dev entries (devModelCatalog.ts:28/42/51), `ramTierMeets(mid, low)` is true on the S23 (7 GB reported → tier "mid", RAM_TIER_ORDER[mid]=1 ≥ [low]=0). **The tier gate never blocks any dev model, including dev-marco-i1 at 10.5 GB.**
- Secondary checks then run: blocked_ram compares `modelNonEvictableMiB > availableMiB` (deviceProfile.ts:157–174). The estimate (deviceProfile.ts:192–217 → estimateMemory) uses `kvBytesPerToken: model.kvBytesPerToken` → undefined → 0 (deviceProfile.ts:206–209), so for i1: repack ≈ 10,505 MB × 0.895 + 249 compute ≈ 9,660 MiB non-evictable. On the S23 with ~5–6 GB MemAvailable → `blocked_ram` fires → Settings hard-blocks download AND select (`hardBlocked = gate?.allowed === false && !active`, SettingsScreen.tsx:1796) and AppShell's confirmDownload gateForModel (335–351) blocks the confirm path. **So the 10.5 GB model is stopped on the S23 by the available-memory probe — but only because the probe is honest; the catalog contributes zero protection.**
- Misleading UI: `exceedsDeviceTier` (SettingsScreen.tsx:1773–1775) uses the same minRamTier — with "low" it can never flag a dev model, so the RAM-tier badge machinery is silent for a model that cannot possibly fit on mid-tier phones. On a 16 GB dev device, i1 passes the RAM gate with its KV cost entirely unmodeled (0) — plus F3(a)'s 16k upgrade doubles the real KV again. Acceptable for a dev vehicle per the brief, but stated plainly: **the only thing standing between i1 and an OOM on any given phone is a fluctuating MemAvailable reading.**
- Implementer's field choice, skeptically: ModelRegistry.ts:85–88 documents minRamTier as "Only set for the qwen3.5 fallback chain; other models (Gemma, Whisper) are not part of that tier scheme." Dev entries are not part of that chain either. OMITTING the field would be schema-consistent and produce IDENTICAL gate behavior (undefined → no tier block, deviceProfile.ts:143). Setting "low" instead documents a falsehood (that these models belong to the tier scheme and need only low-RAM) to achieve the same outcome. The rationale "low = pass everywhere" works, but the expressiveness is spent wrong.

---
## F6 — /bench devmodels command

**Verdict: CONFIRMED — parsing is sound; the command IS reachable by any user of any build (no build-type gate).**

benchConfig.ts:451–457:
```
451:  if (sub === "devmodels") {
452:    if (arg !== "on" && arg !== "off") return `bench: invalid devmodels mode "${arg}". ${BENCH_USAGE}`;
453:    const ok = await setDevModelsEnabled(arg);
454:    if (!ok) return "bench: failed to write devmodels mode";
455:    return `bench: devmodels=${arg} (force-stop + relaunch to apply)`;
```
setDevModelsEnabled (49–57) accepts only "on"/"off", persists "1"/"0"; getDevModelsEnabled (42–48) treats only raw === "1" || raw === "on" as enabled, catch → false. Consistent pair. Lever ABSENT (no key) → false → configure(false) → early return (devModelsAdded already false) → registry untouched. Explicit "0" also false. No "on"/"off" asymmetry hole.

**Production reachability:** isBenchCommand/tryHandleBenchCommand are called ONLY from AiChatPage.tsx:2098/2109 — with no `__DEV__`, buildType, or channel gate. Any user of a production APK can type `/bench devmodels on`, restart, and get 6 dev entries in Settings that all fail downloads with the artifactUnpublished message (F4). For this branch's stated purpose (dev phone) that is by design; but nothing about the lever is dev-build-scoped, so a merged main would carry a user-toggleable catalog of dead entries. Design note, not a defect of the branch's own goal. The "(force-stop + relaunch to apply)" reply is accurate — the lever is read only in the AppShell mount effect (AppShell.tsx:647).

BENCH_USAGE updated to advertise the subcommand (benchConfig.ts:388) — including in production builds, advertising a toggle whose entries can't download.

---

## F7 — Workflow + withDebuggableRelease plugin

**Verdict: CI filter CONFIRMED branch-only; plugin leak-on-merge CONFIRMED (unconditional in app.config.js); workflow secrets/uploads CONFIRMED clean.**

- build-kalsa-apk.yml:6–7:
```
6:  push:
7:    branches: [engine-pin-kalsallama, bench-dev-models]
```
  main is NOT in the push filter → the debuggable APK is built by push only on the two branches. workflow_dispatch is ref-unrestricted but manual. CONFIRMED branch-only CI.
- **app.config.js:69: `    "./plugins/withDebuggableRelease",`** — added to the STATIC plugins array with NO env/branch/channel gate (nothing in app.config.js is env-conditioned). If bench-dev-models merges to main — even by accident — every subsequent release build of ANY flavor (local `expo run:android --configuration release`, EAS, or the engine-pin CI branch) patches `debuggable true` into the release buildType. The workflow filter does not protect the config. **CONFIRMED leak vector: debuggable release in production = run-as attachable, debug protocol exposed; also grounds Play rejection.** This is the single biggest process risk in the branch.
- withDebuggableRelease.js:8–19, the idempotence check:
```
15:    if (/\brelease\s*\{[\s\S]*?\bdebuggable\s+true\b/.test(after)) return c;
```
  `[\s\S]*?` spans an UNBOUNDED distance after `release {` — a `debuggable true` in any LATER block (e.g. a debug buildType declared after release, or testOptions) makes the check false-positive and the plugin silently SKIPS injection → dev APK ships non-debuggable, fail-open for the plugin's purpose (run-as impossible, no error raised). Today's Expo-generated build.gradle has debug before release and no debuggable line in release, so injection works — latent fragility only. Also `indexOf("buildTypes")` (line 11) can match a comment occurrence. PLAUSIBLE (latent).
- Scope: withAppBuildGradle is an Android-only mod — iOS prebuild untouched.
- Security audit of the workflow: `permissions: contents: read` (line 10); no secrets referenced anywhere in the 101 lines; uploads exactly two files (app-release.apk + kalsa-apk.sha256) as a workflow artifact with retention-days 14 (lines 97–101) — no release publishing, no third-party upload, sha256 written for verification. CONFIRMED clean.

---

## F8 — i18n

**Verdict: REFUTED (no defect) — keys exist in both locales and types check.**

- en.ts:239–241 `dev: { description: "Developer sideload model. ..." }` under models; it.ts:233–235 same key path. en.ts:624–625 `artifactUnpublished:` under errors; it.ts:621–622 same.
- it.ts:4 `export const it: typeof en = {` — structurally type-checked against the en master; TranslationKey = DeepKeyOf<LocaleStrings> with LocaleStrings = typeof en (i18n/index.ts:31–33). devModelCatalog descriptionKey "models.dev.description" is a valid TranslationKey.
- `npx tsc --noEmit` on the branch: exit 0 (run during this audit).
- Cosmetic only: EN string "this Kalsa artifact is ours and has not been published yet" is odd user-facing prose; IT equivalent is fine.

---

## F9 — Test hygiene

**Verdict: CONFIRMED (stronger than claimed) — there are NO tests anywhere in the repo, and the branch adds none.**

- `find . -name "*.test.*" -o -name "*.spec.*"` outside node_modules → zero files. No jest.config, no `test` script in package.json (scripts: start/android/ios/typecheck/harness:markdown/doctor/postinstall/telemetry:flush/harness:telemetry/harness:research). So "no jest specs for ModelRegistry/ModelDownloader on main" is trivially true.
- Consequence: nothing asserts (a) lever-off registry invariance (MODEL_REGISTRY byte-identical after configure(false)), (b) resolveModelArtifact unpublished short-circuit for all 6 entries, (c) configure idempotence under repeated calls, (d) getDevModelsEnabled parsing ("1"/"on"/other). All of these are pure or near-pure (modelHost.ts has zero imports beyond types; configureModelRegistry is pure w.r.t. the array; getDevModelsEnabled would need an AsyncStorage mock or extraction of the raw-parse). Gap stands as accepted risk.

---

## Rationale read (fit-gate field choices), skeptically

- `minRamTier: "low"` on all six: achieves "tier gate never blocks" but via a field whose documented contract (qwen3.5-chain-only, F5) it violates; omission would be strictly cleaner with identical behavior. For the 10.5 GB i1, "low" is semantically absurd.
- `kvBytesPerToken` omitted on all six: defensible per the "don't fabricate" contract, but for the two KEXP Marco repacks the campaign has measured memory behavior on device (streaming mandates); choosing 0-KV over a documented-unknown means the gate actively underestimates instead of flagging "unknown" (modelGateVerdict returns allowed-with-flag when probes are unknown — but a 0 KV term is treated as knowledge, not unknown). Borderline: the gate's memoryKnown flag only tracks probe availability, not KV unknownness.
- LFM25_DEFAULTS applied to Marco at all: the hybrid flag is the load-bearing error (F3a/b); the ctx 131072 is wrong for qwen3moe (trained 40960) though clamped to 8192/16384 in every reachable path, so inert-but-wrong.
- OLMoE TEXT_DEFAULTS at 8192/8192: see F3(e) — wrong number, directly consumed.

---
## Minor / supporting notes

1. AppShell.tsx:649–655 — exception in the then-body (configure throw) is swallowed as an unhandled rejection; the three gated effects die silently for the session. (F2 corollary.)
2. The model chip "checking" disabled-window (AppShell.tsx:4731–4738) extends by the lever read on every cold start — part of F1.
3. AiChatPage.tsx:1819 getModelById(mid) with a persisted dev id while the lever is OFF silently falls back to getDefaultModel() (ModelRegistry.ts:295 `?? getDefaultModel()`), so telemetry can attribute the turn to the wrong model. Dev-edge only.
4. devModelCatalog sizes are unverified in this audit (no network), EXCEPT dev-marco-i1 which byte-matches the campaign mandate's i1-Q4_K_M (10 505 424 704 B). dev-lfm25-kexp (3.3 GB) vs dev-marco-kexp (6.4 GB) both named "KEXP" with a 2x size gap — plausible (different repack layouts) but unverified; if either sizeBytes is wrong by >1%, downloads fail the exact-size check and, for a manually-pushed sideload, isModelBundleDownloaded would return false and the download button would attempt a doomed download. Sideload path tolerant (file can be pushed with exact size).
5. LFM25_DEFAULTS contextLength 131072 on Marco entries is wrong for qwen3moe (40960 trained) but unreachable-clamped (engineCtx 8192, high-RAM upgrade 16384 < 40960) — inert-but-wrong; would become reachable if engineCtx were ever raised.
6. benchConfig BENCH_USAGE now advertises `/bench devmodels` in production builds (F6 note).
7. hffileUrl's UnpublishedArtifactError is referenced before the class declaration (ModelDownloader.ts:56 use vs 91–96 decl) — TDZ-safe because invocation happens post-module-eval. No defect.

---

## VERDICT: BANK-with-corrections

The branch does what it says: opt-in dev catalog behind `kalsa.bench.devmodels`, store download hard-disabled pre-publication (proven no-path-to-hfRepo, F4), branch-only CI APK (F7), clean i18n/types (F8, tsc exit 0), lever-absent REGISTRY content unchanged (no module-load consumers; configure(false) is a no-op early return). But it does NOT meet the stricter "production behavior with the lever ABSENT must be unchanged" bar at the startup-path level (F1), and it ships factually wrong architecture metadata with two demonstrable runtime consequences on the dev phone (F3a/b), one wrong context number that directly clamps the engine (F3e), and an unconditional debuggable-release plugin one accidental merge away from production (F7).

## Minimal fix list (ranked)

1. **Fix Marco metadata (devModelCatalog.ts:36–48, 71–100):** remove `hybrid: true` from LFM25_DEFAULTS for dev-marco-kexp / dev-marco-bprime / dev-marco-i1 (qwen3moe MoE, attention-only). This kills the 16k ctx upgrade on high-RAM devices (contextProfile.ts:142–146) and restores correct prewarm-after-restore skipping (prefixPrewarm.ts:105). If 16k is genuinely wanted for Marco benching, set `engineCtx: 16384` explicitly instead of faking hybrid.
2. **Fix OLMoE context (devModelCatalog.ts TEXT_DEFAULTS / dev-olmoe):** contextLength/engineCtx → 4096 (trained window); otherwise deviceTuning.ts:498 inits at 8192.
3. **Move the lever read out of the startup path:** resolve `kalsa.bench.devmodels` in a bootstrap gate before AppShell mounts (App.tsx), so modelIndex, restore, eager kick, and settings scan run at mount with the final registry — restoring byte-for-byte startup behavior with the lever absent. (Alternative: keep gating but accept and document the TTFT delta; the gate reads AsyncStorage on every cold start.)
4. **Gate withDebuggableRelease in app.config.js** (e.g. `...(process.env.KALSA_DEV_APK === "1" ? ["./plugins/withDebuggableRelease"] : [])`, env set only in the bench-dev-models workflow) so an accidental merge to main cannot produce debuggable production releases. The workflow branch filter alone does NOT protect this.
5. **Drop `minRamTier: "low"` from all six dev entries** (schema contract at ModelRegistry.ts:85–88; identical gate behavior, honest Settings badges) — or set honest tiers and add kvBytesPerToken/unknown-KV handling for the 10.5 GB i1.
6. Optional: pin dev-olmoe revision SHA (invariant, ModelRegistry.ts:5–6); add `mtp: { nMax: 3 }` to dev-qwen4b-c1; add a tiny pure-function test/harness for resolveModelArtifact + configureModelRegistry + lever parsing (repo currently has zero tests — F9).

— end of report —
