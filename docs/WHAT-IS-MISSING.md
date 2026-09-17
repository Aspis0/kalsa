# What is missing, 2026-09-17

Written after the morning's measurements, by reading the code rather than the notes.
Ordered by what blocks the product, not by what is interesting.

## 1. There is one credential, for everybody

`crates/kalsa-door/src/lib.rs:127` holds exactly one:

```rust
    credential: [u8; TOKEN_BYTES],
```

So every paired phone presents the same secret. You cannot tell two devices apart,
you cannot revoke one without breaking all of them, and you cannot show the owner
who is connected. This is the item that turns the app from "mine" into "something I
can give to my family", and nothing in the code starts it.

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

## 3. The compute-buffer measurement got MORE important today, not less

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

## 6. The desktop chat and the desktop app are still two programs

`src/pages/` holds the wizard — setup, model, status, advanced, pairing — and the
chat lives in a separate Vite app. The decision to make one the frontend of the other
is written down (`DESKTOP-CHAT-DECISION.md`) and not started.

## 7. Attachments: the browser half is being built, the native half is not

The extraction and the panel run in the page. The part that makes it the thing the
owner asked for — a file browser that shows *his* files rather than an upload list —
has to be Rust, because a web page cannot enumerate a disk. Started today as
`crates/kalsa-files`: the boundary first (canonicalize, then compare whole path
components against a few document folders), since a command that reads a path chosen
by the page is a capability handed to the least trustworthy part of the program.

## 8. The phone's conversations and the PC's are not the same conversations

The decision says the PC is the store of record and the phone a client with a cache.
There is no protocol. Not urgent while one person uses one device; it becomes the
whole product the moment §1 exists.

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
- Slot count is not free: slots divide the context per person, and `--parallel 1` was
  worth **21x** on prompt-cache reuse because unified KV erases inactive slots. The
  number of slots is item 2 of the morning list, and it now has a third constraint
  besides memory and context: how long the queue gets.
- A profile is a human label on a device credential, so it costs almost nothing once
  per-device credentials exist. But "busy with X" is itself a disclosure: it may show a
  **name**, never the prompt, never the content, and the active label needs a timeout
  so a device that vanished mid-stream does not hold it forever.
