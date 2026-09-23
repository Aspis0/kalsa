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
| a claim sent whose response is never seen | the phone **cannot know** whether the code was consumed | drop the payload, and any retry needs a **new square** — never re-claim on a guess |
| after the claim | the transport has no abort endpoint — a cancel **does nothing** | **cancel is disabled**; only waiting is honest |
| a failed completion | the ceremony is **burned for good**, even for a later valid proof (`ceremony.rs:195-199`) | ask for a **fresh square**, in words that do not blame the person |
| a lost completion response | the seal is kept until acknowledged (`pairing.rs:396-404`, `:480-484`) | **retry `complete` with the same delivery token** — this is the one retry that is both safe and required |

## Invariants

1. **The QR is a bearer secret, not a display.** `crates/kalsa-pairing/src/payload.rs:24` — *"this struct
   holds the code in the clear — that is its job, in the QR and nowhere else"*; `pairing.rs:16-19` —
   *"showing the square IS the decision"*. **Until 2026-09-24 a photograph of the square was enough to let a phone in.** The owner has closed that:
   the computer now asks **"Allow this phone?"** and only an explicit Allow on the desktop admits it, so a
   stolen photo gets as far as the gate and no further. So the raw payload **never** reaches
   logs, analytics, crash reports, the clipboard or a deep link, and the scanning state **echoes the
   desktop's own warning** (`DevicesSurface.tsx:14`: *"Anyone who can see this square can connect a phone
   — show it only to yours."*).
2. **The camera is on only while scanning**, and released the moment a code is read, the screen is left, or
   the app backgrounds.
   **And the payload is held in memory only between reading it and sending the claim**: after the claim it is
   dropped, so an interrupted ceremony can never re-claim a code that may already be spent. Annulla exists
   in 3a and not in 3b for exactly that reason — a cancel the desktop cannot honour is a button that lies.
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
| **0 — not available in this build** | one line, no promise, no camera | *(none)* | *"Il collegamento col codice arriva con una prossima versione."* — and nothing else: the typed address the doc describes as belonging to `main` does not exist on this branch, so a sentence pointing at it would be a second door onto a wall. |
| **1 — camera permission refused** | one paragraph | **Apri le impostazioni** | *"Serve la fotocamera per leggere il codice. Puoi concederla nelle impostazioni di sistema."* |
| **2 — scanning** | the camera, a plain frame, and the caution | **Annulla** | *"Inquadra il codice che vedi su Kalsa desktop. Chiunque veda quel codice può collegare un telefono: mostralo solo ai tuoi."* |
| **3a — code read, nothing sent** | the code is in hand and **nothing has left the phone** | **Annulla** (safe: the payload is discarded here) | *"Sto collegando…"* |
| **3b — claim sent** | the claim is on the wire and the one-shot code **may already be consumed** — the phone cannot know which | **no cancel.** Wait, or on failure **Chiedi un nuovo codice** | *"Sto collegando…"* |
| **4 — completing** | the same line, and a retry that is safe | **Riprova** (no cancel) | *"Sto finendo il collegamento…"* — a lost response is retried **with the same token**, so this button must not restart a ceremony |
| **4b — waiting for the owner** | one line, and the truth that the phone cannot make this happen | **no action** — the decision is on the computer | *"Conferma sul computer: apri Kalsa desktop e consenti questo telefono."* — and a refusal, or a wait that runs too long, ends the attempt and needs a new square |
| **5 — connected** | **Il tuo computer**, and the truth about the seat | **Rimuovi da questo telefono** | *"Questo telefono può usare il tuo computer. Il computer tiene il posto finché non lo rimuovi da lì."* |
| **6 — burned ceremony** | one paragraph, no blame | **Chiedi un nuovo codice** | *"Il collegamento non è stato completato e questo codice non vale più. Sulla schermata di Kalsa desktop fanne comparire uno nuovo."* |

## Refusals, keyed on status codes, because the door says nothing

The door gives a waiting phone **no words**: an **empty 403** for every pairing failure, an **empty 503**
for pressure, an **empty 401** for a bad credential. Every sentence below is therefore ours.

| Signal | What it actually means | Copy | Actions |
|---|---|---|---|
| **403, empty** — pairing | **indistinguishable** between a wrong code, an expired code, a malformed body, a failed completion and a full pairing queue (`transport.rs:445` → `:481`) | *"Il computer non ha accettato il collegamento. Chiedine uno nuovo sulla schermata di Kalsa desktop e riprova."* — **never "occupato": the phone cannot know that** | Chiedi un nuovo codice · Annulla |
| **503, empty** — door | **more causes than one**: the queue is full, the 12-connection cap is hit (`lib.rs:125-126`, `server.rs:163-182`), the head-patience timeout fired (`proxy.rs:101-116`), or the event-job registry refused the job (`proxy.rs:332-340`) | *"Il computer non ha accettato la richiesta in questo momento. Riprova fra poco."* — **cause-neutral on purpose**: the phone cannot tell those apart, and it must not guess which one it was | Riprova |
| **503, with a body** — door | the door's one spoken sentence: no seats left (`lib.rs:167`) | the sentence itself, quoted: *"This computer is set up for {seats} at once, and one of them is this computer…"* | Riprova |
| **slow response, no error** | the request may be queued (`proxy.rs:95-98`) or **already running**, bounded by the 300 s connection lifetime (`proxy.rs:94`) — and the phone can see **neither** a queue position nor the difference | *"Il computer non ha ancora risposto."* — true and observable. **Not "è in coda" and not "partirà":** neither is observable from here, and a request that entered the queue is not punished for the wait | Annulla |
| **401, empty** | says only that this key is not being served. **Waiting for the OK, refused, forgotten and a wrong key all look identical by design** (`lib.rs:113-116`) | *"Il computer non sta servendo questo telefono. Se l'hai appena collegato serve il suo OK; altrimenti guarda i dispositivi sul computer."* — **no certainty**, because the door deliberately tells nobody which case it is | Riprova · Dimentica questo computer |

**Two timeouts, and they are not the same number.** The one that decides the refusal rows must be
longer than a long answer (below); the one that waits for the owner's Allow must cover **a human decision**,
because someone has to read a sentence, walk to the computer and press a button. No figure is written here:
the contract is not chosen yet, and a number invented now is a guess wearing a specification's clothes.

**And the timeout that decides which row applies must be longer than a long answer**: every request takes
a door worker, the readiness probe included (`proxy.rs:51-53`), so a probe during four streams waits
6 376.7 ms (`dev/results/concurrency-four-devices/results.json`, commit `7f3d28f`). A short timeout turns
the "slow response" row into the "not reachable" one, and a busy computer into a dead one.

## What the second review added, including a correction of its own

The re-check of this document came back **NON FIT again**, and it separated my mistakes from the parts of
the desktop's contract that had never been written down. Four of the seven findings are fixed; three are
partial, and each partial one is now a blocked or corrected state rather than a silence.

**A correction of the reviewer's own, and it narrows my retry rule.** The desktop's acknowledgement is
**its own successful socket write**, not a confirmation from the phone
(`src-tauri/src/transport.rs:409-412`: `if result.is_ok() { if let Some(token) = answer.delivery_token { desk.acknowledge(&token);`).
So **retry-with-the-same-token is safe only when the desktop's write itself failed**: a completion response
that left the desktop and never reached the phone — the app killed, the network cut with bytes in flight —
**cannot be recovered**, and a retry earns the generic 403. Closing that would need a receipt from the
phone, which is a desktop protocol change and not something this document can design around.

**A lost claim has no recovery at all.** The claim consumes the code and answers `{}`
(`transport.rs:430-434`); a second claim is rejected (`ceremony.rs:161`) — there is **no idempotent claim**.
So an ambiguous claim failure is an **add a new square** state, not a retry: the phone cannot distinguish
"the claim never arrived" from "the claim arrived and the answer was lost", and the second one has already
spent the code.

**Backgrounded or killed between claim and complete.** The desktop keeps the claimed ceremony until its
120 s deadline, so the phone has two honest options and must pick one. This document takes **"the square is
spent"** as the default, and the Brain session endorsed it with the reason I had not found: resuming would
keep a **bearer secret — the one-time code — on the phone's disk** beyond the moment the camera saw it, to
win at most 120 s. Resume stays a later goal, and if it is ever built the stored state must be protected
storage, deleted on completion, on failure and on expiry.

**Single flight per ceremony.** One claim in flight at a time, with a latch: a double tap must not send the
claim twice, and a **late 403 arriving after the other request succeeded is not a failure** and must not be
shown. (Refuted, and worth recording: a **second phone cannot double-claim** — the loser simply gets the
generic 403 and the winner is unaffected.) And an explicit **new square on the desktop abandons** an
attempt in flight (`pairing.rs:344`), so the phone's "chiedi un codice nuovo" and the desktop's button are
the same act from two sides.

**Status codes the first table did not cover**, all after pairing: a **403 with a body** when the door
refuses the engine's `/slots` routes in one sentence (`slot_routes.rs:148-154` — quote it if it ever
appears, a correct client never sends those); an **empty 502** when the door cannot reach the engine
(`proxy.rs:265`) and a 502 with a body from its own chat routes; **400 / 404 / 500 / 501** from the door's
`/kalsa/` chat routes; a **401 relayed from the engine**, which is not necessarily a bad pairing
credential; and — the row that was missing entirely — **a closed connection with no HTTP response at all**
(upstream failures, `proxy.rs:305`; pairing refusals are best-effort writes, `transport.rs:477`), which
needs a generic *"la connessione è caduta"* with a retry, not a diagnosis.

## The approval gate's contract, as the desktop defines it (2026-09-24)

Committed on the desktop's side at `brain` `e2ae919` (locally, not pushed), with the contract below
verified on disk there. Point 1 changes our copy, and it changes it in the direction of saying **less**.

1. **A 401 says nothing, and we must not pretend it does.** Until Allow, every door request carrying the
   new credential gets an **empty 401** — no body, no distinguishing header — and **waiting, refused,
   forgotten and a wrong key all produce that same empty 401 by design**, so the door tells nobody which
   one it is. So after a successful completion the phone **keeps the credential**, shows the waiting
   state, and retries quietly. **Never delete the credential on a 401 by itself**: deleting is the
   person's gesture, not the network's. And our copy must not assert that a 401 means "not allowed yet" —
   it may equally mean the owner pressed Refuse, or forgot the device, or the key is wrong. This corrects
   a sentence I had written for the (B) gate, which was certain where the door is silent.
2. **Allow reaches the door in about a second** (it learns the new set on the desktop's next 1000 ms
   poll), so the waiting state needs no countdown of ours and no invented timing.
3. **A 503 with a sentence is not pressure.** After Allow a phone can still receive a 503 *carrying the
   no-seat sentence* when the model was launched before that phone was paired, because seats are planned at
   launch and re-planned when the model restarts (`crates/kalsa-door/src/lib.rs:148-152`). Pre-existing,
   and distinct from the **empty** 503, which is pressure. Our table separates them; this is why.
4. **The seal retry rule is unchanged**: retry `/pair/complete` with the same token **only if the response
   never arrived**, because the desktop counts delivery on its own successful socket write, and a blind
   retry leaves it holding an orphan waiting device.

And the desktop's own screen, step by step, so both sides say the same thing at the same moment:

| Step | What the computer shows |
|---|---|
| model not running | no square at all: *"This computer is not running yet, so there is nothing for your phone to connect to."* |
| a phone claims | *"A phone is connecting right now."*, with Cancel |
| a phone completes | headline *"Waiting for your OK"*, then the row *"Paired phone 2 — Waiting for your OK."* with Allow and Refuse |
| Allow | headline *"Paired"*, and the row shows the capability and Forget |
| Refuse | the row disappears and the page returns to a fresh square |

That table also answers a question this document asked earlier: the desktop **does** show something while a
phone is scanning — not the scanning, which is invisible to it, but the claim the moment it arrives, which
is exactly when the person's attention should move to the computer. And the `2` in "Paired phone 2" is a
pre-existing label quirk: the computer's own record holds number one, which is the seat model stating
itself in the interface.

**And the reason none of this can be tested yet, in the desktop's own words**: the pairing desk listens on
`127.0.0.1` on a random port and the square advertises that loopback address
(`src-tauri/src/transport.rs:128-131`); the only tunnel is off by default and forwards to the door, not to
the desk. The road to the desk is the next desktop work item and needs the owner's go-ahead.

## Pushed, and two refinements (2026-09-24)

The desktop's approval gate is **pushed** on `brain` at `06029e1`, with both reviewers passing it FIT,
and the contract above is unchanged. Two refinements arrived with the final review rounds, and both land
in our copy:

1. **After the owner refuses the only phone, the desktop returns to unpaired and shows a fresh square**
   again, provided the model is running. So a refusal is not a dead end on the other screen: the person
   goes back to the computer, a square is waiting, and the phone can be paired again in one scan. Our
   refusal copy must not claim which failure happened — the empty 401 cannot tell us, by design — but it
   can point at the place where the answer is: the devices list on the computer, and a new square if the
   phone was refused.
2. **The numbered label stays, and no copy of ours may lean on it.** The first phone is still shown as
   "Paired phone 2" because the computer holds seat one, and the owner has decided the person will choose a
   nickname later. So the number is a placeholder rather than a name: our screens must not call a phone
   "phone 1" or "phone 2" anywhere, and when the nickname exists the phone's own screen should show it —
   that field is not in the protocol yet (fact 5), so until then the phone is simply "questo telefono".

**And the thing this document was waiting for**: the road to the pairing desk is now being built, with the
owner's go-ahead. The desktop will say when a real phone can scan and complete. Until that message, the
scanning state stays unbuilt on this side — the design is ready, the road is not, and building a camera
onto a wall is still the mistake this document exists to avoid.

## Open, and not mine to close

1. **A photograph is no longer enough** (owner, 2026-09-24): the computer asks **"Allow this phone?"** and
   only an explicit Allow admits it. The camera and scanning states are unblocked as designed, and state 4b
   is the gate. **What is not fixed is where the gate sits**, and the two candidates change our copy
   differently, so both are recorded until the Brain session chooses:
   - **(A) the completion is held** until the owner decides: state 3b simply lasts longer, and a refusal or a
     too-long wait arrives as the **generic 403**, so 4b's failure copy is the pairing-refused one (fresh square);
   - **(B) the device is stored pending** and the door refuses its credential with a **401** until the owner
     allows it: then 4b is a state of the connection rather than a wait inside pairing, and the 401 row must
     stop saying *"la chiave non è più valida"* — telling someone their key is broken when it is merely
     pending is a lie with a support ticket attached.
   The owner's constraint is **no over-engineering**: one state and one extra sentence on the desktop, no new
   screen, and no timing built until the contract is chosen.
2. **A typed fallback.** The code is 32 hex (`qr.rs:19`) and the desktop never shows it as text; a typed
   door would be a new state on **both** sides.
3. **The route.** Until the desk is reachable from a phone, none of these states can be exercised end to
   end — and a scanner built before it would be a door onto a wall.
