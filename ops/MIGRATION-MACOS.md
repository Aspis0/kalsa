# Migration: orchestrator session PC → macOS (PC reset 27/08 night)

**Why**: owner decision 27/08 — PC unstable/contended (2 Claude sessions, RAM commit ceiling),
gets wiped tonight; the moe-experiments orchestrator moves to macOS. Builds already moved to CI
(see memory `builds-on-ci-not-pc`), so platform no longer matters for heavy work.

## First actions on the Mac
1. Clone/pull `Aspis0/kalsa-moe-experiments` (this repo). Authoritative state: `PLAN.md` STATO
   CORRENTE + `docs/ALIVE.md` + memory backup below.
2. **Restore the memory**: copy `ops/memory-backup-2026-08-27/*` into the new session's
   auto-memory dir (`~/.claude/projects/<project-slug>/memory/`). Without this the session loses
   the campaign brain. Then update path-specific facts (Windows paths in memories → re-derive).
3. Paseo: profiles must exist on the Mac app (same list: Coder/Luna, Skill coder/grok, Reviewer
   Math/DeepSeek, Reviewer/mimo — quota reset ~30/08, Strong Cheap/GLM, Websearch, Explorer).
   Agent history does NOT transfer; state lives in this repo's scratchpad.
4. adb: re-pair the S23 from the Mac (wireless debugging; serial R3CW406P8CV). Xiaomi is away
   with the owner until ~07/09. Jelly belongs to the app session.
5. Toolchains: Android SDK/NDK on Mac only needed for device pushes/smokes — APK builds run on
   CI (`.github/workflows/build-kalsa-apk.yml` in ai-chat). llama.rn bootstrap is bash-native
   (better on macOS).

## What dies with the PC (accepted / mitigated)
- q59/q63 gguf artifacts (~27 GB incl. BF16 source): reproducible — BF16 from HF (sha in q59
  PREREG), quantize recipes locked in `scratchpad/agents/q63-dense-htp-recipe/PREREG.md` with
  pinned llama.cpp commits. **C1 preserved on the S23** at `/data/local/tmp/q63_c1_preserved.gguf`
  (pushed 27/08 night, sha c54e95f8...).
- Build stagings (q66c, q66p3b, kals-pin clone, C:\kq66-*): all branches PUSHED to Aspis0 —
  kalsallama `app-pin-compat` @ d1cc3b77, llama.rn fork `kalsa-pin` @ f377da22+ (final sha in
  PHASE3_STATUS), ai-chat `engine-pin-kalsallama` (merged to main @ eaee200b) — re-clone at will.
- PC llama.cpp build trees (build-pc-quantize, build-llama-pc): rebuild recipe in q63 scratchpad
  (`build_*.cmd` — translate to Mac: plain cmake, no vcvars needed).
- Paseo transcripts, logs/ dir: evidentiary copies of key results are in scratchpad + git.

## Device state at migration
- S23 (dev phone, plugged): kalsallama APK installed (sha 8621E6F1..., release; debuggable-release
  variant is the intended standard once built — policy memory `s23-debuggable-apks-policy`),
  models OLMoE + Marco×2 + stock Qwen catalog + C1 preserved copy; baseline PREREG draft ready
  (lock at Phase-1 start); 12→9 GB free after C1 push.
- Xiaomi: away with owner; q67 closed (r VOID); v75 work resumes post-07/09 or on QDC.

## In-flight at migration
- q66 cell: PREREG locked (a6f96328), APK ready on device → run from the Mac via grok/Luna
  (grok available all week).
- 10-day plan Phase 0 (QDC) + rest: unchanged, `docs/PLAN-10DAYS-2026-08-28.md`.
- q68/q69/q65 queued (see state memory `repack-q23k-v1-state`).

## Takeover on the Mac: the app session's multi-day Jelly run (added 27/08 late)
Owner assignment: on the macOS machine a MULTI-DAY run is in progress and must be TAKEN OVER as
custodian (not redesigned): "ciswire harness vs no" on the real app, on the Jelly, with the
OLD-kernel APK — which must NEVER be updated while the run lives (engine-pin stays away from the
Jelly). On arrival: locate its handover/state (ask the owner if not found), identify PID/logs/
watchdog, and limit intervention to: Jelly keepalive (memories jelly-dies-in-idle-sleep,
jelly-keepalive-via-adb), watcher verification (watchers-verify-pid), recovery per the written
procedure, honest reporting. Merit decisions (abort/protocol/interpretation) belong to the app
session / owner. A written handover from the app session has been requested via the owner.
