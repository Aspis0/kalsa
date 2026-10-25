# NEXT-SESSION — paste the block below to start the next session

The block is self-contained on purpose: a fresh session has no memory of this one, must not
paraphrase the owner's rules, and must not re-derive what a device run already proved or refuted.

---

You are continuing the Kalsa interface rebuild. Repo `/Users/marco/Projects/kalsa-ux`, branch
`ux-2026-09-21`, worktree clean at HEAD `5c812ed`. The owner is Marco: write to him in Italian,
everything else — code, comments, docs, commit messages, briefs — in English.

Read these first, in this order: `docs/CODER-BRIEF.md` (the owner's standing rules, which open every
coder brief verbatim), `docs/HANDOFF-2026-09-21.md` (state, traps, what each device run proved),
`docs/PARITY.md` (the specification, 50 rows) and `docs/PARITY-STATUS.md` (the answer to it at the
last walk, with `file:line` and a ranked gap list). `docs/DESIGN.md` is the design source of truth.
`src/app/AppShell.tsx` (7,261 lines) and `src/screens/AiChatPage.tsx` (6,092) are the CONTROLLER: the
source to copy from and the checker — read-only, must keep booting, never refactored in passing.

## What exists and what was proven

The app is rewritten: `src/host/**` (the new root and machinery) plus `src/ui/shell/**` (the
surface), mounted by `App.tsx` behind a temporary `NEW_SHELL` flag with the old root still reachable
as the controller. 166 suites / 2,052 tests green, `tsc --noEmit` clean.

Proven ON DEVICE: it boots cleanly (no crashes in any run); the first-open screen reads right (plate,
greeting, welcome line, suggestion cards that really send); the composer takes typing while a phase
holds sending and says why in one line; attachments work end to end in the composer (sheet, images,
PDF, docx, chips, the engine receiving them); the long-press menu opens with copy, save-to-notes,
regenerate, translate, edit and read-aloud; share-in works with its four behaviours; the mini-app card
and sheet are back; the model DOWNLOADS (1.6 GB, byte-exact, 3 min 14 s) and the bar reports it; and
the drawer, overlays, settings, documents, notes and personas all open.

NOT proven, and the list is short: **a real turn, the streaming caret, the tool rows, the stop marker
and the epoch-stamped round trip of real content.** Every one of them needs a device that can actually
load a model. The 3 GB emulator cannot: on it the load is refused with `Load failed — tap to retry` /
`Not enough free memory to run`, which is a true verdict, not a bug. **The Jelly Star
(`192.168.1.82:5555`) is the only device that can finish this** — ask the owner before installing, use
`adb install -r` only, never uninstall, never touch the S23 (`192.168.1.152`), and report the sha256
left on the phone.

## The next actions, in order

1. Get the owner's go-ahead and run the **Jelly Star capture**: install, send a real prompt, capture
   mid-stream (the caret), a settled answer, a tool row if the engine emits one, a stop mid-stream
   with its marker, then force-stop and relaunch to prove the conversation round-trips. That closes
   the last unproven list and it is the single most valuable thing left.
2. Re-walk `docs/PARITY-STATUS.md` after that (its header mandates it), verifying the claimed
   verdict moves instead of repeating them — three times now a declared list of changes has been
   incomplete, always missing the work done sideways.
3. Remaining gaps, ranked: the mic and the voice pipeline (whisper dictation, voice status, the
   voice-note toast as its own system, the voice and embedding DOWNLOADS — held because the pipeline
   does not exist yet); attachment thumbnails on a SENT bubble (needs a new design: the controller
   labelled those tiles with a bare filename, which §2.7 forbids); the suggestion cards' second hue
   (`compute` died from the palette); and the owner's five open decisions below.

## The owner's open decisions, do not decide them yourself

The table's scroll rule (keep §2.2's always-scroll at 351 dp, or make the required width
content-aware with a declared estimate); whether the inline `[N]` citation is tappable again;
`splitParagraphs` keep or delete (test-only today); the escaped `|` in prose; the dead files
`Surface.tsx`/`Button.tsx`; whether the cloud's trail stays a whisper or becomes visible; and now the
catalog's static "Under 6 GB RAM" badge, which contradicts the volatile gate — a fix needs a computed
`freeRamBadge` in the catalog, out of the host's reach.

## How work is done here, and the traps that have already cost time

- Delegate. Profiles (re-read `list_profiles` before every launch — the models behind the ids have
  changed twice): Explorer `agent_profile_pubvia_explorer` and Skilled Coder
  `agent_profile_mu1ad3a6_m2izc4n41n` are `pi` + `CC2/xiaomi/mimo-v2.6-flash`, and you MUST pass
  `settings: { thinkingOptionId: "medium" }` for the Explorer and `"high"` for the coder — an earlier
  session discovered that omitting it silently ran everything with reasoning OFF. Reviewer and
  Websearch are `zcode-acp` + `builtin:zai-coding-plan\GLM-5.3-Flash` with `modeId: edit` (or `yolo`),
  `thinkingOptionId: "high"` and `features: { auto_accept: true }`; the Reviewer is the ONLY profile
  whose model accepts images, so **every visual claim must come from it and never from a model that
  was not handed the bytes**. One writer at a time in the tree.
- The loop that works: coder (tests green, report with file:line) → orchestrator verifies the diff and
  commits → capture on device → vision reads the frames → controller re-walks parity. Never skip the
  eyes: four times tonight a measurement said fine and the pixels said otherwise, and once the reverse
  (a claimed misalignment a PIL measurement refuted).
- Machine discipline: one emulator at a time, `jelly480` (480x854 @ 220 dpi = 349x621 dp) with
  `-no-snapshot-load -no-boot-anim -no-audio -no-window -crash-report-mode disabled -port 5554`, kill
  it when done; check the machine is free before a build; the build is 36-46 s and must compile ZERO
  project C++ translation units, proved by TWO independent witnesses, one of which cannot fail
  silently (the configure-side compile database AND the execution-side ninja graph — the expected
  answer is "zero project translation units plus CMake's own two LTO probe files");
  `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`,
  `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`, build from `android/`.
- `uiautomator` traps: `rm -f /sdcard/*.xml` before every dump; animation scales 0 for a dump and 1
  before every screencap; a dump takes ~2 s so a 400 ms flash is invisible to it; an EMPTY `EditText`
  reports its placeholder as `text`; bounds inside a clipped transcript come back INVERTED (a stale
  dump once made a tap hit the wrong card); while the drawer is open the whole shell disappears from
  the tree; and a notice only exists after the tap that raised it.
- Never push, never tag, never merge to `main` without the owner saying so; audit before any push.
  `git add` by name, `git branch --show-current` before every commit, and the commit message names the
  repo, the branch and the parent HEAD. Never report a piped command's status without its exit code:
  `cmd > /tmp/out.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/out.log`.
- Ratchets in `src/host/fileSize.test.ts` only ever go DOWN: `src/host` ≤ 350 (`engineTurn.ts` and
  `HostChatSurface.tsx` are AT 350, `useModelDownload.ts` at 349), `HostRoot.tsx` ≤ 241,
  `src/ui/shell` ≤ 342. Cut a seam rather than raising a number, and never "fix" a test to make room.

---

## Come si usa

Incolla il blocco a una sessione nuova (o a un agente handoff) e lascia che legga i quattro documenti
prima di toccare qualcosa. Le uniche due cose che richiedono te: il via libera per installare sul
Jelly Star, e le decisioni aperte in elenco.
