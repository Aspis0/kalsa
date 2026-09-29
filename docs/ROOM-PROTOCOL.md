# The room protocol — v1

The contract the phone implements against. One room per Kalsa computer: the
computer hosts it, every device paired to it (after the owner's Allow) is a
member, and so is the computer's own user, the host. The AI, shown as
"Kalsa", answers only when called. Text only; the AI itself and the queue
behind it are later steps — the wire already carries them.

## 1. Transport and auth

Same road, same door, same credential as `/v1/chat/completions`:

- Base URL: whatever the pairing stored — the iroh `door` lane or the HTTPS
  road. Room routes live under `/kalsa/room/` on that same base.
- Auth: `Authorization: Bearer <credential>`, the device's own 64-hex
  pairing credential. Requests without a valid one are refused with `401`
  and an empty body — the door's one uniform refusal, the same for an
  unknown credential as for a forgotten device.
- Bodies are `application/json`; SSE responses are `text/event-stream`.
- Field names are lowercase snake_case, exactly as written. Unknown fields
  in a request body are ignored; unknown response fields must be ignored by
  the client, so the protocol grows without a version bump.

## 2. Identity

- A member is identified by `member_id`, a number the COMPUTER assigns for
  the life of the room. It is not the pairing device id: a phone the owner
  forgets and later pairs again is a NEW member with a new id, and nothing
  it did before carries over.
- The host is always `4294967295`; the AI is always `4294967294`. No member
  id can collide with them.
- Each member picks one display name per room (`PUT /kalsa/room/name`).
  Nothing links the same person across computers; on another computer the
  same phone is a stranger until it names itself there.
- Until a member sets a name, its displayed name is its device label
  ("Paired phone 2"); the host's default is its own label, set on the
  computer itself, never from a phone.
- The AI's display name is "Kalsa", fixed: no member may take it, nor a
  name another live member or the host already wears (§6).
- A device the owner forgets stops being a member immediately: every route
  answers `401`, its live stream is cut, and it leaves the member list. Its
  past messages stay, carrying the author they had, shown with the name it
  had and marked as a former member. A phone that pairs again starts fresh.

## 3. Room info — `GET /kalsa/room/info`

```json
{
  "room_name": "This computer",
  "members": [
    {"member_id": 4294967295, "name": "This computer", "kind": "host"},
    {"member_id": 3, "name": "Paired phone 2", "kind": "phone"},
    {"member_id": 4294967294, "name": "Kalsa", "kind": "ai"}
  ],
  "ai": {"busy": false, "running": null, "queue": [], "you_pending": false}
}
```

- `room_name` is the computer's own device label.
- `members` lists the host, every allowed paired device, and the AI, in
  that order. `kind` is `"host"`, `"phone"` or `"ai"`; names are the
  display names, defaults included; former members are not listed.
- `ai` is the visible turn state, names only: `running` is the name whose
  answer is being generated (`null` when idle), `queue` the waiting names
  in order, `you_pending` whether the CALLER has a call pending. Never
  anything about what was asked.

## 4. History — `GET /kalsa/room/history`

Query parameters, all optional:

- `after=<seq>` — page forward: messages with `seq` greater than this,
  oldest first.
- `before=<seq>` — page backward: the messages immediately older than this
  `seq`, oldest first (so the page reads in transcript order).
- `limit=<n>` — 1 to 200, default 100. Out of range: `400 bad_request`.
- With neither cursor, the page is the newest `limit` messages, oldest
  first — what a chat shows on open.

```json
{
  "messages": [
    {"seq": 41, "member_id": 3, "name": "Marco", "time": 1791000000,
     "text": "dinner at eight?", "call_ai": false}
  ],
  "has_older": true,
  "has_newer": false
}
```

- Messages come back oldest first in both modes. `has_older`/`has_newer`
  say whether another page exists beyond the returned edges.
- `name` is the author's CURRENT display name, resolved at read time: a
  rename recolors that member's past messages. A former member's messages
  show the name it had, marked as a former member. `call_ai` is the flag
  the post carried; `client_msg_id` is never returned.
- `after` and `before` together: `400 bad_request`. A cursor beyond either
  end is an empty page, not an error.

## 5. Posting — `POST /kalsa/room/messages`

```json
{"client_msg_id": "b3f1c2", "text": "@Kalsa what time is it?", "call_ai": false}
```

- `client_msg_id` (required): 1–64 characters, ASCII 0x21–0x7E, unique per
  client. It exists because the host may be asleep when a message is
  written: the phone queues the message locally and retries the POST until
  it succeeds, and the id makes the retry harmless.
- `text` (required): 1–8000 UTF-8 bytes.
- `call_ai` (optional, default `false`): the explicit call button.

The answer for a fresh post AND for an idempotent retry — the same
`client_msg_id` from the same member with the SAME text and `call_ai` — is
one shape either way; the client cannot tell and need not:

```json
{"seq": 42, "time": 1791000017, "ai_call": "queued", "refusal": null}
```

The same `client_msg_id` with DIFFERENT text or flag is refused with
`409 client_msg_id_reused`: one id, one message.

- `seq` and `time` are assigned by the computer: `seq` is the transcript
  number (§7), `time` is unix seconds UTC. Client clocks are never used.
- `ai_call` is `null` when the message did not call the AI, `"queued"`
  when accepted, `"refused"` when not — `refusal` carries the honest
  sentence (a member with a call already pending is refused; the message
  itself still posts).

### The "@Kalsa" rule, exactly

A message calls the AI when `call_ai` is true OR the text contains the
token `@Kalsa`, where: the six characters match ASCII-case-insensitively
(`@Kalsa`, `@kalsa`, `@KALSA` all count); the character before the `@`, if
there is one, is not alphanumeric in Unicode terms; and the character after
the final `a`, if there is one, is neither alphanumeric in Unicode terms
nor an underscore. So `"@kalsa, ciao"`, `"(@Kalsa)"` and `"@Kalsa's"` count;
`"email@kalsa.io"`, `"josé2@Kalsa"` and `"café@Kalsa"` (an alphanumeric
character sits before the `@`) and `"@Kalsabot"` (one sits after the word)
do not. Detection runs on the raw text, before any processing, and the flag
travels with the message.

## 6. My name — `PUT /kalsa/room/name`

```json
{"name": "Marco"}
```

Answers `200` with `{"member_id": 3, "name": "Marco"}`. The name is
trimmed, then must be 1–40 UTF-8 bytes with no control characters and no
format, bidi or zero-width characters (the invisible Unicode ranges that
make two names look like one). "Kalsa" in any casing is refused, as is any
name another live member or the host already wears; comparisons happen
after trimming and lowercasing, so "MARCO" does not dodge "Marco". Two
names that differ only in Unicode composition (é as one character or as
two) are different names in v1 — an honest limit, said plainly. Setting
the same name again changes nothing. A rename broadcasts a `member` event
(§7) and does not touch messages already posted.

## 7. Ordering: the seq and the event stream

One transcript, one counter. Every transcript entry — a member's message
and the AI's finished answer alike — takes the next `seq`: from 1, strictly
increasing, never reused, no gaps. The `seq` a POST returns is the `seq`
the stream carries. Posts are ordered by the computer, in the order it
accepted them.

### `GET /kalsa/room/events` — the live stream (SSE)

- `id:` is the entry's `seq`. An SSE client echoes it back as the
  `Last-Event-ID` header on reconnect, and the server replays every
  transcript entry after that `seq`, in order, without duplicates, then
  follows the tail live. The transcript is durable and never truncated in
  v1, so any `seq` the client last saw can be resumed from, however long
  the disconnect lasted. A `Last-Event-ID` above the newest seq is
  `400 bad_cursor` — it claims events that never happened.
- Events that are not transcript entries — member changes and AI turn
  progress — carry no `id:` line. A reconnect resumes from its last seq and
  does not replay the member news it slept through; it fetches
  `/kalsa/room/info` once instead. Keep-alives (`: ping`) arrive at least
  every 15 s.

Numbered events:

```
id: 42
event: message
data: {"seq":42,"member_id":3,"name":"Marco","time":1791000017,"text":"@Kalsa hi","call_ai":true}

id: 43
event: ai_message
data: {"seq":43,"member_id":4294967294,"name":"Kalsa","time":1791000022,"text":"It is 17:00.","call_ai":true}
```

- `message` — a member's posted message, in the shape history returns.
  The poster's own message also arrives on the stream.
- `ai_message` — the AI's finished answer, same shape, now part of the
  transcript and of history. This is the ONLY way AI text reaches history:
  deltas are never stored.

Unnumbered events:

```
event: member
data: {"action":"joined","member_id":5,"name":"Paired phone 3"}

event: ai_status
data: {"state":"queued","who":"Marco","running":null,"queue":["Marco"]}

event: ai_delta
data: {"text":"It is "}
```

- `member` — `action` is `joined` (device allowed), `renamed` (the new
  name in `name`), or `left` (device forgotten; `name` is the last name it
  was known by).
- `ai_status` — the visible turn state, after every change: `state` is
  `queued` / `thinking` / `answering` / `done` / `refused`, `who` the name
  whose call it is about, plus the same `running`/`queue` view as info.
  Names only, ever.
- `ai_delta` — a chunk of the answer being streamed, during `answering`.
  One turn streams at a time; a client assembles chunks until `ai_message`
  gives it the final text, which replaces the assembly.

On one connection: numbered events arrive in `seq` order, an entry is
delivered at most once, replay never reorders. Between connections, the
`Last-Event-ID` contract above is the whole story.

## 8. The AI call, as the wire carries it

Anyone may call. A call is a message with `call_ai: true` or a text
matching §5's rule — the call and the message that carried it are one
transcript entry. At most one call per member may be pending; a second is
refused in the POST response (`ai_call: "refused"` plus the honest
sentence), never silently. One AI turn runs at a time and the turn order is
visible to everyone, names only — the rules themselves, the rotation and
its visibility, are HOUSEHOLD-RULES.md §5.2–5.4 and are not restated here.

## 9. Sizes, errors, limits

| Thing | Limit | Refusal |
|---|---|---|
| message text | 1–8000 UTF-8 bytes | `413 too_large` (empty: `400`) |
| display name | §6 | `400` / `413` / `409 name_taken` |
| client_msg_id | 1–64 chars ASCII 0x21–0x7E | `400 bad_request` |
| client_msg_id reuse | same id, different content | `409 client_msg_id_reused` |
| history limit | 1–200 | `400 bad_request` |
| Last-Event-ID | at or below newest seq | `400 bad_cursor` |

Error bodies (except the empty 401) are
`{"error": {"code": "...", "message": "<one honest sentence>"}}` with the
codes above; `name_taken` and `client_msg_id_reused` are 409, the rest 400.

A damaged transcript is recovered, not fatal. The room reopens on the
longest intact run of entries; everything the damage held is gone from
history, and the damaged bytes are preserved whole beside the transcript
(`room-log.damaged-<time>.jsonl`, owner-only) for the owner to read. If
even that recovery write fails, the room serves reads and refuses posts
until a restart repairs it. Members see a room that continues from the
last intact message — no client-facing event exists for the recovery in
v1; the room simply continues.

A host asleep or off is not an error: phones queue outgoing posts locally
and retry them, `client_msg_id` makes the retry idempotent, and on
reconnect `Last-Event-ID` + `history` + one `info` call resync the room.
No delivery while the host is down; nothing lost, nothing promised early.

## 10. Not in v1

Direct messages between members; files, images, voice; end-to-end
encryption beyond the transport (the host sees plaintext — a family room
on the family's own computer, said plainly); a second room on one
computer; typing indicators and read receipts; editing or deleting posted
messages; delivery while the host is off; retention limits (the transcript
grows unbounded in v1); calls and meetings.
