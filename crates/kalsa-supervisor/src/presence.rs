//! The presence probe: is the engine actually gone?
//!
//! `Stopped` means the door does not answer **and** the process is not there
//! (PLAN-DISK-TIER §9): two halves, two witnesses, and neither may be
//! guessed. This module owns BOTH inputs and the rule that joins them — the
//! port's three-valued answer, the process's own witness (what the teardown
//! in `child` reported), and `settle`, the decision a drain's end makes.
//!
//! Deliberately NOT `health::health_ok`: that answers `false` for every
//! failure — refused, timeout, 503 "still loading", garbage — so a live but
//! slow engine would read as "absent" and `Stopped` would be written over a
//! process that is there. The distinction this module exists for is
//! NOTHING IS LISTENING (the connection is REFUSED — positive evidence of
//! absence) versus SOMETHING IS LISTENING (the connection SUCCEEDED, and it
//! then answered 200, answered 503, or never said a word — evidence of
//! presence either way).

use std::io::{self, ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

/// One probe's budget. A refusal on loopback answers instantly; a port that
/// neither accepts nor refuses is exactly the case `Unknown` exists for.
pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_millis(500);

/// What the PORT said. Three values, never a guess.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Presence {
    /// The connection was REFUSED: nothing is listening. Positive evidence.
    Gone,
    /// The connection SUCCEEDED: something is listening — how it behaved
    /// after that is `evidence`, and all of it counts as presence.
    There { evidence: Evidence },
    /// The probe could not decide (a timeout, a network error short of a
    /// refusal): not evidence in either direction, so it may not be read as
    /// absence. The state says so (`StopUnconfirmed`), it does not say gone.
    Unknown { detail: String },
}

/// What the listener did once the connection was in.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Evidence {
    /// Bytes came back: the HTTP status code, or `unparsable` for a reply
    /// that is not a status line at all. A 503 is an answer, not an absence.
    Answered { status: String },
    /// The connection was accepted and then no readable answer arrived —
    /// "something is there that did not reply", NOT "nothing is there".
    Silent,
}

/// The PROCESS half's witness, assembled by the stop from what it owned and
/// what `child::Termination` reported. It is separate from `Presence` on
/// purpose: the two halves of §9 have different owners and are only joined
/// at the end.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Witness {
    /// We held this child and reaped it: the kernel says OUR process is gone.
    /// The strongest witness there is — see `settle` for what the port may
    /// and may not do to it.
    Reaped,
    /// The pid this stop knew is still alive after the whole walk: a
    /// survivor, whatever the port says.
    PidAlive { pid: u32 },
    /// The pid this stop knew, now not alive. Pids can be recycled, so this
    /// one is corroborated by the port (§9's "pid AND port").
    PidDead { pid: u32 },
    /// Adopted blind: no pid was ever recorded, so the process half can
    /// never be proven here — only the port can speak, plus the suspicion
    /// record the next start settles.
    Unwatched,
}

/// What a drain may be closed as, given both witnesses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Settlement {
    /// True: absence is proven well enough for `Stopped`. False: the drain
    /// ends in the failed-to-stop state carrying its measures instead.
    pub(crate) stopped: bool,
    /// Whether this stop owes the suspicion record beside the state file —
    /// absence was NOT proved on both halves (§9): a reaped child whose port
    /// still answers, a survivor, an undecidable probe, and EVERY blind
    /// stop, whose process half can never be proven here (the record is what
    /// the port alone cannot carry).
    pub(crate) record: bool,
}

/// Joins the two witnesses into the end of a drain, one row per combination
/// — `docs/PLAN-DISK-TIER §9` in code:
///
/// - OUR child, reaped: the kernel is positive proof for the process half.
///   The port is NOT a veto — if something answers it afterwards, that is a
///   suspicion to record beside the state file, not a reason to keep the
///   drain standing over a process we watched die.
/// - A known pid, alive after both signals: a survivor; nothing may say
///   `Stopped`, port or no port.
/// - A known pid, now dead: the port corroborates — a port still held does
///   not say "this is not our engine", so it blocks `Stopped` (pid AND port).
/// - Adopted blind: §9 says `Stopped` only after the probe FAILS, plus the
///   suspicion record; anything else is the failed-to-stop state saying the
///   half it could not know.
pub(crate) fn settle(witness: &Witness, presence: &Presence) -> Settlement {
    let stopped = match witness {
        Witness::Reaped => true,
        Witness::PidAlive { .. } => false,
        Witness::PidDead { .. } => matches!(presence, Presence::Gone),
        Witness::Unwatched => matches!(presence, Presence::Gone),
    };
    // Both halves positive — a process half that proves OURS is gone (reaped,
    // or a pid we knew that is now dead) AND a port that refuses — is the
    // only case that owes nothing to the next start. Everything else carries
    // its suspicion into `<state file>.orphan` (`suspect`).
    let proven = matches!(witness, Witness::Reaped | Witness::PidDead { .. })
        && matches!(presence, Presence::Gone);
    Settlement {
        stopped,
        record: !proven,
    }
}

/// Probes `addr` once: connect, send the health request, read what comes
/// back. One probe with a budget, never a poll — the caller is a stop that
/// has already finished walking.
pub(crate) fn probe(addr: SocketAddr, timeout: Duration) -> Presence {
    let mut stream = match TcpStream::connect_timeout(&addr, timeout) {
        Ok(stream) => stream,
        Err(error) => return classify_connect(&error),
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    // Connected already means presence; the request only asks WHAT answered.
    let request = format!("GET /health HTTP/1.0\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
    let _ = stream.write_all(request.as_bytes());
    let mut head = [0u8; 32];
    match stream.read(&mut head) {
        Ok(0) | Err(_) => Presence::There { evidence: Evidence::Silent },
        Ok(n) => Presence::There {
            evidence: Evidence::Answered {
                status: status_of(&head[..n]),
            },
        },
    }
}

/// A failed connect: REFUSED is absence, everything else is undecidable —
/// a timeout says the network, not the engine.
pub(crate) fn classify_connect(error: &io::Error) -> Presence {
    if error.kind() == ErrorKind::ConnectionRefused {
        Presence::Gone
    } else {
        Presence::Unknown {
            detail: format!("the connection neither opened nor was refused: {error}"),
        }
    }
}

/// The status code out of the first line, or `unparsable` for bytes that
/// are not an HTTP status line — both are still `Answered`.
fn status_of(head: &[u8]) -> String {
    let text = String::from_utf8_lossy(head);
    let mut words = text.split_whitespace();
    if words.next().unwrap_or_default().starts_with("HTTP/1.") {
        words.next().unwrap_or("unparsable").to_string()
    } else {
        "unparsable".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    /// A listener that answers `reply` to the first connection, then closes —
    /// or accepts and closes in silence when `reply` is `None`.
    fn serve_once(reply: Option<String>) -> (SocketAddr, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind the stand-in");
        let addr = listener.local_addr().expect("the stand-in's address");
        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                if let Some(reply) = reply {
                    let _ = stream.write_all(reply.as_bytes());
                }
            }
        });
        (addr, handle)
    }

    /// The four cases plus the 503: refused, silent, answered, undecidable —
    /// and a 503 must read as PRESENCE (health_ok would call it absent).
    #[test]
    fn nothing_listening_is_refused_and_reads_as_gone() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("address");
        drop(listener); // nothing holds the port any more
        assert_eq!(probe(addr, PROBE_TIMEOUT), Presence::Gone);
    }

    #[test]
    fn a_connection_accepted_without_an_answer_reads_as_there_not_gone() {
        let (addr, server) = serve_once(None);
        match probe(addr, PROBE_TIMEOUT) {
            Presence::There { evidence: Evidence::Silent } => {}
            other => panic!("a silent listener read as {other:?}"),
        }
        let _ = server.join();
    }

    #[test]
    fn a_200_reads_as_there() {
        let (addr, server) = serve_once(Some(
            "HTTP/1.0 200 OK\r\nContent-Length: 15\r\n\r\n{\"status\":\"ok\"}".into(),
        ));
        assert_eq!(
            probe(addr, PROBE_TIMEOUT),
            Presence::There { evidence: Evidence::Answered { status: "200".into() } }
        );
        let _ = server.join();
    }

    #[test]
    fn a_503_reads_as_there_not_gone() {
        // health_ok answers `false` to this — that is why presence does not
        // use it: a loading engine is a present engine.
        let (addr, server) = serve_once(Some("HTTP/1.1 503 Service Unavailable\r\n\r\n".into()));
        assert_eq!(
            probe(addr, PROBE_TIMEOUT),
            Presence::There { evidence: Evidence::Answered { status: "503".into() } }
        );
        let _ = server.join();
    }

    #[test]
    fn an_unreachable_port_reads_as_unknown_not_gone() {
        let error = io::Error::new(ErrorKind::TimedOut, "connection timed out");
        match classify_connect(&error) {
            Presence::Unknown { detail } => assert!(detail.contains("timed out"), "{detail}"),
            other => panic!("a timeout read as {other:?}"),
        }
        let refused = io::Error::new(ErrorKind::ConnectionRefused, "refused");
        assert_eq!(classify_connect(&refused), Presence::Gone);
    }

    #[test]
    fn settle_joins_the_witnesses_into_the_drains_end() {
        let gone = Presence::Gone;
        let there = Presence::There { evidence: Evidence::Silent };
        let unknown = Presence::Unknown { detail: "undecided".into() };
        // (the drain's end, owes the suspicion record) per row.
        let row = |witness: &Witness, port: &Presence| {
            let settled = settle(witness, port);
            (settled.stopped, settled.record)
        };
        // OUR child, reaped: the kernel proved the process half; the port is
        // a suspicion to record, never a veto on `Stopped`.
        assert_eq!(row(&Witness::Reaped, &gone), (true, false), "both halves positive");
        assert_eq!(row(&Witness::Reaped, &there), (true, true), "reaped + answering port");
        assert_eq!(row(&Witness::Reaped, &unknown), (true, true), "reaped + undecided port");
        // A survivor: nothing may say `Stopped`, and the record is owed.
        for port in [&gone, &there, &unknown] {
            assert_eq!(row(&Witness::PidAlive { pid: 7 }, port), (false, true));
        }
        // A pid we knew, now dead: the port corroborates (pid AND port).
        assert_eq!(row(&Witness::PidDead { pid: 7 }, &gone), (true, false));
        assert_eq!(row(&Witness::PidDead { pid: 7 }, &there), (false, true));
        assert_eq!(row(&Witness::PidDead { pid: 7 }, &unknown), (false, true));
        // Adopted blind: §9's literal rule — `Stopped` only after the probe
        // fails, AND the record either way, because no pid was ever proven.
        assert_eq!(row(&Witness::Unwatched, &gone), (true, true), "blind + silent port");
        assert_eq!(row(&Witness::Unwatched, &there), (false, true));
        assert_eq!(row(&Witness::Unwatched, &unknown), (false, true));
    }

    /// The stand-in must not outlive its test's listener thread: `serve_once`
    /// joins on a connection that already happened, so this only proves the
    /// accept loop ends when the listener drops — a leak here would wedge the
    /// next bind on the same port.
    #[test]
    fn the_probe_does_not_hold_a_listener_open() {
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("address");
        listener.set_nonblocking(true).expect("nonblocking");
        let accepting = std::thread::spawn({
            let stop = Arc::clone(&stop);
            move || {
                while !stop.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            let _ = stream.write_all(b"HTTP/1.0 200 OK\r\n\r\n");
                        }
                        Err(_) => std::thread::sleep(Duration::from_millis(5)),
                    }
                }
            }
        });
        assert!(matches!(probe(addr, PROBE_TIMEOUT), Presence::There { .. }));
        stop.store(true, Ordering::Relaxed);
        let _ = accepting.join();
    }
}
