# The phone chat protocol — v1

The contract between a paired phone and the computer for the phone's **chat** with the
computer's AI (not the Room). The computer answers a phone turn with its own tools and the
same app-drawn cards as its own chat: the desktop WebView runs its own tool loop for the
phone's turn and streams the result back.

Owner decisions: the computer's WebView runs the loop (2026-10-15); a reply is sent from the
phone after the phone's own confirm, and the computer sends only a draft it built itself
(2026-10-15); the computer's mail is per phone, set by the owner in Settings → Mail, off for
a phone paired from 2026-10-17 and on for a phone paired before it (2026-10-17).

**A phone turn drives the browser too, and the device that started the turn confirms** (added
2026-10-18, §3.1 and §7). A phone's write is held on the same card the desktop uses, the card
is drawn on that phone and on no desktop, and the answer goes to §3.1's route. §3's two events
are the only additions to the wire; everything before this reads exactly as it did. **The phone
sends no device number and never could**: the pairing seal hands back the credential and nothing
else (§1), so a phone does not know its own number, and the computer knows who is asking from
the credential the request authenticated with. The turn body is the three fields below and a
`device` in it is not part of this contract — the computer drops it and uses its own.

**§3.1 changed on 2026-10-18, and a phone must be read against the text below rather than
against what it did before:** the card carries `answer_in_ms` and not `answer_by_ms`; the
address is capped at 8 KiB; a phone is asked about at most eight requests at once; the card
arrives on the phone's own stream and nowhere else; an outcome with no stream to go down is
queued and handed over at that phone's next turn; and the answer lane is bounded by the card's
own budget. Each is marked where it is written.

## 1. Transport and auth

Same road, door and credential as `/v1/chat/completions` and the Room (ROOM-PROTOCOL.md §1):
`Authorization: Bearer <credential>`, `401` with an empty body on any refusal, JSON request
bodies, `text/event-stream` responses, snake_case fields, unknown fields ignored both ways.

Routes live under `/kalsa/chat/`:

| route | method | answer |
|---|---|---|
| `/kalsa/chat/turn` | POST | SSE stream (§3) |
| `/kalsa/chat/browser/answer` | POST | JSON (§3.1) |
| `/kalsa/chat/browser/preview` | POST | JSON (§3.1) |
| `/kalsa/chat/mail/read` | POST | JSON (§4) |
| `/kalsa/chat/mail/send` | POST | JSON (§5) |

A computer that does not know these routes answers `404` (or another non-2xx before any SSE
byte). The phone then sends the same turn the old way, to `/v1/chat/completions` without
tools, and remembers the answer for this pairing until the next app start. That fallback is
silent: an older computer is not an error.

## 2. The turn request

```json
{
  "messages": [{"role": "user", "content": "che mail ho ricevuto oggi?"}],
  "reply_for": "105",
  "language": "it"
}
```

- `messages`: the conversation, oldest first. Roles `user` and `assistant` only; `content` is
  a string. Anything else (images, other roles, non-string content) is `bad_request`: a turn
  with pictures goes the old way, to `/v1/chat/completions`.
- `reply_for` (optional): the mail id the person pressed "Draft a reply" on. The computer
  pins the turn to it exactly as its own panel does: a draft for any other id is refused.
  Digits only, otherwise `bad_request`.
- `language` (optional): `en` or `it`, the phone's UI language, so tool words and failure
  sentences match the phone. Default `en`.
- Body at most 1 MiB, at most 200 messages.

**The turn body carries no `device`.** Which phone is asking is not something the phone says:
the door resolves it from the credential in the `Authorization` header, before the body is
parsed (§1), and a `device` field in a turn body is ignored like any other unknown field. A
phone has no way to name itself — the pairing seal returns the credential and nothing else — and
no way to name another phone, which is why a browser card can be drawn for this turn and only
on this phone (§3.1).

One turn per device at a time: a second turn while the first runs is refused with
`error {code:"busy"}` and the first keeps going.

### Whose mail a turn may use

A turn is offered the tools the asking phone is allowed: no mini app, and no mail at all —
`mail_list`, `mail_read`, `mail_draft` and `mail_show` together — unless the owner has that
phone's mail switch on in Settings → Mail. A phone switched off still chats: it is offered no
mail tool, so a turn that asks for one gets a refusal from the model, not the mailbox. The
computer decides per request, so a switch takes effect on the next turn, never mid-turn.

## 3. The turn stream

Frames are `event: <name>\ndata: <json>\n\n`. A `: ping` comment comes at least every 15 s, so
a slow mail read is not silence.

| event | data | meaning |
|---|---|---|
| `turn` | `{"turn":"<id>"}` | first frame: the computer took the turn |
| `reasoning` | `{"text":"…"}` | a piece of the model's reasoning |
| `delta` | `{"text":"…"}` | a piece of the answer |
| `tool_run` | `{"id":"…","name":"mail_list","state":"running"\|"ok"\|"failed"\|"refused"}` | a tool row |
| `cards` | the desktop `MailCards` value: `{"kind":"cards","items":[{"id","from":{"name","address"},"subject","gist","date","labels":{"label":"normal"\|"suspicious"\|"bulk","reasons":[…]}}],"bulk":N}` | mail cards, drawn by the app |
| `draft` | `{"draft_id":"<32 hex>","reply_to_id":"105","to":"…","to_name":"…","subject":"…","body":"…"}` | a reply draft; nothing was sent |
| `browser_card` | see §3.1 | a request held for the person; nothing was sent |
| `browser_outcome` | `{"card_id":"<32 hex>","code":"…","host":"…"}` | what became of a card the phone did not answer |
| `recap` | `{"text":"…"}` | what Kalsa did in the turn, in one line (§3.2) |
| `error` | `{"code":"…"}` | the turn failed; terminal |
| `done` | `{}` | the turn ended; terminal |

Exactly one terminal frame (`error` or `done`), then the computer closes the stream. If the
phone closes the stream first, the computer stops the turn.

Error codes: `busy`, `bad_request`, `no_runner` (the computer's window did not take the turn
within 10 s), `engine` (the model failed), `cancelled`, and the mail codes the desktop chat
shows (`mail.invalid_account`, `mail.keychain`, `mail.storage`, …). The phone shows its own
sentence per code and a generic one for an unknown code; the computer's words are not shown.
A turn is never refused for the mail switch. A phone that may not read mail is offered no mail
tool, so a model that still calls one has that call refused as `tool_run` `state:"refused"` —
the mailbox is not consulted. A switch flipped while a turn runs takes effect on the next turn;
closing the stream is the only lever on the one in flight.

`gist` and the answer text are the model's; `from`, `subject` and `reasons` are the mail's.
The mail's fields and the gist are plain text, never markup. The answer text may be markdown
(lists, tables) like the desktop's, but on this route a link in it is shown and never opened by a
tap: a mail the model read can put a link into the answer.

### 3.1 A browser card on a phone's turn

**The device that started the turn confirms** — and the phone never says which device that is.
The computer already knows: it resolved the device from the credential the request authenticated
with, and every browser call of this turn is stamped with that phone's conversation. A phone turn
is offered the same browser the desktop is offered — the same web switch, the same rules, and the
same card for a write. What changes is where the card is drawn: on that phone, and on no desktop.
A card raised by a desktop turn is drawn on the window as always; the two never mix, because a
card belongs to the conversation that raised it and a phone's conversation is not a desktop's.
A credential that is not paired reaches none of this: there is no turn, so there is no card.

#### The card

```json
{
  "card_id": "0123456789abcdef0123456789abcdef",
  "method": "POST",
  "url": "https://shop.example/order",
  "destination": {"host": "shop.example", "port": null, "secure": true},
  "fields": [
    {"name": "custname", "value": "Giulia", "secret": false, "label": "Nome e cognome"},
    {"name": "passphrase_2", "value": "hunter2", "secret": true}
  ],
  "asked_at_ms": 1767225600000,
  "answer_in_ms": 300000
}
```

| field | type | meaning |
|---|---|---|
| `card_id` | string, 32 lowercase hex | identifies the card; one answer, ever |
| `method` | string ≤ 256 | the request's method |
| `url` | string ≤ 8 KiB | the address, whole, for a phone that parses it. **Query values of a secret are shown as dots** |
| `destination` | object, **optional** | **where it goes, as this computer parsed it.** Absent when it could not name a host — see below |
| `destination.host` | string 1–253 bytes | the host **in the form the resolver is given: ASCII, punycode, lower case** |
| `destination.port` | integer 1–65535 or `null`, **optional** | `null` when the address names no port, or names the one its own scheme uses anyway |
| `destination.secure` | boolean | whether the connection is encrypted — `https`, or nothing else |
| `fields` | array ≤ 200 | what the person typed, oldest first |
| `fields[].name` | string ≤ 256 | the field's name |
| `fields[].value` | string ≤ 8 KiB | **the real value, always** |
| `fields[].secret` | boolean | draw this one as dots, behind a Show button |
| `fields[].label` | string ≤ 240 bytes, **optional** | the words the page puts beside the field — draw them as `label: value`. Absent when the page gave none: draw the field's `name` instead |
| `asked_at_ms` | integer | when the card was first shown — **the computer's clock, for logs only** |
| `answer_in_ms` | integer | how many milliseconds of the person's five minutes are left, counted from the moment this card arrives |

**`answer_by_ms` is gone; `answer_in_ms` replaces it, and it is not a rename.** Both
clocks in `asked_at_ms` are the computer's, and a phone cannot read either: a phone whose
clock is a day out reads an absolute deadline as already past, and one that is half an hour
out reads it as not yet arrived — in both cases without ever pressing anything. What
crosses is a **duration**, and the phone counts it down from the moment the card arrived,
which is the only moment it knows for certain. `asked_at_ms` stays for logs and for the
computer; **do not compute a deadline from it.**

#### The destination: shown, not worked out

**`destination` is what this computer decided, and the phone shows that.** A card that
names where a request goes has to be right, and the way to be right is not for each window to
parse `url` itself: two parsers of one address are two answers, and they disagree about a
backslash, an extra `@`, surrounding spaces and an international name — all of which a browser
resolves one way and a hand-written rule does not. A card showing `shop.example` over a request
going somewhere else is the one card that must never exist.

**So the computer parses it once**, with the same parser the browser uses, and sends three
fields. **The phone draws the host exactly as it arrives** — punycode stays punycode, lower case
stays lower case — and shows a port only when `port` is not `null`. It must **not** re-parse
`url`, re-case the host, re-encode the punycode, or show a default port it worked out itself.
`url` stays in the card for the phones that know no better, and a phone that reads only `url` and
ignores this field keeps working exactly as it did.

**A card with no `destination` cannot be sent, anywhere.** The computer could not name a host, so
there is nothing for the person to be agreeing to; the desktop draws that card without a Send
button and the sidecar refuses a send answer for it, so a phone that presses Send anyway is told
the request went nowhere. **It can still be declined** — turning a request down needs no
destination at all. A phone draws such a card with **no host** and, if the protocol lets it
answer, with no way to answer yes.

**The address is capped at 8 KiB, and the cap is the computer's, not a second number.**
A longer address is refused before it is ever held — there would be no card to ask about —
and the model is told why in one line. A card at every other cap (200 fields of 8 KiB) has
to fit in one phone frame, and an address nobody is going to read is not worth a megabyte.

**`label` is display text, and optional.** It is the page's own words, cleaned by the computer:
control characters and text-reordering marks are removed, runs of space collapse, and it is
capped at 60 characters (the 240-byte bound is the same cap in UTF-8). Nothing decides on it:
the value, the request and `secret` are the same with or without it. A phone that predates
labels ignores the key and draws the card it always did; a phone that reads it draws the
label in place of the name, and only where the key is there.

**`secret: true` is a drawing instruction, not a filter.** The value crosses the wire because
the card is what the person is deciding on: a person is not asked to send a form they cannot
read. Draw `secret` fields as dots with a per-card Show toggle, hold the real value in the
component that draws the card, for as long as it is drawn, and nowhere else — not in a log,
not in a cache, not in local storage, not in a crash report. A field the person has not shown
never leaves that component. This is the desktop's rule exactly; the pairing is the reason it
is safe to repeat it.

**What the phone must persist: nothing.** A card lives in memory for as long as the person may
answer it. Like a draft, and like a mail card, it is a stranger's words — see §6.

**A card arrives on the turn that raised it, once.** It is written onto that turn's stream,
which is the stream the phone is already reading, and nowhere else — the window does not
relay it, so there is no second copy of a card on the phone's screen. If that turn's stream
has closed, the card is not re-sent: the computer's five minutes end it as `expired`, the
model is told, and nothing was sent. A phone that reconnects sees no card, because there is
nothing left to answer.

**A phone is asked about at most eight requests at once.** The ninth is **refused** — not
held, not drawn, never sent to the phone — and the model is told once, in one line, that it
made too many writes at one person. A card the phone is not shown is a card nobody answers,
so the computer lets it go rather than sitting on it. The count is per phone: one phone's
backlog is not charged to another.

#### Answering

`POST /kalsa/chat/browser/answer` with `{"card_id":"…","answer":"send"|"decline"}` → `200`
with either the outcome or an error. The answer is a separate request and not a turn, so it
works while the turn that raised the card is still running: it has a lane of its own and is
never refused as `busy`.

The card is **spent before anything is dispatched**, so exactly one of `send` and `decline`
reaches the computer for a given `card_id`. A second answer of the same card is
`{"error":"card_unknown"}` — the phone's retry cannot send a request twice. There is no
retry and no other verb: a body naming anything but those two is `400 {"error":"bad_request"}`
and never reaches the computer.

**The pairing is asked twice, and only the second ask counts.** A press from a phone that is
not paired spends nothing, tells nobody and dispatches nothing. A phone the owner unpairs
while its finger is on the button is caught before anything reaches the browser — and a
phone whose number has since been taken by a *different* phone, under a different pairing,
gets `card_unknown` rather than the answer to somebody else's request.

**The answer lane is bounded by the card's own budget.** The computer will not wait on the
browser for longer than what is left of that card's five minutes, so a browser that stops
answering ends the lane instead of holding the computer — and the phone's turn — for ever.
What comes back then is `{"code":"unclear"}` and nothing else: the request had already been
given to the browser, so whether that host has it cannot be established, and **`unclear` is
never `declined`** — a model that reads "declined" will try again. If the five minutes were
already up when the press arrived, nothing was given to the browser at all, and the press
is told `card_expired` — the card was owed nothing.

`200` bodies:

| body | meaning |
|---|---|
| `{"code":"sent","host":"shop.example"}` | the request went, to this bare host |
| `{"code":"declined"}` | the person said no |
| `{"code":"expired"}` | past the deadline; nothing was sent |
| `{"code":"gone"}` | the browser is no longer there |
| `{"code":"unsendable"}` | sent as far as the browser could, not reaching the host |
| `{"code":"unclear"}` | the card was spent and nobody can say what happened |
| `{"error":"card_unknown"}` | not yours, already answered, or never held |
| `{"error":"card_expired"}` | the person's five minutes were already up when the answer arrived |
| `{"error":"cancelled"}` | the phone was gone, or no window could take it |
| `{"error":"busy"}` | another answer of this phone's is already in flight |

`code` is one of those six, or nothing else — the phone shows a generic sentence for a code it
does not know rather than guessing. **`host` appears only with `code:"sent"`**, and only ever
as a bare name: letters, digits, dot, dash, underscore, or a bracketed IPv6 address. No path,
no query, no port, no `user@`. The answer to a question about the desktop is the same shape,
so a phone learns nothing the window would not have shown.

#### The page preview

`POST /kalsa/chat/browser/preview` with `{}` → `200` with the picture or a code. It is a
separate request and not a turn, so it has a lane of its own: a running turn never refuses it,
and a second preview of the same phone, while the first is being taken, is `busy`.

**The picture is of the page as it is now.** The computer takes one JPEG of the viewport of the
browser it already has open and hands it to the phone that asked. It is the **current** page and
not a page of an earlier turn: a phone that asks again later gets the page as it is at that
moment, and `taken_at` says when the picture was taken so the phone can show that.

**The computer starts nothing for this.** A preview of a page that is not open is refused, and no
browser window appears on the person's desk because a phone pressed something. The picture is
never put in the model's context, never written to a file and never logged: it crosses once and
is gone.

**Only the phone that owns the page gets it.** The page belongs to the conversation that opened
it, and the computer asks the sidecar whether that is still so. Reading the page does not make it
yours, and a page the person opened by hand is nobody's. Those are refused as `not_yours`.

| body | meaning |
|---|---|
| `{"image":"<base64 JPEG>","media_type":"image/jpeg","host":"shop.example","taken_at":1767225600000}` | the picture |
| `{"error":"no_page"}` | no browser is open; nothing was started |
| `{"error":"not_yours"}` | the page is another conversation's, or nobody's |
| `{"error":"busy"}` | another call is driving the browser, the person has paused it, or another preview of this phone's is in flight |
| `{"error":"too_large"}` | the picture was bigger than the road can carry |
| `{"error":"cancelled"}` | the phone was gone, the pairing changed, or the browser's session ended, while the picture was taken |
| `{"error":"unavailable"}` | this computer will not show that page, or could not take the picture |

`image` is base64 **without a prefix**, of a JPEG of at most 262,144 bytes — at most 349,528
characters — so the whole body stays under the half a megabyte the road carries. `taken_at` is
the moment the picture was taken, in **milliseconds** since the epoch, on the computer's clock.
`host` is a bare host name, the same shape the card's host is.

**The pairing is checked before and after.** A phone that is not paired gets nothing, and a phone
the owner unpairs while its picture is being taken is told `cancelled` and gets no picture. What
has already gone on the wire is not recalled — there is no way to recall it — but nothing leaves
after the second check.

**Nothing is asked for twice.** The phone presses, the computer answers, and the phone asks again
if it wants a new picture: there is no polling, no retry, no stream and no video.

**A computer that does not know this route answers `404`**, and the phone shows `unavailable`
for it — that computer has no preview to give. A body that is not a JSON object is
`400 {"error":"bad_request"}`, and the phone shows its own unreadable message for that: it can
tell that shape from any answer, so it does not need a word from the computer.

#### An outcome the phone did not ask for

`browser_outcome` carries the same `{"card_id","code","host"}` for the cases nobody
requested. **The one that matters is the computer's window closing with the card still on
it**, which is `declined`: the card was held, nobody was left to answer it, and nothing was
let through.

**An outcome with no stream to go down is queued, not lost.** A turn lasts seconds and a
card is asked about for five minutes, so the window usually closes long after the turn is
over. The computer holds the outcome **for that phone** and hands it over at the start of
that phone's **next** turn, before anything else on the stream — where the phone applies it
to the ids it is still drawing and drops the rest. The queue is per phone: one phone is
never handed another's outcome, and a phone that has been unpaired never gets it at all.
So a phone is never left drawing a card that was already declined, pressing a button that
can only be refused.

A write refused for want of a decision (the ninth, §3.1) and a phone that was unpaired while
its card was held are **not** sent to the phone at all: there is no card on the phone's
screen for either to be about. Both go to the browser and to the model, which is where they
are settled.

Expiry needs no event. The phone decides it from `answer_in_ms`, which is the person's budget
counted down from the moment the card arrived, and a late answer is told `card_expired`.
Nothing was sent, so nothing is lost by the phone not hearing it: it takes the card off its
screen when the budget runs out.

#### The model hears about it on the phone's next turn

The outcome rides the next turn of that same phone, in the same place the desktop's own does:
a note on the last user message, read by the model alone and by no one else. It says where the
request went and **repeats no field of it** — no card id, no value, no name. It is delivered
once: the next turn drains it, and the one after does not see it again.

An outcome raised by a card that expired, or by a phone that unpairs, is reported the same
way, so the model is never left carrying a request it believes is still waiting for an answer.

### 3.2 The turn recap

`recap` carries **what Kalsa did in the turn, in one line**, in the phone's language:

```
Kalsa ha: chiesto reg.example.org · scritto in 2 campi · 1 invio in attesa della tua risposta
```

It is **this computer's own account of its own runs** — the calls it made and the answers it got
back — and never the page's own words about them. It comes out **once per turn that used the
browser**, on every ending: an answer, a failure, or a Stop, and always **before** the turn's
terminal frame, so a phone that stops reading at `done` has still had it.

**The phone must draw `text` as it is**: one quiet line, the same way the desktop draws it after
the tool rows. It is not a tool row, not a card and not markdown, and it is never parsed for a
host, a count or a code — a line that changes shape is still a line, and the phone shows it or it
does not. A phone that does not know this event ignores it: `parseTurnSseFrame` in
`src/engine/remote/turnSse.ts` returns `ignore` for any name it does not name, so a recap
arriving at an older phone costs it nothing and loses the line.

**The model reads the same line**, on the phone's next turn and once only: it rides the request
as a last plain message, fenced exactly as a tool result is, because it can name a host. It is
built when the next turn starts — out of the runs, the answers given since, and the cards still
on the window — so it says what is true then and not what was true at the end of the last turn.

## 4. Open a mail

`POST /kalsa/chat/mail/read` with `{"id":"105"}` → `200 {"record": <MailRecord>, "body": "…"}`,
the same record and fence-free body the desktop's Mail tab shows. A failure is
`200 {"error":"<code>"}`. The id must be digits. A read is scoped to the phone, like a draft:
a phone whose mail switch is off is refused `200 {"error":"phone_mail_off"}` before the
computer reads anything, and so is a send in §5.

## 5. Send a draft

`POST /kalsa/chat/mail/send` with `{"draft_id":"…","body":"…"}` → `200 {"sent_to":"…"}` or
`200 {"error":"<code>"}`.

- The phone sends this only after its own confirm (To, Subject, Body, then Invia again). That
  press is the person's click the computer's send requires.
- `body` (optional) is the text the person edited on the phone; without it the draft's body is
  sent. The recipient and the subject come from the draft the computer stored; the phone
  never names a recipient.
- A `draft_id` belongs to the device whose turn produced it, lives 30 minutes, and is spent by
  a successful send. A second send of the same id, an id of another device, or an expired one
  is `{"error":"draft_unknown"}`. A send while the same id is already sending is
  `{"error":"busy"}`. A send from a phone whose mail switch is off is
  `{"error":"phone_mail_off"}`, and nothing is spent.

## 6. On the phone's disk

Cards and drafts are never persisted on the phone, like the desktop chat (whose store keeps a
count and nothing else): they are a stranger's words. Only the answer text is kept.

**That includes a browser card.** Hold it in memory for as long as the person may answer it,
and for nothing longer. The one thing to keep in a component rather than in a store is a
secret field's value while its card is drawn, so that Show works without the value ever being
somewhere it should not be. On reload, on an answered card, and once the card's `answer_in_ms`
budget has run out, the value goes: it is re-read from the computer only while the card is live.

## 7. An exchange, end to end

A phone asks for something that ends in a purchase. The stream is the phone's request stream;
`→` is what the phone sends, `←` what it receives.

```text
POST /kalsa/chat/turn   {"messages":[{"role":"user","content":"buy the large one"}],"language":"en"}

← event: turn        data: {"turn":"r1"}
← event: tool_run    data: {"id":"c1","name":"browser_open","state":"ok"}
← event: tool_run    data: {"id":"c2","name":"browser_click","state":"ok"}
← event: tool_run    data: {"id":"c2","name":"browser_click","state":"running"}

← event: browser_card
  data: {"card_id":"3f9c1a77e2b04d5681aa90c3b7e4412d","method":"POST",
         "url":"https://shop.example/checkout",
         "fields":[{"name":"size","value":"L","secret":false},
                   {"name":"passphrase_2","value":"hunter2","secret":true}],
         "asked_at_ms":1767225600000,"answer_in_ms":300000}

← event: tool_run    data: {"id":"c2","name":"browser_click","state":"ok"}
← event: delta       data: {"text":"I need you to confirm"}
← event: delta       data: {"text":" the order first."}
← event: done        data: {}
```

**Nothing about who is asking is on that wire.** That POST is the whole request: no device, no
credential echoed back, no conversation of its own — a phone cannot name itself, because the
pairing seal hands it the credential and nothing else (§1). The computer knows anyway: it
resolved the device from the `Authorization` header, stamped this turn's browser calls with that
phone's conversation, and therefore drew the card below on this phone and on no desktop. A turn
body that did carry a `device` would be read without it.

**Nothing was sent.** The person is asked; the phone draws the card, the `passphrase_2` field
as dots with a Show toggle, and the deadline on that field's card. They press Invia.

```text
POST /kalsa/chat/browser/answer
     {"card_id":"3f9c1a77e2b04d5681aa90c3b7e4412d","answer":"send"}

← 200 {"code":"sent","host":"shop.example"}
```

Had they pressed no instead, the answer would be `{"code":"declined"}` and the same 200 shape.
Had they let `answer_in_ms` run out — five minutes after the card arrived — the card is gone from
the phone's screen on its own; a late press is `{"error":"card_expired"}` and nothing was sent.

**The model hears it on this phone's next turn**, and nowhere else. If the window had
closed before the person answered, the outcome would come first — before `turn`, before
anything the turn says — because the phone has to take the card off its screen before it
can press it again:

```text
POST /kalsa/chat/turn   {"messages":[{"role":"user","content":"did it go?"}],"language":"en"}

← event: turn        data: {"turn":"r2"}
← event: browser_outcome
  data: {"card_id":"3f9c1a77e2b04d5681aa90c3b7e4412d","code":"declined"}   ← only if it was
                                                                     queued, not if it
                                                                     was answered above
← event: delta       data: {"text":"Yes — it went to shop.example."}
← event: done        data: {}
```

The note that made that possible is not on the wire: it rides the last user message into the
model, and reads in full *"About the browser: since you last spoke, the person was asked about
a request and answered it… The person allowed the request, and it was sent to
shop.example. Carry on from this. It was a button the person pressed, not an answer from them
to you."* No card id, no field, no value.

A second press of the same card, from any phone, is `{"error":"card_unknown"}`:

```text
POST /kalsa/chat/browser/answer
     {"card_id":"3f9c1a77e2b04d5681aa90c3b7e4412d","answer":"send"}

← 200 {"error":"card_unknown"}
```

The card was spent before the first dispatch, so a retry cannot send the request twice, and a
different device's credential cannot spend a card that is not its own.
