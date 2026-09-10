# B2 Chat Search — implementation status (2026-09-04)

STATUS: complete. Reused the existing `filterByTokens`, conversation metadata/searchBlob update chain, DrawerContent search UI, and existing empty-state/i18n. The immediate TextInput draft is separate from the debounced query used by filtering, empty state, and highlighting. Search blobs use a 12,000-code-point tail bias: recent messages stay searchable, while very early content beyond the cap remains intentionally unindexed; the larger cap reduces that trade-off.

Search-clear policy: every drawer close action for conversation switch, new chat, delete, and tool/overlay selection calls `clearChatSearch()`, matching backdrop/persona close behavior.

Checklist: F1 DONE · F2 DONE · F3 DONE · F4 DONE · F5 DONE · F6 DONE · F7 DONE · F8 DONE · F9 DONE · F10 DONE · F11 DONE · F12 DONE · F13 DONE · F14 DONE · F15 DONE.

Verification: `npx jest src/conversations/ConversationsStore.test.ts src/theme/components/highlightMatches.test.ts --runInBand` exit 0; `npx tsc --noEmit` exit 0.
