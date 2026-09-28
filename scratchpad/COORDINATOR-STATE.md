# Coordinator state - 2026-09-28

The current operating facts and next decisions. Per-cell methods and raw evidence remain in
`scratchpad/agents/<cell>/REPORT.md`.

## One-copy CPU + NPU

- **Correct on S23:** P5 mean KLD **0.002750** (`hexagon-onecopy-rawq4`, run on engine `c939a135d`
  carrying layout-fix commit `9a2fb2376`; governor design commits `4d606e4f`, `5a94d88c`,
  `df4a18d1`, `7ac42dec`).
- **Slow as built on 8 Elite:** QDC session **853723**, lab report `9ac6ebc7`, measured 512-token
  prefill: two-copy HMX **1,782 tok/s**, two-copy flat **57.8**, one-copy **37.3**. The raw path is
  flat-only because the DSP refuses raw weights on HMX. CPU decode tg128: repack **38.3 tok/s**,
  no-repack **34.6**, raw `-HOST` rpcmem **22.6**. Memory: **1,526 vs 3,448 MiB** in separate
  processes, about **1.9 GiB saved**. v79 flat kernel KLD was **0.0193** for both layouts; HMX KLD
  is unmeasured. See `scratchpad/agents/qdc-8elite-onecopy-cost/REPORT.md`.
- Next: HMX-on-raw estimate (`scratchpad/agents/onecopy-hmx-estimate/`, in progress); rpcmem CPU
  read slowdown probe needs the S23 unplugged.

## Governor one-copy and GPU spike

- Design: lab commits `4d606e4f` / `5a94d88c` / `df4a18d1` / `7ac42dec`.
- Engine `feat/governor-onecopy` is not pushed. S1: `1d39fd0dd` + `49676fd7a`. S2:
  `a11e03a1f` + `c889b4658` + `b39a45be7`. Host tests pass with the ship GGUF; the Hexagon object
  was syntax-checked only; device census is owed. S3+ lane steps are **ON HOLD** until one-copy is
  fast. Owner decision: keep the GPU lane on every device, flag OFF where NPU is better.
- GPU one-copy spike: engine `spike/onecopy-gpu-rawq4`, base `133cef802`, four review fixes
  `5e6b66e86`; lab `scratchpad/agents/onecopy-gpu/`; one dma-buf imported by OpenCL for raw-Q4_0
  GEMM. Review is **SHIP for an S23 correctness run after the fixes**; mimo is running it.

## kalsa-server v1.1.3

Owner approved v1.1.3 (“e ok 1.1.3”). Engine branch `ci/kalsa-server-vcredist` is at
`43a317fde`: app-local VC++ DLLs passed both Windows legs in dry run `36458657174`; the boolean
publish gate is fixed; Hugging Face mirror URLs are
`https://huggingface.co/Kalsa-ai/kalsa-server/resolve/<tag>/<file>`. Only the finalizer writes to
HF, `HF_TOKEN` is configured, and all space-bunny reviews say SHIP. Pending: after Actions minutes
reset, run a second dry run proving R2 and HF are skipped; merge into the workflow branch; then tag.

## App CI and agent operating rule

- GitHub Actions is on the free tier. App heavy workflows are dispatch-only in commit `0c66cf7d`,
  under review.
- QDC work uses Paseo **claude Opus 5.5 medium**. Everything else uses Paseo profiles only; no
  Claude agents.

## Next, in order

1. Finish the in-progress HMX-on-raw estimate; then resolve the rpcmem CPU-read slowdown with a
   bandwidth probe when the S23 is unplugged.
2. Complete the S23 correctness run for GPU one-copy after mimo's four fixes; keep governor S3+
   work on hold until the CPU + NPU one-copy lane is fast.
3. After Actions minutes reset, prove the server publish=false run skips both R2 and HF; merge the
   workflow branch and tag v1.1.3.

## Historical process lessons (2026-09-25)

- Paseo `create_agent` with the GLM-5.3-Flash profile comes up as GLM-5.3 (max) - a backslash bug.
  ALWAYS `update_agent` to Flash + high and confirm with `list_agents`. It burned the owner's quota.
- Reuse an agent only if its context is still valid (the old QDC agent kept the old account).
- Heat briefs: tools OFF, new-token target, no cool-start gate, validity = route fields.

## Handover taken (2026-09-25 ~23:00) - new coordinator 43c25dd3-1926-4261-b5b3-71d4acecc0b4

Owner said "go ahead" on the recommendation: both lanes in parallel.
- Lane mmproj fix: recon aacdeedd (mimo, read-only) - why `!options.mmprojPath` exists; note it also
  forces `n_gpu_layers = 0` when the governor feature is on (`LlamaService.ts` ~2433), so the mmproj
  model may run CPU-only.
- Lane LFM heat arms: driver retarget ffd088fb (mimo coder, lab cell `qdc-heat-per-backend`);
  predictions addendum `PREREG-LFM.md` by 47ba0758 (luna). QDC run only after both.
- S23 still held by 263437c8 (DSP watch) - NPU Step 0 waits for its STOP-SOURCE.md.

## 2026-09-25 late - owner steer and alpha phone half
- Owner: governor on TEXT first; vision lane PARKED (design refuted by audit c8b25dba, see cell).
- Alpha join (asked by kalsa-brain 23ac3537, owner decision: both roads): coordinator owns the phone half.
  QR scanner = coder 35c52933 in worktree `/Users/marco/Projects/kalsa-wt-qr` (detached off origin/main);
  iroh Android spike = 1e1eafb4 (GLM Flash, confirmed) -> `iroh-android-spike/REPORT.md`.
  First Tailscale pairing run: the JELLY (owner, via brain: free, charging, Tailscale up to the Mac) with a
  main-chain CI APK; check the double Content-Length / 403 risk. Charging is fine: not a benchmark.
- Codex (luna) returns 401: second reviewer = GLM-5.3-Flash until the key is fixed.
- Tailscale pairing run prerequisites (kalsa-brain @1dd372b6): desktop listens loopback-only; owner runs
  `tailscale serve --bg 8131` (door, 443) and `tailscale serve --bg --https=8443 8134` (desk) - both need
  Marco's OK, removed after with `... off`. Tester types `https://marcos-macbook-pro.tail80a42d.ts.net`;
  phone derives desk `:8443` (pairingUrls.ts:17-31, matches design). Brain app on; owner presses Allow.
  Tell kalsa-brain (23ac3537) when the APK is ready.
- 2026-09-26 ~01:30: QDC heat driver passed 3 audit rounds (e662b9fb, 39c2dde6; fixes 091bf0ac, 930d9737:
  live thermo per turn and mid-turn, fail-closed readings, stops force-stop the app, restore.sh).
  QDC run launched: Opus 5.5 medium agent b5447088 (aspis, tab 4e7a3b7e), QRD8650 then QRD7675, APK 0509f8c8.
- App main 1819d03f (QR scanner) pushed; device APK CI 36203268567 sha cfd5823e installed on the Jelly;
  pairing run waits for Marco (serve rules, scan, Allow).
- Quotas: commandcode (mimo AND deepseek) weekly limit until 2026-09-29T15:21Z -> use opencode-go.
- 2026-09-26 ~00:50 (owner asleep; worklist: iroh, APK, QDC, S23 on charge). Luna back.
  S23 DSP fix CONFIRMED (STOP-SOURCE.md). S23 is charging: prep-only for NPU Step 0 v73 (2a127e6f), no timing.
  Pairing fix batch 35563984 (refusal stage line, crypto suspect, keyboard, half-screen) -> review -> CI APK ->
  Jelly; kalsa-brain drives the Jelly run tonight (adb fill from zbarimg, presses Allow, removes serve rules).
- 2026-09-26 night results:
  * Pairing root cause CONFIRMED (Hermes has no globalThis.crypto; constructor threw before any network).
    Fix pushed: app main 19526d78 (expo-crypto CSPRNG, always-on KALSA_PAIRING_FAIL {stage,status},
    keyboard dismissal). APK CI 36221646949 sha bfd80e52 INSTALLED on the Jelly. Run NOT done: battery 9 %.
    Morning with Marco: charge first, diagnostics OFF (they log MAC/token; credential NOT recoverable
    from them: needs code+nonce, pairingWire.ts:128-165), kalsa-brain drives.
  * iroh phone road: 7 commits ready in worktree kalsa-wt-iroh (crate pinned to brain 637b2f79 dial_only,
    Expo module kalsa-iroh, CI Rust build + 16 KB readelf gate, JNA 5.17.0, hardened HTTP/1.1 client),
    rebased on 19526d78, luna-audited in 4 rounds. PUSH WAS REFUSED by a permission prompt -> ask Marco.
  * S23 NPU Step 0 v73: kit rebuilt on f25f0c1c5, HTP EXECUTES (sessions on cdsp v73, execute-op logged),
    correctness OK. Timing waits for the phone OFF the charger:
    `cd scratchpad/agents/npu-spec-verify && ./d_run.sh s23 5037 s23-v73-step0` (refuses while charging).
  * Quotas: commandcode + opencode-go out; GLM-Flash codes, luna reviews.

## 2026-09-27 night (owner asleep; S23 + QDC fully delegated to the coordinator for the night)
- App origin/main c6e0b3a9 (iroh step 3 + pairing UX bugs 1-9). Debuggable APK sha ef4bb493 at
  `/Users/marco/kalsa-apks/c6e0b3a9-debuggable/`. kalsa-brain (23ac3537) authorised to install it on the
  Jelly and run the Tailscale + iroh pairing tests tonight; desk commits 8accd769 + c1e5a45d pending push.
- S23 launch jank A/B (cell `s23-launch-jank`, eabf7f0c): deferring the eager load by 5 s does NOT reduce
  launch jank (median 8.70 % vs 7.81 %, p99 93 vs 101 ms, n=3 per arm). Deferral hypothesis refuted; no
  fix shipped. Main thread 85-92 % and Jit up to 80 % in every arm; note the APK was debuggable.
- Lab cells: qdc-heat-3way d7527c92 (CALIBRATE=1 mode, AUDIT2 closed, dry-run 259/0), spec-dspark-gpu-draft
  df26ebdc. Final audit round 3 by space-bunny dd6bdb56 -> then S23: calibrate -> 3-way heat -> DSpark.
- QDC: Opus agent b5447088 re-checking QRD8635/QRD7675 every 30 min (max 4 h), runs S1 CGGC + S2 GCGC.
- 2026-09-27 ~01:50: FIRST VALID S23 3-way CLI run (qdc-heat-3way s23-3way-6, commit acaf2063, 6/6 OK, END exit_0).
  Engine f25f0c1c5, LFM2.5-2.6B ship, prompt 1010 tok raw (--no-conversation), 126 decode, -t 5.
  Prefill ms: CPU 19027 (cold page-in) / 10389 (warm), GPU 7347 / 7326, NPU(HTP v73) 1668 / 1558.
  Decode tok/s: CPU 21.15 / 21.12, GPU 11.26 / 11.10, NPU 13.01 / 12.91 (decode side of the HTP arm).
  Skin deltas ~1 C (turns are 16-29 s: too short for a heat verdict). Calib pin 139.8 ops/tok (raw proof).
  Driver bugs found only on the device tonight: pgrep self-match, `&& &&`, a missing log line, a wrong band,
  conversation mode auto-on in llama-completion -> the fake adb now dash-checks commands and rejects bad flags.
- App main 2fe5a12d (settings pair tap fix) APK sha 3a9efd14 on the Jelly (brain: pair tap PASS; scanner
  inconclusive in the dark; Tailscale/iroh tests wait for Marco to unlock the Mac).
- 2026-09-27 ~03:00: FIRST VALID S23 DSpark run (spec-dspark-gpu-draft s23-dspark-4, commit 0bf3fea8, 5/5 matched
  at 136, END exit_0, n_ctx 2048/2048, no HTP). Decode t/s: A(spec-simple n_max 0) 15.99, B4 CPU-draft 21.49
  (acc 59 %), B8 18.29 (41 %), C4 GPU-draft 9.40 (57 %), C8 9.64 (41 %). GPU drafter REFUTED (−41 % vs A).
  CAVEAT: A may not be the real plain-decode baseline (llama-completion plain decode was 21.1 t/s in 3-way
  run 6) -> arm A0 (plain llama-completion, same prompt/flags) being added before any claim of a B4 win.
- DSpark run 5 (s23-dspark-5, 5c2d3fad, 7/7 matched at 136, exit_0): plain llama-completion A0 23.63 / A0b 23.50
  t/s (drift -0.6 %) BEATS every speculative arm: B4 21.14 (-10.5 %), B8 18.35, A(spec n_max 0) 17.14,
  C4 9.51, C8 9.57. VERDICT: DSpark speculation LOSES on S23 CPU at 59 % acceptance; GPU drafter loses badly.
  Why A was slow: spec-simple decodes the drafter every round even at n_max 0 (speculative.cpp:1170).
  Matches the PLAN prediction "B vs A lean lose" (needs alpha >= 0.65 at K=4). Lane parked unless a better
  drafter (acceptance >= ~0.7) or cheaper verify appears.

## 2026-09-27 — invite-by-link beta debt (owner decisions, relayed by brain fda66492)
- BETA DEBT: a link overwrites the saved desk before any confirmation — add a one-tap confirm naming the computer before links can reach strangers. (Owner declined the confirm for the alpha: family-only users.)
- BETA DEBT (owner decision, 2026-09-28): owner accepts the `assetlinks.json` debug-key risk for the family-only alpha. Before beta, create our private release signing key (also needed for Play), publish its SHA-256 in the Worker's `assetlinks.json`, and add a CI gate failing if it names the public React Native debug key (`FA:C6:17:…:3B:9C`).
- BETA DEBT (owner decision, 2026-09-28): device APK for `335f9c8d` is **179.8 MB** (SHA-256 `eee75d1f…47a5`). Coordinator `unzip -l` breakdown: seven CPU-feature engine variants, **83.3 MB** total (`librnllama*.so` ~**10.7 MB** each; only one loads at runtime); dex **34.8 MB** (not minified); other native libraries **30.6 MB**; iroh **11.1 MB**; assets **7.3 MB**; Hexagon skels **2.8 MB**. Before beta: keep 2–3 engine variants, strip native debug symbols in user builds, enable R8 in release, and ship an Android App Bundle on Play. Target **<70 MB** is an estimate, not measured.
- `kalsa-pair` deployed 2026-09-27 (version `5f5ea8c9`), routes `kalsa.io/pair*` + `/.well-known/assetlinks.json`. The earlier “NOT reachable until the apex gets a proxied DNS record” statement is superseded by the 2026-09-28 GET checks; commands and HTTP 200 results: `scratchpad/agents/pair-worker-reachability/2026-09-28.txt`.
