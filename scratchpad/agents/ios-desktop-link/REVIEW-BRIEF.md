# Max-recall review brief: iOS desktop link (iroh on iOS), 2026-10-02

READ-ONLY, critique only (do not fix; the only write allowed is your own review file). Be hostile. Find everything
wrong. This is the ONE review this work gets (owner rule: one max-recall cross-file review per work, then triage), so
recall matters more than brevity - but rank findings P0/P1/P2/P3:
P0 = security/privacy leak, crash, data loss, Android regression; P1 = wrong behaviour a user hits, real performance
loss; P2 = could affect app/users/performance; P3 = everything else (comments, style, dead code, rare edge cases).

Subject: Kalsa app worktree ~/Projects/kalsa-ios, local branch ios/desktop-link, commit 0e4078c4 on app main
ee8b5f25 (`git -C ~/Projects/kalsa-ios show 0e4078c4`). It adds iOS support for the iroh phone<->desktop link:
`scripts/gen-iroh-xcframework.sh` (Rust staticlibs aarch64-apple-ios + -ios-sim, uniffi Swift bindings, XCFramework
into gitignored modules/kalsa-iroh/ios/Generated/), `plugins/withIrohXcframework.js` (Podfile injection),
`modules/kalsa-iroh/ios/KalsaIrohModule.swift` + podspec (mirrors the Kotlin bridge
modules/kalsa-iroh/android/...), expo-module.config.json registers Apple. Context:
`ios-desktop-link/RECON.md`, `IMPL.md` in this folder.

Trace across files: JS API modules/kalsa-iroh/src/index.ts -> Swift module -> uniffi bindings ->
native/kalsa-iroh-mobile Rust (src/lib.rs) and compare with the Kotlin bridge line by line (method names, argument
order/types, error codes KALSA_IROH_*, deadline clamping, shutdown/destroy races, threading - which queue each
call runs on, blocking calls on the JS thread, promise settled exactly once).

Your angle is given in your prompt; cover it fully, and report anything else P0/P1 you see. Quote the line you read
for every finding (file:line + text); mark CONFIRMED / PLAUSIBLE / REFUTED. `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`;
targeted jest only (no full suite), no app builds, `| tail -5`, real exit codes (`cmd > log 2>&1; echo $?`). Leave the
worktree exactly as found (verify with git status).
