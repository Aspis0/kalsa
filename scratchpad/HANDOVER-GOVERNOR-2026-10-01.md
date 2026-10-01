# Handover - governor / NPU / GPU / engine-release session (from coordinator 818369e6, 2026-10-01)

Owner decision 2026-10-01: session 818369e6 now does ONLY the Kalsa MoE prune (DESIGN in
`scratchpad/agents/kalsa-moe-design-fable/`). The new session owns: the phone governor (NPU/GPU/CPU),
the binding, the app pin/APK chain, the S23, and engine releases (kalsa-server) with kalsa-brain d4e57ba1.

Read first: memory `MEMORY.md` (+ linked feedback files), `~/Projects/kalsa/CLAUDE.md`, `REPOS.md`,
lab `PLAN.md` + `docs/ALIVE.md` (every entry below is there with detail). Rules: delegate only via Paseo
profiles (`list_profiles`; GLM zcode-acp: `update_agent` model=Flash after create and after every prompt);
NEW agents, never revive old ones; writer model != auditor model; clean-code block verbatim in every coder
brief; verify every delegate claim on disk; push when reviewed; archive finished agents; record every
decision in PLAN.md + ALIVE.md; device runs S23 only, screen Awake, unplugged, traced=0; never the Xiaomi.

## Chain as of 2026-10-01 evening

| piece | state |
|---|---|
| Engine (Aspis0/kalsallama) | `main` = `63a51b6d6` (v1.1.5 fixes on 61c909481 = upstream b11304 merge). Single engine line for phone + desktop. Remote branches: main + spike/onecopy-hmx-raw. |
| Binding (Aspis0/kalsa.rn) | `feat/governor-platform-status` = `6c9b16ed` (vendors 61c909481; skel gate with source fingerprint; HTP-only fallback). Repo still has 7 remote branches - PRUNE to <= 3 with `archive/<name>` tags (owner rule, every repo). |
| App (Aspis0/kalsa) | `main` = `07476dae` (pin kalsa.rn 6c9b16ed + engine 61c909481; installed-skel check in apk.yml/build-kalsa-apk.yml). Debuggable APK: run 36900648095. |
| kalsa-server | v1.1.4 published (61c909481). v1.1.5 tag pushed on `63a51b6d6`, release run 36923265662 - verify digests on R2 + HF (`manifest.json`), then send the manifest to kalsa-brain d4e57ba1 (it repins and re-checks M1 `-ngl 0`). Mac archive now ships `libggml-cpu-apple_{m1,m2_m3,m4}.so`; `libllama-server-impl.dylib` must stay beside the exe (desktop probes `x-kalsa-slot`). |

## Open items for you

1. **S23 governor run** (GLM 432b11bf, report `scratchpad/agents/s23-governor-npu-gpu-cpu/REPORT.md`): first
   in-app HTP prefill under the governor - no hang/crash; AUTO picks NPU prefill + CPU decode; every arm hits
   thermal SEVERE after 1-5 turns on a warm phone (CPU worst). Open questions: why NPU ~ GPU total prefill
   (~10 s for ~1.7k tokens, per-chunk times differ, 128-token chunks grow 0.57 -> 1.1 s with context -
   attention on CPU?); why the first npu1 arm failed to load (tombstones in /tmp/s23-gov/arm-npu1-*). Verify
   the report on disk, then audit with a different model.
2. **Binding follow-up round** (audit r3 leftovers, `inapp-htp-dspqueue-hang/AUDIT-fix-binding-r3.md`, judged
   non-blocking): android/src/main/rnllama/CMakeLists.txt outside the skel fingerprint; governor_npu_device read
   unsynchronized; v75<->v79 swap passes; two false comments; struct.error on a truncated ELF.
3. **v1.1.5 release** (above). The engine worktree `~/Projects/kalsallama-v115` (local branch fix/v1.1.5, merged)
   can be removed after the release is verified.
4. **Engine fork Actions**: only kalsa-server + check-vendor active (5 more upstream workflows found and disabled
   2026-10-01 - enumerate with `gh api .../actions/workflows --paginate`, `gh workflow list` truncates).
5. **Desktop engine notes from kalsa-brain**: CPU tiled k-quant prefill helps on AVX2 (keep); Vulkan fusion
   ON (off = -12 %); per-request speculative.n_max deferred by the owner; slot files: identity check covers
   other-model files but not same-shape different weights.
6. **Older S23 queue**: HTP final-version retest (`inapp-htp-dspqueue-hang/FIX-engine.md` recipe) and the
   one-copy kernel arms (`onecopy-hmx-numerics/raw/vtcm-relayout/device/`), spike branch `spike/onecopy-hmx-raw`
   `d2cc4a25b`.
7. Minor: re-score GSM8K uncapped and the `30_gate.sh` bpb override bug are being fixed by the MoE session
   (phase 0b) - do not duplicate.

Marco still has to rotate the HF probe token (Keychain `kalsa-hf-probe`).
