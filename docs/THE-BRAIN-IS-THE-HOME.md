# The brain is the home, and the chat is what happens inside it

Written 2026-09-17 with the owner, and it **supersedes §6 of `DESKTOP-CHAT-DECISION.md`**,
which listed the crescent's surfaces as *Chat, Models, Server, Devices, Advanced, Settings*.
Chat is not one of them. That is the whole point of this document.

## 1. The thing to avoid

Every local-model desktop app puts the chat in a tab next to the others. The owner's
objection, and it is the right one: a tab makes the conversation a peer of the settings
page. Six items in a beautiful arc are still six tabs — the form changes, the hierarchy
does not.

## 2. Why the brain comes first, and why that is not ceremony

The brain is first in time — without it there is nothing to talk to, and `setup.js` already
narrates that first walk, *"Getting this computer ready. This happens once."*

But the argument that actually settles it is smaller and harder: **the brain's state is
information you need before you speak, not after.** Measured on this Mac, 2026-09-17:

- a slot of your own, model warm → first token in **0.64 s**; one slot behind our own queue
  → **4.99 s**, and warm reuse falls to zero;
- the house has **four** seats at 16k (`n_ctx / N` = 4096 each) and the fifth person is
  refused at the door with HTTP 400 — not truncated, *refused*;
- switching models empties every slot and every cache in the house.

So "how many seats are taken", "is it warm", and "which model is loaded" all change what
will happen to you when you press enter. Hiding them behind the conversation means the
person discovers afterwards something they needed beforehand. That is the case for putting
the brain first — utility, not a statement about what the product is.

## 3. The shape

> **The transition in this section was built, measured, and rejected — 2026-09-17.**
>
> A prototype implemented it: the bar flying to the top right to become the first message,
> the seats gathering into a five-point crescent, the whole thing reversible. It ran on the
> View Transitions path, not a fallback: **672 ms measured against a 640 ms setting, 5022 ms
> against 5000 ms**, thirty-five animations all honouring the duration. The mechanism works.
>
> The owner rejected it on sight, and the reason is not taste. **There is no crescent in this
> app.** The navigation is a flat row of three tab buttons — Status, Model, Pairing
> (`src/index.html:18-25`) — with transparent backgrounds and muted text until the pointer
> lands on them (`src/styles.css:124`). It sits at the top and is close to invisible at rest.
> The crescent is a form borrowed from `devboule-v2` and described in
> `DESKTOP-CHAT-DECISION.md`; nothing here has ever drawn one.
>
> So the prototype animated four seats gathering into an arc that was never built, and its
> destination is a bar the owner barely sees. An animation cannot be designed before the
> navigation it lands in exists — that ordering was the mistake, and it cost one prototype.
> The rest of this section, and §4 through §6, still stand: they describe where things live,
> not how they move.
>
> **The duration argument is therefore unsettled, not decided.** What this section claims
> below — that the transition should last as long as the first token actually takes, up to
> 4.99 s when cold — was never tested against a real navigation, and the prototype's own
> reading argued the opposite: cap the morph short and spend a long wait *inside* the thread,
> where waiting is legible, rather than as a room rearranging in slow motion.


**Open the app and the brain is there, alone.** Which model is loaded, whether it is warm,
how many of the four seats are taken and by whom. Presence, not a dashboard of readouts.

**Inside it there is one writing bar.** You do not click through to the chat: you type and
press enter. The brain is what you look at; writing is what you do. That is why looking at
it costs nothing and therefore happens every day.

**The bar states a prediction, never "Type here…".** It is where the brain's state becomes a
sentence about your next few seconds: *the model is warm, your seat is free* — or *four
people are already talking, you will have to wait*. If you are the fifth, the bar says so
**before** you type, not after the door refuses you.

**Pressing enter opens the chat by transformation, not navigation.** And the animation
lasts as long as the first token actually takes: instant when the model is warm (0.64 s),
long enough to narrate the warm-up when it is cold (4.99 s). The transition is not
decoration laid over a wait — it *is* the wait, made watchable. Nobody can copy it without
having measured those numbers first.

**In the chat the crescent carries the brain's surfaces** — Models, Server, Devices,
Advanced, Settings, and the way home. Five, not six, because Chat is not a surface: it is
the room the crescent hangs in.

**Going back is symmetric.** The same animation reversed, plus `Esc` next to the crescent
entry. If leaving is a transformation and returning is a menu click, the illusion collapses
on second use.

## 4. The part that decides whether this survives contact

**Returning to the brain must not close the conversation, and must not leave it open
underneath either.** If it closes, people lose the thread and stop going back. If it merely
hides behind a panel, then in two weeks the app is a chat with a dashboard on top — which
is the thing §1 rejects, arrived at by drift instead of by decision.

The way out: going back shows you the conversation **from outside**. The brain draws the
four seats, and one of them is visibly yours, occupied, right now. Returning is not leaving
the chat; it is stepping back to see the room with yourself in it. The brain stays the home
even while you are talking.

## 5. One rule to keep the structure honest

Surfaces live in **one** place. The brain is the legible overview; the crescent is the
shortcut for when you are deep in a conversation. Same destinations, two ways to reach
them, no duplicated content. The moment Models exists both as a crescent entry and as a
panel inside the brain, there are two answers to every question about it.

## 6. The prerequisite, and it is not cosmetic

Drawing the seats requires the door to say **who is busy**, and today it does not. The
pairing command knows who is *paired* (`brain_pairing`, one credential per device since
`02a2139`); occupancy is the open item `WHAT-IS-MISSING.md` records as *"the door knows who,
but it does not tell anyone yet"*.

This design promotes that item. It stops being an improvement to the queue and becomes the
substance of the first screen. Anything built before it will show seats it is guessing at,
which is worse than showing none.

## 7. Not decided

- Whether the first-run walk *builds* the crescent as the brain comes alive (measure,
  decide, fetch the engine, choose the model) and leaves it behind as a permanent trace.
  Cheap, since that screen already exists; unverified as a feeling.
- Whether five points sit well on an arc whose visible count was six in `devboule-v2`
  (`CRESCENT_VISIBLE_COUNT = 6` is called a design constant there, per §6 of
  `DESKTOP-CHAT-DECISION.md`). This needs to be looked at, not reasoned about.
- What the brain shows when nobody is talking and everything is idle. An empty room is the
  common case and it must not look like a failure.
