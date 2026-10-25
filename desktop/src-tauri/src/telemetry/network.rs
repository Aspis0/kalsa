use std::sync::Arc;
use std::time::Duration;

use super::observability;
use super::{Service, store::Item};
use serde_json::Value;

const ENDPOINT: &str = "https://telemetry.kalsa.io/report";
/// The ceiling an offline report's growing backoff cannot pass.
pub(super) const MAX_DELAY: u64 = 60 * 60;
/// ureq reports a TLS handshake that dies once the socket is up with the
/// same ConnectionFailed kind as a refused connect, so its message is the
/// only thing that separates the two (ureq 2.12.1, pinned in Cargo.lock).
pub(super) const TLS_HANDSHAKE: &str = "tls connection init failed";

pub(super) fn start(service: Arc<Service>) {
    let _ = std::thread::Builder::new()
        .name("kalsa-telemetry".into())
        .spawn(move || {
            let agent = ureq::AgentBuilder::new()
                .https_only(true)
                .timeout(Duration::from_secs(10))
                .redirects(0)
                .build();
            loop {
                std::thread::sleep(Duration::from_secs(1));
                drain(&service, &agent);
            }
        });
}

fn drain(service: &Service, agent: &ureq::Agent) {
    let Ok(_send) = service.send_gate.lock() else {
        return;
    };
    let outbound = Outbound {
        body: &|| {
            crate::logging::folder()
                .map(|dir| crate::report::read_body(&dir))
                .unwrap_or_default()
        },
        upload: &|body| {
            crate::report::send(
                body,
                &crate::report::app_header(
                    env!("CARGO_PKG_VERSION"),
                    std::env::consts::OS,
                    std::env::consts::ARCH,
                ),
            )
        },
        report: &|report| send(agent, report),
    };
    let now = super::now();
    let Some((work, epoch)) = pick(service, now) else {
        return;
    };
    dispatch(service, work, epoch, now, &outbound);
}

/// The three outbound calls one cycle makes. Production wires the real
/// network; the tests stand them in.
pub(super) struct Outbound<'a> {
    pub(super) body: &'a dyn Fn() -> String,
    pub(super) upload: &'a dyn Fn(&str) -> Result<String, crate::report::SendFailure>,
    pub(super) report: &'a dyn Fn(&Value) -> Outcome,
}

/// The pick half of a cycle: the ready report leaves the queue with its
/// attempt bumped and the in-flight marker persisted, and comes back with
/// the epoch it was picked under — the epoch every consent re-check in the
/// cycle compares against.
pub(super) fn pick(service: &Service, now: u64) -> Option<(Item, u64)> {
    let Ok(mut inner) = service.inner.lock() else {
        return None;
    };
    if !inner.store.enabled {
        return None;
    }
    if inner.store.expire(now) && inner.store.save().is_err() {
        inner.store.enabled = false;
        return None;
    }
    let index = inner.store.queue.iter().position(|q| q.ready(now))?;
    let item = &mut inner.store.queue[index];
    item.attempts += 1;
    item.in_flight = true;
    item.ready_at = now + 60;
    item.stamp_attempt();
    let work = item.clone();
    if inner.store.save().is_err() {
        inner.store.enabled = false;
        return None;
    }
    Some((work, inner.epoch))
}

/// Whether the cycle may still transmit: the switch is ON and no preference
/// change has invalidated the epoch its work was picked under.
pub(super) fn consent(service: &Service, epoch: u64) -> bool {
    service
        .inner
        .lock()
        .is_ok_and(|inner| inner.epoch == epoch && inner.store.enabled)
}

/// One item's cycle: the log it owes, then the report that names it, then
/// the answer both of them got. The consent is re-checked under the lock
/// before each transmission, because each one is preceded by slow work —
/// the log read, the log upload — that a preference change can outlast.
pub(super) fn dispatch(service: &Service, work: Item, epoch: u64, now: u64, out: &Outbound) {
    let day = {
        let Ok(mut inner) = service.inner.lock() else {
            return;
        };
        if inner.epoch != epoch || !inner.store.enabled {
            return;
        }
        match super::log::owed(&mut inner, &work, now) {
            super::log::Owed::Day(day) => Some(day),
            super::log::Owed::None => None,
        }
    };
    let mut report = work.report.clone();
    if let Some(day) = day {
        let body = (out.body)();
        if body.trim().is_empty() {
            let Ok(mut inner) = service.inner.lock() else {
                return;
            };
            super::log::clear(&mut inner, &work);
        } else {
            if !consent(service, epoch) {
                return;
            }
            let sent = (out.upload)(&body);
            {
                let Ok(mut inner) = service.inner.lock() else {
                    return;
                };
                if inner.epoch != epoch || !inner.store.enabled {
                    return;
                }
                match super::log::answered(sent) {
                    // The log found no network: the item waits exactly like
                    // a report that found no network.
                    super::log::Answered::Offline => {
                        drop(inner);
                        note_reach(service, &Outcome::Offline(Why::Other));
                        settle(service, &work.report, epoch, now, Outcome::Offline(Why::Other));
                        return;
                    }
                    super::log::Answered::Refused(code) => {
                        observability::say(
                            log::Level::Warn,
                            format!("telemetry: log upload failed ({code})"),
                        );
                        super::log::clear(&mut inner, &work)
                    }
                    super::log::Answered::Stored(id) => {
                        if let Some(log_ref) = super::log::reference(&day, &id) {
                            report = super::log::attach(&mut inner, &work, &day, log_ref);
                            observability::say(
                                log::Level::Info,
                                "telemetry: log uploaded".to_string(),
                            );
                        } else {
                            super::log::clear(&mut inner, &work);
                        }
                    }
                }
            }
        }
    }
    if !consent(service, epoch) {
        return;
    }
    let outcome = (out.report)(&report);
    note_reach(service, &outcome);
    settle(service, &report, epoch, now, outcome);
}

/// The post-send bookkeeping: the queued item takes the outcome's answer.
fn settle(service: &Service, sent: &Value, epoch: u64, now: u64, outcome: Outcome) {
    if let Ok(mut inner) = service.inner.lock() {
        if inner.epoch != epoch || !inner.store.enabled {
            return;
        }
        if let Some(index) = inner.store.queue.iter().position(|q| &q.report == sent) {
            let item = inner.store.queue.remove(index);
            complete(&mut inner.store, item, now, outcome);
            if inner.store.save().is_err() {
                inner.store.enabled = false;
                inner.store.queue.clear();
            }
        }
    }
}

pub(super) fn complete(store: &mut super::store::Store, mut item: Item, now: u64, outcome: Outcome) {
    // Every outcome answers the question the pre-dispatch save asked.
    item.in_flight = false;
    if let Outcome::Rejected(status) = outcome {
        store.dead(item, now);
        observability::say(
            log::Level::Warn,
            format!(
                "telemetry rejected: code={status} reports=1 queued={}",
                store.queue.len()
            ),
        );
    } else if let Outcome::Offline(_) = outcome {
        // The request never reached a server, so the ceiling counts machines
        // that said no, not machines the report could not leave from; the
        // offline streak, not the attempt count, paces the next try.
        item.attempts = item.attempts.saturating_sub(1);
        item.offline_streak = item.offline_streak.saturating_add(1);
        item.stamp_attempt();
        let entropy = entropy(&item);
        item.ready_at = now + backoff(item.offline_streak, entropy).min(MAX_DELAY);
        store.queue.push(item);
    } else if matches!(outcome, Outcome::Retry(_)) {
        // A server answered, so the offline streak ends and only real
        // answers count toward the ceiling.
        item.offline_streak = 0;
        if item.attempts >= 5 {
            observability::say(
                log::Level::Warn,
                format!("telemetry: report dropped after {} attempts", item.attempts),
            );
            store.dead(item, now);
        } else {
            let entropy = entropy(&item);
            item.ready_at = now + backoff(item.attempts, entropy);
            store.queue.push(item);
        }
    }
}

fn entropy(item: &Item) -> u64 {
    u64::from_str_radix(&super::sanitize::fingerprint(&item.report)[..4], 16).unwrap_or(0)
}

#[derive(PartialEq, Eq, Debug, Clone, Copy)]
pub(super) enum Outcome {
    Done,
    /// A server answered and said wait.
    Retry(Why),
    Rejected(u16),
    /// No answer came.
    Offline(Why),
}

/// What a failed send was, in the transport's own word. It rides the outcome
/// into one log line per change of reach: never a URL, never a query, never
/// a body.
#[derive(PartialEq, Eq, Debug, Clone, Copy)]
pub(super) enum Why {
    Dns,
    Refused,
    ConnectTimeout,
    /// The connect failed for a reason with no shorter word than that.
    ConnectFailed,
    Tls,
    /// The server accepted the connection and then stopped talking.
    Stalled,
    /// The transport failed for a kind that names nothing more.
    Transport,
    /// A server's own answer: the status, or 200 for the legacy quota refusal.
    Status(u16),
    /// The path that lost the word for it — the log upload's own transport.
    Other,
}

impl std::fmt::Display for Why {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Why::Dns => write!(f, "dns"),
            Why::Refused => write!(f, "connect refused"),
            Why::ConnectTimeout => write!(f, "connect timeout"),
            Why::ConnectFailed => write!(f, "connect failed"),
            Why::Tls => write!(f, "tls handshake failed"),
            Why::Stalled => write!(f, "read timeout"),
            Why::Transport => write!(f, "transport error"),
            Why::Status(status) => write!(f, "server answered {status}"),
            Why::Other => write!(f, "offline"),
        }
    }
}

/// What the transport last answered, for the once-per-change log line.
#[derive(PartialEq, Eq, Clone, Copy)]
pub(super) enum Reach {
    /// The last send went.
    Through,
    /// No answer has arrived since this streak began.
    Unreachable,
    /// A server answered; it said wait.
    Answered,
}

/// One line per CHANGE of what the transport last answered, never one per
/// attempt: a day offline writes one line, not 86 400.
fn note_reach(service: &Service, outcome: &Outcome) {
    let reach = match outcome {
        Outcome::Done => Reach::Through,
        Outcome::Offline(_) => Reach::Unreachable,
        // A server that refused still answered, so the state moves: the next
        // offline streak is a change again and says its line.
        Outcome::Retry(_) | Outcome::Rejected(_) => Reach::Answered,
    };
    let Ok(mut inner) = service.inner.lock() else {
        return;
    };
    if inner.reach == reach {
        return;
    }
    inner.reach = reach;
    match outcome {
        Outcome::Offline(Why::Other) => observability::say(
            log::Level::Warn,
            format!(
                "telemetry: cannot reach the server, {} reports waiting",
                inner.store.queue.len()
            ),
        ),
        Outcome::Offline(why) => observability::say(
            log::Level::Warn,
            format!(
                "telemetry: cannot reach the server ({why}), {} reports waiting",
                inner.store.queue.len()
            ),
        ),
        Outcome::Retry(why) => observability::say(
            log::Level::Warn,
            format!("telemetry: {why}, retrying"),
        ),
        Outcome::Done => observability::say(
            log::Level::Info,
            "telemetry: reports delivered again".to_string(),
        ),
        // The dead letter's own line already said it.
        Outcome::Rejected(_) => {}
    }
}

fn send(agent: &ureq::Agent, report: &Value) -> Outcome {
    let Ok(body) = serde_json::to_string(report) else {
        return Outcome::Done;
    };
    if body.len() > super::spec::BODY_BYTES as usize {
        return Outcome::Done;
    }
    let response = agent
        .post(ENDPOINT)
        .set("Content-Type", "application/json")
        .set("Accept", "application/json")
        .send_string(&body);
    classify(response)
}

pub(super) fn classify(response: Result<ureq::Response, ureq::Error>) -> Outcome {
    match response {
        Ok(response) if response.status() == 200 => {
            // The phone also backs off for a legacy HTTP-200 quota refusal.
            let bytes = response.into_reader();
            let reply: Result<serde_json::Value, _> =
                serde_json::from_reader(std::io::Read::take(bytes, 4096));
            if reply
                .ok()
                .is_some_and(|v| v["reason"] == "quota" && v["accepted"] == false)
            {
                Outcome::Retry(Why::Status(200))
            } else {
                Outcome::Done
            }
        }
        Ok(response) if [201, 202, 204].contains(&response.status()) => Outcome::Done,
        Err(ureq::Error::Status(status, _)) if (400..500).contains(&status) && status != 429 => {
            Outcome::Rejected(status)
        }
        Err(ureq::Error::Transport(transport)) => transport_answer(&transport),
        Err(ureq::Error::Status(status, _)) => Outcome::Retry(Why::Status(status)),
        Ok(response) => Outcome::Retry(Why::Status(response.status())),
    }
}

/// What a transport failure means. A connection that never came up — no
/// name, refused, or a SYN that black-holed until the deadline — has not
/// been answered, so it waits like an offline machine; anything that failed
/// once the socket was up is a server that was there.
fn transport_answer(transport: &ureq::Transport) -> Outcome {
    let io = std::error::Error::source(transport)
        .and_then(|source| source.downcast_ref::<std::io::Error>())
        .map(std::io::Error::kind);
    answer(transport.kind(), transport.message(), io)
}

/// What a transport failure means, from the parts a `ureq::Transport` reads
/// with: its kind, its message, and the io error it wraps when it has one.
/// `Transport`'s own fields are private — it cannot be built outside ureq —
/// so these parts are also what a test builds instead of opening a socket.
pub(super) fn answer(
    kind: ureq::ErrorKind,
    message: Option<&str>,
    io: Option<std::io::ErrorKind>,
) -> Outcome {
    if kind == ureq::ErrorKind::Dns {
        return Outcome::Offline(Why::Dns);
    }
    if kind == ureq::ErrorKind::ConnectionFailed {
        if message == Some(TLS_HANDSHAKE) {
            return Outcome::Retry(Why::Tls);
        }
        // ureq wraps the connect's own io error: refused and timed out share
        // the ConnectionFailed kind, and other sources say nothing more
        // specific, so the word follows the source.
        return Outcome::Offline(match io {
            Some(std::io::ErrorKind::TimedOut) => Why::ConnectTimeout,
            Some(std::io::ErrorKind::ConnectionRefused) => Why::Refused,
            _ => Why::ConnectFailed,
        });
    }
    // Only a read that stopped talking is a read timeout; the rest of the
    // kinds proxy, header or protocol errors included, say nothing more
    // specific than that the transport failed.
    Outcome::Retry(if io == Some(std::io::ErrorKind::TimedOut) {
        Why::Stalled
    } else {
        Why::Transport
    })
}

pub(super) fn backoff(attempts: u8, entropy: u64) -> u64 {
    let base = (30 * 2u64.pow(u32::from(attempts.min(20)))).min(3600);
    let jitter = (entropy % 50) as f64 / 100.0 - 0.25;
    ((base as f64 * (1.0 + jitter)) as u64).max(1)
}
