# Coordinator state - end of 2026-09-25 (session kalsa-99 / c925dc00, handing over)

The previous version (end of 2026-09-21) is in git history. Detail lives in each cell's
`scratchpad/agents/<cell>/REPORT.md`.

## Delivery chain (all pushed, fast-forward, provenance gate green)

| Repo | Ref | Commit | What |
|---|---|---|---|
| Engine `Aspis0/kalsallama` | `kalsa-phone-v1-1-8` | `f25f0c1c5` | governor pause 43 C / kill 44 C (owner 25/09), critical = kill in both profiles, admission ceiling 42.5 |
| Binding `Aspis0/kalsa.rn` | `kalsarn-governor-engine` | `88b2b57e` | vendors engine v1-1-8 |
| App `Aspis0/kalsa` | `main` | `0509f8c8` | pins binding 88b2b57e / engine f25f0c1c5 |
| APK | CI run 36171227792 | sha256 `855c89de...5c91e7` | `/Users/marco/kalsa-apks/0509f8c8/` (arm64, debuggable) |
| Engine `main` + tag | `kalsa-server-v1.1.2` | `5102686dd` | first Windows x64 server (cpu + vulkan, portable CPU variants), BACKEND_DL-safe bmoe hook; published on dl.kalsa.io (run 36191270775); kalsa-brain-90 re-hashed and is repinning |

Engine phone branch `kalsa-opencl-upload-oom-throw` = v1-1-8. Two reviewers (luna + deepseek) on every
shipped commit today.

## Governor research - what we know now

- **Thresholds 40/43 were harness guards, never an owner decision.** Owner chose pause 43 / kill 44.
  Open, owner-accepted risk: a floor chunk from 42.99 projects 44.9 (> kill) on the 1.9 C delta; kill is
  a sticky governor failure for the session. The delta table itself is unmeasured for GPU/CPU.
- **NPU as speculative-decode verifier: KILLED on speed on v79** (QRD8750, cell `npu-spec-verify`):
  ms/call at d1920, K=1/4: CPU 28.8/35.7 (ratio 1.24), NPU `-nkvo` 39.4/71.6 (1.82). NPU cost is a
  staircase (kernel tiers), not per-call overhead. Surprise: **CPU verifies 4 tokens for 1.24x one step on
  the ship model** - CPU speculative decoding with a confidence gate (`--draft-p-min` exists) is the lane
  that got stronger. Kit was old engine `4c7101af4`; one board only.
- **Per-backend heat tables: still n=0 everywhere.** S23 blocked by the DSP spin; QDC blocked first by
  the account/tab problem, then by an APP defect (below).
- **App defect found (verified): the governor is disabled whenever an mmproj is loaded**
  (`src/engine/LlamaService.ts:2439` `!options.mmprojPath`). Qwen3.5-4B (recommended on high-tier boards)
  needs the mmproj, so it never runs under the governor and `bench:route` is `skipped`. OWNER DECISION
  PENDING: run the heat arms on a model without mmproj (LFM2.5-2.6B) or fix the app first.

## S23 DSP spin - likely SOLVED (cell `s23-dsp-spin-web`, agent 263437c8 still watching)

`adb shell setprop persist.traced.enable 0` stops Perfetto (traced/traced_probes/traced_perf); it
survives reboot; no profiling signal, so adsprpcd/cdsprpcd stay at 0. After the reboot: 0% at every
10-min poll up to 7630 s uptime (the spin used to return at ~4046 s); idle battery drain dropped from
~17%/h to ~2%/h. Revert: `setprop persist.traced.enable 1`. `debug.perfmond.default.perfetto=0` alone
did NOT work. Final report will be `s23-dsp-spin-web/STOP-SOURCE.md`.

## QDC

- Account `aspis.launcher@gmail.com` (new, 25/09): QRD8650 885 min, QRD7675 1000, QRD8750 970-994,
  QRD8635 1000. Old account (marco...): QRD8650 1, QRD8750 51, QRD7675 555.
- **Each Paseo browser tab has its own cookies**: a new tab does not inherit a login. The aspis login lives
  in tab `4e7a3b7e`. Agents never type passwords; a new tab on aspis needs the owner to log in there.
- QDC bills the FULL requested cap (session 845086: 41 min used, 115 billed). Request the minimum.
- Heat driver `qdc-heat-per-backend/d_run.sh` is dry-run-validated and fixed (mmproj copy, no wait after
  `bench:route`, port override, SoC check first, QRD7675 support).

## Next, in order

1. Owner decision on the mmproj/governor defect; then QDC heat arms (QRD8650 4 pairs, QRD7675 2 pairs).
2. S23 (DSP now clean): NPU Step 0 on v73 (`npu-spec-verify/d_run.sh`, ~15 min), then the S23 heat arms
   (tools OFF, frozen 1024-token prompt at `s23-heat-cpu-vs-gpu-v2/raw/heat-arms/resume-tools-off-20260925/frozen-prompt-1024.txt`, no cool-start gate).
3. CPU speculative decoding with a draft-probability gate on the ship model (new lane from Step 0).
4. Debt: `inputs.publish != 'false'` in `kalsa-server.yml` is wrong for a typed boolean (use
   `github.event_name != 'workflow_dispatch' || inputs.publish`); ~700 duplicated workflow lines;
   `test-governor-v0-devices` fails on a Metal Mac (pre-existing); Windows zips need the VC++ runtime.

## Process lessons of the day (mine)

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
- ACTIVE SECURITY RISK; owner decision pending: the public `assetlinks.json` still names the public Android debug signing key. Another app with package `com.kalsa.app` signed by that key could verify as a handler for `https://kalsa.io/pair` links. Decide the signing-key migration and CI enforcement; the risk is live because the endpoint is public.
- `kalsa-pair` deployed 2026-09-27 (version `5f5ea8c9`), routes `kalsa.io/pair*` + `/.well-known/assetlinks.json`. The earlier “NOT reachable until the apex gets a proxied DNS record” statement is superseded by the 2026-09-28 GET checks; commands and HTTP 200 results: `scratchpad/agents/pair-worker-reachability/2026-09-28.txt`.
