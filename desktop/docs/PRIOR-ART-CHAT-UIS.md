# Prior art: what the open-source chats already solved

Read on 2026-09-16 night, from the published sources only — nothing cloned, nothing built.
Every claim below quotes a file and a line that was actually read. Where a claim comes from
another project's comment rather than from our own measurement, it says so.

## 1. The four candidates, and which are legally usable

Read from the LICENSE files, not from GitHub's licence chip — two of the four are reported
as `NOASSERTION` there and both readings are misleading.

| app | licence (read) | runtime | verdict |
|---|---|---|---|
| Jan (`janhq/jan`) | Apache-2.0 | **Tauri** | usable, and the closest neighbour we have |
| DeepChat (`ThinkInAIXYZ/deepchat`) | Apache-2.0 | Electron | usable, wrong runtime |
| LibreChat (`danny-avila/LibreChat`) | MIT | server + web | usable, wrong shape (see below) |
| Open WebUI | BSD-3 **+ clause 4** | web | **disqualified**: clause 4 forces the "Open WebUI" branding to stay |

Jan's chip says `NOASSERTION` only because its LICENSE opens with `Copyright 2025 Menlo
Research`; the body is Apache-2.0 verbatim.

**LibreChat is not strippable, and the tree says so without an opinion being needed**: 5392
tracked files, with `packages/data-schemas/misc/documentdb/`, `misc/ferretdb/`,
`multiTenancy.ferretdb.spec.ts`, `sharding.ferretdb.spec.ts`, `common/permissions.ts`. That is
a multi-tenant hosted product with three database back-ends. Taking the chat out of it is not
stripping, it is a rewrite.

Apache-2.0 and MIT both still require the copyright and licence notice to travel with anything
we lift verbatim. Ideas are free; files are not.

## 2. Worth copying, cheapest first

### 2.1 Two scroll behaviours, not one (≈60 lines)

`web-app/src/constants/threadScroll.ts` names the choice out loud:

```ts
// FLOW: "chatgpt" behavior (keep viewport anchored to the latest user message)
// STICKY: auto-follow streaming replies
```

`web-app/src/hooks/useAutoScroll.ts` is the whole implementation: a `BOTTOM_THRESHOLD = 20`
px, an `isStuckRef` that the scroll handler recomputes, and a `forceScrollToBottom` for the
jump-to-bottom button. Fifty lines, no dependencies.

The insight worth more than the code: **following the stream is the wrong default**. Anchoring
to the user's own last message means the answer grows downward in a still viewport instead of
the text sliding under the reader's eyes. For someone who does not know what a token is, that
difference is most of the "feels finished" impression.

### 2.2 Automatic conversation titles (≈120 lines)

`web-app/src/lib/thread-title-summarizer.ts`. Two halves, and the second is the valuable one:

- `generateThreadTitle` — a non-streaming call, `maxOutputTokens: 128`, an `AbortSignal`, and
  thinking explicitly disabled for the utility call (`chat_template_kwargs: { enable_thinking:
  false }`).
- `cleanTitle` — a pure, testable function that strips `<think>`/`<reasoning>` blocks, returns
  `null` when only an *unclosed* opener is present (the output is all reasoning, unusable),
  drops leftover tags, collapses whitespace, strips quotes, keeps `\p{L}\p{N}` and spaces, and
  caps at ten words.

`cleanTitle` is the part to lift outright. Every local model we ship emits something ugly
around a title, and a title that says `<think>Okay, the user` is worse than "New chat".

### 2.3 Engine failures that a human can read (≈150 lines)

`web-app/src/lib/engineError.ts` defines nine stable codes — `MODEL_LOAD_FAILED`,
`MODEL_ARCH_NOT_SUPPORTED`, `MODEL_LOAD_TIMED_OUT`, `MISSING_SHARED_LIBRARY`,
`GPU_DRIVER_TOO_OLD`, `OUT_OF_MEMORY`, `INVALID_ARGUMENT`, `IO_ERROR`, `INTERNAL_ERROR` — and
says where the contract lives:

> Mirrors `ErrorCode` in `tauri-plugin-llamacpp/src/error.rs`. The Rust side has a test pinning
> these exact strings, since they cross the IPC boundary as the contract this file matches on.

That is exactly our shape: Rust launches the server, the UI has to explain the failure. The
pattern to copy is the **pinned string contract with a test on the Rust side**, plus the split
between `message` (shown) and `details` (raw engine output, behind a disclosure).

`parseEngineError` also walks `Error.cause` up to `MAX_CAUSE_DEPTH = 4`, because an
intermediate layer will have stringified the structured error at least once.

`web-app/src/utils/error.ts` is smaller and even more directly ours — it parses llama-server's
own overflow text:

```ts
// "request (N tokens) exceeds the available context size (M tokens)…"
const m = message.match(/\((\d+)\s+tokens?\)[^(]*?\((\d+)\s+tokens?\)/i)
```

We ship the same server, so we will get the same string.

### 2.4 Message versioning as a parent pointer (≈150 lines)

`web-app/src/lib/message-branching.ts`:

> `metadata.parentId` links a message to its predecessor. Messages sharing a `parentId` (or both
> rootless) are sibling versions. `metadata.activeChildId` selects which child branch is shown;
> absent ⇒ the newest sibling (by `created_at`) wins.
>
> Legacy threads carry no branching metadata and are treated as a single linear path until the
> first fork backfills parent links.

LibreChat independently arrived at the same model: `packages/data-schemas/src/schema/message.ts`
has a bare `parentMessageId: { type: String }` alongside `conversationId`. Two unrelated
projects converging is about as much evidence as a data model ever gets.

**Why this one matters more for us than for them.** The owner's differentiator is that a chat
started on the phone continues on the PC. A parent pointer is **additive**: a client that knows
nothing about branching still renders the thread correctly, because the absence of the field
means "single linear path". So the phone can ship without edit/regenerate and keep working the
day the PC gains it. Any design where branching changes the *shape* of the stored thread
(nested arrays, per-branch documents) forces both clients to move together, forever.

### 2.5 A first-run checklist with honest states (≈200 lines)

`web-app/src/hooks/useSetupChecklist.ts`: stages `'system' | 'engine' | 'search'`, each with
`'pending' | 'running' | 'ok' | 'warning'` — note there is **no** `'error'`, a first run that
finds a problem still continues. Two details worth stealing verbatim:

- `messageKey?: string` with the comment *"the hook never produces prose"*, and `detail?: string`
  *"Raw technical detail for a disclosure area; never translated."* The logic layer emits keys
  and raw text, never sentences.
- The GPU badge: `willUse?: boolean` stays **undefined** while the engine is still starting,
  because *"neither answer is known yet"*. Three states, not two. We will need exactly this the
  first time someone asks the app whether it is really using their GPU.

And `useIsOnboarding.ts` states the rule that keeps first-run sane:

> The setup screen is the single onboarding surface, so every other first-run prompt stays out
> of the way until this is false — otherwise they stack on top of it.

### 2.6 Keyboard map (≈40 lines)

`web-app/src/lib/shortcuts/const.ts`: `⌘B` sidebar, `⌘N` new chat, `⌘,` settings, `⌘K` search,
`⌘±` zoom, with an `aliasKeys: ['=', 'Add']` for the ones a keyboard layout renames. Nothing
clever, but it is the set users already have in their fingers, and getting it from a file
beats inventing it.

## 3. Deliberately not copying

- **RAG / vector search / embeddings.** Jan's setup checklist has a whole `'search'` stage for
  it. Cut before it exists.
- **MCP, tools, agents.** `web-app/src/lib/` has twenty-odd `cowork*` files. That is a second
  product.
- **A provider registry.** They support dozens of remote endpoints; we have one local server
  and an OpenAI-compatible URL. `providerReadiness`, `providerCaps`, `remoteModelCatalog`,
  `provider-api-keys` all collapse to nothing for us.
- **The `ai` SDK / `@ai-sdk/react`.** Jan's title summarizer, context manager and transport all
  route through it. A single `fetch` with a streaming body is ~100 lines and no dependency
  tree.
- **Token estimation by character count.** `lib/context-manager.ts` uses
  `CHARS_PER_TOKEN = 3.5` and calls it "intentionally conservative". We have the real tokenizer
  behind the server; a guess would be a regression, not a shortcut.

## 4. A llama.cpp finding that lands on multi-device, not on the UI

Jan pins its background calls to a **fixed** slot index and explains why in a comment. Checking
that against the source we actually ship, `tools/server/server-context.cpp` at tag **b10950**,
lines 1521-1522:

```cpp
// note: allow id_slot to be out of bounds (wrap around)
id_slot = id_slot % slots.size();
```

An out-of-range `id_slot` is not rejected. It wraps. With one device per slot, the fifth paired
phone silently lands on the first phone's slot: it evicts that person's warm prefix and shares
a cache with them. No error, no log — it is documented behaviour.

This is a constraint on the multi-device work, not on the chat UI: the device→slot map has to be
validated on our side, and the slot count has to come from the same place that renders
`--parallel`, not from a second source that can disagree.
