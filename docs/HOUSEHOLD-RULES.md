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

**Prefix-cache cross-talk.** The prompt cache is worth having -- warm reuse reaches **0.97**
when each person has a slot of their own. It matches on the
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
the prompt-cache reuse applies to it in full, permanently warm, no matter how many people
are in the room. Four people in one room are cheaper than two people in two private chats --
and measured 2026-09-17 a room escapes both costs a private chat pays: the SWA half of the
KV replicates per slot (55.78 MiB at one slot, 223.12 MiB at four) and each slot's context
floor of `n_ctx / N` refuses an oversized conversation outright with HTTP 400.

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

*Revised the same day, by the owner, and the revision is right.*

The first version of this rule said the AI must not listen to the room at all, for two reasons:
cost, and the log surface that listening creates. The second reason is simply wrong here. The
model runs on the family's own PC. Nothing leaves. There is no service at the other end, so
"the AI heard it" and "the family said it in their own house" are the same sentence. Privacy is
not the argument for keeping the room out of the model — and using it as one would have cost us
a genuinely better product for nothing.

The cost is real, though, and the owner named the exact failure mode: prefilling everything
over and over is a perpetual mess. So the rule becomes:

**The AI hears the whole room, and pays late.**

Nothing is sent to the model while people are talking. At the instant somebody addresses it,
the room hands over everything said since the last time it was addressed — one batch, one
prefill. The prompt cache does the rest: the shared history is already resident, so the only
tokens that cost anything are the ones added since. Measured on this Mac, a full 16k-token
prefill takes 10.3 s, about 1 600 tokens/s; a hundred messages of chatter is roughly 2 000
tokens, so a little over a second, paid once and never again.

**Hearing and speaking are two different rules.** The AI hears everything and speaks only when
addressed — otherwise a family room becomes a room with someone interrupting in it.

Two consequences fall out, and they are the interesting part.

**The GPU must not wake for chatter.** Prefilling eagerly, message by message, would spin the
machine up dozens of times an hour for sentences nobody wanted answered. Paying at the question
keeps the room silent in the electrical sense too, which is the whole point of a mini-server
that lives in someone's house.

**The room's context is the one worth defending.** The perpetual mess is real, but listening is
not what causes it — *alternating* is. While the room stays resident, each question costs only
the new messages. The moment a private chat evicts the room from the cache, the next question
in the room re-prefills the entire day. That is exactly the switch cost of §5.6, and it points
at a policy: in a household that lives in the room, the room is what should stay warm.

What survives from the first version is the **window**, and that part has to be visible. A
family chat running all day fits in no context we can afford. So the honest surface is not
"what the AI is allowed to see" any more — it is *how far back the AI still remembers*. When a
morning falls off the end, the room should say so, instead of letting people wonder why it
forgot.

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

### 5.6 The number was taken, and it changed the design

Measured on b10950, Trinity, 16384 total context, four server shapes under 2 and 4
overlapping simulated phones. The numbers below are recomputed from the raw per-request JSON,
not copied from the report that produced it.

Warm-turn cache reuse (turns after the first, which is cold by definition) and median
time-to-first-token, **four phones**:

| shape | reuse | median TTFT | total KV |
|---|---|---|---|
| `--parallel 1` (one slot, our queue) | **0.00** | 4.99 s | 174.78 MiB |
| `--parallel 2` (fewer slots than people) | 0.12 | 3.47 s | 230.56 MiB |
| auto (`kv_unified`) | 0.73 | 2.54 s | 308.66 MiB |
| `--parallel 4` (a slot per person) | **0.97** | **0.64 s** | 342.12 MiB |

**The trade-off this section was written to resolve does not exist.** One slot was supposed to
buy warm caches at the price of waiting. At four phones it buys neither: *every single request*
re-prefilled from zero — not degraded reuse, zero — and it was also the slowest. Waiting and a
cold cache arrive together.

**The rule is not "more slots is better", it is "a slot per person, or thrash."** Two slots
with four people scored 0.12, nearly as bad as one. Reuse does not degrade gracefully as people
exceed slots; it collapses.

**The price of a slot is not only context — sliding-window memory replicates.** From the real
cache lines: the 14 full-attention layers *divide* (16384 cells → 4096 at four slots, a
constant 119.00 MiB), while the 42 sliding-window layers are rebuilt per sequence — 55.78 MiB
at one slot, 111.56 at two, 223.12 at four, exactly ×2 and ×4. Four slots cost +167 MiB over
one. No per-token constant can express that, which is the affine finding again from a second
direction.

**The floor is 4096 tokens per person.** A conversation reaching 3 878 tokens ran warm (3 827
of them cached). The next size up returned **HTTP 400 on every request including the first** —
the person cannot even start, and the refusal is a hard one rather than a silent truncation.
So on this machine, 16384 total context divided by a 4096 floor is **four people, and the
fifth must be refused at the door** rather than quietly given a broken conversation.

**What this does to the turn rules above.** For private conversations, §5.3's rotation is no
longer the interesting question: give each person a slot and nobody waits behind anybody. The
queue still has to exist — for the fifth person, and for the moment a slot is full — but it
stops being the normal path.

For the room, this is the second time the shared context turns out to be the cheap one: one
conversation in one slot never switches, so it never pays a re-prefill at all. Everything
measured here is the cost of people *not* sharing.


---

## 6. The small model that reads the room

The owner's idea, offered as a dream: a tiny model reading the room continuously, writing very
small but sensible summaries, and handing those to the big model's prefill.

It is not unrealizable. But the reason it is worth building is not the reason it looks
attractive, and getting that backwards would buy us a second model for nothing.

**It does not save prefill time.** Prefilling the chatter with the big model is paid once and
the cache keeps it — at the ~1 600 tokens/s measured here on Trinity, a hundred messages is
about a second, and never again. A small model has to prefill those same messages too (cheaper
per token, but not free) and then *generate* the summary, which is decoding: the slow
direction. For any room that fits inside the context window, the summariser costs more than it
saves.

**It saves the window, which is the one thing we cannot buy.** That is the real prize. A family
room running all day does not fit in any context this machine can afford, and §5.1 already
concedes that the morning will fall off the end. A compressor turns "the AI remembers since
14:30" into "the AI remembers today", at a cost of a few hundred tokens instead of tens of
thousands. The dream is right; it is a memory feature, not a speed feature.

**The risk is silent, and that is what decides the shape.** A summary is lossy and a small model
is weak. Forgetting is *visible* — the room can say how far back it remembers. A wrong summary
is invisible: the big model answers confidently from it and nobody in the house can tell. So
three constraints come before any implementation:

- the raw messages are never destroyed; the summary is an addition to the record, not a
  replacement for it;
- the recent part of the conversation is never summarised — only what is already falling out of
  the window;
- a summary sitting in the context can always be opened back to the real messages it came from.

**The cheaper first version is the big model summarising itself.** When the window is about to
overflow, the big model is already loaded and already holding that history. Asking it for a
200-token summary of the oldest part costs a single short generation: no second model, no extra
RAM, no GPU contention, and the quality is the 12B's rather than a 0.5B's. The tiny continuous
summariser is the *optimisation after that one*, and it earns its place only if
self-summarisation turns out to interrupt the household noticeably.

**If we do want a second model, upstream already hosts it.** The b10950 router runs a child
server per model, so a summariser alongside the big model needs no invention — but see §2: its
`models_max` counts models and does not weigh them, so admission stays with our catalog. And a
second model contends for the same GPU, so the summariser has to run while the machine is
already awake — right after an answer, not continuously. "Continuously" in a house means waking
a laptop all day.

**Nothing small enough is pinned yet.** The smallest entries in the catalog today are Gemma 4
E2B at 3.22 GB and Qwen3.5-4B at 2.81 GB. A summariser worth having is in the hundreds of
megabytes, and would be a new pin.

**The number that decides all of it** is unmeasured: how many seconds the big model needs to
write a 200-token summary of roughly 4k tokens of room history. It cannot be taken right now —
the GPU is busy with the multi-device runs, and a second server would corrupt those numbers.
It is the first thing to measure once they land.
