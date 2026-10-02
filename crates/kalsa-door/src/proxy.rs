use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::cors;
use crate::devices::{DeviceId, Devices};
use crate::jobs::ResumeDecision;
use crate::paging;
use crate::registry::{Registry, StartRefused};
use crate::room;
use crate::token::parse_resume;
use crate::request;
use crate::response;
use crate::slot_routes;
use crate::stream;
use crate::{busy_response, no_slot_response, unauthorized_response, upstream_failure_response, ActiveDevices, BUSY_RESPONSE, CONNECTION_LIFETIME, DeviceSet, LeaseError, PATIENCE, TOKEN_BYTES};
use crate::clocks::Clocks;

/// The observer type every serving path shares: it sees exactly the bytes
/// the client receives, never a byte it does not.
pub(super) type Observed = dyn Fn(&[u8]) + Send + Sync;

/// The conditions under which an in-flight exchange stops: the door is
/// shutting down, or the device it serves was revoked while the answer was
/// streaming. Checked between relay steps. The revocation half takes a
/// short read lock to look at an `Arc`; no lock is held across a streamed
/// body, so one long answer cannot serialize the house. The revocation gate
/// is the one deliberate exception: held across a head write, never across
/// the stream that follows.
pub(super) struct Cancel<'a> {
    stop: &'a AtomicBool,
    devices: &'a DeviceSet,
    device: DeviceId,
}

impl Cancel<'_> {
    pub(super) fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst) || !self.devices.holds(self.device)
    }

    /// The shared guard for a head write: the revocation check and the write
    /// are one step, so a `swap` that lands here waits for both.
    pub(super) fn revocation_gate(&self) -> std::sync::RwLockReadGuard<'_, ()> {
        self.devices.revocation_gate()
    }
}

/// Whether this request generates tokens into the slot, and so is the one
/// kind that can make the slot's state differ from the file that holds it.
/// A suffix, not an equality: the webview sends `/chat/completions` and a
/// phone may send `/v1/chat/completions`, and either can carry a query string.
/// `/props`, `/health`, `/tokenize` and the model listing are forwarded by the
/// same path and change nothing; marking one of those would spend a save —
/// hundreds of megabytes — on a slot the file already holds.
fn is_completion(target: &[u8]) -> bool {
    let path = target.split(|byte| *byte == b'?').next().unwrap_or(target);
    path.ends_with(b"/completions") || path.ends_with(b"/completion")
}

/// The disk tier's mark, and the reason it is a guard and not a step at the
/// end: what the tier clocks is the slot's *silence*, and the silence of a turn
/// starts when its last byte reached the client, not when its request went out.
/// A slot whose completion is still generating is not quiet — a tick would write
/// out a prefix of the answer the engine is still making — and one whose client
/// hung up mid-answer, or whose request only half reached the engine, has still
/// had a turn write into it. Every way out of the request from the relay on is
/// one of those, which is what `Drop` gets and a call at the end does not.
struct SlotTurn<'a> {
    chats: &'a paging::Chats,
    slot: u32,
    generating: bool,
}

impl Drop for SlotTurn<'_> {
    fn drop(&mut self) {
        if self.generating {
            self.chats.mark_dirty(self.slot);
        }
    }
}

/// The door's shared state, one per door: the stop flag, the live device
/// set, the room, and the disk tier's map. Built in `server::start`; workers
/// and the room's threads hold it whole.
pub(super) struct Shared {
    pub(super) stop: Arc<AtomicBool>,
    pub(super) set: Arc<DeviceSet>,
    pub(super) room: Option<Arc<crate::room::RoomDoor>>,
    /// The engine's loopback port, for the room's turns — everything else
    /// reaches the engine through a client's own request.
    pub(super) port: u16,
    /// The per-slot context the launch funded (`--ctx-size /
    /// `--parallel`), for the room's transcript budget. `None` when the
    /// door was built without one; the turn then keeps the fallback.
    pub(super) slot_context: Option<u64>,
    /// The door's limits on the engine's answers and on queueing.
    pub(super) clocks: crate::clocks::Clocks,
    /// The disk tier's map, the same object every worker serves with: a seat
    /// the set hands between devices is a handover this map must hear about
    /// (`paging::Chats::handover`), wherever the new holder's request comes
    /// from — a client's or the room turn's own.
    pub(super) chats: Arc<paging::Chats>,
}

pub(super) fn handle(
    mut client: TcpStream,
    accepted: Instant,
    head_patience: Duration,
    upstream_port: u16,
    capacity: u32,
    shared: &Arc<Shared>,
    registry: &Registry,
    active: &ActiveDevices,
    observer: Option<&Observed>,
) {
    let devices: &DeviceSet = &shared.set;
    let stop: &AtomicBool = &shared.stop;
    let chats: &paging::Chats = &shared.chats;
    // Everything below is counted from the moment this worker took the
    // connection up, not from accept: a client that waited in the line for a
    // worker is not punished for the wait with a budget already spent. The
    // wait has a bound of its own, enforced by the accept loop (`queue_wait`).
    let started = Instant::now();
    let deadline = started + CONNECTION_LIFETIME;
    if started.saturating_duration_since(accepted) >= shared.clocks.queue_wait {
        let _ = write_with_deadline(&mut client, BUSY_RESPONSE, deadline);
        return;
    }
    let mut head = {
        let head_deadline = deadline.min(started + head_patience);
        // A connection past its lifetime is dead on arrival: it is closed
        // rather than read, whatever the head patience would say.
        if Instant::now() >= head_deadline {
            let _ = write_with_deadline(&mut client, BUSY_RESPONSE, head_deadline);
            return;
        }
        match request::read_head(&mut client, head_deadline) {
            Ok(head) => head,
            Err(()) => {
                // Two different facts, two different answers. If the
                // patience was already spent, the door never read a byte:
                // that is pressure, and the answer is the busy one. A head
                // that was read and found wanting is the unauthorized one.
                if Instant::now() >= head_deadline {
                    let _ = write_with_deadline(&mut client, BUSY_RESPONSE, deadline);
                } else {
                    // No head was parsed, so there is no origin to name.
                    let _ = refuse(&mut client, None, deadline);
                }
                return;
            }
        }
    };
    // A CORS preflight is answered here, before the credential scan: the
    // browser sends it WITHOUT the credential it is asking permission to
    // send, so authenticating it would answer `401` and the real request
    // would never leave the webview. This answer grants nothing — no
    // credential is read, no slot is leased, nothing is counted against the
    // capacity, and the upstream is never contacted — which is why it is
    // safe to give without one.
    if head.preflight {
        // The 204 must be readable: an unread body resets the socket on
        // close and erases it, the same trap the refusal path exists for.
        let _ = discard_request_body(&mut client, head.body_length, deadline);
        let _ = write_with_deadline(&mut client, &cors::preflight(head.origin.as_deref()), deadline);
        return;
    }
    // Authentication reads the CURRENT set, as a short-lived Arc: the lock
    // is gone by the time the credential scan runs, and the scan sees
    // either the whole old set or the whole new one.
    let current = devices.current();
    let device = match authenticated(head.authorization.as_deref(), &current) {
        Some(device) => device,
        None => {
            // The refusal must be readable: an unread body would reset the
            // socket on close and erase it. The body is bounded and the read is
            // deadline-bound; the request still goes nowhere.
            let _ = discard_request_body(&mut client, head.body_length, deadline);
            let _ = refuse(&mut client, head.origin.as_deref(), deadline);
            return;
        }
    };
    // The engine's own slot routes are addressed by URL and never consult the
    // slot header, so a paired device that reaches them reads or changes a
    // slot the door did not give it — `GET /slots` reports every slot's
    // prompt. Refused here, after the credential and before any lease: an
    // unauthenticated stranger still gets the 401 alone, and an authenticated
    // device spends no capacity, opens no upstream socket and forwards no
    // byte for a route the door will not serve.
    if slot_routes::is_slot_route(&head.target) {
        let _ = discard_request_body(&mut client, head.body_length, deadline);
        let answer = slot_routes::refusal_response(head.origin.as_deref());
        let _ = write_with_deadline(&mut client, &answer, deadline);
        return;
    }
    // The device's engine slot, under a lease that lasts the whole request.
    // Membership and allocation are one critical section: a device revoked
    // in the window between authentication and here is refused with the 401
    // rather than handed a slot it would keep forever, and a full house is
    // refused with the no-slot 503. The engine does not refuse for us (it
    // wraps `id_slot % slots.size()`), so the door is the only thing
    // standing between a device and somebody else's slot.
    let lease = match devices.lease(device) {
        Ok(lease) => lease,
        Err(LeaseError::NotHeld) => {
            let _ = discard_request_body(&mut client, head.body_length, deadline);
            let _ = refuse(&mut client, head.origin.as_deref(), deadline);
            return;
        }
        Err(LeaseError::NoRoom) => {
            let _ = discard_request_body(&mut client, head.body_length, deadline);
            let _ = write_with_deadline(&mut client, &no_slot_response(capacity, head.origin.as_deref()), deadline);
            return;
        }
    };
    // A seat taken from another device is a handover the disk tier must hear
    // about before this request writes into it: the evicted device's chat is
    // saved under its own name and the slot stops being named for it — or
    // `save_idle` would write this request's words into that chat's file and
    // the evicted device's next `activate` would early-return on a
    // stranger's state as its own. A save the engine refuses answers this
    // request with the same refusal `activate` gives: nothing has been sent
    // to the engine on this path, so the slot still holds what the map says.
    if let Some(evicted) = lease.evicted() {
        if let Err(error) = chats.handover(devices, lease.slot(), evicted, upstream_port) {
            let _ = discard_request_body(&mut client, head.body_length, deadline);
            let answer = error.answer(head.origin.as_deref());
            let _ = write_with_deadline(&mut client, &answer, deadline);
            return;
        }
    }
    // Presence for the running door: this device, exactly while the door is
    // inside this request. Only an authenticated, slotted device is counted.
    let _active = active.enter(device);
    let cancel = Cancel {
        stop,
        devices,
        device,
    };
    // The door's own disk tier. Served here — after the credential, under the
    // slot's lease, and before any upstream socket is opened — and never
    // forwarded: the two chat routes have no counterpart in the engine, and
    // `/slots/*` above is refused for the same reason in the other direction.
    // A device revoked in the window since authentication gets the 401 the
    // rest of the door gives, because the salt is read before anything is
    // written anywhere.
    // The room's five routes, served by the door on the credential that
    // authenticated it. Before the disk tier because the tier owns the
    // same prefix: a room path that fell through to it would be answered
    // as an unknown chat route instead of an unknown room one.
    if room::owns(&head.target) {
        room::serve(
            client,
            room::Request {
                head: &head,
                device,
                devices: &current,
                room: shared.room.as_ref(),
                shared,
            },
            deadline,
        );
        return;
    }
    if paging::owns(&head.target) {
        let Some(salt) = devices.cache_salt(device) else {
            let _ = discard_request_body(&mut client, head.body_length, deadline);
            let _ = refuse(&mut client, head.origin.as_deref(), deadline);
            return;
        };
        let answer = chats.serve(
            &mut client,
            &head,
            device,
            salt,
            lease.slot(),
            upstream_port,
            deadline,
        );
        let _ = write_with_deadline(&mut client, &answer, deadline);
        return;
    }
    if let Some(last_event_id) = head.last_event_id.as_deref() {
        // Resuming never reaches the upstream: the answer this request asks
        // for already exists in the door or it does not. The retried body is
        // read and discarded first — an unread body sitting in the receive
        // buffer makes the kernel reset the socket on close, and a reset
        // erases everything the client had not read yet.
        if discard_request_body(&mut client, head.body_length, deadline).is_err() {
            return;
        }
        resume(
            &mut client,
            registry,
            last_event_id,
            head.origin.as_deref(),
            device,
            observer,
            deadline,
            &cancel,
        );
        return;
    }
    // The salt is fetched BEFORE any upstream socket exists: a device
    // revoked by then gets the 401 without the door opening a connection for
    // it. The lease holds its slot regardless, so a later revocation cannot
    // hand that slot to anybody else.
    let Some(salt) = devices.cache_salt(device) else {
        let _ = discard_request_body(&mut client, head.body_length, deadline);
        let _ = refuse(&mut client, head.origin.as_deref(), deadline);
        return;
    };
    let body_length = head.body_length;
    // Read before `seal` consumes the head: the disk tier's clock marks this
    // slot when a generation passes, and only a generation can make the
    // slot's state differ from the file that holds it. `/health` and the
    // model listing are forwarded by the same path and change nothing;
    // `/props` is rewritten below — its answer names this machine's model
    // path, and this path's clients include paired phones.
    let completion = is_completion(&head.target);
    let props = is_props(&head.target);
    // `seal` consumes the head, and the answers after it — the revocation
    // refusal, the upstream-failure 502, the busy 503 — are written with the
    // request's origin still in hand, so it leaves the head here.
    let origin = head.origin.take();
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, upstream_port));
    let timeout = match remaining(deadline) {
        Some(timeout) => timeout,
        None => return,
    };
    let mut upstream = match TcpStream::connect_timeout(&address, timeout) {
        Ok(stream) => stream,
        Err(_) => {
            let answer = upstream_failure_response(origin.as_deref());
            let _ = write_with_deadline(&mut client, &answer, deadline);
            return;
        }
    };
    // The gate makes the check and the write one step: a `swap` that lands
    // here waits, so at the instant of the write the device was not yet
    // revoked; one that landed earlier was seen by `holds()`.
    {
        let gate = devices.revocation_gate();
        if !lease.holds() {
            drop(gate);
            let _ = discard_request_body(&mut client, body_length, deadline);
            let _ = refuse(&mut client, origin.as_deref(), deadline);
            return;
        }
        // Test seam: a request can be parked here, holding the shared guard,
        // so a test can prove a `swap` waits for it.
        #[cfg(test)]
        devices.run_in_write_hook();
        // The sealed bytes are the only thing ever written upstream.
        let sealed = head.seal(lease.slot(), &salt);
        if write_with_deadline(&mut upstream, sealed.bytes(), deadline).is_err() {
            return;
        }
    }
    // The tier's mark, armed before the request is relayed and dropped on every
    // way out of this function after that — including the ones that do not reach
    // the answer.
    let _turn = SlotTurn {
        chats,
        slot: lease.slot(),
        generating: completion,
    };
    if relay_exact(&mut client, &mut upstream, body_length, deadline, &cancel).is_err() {
        return;
    }
    // The request is in; what follows is the engine's answer. A completion's
    // answer has its own, longer, lifetime (see `COMPLETION_LIFETIME`).
    let (deadline, idle) = answer_window(started, completion, &shared.clocks);
    let upstream_head = match response::read_upstream_head(&mut upstream, deadline, Some((&cancel, idle, shared.clocks.patience))) {
        Ok(head) => head,
        Err(_) => return,
    };
    {
        // Same gate as the request write: the revocation check and the
        // response-head write are one step, so a swap that lands here waits,
        // and the device was not yet revoked at the instant of the write.
        let gate = devices.revocation_gate();
        if cancel.stopped() {
            return;
        }
        if !upstream_head.event_stream {
            if props {
                // The rewrite, or its refusal, as one answer: a body that
                // will not parse is answered with the upstream failure —
                // never the raw bytes, because a leak is worse than a
                // failed /props.
                let answer = match read_props(&mut upstream, &upstream_head, deadline) {
                    Ok(body) => {
                        let mut bytes = response::client_head(&upstream_head.raw);
                        bytes.extend(body);
                        bytes
                    }
                    Err(()) => upstream_failure_response(origin.as_deref()),
                };
                if write_with_deadline(&mut client, &answer, deadline).is_err() {
                    return;
                }
                drop(gate);
                if let Some(observer) = observer {
                    observer(&answer);
                }
                return;
            }
            // The upstream's own bytes, plus the vary a browser needs and
            // the upstream does not send; nothing else is added to them.
            let relayed = response::with_origin_vary(&upstream_head.raw);
            if write_with_deadline(&mut client, &relayed, deadline).is_err() {
                return;
            }
            drop(gate);
            if let Some(observer) = observer {
                observer(&relayed);
            }
            let _ = relay_response(&mut upstream, &mut client, deadline, idle, shared.clocks.patience, &cancel, observer);
            return;
        }
    }
    let job = match registry.start(device, response::client_head(&upstream_head.raw)) {
        Ok(job) => job,
        Err(StartRefused::Entropy) => {
            log::warn!("the door could not mint a job id");
            let answer = busy_response(origin.as_deref());
            let _ = write_with_deadline(&mut client, &answer, deadline);
            return;
        }
        Err(StartRefused::Busy) => {
            let answer = busy_response(origin.as_deref());
            let _ = write_with_deadline(&mut client, &answer, deadline);
            return;
        }
    };
    stream::produce_and_serve(
        &job,
        upstream,
        client,
        upstream_head.chunked,
        deadline,
        idle,
        &shared.clocks,
        &cancel,
        observer,
    );
}

/// Serves a `Last-Event-ID`: the missed events first, then the live tail —
/// or the honest refusal when the answer is gone. The asking device was
/// already identified by the bearer scan; the job answers to that device.
/// `/props` by the same rule as [`is_completion`]: a suffix, not an
/// equality — the webview's `/props` and a phone's `/v1/props` are the one
/// request, and either may carry a query string.
fn is_props(target: &[u8]) -> bool {
    let path = target.split(|byte| *byte == b'?').next().unwrap_or(target);
    path.ends_with(b"/props")
}

/// The /props body with this machine's model path out of it. `Err` when the
/// bytes are not a JSON object: the caller answers with the upstream
/// failure instead of relaying anything.
fn read_props(
    upstream: &mut TcpStream,
    head: &response::Head,
    deadline: Instant,
) -> Result<Vec<u8>, ()> {
    let body = response::read_body(upstream, head, deadline).map_err(|_| ())?;
    response::without_model_path(&body).ok_or(())
}

fn resume(
    client: &mut TcpStream,
    registry: &Registry,
    last_event_id: &[u8],
    origin: Option<&[u8]>,
    device: DeviceId,
    observer: Option<&Observed>,
    deadline: Instant,
    cancel: &Cancel,
) {
    let words = match parse_resume(last_event_id) {
        Some(resume) => match registry.find(&resume.token) {
            Some(job) => match job.resume_decision(resume.seen, device) {
                ResumeDecision::Serve => {
                    // The client saw `seen`; the next byte of the answer it
                    // is owed is the event after it.
                    stream::serve_resume(&job, client, resume.seen + 1, observer, deadline, cancel);
                    return;
                }
                ResumeDecision::Refused(words) => words,
            },
            None => "That answer is no longer kept here.",
        },
        None => "The door cannot resume an answer from that id.",
    };
    let gone = gone_response(words, origin);
    // One step with the check: a revoked device does not learn whether the
    // answer it names still exists.
    let gate = cancel.revocation_gate();
    if cancel.stopped() {
        return;
    }
    let _ = write_with_deadline(client, &gone, deadline);
    drop(gate);
}

fn gone_response(words: &str, origin: Option<&[u8]>) -> Vec<u8> {
    let origin_headers = cors::origin_headers(origin);
    format!(
        "HTTP/1.1 410 Gone\r\n{origin_headers}Content-Type: text/plain; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{words}",
        words.len()
    )
    .into_bytes()
}

/// Drains exactly the declared body. Shared with the disk tier's routes: a
/// body left unread in the receive buffer makes the kernel reset the socket
/// on close, and the reset erases the answer before the client reads it.
pub(super) fn discard_request_body(
    client: &mut TcpStream,
    length: usize,
    deadline: Instant,
) -> io::Result<()> {
    let mut left = length;
    let mut buffer = [0u8; 16 * 1024];
    while left > 0 {
        set_read_deadline(client, deadline)?;
        let chunk = left.min(buffer.len());
        let read = client.read(&mut buffer[..chunk])?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "request body ended",
            ));
        }
        left -= read;
    }
    Ok(())
}

/// Which device the bearer credential belongs to, if any. The format check
/// and the credential scan are the same shape as ever — a fixed buffer, a
/// constant-time comparison — and the verdict is combined only after both
/// have run, so a badly formed head costs the same as a well-formed one.
fn authenticated(value: Option<&[u8]>, devices: &Devices) -> Option<DeviceId> {
    let mut presented = [0u8; TOKEN_BYTES];
    let format_ok = value.is_some_and(|value| {
        value.len() == b"Bearer ".len() + TOKEN_BYTES && value.starts_with(b"Bearer ") && {
            presented.copy_from_slice(&value[b"Bearer ".len()..]);
            true
        }
    });
    let matched = devices.authenticate(&presented);
    if format_ok { matched } else { None }
}

fn relay_exact(
    from: &mut TcpStream,
    to: &mut TcpStream,
    length: usize,
    deadline: Instant,
    cancel: &Cancel,
) -> io::Result<()> {
    let mut left = length;
    let mut buffer = [0u8; 16 * 1024];
    while left > 0 {
        if cancel.stopped() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "door stopped"));
        }
        set_read_deadline(from, deadline)?;
        set_write_deadline(to, deadline)?;
        let chunk_length = left.min(buffer.len());
        let read = from.read(&mut buffer[..chunk_length])?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "request body ended",
            ));
        }
        to.write_all(&buffer[..read])?;
        left -= read;
    }
    Ok(())
}

fn relay_response(
    from: &mut TcpStream,
    to: &mut TcpStream,
    deadline: Instant,
    idle: Duration,
    patience: Duration,
    cancel: &Cancel,
    observer: Option<&Observed>,
) -> io::Result<()> {
    let mut buffer = [0u8; 16 * 1024];
    let mut last_byte = Instant::now();
    loop {
        if cancel.stopped() {
            return Ok(());
        }
        set_read_deadline_within(from, deadline, patience)?;
        set_write_deadline(to, deadline)?;
        let read = match from.read(&mut buffer) {
            Ok(read) => read,
            // The engine is silent — a long prefill, a slow token. That is not
            // the end of the answer: look at who is still here and wait again,
            // until the deadline (`set_read_deadline` above) says otherwise.
            Err(error) if is_silence(&error) => {
                if last_byte.elapsed() >= idle || client_gone(to) {
                    return Ok(());
                }
                continue;
            }
            Err(error) => return Err(error),
        };
        if read == 0 {
            return Ok(());
        }
        last_byte = Instant::now();
        to.write_all(&buffer[..read])?;
        if let Some(observer) = observer {
            observer(&buffer[..read]);
        }
    }
}

/// The limits on the engine's answer to this request, counted from when the
/// worker took it up: the moment it must be over by, and how long the engine
/// may go without a single byte. A completion's answer gets the long ceiling
/// and an idle bound of its own (see `clocks`); everything else the
/// connection's lifetime, which its idle bound cannot undercut. Reached only
/// by a request that is authenticated and holds its slot's lease.
pub(super) fn answer_window(
    started: Instant,
    completion: bool,
    clocks: &Clocks,
) -> (Instant, Duration) {
    if completion {
        (started + clocks.completion_ceiling, clocks.completion_idle)
    } else {
        (started + CONNECTION_LIFETIME, CONNECTION_LIFETIME)
    }
}

/// A read that ran out of time rather than failed: the other side is quiet,
/// not gone.
pub(super) fn is_silence(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    )
}

/// Whether the client has hung up: its end reads as closed. A peek that would
/// block is a client that is simply quiet. Asked only when the engine is
/// silent, so a client that left during a long prefill frees the relay (and,
/// by closing the engine's socket, the engine's slot) at the next wake-up.
pub(super) fn client_gone(client: &TcpStream) -> bool {
    if client.set_nonblocking(true).is_err() {
        return false;
    }
    let mut probe = [0u8; 1];
    let gone = match client.peek(&mut probe) {
        Ok(read) => read == 0,
        Err(error) => error.kind() != io::ErrorKind::WouldBlock,
    };
    // A socket that cannot be put back to blocking would make the relay's next
    // write fail or spin: a client in that state is as good as gone.
    gone || client.set_nonblocking(false).is_err()
}

fn refuse(stream: &mut TcpStream, origin: Option<&[u8]>, deadline: Instant) -> io::Result<()> {
    write_with_deadline(stream, &unauthorized_response(origin), deadline)
}

pub(super) fn write_with_deadline(
    stream: &mut TcpStream,
    bytes: &[u8],
    deadline: Instant,
) -> io::Result<()> {
    set_write_deadline(stream, deadline)?;
    stream.write_all(bytes)
}

pub(super) fn set_read_deadline(stream: &TcpStream, deadline: Instant) -> io::Result<()> {
    set_read_deadline_within(stream, deadline, PATIENCE)
}

/// [`set_read_deadline`] with the wake-up interval named: the engine-side
/// reads use the door's own clocks.
pub(super) fn set_read_deadline_within(
    stream: &TcpStream,
    deadline: Instant,
    patience: Duration,
) -> io::Result<()> {
    let timeout = remaining(deadline)
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "door deadline"))?;
    stream.set_read_timeout(Some(timeout.min(patience)))
}

pub(super) fn set_write_deadline(stream: &TcpStream, deadline: Instant) -> io::Result<()> {
    let timeout = remaining(deadline)
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "door deadline"))?;
    stream.set_write_timeout(Some(timeout.min(PATIENCE)))
}

fn remaining(deadline: Instant) -> Option<Duration> {
    let remaining = deadline.checked_duration_since(Instant::now())?;
    (!remaining.is_zero()).then_some(remaining)
}

#[cfg(test)]
mod tests {
    use super::authenticated;
    use crate::devices::{DeviceEntry, DeviceId, Devices};

    fn devices_with(credentials: &[&str]) -> Devices {
        let entries = credentials
            .iter()
            .enumerate()
            .map(|(index, token)| {
                DeviceEntry::new(
                    DeviceId::new(index as u32),
                    format!("device {index}"),
                    token.to_string(),
                )
                .unwrap()
            })
            .collect();
        Devices::new(entries).unwrap()
    }

    #[test]
    fn bearer_comparison_answers_with_the_device_that_matched() {
        let devices = devices_with(&[&"a".repeat(super::super::TOKEN_BYTES), &"b".repeat(64)]);
        let bearer = |token: &str| format!("Bearer {token}").into_bytes();
        assert_eq!(
            authenticated(
                Some(&bearer(&"a".repeat(super::super::TOKEN_BYTES))),
                &devices
            ),
            Some(DeviceId::new(0))
        );
        assert_eq!(
            authenticated(Some(&bearer(&"b".repeat(64))), &devices),
            Some(DeviceId::new(1))
        );
        assert_eq!(authenticated(Some(&b"Bearer wrong"[..]), &devices), None);
        assert_eq!(authenticated(None, &devices), None);
    }

    #[test]
    fn the_gone_response_carries_its_words_and_their_length() {
        let response = super::gone_response("It is gone.", None);
        let text = String::from_utf8(response).unwrap();
        assert!(text.starts_with("HTTP/1.1 410 Gone\r\n"));
        assert!(text.contains("Content-Length: 11\r\n"));
        assert!(text.ends_with("\r\n\r\nIt is gone."));
        assert!(!text.to_ascii_lowercase().contains("access-control-allow-origin"));

        let webview = super::gone_response("It is gone.", Some(b"tauri://localhost"));
        let text = String::from_utf8(webview).unwrap();
        assert!(text.contains("Access-Control-Allow-Origin: tauri://localhost\r\n"));
        assert!(text.ends_with("\r\n\r\nIt is gone."), "the words still end it: {text}");
        assert_eq!(text.matches("Access-Control-Allow-Origin").count(), 1);
    }
}
