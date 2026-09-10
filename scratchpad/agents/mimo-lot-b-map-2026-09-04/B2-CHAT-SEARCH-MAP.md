# B2 Chat Search — Codebase Map (2026-09-04)

**Branch**: `feat/moe-stream`
**Baseline scout**: `LOT-B-memory-search-docs.md` section B2
**Purpose**: What to reuse, what to fix, what NOT to rewrite.

---

## Already done (do not rewrite)

- **`filterByTokens()`** — keyword AND search, tokens <3 chars ignored when longer exist, all-lowercase `includes()`.
  `src/util/filterByTokens.ts:21-33`

- **`filterConversations()`** — recency-sorts then delegates to `filterByTokens` over `[title, searchBlob]`.
  `src/conversations/ConversationsStore.ts:145-151`

- **`searchBlobFromMessages()`** — joins all `m.text` strings, lowercases, clips to `SEARCH_BLOB_CAP=8000` via `clipChars()`.
  `src/conversations/ConversationsStore.ts:117-128`

- **`clipChars()`** — Unicode-safe truncation using `Array.from()`.
  `src/conversations/ConversationsStore.ts:86-90`

- **Search input UI** — `DrawerContent` renders a `<TextInput>` with `Search` icon, `clearButtonMode="while-editing"`.
  `src/theme/components/DrawerContent.tsx:95-112`

- **Live filter, no debounce** — `setChatSearch` is wired directly to `onSearchChange`, no `useDebouncedCallback` or throttle.
  `src/app/AppShell.tsx:849,5293`

- **Empty state** — `drawer.noMatches` renders when `searchValue?.trim()` is truthy and `conversationItems.length === 0`.
  `src/theme/components/DrawerContent.tsx:47,119-122`

- **i18n** — `drawer.searchChats` and `drawer.noMatches` present in both `en.ts:41-42` and `it.ts:40-41`.

- **searchBlob updated on every persist** — `persistActiveMessages` → `notifyConversationTouched` → `searchBlobFromMessages(msgs)` → `upsertMeta` → `saveConversationsState`. Called on send, edit, regenerate, cancel, and background save.
  `src/screens/AiChatPage.tsx:944-972` (notifyConversationTouched), `:969` (wired into persistActiveMessages), `:3034` (regen path), `:3172` (edit path)

- **searchBlob IS rebuilt on edits/regens** — every code path that writes messages calls `persistActiveMessages`, which always calls `notifyConversationTouched(msgs)` with the full current messages array.
  `src/screens/AiChatPage.tsx:969` — `if (wrote) notifyConversationTouched(msgs);`

- **NOTES have separate search** — `NotesStore.ts` uses its own `searchBlobFromNoteBody()` and `filterByTokens()`, independent from chat search. Not cross-searched.
  `src/notes/NotesStore.ts:80-84,146`

## Gaps to fix (ordered by value)

### G1: No debounce on search input
Every keystroke triggers `filterConversations()` over all conversations. For large lists (50+ chats) this could jank.
`src/app/AppShell.tsx:849,5293` — `const [chatSearch, setChatSearch] = useState("")` wired directly to `onSearchChange`.

### G2: No match highlighting
Search results show matching conversation titles/previews as plain text. No bold/highlight of matched tokens.
`src/theme/components/DrawerContent.tsx:126-141` — renders `item.title` and `item.preview` as plain `<Text>`.

### G3: No jump-to-message
Search only filters the conversation list. No ability to search within the active chat or jump to a specific message by content match.
Evidence: `filterConversations` only operates on `ConversationsState.items` (metadata list), not individual messages.
`src/app/AppShell.tsx:2237`

### G4: Truncation blind spot — long conversations
`SEARCH_BLOB_CAP = 8000` chars. A conversation with many messages (e.g., code-heavy, long outputs) will have early messages truncated out of the search index. Messages past ~8KB of concatenated text are invisible to search.
`src/conversations/ConversationsStore.ts:48,128`

### G5: Cross-chat search not implemented
Search only hits the conversation list metadata. Cannot find "the chat where I discussed X" across all conversations by message content.
The scout noted "Future: a retrieve-other-chats tool" at `ConversationsStore.ts:10-13` (comment is now at line 10).

### G6: Notes/docs not searchable from chat drawer
Notes search is a separate UI (`NotesStore`). Chat drawer search does not include notes.
`src/notes/NotesStore.ts:146` — `filterByTokens(list, query, (item) => [item.title, item.searchBlob])` is separate.

### G7: No tests
Zero test files for `filterByTokens`, `filterConversations`, `searchBlobFromMessages`, or `clipChars`. No `*.test.*` in the repo for these functions.
```
$ find . -name "*.test.*" -not -path "./node_modules/*" | xargs grep -l "filterByTokens\|searchBlob" 2>/dev/null
(no output)
```

### G8: 8KB cap uses character count, not token count
`clipChars` truncates by Unicode character count. Token count varies by model/language. 8000 chars ≠ 8000 tokens. For code-heavy conversations, 8000 chars could be much less content than expected.
`src/conversations/ConversationsStore.ts:48,128`

## Recommended minimal patch set

| File | Change |
|------|--------|
| `src/app/AppShell.tsx` | Wrap `setChatSearch` in a debounced setter (e.g., `useDebouncedCallback` or `setTimeout` 150ms) — 5 line change |
| `src/theme/components/DrawerContent.tsx` | Add `<Text bold>` or background highlight for matched tokens in title/preview — ~20 lines |
| `src/conversations/ConversationsStore.ts` | Bump `SEARCH_BLOB_CAP` to 16,000 or implement sliding window (tail-biased) — 1 line if cap bump |
| `src/conversations/ConversationsStore.ts` | Add `filterByTokens` unit tests (pure functions, no mocking needed) — new test file |

## Out of scope for B2

- **Cross-chat semantic search** (would need E5 embedding pipeline for messages — B5 scope, structural)
- **Jump-to-message within active chat** (requires message-level index, new UI component)
- **Notes/docs integration** in chat search (separate store, separate UI, deliberate separation)
- **Fuzzy / fuzzy-match / typo tolerance** (would need new algorithm, e.g., Levenshtein or trigram)
- **Stemming / lemmatization** (would need NLP library or regex rules)
- **Semantic ranking / TF-IDF** (would need embedding or statistical model)

## Quotes

`src/conversations/ConversationsStore.ts:48` — `export const SEARCH_BLOB_CAP = 8_000;`

`src/conversations/ConversationsStore.ts:117-128` — `export function searchBlobFromMessages(messages) { ... return clipChars(parts.join("\n").toLowerCase(), SEARCH_BLOB_CAP); }`

`src/conversations/ConversationsStore.ts:145-151` — `export function filterConversations(items, query) { ... return filterByTokens(list, query, (item) => [item.title, item.searchBlob]); }`

`src/util/filterByTokens.ts:21-33` — `export function filterByTokens<T>(items, query, fieldsOf) { ... return list.filter((item) => matchesTokens(tokens, fieldsOf(item))); }`

`src/theme/components/DrawerContent.tsx:47` — `const emptySearch = Boolean(searchValue?.trim()) && (conversationItems?.length ?? 0) === 0;`

`src/theme/components/DrawerContent.tsx:119-122` — `emptySearch ? <Text ...>{t("drawer.noMatches")}</Text> : ...`

`src/app/AppShell.tsx:849` — `const [chatSearch, setChatSearch] = useState("");`

`src/app/AppShell.tsx:2237` — `filterConversations(conversations.items, chatSearch).map((item) => ({`

`src/app/AppShell.tsx:5293` — `onSearchChange={setChatSearch}`

`src/screens/AiChatPage.tsx:944-953` — `const notifyConversationTouched = useCallback((msgs) => { ... cb({ title: ..., preview: ..., searchBlob: searchBlobFromMessages(msgs) }); }, []);`

`src/screens/AiChatPage.tsx:969` — `if (wrote) notifyConversationTouched(msgs);`

`src/i18n/en.ts:41-42` — `searchChats: "Search chats", noMatches: "No matching chats"`

`src/i18n/it.ts:40-41` — `searchChats: "Cerca nelle chat", noMatches: "Nessuna chat corrispondente"`

`src/notes/NotesStore.ts:18` — `export const NOTE_SEARCH_BLOB_CAP = 4_000;`
