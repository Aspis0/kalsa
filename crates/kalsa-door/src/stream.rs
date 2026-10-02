//! Serving an answer that belongs to a job, not to a socket.
//!
//! `produce_and_serve` is the thread that owns the upstream: it reads the
//! generation, numbers and accumulates every event, and writes to its own
//! attached client between upstream reads. If that client dies the thread
//! does not: an answer keeps being made whether or not anybody listens.
//! `serve_resume` is any later thread rejoining an existing job: it replays
//! the events after the one the client last saw and follows the tail to the
//! end, so a returned phone gets one continuous answer.

use std::io::Read;
use std::net::TcpStream;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::jobs::{Appended, Failure, Job, Status, Take};
use crate::clocks::Clocks;
use crate::proxy::{client_gone, is_silence, set_read_deadline_within, Cancel};
use crate::chunk::Dechunker;
use crate::sse::{self, EventSplitter};

/// The observer type every serving path shares: it sees exactly the bytes
/// the client receives, never a byte it does not.
type Observed = dyn Fn(&[u8]) + Send + Sync;

pub(super) fn produce_and_serve(
    job: &Arc<Job>,
    mut upstream: TcpStream,
    mut client: TcpStream,
    chunked: bool,
    deadline: Instant,
    idle: Duration,
    clocks: &Clocks,
    cancel: &Cancel,
    observer: Option<&Observed>,
) {
    // The revocation check and the head write are one step under the shared
    // gate: a `swap` that lands here waits, so a head is never written for a
    // device that was already revoked. The observer runs after the gate.
    let head = job.head();
    let mut attached = {
        let gate = cancel.revocation_gate();
        if cancel.stopped() {
            drop(gate);
            job.close(Status::Failed(Failure::Shutdown));
            return;
        }
        let written = crate::proxy::answer_to(&mut client, head, deadline).is_ok();
        drop(gate);
        written
    };
    if attached {
        if let Some(observer) = observer {
            observer(head);
        }
    }
    // When the client was last known to be there, and the last byte the engine
    // sent: the producer finishes an answer nobody is listening to so a phone
    // can resume it, but not for ever (see `detached_grace`), and not past a
    // long silence from the engine (`idle`).
    let mut detached_since: Option<Instant> = None;
    let mut last_byte = Instant::now();
    let mut dechunker = Dechunker::new();
    let mut splitter = EventSplitter::new();
    let mut cursor = 0usize;
    let mut buffer = [0u8; 16 * 1024];
    let mut body = Vec::new();
    let mut raw_events: Vec<Vec<u8>> = Vec::new();
    loop {
        if cancel.stopped() {
            // The door closed, or the device was revoked mid-answer. The
            // job fails with the shutdown words: the only device that could
            // ever resume it cannot authenticate anymore, so the sentence
            // is honest and unheard at the same time.
            job.close(Status::Failed(Failure::Shutdown));
            break;
        }
        if attached {
            detached_since = None;
        } else {
            let since = *detached_since.get_or_insert_with(Instant::now);
            if job.has_readers() {
                detached_since = Some(Instant::now());
            } else if since.elapsed() >= clocks.detached_grace {
                job.close(Status::Failed(Failure::Abandoned));
                break;
            }
        }
        if set_read_deadline_within(&upstream, deadline, clocks.patience).is_err() {
            job.close(Status::Failed(Failure::Upstream));
            break;
        }
        let read = match upstream.read(&mut buffer) {
            Ok(read) => read,
            // Quiet is not over: the engine is silent between prefill reports
            // and between tokens on a slow computer. Wake up, look at the
            // door again, and wait — until the deadline above says the answer
            // has had its lifetime.
            Err(error) if is_silence(&error) => {
                if last_byte.elapsed() >= idle {
                    job.close(Status::Failed(Failure::Upstream));
                    break;
                }
                // A client that left during a long prefill is noticed here,
                // not only at the next write.
                if attached && client_gone(&client) {
                    attached = false;
                }
                continue;
            }
            // Anything else — a crash, a stop, a reload — the answer stopped.
            Err(_) => {
                job.close(Status::Failed(Failure::Upstream));
                break;
            }
        };
        last_byte = Instant::now();
        if read == 0 {
            // A chunked body must end with its terminal chunk; a
            // close-delimited body ends at the end of the wire.
            let clean = !chunked || dechunker.is_done();
            job.close(if clean {
                Status::Done
            } else {
                Status::Failed(Failure::Upstream)
            });
            break;
        }
        body.clear();
        let framed = if chunked {
            dechunker.feed(&buffer[..read], &mut body)
        } else {
            body.extend_from_slice(&buffer[..read]);
            Ok(())
        };
        raw_events.clear();
        if framed.is_err() || splitter.feed(&body, &mut raw_events).is_err() {
            job.close(Status::Failed(Failure::Upstream));
            break;
        }
        split_append_and_serve(
            job,
            &mut raw_events,
            &mut cursor,
            &mut client,
            &mut attached,
            observer,
            deadline,
        );
        if chunked && dechunker.is_done() {
            // The terminal chunk was seen: the answer is complete even if
            // the upstream keeps the connection open.
            job.close(Status::Done);
            break;
        }
        if !attached {
            continue;
        }
        // Everything accumulated so far, without blocking: the producer is
        // its own client's server between upstream reads.
        if !follow_now(job, &mut cursor, &mut client, observer, deadline) {
            attached = false;
        }
    }
    drop(upstream);
    if attached {
        // The answer is over; hand over everything left, then the close of
        // the socket is the end of the stream the client reads.
        let mut out = Vec::new();
        while matches!(job.take(&mut cursor, deadline, &mut out), Take::Events) {
            for event in out.drain(..) {
                if !write_bytes(&mut client, &event, observer, deadline) {
                    return;
                }
            }
        }
    }
}

/// How long a tailer waits before re-checking the door's stop flag. Events
/// arrive through the same condvar instantly; the slice only bounds how
/// long a closing door can wait behind a tailer.
const TAIL_SLICE: Duration = Duration::from_millis(500);

/// A later connection rejoining the job: replay from the index after the
/// client's last event, then follow the tail live to the end.
pub(super) fn serve_resume(
    job: &Arc<Job>,
    client: &mut TcpStream,
    from: usize,
    observer: Option<&Observed>,
    deadline: Instant,
    cancel: &Cancel,
) {
    // The revocation check and the head write are one step under the shared
    // gate; the observer runs after it is released.
    let _reading = job.reading();
    let head = job.head();
    {
        let _gate = cancel.revocation_gate();
        if cancel.stopped() {
            return;
        }
        if crate::proxy::answer_to(client, head, deadline).is_err() {
            return;
        }
    }
    if let Some(observer) = observer {
        observer(head);
    }
    let mut cursor = from;
    let mut out = Vec::new();
    loop {
        if cancel.stopped() {
            return;
        }
        match job.take(&mut cursor, deadline.min(Instant::now() + TAIL_SLICE), &mut out) {
            Take::Events => {
                for event in out.drain(..) {
                    if !write_bytes(client, &event, observer, deadline) {
                        return;
                    }
                }
            }
            Take::Drained => return,
            // The tail has been replayed; a resumed answer that failed ends
            // with its reason, not with a close that reads as a dropped
            // connection.
            Take::Failed(failure) => {
                write_bytes(client, &failure_event(failure), observer, deadline);
                return;
            }
            // A slice boundary, not the end: the real lifetime deadline is
            // what ends the follow.
            Take::Deadline if Instant::now() >= deadline => return,
            Take::Deadline => {}
        }
    }
}

/// The last event of an answer that stopped early: the failure in the error
/// shape the room's routes use and an OpenAI-style stream carries —
/// `{"error": {"code": "...", "message": "<English fallback>"}}` — unnumbered
/// because it is not part of the answer's log.
fn failure_event(failure: Failure) -> Vec<u8> {
    let body = serde_json::json!({"error": {"code": failure.code(), "message": failure.words()}});
    format!("data: {body}\n\n").into_bytes()
}

/// Numbers and stores the freshly parsed events; keep-alives go straight to
/// an attached client and nowhere else.
fn split_append_and_serve(
    job: &Arc<Job>,
    raw_events: &mut Vec<Vec<u8>>,
    cursor: &mut usize,
    client: &mut TcpStream,
    attached: &mut bool,
    observer: Option<&Observed>,
    deadline: Instant,
) {
    for raw in raw_events.drain(..) {
        let id = job.token().event_id(job.next_index());
        if let Some(event) = sse::rewrite(&raw, &id) {
            if matches!(job.append(event.into()), Appended::Stopped) {
                return;
            }
        } else if *attached && !write_bytes(client, &sse::keepalive(&raw), observer, deadline) {
            *attached = false;
        }
    }
    if *attached && !follow_now(job, cursor, client, observer, deadline) {
        *attached = false;
    }
}

/// Writes everything the log already holds past `cursor`, without waiting
/// for more. False once the client stopped accepting bytes.
fn follow_now(
    job: &Arc<Job>,
    cursor: &mut usize,
    client: &mut TcpStream,
    observer: Option<&Observed>,
    deadline: Instant,
) -> bool {
    let mut out = Vec::new();
    loop {
        match job.take(cursor, Instant::now(), &mut out) {
            Take::Events => {
                for event in out.drain(..) {
                    if !write_bytes(client, &event, observer, deadline) {
                        return false;
                    }
                }
            }
            // Caught up with a live answer: the caller reads upstream again.
            Take::Deadline => return true,
            Take::Drained | Take::Failed(_) => return true,
        }
    }
}

fn write_bytes(
    client: &mut TcpStream,
    bytes: &[u8],
    observer: Option<&Observed>,
    deadline: Instant,
) -> bool {
    if crate::proxy::answer_to(client, bytes, deadline).is_err() {
        return false;
    }
    if let Some(observer) = observer {
        observer(bytes);
    }
    true
}
