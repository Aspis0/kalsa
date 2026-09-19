# What is missing, 2026-09-18

*Updated 2026-09-18, after an afternoon spent entirely on the first screen. One item
closed, six added, and §13's display half fixed while its measurement half stays open.
Each closure names the commit that closed it, so the claim can be checked instead of
believed.*

**Read §14 first.** It is the shortest and it outranks everything below it: a screen
that now names a model honestly has never been watched fetch one.

Written after the morning's measurements, by reading the code rather than the notes.
Ordered by what blocks the product, not by what is interesting.

## 1. There is one credential, for everybody — CLOSED

`crates/kalsa-door/src/lib.rs:127` holds exactly one:

```rust
    credential: [u8; TOKEN_BYTES],
```

So every paired phone presents the same secret. You cannot tell two devices apart,
you cannot revoke one without breaking all of them, and you cannot show the owner
who is connected. This is the item that turns the app from "mine" into "something I
can give to my family", and nothing in the code started it.

**Closed by `02a2139`** — `crates/kalsa-door/src/devices.rs` now holds one credential per
device, compared in constant time with no early exit, folded into a single branch so the
loop cannot leak *which* device matched through timing. The credential field is private,
`Debug` is not derived on anything holding one, and the whole thing was proven by mutation:
breaking the comparison leaves it compiling and turns the tests red.

What it unlocked is bigger than revocation: the door can now answer *who*, which is the
precondition for every multi-device surface — profiles, "busy with X", per-person turn
rotation, and the room.

## 2. Slots wrap instead of refusing — silently

At the tag we ship (b10950), `tools/server/server-context.cpp:1521`:

```cpp
// note: allow id_slot to be out of bounds (wrap around)
id_slot = id_slot % slots.size();
```

With several devices, the fifth client of a four-slot server lands in slot 0 —
the same slot as the first. No error anywhere: the two people simply evict each
other's prompt cache and each sees the other's context vanish. Any multi-device work
has to own the mapping from device to slot and refuse when there is no room, because
the server will not refuse for us.

**Still open, but no longer only on paper.** It is now the acceptance criterion of the
multi-device measurement running tonight: one conversation's tokens must never appear in
another's, tested with a marker string and a tokenized shared-prefix length rather than by
reading upstream's intentions. See `HOUSEHOLD-RULES.md` §1.

## 3. The compute-buffer budget on a large dense model — CLOSED

The morning's first item was the 512 MiB budget on a large dense model. Today's
numbers came from Trinity, and Trinity flatters us: it is a sliding-window model.

```
llama_kv_cache: size = 119.00 MiB (16384 cells, 14 layers)
llama_kv_cache_iswa: SWA, size = 2560 cells → 55.78 MiB (2560 cells, 42 layers)
```

**14 layers of 56** hold the full window; the other 42 stay at 2560 cells no matter
how big the context gets. A dense model has no sliding window — every layer is a
full-window layer. Reading today's 175 MiB at 16k as if it were a constant would
under-predict a dense row by something like four times. The measurement is still
owed, and the whole "how much context can we offer per person" question sits on it.

**Closed by `8aefd76`, `e0652c7` and `31cc0d8`** (`COMPUTE-BUFFERS-DENSE.md`). Gemma 4 12B —
a real dense row, 48 layers, no sliding window — was downloaded, pinned by sha256, and
measured. The 512 MiB budget holds at ubatch 512 with 2.95x of margin and is breached at
2048 on the GPU buffer alone, so **ubatch is capped at 1024**, lower on smaller machines.

The finding that outlived the measurement: the per-token KV cost is **affine, not linear**.
A sliding-window model's cost per token falls as context grows, so no scalar constant can
carry it. `ASSUMED_KV_BYTES_PER_TOKEN` is a fixture for the tests, never a predictor.

## 4. iroh on the mobile network

Tailscale is now measured on the SIM (see `BRIDGE-ON-THE-MOBILE-NETWORK.md`): direct
every time, median 55 ms, never a relay. iroh — the transport we would actually ship,
because its relays can be ours — has never been on a mobile network.
`crates/kalsa-iroh/tests/roundtrip.rs` runs both endpoints in one process over
loopback with relays disabled, so it proves the tunnel and the door and nothing about
NAT. What is missing is a harness with two real endpoints on two real networks.

## 5. Nobody has decided what happens when the route dies mid-answer

Measured today: five unreachable stretches on the road, the longest about ten
seconds. Idle, that is invisible. Mid-stream, it is a half-written answer. There is no
resume, no reconnect policy, and no decision about whether the server keeps generating
into a cache while the phone is gone. The SSE ids are already in place
(`kalsa-door` numbers every event) — the mechanism exists, the policy does not.

## 6. The desktop chat and the desktop app are one program — CLOSED

The chat is now the kalsa-brain frontend. The four wizard panels became the four
surfaces in `chat/src/surfaces/`, and `src-tauri/tauri.conf.json` serves the generated
`chat/dist/` output. Its build commands run `npm run dev` and `npm run build` in `chat/`.

The old vanilla frontend and its two harnesses are removed. `dev/states-react.mjs` and
`dev/smoke-react.mjs` now render the 39 review states and enforce the copy rules.

## 7. Attachments: the browser half is being built, the native half is not

The extraction and the panel run in the page. The part that makes it the thing the
owner asked for — a file browser that shows *his* files rather than an upload list —
has to be Rust, because a web page cannot enumerate a disk. Started today as
`crates/kalsa-files`: the boundary first (canonicalize, then compare whole path
components against a few document folders), since a command that reads a path chosen
by the page is a capability handed to the least trustworthy part of the program.

**Written, not wired.** `crates/kalsa-files` exists and its tests pass, and it is called by
nothing: no Tauri command, no UI. That is this repo's recurring defect class — code that is
correct and never connected — and it stays on this list until a real click reaches it.

Being unwired also hid four real defects until someone read it hostilely (`1001ce1`, tests
8 → 23): a symlink was listed as an approved document, the boundary could not be called from
outside the crate, a derived `Debug` reopened the probing oracle `Display` closes by hand, and
the headline promise — never the home directory — had no assertion behind it at all. Passing
tests on unwired code say less than they look like they say.

## 8. The phone's conversations and the PC's are not the same conversations

The decision says the PC is the store of record and the phone a client with a cache.
There is no protocol. Not urgent while one person uses one device; it becomes the
whole product the moment §1 exists.

## 9. The upstream model router exists — and its admission policy is not ours

b10950 ships a real router (`tools/server/server-models.cpp`): a parent process, one child
server per model, `POST /models/load`, LRU unloading. Changing model in a household does not
have to mean killing everything, which is better news than the design assumed.

But `common/common.h:686`:

```cpp
    int models_max = 4;                 // maximum number of models to load simultaneously
```

It counts models. It does not weigh them. Four Gemma 4 12B children is 28 GB of weights on a
16 GB machine and the router will allow it, because nothing in it knows what a model costs.
Our catalog does know — it carries the bytes. Admission stays with us; the router is a
mechanism we drive, never a policy we inherit. Nothing of this is wired yet.

## 10. The room is designed and not built

`HOUSEHOLD-RULES.md` §4–§5: a shared conversation with the AI inside it, one turn at a time
because a shared history generated concurrently stops being reproducible, ordered by rotation
between people with at most one pending prompt each, ties to whoever waited longest, and the
turn order shown to everyone. The AI hears the whole room and pays at the moment it is
addressed, so nothing is prefilled for chatter.

None of it exists in code. What it needs first is §1 (done) and a queue that is ours
(the addendum below).

## 11. Two numbers — one taken, one now unblocked

- **The cost of a switch — TAKEN, and it depends on size** (`dev/results/multi-device-shape/SWITCH-A/results.json`,
  committed `85a7b75`). Alternating between two conversations on one slot is free only while
  both fit the 384 MiB prompt cache. At ~1.9k tokens the return costs **0.15 s** and
  `cached_tokens` stays at 1862. At ~7.5k it costs **4.51 s** and at ~14.7k **9.62 s**, both
  with `cached_tokens` **0** — the second conversation evicts the first, and coming back pays
  the whole prefill again.
  So rotation-per-turn is the right policy for short exchanges and the wrong one for
  documents: past roughly 2k tokens per person, a turn policy must serve several prompts from
  one conversation before yielding. Note this is conversation switching on ONE model; changing
  the model is the other thing entirely and kills every slot and cache in the house.
- **The cost of self-summarisation.** Seconds for the big model to write a ~200-token summary
  of ~4k tokens of room history, which is what decides whether the window problem needs a
  second small model at all (`HOUSEHOLD-RULES.md` §6). It was blocked while the GPU was busy
  with the multi-device measurement; that measurement is done (`d6daf16`, `85a7b75`), so
  nothing blocks it now except someone taking it.

## 12. The brain's own screen — the two missing fields are CLOSED, the pairing behind it is not

`docs/THE-BRAIN-IS-THE-HOME.md` puts the brain on the home surface: which model is loaded,
whether it is warm, how many of the four seats are taken and by whom. Almost everything that
screen needs is already in the Rust and half of it is shown to nobody — state with the failure
already phrased in human words, decode tokens/s, `throttled`, context and its maximum, idle
unload, paired devices. Two fields are missing, and they are the two the screen rests on:

- **The model has no name.** `main.rs` `ModelDto` is `{ chosen: bool }`. The startup path
  carries `bytes` and `sha256` through `acquire_model`; nothing in the shipped state answers
  "which model is this".
- **The seats cannot be counted.** `metrics.rs` `RuntimeMetricsDto` has
  `phone_connected: Option<bool>` — one yes/no for the whole house. The screen needs how many
  of the four are busy and which one is yours, and §1's per-device credential (`02a2139`) is
  what makes "whose" answerable at all.

And a third thing blocks the screen harder than either, discovered while mapping the first
two: **pairing is not a storage limit, it is a product model.** `PairingDto` is singular —
`phone: Option<String>`, *"the phone this computer works with"* — and its second field is
`new_phone`, *"the phone asking to take over"*. The commands are `brain_pairing_replace` and
`brain_pairing_keep`, and the button reads *"Use the new phone"*. So a second phone today is
not a second member of the house: it is a conflict, and the app asks which of the two to
keep. `main.rs` builds exactly one `DeviceEntry` with the fixed label `"Paired phone"`,
commented *"the label is the app's until the store learns to hold more"*.

The engine has four seats — measured, `MULTI-DEVICE-SHAPE.md` — and the pairing is still a
monogamy. Until that changes, the home screen can honestly draw **one** occupied seat, not
four, and the interesting question the measurement raises (what happens to the fifth person,
whom the engine refuses outright with HTTP 400) cannot even be asked. Note the direction of
the gap: the documents are ahead of the code here, not behind it.

**Both fields closed, 2026-09-18.** The model's name ships in the brain's own state
(`src-tauri/src/main.rs:470`, `model: Option<String>`, filled from
`brain.model_dto().display_name`), and the seats are countable — `active_devices()`
returns a list, not the old single `phone_connected` yes/no. The screen is drawn: it
names the machine, what it would run, how fast, and at what conversation length, and it
does it with no phone paired at all (`79e391c`, `e162187`, `dc0979c`, `b361eb6`).

What is NOT closed is the rest of this section, and it is the larger half. The pairing
is still a monogamy, so the screen can still honestly draw one seat and not four.

**Decided 2026-09-17, and it reorders the work.** The desktop chat will reach the model
*through the door*, like the phones, rather than talking to `127.0.0.1` directly — one place
that knows who is speaking, instead of two counters that must agree. Which means the PC is a
device of the household, so pairing must hold several devices first: the decisions are one
job, in that order. And **installing Kalsa desktop registers the PC as the first device
automatically** — no QR for the machine the server runs on, so the house is never empty and
"four seats, one of them yours" is true from first launch.

Two things to get right while doing it, both easy to get silently wrong:

- **Where the PC's own credential lives.** On disk, on the same machine. That adds no local
  risk — whoever reaches the computer already reaches the model. But with the internet road
  on, it is a remote access key: restrictive permissions, and never in a log, an error
  string, or a backup. `dd4a12d` made that a test for prompts; this is the same rule for a
  new file.
- **What label the PC gets.** The hostname is what the owner recognises, and on a Mac it
  usually contains their own name. Labels now cross into the page (`c7a4e88`). Fine inside
  one house, but it should be chosen knowingly; "This computer" is the neutral answer.

This is the same gap §1 left open — *the door knows who, but it does not tell anyone yet* —
arriving from the other side. It stops being an improvement to the queue and becomes the
substance of the first screen: anything built before it shows seats it is guessing at, which
is worse than showing none.

## 13. A measured decode overrides the prediction, and one of the two was not measured where the app lives

`crates/kalsa-catalog/src/candidate.rs:121` gives a measured rate priority over every
prediction when the backend matches:

```rust
    Some(measured) if measured.backend == input.backend => Prediction::Measured {
```

So on any Metal machine -- the development Mac included -- the figure in the row is not an
estimate the reader can discount. It is stated as fact, and it carries the machine string
with it, which is the whole point of `MeasuredDecode`: *"a rate is a fact about one machine,
never a property of the model"* (`manifest.rs:64-68`).

Two rows carry one today, and their conditions do not match:

    Trinity   62.7  tok/s   ... context 4096, 2026-09-14
    Gemma     20.44 tok/s   ... context 512,  2026-09-17

Decode slows as the cache grows, and the chooser funds at least 4096 (`manifest.rs:722`).
Trinity was measured where the app runs. Gemma's 512 is a best case the owner will never
see, stated as a fact, in the same column, inviting a comparison neither number supports.

There is also a chance the label is simply wrong: `31cc0d8`'s message measures compute
buffers at **ubatch** 512 and contexts up to 16k, never at context 512. Whether the run was
done at a context nobody uses, or done properly and described with the wrong word, cannot be
settled by reading -- only by measuring again.

**Half of this moved, 2026-09-18.** The card no longer invites the comparison blind: a
measured rate keeps its figure but names its machine, its full provenance sits in the
working under it, and every predicted speed is now priced at a context the row can
actually hold — `min(8192, what the machine funds)`, itself capped at what the model was
trained for (`dc0979c`). So the two numbers no longer sit in one column pretending to
share conditions.

The half that did not move is the one that needs a GPU: Gemma's *"context 512"* is still
either a run nobody uses or a run described with the wrong word, and only measuring again
settles it.

Not urgent: the owner has said the catalog does not matter yet. It matters the moment a
second machine reads these numbers, because that is the point at which a figure without its
conditions becomes a promise the product cannot keep. `fa498bf` is the last time a number
outlived its baseline here, and it had to be retired from three documents.


## 14. The first screen is honest about a journey nobody has taken

An afternoon went into what the screen *says*. Nothing went into whether what it says
can be done. Two rows were added to the catalog — Gemma 4 E4B and Gemma 4 26B-A4B, the
second a 14.4 GB QAT download — and both were verified the only way a desk can verify
them: the pinned commit, the byte count and the sha256 answer 200 from the live API, and
the architecture is present in llama.cpp b10950. **Neither has ever been downloaded or
launched.** A first screen that offers a model the app cannot actually fetch is worse
than one that offers nothing, because it is wrong at the moment the owner trusts it.

This outranks every item above it that is not already closed. The walk exists, it is
phone-free (`startup.rs:choose_model` calls `largest_that_runs_well` when `phone` is
`None`), and it has not been run end to end against today's catalog.

## 15. The measurement lives only in memory

`src-tauri/src/main.rs:57` — `measurement: Mutex<Option<Measurement>>`. Nothing writes it
down, so every launch re-measures a machine that has not changed, for about ten seconds,
before the first screen can say anything. It also means the probe's own verdict — the
notes about a busy or unoptimised machine — cannot be compared across runs, which is
exactly what would have revealed the debug-build defect in a day instead of a week.

What it needs is not a cache but a record: the figures, the build's optimisation level,
the backend, and the date, so a stale one can be recognised rather than trusted.

## 16. The second option plays by weaker rules than the first

`crates/kalsa-catalog/src/choice.rs` — `quicker_alternative` filters on fit and floor and
nothing else. No `capability_basis`, no `expected_but_unmeasured`, no `SAME_CLASS_BAND`,
no phone. So the row it offers beside the pick can be one the chooser's own walk would
refuse, and on a machine where that row is the largest that fits, the product refuses
outright while the card offers it as a second option. Confirmed by audit, reproduced on a
16 GiB Metal machine with a wall-powered phone.

It ships because two honest options beat one, and the speed gate it does apply is real.
What it owes is the justification the walk applies, or a stated reason why a second
option is held to a lower bar than a first.

## 17. Small things the audits confirmed and nobody has fixed

Each was reproduced, none is load-bearing, all are cheap:

- The two content security policies did not agree, and the webview enforces their
  intersection. `chat/index.html` claimed `connect-src 'self' http: https: ws: wss:` — any
  origin, any scheme — while `app.security.csp` in `src-tauri/tauri.conf.json` had no
  `connect-src` at all and so fell back to `default-src 'self'`. `'self'` is
  `tauri://localhost`, so all three frontend fetches in `chat/src/lib/chat.ts` were blocked
  in a built binary, the chat completion included; the server was answering the whole time
  (verified by curl: 200, `Access-Control-Allow-Origin: tauri://localhost`). No test could
  see it, because node and Playwright talk to the server without passing through a webview.
  Fixed: both policies now name the same local-only list (`'self'`, `ipc:`, the
  two loopback hosts), and `chat/scripts/csp-consistency.mjs` fails if they drift, if either
  one stops admitting the local server, or if either is widened back to a scheme-wide
  source. No websocket was in use, so `ws:`/`wss:` are gone.
- `chat/scripts/shots.mjs` waits for the chat's empty state as the landing view. Since
  the brain became the home it never appears, so the harness times out. Broken before
  2026-09-18's work and unrelated to it.
- The contract test writes `chat/scripts/capability-contract.json` and asserts nothing:
  drift shows up as a dirty tree, never as a red suite.
- A `trained_context_tokens` of `Some(0)` would be reported as *"not enough memory"*,
  blaming the machine for a header we parsed wrong.
- `soc.rs` would answer `"Apple M4 Ultra"` with the bare M4's 120 GB/s — 6.8x short.
  M4 is the one family with no Ultra row. No such chip has shipped.
- Under StrictMode a second `brain_progress` listener is registered and never
  unsubscribed. Dev builds only.

## Not missing, deliberately

Retrieval and embeddings on the PC (measured: full context is cheaper than a
download — `DESKTOP-FEATURES-ALREADY-OURS.md` §7). A catalog gate threshold (the
owner holds that number). Model-authored HTML without isolation (six critical CVEs
say do not, §8 of the same doc).

---

## Addendum: yes there is a queue, and it is the wrong one

Asked by the owner, 2026-09-17: what happens when two people prompt at the same time,
and could the app show that the AI is currently busy with a named person.

Read in the server we ship (b10950, `tools/server/`), not assumed:

```cpp
// server-context.cpp:2389
// if no slot is available, we defer this task for processing later
queue_tasks.defer(std::move(task));
```

```cpp
// server-queue.h:25
    std::deque<server_task> queue_tasks_deferred;
```

So a request that finds every slot busy is **deferred, not refused**, and when a slot
frees exactly one deferred task is popped — FIFO, except a task that asked for the slot
that just freed jumps ahead (`server-queue.cpp:90-108`).

Two properties of that queue decide the design:

1. **It is unbounded.** Nothing in the code caps the deque. Ten phones against a
   one-slot server means ten held HTTP connections and a tenth person waiting behind
   nine complete answers, with no error and no notice. On a phone that is
   indistinguishable from a broken app.
2. **It is silent.** Nothing on the wire tells a waiting client that it is waiting, or
   where it is in the line. The only observability is Prometheus text on `/metrics`:
   `requests_processing` and `requests_deferred` (`server-task.cpp:1578-1584`) — two
   global counters with no identity attached.

**Therefore the queue has to be ours.** The door is the only component that sees every
request and — once one credential per device exists — knows *who* is asking. That makes
the owner's two ideas the same mechanism:

- the door admits as many concurrent requests as the server has slots, and holds the
  rest in a **bounded** queue of its own, refusing with a real answer when it is full
  instead of hanging;
- because it knows the device, it can say *"busy with Marco, you are next"* instead of
  showing a spinner that means nothing.

Constraints this must respect, all already measured:
- `id_slot` out of range is **not** refused, it wraps (`server-context.cpp:1521`). If
  the door assigns slots it must never emit an out-of-range one, because the server
  will silently put two people in the same slot.
- Slot count is not a trade-off any more, it is settled: **one slot per person, or
  thrash.** Measured at four phones, warm reuse and median TTFT move together, and one
  slot plus our own queue loses on both at once -- it is the slowest shape *and* the one
  where reuse is not merely worse but zero, twelve of twelve requests reprefilled:

  | four phones | warm reuse | median TTFT | total KV |
  |---|---:|---:|---:|
  | one slot + our queue | 0.00 | 4.99 s | 174.8 MiB |
  | two slots, fewer than users | 0.12 | 3.47 s | 230.6 MiB |
  | auto (unified KV) | 0.73 | 2.54 s | 308.7 MiB |
  | four slots, one each | 0.97 | 0.64 s | 342.1 MiB |

  Oversubscription does not degrade reuse, it collapses it: two slots for four people
  score 0.12, barely better than having one. The **21x** figure was real but answered a
  different question -- it compared `--parallel 1` against *auto* slots with unified KV.
  Explicit `--parallel N` is a third configuration nobody had run, and it beats both.
- The binding constraint is the context floor, not the queue. Slots divide the context
  and a request over its slot's share is **refused with HTTP 400, not truncated**: at
  `-c 16384` with four slots, a 3 878-token conversation runs warm and a 4 225-token one
  never starts. The SWA half of the KV replicates per slot (42 layers: 55.78 MiB at one
  slot, 223.12 MiB at four) while the 14 dense layers divide. So 16k on this Mac *is*
  four people, and the door's job is to refuse the fifth -- admission, not queueing.
- A profile is a human label on a device credential, so it costs almost nothing once
  per-device credentials exist. But "busy with X" is itself a disclosure: it may show a
  **name**, never the prompt, never the content, and the active label needs a timeout
  so a device that vanished mid-stream does not hold it forever.
