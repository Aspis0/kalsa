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
