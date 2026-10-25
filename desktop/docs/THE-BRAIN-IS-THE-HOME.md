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

The brain is first in time — without it there is nothing to talk to, and
`chat/src/surfaces/SetupProgress.tsx` already
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

> **Revised 2026-09-17, after building it.** A prototype implemented this section and was
> thrown away. What the owner kept and what he cut are different things, and the difference
> is the point.
>
> **Kept — and it is the core of the whole design: the writing bar becomes your first
> message.** Press enter and the bar itself travels to the top right and turns into what you
> just said; the rest of the brain screen becomes the thread. Not a navigation, not a panel
> opening: the thing you typed into *is* the thing you said. That move is right and it is
> what this section is about.
>
> **Cut — the seats gathering into a crescent.** The prototype choreographed four seats
> threading into a five-point arc. Two separate things are wrong with that, and an earlier
> draft of this note conflated them.
>
> First, the arc is not in `kalsa-brain`. This app's navigation is a flat row of three tab
> buttons — Status, Model, Pairing (`src/index.html:18-25`) — transparent and muted until
> the pointer lands on them (`src/styles.css:124`). So the prototype, which ran here,
> animated toward something this app has never drawn.
>
> Second — and this is the owner's actual objection — **the crescent that does exist is
> nearly invisible.** It lives in `crescent-chat`, inherited from `devboule-v2`, and its
> resting state is a transparent button 18 px tall whose only mark is a 3 px line at 0.8
> opacity that changes colour on hover or focus (`chat/src/components/CrescentNav.css:11-40`).
> It sits at the top of the page. Animating four seats into a destination the reader cannot
> see until they happen to point at it spends the whole budget of the gesture on something
> invisible.
>
> What is NOT cut is the crescent's purpose, which `DESKTOP-CHAT-DECISION.md` §6 already
> settled and this note does not reopen: it is top-level navigation over a small fixed set
> of surfaces, never a conversation list. What is cut is the idea that the transition's job
> is to *build* it. **The chat does not need to show a crescent during the move.** Whatever
> carries the way back is decided on its own terms — starting with the fact that, as drawn
> today, nobody can see it.
>
> The mechanism was never in doubt. It ran on the View Transitions path, not a fallback:
> **672 ms measured against a 640 ms setting, 5022 ms against 5000 ms**, thirty-five
> animations all honouring the duration, reversible in both directions.
>
> **The duration is open again.** What this section claims below — that the transition lasts
> as long as the first token actually takes, up to 4.99 s cold — was never judged against a
> real screen. The prototype read the opposite: cap the morph short and spend a long wait
> *inside* the thread, where waiting is legible, rather than as a room rearranging in slow
> motion. Unsettled, and it needs eyes on the real thing, not an argument.


**Open the app and the brain is there, alone.** Which model is loaded, whether it is warm,
how many of the four seats are taken and by whom. Presence, not a dashboard of readouts.

**Inside it there is one writing bar.** You do not click through to the chat: you type and
press enter. The brain is what you look at; writing is what you do. That is why looking at
it costs nothing and therefore happens every day.

**The bar states a prediction, never "Type here…".** It is where the brain's state becomes a
sentence about your next few seconds: *the model is warm, your seat is free* — or *four
people are already talking, you will have to wait*. If you are the fifth, the bar says so
**before** you type, not after the door refuses you.

> **Struck 2026-09-18, by the owner.** The empty bar is a plain invitation to write. The
> prediction above is not postponed for taste: its substance is *how many seats are taken and
> by whom*, and §6 records that the door does not answer that yet. A bar that predicted from
> what we can actually read today — a model name and whether a process is up — would be
> stating the least useful half of the sentence in the place reserved for the most useful one,
> and would make the empty prediction look like the finished one. The line comes back when
> occupancy does, not before.

**Pressing enter opens the chat by transformation, not navigation.** And the animation
lasts as long as the first token actually takes: instant when the model is warm (0.64 s),
long enough to narrate the warm-up when it is cold (4.99 s). The transition is not
decoration laid over a wait — it *is* the wait, made watchable. Nobody can copy it without
having measured those numbers first.

**In the chat, the way back is the only thing that must be there.** ~~The crescent carries
the brain's surfaces — Models, Server, Devices, Advanced, Settings, and the way home.~~
Struck 2026-09-17: see the revision note at the top of this section. The chat does not have
to display a menu of surfaces at all, and deciding what carries them is a job for whenever
the navigation is really built. What the thread genuinely owes the reader is a way home.

> **Decided 2026-09-18, by the owner.** The crescent lives in the chat and nowhere else —
> the brain page does not draw one. It carries the way back to Brain plus the chat's own
> things: a new conversation, the history, the chat's settings. It does not carry Models,
> Server, Devices or Advanced; those exist on the brain page only, which is §5 holding.
>
> **Revised 2026-09-19, by the owner, after using it.** The owner used the app and said the
> navigation made no sense, and the reason is structural: the brain page's row was called
> *Settings* and held an entry called *Settings*. Three rulings replace the paragraph above.
> **A crescent entry is a destination, never an action the page already offers.** From the
> chat, *New chat* and *History* were the drawer the reader already had, which is why their
> clicks appeared to do nothing; the rule is implemented in `crescentEntriesFor`, so the next
> surface to gain the crescent filters itself by declaring what it already offers. **The brain
> page's row is the machine** — *Models*, *Server*, *Devices*, *Advanced*, under the eyebrow
> *This computer*; *Server* is there because it reports this machine's own server, its measured
> decode rate and its connected devices. **The app's own settings are the app's**: appearance
> (which left every header), the remote connection and the web-search switch, reached from the
> crescent. Thinking, which is "answer me now instead of reasoning first", left the sampler
> knobs for the chat's composer. The chat is still not a tab and the brain is still the first
> page; §5 holds.
> Clicking Brain returns to the starting point and **the conversation stays alive** — coming
> back by the bar or by the button resumes it where it was. §4 asked for that return to show
> the conversation from outside, drawn as the four seats; the seats wait on §6, so today the
> return is plain and the conversation simply survives it.

**Going back is symmetric.** The same animation reversed, plus `Esc`. If leaving is a
transformation and returning is a menu click, the illusion collapses on second use.

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

Surfaces live in **one** place. The brain is the legible overview; whatever shortcut the
thread eventually gets is a second way to the same destinations, never a second copy of
them. The moment Models exists both as a shortcut entry and as a panel inside the brain,
there are two answers to every question about it. (This rule was written assuming a
crescent; it does not depend on one, and it outlives it.)

## 6. The prerequisite, and it is not cosmetic

Drawing the seats requires the door to say **who is busy**, and today it does not. The
pairing command knows who is *paired* (`brain_pairing`, one credential per device since
`02a2139`); occupancy is the open item `WHAT-IS-MISSING.md` records as *"the door knows who,
but it does not tell anyone yet"*.

This design promotes that item. It stops being an improvement to the queue and becomes the
substance of the first screen. Anything built before it will show seats it is guessing at,
which is worse than showing none.

## 7. Not decided

- **Whether the crescent can be seen at all.** The two bullets that used to sit here asked
  whether the first-run walk should build the crescent and whether five points sit well on
  an arc drawn with six. Both skipped past the prior question the owner asked on looking at
  it: as drawn in `crescent-chat` today, the resting crescent is an 18 px transparent
  sliver with a 3 px line, and you find it by pointing at it. Its *purpose* is settled
  (`DESKTOP-CHAT-DECISION.md` §6: navigation over a small fixed set of surfaces). Its
  visibility is not, and nothing further about it — animation included — is worth designing
  until it is.
- **How long the transition lasts.** Reopened — see §3. Measured as a mechanism, never
  judged as a feeling on a real screen.
- What the brain shows when nobody is talking and everything is idle. An empty room is the
  common case and it must not look like a failure.
