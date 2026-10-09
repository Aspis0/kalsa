use std::sync::Arc;
use std::time::Duration;

use super::{Service, store::Item};
use serde_json::Value;

const ENDPOINT: &str = "https://telemetry.kalsa.io/report";
/// The ceiling an offline report's growing backoff cannot pass.
pub(super) const MAX_DELAY: u64 = 60 * 60;
/// ureq reports a TLS handshake that dies once the socket is up with the
/// same ConnectionFailed kind as a refused connect, so its message is the
/// only thing that separates the two (ureq 2.12.1, pinned in Cargo.lock).
const TLS_HANDSHAKE: &str = "tls connection init failed";

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
                        settle(service, &work.report, epoch, now, Outcome::Offline);
                        return;
                    }
                    super::log::Answered::Refused => super::log::clear(&mut inner, &work),
                    super::log::Answered::Stored(id) => {
                        if let Some(log_ref) = super::log::reference(&day, &id) {
                            report = super::log::attach(&mut inner, &work, &day, log_ref);
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
        log::warn!(
            "telemetry rejected: code={status} reports=1 queued={}",
            store.queue.len()
        );
    } else if let Outcome::Offline = outcome {
        // The request never reached a server, so the ceiling counts machines
        // that said no, not machines the report could not leave from; the
        // offline streak, not the attempt count, paces the next try.
        item.attempts = item.attempts.saturating_sub(1);
        item.offline_streak = item.offline_streak.saturating_add(1);
        item.stamp_attempt();
        let entropy = entropy(&item);
        item.ready_at = now + backoff(item.offline_streak, entropy).min(MAX_DELAY);
        store.queue.push(item);
    } else if outcome == Outcome::Retry {
        // A server answered, so the offline streak ends and only real
        // answers count toward the ceiling.
        item.offline_streak = 0;
        if item.attempts >= 5 {
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

#[derive(PartialEq, Debug)]
pub(super) enum Outcome {
    Done,
    Retry,
    Rejected(u16),
    /// The request never reached a server: no network, no name, or no route.
    Offline,
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
                Outcome::Retry
            } else {
                Outcome::Done
            }
        }
        Ok(response) if [201, 202, 204].contains(&response.status()) => Outcome::Done,
        Err(ureq::Error::Status(status, _)) if (400..500).contains(&status) && status != 429 => {
            Outcome::Rejected(status)
        }
        Err(ureq::Error::Transport(transport)) => {
            // The request never reached a server: no network, an
            // unresolvable name, or no route to the host.
            let never_arrived = match transport.kind() {
                ureq::ErrorKind::Dns => true,
                ureq::ErrorKind::ConnectionFailed => transport.message() != Some(TLS_HANDSHAKE),
                _ => false,
            };
            if never_arrived {
                Outcome::Offline
            } else {
                // It connected and then failed to talk: a read timeout or a
                // failed TLS handshake is a machine that was there.
                Outcome::Retry
            }
        }
        _ => Outcome::Retry,
    }
}

pub(super) fn backoff(attempts: u8, entropy: u64) -> u64 {
    let base = (30 * 2u64.pow(u32::from(attempts.min(20)))).min(3600);
    let jitter = (entropy % 50) as f64 / 100.0 - 0.25;
    ((base as f64 * (1.0 + jitter)) as u64).max(1)
}
