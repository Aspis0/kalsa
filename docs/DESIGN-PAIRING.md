# DESIGN-PAIRING — the phone side of the QR ceremony (draft, 2026-09-24)

Written for the Brain session to review against the desktop's half (`/Users/marco/Projects/kalsa-brain`,
branch `brain`). **Every technical fact below is a placeholder until the answers file arrives**: the
desktop's explorer is drafting `kalsa-brain-qr-room-answers.md` with a verbatim `path:line` quote for
every claim, and the Brain session will verify the quotes before sending me the path. Nothing here
invents a protocol; where a fact is missing it says `[WAITING: question n]`, referring to the eight
questions already in its hands.

## Why this feature exists, and why it is the next one

The app can already answer from the phone. It cannot yet answer from the owner's computer, and that is
where the product's second half lives — the same half whose client just landed on app `main` (`d69b4ce`).
The phone has **no way to join a computer**: no scanner, no camera permission, no credential storage.
The desktop's side of the ceremony exists (`pairing.js`, 261 lines of the wizard, plus
`src-tauri/src/pairing.rs`, where the add path is called *the phone ceremony*), and the hub's own words
are **"no QR has ever been scanned end to end"**. So this is not adding a reader to something that works:
it is closing a ceremony that has never met itself.

**And the room depends on it**: the room is for several devices, devices join by pairing, so the
ceremony comes first.

## Where it lives in our design language

A row in **Settings › ASSISTENTE**, under *Dove risponde*: **"Il tuo computer"**, with a subtitle that is
a fact and not a promise — `Non collegato` / `Collegato: MacBook di Marco`. Tapping it opens the
**Pairing screen** (§3.4 grammar: centred title, back chevron, one primary action, editing in sheets).
The *Dove risponde* sheet gains a third row, **"Il tuo computer"**, disabled with a subtitle
`Non collegato — tocca per collegarlo`, which routes to the same screen: the place a person looks for
the computer is where they chose where the answer comes from.

## The screen, state by state

| State | What is on screen | The one action | Copy |
|---|---|---|---|
| **0 — not connected** | one paragraph, then the button | **Scansiona il codice** (filled) | *"Kalsa desktop mostra un codice. Inquadralo con la fotocamera per collegare questo telefono al tuo computer. La conversazione andrà al computer solo quando scegli di usarlo."* |
| **1 — camera permission refused** | one paragraph, no camera view | **Apri le impostazioni** (filled) | *"Serve la fotocamera per leggere il codice. Puoi concederla nelle impostazioni di sistema del telefono."* |
| **2 — scanning** | the camera, a plain frame, one line under it | **Annulla** (text) | *"Inquadra il codice che vedi su Kalsa desktop."* |
| **3 — checking** | a progress line, cancellable | **Annulla** (text) | *"Sto collegando…"* |
| **4 — connected** | the computer's name, when it was last reached, and what it is for | **Disconnetti** (secondary, destructive-ish) | *"Questo telefono può usare il tuo computer. La chat resta sul telefono finché non scegli un modello sul computer."* |
| **5 — the computer is busy** | the same as 4, with the queue line | **Riprova** (secondary) | *"Il computer sta già servendo sé stesso e tre telefoni. La tua richiesta partirà appena uno si libera."*
The owner's reading of the number: **n=4 is one computer plus three phones** — the computer counts itself
— and it is *for now*, so no copy should memorise a figure. |

## Failure copy, and the register it has to match

The hub's own note says the desktop's error copy is already better than ours — `shots/05-denied.png`
reads *"The server did not accept the key. It answered 401 — the token is missing, wrong, or expired.
Check it in Settings and try again."*, with **Try again** and **Open settings**. So the phone's failures
are written the same way: what happened, what it means, what the person can do — never "Errore 401".

| Failure | Copy | Actions |
|---|---|---|
| the code is not ours | *"Questo codice non è di Kalsa. Inquadra quello che Kalsa desktop mostra nella sua schermata di accoppiamento."* | Riprova · Annulla |
| the computer does not answer | *"Il computer non risponde. Controlla che Kalsa desktop sia aperto e che telefono e computer siano sulla stessa rete."* | Riprova · Annulla |
| the code is old | *"Il codice è scaduto. Fanne generare uno nuovo su Kalsa desktop e inquadralo."* | Riprova · Annulla `[WAITING: question 3 — is the code one-shot or does it expire?]` |
| the key is refused (the desktop's 401) | *"Il computer non ha accettato la chiave. È mancante, sbagliata o scaduta: controllala su Kalsa desktop e riprova."* | Riprova · Impostazioni |
| the phone cannot reach it later | *"Il tuo computer non è raggiungibile adesso. La chat resta sul telefono."* | Riprova · Passa al telefono |

## Invariants, and they are not decoration

1. **The camera is on only in state 2.** It is released the moment the code is read, the screen is left,
   or the app goes to the background. A scanner that keeps a camera warm is a battery and a trust
   problem at once.
2. **The payload is never shown in full, and never logged.** It is a credential, and the phone's job is
   to swallow it, not to display it.
3. **What the phone stores** `[WAITING: question 3]` — where it lives (the app's private storage), what
   it is (a key? an address? both?), and whether the screen must offer to forget it. My design assumes a
   **Disconnetti** in state 4 does forget it, and says so plainly.
4. **The first call after scanning** `[WAITING: question 4]` — until it is known, this screen must not
   invent a handshake: states 2 and 3 are drawn but their timing is not promised.
5. **Nothing about Tailscale appears on this screen.** The owner's line is that Pro exists *for people
   who do not want to set up Tailscale themselves*: a screen that names a VPN would be answering a
   question the person did not ask. The network only shows up in the failure copy, as "the same network".
6. **A seat is a device** — and the owner's clarification makes this almost answered: n=4 is *one computer
   plus three phones*, which matches the hub's own language about **four seats, one of them yours**, and the
   note that the machine running the server registers itself without a QR. So the computer holds a seat
   from first launch, phones join by pairing, and the room's `[WAITING: question 8]` is now a confirmation
   rather than an open question.

## The one fact we already have, and it changes a copy line

From the Brain session today: the door's pool is **4 workers with a queue of 8**
(`crates/kalsa-door/src/lib.rs:88` `const WORKERS: usize = 4;`, `:89` `const QUEUE: usize = 8;`), one
worker holds an exchange end to end **including streams**, and the computer is itself a door device — so
while four devices stream, anything else waits. Measured on the release: a fifth request waited
**6376.7 ms** (`dev/results/concurrency-four-devices/results.json`, `door_queue_probe`, commit `7f3d28f`).

Two consequences, and the second is the interesting one:

- the phone needs a **waiting** state that names the cause instead of spinning: state 5 above;
- the hub's room rule — **one turn at a time** — turns out to be a *scarcity* rule as well as a
  reproducibility rule. The door cannot do otherwise, and the phone's copy can say so honestly.

## What I am not designing here

The desktop's side of the wizard, the payload's schema, and the relay behind Pro: those belong to the
Brain session and to the owner. This document stops at the phone's screens, states and words.

## Questions that remain for the Brain, beyond the eight

1. **Does the desktop also show a short code** a person could type, for a camera that will not focus?
   If yes, the phone needs a second door ("Inserisci il codice a mano") and one more state.
2. **How does a person know which computer they paired**, if they have two? The phone shows the name in
   state 4 — where does that name come from, and can it be wrong?
3. **What does the desktop show while a phone is scanning?** If it shows nothing, the person has two
   screens to watch and no way to tell which one is waiting.
