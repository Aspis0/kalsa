# DESIGN-PAIRING — the phone side of the QR ceremony

Revised 2026-09-24 after a hostile review by **gpt-6-luna** (a different model from the one that wrote
it) against the desktop half, which returned **NON FIT** with seven findings. Every desktop line quoted
below was re-checked by the Brain session itself before it reached me. The facts come from
**`ANSWERS-PAIRING-AND-ROOM-2026-09-23.md`** at `brain` `8ae9617`, not from the earlier draft.

## Read this first: what stops the work

**There is no route to the pairing desk.** The square advertises **loopback by design**
(`src-tauri/src/pairing.rs:11`: *"The square advertises loopback and nothing else."*; the listener binds
`Ipv4Addr::LOCALHOST`, `transport.rs:128`), so a phone that posts to `reachable` reaches **its own**
loopback. The only tunnel that exists forwards to the **door**, not to the desk
(`crates/kalsa-iroh/src/bridge.rs:6-7`), and it is **off by default** (`options.rs:48-53`). The desktop
also offers **no square at all unless its server is up** (`pairing.rs:246-249`).

So: **the scanning state is not buildable into a working flow today, and this document does not pretend
otherwise.** What ships today on the phone is the port's **typed address**, which is a different door and
belongs to `main`, not here. This design waits, and the waiting is the honest state:

> **Il collegamento col codice arriva con una prossima versione.** *(No camera, no QR, no promise.)*

## Then: the ceremony's lifecycle, which dictates every retry and every cancel

The protocol is `POST /pair/claim` then `POST /pair/complete` (`transport.rs:430`, `:437`). Its lifecycle
is unforgiving, and the phone's buttons follow it exactly:

| Moment | What is true on the desktop | What the phone may do |
|---|---|---|
| before the claim | the code is live for **120 s** and is **one-shot** (`ceremony.rs:13`, `pairing.rs:36`) | scan, or leave |
| a successful claim | **the code is consumed** (`ceremony.rs:13-15`) | **never claim again with the same code** |
| after the claim | the transport has no abort endpoint — a cancel **does nothing** | **cancel is disabled**; only waiting is honest |
| a failed completion | the ceremony is **burned for good**, even for a later valid proof (`ceremony.rs:195-199`) | ask for a **fresh square**, in words that do not blame the person |
| a lost completion response | the seal is kept until acknowledged (`pairing.rs:396-404`, `:480-484`) | **retry `complete` with the same delivery token** — this is the one retry that is both safe and required |

## Invariants

1. **The QR is a bearer secret, not a display.** `crates/kalsa-pairing/src/payload.rs:24` — *"this struct
   holds the code in the clear — that is its job, in the QR and nowhere else"*; `pairing.rs:16-19` —
   *"showing the square IS the decision"*. There is **no second approval**: whoever holds a photograph of
   the square, within its 120 s window, can claim and complete first. So the raw payload **never** reaches
   logs, analytics, crash reports, the clipboard or a deep link, and the scanning state **echoes the
   desktop's own warning** (`DevicesSurface.tsx:14`: *"Anyone who can see this square can connect a phone
   — show it only to yours."*).
2. **The camera is on only while scanning**, and released the moment a code is read, the screen is left, or
   the app backgrounds.
3. **The phone never learns a name for the computer.** The square carries `v`, `reachable`, `code`,
   `nonce` and optionally `node` (`payload.rs:28-49`); the answer carries `credential_ciphertext` and `mac`
   only (`messages.rs:260-264`); the label is assigned on the desktop *for the phone* (`pairing.rs:425`).
   So the screen says **"Il tuo computer"** — not a preference, the only label the protocol can support.
4. **The credential lives in the platform store** (Keychain / Keystore through SecureStore) and nowhere
   else. Deleting it here **deletes it here**: see the next invariant for what it does not do.
5. **"Rimuovi da questo telefono" is the honest verb, not "Disconnetti".** Freeing a seat is the owner's
   action **on the desktop**, by device id (`pairing.rs:330-333`, `forget_device`); the phone has no revoke
   call. The screen says so: the computer keeps its seat until it is removed there.
6. **Workers are not seats.** `WORKERS = 4` counts concurrent **exchanges** (`crates/kalsa-door/src/lib.rs:88`),
   while seats are one per stored device and come from the engine's `--parallel` (`main.rs:515-516`,
   `:1053-1055`). One phone can hold **two workers at once** (a stream plus a probe). So no screen may say
   "the computer serves itself and three phones" — that sentence can be false.
7. **No scarcity story for the room.** The room's turn order is a design choice of the hub's, not a
   consequence of the door's pool: no room scheduler exists, and the pool does not force one.

## The states, for the day the route exists

| State | What is on screen | The one action | Copy |
|---|---|---|---|
| **0 — not available in this build** | one line, no promise, no camera | *(none)* | *"Il collegamento col codice arriva con una prossima versione. Nel frattempo puoi usare il tuo computer dall'indirizzo."* |
| **1 — camera permission refused** | one paragraph | **Apri le impostazioni** | *"Serve la fotocamera per leggere il codice. Puoi concederla nelle impostazioni di sistema."* |
| **2 — scanning** | the camera, a plain frame, and the caution | **Annulla** | *"Inquadra il codice che vedi su Kalsa desktop. Chiunque veda quel codice può collegare un telefono: mostralo solo ai tuoi."* |
| **3 — claiming** | a progress line, cancellable **only here** | **Annulla** (allowed) | *"Sto collegando…"* |
| **4 — completing** | the same line, and a retry that is safe | **Riprova** (no cancel) | *"Sto finendo il collegamento…"* — a lost response is retried **with the same token**, so this button must not restart a ceremony |
| **5 — connected** | **Il tuo computer**, and the truth about the seat | **Rimuovi da questo telefono** | *"Questo telefono può usare il tuo computer. Il computer tiene il posto finché non lo rimuovi da lì."* |
| **6 — burned ceremony** | one paragraph, no blame | **Chiedi un nuovo codice** | *"Il collegamento non è stato completato e questo codice non vale più. Sulla schermata di Kalsa desktop fanne comparire uno nuovo."* |

## Refusals, keyed on status codes, because the door says nothing

The door gives a waiting phone **no words**: an **empty 403** for every pairing failure, an **empty 503**
for pressure, an **empty 401** for a bad credential. Every sentence below is therefore ours.

| Signal | What it actually means | Copy | Actions |
|---|---|---|---|
| **403, empty** — pairing | **indistinguishable** between a wrong code, an expired code, a malformed body, a failed completion and a full pairing queue (`transport.rs:445` → `:481`) | *"Il computer non ha accettato il collegamento. Chiedine uno nuovo sulla schermata di Kalsa desktop e riprova."* — **never "occupato": the phone cannot know that** | Chiedi un nuovo codice · Annulla |
| **503, empty** — door | a request was **dropped**: the queue is full or the 12-connection cap is hit (`lib.rs:125-126`, `server.rs:163-182`) | *"Il computer non ha accettato la richiesta in questo momento. Riprova fra poco."* — **not "partirà"**: nothing is queued | Riprova |
| **503, with a body** — door | the door's one spoken sentence: no seats left (`lib.rs:167`) | the sentence itself, quoted: *"This computer is set up for {seats} at once, and one of them is this computer…"* | Riprova |
| **slow response, no error** | the request **is in the queue** and starts when a worker frees (`proxy.rs:95-98`), bounded by the 300 s connection lifetime (`proxy.rs:94`) | *"Il computer sta rispondendo ad altre richieste. La tua partirà appena se ne libera una."* — true **only** while there is no error | Annulla |
| **401, empty** | a **post-pairing** credential state, not a pairing-code one (`lib.rs:113-116`) | *"La chiave di questo telefono non è più valida. Rimuovilo dal computer e collegalo di nuovo."* | Rimuovi · Riprova |

**And the timeout that decides which row applies must be longer than a long answer**: every request takes
a door worker, the readiness probe included (`proxy.rs:51-53`), so a probe during four streams waits
6 376.7 ms (`dev/results/concurrency-four-devices/results.json`, commit `7f3d28f`). A short timeout turns
the "slow response" row into the "not reachable" one, and a busy computer into a dead one.

## Open, and not mine to close

1. **Should a photograph of the square be enough?** Today it is: the code is a bearer secret with no second
   approval. That is a protocol decision on the desktop side, and the Brain session is putting it to the owner.
2. **A typed fallback.** The code is 32 hex (`qr.rs:19`) and the desktop never shows it as text; a typed
   door would be a new state on **both** sides.
3. **The route.** Until the desk is reachable from a phone, none of these states can be exercised end to
   end — and a scanner built before it would be a door onto a wall.
