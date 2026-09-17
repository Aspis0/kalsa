# The household rules

Four rules the owner stated on 2026-09-17, while the multi-device shape was still being
measured. They are requirements, not preferences. The measurement picks between designs;
no design that breaks one of these is eligible, however well it measures.

---

## 1. One person's context never becomes another person's context

Not "should not". *Never.* This is the acceptance criterion for the whole feature.

Two concrete dangers are already known, and both are being tested rather than argued.

**The slot id wraps around silently.** In b10950, `tools/server/server-context.cpp:1520`:

```cpp
    server_slot * get_slot_by_id(int id_slot) {
        // note: allow id_slot to be out of bounds (wrap around)
        id_slot = id_slot % slots.size();
```

An out-of-range slot is not refused, it is folded back into range. With four slots, device 5
becomes device 1. Nothing logs, nothing errors. If we ever let a device choose its own slot
id — or if our own mapping drifts by one — two people share a slot and the server will not
tell us. Whatever routing we build has to make the id ours and dense, and has to assert it.

**Prefix-cache cross-talk.** The prompt cache is worth 21x and we want it. It matches on the
longest common prefix of tokens, so in principle it can only reuse tokens that are genuinely
identical. That is a claim about upstream's implementation, and claims about implementations
get tested here: device A sends a prompt carrying a unique marker, device B sends a prompt
sharing a long identical preamble and then diverging, and we assert that B's answer never
contains A's marker and that B's `cached_tokens` never exceeds the true shared-prefix length,
computed by tokenizing both rather than by eye. Red first, then green, under both designs.

## 2. In a household, the model is a household decision

If one person wants Gemma and another wants Qwen, they agree at the start. Alone, a phone may
change the model; with two or more devices attached, the switch lives on the PC.

Upstream is not the obstacle here — b10950 ships a real model router
(`tools/server/server-models.cpp`, ~2 000 lines): a parent process that spawns one child
server per model, with `POST /models/load`, autoload, and LRU unloading of the least recently
used model. Switching model does not have to mean killing everything.

**But the router's admission policy cannot be ours.** `common/common.h:686`:

```cpp
    int models_max = 4;                 // maximum number of models to load simultaneously
```

It is a *count*. Four models, whatever they weigh. On a 16 GB Mac, four copies of the Gemma 4
12B we just pinned is 28 GB of weights before a single KV byte. The router will do exactly
that if asked, because nothing in it knows what a model costs. Our catalog does know — it
carries the bytes — so admission belongs there, exactly as it does on the phone.

The rule that follows is not a UI rule. A phone that is not alone must be **refused at the
door**, not merely shown no button: a hidden button comes back as an API call the day someone
writes a second client. And the honest reason has to be shown, because switching model throws
away every slot and every warm cache in the house, for everybody — including the person who
did not ask for it.

## 3. What a person asks never leaves

Already law here, already enforced by a test rather than a sentence (the argv guard in
`crates/kalsa-launch`, which refuses to hand the server any flag that makes it print prompts).

Multi-device adds new surfaces that must inherit it: "who is connected", "the AI is busy",
the queue's own depth and waiting list. *Who* may be named. *What they are asking* may not —
not in the UI, not in a log line, not in a metric, not in an error string, not in a crash
buffer. "Busy with Marco" is allowed. "Busy summarising Marco's contract" is a leak.

## 4. A shared room, with the AI in it

The owner's fourth idea: phones exchanging messages through the PC, a common chat with the AI
sitting inside it. Nothing here is started yet; it is written down so the shape is not
reinvented later, and because one thing about it is counter-intuitive.

**It is the cheapest multi-device mode we have, not the most expensive.** Separate private
conversations are what costs: N contexts, N caches, and a unified KV that evicts the idle
ones. A room is one conversation, one context, one cache, appended to by several people — so
the prompt-cache reuse that is worth 21x applies to it in full, permanently warm, no matter
how many people are in the room. Four people in one room are cheaper than two people in two
private chats.

**A room must be a different object from a private chat, not a flag on one.** A flag gets
flipped — by a bug, by a mis-tap, by a future refactor — and rule 1 dies quietly. A separate
type cannot be flipped by accident: a private conversation has one owner device and no
subscribe path at all; a room has a member list and is created by an explicit act that
everyone in it can see.

Each turn in a room carries its author, because the model has to know who is speaking to give
a sane answer, and because the people do too.

---

## 5. The room's turns

A room with four people in it and one AI needs rules before it needs code, because two of the
questions it raises have answers that are not reversible later.

### 5.1 Who is a message for — the people, or the AI?

The gesture is still open (a mention, a second send button, a long-press: to be decided). What
is *not* open is the default, because it is not a matter of taste:

**The AI must not listen to everything.** If it reads the whole room, every word the family
says to each other is tokenized, prefilled, and parked in a cache — paid for in compute and in
heat, for messages nobody wanted an answer to. Chatter that never reaches the model also never
reaches a log, a metric, or a crash buffer. Silence is the cheapest privacy we can offer, and
here it is also the cheapest arithmetic.

So the AI answers when it is addressed, and only then.

That leaves the one hard case, and it is worth naming now: *"@kalsa yes, do that"* means
nothing without the three messages above it. The answer is not to make the AI guess — it is to
make the boundary **visible**. The room draws which messages will cross into the model, and
the sender can pull more of the conversation in deliberately. What the AI knows is shown, not
inferred. That rule also happens to be the only honest way to run rule 3 inside a shared room.

### 5.2 One turn at a time — and this is not about speed

In a room the history is shared, so two answers generated at once are two answers built on
different pasts: whether B's context contains A's question and A's reply depends on scheduling.
The same room, the same messages, a different transcript each time. That is not a slow room,
it is a room that stops being reproducible.

**In a room, exactly one AI turn runs at a time.** Always, regardless of how many slots the
machine could afford. In private chats, concurrency really is only a resource trade-off — that
one is decided by measurement. This one is not.

### 5.3 The order: rotation between people, not a queue of messages

First-in-first-out by message hands the machine to whoever has the fastest thumb. Three
messages from one person and the others wait three turns.

So the queue is per *person*, and **each person may have at most one prompt pending in a
room.** The queue can therefore never be deeper than the number of people present, which also
makes it bounded by construction rather than by a limit somebody has to remember to set. A
second prompt from someone who already has one waiting is **refused with an honest message**,
not silently accepted — the same rule the door's queue has to obey everywhere.

When two arrive in the same instant, the tie-break is **whoever was served least recently.**
Not the device id — that is a permanent rank, and the person who registered first would win
every tie for the rest of the machine's life. Not the phone's clock either: household phones
disagree by seconds and the value arrives from the client. The stamp is the door's own
monotonic clock, taken on arrival.

One machine means one order. Rotation counts a person, not a conversation, so opening a private
chat as well as being in the room does not buy anyone a second place in the line.

### 5.4 Visible, like a turn order in a game

Whose turn is running, who is next, how many are waiting — shown to everyone in the room. The
owner's instinct was right: people wait far better when they can see the queue than when the
machine simply feels slow.

Names only. "Answering papà, Marco is next" is allowed; one word about what papà asked is not.

### 5.5 Stopping

You may withdraw your own pending prompt, and you may stop an answer being generated for you.
Nobody may stop someone else's turn — a shared room where a sibling can cut you off mid-answer
is a worse room than one where you wait. The PC itself is the exception: the machine's owner
can always stop the machine.

### 5.6 The one number that is still missing

Strict rotation is the fair policy, but every switch from one conversation to another throws
away the prompt cache and pays a full re-prefill. If that costs six seconds, then serving two
prompts from the same conversation before yielding is worth real time and the policy should say
so with a number. If it costs three tenths of a second, fairness wins outright and rotation is
free.

That number is being measured now. Until it exists, the policy above is written as pure
rotation — the fair default — and the only thing allowed to change it is a measurement.
