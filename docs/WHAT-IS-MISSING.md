# What is missing, 2026-09-20

*Updated 2026-09-20, after an afternoon spent re-reading this list against the code
instead of adding to it. §7 closed for real; §12, §13 and §17 were corrected; and
four sections were added (§18–§21). Two other reversals are the reason for the
re-read: §5's whole premise and the addendum's conclusion had both been built while
this list said they did not exist. Each claim names the commit or the `file:line`
that backs it, so it can be checked instead of believed.*

The reversals deserve saying plainly, because they are the interesting part. The
door has had its own bounded, refusing queue and a resume policy for a route that
dies mid-answer since 2026-09-16 (`29b63d0`, `2f3c5ac`) — this list was updated on
the 18th and still said neither existed. The code was ahead of its own defect list
in both cases, and no audit found it; only re-reading did. A plan that is not
re-read against the code starts describing a program that no longer exists. The
list can become false by omission while every sentence in it still sounds plausible.

**Read §14 first.** A first screen that offers a model the app has never fetched is
wrong at the exact moment the owner first trusts it, and nothing else on this list
is wrong at a moment that matters that much.

**Then read §4 and the unbuilt half of §12 as one item.** The phone join is the
product's whole premise, and its two halves have never met: the desktop side is
built and tested in isolation, the phone app lives on `origin/main` with no shared
history with this repository, and no QR has ever been scanned end to end.

**Then §2**, which blocks any multi-device work, because the server we ship will
not refuse for us.

Everything else follows those. Written by reading the code rather than the notes.
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
other's prompt cache and each sees the other's context vanish. There is no `id_slot`
anywhere in our code. Any multi-device work has to own the mapping from device to
slot and refuse when there is no room, because the server will not refuse for us.

**Still open, but no longer only on paper.** It was the acceptance criterion of the
multi-device measurement (done, `d6daf16`, `85a7b75`): one conversation's tokens
must never appear in another's, tested with a marker string and a tokenized
shared-prefix length rather than by reading upstream's intentions. See
`HOUSEHOLD-RULES.md` §1.

One warning for whoever greps this file for roofs: the door caps its own held
answers at `MAX_JOBS` 64 (`crates/kalsa-door/src/lib.rs:86`), and that is a
different thing — a roof on the jobs the door keeps, not a mapping from device to
slot. It refuses a sixty-fifth answer; it never refuses a fifth person, because
nothing in our code has decided who a fifth person is.

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
loopback with relays disabled (`:92`), so it proves the tunnel and the door and
nothing about NAT. Even the `#[ignore]`d test that dials the real n0 lookup and
relay infrastructure (`:160`) still runs both endpoints in one process — it
pretends the internet, it does not cross one. What is missing is a harness with two
real endpoints on two real networks.

## 5. What happens when the route dies mid-answer — the door decided, and this list did not notice

The road measurement that opened this section still stands: five unreachable
stretches, the longest about ten seconds. Idle, that is invisible. Mid-stream, it
is a half-written answer. What the section then said — *no resume, no reconnect
policy, no decision* — was no longer true when it was written. `2f3c5ac`
(2026-09-16, "an answer belongs to the job, not to the socket") built the policy
while this list, updated on the 18th, still said there was none.

What the door does now is concrete. A request carrying `Last-Event-ID` never reaches
the upstream; it is answered out of the door's own record of the job it names
(`crates/kalsa-door/src/proxy.rs:100`). Generation is independent of attachment:
"If that client dies the thread does not: an answer keeps being made whether or not
anybody listens" (`crates/kalsa-door/src/stream.rs:5-7`). The decision this section
demanded — whether the server keeps generating into a cache while the phone is gone
— was made when that thread stopped dying with its socket.

Whether a client may rejoin is `resume_decision`
(`crates/kalsa-door/src/jobs.rs:201`). A job already fully seen is refused rather
than re-served as an empty stream; the comment gives the reason: "an empty 200
promises an end that never comes." Resume is owner-checked too. Another device's
valid credential is refused with the same words as a lost job, so the device that may
not resume "learns nothing about whether it exists" (`jobs.rs:203-206`). A finished
answer stays resumable for ten minutes (`JOB_RETENTION`,
`crates/kalsa-door/src/lib.rs:82`; its comment is at `:80-81`): "A phone may be
away for minutes; it is not away forever."

What is still open is narrower than what stood here before, and it is two things.
The desktop chat does not reach the model through the door — it talks to the
loopback server directly, and moving it behind the door is half of the decision
recorded in §12, still unbuilt — so the resume policy covers the phones and not
the desktop's own stream. And nothing on the phone side has ever been exercised
against a real dropped route: the policy has met tests in one process, not the
road.

## 6. The desktop chat and the desktop app are one program — CLOSED

The chat is now the kalsa-brain frontend. The four wizard panels became the four
surfaces in `chat/src/surfaces/`, and `src-tauri/tauri.conf.json` serves the generated
`chat/dist/` output. Its build commands run `npm run dev` and `npm run build` in `chat/`.

The old vanilla frontend and its two harnesses are removed. `dev/states-react.mjs` and
`dev/smoke-react.mjs` now render the 39 review states and enforce the copy rules.

## 7. Attachments: the browser half was being built, the native half was not — CLOSED

Closed by `485aa48` (the engine wired) and `0197a1f` (the panel). Four commands
exist and are registered in the handler list at `src-tauri/src/main.rs:906-909`:
`brain_files_roots` (`src-tauri/src/files.rs:60`), `brain_files_list` (`:83`),
`brain_files_read` (`:100`), `brain_files_search` (`:247`). The page calls them
from `chat/src/lib/files.ts:66,70,76,83` and listens to the search event at
`chat/src/components/FilesBrowser.tsx:72`. A real click reaches the engine, and
what it shows is the owner's own disk, not an upload list.

This section was the repo's named example of its own recurring defect — *code that
is correct and never connected* — and the closure is held by a test written in
those words. `the_file_commands_are_reachable_and_registered`
(`src-tauri/src/files.rs:352`) reads the handler list out of `main.rs`'s source,
because a command missing from `generate_handler!` "is dead to the page and
nothing else would notice" (`files.rs:346-350`). Its failure message is the phrase
itself — "correct code, connected to nothing" (`files.rs:367-370`) — and it catches
a command the page asks for that the binary never registered.

The boundary this section described — canonicalize, then compare whole path
components against a few document folders — does not exist any more at all. The
owner removed it on the record: *"togli qualsiasi protezione. Stiamo parlando di
modelli locali. La protezione è solo ad uscire, e in futuro un sandbox se fa
coding."* `crates/kalsa-files/src/lib.rs:12` now reads: **"The whole filesystem is
in scope."** The guarded direction is the one that LEAVES the machine, and that
guard is new since this section was written — what it does not cover is §19 below.

(The lesson stays on the record, because it cost a hostile reading to learn: being
unwired hid four real defects until someone read the crate that way — `1001ce1`,
tests 8 → 23 — and passing tests on unwired code said less than they looked like
they said.)

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
mechanism we drive, never a policy we inherit. Nothing of this is wired yet: nothing
of ours calls `/models/load` or passes `--models-dir`, and we launch one child with
`--parallel 1` (`crates/kalsa-launch/src/argv.rs:84`).

## 10. The room is designed and not built

`HOUSEHOLD-RULES.md` §4–§5: a shared conversation with the AI inside it, one turn at a time
because a shared history generated concurrently stops being reproducible, ordered by rotation
between people with at most one pending prompt each, ties to whoever waited longest, and the
turn order shown to everyone. The AI hears the whole room and pays at the moment it is
addressed, so nothing is prefilled for chatter.

None of it exists in code. What it needs first is §1 (done) and a queue that is
ours — the addendum below: the queue now exists and refuses, but the sentences it
owes a waiting device do not.

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

## 12. The brain's own screen — the fields are CLOSED, the pairing moved, and the PC is still not a device

`docs/THE-BRAIN-IS-THE-HOME.md` sets the design intent: which model is loaded, whether it
is warm, how many of the four seats are taken and by whom. The two fields that first blocked
that screen are wired into state (`src-tauri/src/main.rs:545-553`), not merely declared.

**Both fields closed, 2026-09-18. The seats are not.** The model's name ships in the
brain's own state (`model: Option<String>` declared at `src-tauri/src/main.rs:500`,
assigned from `brain.model_dto().display_name` at `main.rs:546-550`), and `active_devices()`
returns a list the door keeps current: an authenticated request enters presence
(`crates/kalsa-door/src/proxy.rs:94`). The screen draws the machine, what it would run,
speed and context length, with no phone paired (`79e391c`, `e162187`, `dc0979c`, `b361eb6`).
It does not draw occupancy:
`ServerSurface.tsx:45-49` renders `{connectedText(deviceCount > 0)}` under the label
"Devices", and `useBrain.ts:233-234` says "Your phone is using this computer right now."
The first screen shows a boolean, not four seats; the open item is drawing them, not
reporting them. `THE-BRAIN-IS-THE-HOME.md:162-165` still has it open, and
its "today it does not" predates `proxy.rs:94`.

**The monogamy is gone too, found while re-reading on 2026-09-20.** The store holds
several devices (`crates/kalsa-pairing/src/store.rs:150`; production adds go through
`add_device_with_delivery` at `:302`, `load_devices` at `:593`) and the DTO carries the list
— `devices: Vec<PairedDeviceDto>` (`src-tauri/src/pairing.rs:141`) — beside the older
singular `phone: Option<String>` (`pairing.rs:138`).
`brain_pairing_replace` and `brain_pairing_keep` are gone, replaced by
`brain_pairing_forget_device` (`src-tauri/src/main.rs:856`) and `brain_pairing_forget`
(`main.rs:867`): a second phone is no longer a conflict to settle; it can be dismissed one
at a time. `ModelDto`
is no longer only `{ chosen: bool }` — `chosen` is still there at `main.rs:637`, beside
`display_name` and `reason` (`main.rs:636-640`) — and `phone_connected: Option<bool>` is
gone in favour of `active_devices: Option<Vec<ActiveDeviceDto>>`
(`src-tauri/src/metrics.rs:45`). The
old monogamy is history; it stays in this record because its replacement is still
half-true in the code.

What is NOT closed is the decision this section recorded, still the larger half:
**the PC does not register itself as a device.** Outside the store's own tests, the only
caller of the add path is the phone ceremony (`src-tauri/src/pairing.rs:418`). Every device
arrived by QR; the machine running the server walked in nowhere. So the screen draws no
seats at all — one boolean, not four — even though the door reports authenticated presence
(`proxy.rs:94`); `DevicesSurface.tsx:211-214` lists who is *paired*, not who is busy.
Installing Kalsa desktop still leaves the house empty until a phone pairs — the exact
opposite of what was decided.

**Decided 2026-09-17, and it reorders the work.** The desktop chat will reach the model
*through the door*, like the phones, not `127.0.0.1` directly — one place that knows who is
speaking, instead of two counters that must agree. So the PC is a device of the household,
and pairing must hold several devices first: one job, in that order. The first half has
happened — the store holds several devices, and the page can list them — and it was the
easy half. **Installing Kalsa desktop registers the PC as the first device automatically** —
no QR for the machine the server runs on, so the house is never empty and "four seats, one
of them yours" is true from first launch — is still entirely unbuilt, and so is the desktop
chat's road through the door.

Two things to get right while doing it, both easy to get silently wrong:

- **Where the PC's own credential lives.** On disk, on the same machine. That adds no local
  risk — whoever reaches the computer already reaches the model. But with the internet road
  on, it is a remote access key: restrictive permissions, and never in a log, an error
  string, or a backup. `dd4a12d` made that a test for prompts; this is the same rule for a
  new file.
- **What label the PC gets.** The hostname is what the owner recognises, and on a Mac it
  usually contains their own name. Labels now cross into the page (`c7a4e88`). Fine inside
  one house, but it should be chosen knowingly; "This computer" is the neutral answer.

This is §1's gap arriving from the other side. The door knows *who* and now says so
(`pairing.rs:141`, `metrics.rs:45`) — but only phones have ever asked. Until the PC
joins, the first screen's promise of a seat that is the owner's rests on a device the
code has never created, which is worse than showing none.

## 13. A measured decode overrides the prediction, and one of the two was not measured where the app lives

`crates/kalsa-catalog/src/candidate.rs:151` gives a measured rate priority over every
prediction when the backend matches:

```rust
    Some(measured) if measured.backend == input.backend => Prediction::Measured {
```

So on any Metal machine -- the development Mac included -- the figure in the row is not an
estimate the reader can discount. It is stated as fact, and it carries the machine string
with it, which is the whole point of `MeasuredDecode`: *"a rate is a fact about one machine,
never a property of the model"* (`manifest.rs:63-68`).

Two rows carry one today, and their conditions do not match:

    Trinity   62.7  tok/s   ... context 4096, 2026-09-14
    Gemma     20.44 tok/s   ... context 512,  2026-09-17

Decode slows as the cache grows, and the chooser's context rule has changed since
this paragraph was written. It no longer claims that the chooser funds at least
4096: the Gemma row's own comment says that the old explanation was wrong because
"the chooser funds none of them" (`crates/kalsa-catalog/src/manifest.rs:856-861`).
The choice prices at its one-token context, while the page uses the funded context
capped at 8192 and at the model's trained length
(`src-tauri/src/capability.rs:68-78`; `crates/kalsa-launch/src/policy.rs:87-95`).
Trinity was measured where the app runs. Gemma's 512 is still a best-case figure
from the manifest, stated beside the row, inviting a comparison neither number
supports.

There is also a chance the label is simply wrong: `31cc0d8`'s message measures compute
buffers at **ubatch** 512 and contexts up to 16k, never at context 512. Whether the run was
done at a context nobody uses, or done properly and described with the wrong word, cannot be
settled by reading -- only by measuring again.

**Half of this moved, 2026-09-18.** The card no longer invites the comparison blind: a
measured rate keeps its figure but names its machine, its full provenance sits in the
working under it, and every predicted speed is now priced at a context the row can
actually hold — `min(8192, what the machine funds)`, itself capped at what the model was
trained for (`dc0979c`). The old `>= 4096` chooser claim corrected itself into this
funded-context rule, so the two numbers no longer sit in one column pretending to
share conditions.

**One thing the section did not know when it was written, found 2026-09-20:** the
machine measures its real decode every session and throws the answer away, as far as
prediction goes. `src-tauri/src/metrics.rs:112` records it —
`state.latest_decode = Some(tokens_per_second);` — and it reaches the page in the
DTO at `:135`, where the brain shows it. It never reaches `MeasuredDecode`: the
rows in the manifest are static, written by hand after a measured run, and nothing
feeds the runtime figure back into `candidate.rs`'s choice. So the app holds a
fresh, true, this-machine rate in memory at the exact moment it predicts a speed
from a table, and predicts from the table anyway.

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
launched.** The models directory holds Qwen3.6-35B-A3B, Trinity-Nano, gemma-4-12B-it
and stories260K, and nothing else. A first screen that offers a model the app cannot
actually fetch is worse than one that offers nothing, because it is wrong at the
moment the owner trusts it.

This outranks every item above it that is not already closed. The walk exists, it is
phone-free (`startup.rs:choose_model` calls `largest_that_runs_well` when `phone` is
`None`), and it has not been run end to end against today's catalog.

## 15. The measurement lives only in memory

`src-tauri/src/main.rs:61` — `measurement: Mutex<Option<Measurement>>`. Nothing writes it
down, so every launch re-measures a machine that has not changed, for about ten seconds,
before the first screen can say anything. It also means the probe's own verdict — the
notes about a busy or unoptimised machine — cannot be compared across runs, which is
exactly what would have revealed the debug-build defect in a day instead of a week.
The type is not even serialisable today: `Measurement` derives `Clone` and `Debug`
and nothing else (`crates/kalsa-probe/src/lib.rs:87`), so the record needs the
derives before it needs a file.

What it needs is not a cache but a record: the figures, the build's optimisation level,
the backend, and the date, so a stale one can be recognised rather than trusted.

## 16. The second option played by weaker rules than the first — CLOSED

`crates/kalsa-catalog/src/choice.rs` — `quicker_alternative` filtered on fit and floor and
nothing else: no `capability_basis`, no `expected_but_unmeasured`, no `SAME_CLASS_BAND`, no
phone. So the row it offered beside a pick could be one the chooser's own walk would refuse.
Confirmed by audit, reproduced on a 16 GiB Metal machine with a wall-powered phone: `choose`
picks Gemma 4 12B on capability, and the row beside it, Trinity Nano at 62.7 tok/s, earns none
of the three and would not be started.

The first telling of this called it "the product refuses outright while the card offers it as
a second option", and that shape was never reachable: the card builds its second option from
the prediction of the row it is showing (`decode.and_then`,
`src-tauri/src/capability.rs:271`), and a refusal carries no such row. What reached a screen
was the pick with an unjustified row beside it, which is what the test below covers.

Closed by the `justification` gate in `crates/kalsa-catalog/src/choice.rs` — uncommitted
at the time of writing, committed since as `6099684` — so the closure is checkable both
by hash and by name: four tests in `crates/kalsa-catalog/tests/selection.rs` are what
hold it. The rule is that the second option is held to the bar of the row it sits
beside, and there are only two bars because there are only two roads to a first
option:

- **A phone is paired.** The first option came from `choose`, which admits a candidate only
  with a justification — `capability_basis`, else `expected_but_unmeasured`, else the
  battery-powered `SAME_CLASS_BAND` relief. The second option must clear the same gate.
- **No phone.** The first option came from `largest_that_runs_well`, which applies no
  justification at all, because no comparison was made. The second option applies none either:
  demanding one of it would be this same bug from the other side, a row held to a standard its
  neighbour never faced.

One road applies the gate and the other does not, which is the point rather than a gap. The
three-branch decision lives in one function, `justification`, and the road a paired phone takes
applies it to both rows: `choose` to every candidate it walks, and `quicker_alternative` to the
row beside the pick, which it asks only `if input.phone` is `Some`. The phone-free road asks
neither row to justify itself and never calls the function at all. `choose` needs the value it
answers with, so the function answers the `Justification` and not a bool. The speed rule is
unchanged: the most model that still decodes `QUICK_SPEED_ADVANTAGE` times faster than the row
on the page, compared at its pessimistic end.

The audit's machine is the test that matters,
`a_pick_is_not_offered_a_second_option_that_earns_nothing`: 16 GiB of unified memory at
120 GB/s and a 4B phone on the wall socket, where the walk succeeds and picks Gemma 4 12B on
capability. Trinity Nano is the only fitting row clearing the speed bar (62.7 tok/s against
the pick's 20.4), and it earns nothing — 6B of mixture is below the size an expectation is
credited at, publishes no dense equivalence, and a wall socket justifies no relief — so it is
no longer offered. The test asserts those three branches, not only the answer, and the phone's
battery flag is what decides the third: on battery the row is legitimate relief and there is
no defect.

The refusal-shaped case is kept as a property of the helper rather than a screen,
`a_refused_machine_offers_no_second_option_either` — a refusal never shows a second option, so
it asserts only that asking beside one answers nothing. Two tests then hold the rule from both
sides: `without_a_phone_the_second_option_keeps_the_only_bar_there_is` still offers the same
row with nothing paired, and `a_phone_on_battery_still_earns_the_quicker_row_its_place` offers
it when the phone is on battery, on the relief the walk itself would grant.

## 17. Small things the audits confirmed — five of six fixed, the sixth narrower than it looked

Each was reproduced against the code, none was load-bearing, all were cheap. Between
the last update and this one, five of the six were fixed. The sixth turned out to be
narrower than the audit made it look.

- The two content security policies did not agree, and the webview enforces their
  intersection. `chat/index.html` claimed `connect-src 'self' http: https: ws: wss:` — any
  origin, any scheme — while `app.security.csp` in `src-tauri/tauri.conf.json` had no
  `connect-src` at all and so fell back to `default-src 'self'`. `'self'` is
  `tauri://localhost`, so all three frontend fetches in `chat/src/lib/chat.ts` were blocked
  in a built binary, the chat completion included; the server was answering the whole time
  (verified by curl: 200, `Access-Control-Allow-Origin: tauri://localhost`). No test could
  see it, because node and Playwright talk to the server without passing through a webview.
  **Fixed.** Both policies now name the identical local-only list — `chat/index.html:16`
  and `src-tauri/tauri.conf.json:24` carry the same `connect-src` (`'self'`, `ipc:`,
  `http://ipc.localhost`, the two loopback hosts) — and `chat/scripts/csp-consistency.mjs`
  fails if they drift, if either one stops admitting the local server, or if either is
  widened back to a scheme-wide source. No websocket was in use, so `ws:`/`wss:` are gone.
- `chat/scripts/shots.mjs` waited for the chat's empty state as the landing view. Since
  the brain became the home it never appears, so the harness timed out. Broken before
  2026-09-18's work and unrelated to it. **Fixed** — `chat/scripts/shots.mjs:115-123`:
  the harness now opens the app and clicks through the travelling bar's Chat button when
  it is on screen, and its comment records why the old wait stopped working.
- The contract test wrote `chat/scripts/capability-contract.json` and asserted nothing:
  drift showed up as a dirty tree, never as a red suite. **Fixed** —
  `src-tauri/src/contract.rs` panics on drift, and `UPDATE_CONTRACT=1` is the one
  deliberate way to rewrite (`contract.rs:5`, `:27-35`); `39aeb2f` made the guard fail on
  dead commands instead of printing them. The module is gated `#[cfg(test)]`
  (`src-tauri/src/main.rs:13-14`), and both of its tests — reached from
  `src-tauri/src/capability.rs:539` and `src-tauri/src/options.rs:596` — were re-checked
  on 2026-09-20 and still run and can fail.
- A `trained_context_tokens` of `Some(0)` would be reported as *"not enough memory"*,
  blaming the machine for a header we parsed wrong. **Fixed** —
  `trained_context_unreadable` (`crates/kalsa-launch/src/policy.rs:186`), refused before
  the arithmetic with its own variant, `ChosenModelContextUnreadable`
  (`src-tauri/src/startup.rs:490`), one of `2642cc3`'s three.
- `soc.rs` would answer `"Apple M4 Ultra"` with the bare M4's 120 GB/s — 6.8x short.
  M4 is the one family with no Ultra row. No such chip has shipped. **Fixed** — exact
  match only (`crates/kalsa-probe/src/soc.rs:84`), pinned by the test
  `an_ultra_of_a_family_without_an_ultra_row_is_not_answered_by_the_bare_chip`
  (`soc.rs:127`). Also `2642cc3`.
- Under StrictMode a second `brain_progress` listener is registered and never
  unsubscribed. **Narrower now, not gone.** Cleanup exists — the unsubscribe is stored
  and called when the last listener leaves (`chat/src/surfaces/useBrain.ts:115`, `:126`)
  — but under StrictMode's mount→unmount→mount both `listen()` promises resolve after
  the second listener has registered, so both resolve with `listeners.size > 0`, the
  second overwrites `offProgress`, and the first unsubscribe is dropped. One dangling
  `brain_progress` listener per hot reload. Dev builds only.

## 18. Turning the server off can say "Off" while the server is still running

`crates/kalsa-supervisor/src/supervisor.rs:382` sets `ServerState::Stopped` on every
path out of `stop`. Two of those paths have signalled nothing. An adopted server
whose recorded pid the state file no longer vouches for is left alone: the
`if current == pid` body is simply skipped (`supervisor.rs:365-371`). And an
adopted-blind server — no pid was ever recorded — has nothing to signal at all; its
own comment says it: "Left running by necessity … Only a stop that stays stopped
leaks it, until reboot" (`supervisor.rs:374-378`). A spawned child and an adopted
pid the lock still covers ARE properly terminated and reaped; it is the two
in-between shapes that leak.

So "Off" is a claim about the app's state, not the machine's. The weights can stay
resident, holding the port, until reboot, while every surface in the app says the
server is off. Nothing even breaks afterwards — the next start re-adopts the same
server by port and health, per the comment — so the app keeps working while being
wrong, which is why nobody has felt this yet. What is lost is quieter: ten
gigabytes of resident weights the owner believes he dismissed, and no honest word
anywhere about a server the app no longer owns.

There are two honest repairs, and the owner has not chosen between them. Stop
claiming Off when nothing was signalled, and say what actually happened — truthful,
but it leaves weights resident. Or find the server by port, verify its identity,
and end it — what the owner means by Off, and harder to do without risking
somebody else's process, which is exactly the risk the `if current == pid` check
was written to avoid.

## 19. What the outgoing gate does not cover

Shipped in `0197a1f`: while a document is attached, every web search and every
fetched URL is shown to the owner before it leaves. The detectors: IBANs (mod-97
through `ibantools`, `chat/src/lib/webgate/sensitive.ts:1,77`), phone numbers
(`chat/src/lib/webgate/sensitive.ts:1,120-125`), cards (Luhn, not a bare pattern —
`chat/src/lib/webgate/sensitive.ts:83`), twenty key formats ported from gitleaks' own rule set
(`chat/src/lib/webgate/secretRules.ts:2-6`), an entropy catch-all
(`chat/src/lib/webgate/sensitive.ts:129`), and
any six-word run copied verbatim out of an attachment
(`chat/src/lib/webgate/copied.ts:98`). The owner sees the text and refuses it or
lets it go.

The limits below are deliberate, and they are written down because they are the
kind of thing a later reader mistakes for an oversight:

- **Paraphrase defeats the copied-text half.** Six verbatim words survive
  rewording; the copied-text detector does not. The owner accepted that in writing
  on 2026-09-19: *"Se parafrasa amen, è un limite"* (`crates/kalsa-files/src/scope.rs:4-6`,
  the precedent where the owner records the boundary).
- **No detector for national ID, tax or passport numbers**, and no global library
  exists for them — the code says so itself (`chat/src/lib/webgate/sensitive.ts:10-12`),
  and a wrong validator would be worse than none.
- **No postal-address detector.** An address is not one string but six words in a
  row, which is the copied-text half's exact shape — so addresses are covered
  incidentally, and only when copied verbatim (`chat/src/lib/webgate/sensitive.ts:11-13`).
- **The outgoing text reaches `localStorage` before the owner answers.** The user
  and empty assistant messages are stored before the assistant runs
  (`chat/src/App.tsx:593-603`), and the live turn is written through on each update
  (`App.tsx:416-434`), so the tool call sits in the conversation store while the
  dialog is still asking. This is out of scope by the owner's rule, stated where
  the file boundary came off: the guarded direction is the one that LEAVES the
  machine (`crates/kalsa-files/src/lib.rs:16-17`). Nothing sends the conversation
  store to the door, to the phone, or to the network; the store's keys never leave
  the page.

## 20. The CSP guard checks one directive

`chat/scripts/csp-consistency.mjs` parses every directive in both policies and
inspects one: `connectSources` (`chat/scripts/csp-consistency.mjs:42-43`) reads
`connect-src`, falling back to `default-src`, and every assertion in the script is
about that one pipe. Everything else it parses — `script-src`, `worker-src`,
`frame-src` — is never looked at.

This matters more than it did when the guard was written, because of what §17's
first item taught: node and Playwright cannot see what the webview enforces, and
that intersection bug lived exactly in the blindness. PDF extraction now runs in a
worker (`chat/src/lib/attachments.ts:2,98` — pdf.js's worker, loaded by URL), so a
`worker-src` that diverges between `chat/index.html` and `src-tauri/tauri.conf.json`
— or a build where neither admits the worker — would break attachments in a built
binary and pass this guard with a green tick. The guard would report the one thing
it checks, about the one directive that happens to be fine.

The repair is the same shape as the first one: assert the directives a built binary
actually exercises, not only the one that once bit.

## 21. The Models page has no decided future

`chat/src/surfaces/ModelsSurface.tsx` is still routed (`chat/src/App.tsx:975`), and
the owner has said it can disappear. Nothing has decided what that means, and two
things live only there: the per-start reason sentence — the chooser's own words for
why THIS start chose what it chose (`ModelsSurface.tsx:60`) — and the advanced
launch controls, the context, batch and ubatch overrides, rendered through
`<AdvancedPanel>` (`ModelsSurface.tsx:95`; the three fields are
`chat/src/components/AdvancedPanel.tsx:214-216`). The running model's name is not unique to the page; the home already shows it
(`chat/src/surfaces/BrainSurface.tsx:137`).

So the open question is narrow: not whether the page goes, but *where those two
things go if it does*. The reason sentence is the only place the choice explains
itself after the fact; the overrides are the only place the launch argv is anybody's
to change. Deleting the page without an answer takes both with it, and nothing else
on this list would notice.

## Not missing, deliberately

Retrieval and embeddings on the PC (measured: full context is cheaper than a
download — `DESKTOP-FEATURES-ALREADY-OURS.md` §7). A catalog gate threshold (the
owner holds that number). Model-authored HTML without isolation (six critical CVEs
say do not, §8 of the same doc).

---

## Addendum: yes there was a queue, and it was the wrong one — ours now exists, and it refuses

Asked by the owner, 2026-09-17: what happens when two people prompt at the same time,
and could the app show that the AI is currently busy with a named person.

Read in the server we ship (b10950, `tools/server/`), not assumed:

```cpp
// server-context.cpp:2405
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

Both are still true of the server we ship, and both are still the reason its policy
could not be inherited.

**The queue is now partly ours — and the half that exists is the half this addendum
said had to be.** The door has run its own since `29b63d0` (2026-09-16):
`crates/kalsa-door/src/server.rs:41` — `let (sender, receiver) =
mpsc::sync_channel(QUEUE);` — and when the queue is full the door refuses on the
spot (`server.rs:154-157`, where the full send calls `reject_busy`) instead of
deferring and hanging. The roofs sit together
in `crates/kalsa-door/src/lib.rs:73-86`: `WORKERS` 4, `QUEUE` 8, `MAX_CONNECTIONS`
12, and `MAX_JOBS` 64, whose comment gives its reason — "so kept answers alone can
never grow without bound either". Upstream defers; ours refuses. That is the
opposite policy, on purpose.

What is still missing is the half the owner actually asked about. The door knows
*who* — one credential per device since `02a2139` — and the waiting queue exists in
the same process, and neither reaches the page as a sentence: there is no "busy
with X", no "you are next", no per-device queue position anywhere in the code. The
knowledge is all in one place; only the words are missing.

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
- A profile is a human label on a device credential, so it costs almost nothing now
  that per-device credentials exist (`02a2139`). But "busy with X" is itself a
  disclosure: it may show a **name**, never the prompt, never the content, and the
  active label needs a timeout so a device that vanished mid-stream does not hold it
  forever.
