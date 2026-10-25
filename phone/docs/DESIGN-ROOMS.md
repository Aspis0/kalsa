# Rooms and quotations

Design for two features that arrive together: **a shared room where several people talk**,
and **quoting a message when you reply**. Written while the audit of `6778713` runs, so it
stays a separate file: `docs/DESIGN.md` is frozen inside that commit. Merge this as a new
section of the plan once the audit lands, then audit the merge.

Sections 2 and 8 were rewritten after reading `kalsa-brain/docs/HOUSEHOLD-RULES.md` §4–§5
and `WHAT-IS-MISSING.md` §10, and §2.5 after reading `kalsa-brain/docs/PLAN-CHAT-ON-DISK.md`
(version 3). **The room is already designed on the hub and is not built.**
The first draft of this document contradicted that design in three places; the corrections
are marked *corrected*, and the reason each one was wrong is kept, because the same wrong
instinct will come back. This document is the phone's face on the hub's design, not a
parallel invention.

## 1. The thesis

**The room is for people. The AI is a guest with a doorbell.**

But the hub's rule is sharper, and the first draft got it half wrong. `HOUSEHOLD-RULES.md`
§5.1: **the AI hears the whole room and pays late.** Nothing is sent to the model while
people talk; at the instant somebody addresses it, the room hands over everything said since
the last time it was addressed, in one batch, one prefill. **Hearing and speaking are two
different rules.** The AI hears everything and speaks only when addressed, because otherwise
a family room becomes a room with someone interrupting in it.

*Corrected.* The first draft had the AI reading only what it was summoned for, and treated
that as a privacy protection. Both halves were wrong:

- **Privacy is not the argument.** The model runs on the family's own PC; nothing leaves.
  The hub says it outright: using privacy as the argument for keeping the room out of the
  model "would have cost us a genuinely better product for nothing".
- **The honest surface is not what the AI may see, it is how far back it still remembers.**
  A family room running all day fits in no context we can afford, so a morning falls off the
  end. The room should say so, rather than letting people wonder why it forgot.

So the room states its **window**, and the state of that window is part of the interface
(§7). The invitation does not warn about reading; it says where the answer comes from and
how far back the room remembers.

Three things follow from the thesis, and everything else here follows from them:

1. No AI turn exists without someone addressing it.
2. An answer is always **about** something, so it always quotes the message that summoned it
   — the only way to read an answer that arrives into a room that has moved on.
3. The AI's turn is a **shared resource with a visible order** (§2.4), because in a room the
   history is shared.

## 2. The hard problems

### 2.1 An answer that arrives long after the room moved on

Generation can take tens of seconds. People keep writing.

- The summon attaches a **pending marker to the invoking message**, not a typing bubble at
  the bottom of the transcript. A bubble at the bottom is a lie about where the answer is
  going: it points at the tail of the room while the answer belongs to a message further up.
- When the answer lands it appears **at the bottom**, because in a live room an arriving
  message is an event and events are read where they arrive. This is also the only thing the
  current code can do: appends are end-of-array only and there is no id-addressed insert
  (below, §8.9). It carries the **quotation** of the invoking message: author, two lines,
  and a jump.
- The marker on the original message becomes *answered*, tappable, jumping to the answer.
- If generation fails the marker becomes an error with a retry, attached to the same message.
  It never disappears silently — and that promise has a cost recorded in §8.17: the marker's
  state and its link to the answer are new fields, and §8.10's trap is exactly that new fields
  are written and dropped on restore unless the loader's whitelist is extended. Without that
  row, this bullet is a promise the storage layer will break silently.

### 2.2 Who generates, and whose battery

**In a room the AI answers from the PC.** The hub already holds the room, the context and the
warm cache; the room is the cheapest multi-device mode precisely because it is one context
appended to by several people (`HOUSEHOLD-RULES.md` §4). The phone subscribes and renders.

The visible consequence: if Kalsa Brain is not reachable, **the summon control is not shown**,
with the reason where it would be, rather than offering it and failing later.

This keeps the fit gate out of the room. The fit gate prices the RAM of the phone in front of
you; pricing a subscriber's phone for a generation that runs elsewhere would be wrong (§8.7).

### 2.3 Consent, and what the room says about itself

Joining is per person, explicit, and reversible.

- **Invited / joined / left** are three distinct member states.
- Declining is quiet: nothing is announced. The creator sees that the invitation was not
  accepted, without a name attached to the refusal.
- Leaving is visible as *left*, because a room containing messages from someone who has left
  is a different room from one where that person is still listening.
- A room is **a different object from a private conversation, not a flag on one**
  (`HOUSEHOLD-RULES.md` §4). A flag gets flipped by a later refactor and the rule that one
  person's context never becomes another's dies quietly.

*Corrected.* The first draft put this sentence on the join screen: "Se qualcuno chiama
Kalsa, Kalsa legge la conversazione della stanza." It is true and it was the wrong sentence:
it frames reading as a risk, and the hub measured that reading is not the risk. What the
join screen says instead is §7's three facts: the answer comes from the PC of the house, the
room remembers a window, and the window is visible.

### 2.4 The floor — corrected, and the largest change

*Corrected.* The first draft had the summon button disabled while a generation was running.
That contradicts the hub's design, which is not a lock but a **rotation**:

- **In a room, exactly one AI turn runs at a time. Always**, however many slots the machine
  could afford — and not for speed. In a room the history is shared, so two answers built at
  once are two answers built on different pasts: same room, same messages, a different
  transcript each time. That is a room that stops being reproducible (`§5.2`).
- **The order is a rotation between people, not a queue of messages.** First-in-first-out by
  message hands the machine to whoever has the fastest thumb; three messages from one person
  and the others wait three turns.
- **Each person may have at most one prompt pending.** The queue can never be deeper than the
  number of people present, which makes it bounded by construction. A second prompt from
  someone who already has one waiting is **refused with an honest message**, not silently
  accepted.
- **Ties go to whoever was served least recently**, stamped on arrival by the door's own
  monotonic clock — not the phone's clock, which household phones disagree about, and not
  the device id, which would make whoever registered first win every tie forever.
- **The order is visible to everyone**: whose turn is running, who is next, how many are
  waiting. **Names only.** "Kalsa sta rispondendo a papà, sei il prossimo" is allowed; one
  word about what papà asked is not.
- **Stopping, in two states, because the hub makes them different.** `HOUSEHOLD-RULES.md`
  §5.5 gives you two rights: withdraw your own pending prompt, and stop an answer being
  generated for you. They are not the same act, and the difference is the handover. §5.1
  hands the model everything said since the last addressing **at the instant somebody
  addresses it**, as one batch. So a queued prompt may already ride inside the batch that is
  being prefilled before its own turn starts:
  - **While your prompt is still queued behind someone else's**, withdrawing really recalls
    it: it leaves the rotation and nobody is served on it. The action reads **Ritira**.
  - **Once your turn is being served**, the text is already in the model's context and
    cannot be taken back. The action reads **Ferma** and stops the generation. The interface
    must not use one word for both, and must not imply a recall it cannot perform at the
    moment the batch has already gone.
  Nobody stops someone else's turn: a room where a brother can cut you off mid-answer is
  worse than one where you wait. The machine's owner can always stop the machine.

So the summon control is **enabled while someone else is being served** — pressing it puts you
in line, which is useful information — and **refused when you already have one pending**, which
is the one case the rule forbids.

### 2.5 What the desktop plan imposes on this room

`PLAN-CHAT-ON-DISK.md` version 3 settles the shape of the desktop brain: **one slot per
device, non-unified, full window each** — every device's chat resident and warm, and nobody's
slot cleared to make room for somebody else's. Four of its decisions reach into this
interface, and they are not preferences.

1. **The room has no model switch.** A model change "destroys every slot and every prompt
   cache in the house", with the product rule that a phone must never trigger it while other
   devices are attached. The room header carries the room and its members and no model picker.
   The first mock had already dropped it; it is now mandatory rather than a taste.
2. **No number in the room before it is measured and committed.** The plan's rule is blunt:
   *"No number reaches the user interface before it is committed in a stripped artifact. This
   is what killed versions 1 and 2."* So the room states its window as a **behaviour** — how
   far back it still remembers (§7) — and never as a speed, a cost or a percentage. The
   marginal cost of an extra resident device (55.78 MiB, the sliding-window layers replicating
   per stream) and the window per device (`pool / N`) are the hub panel's numbers, derived
   from the launcher's own arithmetic. Neither appears inside a room.
3. **The room's slot must never become a private chat's slot.** The isolation test the
   household rules mandate asserts that one device's marker never appears in another device's
   answer. A room is the one place where sharing context is the feature, so the room's context
   must never be handed to a private conversation. That is the same rule read backwards, and
   it is why a room is a different object and not a flag (§2.3).
4. **The room does not depend on the unmeasured number.** The plan says it plainly: what two
   devices talking at once costs per stream *"does not exist yet"*, and the panel may not
   print it. A room never has two generations running (§2.4), so the one place in the product
   that could need that figure is the one place that never needs it.

Two things the plan leaves open, and this design touches both:

- **Does a room occupy one slot for all its members, or one per member device?** The plan's
  isolation unit is the device. The household rules call a room one conversation, one context,
  one cache, and the cheapest multi-device mode — which only holds if the room is one slot,
  since four people in one room are cheaper than two people in two private chats. The two
  sentences must be reconciled before the floor can show a window, because the window is
  `pool / N` and `N` depends on the answer.
- **A device forgotten while it holds a slot.** Enrolment shrinks, the number the launch was
  sized for does not, and whether the freed seat is reusable before a relaunch is unsettled.
  The room's *left* member state (§2.3) has the same question underneath it.

## 3. One gesture for two features

| | one-to-one chat | room |
|---|---|---|
| long-press a message | quote it | quote it |
| the composer shows a quote bar | yes | yes |
| the quote bar can be dismissed | yes | yes |
| an extra labelled action appears | **no** | **yes**: ask Kalsa about this |
| the answer arrives later, quoting the message | no | yes |
| a turn order is shown | no | yes |

In a one-to-one chat the quotation is for you: it sits above your next message and the model
is told which message you are answering. No button appears, as required.

### 3.1 The invocation is visible in the text

*Corrected after the owner read the first mock.* That mock attached "Kalsa sta rispondendo…"
to a message reading "E se piove?", which implies the AI worked out from the content that the
message was addressed to it. It cannot, and it must not.

- **The AI is called by the button or by `@`, and both write a visible `@Kalsa` into the
  message.** One mechanism, not two: whoever scrolls the room sees why the AI spoke, and there
  is no way to summon it without leaving a trace in the text. The accepted cost is that
  `@Kalsa` appears even when the sentence would have been cleaner without it.
- **`@` addresses Kalsa only.** The owner chose the simplest grammar: one token, one meaning.
  People are named in words. This keeps `@Kalsa` unambiguous — it is the act, and it is also
  the instant the bill starts.
- **Nothing is inferred from the content of a message**, in a room or anywhere else.
- Inside the quotation the mention is **stripped**: the bar reads `Tu · domenica piove?`, not
  `@Kalsa domenica piove?`. The mention is already the reason the answer exists.

This is what the hub's rule needs. §5.1 says the room hands over the chatter "at the instant
somebody addresses it": addressing is an act, not an inference.

## 4. The quotation component

One component, used by both features, so a room answer and a one-to-one reply look alike.

- Above the bubble: a bar with a 2 px accent line on the left, the author, and **at most two
  lines** of the quoted text, ellipsised.
- The quoted text is **stored inside the quotation**, not referenced, and this is now
  mandatory rather than a preference: the phone's message ids are unique only within a
  session and the restore path **rewrites colliding ids** (`AiChatPage.tsx:670-673`), so a
  reference can dangle across a restart. A quote that shows nothing is worse than no quote.
- Tapping jumps to the original **when it still exists in this session**. When it does not,
  nothing happens, and that is acceptable because the text is already in the bar. No control
  that looks alive and is not.
- The author reads as the person's name in a room, as *Tu* or *Kalsa* in a one-to-one chat.
- In a one-to-one chat the quotation is given to the model as part of the normal turn, saying
  that the user is answering that message — not as a separate generation. There is no
  non-destructive way to generate from an arbitrary context. Three functions can start a
  generation without a user turn, and all three disturb the chat's context: `completeOnce`
  (declared at `LlamaService.ts:6059`, clears the chat KV at `:6102`), `extractMemory`
  (`:5754`, whose clearing is conditional on `!EXTRACT_MEMORY_PRESERVE_CHAT_KV`) and
  `translateText` (`:5982`). None of them returns a normal chat turn.

## 5. Anatomy of the room screen

**Header.** Back, the room name, and the members as a small stack with one presence dot. The
model pill does not belong here: there is no "where does it answer" choice in a room, the
answer comes from the hub by construction. **The AI is not in the member stack.** It is not a
member, and showing its face among the people would contradict the design.

**Messages.** In a room every message needs a name:

| who | treatment |
|---|---|
| another person | light bubble, name above it, left aligned |
| you | bubble, right aligned, no name, the same as today |
| the AI | the only bare text in the room, with the quotation above it and a small label |

That single asymmetry does real work: in a room, the one message that is not in a bubble is
the one that came from the guest.

**The floor.** Whose turn is running, who is next, how many are waiting — names only. This is
the room's most important shared signal and the first draft left it out entirely.

It is **state-driven, not headcount-driven**: two people in a room are a room (the owner
settled this), so there is no threshold. The floor uses the line the header already has, and
costs nothing when nothing is queued:

| state | where |
|---|---|
| nobody waiting | `Casa · 2 presenti` |
| a turn running | `Casa · risponde a papà` |
| a turn running, and you are next | `Casa · risponde a papà · sei il prossimo` |
| someone waiting besides the one being served | the line above **+** one above the composer: `Papà in attesa` |
| the window shortened | `Casa · ricorda dalle 14:30` |

The extra line appears only when a real queue exists, so nothing shifts under the thumb of the
one person waiting — for them the information is already in the header.

**The pending marker**, attached under the invoking message:

> Kalsa sta rispondendo a papà…

becomes *answered* with a jump, or an error with a retry, plus a **withdraw** action for your
own pending prompt only.

**The composer.** Text field, attachment, and the summon control — absent with a reason when
the hub is unreachable, and refusing with an honest message when you already have one pending.

**The window.** How far back the room still remembers, stated in the room, not in a settings
page. When a morning falls off the end the room says so.

**Off the network.** A room scoped to a network has a state private chats do not: *nobody else
is reachable right now*. Visible in the header, phrased as a delay rather than an error.

## 6. States to build, and what each one shows

| state | where it shows | what the user reads |
|---|---|---|
| invited | invite screen | what the room is, who is in it, the three facts of §7, accept, decline |
| declined | the room list | *Non ora* is a deferral, not a refusal: the room stays in the list as a suspended invitation, and nobody is told. It never reappears on its own |
| joined, others present | header | name, members, presence |
| joined, nobody reachable | header | the delay, not an error |
| summoned, waiting, you are next in line | floor + under the message | whose turn, who is next, names only |
| summoned, you already have one pending | where you pressed | the honest refusal from §2.4 |
| summoned, answered | under the message | answered, jump |
| summoned, failed | under the message | what failed, retry |
| left | member list | left, visible to the room |
| hub unreachable | composer | why it cannot be summoned |
| window shortened | room | how far back it still remembers |

## 7. User-facing copy

The strings that carry honesty. They go into `src/i18n/it.ts` with English counterparts in
`en.ts`.

| where | Italian |
|---|---|
| invite screen, where it runs | Le risposte arrivano dal PC di casa. |
| invite screen, the window | La stanza ricorda una finestra di messaggi, non tutto. Quando lo spazio finisce, i più vecchi escono. |
| invite screen, the third fact | In stanza vedi sempre da quando Kalsa ricorda. |
| invite screen, the action | Entra nella stanza |
| invite screen, declining | Non ora |
| composer, the summon control | Chiedi a Kalsa |
| floor, nobody waiting | {n} presenti |
| floor, a turn running | risponde a {nome} |
| floor, you are next | sei il prossimo |
| floor, someone waiting | {nome} in attesa |
| floor, the window shortened | ricorda dalle {ora} |
| marker, my prompt is being served | Risponde a {nome}… |
| marker, my prompt is queued | In attesa · sei il prossimo |
| marker, withdraw a queued prompt | Ritira |
| marker, stop my own answer | Ferma |
| marker, answered | Kalsa ha risposto |
| marker, failed | Kalsa non ha risposto |
| second prompt refused | Hai già una domanda in attesa: ritirala o aspetta |
| window, shortened | Questa stanza ricorda dalle {ora}: i messaggi più vecchi sono usciti |
| nobody reachable | Sei l'unico raggiungibile: i messaggi arrivano quando tornano |
| hub missing, where the control would be | Per chiamare Kalsa serve Kalsa Brain sul PC |
| quote bar, your own message | Tu |

Two entries were **removed** by an audit and are recorded here so they do not come back:

- "Niente esce da qui." was the first draft's line for where the answers run. It is too broad
  to be true: the hub ships an outgoing gate precisely because web search and fetched pages
  leave the machine (`WHAT-IS-MISSING.md` §19). What is true and stays is where the answers
  come from. A tool that reaches outside still owes its own gate, stated per call, as the
  desktop already does.
- The running state had two different phrasings ("Kalsa sta rispondendo a…" for the marker and
  "risponde a…" for the floor). One state, one vocabulary: `risponde a {nome}`.

Every string is a key/value pair so it can be written into `src/i18n/it.ts` and mapped one to
one onto `en.ts`. The placeholders `{nome}`, `{n}` and `{ora}` are the only substitutions.

## 8. What must be built, and what the reconnaissance found

Two reconnaissance passes over both repositories. Verdicts are from the code, with the file
that decides each. Rows marked *absent* are not defects of this interface: they are work to be
scheduled, and this table is where it is recorded.

| # | piece | found |
|---|---|---|
| 8.1 | a room as an object: creation, membership, accept, decline, leave | **designed and not built** (`WHAT-IS-MISSING.md:221`, rules in `HOUSEHOLD-RULES.md` §4–§5). Phone: a conversation has one implicit owner and no member list (`ConversationsStore.ts:23`) |
| 8.2 | an author on a message | **absent**: `role: "user" | "assistant"` only (`AiChatPage.tsx:242`), `userName` is greeting-only and passed `null` (`AppShell.tsx:7014`). The hub demands it (`HOUSEHOLD-RULES.md:95`) |
| 8.3 | an inbound channel for other people's messages | **absent**: no server or socket on the phone (zero hits for websocket/EventSource/createServer in `src`), and the remote path is request→response only, refusing a second concurrent turn (`RemoteEngine.ts:236`, **on `remote-brain` only**) |
| 8.4 | fan-out: the hub relays one client's message to all members | **absent**: each door job has exactly one `owner: DeviceId` (`crates/kalsa-door/src/jobs.rs:53-59`); per-device identity exists (`devices.rs:43`, `active_devices()` at `lib.rs:407`) but presence is per-device, not per-person |
| 8.5 | generation on the hub from a room message, streamed to all members, carrying the invoking id | **absent**. One turn at a time is a designed rule (`§5.2`); nothing implements it |
| 8.6 | per-person turn order: one pending each, least-recently-served tie-break on the door's monotonic clock, visible names only | **absent**, and it is the piece the first draft of this document did not know existed (`§5.3`, `§5.4`) |
| 8.7 | the room bypasses the fit gate, which prices the local phone | **absent by inspection**: the fit gate reads the phone's RAM (`AiChatPage.tsx:2031`) |
| 8.8 | the network a room is scoped to | **half built on the PC, absent on the phone.** The door is a loopback HTTP/1.1 listener on port 8131 that refuses any non-loopback address (`src-tauri/src/door.rs:15,44`, `crates/kalsa-door/src/lib.rs:4-5`), with an iroh QUIC tunnel that terminates on the same loopback door (`crates/kalsa-iroh/src/lib.rs:1-2`, `src-tauri/src/road.rs`). On the phone's `ux-2026-09-21` branch there is **no client of any kind**: `src/engine/remote/` is absent and the tree has zero hits for websocket, ws://, tailscale or iroh |
| 8.9 | an id-addressed append, to place a reply beside the message it answers | **absent**: appends are end-of-array only (`AiChatPage.tsx:2511-2526`), there is no insert by id. §2.1's choice to put the answer at the tail with a quotation is therefore the only shape the code supports |
| 8.10 | a quote field that survives the storage round trip | **absent, and a trap**: the writer spreads unknown fields, but the loader re-whitelists them explicitly (`sanitizeHistoryMessages`, `AiChatPage.tsx:656-817`), so a new field is written and silently dropped on restore unless added there. `sources` is the model to copy (`:713`) |
| 8.11 | a stable message id | **absent**: ids are unique per session only, seeded from wall-clock, and the restore path repairs collisions by rewriting them (`AiChatPage.tsx:558, 670-673`) |
| 8.12 | cancellation, which §2.4's stopping rules need | **exists and is reachable**: the send button becomes stop (`AiChatPage.tsx:3664, 4899`), `handleStop` aborts (`:3141`), the signal reaches the engine (`LlamaService.ts:4186`), with a 3 s watchdog for a native completion that never settles (`:3151`) |
| 8.13 | a phone client for the hub at all | **absent on this branch.** It exists on `remote-brain` (`src/engine/remote/`, 30 files, 16 non-test), and it speaks OpenAI-compatible HTTP + SSE over XHR, which is a *different, earlier* server generation: its SSE parser carries `mtplx_stats` / `mtplx_progress` metadata for the old mac-brain server (`openaiSse.ts:26-30`). The two branches diverged: `git rev-list --left-right --count ux-2026-09-21...remote-brain` = **408 / 189** at this commit (407 / 189 at its parent `6778713`), multiple merge bases |
| 8.14 | a server-side store for room messages | **absent**: messages are phone-local AsyncStorage (`ConversationsStore.ts:76`), the hub's chat store is a separate `localStorage` (`chat/src/lib/store.ts:44`), and the remote path persists nothing (`RemoteEngine.ts:458`, **on `remote-brain` only**) |
| 8.15 | per-person identity and consent | **absent**: the phone's remembered decisions are per-install booleans (`toolToggles.ts:3-5`, `MemoryStore.ts:50`); the hub's identity is per-device (`devices.rs:1`) |
| 8.16 | the mention: parsing `@Kalsa` as a summon, and the composer control that writes it | **absent**. No mention or `@` parsing exists anywhere, and the message menu exposes only copy, read-aloud and more (`AiChatPage.tsx:5457` ff). Without this row the list admitted a build that cannot call the AI |
| 8.17 | the mention stored on a message — and equally the marker's state and its link to the answer | **absent, and it inherits 8.10's trap**: a new field is written and silently dropped on restore unless the loader whitelist is extended (`AiChatPage.tsx:656-817`). This row exists because an audit caught §2.1 promising a marker that never disappears while nothing recorded the field that would keep it |
| 8.18 | the mention in the prompt contract: which message is the question, and a rule so the model never re-parses `@Kalsa` as content | **absent**: the batch is assembled as plain text (`compactor.ts:933`, `AppShell.tsx:6597-6612`) and nothing marks a message as the addressed one. The same rule must also settle what happens when someone types `@Kalsa` literally without pressing anything: one rule, not two |
| 8.19 | the hub→phone signal reporting when the window edge fell, so the floor's window line has a producer | **absent**, and it depends on §10.4 |

**Consequence, stated plainly.** The room cannot be built on this branch. It is a new object
type on the hub, a turn policy, a fan-out, an inbound channel, per-person identity, and a
phone client that does not exist here — and the phone client that does exist, on the other
branch, targets a server generation the door has already moved past. What this document
contributes is the phone's face on the hub's design: the floor, the quotation, the window,
and the states in §6 — all of which can be designed and mocked now, and built when 8.1–8.19
are.

## 9. What this feature will not do

Stated so it cannot expand quietly:

- No cloud relay. A room lives on the PC of the house and on the network, and it stops
  working when they stop, which is the point of it.
- No AI answering without someone addressing it, in a room, ever.
- No concurrent AI turns in a room, however many slots the machine has — the reason is
  reproducibility, not capacity.
- No queue of messages: the order rotates between people, one pending prompt each.
- Nobody stops another person's turn.
- The turn order shows names, never content.
- No editing or deleting another person's message.
- No private side conversation inside a room.
- No voice, no video, no presence beyond reachable or not.
- No scheduled or automatic summons.
- No quotation of a message that no longer exists, beyond the stored snapshot.

## 10. Open questions

Three questions, each with the default I will take if you do not answer. The first two are
already settled by the owner and recorded here as settled, not as open.

1. ~~Does the floor need to be visible in a one-to-one room, or only from three people up?~~
   **Settled: two people and the AI are a room.** No threshold; the floor is state-driven (§5).
2. ~~Does a summon let the AI write in the room, or only answer?~~ **Settled: it answers where
   it was called and cannot start a topic**, the same rule as the one-to-one chat today.
3. **Can a room answer a message written before you joined?** Default: yes, bounded by the
   window in §7. The alternative is a room whose earlier history is unanswerable, which seems
   worse for a family.
4. **Who decides the slot question in §2.5** — one slot for the room or one per member device?
   Default: I proceed assuming **one slot for the room**, because that is what makes the
   household rules' "cheapest multi-device mode" true, and I will say so on the floor rather
   than print a window I cannot compute. If the desk session answers differently, the floor's
   window line changes and nothing else does.
