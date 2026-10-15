# The phone chat protocol — v1

The contract between a paired phone and the computer for the phone's **chat** with the
computer's AI (not the Room). The computer answers a phone turn with the same tools and the
same app-drawn cards as its own chat: the desktop WebView runs its own tool loop for the
phone's turn and streams the result back.

Owner decisions (2026-10-15): the computer's WebView runs the loop; every paired phone may
use the computer's mail; a reply is sent from the phone after the phone's own confirm, and
the computer sends only a draft it built itself.

## 1. Transport and auth

Same road, door and credential as `/v1/chat/completions` and the Room (ROOM-PROTOCOL.md §1):
`Authorization: Bearer <credential>`, `401` with an empty body on any refusal, JSON request
bodies, `text/event-stream` responses, snake_case fields, unknown fields ignored both ways.

Routes live under `/kalsa/chat/`:

| route | method | answer |
|---|---|---|
| `/kalsa/chat/turn` | POST | SSE stream (§3) |
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

One turn per device at a time: a second turn while the first runs is refused with
`error {code:"busy"}` and the first keeps going.

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
| `error` | `{"code":"…"}` | the turn failed; terminal |
| `done` | `{}` | the turn ended; terminal |

Exactly one terminal frame (`error` or `done`), then the computer closes the stream. If the
phone closes the stream first, the computer stops the turn.

Error codes: `busy`, `bad_request`, `no_runner` (the computer's window did not take the turn
within 10 s), `engine` (the model failed), `cancelled`, and the mail codes the desktop chat
shows (`mail.invalid_account`, `mail.keychain`, `mail.storage`, …). The phone shows its own
sentence per code and a generic one for an unknown code; the computer's words are not shown.

`gist` and the answer text are the model's; `from`, `subject` and `reasons` are the mail's.
Both are a stranger's words to the phone: plain text, never markup, never a link.

## 4. Open a mail

`POST /kalsa/chat/mail/read` with `{"id":"105"}` → `200 {"record": <MailRecord>, "body": "…"}`,
the same record and fence-free body the desktop's Mail tab shows. A failure is
`200 {"error":"<code>"}`. The id must be digits.

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
  `{"error":"busy"}`.

## 6. On the phone's disk

Cards and drafts are never persisted on the phone, like the desktop chat (whose store keeps a
count and nothing else): they are a stranger's words. Only the answer text is kept.
