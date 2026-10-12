# Kalsa desktop: every screen and state, with its Hearth mockup

One line each: what the app shows, the source file it comes from today, and the
mockup that designs it (`/tmp/kalsa-mockups-v4/<name>.png`, HTML in `hearth/`).
Copy is the app's English from `chat/src/i18n/en/*.ts`, changed only where it was
jargon or the new layout needs it: every change is listed in "Copy changes".

## Shell and navigation
- App frame: topbar, title and buttons (Conversations, Settings, ?, Back to…, Files). `App.tsx`. Replaced by the icon rail: Home, Chat, Room, Settings, then Help and Phones at the bottom. Every screen.
- Crescent menu (Chat/Room page menu). `components/CrescentNav.tsx`. Replaced by the same rail. Every chat/room screen.
- Screen-reader live line (Kalsa is answering…, Thinking complete…). `App.tsx` + `shell.ts`. Not visual; unchanged.

## Home (`surfaces/BrainSurface.tsx`, `surfaces/useBrain.ts` brainWords, `power.ts`)
- On, ready ("Kalsa is ready."). → `01-home`, `01-home-dark`.
- Off ("Kalsa is off."). → `01-home-off`.
- Starting ("Kalsa is starting…" / "Getting ready…"). → `14-home-states-starting`.
- Turning off ("Kalsa is turning off…" / "Next time she starts with your choice."). → `14-home-states-stopping`.
- Stopped after a failure (state `failed`: "Stopped" + Rust reason + Try again). → `14-home-states-stopped`.
- Did not start (held failure: "Kalsa couldn't start. Try again."). → `14-home-states-did-not-start`.
- State unreadable ("Not known" / "Kalsa's state couldn't be read."). → `14-home-states-not-known`.
- Resting ("Resting" / "Kalsa is resting to free up memory…"). → `14-home-states-resting`.
- A phone is using this computer ("Your phone is using this computer right now."). → `14-home-states-phone-in-use`.
- Throttled ("This computer is running slower on purpose…", from the Power page). → `14-home-states-throttled`.
- Stop failed ("Kalsa didn't turn off. Close this window to stop her."). → `14-home-states-stop-failed`.
- Checking the AI already installed (migrating: "Checking the AI already on your computer…"). → `14-home-states-checking-ai`.
- Crash recovered notice ("Kalsa recovered from an error." · Send the log · Dismiss). `components/RecoveredNotice.tsx`. → `14-home-states-recovered`.
- Alpha telemetry notice (first launch). `components/TelemetryNotice.tsx`, `telemetry.ts`. → `14-home-states-telemetry-notice`.
- Brain bar "Say something…" with Chat/Room buttons. `BrainSurface.tsx`. Replaced by "Start a chat" (approved round 4).
- "This computer" row: AI · Power · Devices. `BrainSurface.tsx`. Replaced by "Using Qwen 3.6 · Details ›" and the rail.

## Power page (`surfaces/ServerSurface.tsx`, `server.ts`)
- Status, speed "Measured by Kalsa", phones "Connected now", throttled note, Turn on/off. Merged: on/off is Home; speed and phones move into Your AI → Details (`07-ai-page`, `14-home-states-ai-details-live`); the throttled note moves to Home (`14-home-states-throttled`).

## Your AI page (`surfaces/ModelsSurface.tsx`, `surfaces/MachineCard.tsx`, `machine.ts`)
- Running, the two choices, switch. → `07-ai-page`.
- Details with live speed and phones (from Power). → `14-home-states-ai-details-live`.
- Kalsa off ("Kalsa is off. Go to Home to start it."). → `14-home-states-ai-off`.
- Switch confirmation ("Kalsa will restart with …"). → `18-dialogs-switch-ai`.
- Not measured yet / no suitable choice. → shown as `14-home-states-ai-off` note line and `13-first-run-too-weak`.
- "Show the working" (speeds disclosure, "Answers get slower as a conversation grows longer." since 2026-10-12). → inside `07-ai-page` Details (`14-home-states-ai-details-live`).
- Advanced panel, Sampling panel, Report a problem: see below.

## First run (`surfaces/FirstRun.tsx`, `surfaces/SetupProgress.tsx`, `components/Sprout.tsx`, `setup.ts`, `rust.ts` startup)
- Start. → `04-first-run-start`.
- Start check failed (error under Start, Try again). → `13-first-run-check-failed`.
- Checking your computer (no fraction: tree at rest). → `13-first-run-checking`.
- Pick the AI. → `04-first-run-pick`.
- Pick when the AI is already on the computer ("Already on your computer"). → `13-first-run-pick-on-disk`.
- Too weak (refusal, no options: "Kalsa doesn't have an AI that runs well on this computer yet."). → `13-first-run-too-weak`.
- Confirm the download ("Download 4.6 GB?" / "Kalsa needs these files…"). → `13-first-run-confirm`.
- Getting ready / starting (no fraction). → `13-first-run-getting-ready`.
- Downloading. → `06-growing-seed`, `06-growing-sprout`.
- Download resumed ("Picking up where it stopped — …"). → `13-first-run-resumed`.
- Tuning ("Test 2 of 6 · about 4 min left", "This happens only once. You can minimize Kalsa…"). → `06-growing-young`, `13-first-run-tuning`.
- Tune stopped by its budget ("Kalsa will finish testing next time it starts"). → `13-first-run-tune-cut`.
- Ready. → `06-growing-full`.
- Walk failed ("Kalsa couldn't get ready." + reason + Try again + Show details): connection lost, other network, disk full, took too long, could not start. → `13-first-run-failed-connection`, `13-first-run-failed-disk`.

## Chat (`surfaces/ChatSurface.tsx`, `components/Thread.tsx`, `Composer.tsx`, `ThoughtCloud.tsx`, `ToolActivity.tsx`, `Markdown.tsx`, `thread.ts`, `composer.ts`, `tools.ts`)
- Conversation. → `02-chat`, `02-chat-dark`.
- Chat list (popover under Chats ▾: search ⌘K, New chat, when per row, live dot). `components/ChatList.tsx`. → `02-chat-list-open`.
- Search ⌘K with results / no match / capped. → `11-chat-states-search`, `11-chat-states-search-none`.
- Empty chat, Kalsa on ("Talk with Kalsa."). `components/EmptyState.tsx`, `firstPage.ts`. → `11-chat-states-empty`.
- Empty chat, Kalsa off / starting / unreachable / setup missing. → `11-chat-states-empty-off` (the other arms are one-sentence swaps, listed there).
- Waiting for the first word ("Reading your message — Kalsa will answer soon."). → `11-chat-states-waiting`.
- Thinking live (cloud ticker, Stop button, Think on). → `11-chat-states-thinking`.
- Thought, collapsed and opened ("Thought for 12 s", Show thinking ▼ / Hide ▲). → `11-chat-states-thought`.
- Web search running ("Kalsa is checking something…"). → `11-chat-states-search-running`.
- Web search done, opened (Searched for:, sources) and page read ("Kalsa read …"). → `11-chat-states-tools-done`.
- Tool failed ("Kalsa couldn't search the web. Try again.", page too long). → `11-chat-states-tools-failed`.
- Web gate (documents attached: "Kalsa wants to search the web. Allow it?", findings, Send it / Refuse). `components/WebGateDialog.tsx`. → `11-chat-states-web-gate`.
- Answer failed (error card + Try again; variants: couldn't answer, not running, stopped after a minute, too much, halfway). → `11-chat-states-failed`.
- Endings: interrupted + Retry, Reply stopped, no answer, content-filter decline. → `11-chat-states-endings`.
- Engine off inside a chat ("Kalsa is off." + Turn Kalsa on). → `11-chat-states-engine-off`.
- Code block with Copy, blocked network image line. `components/Markdown.tsx`, `markdown.ts`. → `11-chat-states-code`.
- Attachments in the composer (documents with pin, pictures, reading line). `Composer.tsx`, `shell.ts`. → `11-chat-states-attachments`.
- Files panel, Attached tab (pages, pin, remove, Previously attached, fit warning). `components/Panel.tsx`, `BudgetMeter.tsx`, `files.ts`. → `11-chat-states-files-attached`.
- Files panel, Files tab (this computer's folders, search, Attach). `components/FilesBrowser.tsx`, `browser.ts`. → `11-chat-states-files-browser`.
- Too much at once (refusal banner) and a file that can't be read. `App.tsx` banners, `files.ts`. → `11-chat-states-attach-refused`.
- Vision offer ("Let Kalsa see images (downloads 850 MB)"), its question, and restarting. `components/VisionOffer.tsx`, `vision.ts`. → `11-chat-states-vision-offer`, `11-chat-states-vision-restarting`.
- Pictures and video in a message, and the full-size viewer. `MessageImages.tsx`, `MessageVideos.tsx`, `MediaViewer.tsx`, `viewer.ts`. → `11-chat-states-media`, `11-chat-states-viewer`.
- Storage full banner, conversation could not open. `App.tsx`, `shell.ts`. → `18-dialogs-notices`.
- Back to latest ↓. `Thread.tsx`. → `11-chat-states-thinking` (shown).
- Message action row (copy + time, check after copying). New. → every chat screen, `11-chat-states-copied`, `11-chat-states-copied-dark`.

## Mini apps (`components/miniapp/*`, `miniapp.ts`)
- Building / built / failed row. `ToolActivity.tsx` MiniappRow. → `12-miniapps-building`.
- Calculator (number fields, formula, result). `Calculator.tsx`. → `12-miniapps-calculator`.
- Quiz, unanswered and checked (Correct / Wrong, correct answer, explanation, Retry). `Quiz.tsx`. → `12-miniapps-quiz`, `12-miniapps-quiz-checked`.
- Checklist (tickable, the AI sees the ticks). `Checklist.tsx`. → `12-miniapps-checklist`.
- Table (sortable headers, "Showing up to…"). `DataTable.tsx`. → `12-miniapps-table`.
- Timeline and metric strip. `Timeline.tsx`, `MetricStrip.tsx`. Not designed: see "Unsure".

## Room (`surfaces/RoomSurface.tsx`, `RoomMediaChips.tsx`, `RoomMediaGrid.tsx`, `room.ts`)
- Conversation with people, Kalsa, day line, queue line, Ask Kalsa. → `16-room`, `16-room-dark`.
- Empty room. → `16-room-empty`.
- Room closed ("Turn on Kalsa to use the room."). → `16-room-closed`.
- Naming yourself ("You are …", name field, name errors). → `16-room-naming`.
- Photos and videos (grid in a bubble, chips compressing / uploading, media errors). → `16-room-media`.
- Clear Room photos and videos (confirm Delete / Keep). → `16-room-clear`.

## Phones (`surfaces/DevicesSurface.tsx`, `InvitePanel.tsx`, `devices.ts`, `invite.ts`)
- Kalsa off ("This computer is not running yet…"). → `09-phones-off`.
- Code almost ready. → `09-phones-loading`.
- The square (QR, "Point your phone's camera at the square.", awareness, capacity line, Invite by link). → `09-phones-square`.
- A phone is connecting: the Allow prompt. → `09-phones-allow`.
- Connected list (This computer, phones, Forget, Pair another phone). → `09-phones-paired`.
- Invite by link (link copied, Expires …, Copy link, Cancel invite). → `09-phones-invite` — not built, see the decision below.
- Errors (couldn't save / couldn't read / can't connect right now / couldn't check). → `09-phones-error`.
- Tailscale lines. → `17-advanced-server` (For experts only).

## Settings (`components/SettingsForm.tsx`, `TelemetrySettings.tsx`, `UpdatesSettings.tsx`, `ReleaseNotes.tsx`, `chrome.ts`, `telemetry.ts`, `updates.ts`)
- Look (Dark theme), Language, Let Kalsa search the web, Error reports, Updates, privacy line. → `03-settings` (update available), `08-settings`.
- The web-search and error-report full notes. → `08-settings-notes-open`.
- Error-report preference failed to save. → `08-settings-save-failed`.
- Updates: checking, up to date, downloading %, failed, busy writing. → `15-update-states-checking`, `-up-to-date`, `-downloading`, `-failed`, `-busy`.
- Update notice: a sheet at Home's bottom edge, and a banner over the other pages; both are in the page's flow, not over the page. Their failed and busy faces too. `components/UpdateNotice.tsx`. → `05-update-notice`, `15-update-states-notice-failed`.

## Help (`surfaces/HelpSurface.tsx`, `help.ts`)
- Sections (What Kalsa is, the Room, Getting started, Home, Chatting, Files and pictures, Web search, Interactive answers, Connecting a phone, When something goes wrong, Why Kalsa), sources. → `10-help`, `10-help-open`.
- Report a problem block (privacy, facts, Send the log, Open the log folder) and its states (sending, sent, rate limited, network blocks, failed). `components/ReportProblem.tsx`, `report.ts`. → `10-help-report`, `10-help-report-sent`, `10-help-report-failed`.

## For experts (`components/AdvancedPanel.tsx`, `AdvancedField.tsx`, `KnobInfo.tsx`, `SamplingPanel.tsx`, `advanced.ts`, `knobs.ts`, `sampling.ts`)
- Entry on Your AI ("For experts ›"). → `17-advanced-entry`.
- Server settings: model name, context presets, batch, micro-batch, KV cache, unload after idle, internet road, values in force, Tailscale lines, Save settings. → `17-advanced-server`.
- A knob's explanation popover (What it is / What it's for / Usual values). → `17-advanced-knob-info`.
- Sampling: groups (Randomness, How much it trims, Repetition, Alternative samplers, This answer), Automatic lines, Save sampling. → `17-advanced-sampling`.
- Validation and save errors ("Temperature must be between …", "Could not save…"). → `17-advanced-sampling-error`.

## Dialogs, toasts and notices
- Rename a chat (inline in the list). `ChatList.tsx`. → `18-dialogs-rename`.
- Delete a chat ("Delete this conversation?"). `ChatList.tsx`, `ConfirmDialog.tsx`. → `18-dialogs-delete`.
- Switch AI confirmation. `MachineCard.tsx`. → `18-dialogs-switch-ai`.
- Crash screen ("Kalsa couldn't show this conversation.", Send the log, Reload, Erase). `components/ErrorBoundary.tsx`, `crash.ts`. → `18-dialogs-crash`.
- Every banner and toast in one board: storage full, conversation couldn't open, too much at once, telemetry notice, recovered, update busy, invite copied, Saved. → `18-dialogs-notices`.

## Copy rule: how Kalsa is referred to (all five languages)
Owner decision, 2026-10-11.
- **English:** Kalsa is "it", never "she/her/herself". "Turn it on", "it can make mistakes", "Kalsa stopped by itself".
- **Italian, Spanish, French:** no neutral form, so Kalsa is feminine: IT "lei" / "la" ("accendila", "si è fermata da sola"), ES "ella" / "la" ("enciéndela"), FR "elle" / "la" ("allume-la").
- **Chinese:** neutral 它 (never 她).
- Every current English she/her line in `chat/src/i18n/en/*.ts` must be rewritten to "it": 19 user-visible lines today (rust.ts 6, power.ts 3, machine.ts 3, files.ts 2, help.ts 2, tools.ts 1, updates.ts 1, shell.ts 1). `grep -nE '\b(she|her|herself)\b' chat/src/i18n/en/*.ts` lists them; code comments can stay. The mockups already use "it" everywhere.

## Copy changes
**All 22 approved by the owner, 2026-10-11.** Old (file) → new. Reason in brackets.
1. Page names: "Devices" (chrome.ts) → "Phones". "What Kalsa uses to answer" / eyebrow "THE AI" (machine.ts) → "Your AI". [plain words; approved round 4]
2. Power page (server.ts) → no page of its own; "Speed · Measured by Kalsa" → Details row "Speed right now"; "Phones · Connected now" → Details row "Phones connected now". [one place for on/off]
3. Home headline/sentence (power.ts): "On" + "Kalsa is ready." → "Kalsa is on" + "Ready to chat."; "Off" + "Kalsa is off." → "Kalsa is off" + "Press the button to wake it up."; "Resting" → "Kalsa is resting"; "Stopped" → "Kalsa stopped"; "Not known" → "Kalsa's state is unknown". The Turn on / Turn off button → the round button with "Press to turn on" / "Press to turn off". [approved round 4; a headline reads as a sentence]
4. Brain bar "Say something…" + Chat / Room buttons → "Start a chat". "This computer: AI · Power · Devices" → "Using Qwen 3.6 · Details ›". [approved round 4]
5. First run (setup.ts): "Pick the AI" → "Which one would you like?"; "Smarter answers." / "Faster answers." → cards "Smartest" / "Quickest" with "The most careful, complete answers." / "Fast replies. Lighter on your computer."; "Use this" → select a card + "Continue"; "4.6 GB download" → "Needs 5 GB of space"; "Downloading…" → "Downloading Kalsa's AI…"; "Finding what runs fastest on your computer…" → "Finding the fastest settings for this computer…"; "Test 2 of 6 · about 4 min left" → "About 4 minutes left" with "Test 2 of 6" kept small under the bar; new final stage "Kalsa is ready" + "Start a chat". [approved round 4]
6. Settings (chrome.ts): "Dark theme" checkbox → "Look: Light · Dark · Automatic"; "Let the assistant search the web" → "Let Kalsa search the web" with note "Only the search words go online. Your chats stay here." and the full original note behind "What leaves this computer?"; "Error reports" → "Send error reports" with "Helps us fix problems. Never includes your chats." and the full original note behind "More about error reports"; the "Save" button and "Saved." are removed (every row applies at once). [the long notes were walls of text; the Save button saved nothing visible]
7. Updates (updates.ts): "Kalsa 0.0.4 is ready." (notice) → "A new version of Kalsa is ready"; release notes behind "What's new"; "Install and restart" → "Restart to update"; "Dismiss" → "Later". In Settings: "Version 0.0.3" row + "Check for updates" (approved). [approved round 3]
8. Chat (sidebar.ts, composer.ts, shell.ts): "+ New chat" → "New chat"; "Conversations" → "Chats"; the paperclip → "Attach a file" button; "Stop generating" → "Stop"; "Files" topbar button → "Files" button in the chat header. Disclaimer stays "Kalsa can make mistakes. Check important information." (round 4 said "Check important things."; reverted to the app's line) and now sits inside the composer, between Attach a file and Send (owner, this round). In the Room it is shortened to "Kalsa can make mistakes." to fit beside Ask Kalsa.
9. Files (files.ts): "Pin" → "Keep"; "Pin: send with every message" → "Keep sends the file with every message."; "Attached" tab → "In this chat"; new group label "Read with your next message". [“pin” is jargon]
10. Tools (tools.ts): "Kalsa is checking something…" → "Searching the web…" for a search and "Opening a page…" for a page. [say which]
11. Vision (vision.ts): "Let Kalsa see images (downloads 850 MB)" → "Let Kalsa see pictures · 850 MB"; question unchanged. [“images” → “pictures”, as the rest of the app says]
12. Help (help.ts): "Three pages under This computer: AI, Power, Devices" → "Details on Home opens Your AI: which AI Kalsa uses and how fast it runs. Phones connects a phone."; "+ New chat … list on the left" → "New chat starts a fresh conversation. Chats, at the top of the chat, lists your past chats: you can search, rename or delete them."; "On the AI page, Report a problem → Send the log" → "Here, under Report a problem, press Send the log." [the new layout]
13. Report a problem (report.ts): moved from the AI page to Help; copy unchanged.
14. For experts (advanced.ts, sampling.ts): eyebrows "ADVANCED" / "MESSAGE SETTINGS" → one page "For experts" with two sections "Server settings" and "Sampling"; knob names stay technical (the owner's exemption).
15. Phones (devices.ts): headline "Connected" → "Your phones"; "Forget" → "Remove"; the Tailscale lines move to For experts.
16. Room (room.ts): copy unchanged; new: page title "Room", empty title "The Room", closed title "The Room is closed", attach button "Attach a photo".
17. Home states, new lines: headline "Kalsa couldn't start" (with the held failure as the sentence), "Kalsa didn't turn off" + "Close this window to stop her.", "Kalsa stopped" + Rust reason; the migrating check gets the sentence "This happens once, after an update."; the alpha notice gets a title "Error reports are on during the alpha".
18. First run, new lines: too-weak title "Kalsa can't run well on this computer yet" + "Kalsa will not start on a computer where it would be too slow." + "Check for updates" button; the confirm page reuses the app's "Download 20.6 GB?" and needs-files lines; tune-cut ends with "Kalsa is ready" + "Kalsa will finish testing next time it starts." + Start a chat.
19. Phones, new lines: "Connect a phone", "Use Kalsa from your phone, anywhere at home.", steps "Open Kalsa on your phone." / "Press Allow here when your phone asks.", "Someone not at home?", "Only press Allow if this is a phone you know.", host row "Kalsa runs here.", headline "Kalsa is off" over the not-running sentence.
20. Dialogs, new lines: delete dialog shows the chat title and a Cancel button; switch dialog title "Switch to Quickest?" (body and button are the app's); rename row shows "Enter to save".
21. For experts, new lines: tag/title "For experts", lead "Kalsa picks good values for this computer by itself. Change these only if you know what they do.", entry-card blurbs for Server settings and Sampling, "N settings" counts on sampling groups. The Tailscale line shows a placeholder: the real commands come from the backend.
22. Tools: the web gate's waiting row says "Waiting for your OK…".

## Copy simplification (owner, 2026-10-12)
Four specific changes, in all five languages:
1. Your AI → Details: "Queste velocità valgono per una conversazione breve…" / "These speeds are for a short conversation. Long ones are slower." → "Le risposte rallentano man mano che la conversazione si allunga." / "Answers get slower as a conversation grows longer." [the old line did not make sense alone]
2. Your AI reason line for an AI the user picked: "L'hai scelta tu." / "You picked this AI." removed. The line renders nothing for that code (`MachineCard.tsx` `reasonSentence`). [owner: "che vuol dire?? togliamola"]
3. Updates note: "Non installa nulla senza di te." / "Nothing is installed without you." removed. [patronising]
4. Help intro: "Kalsa è un assistente AI che funziona sul tuo computer. Le tue domande ricevono risposta qui, su questo computer, non sui server di un'azienda. Kalsa vive anche sul tuo telefono. I due lavorano insieme:" → "Kalsa è un assistente AI che funziona sul tuo computer. Funziona anche sul telefono, e i due lavorano insieme:" (EN: "Kalsa is an AI assistant that runs on your computer. It also works on your phone, and the two work together:"). No "without the internet" claim: web search exists.

General pass (principles, not every string; EN and IT done, ES/FR/ZH to follow):
- Remove sentences that state the obvious or reassure for no reason; cut filler and repeated "here, on this computer".
- Em-dash asides become full stops or colons. Short declarative sentences, formal and sober, no exclamation marks.
- Italian keeps "tu".
- Kept as they were: the Home footer "Your messages and answers stay on this computer."; the "Kalsa can make mistakes" disclaimers; telemetry and privacy text; error messages that say what to do; energy claims.
- Knob explanations in For experts keep their technical content (names, values, measurements) and lose the filler; "Automatic — 4 096" style labels became "Automatic: 4 096" in EN and IT.
- ES, FR and ZH have their own Help files (`es/help.ts`, `fr/help.ts`, `zh/help.ts`), translated from the approved EN/IT Help and wired in each `all.ts`; a change to `en/help.ts` does not reach them, so edit all five.
- The Hearth mockups (`hearth/`, `_src/`) still show the old wording; they were not regenerated.
- Full EN and IT pass done (2026-10-12), every file in `i18n/en` and `i18n/it`. Principles: short declarative sentences; no reassurance, no personification ("lives", "wakes it up", "a guest"), no instructions to look at what is already on screen; "Kalsa" for the assistant instead of "the assistant"; Italian rewritten as Italian prose (no calques such as "girare", "becca"; "Stanza" capitalised; the AI is feminine throughout; "ragionamento" for Think); decisions, consent text, error next steps and measured figures unchanged. ES, FR and ZH followed in phase 2 (2026-10-12).

## Owner decisions, 2026-10-11
- **Phones** is a real page: no "Soon" anywhere. The rail shows Phones as a normal item on every screen.
- **"Automatic" theme** option: approved.
- **Pronoun:** see the copy rule above. English "it" everywhere; she/her removed from every mockup.
- **Copy on every answer:** added. Under each finished assistant message, a quiet row: a 14px copy icon (two overlapping squares, muted grey, hover tint, no label, no chrome) and the time ("12:30 PM") in small muted text. After copying, the icon turns into a check for a moment. The row is absent on a reply still being written, on failure cards, on "interrupted" and on "no answer". → every chat screen, plus `11-chat-states-copied`, `11-chat-states-copied-dark`.
- **All 22 copy changes:** approved.

## Earlier open questions (kept for the record)
1. ~~Phones "Soon"~~: decided, a real page.
2. **The Room in the rail.** The app has a Room, so the rail now has Home, Chat, Room, Settings, then Help and Phones. The approved round-4 screens were rebuilt with it.
3. ~~"Automatic" theme~~: approved.
4. ~~She or it~~: decided, see the copy rule.
5. **Timeline and metric strip** mini apps still exist in code (`Timeline.tsx`, `MetricStrip.tsx`), but the owner removed kpi_strip on 2026-10-07; not designed.
6. ~~Message actions~~: decided, copy + time row added.
7. **Model name field** (Advanced "Model name", EmptyState "models" arm) is a leftover from the connection form; kept in For experts only.
8. **Settings Save button** removed: everything on the page already applies at once.
9. **The Power page** is gone as a page: on/off is Home, speed and phones are in Your AI → Details. If the owner wants it back, it is one more Details row set, not a new screen.
10. **Report a problem** moved from the AI page to Help (and stays on the crash screen). The recovered notice's "Send the log" should then open Help.
11. **Message pictures from the network** are blocked by design ("Image blocked…"); designed as a quiet grey line inside the answer.
12. **Timestamps, "This week" groups and sample names** (Giulia, Marco, Nonna Lia, Living room, Phone 2/3) are sample content.

## Decided after the port began
- Home footer (owner 2026-10-11): "Your messages and answers stay on this computer." — not "Everything…", because alpha error reports and web search leave the computer.
- Invite by link (owner 2026-10-11): unchanged. `09-phones-invite` stays unbuilt, and the invite link is never shown on screen except in the existing field the page offers when the clipboard refuses it.
- Update failed (owner 2026-10-11): the failed install says "Kalsa couldn't download the update. Try again."; the backend's own code and words sit behind "Show details", in Settings and on the notice (`15-update-states-failed`, `-notice-failed`). A failed check keeps its own sentence.
- Closed Room (owner 2026-10-11): "Turn Kalsa on" as drawn in `16-room-closed`, running Home's own start.
- Notices in the page's flow (decided 2026-10-12, not an owner call): the top notices and the update banner sit above the page, not over it, and each is capped at 12% of the window and scrolls inside that. At the 720×480 minimum the Chat and Room composers stay in the window with both showing. The Home sheet is in the same flow.
