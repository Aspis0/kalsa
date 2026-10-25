# The room protocol — v1

The contract the phone implements against. One room per Kalsa computer: the
computer hosts it, every device paired to it (after the owner's Allow) is a
member, and so is the computer's own user, the host. The AI, shown as
"Kalsa", answers only when called. Members post words, pictures and
videos (§5b).

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
- A member sees the room's history only from when they joined: entries
  before their join point are not returned by history pages and not
  replayed by their event stream. The host sees everything. A forgotten
  and re-paired device is a new member and starts fresh.
- A device the owner forgets stops being a member immediately: every route
  answers `401`, its live stream is cut, and it leaves the member list —
  the 401 is how the phone learns it was removed; no `left` event of its
  own is owed to it. Its past messages stay, carrying the author they had,
  shown with the name it had and marked as a former member. A phone that
  pairs again starts fresh.

## 3. Room info — `GET /kalsa/room/info`

```json
{
  "room_name": "This computer",
  "room_id": "1f0a3b9c2d4e5f60718293a4b5c6d7e8",
  "epoch": "8a7b6c5d4e3f20112233445566778899",
  "you": 3,
  "members": [
    {"member_id": 4294967295, "name": "This computer", "kind": "host"},
    {"member_id": 3, "name": "Paired phone 2", "kind": "phone"},
    {"member_id": 4294967294, "name": "Kalsa", "kind": "ai"}
  ],
  "ai": {"busy": false, "running": null, "queue": [], "you_pending": false}
}
```

- `room_id` is opaque, random, minted once when the room is created, and
  stable for the life of that computer's room — the key a phone's
  multi-computer store shelves this room under.
- `epoch` names the transcript's current epoch (§7): it changes only where
  a recovery dropped bytes.
- `you` is the caller's own member id.
- `room_name` is the computer's own device label; when the host renames
  itself, the change arrives as a `member` `renamed` event for the host's
  member id, and `room_name` follows if it derives from the host.
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
  say whether another page exists beyond the returned edges — within the
  caller's own history: a member's pages begin at their join point, and
  the host's at the transcript's start. A `Last-Event-ID` replay begins at
  the join point too, never before it.
- A message that carries pictures or videos names them in a `media`
  array of blob descriptors (§5b); a message without media has no
  `media` field at all.
- `name` is the author's CURRENT display name, resolved at read time: a
  rename recolors that member's past messages. A former member's messages
  show the name it had, and carry `"former": true` — that field is the
  mark. `call_ai` is the flag the post carried; `client_msg_id` is never
  returned.
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
- `text` (required, unless `media` rides with the post — §5b): 1–8000
  UTF-8 bytes. The whole request body is capped
  at 16 KiB before it is read: JSON escaping can make a text within 8000
  bytes exceed the cap (a quote-heavy 7900-byte text can escape past it),
  and the answer is then `413 too_large` — the text is legal, the body is
  not; shortening the text or letting the client library do the escaping
  resolves it.
- `call_ai` (optional, default `false`): the explicit call button.

The answer for a fresh post AND for an idempotent retry — the same
`client_msg_id` from the same member with the SAME text and `call_ai` — is
one shape either way; the client cannot tell and need not:

```json
{"seq": 42, "time": 1791000017, "ai_call": "queued", "refusal": null}
```

The same `client_msg_id` with DIFFERENT text or flag is refused with
`409 client_msg_id_reused`: one id, one message. An id is remembered for
the life of the transcript within an epoch — a post lost to a recovery
that started a new epoch is accepted again as new, because the id went
with the bytes.

- `seq` and `time` are assigned by the computer: `seq` is the transcript
  number (§7), `time` is unix seconds UTC. Client clocks are never used.
- `ai_call` is real: `"queued"` when the call was taken (its turn begins
  at once or joins the line), `"refused"` when not — with `refusal`
  carrying the code. One code exists today: `already_pending`, for a member
  who calls again while one call of theirs waits or runs. The message
  itself still posts either way; only the call is refused. An idempotent
  retry of the same `client_msg_id` is never a refusal.

### Withdrawing a call — `DELETE /kalsa/room/call`

A member withdraws their own call: a pending one leaves the line, a
running one stops its turn. There is nothing to withdraw of anyone
else's — the answer to that is `404 no_call`. The room broadcasts an
`ai_status` `cancelled` either way; a stopped turn stores no half answer.
The host may stop any turn from the computer itself — that is not a phone
route.

### The "@Kalsa" rule, exactly

A message calls the AI when `call_ai` is true OR the text contains the
token `@Kalsa`, where: the six characters match ASCII-case-insensitively
(`@Kalsa`, `@kalsa`, `@KALSA` all count); the character before the `@`, if
there is one, is not alphanumeric in Unicode terms; and the character after
the final `a`, if there is one, is neither alphanumeric in Unicode terms
nor an underscore. So `"@kalsa, ciao"`, `"(@Kalsa)"` and `"@Kalsa's"` count;
`"email@kalsa.io"`, `"josé2@Kalsa"` and `"café@Kalsa"` (an alphanumeric
character sits before the `@`) and `"@Kalsabot"` (one sits after the word)
do not. Combining marks belong to the word they decorate: the rule skips
back over them to the base character before the `@` (so "café@Kalsa" is
not a call in either spelling of é — NFC one character, NFD base plus
U+0301), and a mark right after the word counts as part of it ("@Kalsa"
plus U+0301 is not the assistant's name). The rule in one sentence: a letter or digit hugging the token
means the `@` belongs to a word or an address, not to a call. Detection
runs on the raw text, before any processing, and the computer applies it
itself — the request's `call_ai` flag is the second way to call, not a
duty of the caller.

## 5b. Media — pictures and videos

Members post pictures and videos beside their words. THE SENDER'S DEVICE
COMPRESSES before anything is uploaded — a picture re-encoded to at most
1600 px on the long side and 4 MiB of JPEG, a video to roughly 720p
H.264 in an MP4 — and the computer never transcodes: it verifies what
arrived against what the upload declared, stores it, and serves the same
bytes to everyone.

- Kinds and mimes: `image/jpeg`, `image/png`, `image/webp`, `video/mp4`.
  Nothing else is stored. The computer checks the file's magic bytes
  against the mime on publish — and that the file is at least plausibly
  its kind (a JPEG under 125 B, a PNG under 67 B, a WebP under 30 B, an
  MP4 under 1 KiB, or a header the computer cannot read, is
  `400 media_bad_magic`).
- For an image, the computer reads the pixels from the file's own header
  (JPEG SOFn, PNG IHDR, WebP VP8X/VP8/VP8L) and records THOSE — the
  declared ones are advisory. A frame over 8192 on either side or over
  40 megapixels is refused whole: `400 media_too_many_pixels`. A video's
  pixels stay its sender's declared ones; the computer never opens a
  video's box tree.
- A video may carry up to 4 still frames its sender extracted and
  uploaded first (each an image of its own). The frames ride the video's
  descriptor; THE AI SEES VIDEO ONLY AS THOSE FRAMES.
- The shelf holds at most 10 000 published items, and every item —
  published or in flight — costs the 2 GiB quota at least 64 KiB,
  whatever its real size: a shelf of tiny files is a shelf of records,
  and the record is the cost. Both refusals are `413 room_media_full`.
- No filename, no path, no mime+filename pair exists anywhere in the
  protocol. A blob is named by an opaque `id` (32 lowercase hex).

### Uploading — `POST /kalsa/room/media`, `PUT /kalsa/room/media/{upload}/{index}`, `POST /kalsa/room/media/{upload}/complete`

Reserve, feed, publish — three calls, all under the room's usual bearer
and epoch rules, and the uploader of an upload is the only device that
may touch it (`403 media_not_yours` otherwise).

`POST /kalsa/room/media` — the reserve:

```json
{"kind": "image", "mime": "image/jpeg", "bytes": 183421,
 "sha256": "<64 lowercase hex>", "width": 1600, "height": 900,
 "duration_ms": null, "frames": null}
```

`kind` is `"image"` or `"video"`; `bytes` and the digest describe the
WHOLE file; `width`/`height` are the sender's own pixels (required,
1+); `duration_ms` only a video may carry; `frames` only a video, an
array of 0–4 image ids the same member published. The answer is
`{"upload": "<32 hex>"}`. Caps are checked here: an image over 4 MiB or
a video over 100 MiB is `413 too_large`; a room whose media shelf is at
its 2 GiB quota (published plus in-flight) is `413 room_media_full` —
nothing is ever deleted to make room.

`PUT /kalsa/room/media/{upload}/{index}` — the bytes, raw
(`application/octet-stream`), at most 4 MiB a chunk, at
`index * 4 MiB` in the file; every chunk but the last is exactly 4 MiB.
The answer is `{"received": <bytes so far>}`. Re-sending an index the
computer already holds is ANSWERED, not an error — the retry is
idempotent. A chunk past the cap is refused before its bytes are read.

`POST /kalsa/room/media/{upload}/complete` — no body. The computer
checks the bytes whole: every declared byte arrived
(`400 media_incomplete`), the digest matches (`400 media_bad_sha`), the
magic bytes are the mime (`400 media_bad_magic`) — and publishes,
answering with the blob's descriptor:

```json
{"id": "<32 hex>", "kind": "image", "mime": "image/jpeg",
 "bytes": 183421, "sha256": "<64 hex>", "width": 1600, "height": 900,
 "duration_ms": null, "frames": []}
```

(`duration_ms` and `frames` are absent on the wire when empty.) An
image's `width`/`height` in the answer are the file's own, read from its
header. The publish is idempotent: a repeated `complete` of the same
upload by its owner is answered with the same descriptor — the retry a
lost response owes — until the computer restarts, where an unknown
upload is simply sent again. A failed complete (bad digest, bad magic,
too many pixels) takes the upload with it and gives its quota back.

An upload the hour left unfinished is swept and its place in the quota
returned; the sender sends it again. An upload does not survive the
computer restarting — the same rule with a shorter fuse.

### Posting media

`POST /kalsa/room/messages` gains one optional field, `media`: an array
of 1–8 blob ids the poster published itself (`403 media_not_yours` for
anyone else's). The `text` may then be empty — the computer stores a
fallback text, `[Image]` or `[Video]`, so every reader (and a phone
from before this section) shows something; text that IS present rides
as written. The same `client_msg_id` with a different media list is
`409 client_msg_id_reused`, exactly as for different words.

### Downloading — `GET /kalsa/room/media/{id}`

The blob's bytes, `Content-Type` the stored mime, `Cache-Control:
private`, `Accept-Ranges: bytes`. A single `Range: bytes=a-b` (or
`bytes=a-`, or the suffix form `bytes=-n`) is answered `206` with
`Content-Range`; a start past the end is `416` with
`Content-Range: bytes */<len>`; anything else in the header — other
units, several ranges, a malformed line — is ignored and the whole blob
is served (`200`): a multipart answer is a promise this route does not
make.

WHO MAY READ: any active member, and a blob only where the transcript
entry that posted it is one the caller may see — the entry's `seq` at
or after the caller's join floor (§2). An unreferenced blob —
published, not yet posted — only its uploader may read. A member the
owner removed (§2) has lost the room; if it is still paired it is a NEW
member whose floor is now, and the past's pictures are as invisible to
it as the past's words. Refusals: `404 media_not_found` (no such blob
here), `403 media_forbidden` (not yours to see).

### Clearing the shelf — the host only

The host may clear the shelf from the computer itself: every blob and
in-flight upload is deleted, the quota starts from zero, and the
transcript is untouched — its media descriptors stay, and a download of
a cleared blob answers `404 media_not_found` from that moment. There is
no phone route for this, and no code exists on the wire for asking.
Phones learn of it through one unnumbered `media_cleared` event on the
stream:

```
event: media_cleared
data: {}
```

The event carries nothing else — no count, no ids — and a download that
404s says the same thing to anyone who missed it.

### The AI and media

When the computer calls the AI, it asks the engine's `/props` — once
per turn, never cached. When the engine's `modalities.vision` is
exactly `true`, the room's pictures ride on that turn: each member
message's parts carry its images (a video's frames, at most 4) as
`image_url` data-URI parts, newest first, at most 8 images a turn,
each priced at 560 tokens out of the turn's budget — the same budget
§8's transcript shares. A blind engine sees the text alone, the
fallback word included; video never reaches the engine as video.

## 6. My name — `PUT /kalsa/room/name`

```json
{"name": "Marco"}
```

Answers `200` with `{"member_id": 3, "name": "Marco"}`. The name is
trimmed, then must be 1–40 UTF-8 bytes with no control characters and no
format, bidi or zero-width characters (the invisible Unicode ranges that
make two names look like one). "Kalsa" is refused in any casing — and the
computer folds the common lookalikes before comparing: fullwidth
characters count as their ASCII twins, every Unicode space counts as a
space with runs collapsed, and the comparison to "Kalsa" ignores spaces
entirely, so "Ｋａｌｓａ" and "K alsa" get nothing. A name may not mix Latin
letters with Cyrillic or Greek ones — the mix that makes "Kalsа" with a
Cyrillic а convincing; a name in one script, whatever script ("Nicolò",
"Анна", "Μαρία"), is fine. These rules catch the common lookalikes, not
every conceivable one. Any name another live member or the host already
wears is refused; comparisons happen after trimming and lowercasing, so
"MARCO" does not dodge "Marco". Two names that differ only in Unicode
composition (é as one character or as two) are different names in v1 — an
honest limit, said plainly. Setting the same name again changes nothing. A
rename broadcasts a `member` event (§7) and does not touch messages
already posted.

## 7. Ordering: the seq, the epoch, and the event stream

One transcript, one counter. Every transcript entry — a member's message
and the AI's finished answer alike — takes the next `seq`: from 1, strictly
increasing, never reused, no gaps — UNIQUE WITHIN AN EPOCH. A recovery
that drops bytes starts a new epoch (a fresh opaque value in `info` and on
every stream): the surviving prefix keeps its seqs, the entries after it
may reuse seqs a phone saw before the damage, and every `message` and
`ai_message` event carries the epoch it belongs to. A phone that cached a
different epoch sends it as a `Kalsa-Room-Epoch` request header and is
answered `409 epoch_changed` — drop the cache, refetch. The same header on
the response names the epoch the stream speaks. On a new epoch every live
member's history begins at the epoch's first surviving entry.

The `seq` a POST returns is the `seq` the stream carries. Posts are
ordered by the computer, in the order it accepted them.

### `GET /kalsa/room/events` — the live stream (SSE)

- `id:` is the entry's `seq`. An SSE client echoes it back as the
  `Last-Event-ID` header on reconnect, and the server replays every
  transcript entry after that `seq` — raised to the caller's join point if
  it sits below it — in order, without duplicates, then follows the tail
  live. The transcript is durable and never truncated in v1, so any `seq`
  the client last saw can be resumed from, however long the disconnect
  lasted. A `Last-Event-ID` above the newest seq is `400 bad_cursor` — it
  claims events that never happened.
- The first frame on every stream open is one `ai_status` snapshot of the
  turn state as the computer sees it now, before any replay: a phone
  connecting mid-answer knows a turn is running. In v1 the snapshot is
  always `idle` — there is no AI yet — but the frame is first from now
  on, so the mechanism is what R3 fills.
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
- `ai_status` — the visible turn state, after every change and once as
  the first frame of every stream: `state` is `idle` / `queued` /
  `thinking` / `answering` / `waiting` / `done` / `refused` /
  `cancelled` / `stopped`, plus the same `running`/`queue`/
  `you_pending` view as info, `note_code` and its English fallback `note`
  on the moves that owe one, and both `null` otherwise. Starting a call
  immediately publishes `thinking`, not `queued`; `queued` means a call
  is actually waiting. The state names emitted are `queued` when a call
  joins a line, `thinking` when a turn starts, `waiting` while it waits
  for a seat, `answering` when text begins, `done` on a complete answer,
  `refused` when it cannot start or answer, `cancelled` on withdrawal,
  and `stopped` when it ends early. `idle` is the opening snapshot when
  nothing is active. Names only, ever.
- `ai_delta` — `{"turn": <id>, "text": <chunk>}` while answering.
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
refused in the POST response (`ai_call: "refused"` plus the code), never
silently. One AI turn runs at a time and the turn order is visible to
everyone, names only. THE ORDER IS ARRIVAL: calls are served first-come,
first-served by the computer's own monotonic arrival stamp; whoever was
served least recently breaks only an exact tie (HOUSEHOLD-RULES.md
§5.2–5.4 carry the rules and their
visibility).

The guest takes its own engine seat at this computer, beside the
household — its own seat, never the host's private chat. A turn HOLDS its
seat from its first request until the turn ends; private chats use their
own seats and never share it. When every seat is busy the call does not
fail: it stays in the line with an `ai_status` `waiting` whose note says
the computer is busy — the turn begins when a seat comes back. On its
turn the guest spends at most a stated share (60%) of its slot's context
— the launch's `--ctx-size / --parallel`, tokens estimated at four bytes
each when no tokenizer is available — and the `read` count on the answer
says what that bought. A turn ends when its answer ends, when it is
withdrawn or stopped, or when the engine falls silent for 60 seconds — a
stall; a long, live answer is never cut, and the seat is held for all of
it. Only a content delta or the terminal `[DONE]` event resets that
silence clock; SSE comments, keep-alives and empty lines do not.

An engine HTTP 400 or 413 is treated as a too-large request: the room halves
the transcript it reads and retries. That response does not diagnose the
cause. If a request still cannot succeed after the room has reduced the
transcript as far as it can, the turn ends with `engine_problem`.

The line itself is memory: a computer that restarts forgets every pending
call, and nothing retroactive is announced on startup. What a phone
should show is the truth of its own screen — the `@Kalsa` message it
sent, delivered but unanswered — and, if it matters to the sender, a
fresh call after the restart. The host stopping a turn that is not
running changes nothing, publishes no event, and returns a refusal to the
host.

On its turn the guest receives the room transcript — ALL of it that fits
its context budget; no member's join floor binds the AI, because the room
it answers in is one room. Messages are formatted with display names and
preceded by a short system prompt; nothing is sent to the model while
people talk. When older messages do not fit, the OLDEST fall off and the
finished `ai_message` carries `"read": N` — how many of the room's
messages the answer was built on; N smaller than the room's length is the
room saying so. Reasoning is the computer's own channel: the desktop chat
shows it beside an answer, the room carries the answer alone, and no
reasoning token is streamed or stored. `ai_delta` chunks carry their turn
id so a phone can assemble one turn and discard stale partials; the
assembled deltas equal the `ai_message` text. A turn that dies mid-answer
— the model server stops, the stream truncates — is announced with an
`ai_status` `stopped` and its note, and NOTHING is stored for it: no half
answer ever enters history.

## 9. Sizes, errors, limits

| Thing | Limit | Refusal |
|---|---|---|
| message text | 1–8000 UTF-8 bytes | `413 too_large` (empty: `400`, or §5b's fallback when media ride) |
| request body | 16 KiB whole, any room route | `413 too_large`: the text may be legal and the escaped body not |
| media, one blob | image ≤4 MiB, video ≤100 MiB | `413 too_large`, at the reserve |
| media, one item's plausibility | JPEG ≥125 B, PNG ≥67 B, WebP ≥30 B, MP4 ≥1 KiB, header readable | `400 media_bad_magic`, at the publish |
| media, one image's frame | ≤8192 a side, ≤40 MP — the file's own header | `400 media_too_many_pixels`, at the publish |
| media, one room | 2 GiB quota (each item ≥64 KiB of it), 10 000 items | `413 room_media_full`: nothing is ever deleted to make room |
| media, one chunk | ≤4 MiB, raw bytes | `413 too_large`, refused before its bytes are read |
| media, one post | 1–8 blob ids, the poster's own uploads | `400 bad_request` (shape), `403 media_not_yours` (someone else's) |
| display name | §6 | `400` / `413` / `409 name_taken` |
| client_msg_id | 1–64 chars ASCII 0x21–0x7E | `400 bad_request` |
| client_msg_id reuse | same id, different content (words, flag or media) | `409 client_msg_id_reused` |
| a second call of one member | while one waits or runs | `ai_call: "refused"`, `refusal: "already_pending"` |
| nothing of yours to withdraw | `DELETE /kalsa/room/call` | `404 no_call` |
| history limit | 1–200 | `400 bad_request` |
| Last-Event-ID | at or below newest seq | `400 bad_cursor` |
| cached epoch | not the current epoch | `409 epoch_changed` |
| no room open | — | `503 no_room`: show "the room is not open on this computer" |
| damaged transcript | unrepaired | `503 read_only`: reads work, posts refuse; show the sentence, retry later |
| unknown room route | — | `404 not_found`: the phone is talking to something this computer does not serve |
| store failure | — | `500 internal`: show the sentence, nothing the phone can do |

Every error carries a stable machine `code` and its English fallback in
`message`; clients translate by code. The code table is:

| Code | English fallback |
|---|---|
| `bad_request` | The room reads a JSON body of the shape its route defines. |
| `too_large` | The message or name is too long. |
| `media_incomplete` | Not all of the upload has arrived yet. |
| `media_bad_sha` | The upload arrived damaged. Send it again. |
| `media_bad_magic` | That file is not the kind it said it was. |
| `media_too_many_pixels` | That image has too many pixels for this room. |
| `room_media_full` | This room's media shelf is full. |
| `media_not_found` | That media is not in this room. |
| `media_not_yours` | Only the device that uploaded media may attach it. |
| `media_forbidden` | You were not in the room when that was posted. |
| `client_msg_id_reused` | This message id was already used for different content. |
| `name_taken` | Someone in this room already uses that name. Pick another. |
| `name_reserved` | Kalsa is the assistant's name. Pick another. |
| `name_framing` | Names can't use [ or ]. |
| `name_mixed_scripts` | Use letters from one alphabet in your name. |
| `name_too_long` | That name is too long. Try a shorter one. |
| `no_call` | You have no question waiting. |
| `epoch_changed` | The room's transcript restarted; drop what was cached and read it again. |
| `no_room` | The room is not open on this computer. |
| `read_only` | The room cannot save messages right now. |
| `not_found` | The door does not serve that room route. |
| `bad_cursor` | The room resumes from a numeric Last-Event-ID. |
| `internal` | The room's store failed on disk. |

Error bodies (except the empty 401) use
`{"error": {"code": "...", "message": "<English fallback>"}}`;
`name_taken`, `client_msg_id_reused` and `epoch_changed` are 409;
`no_call`/`not_found`/`media_not_found` are 404,
`media_forbidden`/`media_not_yours` are 403,
`too_large`/`room_media_full` are 413,
`no_room`/`read_only` are 503, `internal` is 500, and the rest are 400.

The `ai_status` note codes and English fallbacks are:

| `note_code` | English fallback |
|---|---|
| `busy_waiting` | Kalsa is busy with another conversation. You keep your turn. |
| `unavailable` | Kalsa can't answer in this room right now. |
| `empty_answer` | Kalsa had no answer to that. |
| `could_not_start` | Kalsa couldn't start. Try again. |
| `engine_problem` | Kalsa ran into a problem on this computer and couldn't answer. Ask again. |

A damaged transcript is recovered, not fatal. The room reopens on the
longest intact run of entries; everything the damage held is gone from
history, and the damaged bytes are preserved whole beside the transcript
(`room-log.damaged-<time>.jsonl`, owner-only) for the owner to read. The
two newest copies are all that stay — the store prunes older ones after a
successful recovery — and any copy may be deleted by the owner whenever:
nothing reads them again. If even the recovery write fails, the room
serves reads and refuses posts until a restart repairs it. Members see a
room that continues from the last intact message — no client-facing event
exists for the recovery in v1; the room simply continues.

A host asleep or off is not an error: phones queue outgoing posts locally
and retry them, `client_msg_id` makes the retry idempotent, and on
reconnect `Last-Event-ID` + `history` + one `info` call resync the room.
No delivery while the host is down; nothing lost, nothing promised early.

## 10. Not in v1

Direct messages between members; voice messages and media beyond §5b's
four kinds; end-to-end
encryption beyond the transport (the host sees plaintext — a family room
on the family's own computer, said plainly); a second room on one
computer; typing indicators and read receipts; editing or deleting posted
messages or media; delivery while the host is off; retention limits (the
transcript and the media shelf grow unbounded in v1); calls and meetings.
