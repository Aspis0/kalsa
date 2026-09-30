# Coordinator state - 2026-09-30 night (session 3f035b4e) - READ THIS BLOCK FIRST

Owner 2026-09-30 night: NO pod (REAP) tonight or tomorrow; focus NPU + governor. GLM (zcode-acp)
starts on GLM-5.3 FULL even when create_agent asks Flash: `update_agent` model=Flash right after create.

- **NPU decode on one copy (S23, 3a DONE):** two copies 22.58 tok/s; one copy default 10.90 and
  MM_SELECT=1 13.54 are CPU numbers (offload_op needs ne[1] >= GGML_OP_OFFLOAD_MIN_BATCH=32,
  `ggml-hexagon.cpp:6980`); with min batch 1 the matvec reaches the DSP at **0.13 tok/s** - the scalar
  `q4_0_raw_rows_to_tiles` (`htp/q4_0-raw-tile.h:13-42`) is 99.9 % of DSP time. Two copies MM_SELECT=1
  (flat) 9.69. Report: `agents/onecopy-hmx-numerics/REPORT.md` "NPU decode on one copy".
  Fix in progress: Paseo Exceptional Coder (sonnet-5-5) `f05b444f-e627-41f1-81c0-08c4030078be` on engine
  `spike/onecopy-hmx-raw` (checkout `~/Projects/kalsallama-onecopy-hmx`), builds only; the coordinator
  runs the S23 (speed with min batch 1 + KLD vs two copies), then one hostile audit (different model).
- **Tied embedding (3b DONE):** saves 204 MiB (none) / 225 MiB (mmap) peak RSS, decode unchanged.
  Next: cherry-pick `1622f44bd` + `048603398` to the engine main line -> pin chain.
- **mmap vs none (3c, CLI only):** mmap peak RSS ~1.3 GiB higher (file pages + CPU_REPACK copy). App
  MLOCK path not measured.
- **Builds:** there is NO NDK/Hexagon SDK on the Mac; every Android/Hexagon build runs in
  `docker run ... --platform linux/amd64 -u 501:20 ghcr.io/snapdragon-toolchain/arm64-android:v0.7`
  with the checkout at `/workspace` (build dirs' caches point at /workspace). Never re-run qaic.
- **v1.1.3:** fork `main` fast-forwarded to `d389de2fb` (2026-09-30 02:0x UTC). Windows dry run
  dispatched 02:25 UTC (run 36659779176) -> refused, quota still out. TRAP found: a dispatch always
  checks out `refs/tags/<release_tag>` (workflow `target` step, `kalsa-server.yml` ~L266-297), and
  pushing a `kalsa-server-*` tag itself triggers a PUBLISHING run. So "dry run before tag" is not
  possible as written: the order is tag push (publishes both platforms) or a dispatch after the tag.
  Decide the order before re-running; do not push a throwaway kalsa-server-* tag (it would publish).
  OWNER 2026-09-30: option (a). Tag `kalsa-server-v1.1.3` (annotated `c2b1acc14` -> `d389de2fb`) PUSHED
  15:08 UTC; its run 36734441163 was REFUSED (quota) - nothing published. The app repo is PUBLIC (free
  minutes, APK builds run) but the fork is PRIVATE (quota still out). When quota returns:
  `gh workflow run kalsa-server.yml -R Aspis0/kalsallama --ref main -f release_tag=kalsa-server-v1.1.3`
  (platforms default macos,windows, publish default true), then verify digests + HF mirror, report to
  kalsa-brain.
- **Rooms R3 (AI guest)** SHIP by desk at local brain `0b287126` (not pushed; a 400/413 clause coming).
  Phone R3 work queued after NPU/governor.
  Name refusals split (brain `4a183704`, §9, pushed after v1.1.3): `name_reserved` 409, `name_mixed_scripts`
  400, `name_too_long` 413 (message `too_large` unchanged); `name_taken` 409, `name_framing` 400,
  `bad_request` (empty/invisible -> show nothing, keep old name). Owner-approved EN copy per code in the
  desk message of 2026-09-30 (already_pending, name_taken, name_reserved, name_framing,
  name_mixed_scripts, name_too_long) - localize by code (EN/IT/ES/FR/ZH):
  already_pending "You already have a question waiting for Kalsa."; name_taken "Someone in this room
  already uses that name. Pick another."; name_reserved "Kalsa is the assistant's name. Pick another.";
  name_framing "Names can't use [ or ]."; name_mixed_scripts "Use letters from one alphabet in your
  name."; name_too_long "That name is too long. Try a shorter one."

## Queue for 2026-09-30 (GitHub Actions quota resets; S23 must be charged, then unplugged)

1. **v1.1.3 engine release:** merge `ci/kalsa-server-vcredist` (`43a317fde`) into fork `main`
   (`e8065c7cf`, includes Gemma MTP; merge-tree was clean) -> dry run on main (windows,
   publish=false) -> tag -> publish -> verify digests -> report to kalsa-brain
   (`edd8034a-6e58-4ff8-a18f-2d56da9ba61a`).
   PREPARED 2026-09-29: merge commit `d389de2fb` (parents `e8065c7cf` + `43a317fde`, only
   `.github/workflows/kalsa-server.yml` changes, actionlint EXIT 0), kept locally as ref
   `refs/kalsa-local/v113-merge` in `~/Projects/kalsallama-onecopy-hmx` (worktree /tmp/kalsallama-v113).
   Tomorrow: check origin/main is still `e8065c7cf`, then push `d389de2fb:main` (fast-forward).
2. **New debuggable APK** from app `main` (`2fe1f214` or later; governor platform status end to end:
   engine `d07d0181b`, binding `c0bbbd35`). On the S23: NPU-lane soak, pairing test, governor
   platform-status check (KALSA_GOVERNOR keys), in-app current test with AsyncStorage
   `kalsa.bench.energy_trace`=on (1 Hz native trace, `files/energy/<ms>-t<turn>.csv`): does the
   current separate NPU/GPU/CPU per turn? -> report to Marco before any agnostic-governor design.
3. **S23 CLI tests (llama-bench, unplugged, dirs under /data/local/tmp/govhtp/):**
   a. one-copy raw NPU decode: `GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_RAW_HMX=1 GGML_HEXAGON_MM_SELECT=1
      --load-mode none -ngl 99 -dev HTP0` tg128 vs two-copy HTP decode (22.09 tok/s). Device name is
      `HTP0` (not `HTP0:0`); llama-bench default load mode in this fork is `none`.
   b. tied-embedding share (`spike/tied-embd-onecopy` `048603398`): CPU tg128 before/after
      (plain-Q6_K lm_head) + RSS; if flat -> cherry-pick onto the engine main line -> pin chain.
   c. RAM mmap+mlock vs none (for the owner's no-mmap decision). Note: the app sends use_mlock=true,
      so no-mmap in the app = LLAMA_LOAD_MODE_MLOCK, not NONE (binding JSIParams.cpp:353-358).
4. Decide the q4_0_4x8 shared layout (CPU decode 0.62-0.64 on raw) after 3a.

Engine spike branches pushed to origin 2026-09-29: `spike/onecopy-hmx-raw` `e71421fd9`,
`spike/onecopy-cpu-gemv` `1dd83c245` (no gain, keep for record), `spike/tied-embd-onecopy` `048603398`.
Owner rules added today: backend ranking = least heat/energy per token above a tok/s floor (NPU decode
wins on S23 and 8 Elite); accelerator order Snapdragon > iPhone (llama.cpp Metal, not Core ML) >
Exynos > Mali > Tensor.

# Coordinator state - 2026-09-28 (end of session 43c25dd3)

The current operating facts and next decisions. Per-cell methods and raw evidence remain in
`scratchpad/agents/<cell>/REPORT.md`.

## One-copy CPU + NPU

- **Correct on S23 (flat):** P5 mean KLD **0.002750** (`hexagon-onecopy-rawq4`, engine `c939a135d`,
  layout fix `9a2fb2376`).
- **Slow as built on 8 Elite:** QDC **853723**, lab `9ac6ebc7`. pp512: two-copy HMX **1,782 tok/s**,
  two-copy flat **57.8**, one-copy flat **37.3**. CPU decode tg128: repack **38.3**, no-repack
  **34.6**, raw `-HOST` rpcmem **22.6**. Memory **1,526 vs 3,448 MiB** (~1.9 GiB saved).
- **HMX on raw weights, first S23 run** (`onecopy-hmx-numerics`, engine `spike/onecopy-hmx-raw`
  `9d5eaf681` in `~/Projects/kalsallama-onecopy-hmx`, build `build-onecopy-hmx-v73`, env
  `GGML_HEXAGON_RAW_HMX=1`, lab `9a356250`): 1,316 `hmx-tiled` matmuls on `-HOST`, EXIT 0. KLD
  one-copy **0.000928** vs two-copy HMX **0.000892**. **Inconclusive, not PASS:** no `hmx-mm-2d:`
  FARF line in either arm; opsets differ (two-copy also puts norms, `SSM_CONV`, `result_output` on
  HTP). Next: placement-matched rerun with FARF on, then the fused raw-to-fp16 reader
  (estimate `db12e4b1`: 900-1,600 tok/s, unmeasured) and pp512 on the 8 Elite via QDC.
- rpcmem CPU-read slowdown (-35%): bandwidth probe `hexagon-rpcmem-bench` needs the S23 UNPLUGGED.

## Governor one-copy

- Design: lab `4d606e4f` / `5a94d88c` / `df4a18d1` / `7ac42dec`.
- Engine `feat/governor-onecopy` (`~/Projects/kalsallama-gov-onecopy`, not pushed). S1
  `1d39fd0dd` + `49676fd7a`; S2 `a11e03a1f` + `c889b4658` + `b39a45be7` (closed). Hexagon object
  syntax-checked only; device census owed. **S3+ ON HOLD** until one-copy is fast. Owner: GPU lane
  on every device, flag OFF where NPU is better.

## GPU one-copy spike

- Engine `spike/onecopy-gpu-rawq4` (`~/Projects/kalsallama-onecopy-gpu`, not pushed): `133cef802`,
  `5e6b66e86`, `4ff4f729c` (`cl_qcom_dmabuf_host_ptr` import), `0285aae40` (probe
  `--model-shapes`; `q4raw-probe` sha `2c478791...9e72`). Lab `scratchpad/agents/onecopy-gpu/`,
  last `1ecbcbfe`.
- S23 run 2: import works, small shapes correct, full model looked stalled. Diagnosis: **slow, not
  hung** - raw GEMM 4.75 GFLOPS vs ~437 normal (~92x); ~9 min per 512-token pass. Import INFO line
  was hidden by the log threshold (wrapper now `-v`). Next: rerun `push`, `probe`, `kld`,
  `kld-decode` from REPORT section "Rerun commands" (20-min wait on G1); correctness only, plugged OK.
  If correct, the raw GEMM still needs a real kernel.

## kalsa-server v1.1.3

Owner approved. Engine `ci/kalsa-server-vcredist` at `43a317fde` (pushed to the fork): VC++ DLLs
(vcruntime140, vcruntime140_1, msvcp140, vcomp140), boolean publish gate fixed, HF mirror
`https://huggingface.co/Kalsa-ai/kalsa-server/resolve/<tag>/<file>` (finalizer-only, `HF_TOKEN`
secret set, whoami preflight, safe retag); all reviews SHIP. **Blocked on Actions minutes (free
tier, monthly reset).** Then: dispatch "Kalsa Server" on that branch with release_tag
`kalsa-server-v1.1.2`, platforms `windows`, publish `false`, force `false`; prove R2 + HF steps are
skipped and the 4 DLLs verify; merge into the fork main; tag `kalsa-server-v1.1.3`, publish, verify
dl.kalsa.io and HF byte-identical; report release sha, zip names, sha256, sizes, exe_sha256 to
kalsa-brain.

## App, CI and agent rules

- App main `6368a723`: heavy workflows dispatch-only (`29e175ce`), cheap checks on main pushes;
  AGENTS.md fixed (`1d68887b`: reviews assigned by coordinator, no self-spawned reviewers - the old
  DeepSeek rule made luna `43b20ee2` spawn DeepSeek `30dd9a35`; owner: do not kill it).
- APK `335f9c8d` (CI green, `/tmp/apk-335f/`) awaits the S23 step-5 NPU-lane soak
  (`kalsa.bench.npu_lane=auto`, expect engine_prefill=NPU, npu_device HTP0).
- Beta debts recorded in PLAN: pairing assetlinks on the debug key; 180 MB APK (7 engine variants).
- QDC = Paseo claude **Opus 5.5 medium**. Everything else = Paseo profiles only; no Claude agents;
  never Sonnet 5. GLM agent `7802595c` drifted to GLM-5.3 max; owner: do not kill.

## S23 (Marco says when it is UNPLUGGED)

Waiting for unplug: A/B/C backend-hopping heat (`s23-backend-hopping-heat`), step-5 NPU lane soak,
rpcmem bandwidth probe, one-copy timing. Correctness-only runs are allowed while plugged.

## Next, in order

1. GPU one-copy correctness rerun (plugged OK) - luna `85540c64` has the device context.
2. HMX one-copy placement-matched rerun with FARF on (plugged OK).
3. When unplugged: S23 heat A/B/C, NPU-lane soak, rpcmem probe.
4. Fused raw-to-fp16 HMX reader + pp512 on QDC 8 Elite (Opus medium).
5. After the Actions reset: v1.1.3 dry run, merge, tag, report to brain.

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
