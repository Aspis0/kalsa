# Handover - Kalsa iOS session (written 2026-10-03 by Paseo agent 818369e6)

Scope of this session: the iOS app (first the app itself, then the models). The MoE prune is PARKED until after
alpha. Peer sessions: 1d714246 = governor/NPU/GPU/binding/Android chain/S23/engine; kalsa-brain d4e57ba1 = desktop
Brain (cannot message us; Marco relays).

## State (all on app origin/main f4f3696c, lab pushed)
- iOS builds from the pinned chain with no hand patches (Expo SDK 57, RN 0.86.2, UIScene on, llama.rn from source
  with Metal). Mac "Designed for iPad" Release run and Simulator Debug both work: `MAC-RELEASE-RUN.md`.
- Metal offload 31/31 (governor CPU fallback is Android-only at both sites; test `governorCpuFallbackScope.test.ts`).
- iOS KV = q8_0/q8_0 via `resolveKvCacheProfile()` (mixed q8_0/q4_0 is 3-8x slower on Metal flash-attn). Android
  unchanged (QDC: no mixed-KV penalty on CPU).
- Engine line: llama.cpp main; Apple Foundation Models only as an optional "no download" fallback (4096 ctx, weak
  multi-turn, ~35-46 tok/s vs LFM2.5 ~95 on the M1 Max); MLX only if measured to win. `ios-engine-choice/REPORT.md`.
- iroh on iOS: XCFramework via `scripts/gen-iroh-xcframework.sh`, Swift module `modules/kalsa-iroh/ios/`.
- Doorless iroh pairing (Android + iOS): invite with `node` pairs with no door; record doorUrl "" + pairedVia "iroh";
  stand-in base https://iroh.kalsa.invalid; predicate `pairedIrohRoad()` in src/remote/doorRoad.ts.
  Reviewed (`ios-desktop-link/REVIEW-doorless-*.md`); live PASS on the Simulator 2026-10-03.
- SDK 58: NO-GO until RN 0.88 stable; trial kept as local tag `local/sdk58-trial` (7c324067). `SDK58-TRIAL.md`.
- pdf.js 5.7 PARKED (WebView dies on the S23); main ships 3.11. Branch expo57-bump c39f105e in ~/Projects/kalsa-expo-bump.

## Next (in order)
1. DONE 2026-10-03 (LIVE PASS, see PLAN.md): Simulator paired with the Mac Brain over iroh and one chat answered.
   Recipe kept for re-runs (the Simulator UI is /Applications/Xcode.app/Contents/Applications/DeviceHub.app):
   - Marco: Brain -> Dispositivi -> Invita con link -> Copia link, pastes it in chat, then clicks Consenti on the
     unlocked Mac. The link is a one-use secret: never write it to files.
   - Me: Metro from ~/Projects/kalsa-ios (`npx expo start --port 8081`, Node 22), relaunch the Debug app in the
     Simulator (DeviceHub.app in Xcode 27), `xcrun simctl openurl booted 'kalsa://pair#<payload>'`, tap Open.
   - Then send one chat over iroh and check the reply comes from the Brain. Tailscale road only with Marco's OK.
1b. DONE 2026-10-04: iOS background generation guard on app main 30038004 (see PLAN). This session is also the UX
   session and owns the Jelly (owner 04/10).
1c. DONE 2026-10-04: phone 1:1 images to the PC on app main 3908f2a0 (PLAN). NEXT: phone Room v1 text-only
   (scratchpad/agents/phone-room/RECON.md), then Room images, then Room video.
2. Real iPhone test: the partner's iPhone 15 Pro only, ask Marco first.
3. iOS gaps: share extension, battery/energy readings unavailable on iOS, TestFlight needs the $99 program
   (export-compliance note in BACKLOG-LOW-PRIORITY.md).
4. Parked: pdf.js 5.7 diagnosis, SDK 58 re-trial at RN 0.88 stable, whisper.rn 0.7.4 (`WHISPER-RN-RECON.md`),
   model download row "Scarica 3.1 GB" not tappable (owner triage).

## Traps
- After `pod install` on the Mac, `scripts/assert-engine-provenance.sh` fails on 34 generated
  `ggml-metal-embed-*.s`; `npm ci` fixes it (CI on Linux is unaffected).
- Node: use `/opt/homebrew/opt/node@22/bin`; `ios/.xcode.env.local` must point to node@22.
- Before every push to app main: also run the apk.yml "Typecheck + logic harnesses" `run:` block.
- Mac lock screen blocks app launches; `open -b com.kalsa.app --stderr F` captures native logs.
- Desktop Brain: never restart/kill Kalsa.app, never start a second one, never touch its Application Support dirs.

## Worktrees (all clean)
- ~/Projects/kalsa-ios: ios/verify = f4f3696c (use this one for the Simulator).
- ~/Projects/kalsa-node22: pairing/iroh-no-door = f4f3696c.
- ~/Projects/kalsa-expo-bump: expo57-bump c39f105e (pdf.js work, not landed).
