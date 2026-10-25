# Pairing and the room: answers for the phone side (2026-09-23)

Asked by the phone/UX session (Paseo agent `49e4aa01-0724-4f83-a740-baa9a7e4b34f`, branch
`ux-2026-09-21`), relayed by the kernel coordinator. Every claim quotes its line. The desktop code
is at `brain` `4dc4b0f` and was not changed to answer. The phone's design this answers is
`/Users/marco/Projects/kalsa-ux/docs/DESIGN-PAIRING.md` (`7c8ac98` on its branch).

## Read this first: five facts the phone's screens hang on

1. **Today a real phone cannot finish pairing, because the road to the pairing desk is not
   built.** The square's `reachable` is loopback by design: `src-tauri/src/pairing.rs:11` —
   `The square advertises loopback and nothing else.`; the listener is
   `src-tauri/src/transport.rs:128` — `let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;`.
   So a phone that POSTs to `reachable` reaches its OWN loopback. The only tunnel that exists
   goes to the **door**, not to the pairing desk: `crates/kalsa-iroh/src/bridge.rs:6-7` —
   `starts the accept loop that forwards every accepted stream` / `to the door on `127.0.0.1``,
   opened at `src-tauri/src/main.rs:644` — `road::open(&self.road, address, road::key_path(file));`
   with the door's address. That tunnel is also **off by default**:
   `src-tauri/src/options.rs:48-53`, `which is not a thing consent may be presumed from: the
   default is` / `off.` … `pub(crate) internet_road: bool,`. And `node`, the id the phone would
   dial, is in the square only while that road is open (`crates/kalsa-pairing/src/payload.rs:40-49`).
   Nobody has ever scanned a QR end to end. So the phone's "first call after scanning" is a
   protocol the desktop defines (`POST /pair/claim`, then `POST /pair/complete`, Q4 below) over a
   road that does not exist yet. A design state that assumes the call arrives is waiting on this,
   not on the phone.
2. **A seat is a device, and the computer holds one of them.** `src-tauri/src/main.rs:1053-1055` —
   `// How many seats the door must hold: this computer and every paired` / `// phone. A seat is
   reserved per stored device for as long as it is` / `// stored, so this is the enrolled set, not
   who is talking right now.` And the one sentence the door speaks when seats run out,
   `crates/kalsa-door/src/lib.rs:167` — `"This computer is set up for {seats} at once, and one of
   them is this computer. Every \`. This agrees with the owner's "one computer plus three phones,
   for now" (Q8 below has the whole credential → device → slot chain).
3. **A waiting phone gets no words from the door today.** The pool and queue refuse with an
   empty 503 (`crates/kalsa-door/src/lib.rs:125-126`); an unknown credential gets an empty 401
   (`lib.rs:113-116`); the pairing desk's own queue refuses with an empty 403
   (`src-tauri/src/transport.rs:481`). The only spoken refusal is the no-seat sentence above.
   Every waiting and refusal sentence the phone shows is therefore the phone's to write, keyed
   on the status code. `docs/WHAT-IS-MISSING.md:229-231` says the same: `the queue now exists and
   refuses, but the sentences it` / `owes a waiting device do not.`
4. **Every request through the door takes a worker, the phone's readiness probe included.** The
   door forwards `/props`, `/health` and the model listing on the same path as a completion:
   `crates/kalsa-door/src/proxy.rs:51-53` — `` `/props`, `/health`, `/tokenize` and the model listing
   are forwarded by the`` / `same path and change nothing`. With `WORKERS = 4`
   (`crates/kalsa-door/src/lib.rs:88`) and a worker held for a whole exchange, streams
   included, a probe sent while four devices stream waits for a stream to end. It waits in the door's queue, which holds up to `QUEUE = 8` and is not punished for the wait (`crates/kalsa-door/src/proxy.rs:95-98`), bounded by the 300 s connection lifetime (`proxy.rs:94`). Past the queue, or past 12 connections, the answer is an immediate empty 503 (`server.rs:163-182`). Measured on the
   release today: 6376.7 ms (`dev/results/concurrency-four-devices/results.json`,
   `door_queue_probe`, commit `7f3d28f`). A readiness timeout shorter than a long answer would read
   a busy computer as a dead one.
5. **The phone learns no name for the computer from the protocol.** The square carries `v`,
   `reachable`, `code`, `nonce` and optionally `node` (`crates/kalsa-pairing/src/payload.rs:28-49`).
   The computer's answer carries `credential_ciphertext` and `mac` only
   (`crates/kalsa-pairing/src/messages.rs:260-264`). The label is assigned on the desktop, for the
   **phone**: `src-tauri/src/pairing.rs:425` — `// The label is assigned HERE, locally`. A computer name
   on the phone's connected screen would need a protocol field that does not exist; "il tuo
   computer" needs none.

## Added after two reviews of the phone's design (same day)

Each line below was re-checked here against the file. These are desktop contracts the phone
builds on that the first draft did not state.

6. **A completion's seal is released on the desktop's own successful write, not on the phone's
   receipt.** `src-tauri/src/transport.rs:409-412` — `if result.is_ok() {` / `if let Some(token) =
   answer.delivery_token {` / `desk.acknowledge(&token);`. So a retry with the same delivery token
   recovers a completion only when the desktop's write failed. If the bytes left the desktop and
   the phone never processed them (app killed, network cut), the retry gets the generic 403 and
   the phone needs a fresh square. Closing that gap would need a phone receipt, which is a
   protocol change.
7. **A claim is not idempotent.** It consumes the code and answers `{}`
   (`src-tauri/src/transport.rs:430-434`). A second claim on the same ceremony is refused
   (`crates/kalsa-pairing/src/ceremony.rs:161`). A claim whose response was lost therefore has
   no recovery but a fresh square.
8. **A streamed answer through the door is a resumable job.** `crates/kalsa-door/src/lib.rs:24-30`
   — `An event-stream answer is different in one way: it becomes a job. The` / `door numbers every
   event (`id: <token>:<index>`, the standard SSE id the` / `client echoes back as
   `Last-Event-ID`)` … `A phone that disappears mid-answer leaves` / `the generation running; when
   it comes back and sends its last seen id,` / `the door replays what it missed and then follows
   the tail live`. It needs the same bearer credential, and a job answers only to the device that
   started it (`:31-34`). A job that is gone answers **410** (`crates/kalsa-door/src/proxy.rs:399`).
   Detaching does not stop the generation. So a phone's "stop waiting" does not cancel anything on
   the computer.

**Every status the door can write, for the phone's refusal table** (beyond 200 and the engine's
own statuses, which it relays):

| status | body | from |
|---|---|---|
| 401 | empty | unknown or revoked credential (`lib.rs:113-116`), and also a request head the door read and found malformed (`proxy.rs:110-119` → `refuse`, `proxy.rs:501-502`) |
| 403 | one sentence | the engine's `/slots` routes, refused (`slot_routes.rs:148-154`) |
| 410 | one sentence | a resume the door will not serve (`proxy.rs:399`): a job gone, evicted or owned by another device (`jobs.rs:206`), a cursor past what it holds (`jobs.rs:209`), or an id it cannot parse (`proxy.rs:383`) |
| 503 | empty | acceptor cap or full queue (`server.rs:163-182`), head patience spent (`proxy.rs:101-116`), job registry refusing (`proxy.rs:332-340`); the cause is not distinguishable |
| 503 | one sentence | no seat for an authenticated device (`lib.rs:158-175`) |
| 502 | empty | the engine unreachable (`proxy.rs:262-266`) |
| 204 / 400 / 404 / 500 / 501 / 502 | varies | door's own `/kalsa/` chat routes (`paging.rs:173-188`, `paging/io.rs:47-54`) |

And a connection can also close with no HTTP response at all: when the engine fails mid-head
(`proxy.rs:305`), and because the pairing desk's refusals are best-effort writes
(`transport.rs:477`). The pairing desk itself answers only 200 or an empty 403
(`transport.rs:430-445`, `:481`).

## The phone session's three extra questions

- **A short code to type if the camera will not focus?** Not found. The code is 32 hex
  (`crates/kalsa-pairing/src/qr.rs:19`, `"code":"<32 hex>"`), and the desktop never shows it as
  text: the page shows the square plus `chat/src/surfaces/DevicesSurface.tsx:13` —
  `const CAMERA_INSTRUCTION = "Point your phone's camera at the square.";`. A typed fallback would
  be a new desktop state as well as a phone one.
- **Where does the computer's name come from, and can it be wrong?** Nowhere in the protocol
  (fact 5).
- **What does the desktop show while a phone is scanning?** Scanning itself is invisible to the
  desktop, because nothing reaches it until a claim arrives. While the square is up, it shows the
  camera instruction and `chat/src/surfaces/DevicesSurface.tsx:14` — `Anyone who can see this square
  can connect a phone — show it only to yours.`. Once a claim lands, `:160` — `sentence = "A phone is
  connecting right now.";`. When it is saved, `:53-54` (Q5 below).

## The recon, question by question

Repo `/Users/marco/Projects/kalsa-brain`, branch `brain`, HEAD `4dc4b0f`. "doc" means a comment or
docstring only, not behaviour. Drafted by a read-only explorer. The brain session checked the
load-bearing quotes with `grep -nF` and corrected three line numbers: `lib.rs:88-90`,
`transport.rs:437-441`, `DevicesSurface.tsx:185`.

## Q1 — What the desktop encodes in the QR

Payload struct (code) — `crates/kalsa-pairing/src/payload.rs`:
- `payload.rs:28` — `struct QrPayloadV3 {`
- version: `payload.rs:29` — `v: u8,`; value `payload.rs:22` — `const VERSION: u8 = 3;`
- address+port: `payload.rs:30-33` — `/// How the phone reaches this computer on the LAN for the claim itself:` / `/// the pairing desk's own address (for example` / `/// `http://192.168.1.10:4952`). Covered by the phone's completion MAC,` / `/// like everything else the square showed.`; field `payload.rs:34` — `reachable: String,` (one URL = address+port; no separate port field)
- one-time code: `payload.rs:35` — `/// The one-time code, hex. Single use; keyed on for both completion MACs.`; field `payload.rs:36` — `code: String,`
- nonce: `payload.rs:37-38` — `/// The per-offer nonce, hex — fresh with every QR, covered by the phone's` / `/// and the computer's MACs alike (`messages`).`; field `payload.rs:39` — `nonce: String,`
- iroh node id (optional): `payload.rs:40-42` — `/// The iroh node id of this machine, hex — present only while the` / `/// internet road is open. The phone dials the inference road by these 32` / `/// public bytes after pairing,`; omission rule `payload.rs:44-45` — `/// field itself, not an empty string — whenever the road is not open:`; field `payload.rs:48-49` — `#[serde(skip_serializing_if = "Option::is_none")]` / `node: Option<String>,`
- **certificate fingerprint: not found** (searched `grep -rin "fingerprint\|cert" crates/kalsa-pairing/src src-tauri/src/pairing.rs` → no hits).
- **expiry field: not found in the QR** — expiry lives desktop-side: `src-tauri/src/pairing.rs:36` — `const WINDOW: Duration = Duration::from_secs(120);`

The line that builds it:
- `payload.rs:55-61` — `pub(crate) fn encode(` / `reachable: &str,` / `code: &OneTimeCode,` / `nonce: &[u8; NONCE_BYTES],` / `node: Option<&str>,` / `) -> Option<String> {` / `serde_json::to_string(&QrPayloadV3 {` (fields assigned `payload.rs:62-66`: `v: VERSION,` / `reachable: reachable.to_string(),` / `code: code.hex(),` / `nonce: hex::encode(nonce),` / `node: node.map(str::to_string),` / `})`)
- Call chain: `src-tauri/src/pairing.rs:528` — `let Ok(pairing) = Pairing::offer(reachable, node, now, WINDOW) else {`; `:531` — `let Some(payload) = pairing.qr_payload() else {`; `:534` — `match kalsa_pairing::qr_svg(&payload) {`
- `reachable` value: `src-tauri/src/main.rs:800` — `let reachable = listener.address().to_string();`, listener `src-tauri/src/transport.rs:128` — `let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;`, address `transport.rs:131` — `let address = format!("http://127.0.0.1:{port}");`
- `node` value: `src-tauri/src/main.rs:1230` — `let road_node_id = brain.road_node_id();`, source `main.rs:298-300` — `pub(crate) fn road_node_id(&self) -> Option<String> {` … `road::RoadState::Open { node_id } => Some(node_id),`
- Symbol: `crates/kalsa-pairing/src/qr.rs:43` — `pub fn qr_svg(payload: &str) -> Result<String, PayloadTooLong> {`, `:45` — `QrCode::encode_binary(payload.as_bytes(), QrCodeEcc::Medium).map_err(|_| PayloadTooLong)?;`
- doc (format example, **says v2 while code is v3**): `qr.rs:18-19` — `//! Size arithmetic, worked out rather than guessed: `payload::encode` emits` / `//! `{"v":2,"reachable":"http://192.168.1.10:4952","code":"<32 hex>","nonce":"<64 hex>"}``

## Q2 — How the phone proves it is the right phone

Two gates, both keyed on QR secrets; **no second code shown on any screen and no confirmation click: not found** (searched `grep -rin "confirm\|code.*display\|type.*code" src-tauri/src/pairing.rs chat/src/surfaces/DevicesSurface.tsx crates/kalsa-pairing/src` → only MAC/"phone verifies" docs; the page offers only `chat/src/surfaces/DevicesSurface.tsx:13` — `const CAMERA_INSTRUCTION = "Point your phone's camera at the square.";`)

Gate 1 — claim the code:
- `crates/kalsa-pairing/src/ceremony.rs:160` — `pub fn claim(&mut self, presented: &str, now: SystemTime) -> ClaimResult {`
- `ceremony.rs:172` — `let accepted = offer.code.matches_hex(presented);`
- uniform refusal, single use: `ceremony.rs:13-15` — `//! * the code is single-use. The first successful claim consumes it — and` / `//!   any later claim, right code included, gets the same `Rejected`, because` / `//!   to a code-guesser "already used" is information worth mining;`; `ceremony.rs:18` — `//! * a rejection never says how wrong the presentation was;`

Gate 2 — completion MAC (one attempt):
- `ceremony.rs:19-21` — `//! * completion is a second gate and a one-shot: the phone proves knowledge` / `//!   of the code with a MAC over the per-offer nonce and its metadata, and a` / `//!   proof that fails burns the ceremony — one attempt, per completion, ever.`
- `ceremony.rs:233-241` — `if !verify_phone_mac_with_token(` / `claimed.code.bytes(),` / `&claimed.nonce,` / `claimed.reachable.as_str(),` / `claimed.node.as_deref().unwrap_or_default(),` / `declaration.delivery_token(),` / `&declaration.phone,` / `declaration.mac` (verbatim: `&declaration.mac,`) / `) {`; failure burns: `ceremony.rs:243` — `return Err(CompleteError::Refused);`
- `ceremony.rs:220-222` — `pub fn complete(` / `&mut self,` / `declaration: PhoneDeclaration,`

Desktop's stance (doc): `src-tauri/src/pairing.rs:16-19` — `//! * **A completed ceremony is the authorisation.** Nobody reaches the` / `//!   ceremony without scanning a code this computer displayed, so the owner` / `//!   showing the square IS the decision: completing the ceremony adds a` / `//!   device to the house.`

Phone signs with the shared crate: `crates/kalsa-pairing/src/messages.rs:164-170` — `pub fn sign(` / `code: &str,` / `nonce: &str,` / `reachable: &str,` / `node: Option<&str>,` / `phone: PhoneModel,` / `) -> Option<Self> {`; the values it must use: `messages.rs:158-159` — `//! `code`, `nonce`, `reachable` and `node` are the values out of the` / `//! square — `node` the square's node id, or `None` when the square`

## Q3 — What each side holds; QR across network changes

Phone afterwards holds:
- the credential, delivered encrypted inside the response seal: `ceremony.rs:249-250` — `let credential = Credential::generate().map_err(|_| CompleteError::Entropy)?;` / `let seal = seal_computer(claimed.code.bytes(), &claimed.nonce, &credential);`; seal field doc `messages.rs:261-263` — `/// The credential encrypted under the QR's one-time secret and nonce.` / `/// It is opaque to an intermediary that only carries this response.` / `credential_ciphertext: String,`
- the response body: `src-tauri/src/transport.rs:441-443` — `Some(Answer {` / `body: serde_json::to_string(&seal).ok()?,` / `delivery_token: Some(token),`
- its delivery token: `messages.rs:197-199` — `/// The phone keeps this opaque token with its in-flight attempt. It is` / `/// signed inside `mac`; it is not a credential and is safe to serialize.` / `pub fn delivery_token(&self) -> &str {`
- the `reachable` address and optional `node` it scanned (Q1 fields).
- **device id on the phone: not found** — ids are minted only on the desktop: `crates/kalsa-pairing/src/store.rs:391` — `let id = next_id(&records)?;`, `store.rs:412-413` — `fn next_id(records: &[StoredDeviceRecord]) -> Result<u32, StoreError> {` / `match records.iter().map(|record| record.id).max() {` (searched `grep -rn "device_id\|DeviceId" crates/kalsa-pairing/src/{messages,handshake,payload}.rs` → no hits).

Desktop stores:
- `src-tauri/src/pairing.rs:449` — `match kalsa_pairing::store::add_device_with_delivery(`; `store.rs:368-373` — `pub fn add_device_with_delivery(` / `path: &Path,` / `label: &str,` / `handshake: &Handshake,` / `delivery: Delivery,` / `) -> Result<StoredDevice, StoreError> {`
- file: `src-tauri/src/main.rs:50` — `const PAIRING_FILE: &str = "pairing.json";`; `main.rs:1184` — `Ok(dir.join(PAIRING_FILE))`; `main.rs:1368` — `let file = app.path().app_data_dir()?.join(PAIRING_FILE);`; doc `store.rs:1` — `//! The credential store: the handshake result, on disk, owner-only.`

Validity / network change:
- one-shot + 120 s wall clock: `ceremony.rs:13` (single-use, above); `pairing.rs:36` — `const WINDOW: Duration = Duration::from_secs(120);`; `ceremony.rs:39-41` — `/// The deadline is **wall-clock time, and that is a decision.** The window` / `/// exists so a code photographed and abandoned stops working within minutes` / `/// of *real* time — and the likeliest way minutes become hours is the`
- auto-replaced, never left stale: `src-tauri/src/pairing.rs:270-271` — `pairing.expire_if_due(now);` / `if matches!(pairing, Pairing::Expired) {` → `:276` — `*state = Self::fresh(reachable, node, now, Some(Refreshed::Expired), previous);`
- network change: **doc only** — `pairing.rs:11-15` — `//! * **The square advertises loopback and nothing else.** `reachable` is` / `//!   built here from the listener's own bound address, which `transport`` / `//!   binds on `127.0.0.1`. The phone arrives through a tunnel, exactly as it` / `//!   does for the inference server; nothing is opened on the LAN, not even` / `//!   for the length of a window.` (code corroboration is only the loopback bind, `transport.rs:128`). The port is per-process (`:0`), so a QR never outlives a restart anyway.

## Q4 — First move after scanning

Pairing: two plain POSTs on the pairing transport, no challenge round-trip —
- first request: `src-tauri/src/transport.rs:430-435` — `("POST", "/pair/claim") => {` / `let claim: Claim = serde_json::from_slice(&request.body).ok()?;` / `desk.claim(&claim.code, now).then_some(Answer {` / `body: String::from("{}"),` / `delivery_token: None,` / `}`; body type `transport.rs:447-449` — `#[derive(serde::Deserialize)]` / `struct Claim {` / `code: String,`
- then: `transport.rs:437-441` — `("POST", "/pair/complete") => {` / `let declaration: kalsa_pairing::PhoneDeclaration =` / `serde_json::from_slice(&request.body).ok()?;` / `let token = declaration.delivery_token().to_string();` / `let seal = desk.complete(declaration, now)?;`
- anything else: `transport.rs:445` — `_ => None,` → refused at `transport.rs:417` — `} else if let Err(error) = refuse(&mut stream, deadline) {` (403 bytes, Q6).

Door, first request from a new device — an ordinary authenticated request, no handshake at the door:
- `crates/kalsa-door/src/proxy.rs:143-145` — `let device = match authenticated(head.authorization.as_deref(), &current) {` / `Some(device) => device,` / `None => {`
- Bearer format: `proxy.rs:437-440` — `let format_ok = value.is_some_and(|value| {` / `value.len() == b"Bearer ".len() + TOKEN_BYTES && value.starts_with(b"Bearer ") && {` / `presented.copy_from_slice(&value[b"Bearer ".len()..]);` / `true`
- then the slot lease: `proxy.rs:174-176` — `let lease = match devices.lease(device) {` / `Ok(lease) => lease,` / `Err(LeaseError::NotHeld) => {`

## Q5 — Desktop copy on failure (exact strings, for register-matching)

Stale/replaced square — `chat/src/surfaces/DevicesSurface.tsx:16-17`:
- `expired: "The previous square expired — this one is fresh.",`
- `"wrong-code": "A square that did not match was replaced — this one is fresh.",`
(`wrong-code` set at `src-tauri/src/pairing.rs:366` — `let refreshed = matches!(*state, State::Live { .. }).then_some(Refreshed::WrongCode);`; tokens defined `pairing.rs:46-49` — `Self::Expired => "expired",` / `Self::WrongCode => "wrong-code",`)

Pairing states/failures — `chat/src/surfaces/DevicesSurface.tsx`:
- `:144` — `sentence = "This computer is not running yet, so there is nothing for your phone to connect to.";`
- `:150` — `sentence = "The square is not ready yet — it will appear here in a moment.";`
- `:153` — `sentence = CAMERA_INSTRUCTION;` (= `:13` `Point your phone's camera at the square.`) and `:156` — `note = AWARENESS;` (= `:14` `Anyone who can see this square can connect a phone — show it only to yours.`)
- `:160` — `sentence = "A phone is connecting right now.";`
- could-not-read: `:177` — `"This computer could not read its existing phone connection. Fixing permissions and trying again may help.";`
- service-unavailable: `:185` — `sentence = "The local pairing service stopped. Restart the app to make pairing available again.";`
- could-not-save (incl. replay): `:192` — `"Your phone connected, but this computer could not save the connection. Trying again usually works.";`
- paired: `:53-54` — `` ? `This computer saved the connection for ${dto.phone ?? "your phone"}; the phone still needs to receive it.` `` / `` : `This computer now works with ${dto.phone ?? "your phone"}.`; ``
- failure tokens from the DTO: `src-tauri/src/pairing.rs:588` — `failure: Some("could-not-save"),`; `:593` — `failure: Some("could-not-read"),`; `:598` — `failure: Some("service-unavailable"),`

Denied (source of `chat/shots/05-denied.png` — note: under `chat/`, not repo root):
- `chat/scripts/shots.mjs:219` — `() => document.querySelector(".thread")?.textContent?.includes("did not accept the key"),`
- the copy: `chat/src/components/Thread.tsx:36-37` — `title: "The server did not accept the key.",` / `body: "It answered 401 — the token is missing, wrong, or expired. Check it in Settings and try again.",`
- 403 variant `Thread.tsx:32-33` — `title: "The server refused the key.",` / `body: "It answered 403 — the key works but is not allowed here. Check it in Settings and try again.",`
- unreachable `Thread.tsx:41` — `title: "The server could not be reached.",`
- trigger `shots.mjs:211` — `settings: { endpoint: "http://127.0.0.1:18081/denied", token: "wrong", model: "x" },`; mock `chat/scripts/mock-server.mjs:238-240` — `if (req.url === "/denied/v1/chat/completions") {` … `res.writeHead(401, { "Content-Type": "application/json", ...CORS });`
- "desktop unreachable" from the phone: no desktop string exists (the desktop cannot speak when it is unreachable) — not found.

## Q6 — "The queue that exists and refuses"

Two bounded queues; both refuse with empty bodies.

Pairing transport (`src-tauri/src/transport.rs`):
- bounds `:25-31` — `const PATIENCE: Duration = Duration::from_secs(10);` / `const CONNECTION_LIFETIME: Duration = Duration::from_secs(30);` / `const WORKERS: usize = 4;` / `const QUEUE: usize = 8;` / `const MAX_CONNECTIONS: usize = WORKERS + QUEUE;`; queue `:183` — `let (sender, receiver) = mpsc::sync_channel(QUEUE);`
- refuse condition: `:4-7` — `//! The acceptor reads incomplete requests without tying up a route worker.` / `//! Active sockets and complete-request queue entries are both bounded, and a` / `//! full bound gets a best-effort 403 without making the acceptor wait for a` / `//! peer that refuses to read.`; code `:237` — `match sender.try_send(work) {`, `:240` — `refuse_connection(&mut work.stream, &logger);`
- response `:481` — `stream.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")` → **403, empty body**.

Inference door (`crates/kalsa-door`):
- `lib.rs:88-90` — `const WORKERS: usize = 4;` / `const QUEUE: usize = 8;` / `const MAX_CONNECTIONS: usize = WORKERS + QUEUE;`
- refuse conditions: `server.rs:163-164` — `if connections.load(Ordering::SeqCst) >= MAX_CONNECTIONS {` / `reject_busy(&mut stream);`; `server.rs:179,181-182` — `match sender.try_send(work) {` … `Err(mpsc::TrySendError::Full(mut work)) => {` / `reject_busy(&mut work.stream);`; `server.rs:249-251` — `fn reject_busy(stream: &mut TcpStream) {` / `let _ = stream.set_nonblocking(true);` / `let _ = std::io::Write::write_all(stream, BUSY_RESPONSE);`
- queued-but-unread/late head: `proxy.rs:101` — `let head_deadline = deadline.min(started + head_patience);`; `proxy.rs:105` — `let _ = write_with_deadline(&mut client, BUSY_RESPONSE, head_deadline);`; `proxy.rs:116` — `let _ = write_with_deadline(&mut client, BUSY_RESPONSE, deadline);`
- response `lib.rs:125-126` — `pub(crate) const BUSY_RESPONSE: &[u8] =` / `b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";` → **503, empty body**; with origin after a read head `lib.rs:132-135` — `pub(crate) fn busy_response(origin: Option<&[u8]>) -> Vec<u8> {` … `"HTTP/1.1 503 Service Unavailable\r\n{origin_headers}Content-Length: 0\r\nConnection: close\r\n\r\n"`
- the queue is pre-authentication: connection counted on accept (`server.rs:163`), credential read later (`proxy.rs:143`).

## Q7 — "The sentences it owes a waiting device"

Status is asserted in a doc: `docs/WHAT-IS-MISSING.md:229-231` — `None of it exists in code. What it needs first is §1 (done) and a queue that is` / `ours — the addendum below: the queue now exists and refuses, but the sentences it` / `owes a waiting device do not.` (header `:221` — `## 10. The room is designed and not built`). Also doc: `docs/HOUSEHOLD-RULES.md:169-170` — `second prompt from someone who already has one waiting is **refused with an honest message**,` / `not silently accepted — the same rule the door's queue has to obey everywhere.`

Sentences that exist **in code** today:
1. Authenticated device, no slot (the one spoken sentence): `crates/kalsa-door/src/lib.rs:158` — `pub(crate) fn no_slot_response(capacity: u32, origin: Option<&[u8]>) -> Vec<u8> {`; words `lib.rs:167-170` — `"This computer is set up for {seats} at once, and one of them is this computer. Every \` / `seat is taken. Turning the assistant off and on again re-plans the seats from the \` / `devices stored now; if it still cannot fund one seat per stored device, lower the \` / `context in Advanced, or forget a device on the Devices page."`; status `lib.rs:174-175` — `"HTTP/1.1 503 Service Unavailable\r\n{origin_headers}\` / `Content-Type: text/plain; charset=utf-8\r\n\`; fired at `proxy.rs:181,183` — `Err(LeaseError::NoRoom) => {` … `let _ = write_with_deadline(&mut client, &no_slot_response(capacity, head.origin.as_deref()), deadline);`
2. Pool/queue pressure — **no sentence**: `lib.rs:125-126` (BUSY, `Content-Length: 0`, Q6).
3. Unknown credential — **no sentence**: `lib.rs:116` — `"HTTP/1.1 401 Unauthorized\r\n{origin_headers}Content-Length: 0\r\nConnection: close\r\n\r\n"` (fn `:113` — `pub(crate) fn unauthorized_response(origin: Option<&[u8]>) -> Vec<u8> {`); fired `proxy.rs:143,145`.
4. Pairing transport refusal — **no sentence**: 403 empty body (`transport.rs:481`, Q6).
5. Owner-facing stderr, not a client sentence: `src-tauri/src/startup.rs:654-657` — `"kalsa-brain: {requested_parallel} devices are enrolled on this computer, but the \` / `plan funds only {affordable} of them at once; the plan is for {affordable} devices, \` / `and the door will refuse the rest with a sentence saying the seats are full and \` / `naming no device.`

Room-specific sentences (turn order, "your turn"): **not found** — searched `grep -rin "your turn\|whose turn\|rotation\|waiting device\|waiting device" src-tauri/src crates/kalsa-door/src chat/src` → only the `docs/WHAT-IS-MISSING.md:230` line above.

## Q8 — Is a phone's seat tied to pairing?

Chain credential → DeviceId → slot, all keyed by the stored pair record:
1. Store record → door types: `src-tauri/src/main.rs:503-506` — `kalsa_door::DeviceEntry::new(` / `kalsa_door::DeviceId::new(device.id),` / `device.label,` / `device.handshake.credential_hex(),`; set built `main.rs:512` — `kalsa_door::Devices::new(entries).map_err(|_| {`; id minted at pairing `store.rs:391` / `:412-413` (Q3).
2. Credential → DeviceId at request time: `crates/kalsa-door/src/devices.rs:134,138,142,144` — `pub(crate) fn authenticate(&self, presented: &[u8; TOKEN_BYTES]) -> Option<DeviceId> {` / `let equal = presented.ct_eq(&entry.credential).unwrap_u8();` / `matched |= entry.id.0 & (u32::from(equal)).wrapping_neg();` / `(any == 1).then_some(DeviceId(matched))`
3. DeviceId → slot: `crates/kalsa-door/src/slots.rs:138` — `pub(crate) fn lease(&self, device: DeviceId) -> Result<SlotLease<'_>, LeaseError> {`; `slots.rs:152-155` — `let slot = match slots.assigned.get(&device) {` / `Some(&slot) => slot,` / `None => {` / `let Some(slot) = slots.free.iter().next().copied() else {`; sticky map `slots.rs:51` — `assigned: HashMap<DeviceId, u32>,`
4. Pairing count → capacity: `src-tauri/src/main.rs:1193-1197` — `fn enrolled_devices(file: &Path) -> u32 {` / `kalsa_pairing::store::load_devices(file)` / `.map(|devices| u32::try_from(devices.len()).unwrap_or(u32::MAX))` / `.unwrap_or(0)`; `main.rs:1056` — `let devices = enrolled_devices(&pairing_file(&app)?);`; doc `main.rs:1053-1055` — `// How many seats the door must hold: this computer and every paired` / `// phone. A seat is reserved per stored device for as long as it is` / `// stored, so this is the enrolled set, not who is talking right now.`; `main.rs:567` — `let capacity = door_capacity(capacity, engine);`; `main.rs:515-516` — `// The door's capacity is the engine's slot count: the same` / `// `--parallel` value the launcher rendered,`

Room-like things **not** keyed by a paired device:
- the door's accept/queue budget: raw connection counted before any credential (`server.rs:163`, Q6); BUSY applies to whoever connects.
- CORS preflight, served with no device and no slot: `proxy.rs:132` — `if head.preflight {`; comments `proxy.rs:126-129` — `// browser sends it WITHOUT the credential it is asking permission to` … `// credential is read, no slot is leased, nothing is counted against the`
- the pairing transport queue (403), entirely pre-auth (Q6).
- an actual room object (shared conversation with a member list): **not found in code** — doc only: `docs/HOUSEHOLD-RULES.md:76` — `**A room must be a different object from a private chat, not a flag on one.**` and `docs/WHAT-IS-MISSING.md:229` — `None of it exists in code.`

## Pool constants a waiting phone sees (quick reference)
- `crates/kalsa-door/src/lib.rs:88-90` — `const WORKERS: usize = 4;` / `const QUEUE: usize = 8;` / `const MAX_CONNECTIONS: usize = WORKERS + QUEUE;`
- pool/queue full → `lib.rs:125-126` — `b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";` (`server.rs:163-164`, `:179-182`)
- authenticated, no slot → 503 **with** the sentence (`lib.rs:167-170`)
- pairing transport separately: `transport.rs:27-31` WORKERS 4 / QUEUE 8 / MAX_CONNECTIONS → 403 empty (`transport.rs:481`)

## Not found / searched
- `pairing.js` or a 261-line wizard: **not found.** Searched: `find chat/src -name "*.ts*" | xargs wc -l | awk '$1==261'` (no hit); `grep -rin "wizard" chat/src chat/scripts src-tauri crates docs` → only `docs/DESKTOP-CHAT-DECISION.md:80,119,139`, `docs/WHAT-IS-MISSING.md:157` (`The chat is now the kalsa-brain frontend. The four wizard panels became the four`), `docs/DESKTOP-FEATURES-ALREADY-OURS.md:129`. The live pairing UI is `chat/src/surfaces/DevicesSurface.tsx`.
- `shots/05-denied.png` at repo root: **not found** — actual path `chat/shots/05-denied.png` (`find . -name "05-denied*" -not -path "./chat/node_modules/*"`).
- QR certificate fingerprint, QR expiry field: not found (Q1).
- Phone-held device id: not found (Q3).
- Second on-screen code / desktop confirmation click: not found (Q2 searches).
- Room/turn-order sentences in code: not found (Q7 search).
