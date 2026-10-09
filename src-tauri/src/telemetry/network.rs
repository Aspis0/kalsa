use std::sync::Arc;
use std::time::Duration;

use super::{Service, store::Item};

const ENDPOINT: &str = "https://telemetry.kalsa.io/report";
/// The ceiling an offline report's growing backoff cannot pass.
const MAX_DELAY: u64 = 60 * 60;
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
    let now = super::now();
    let (work, epoch) = {
        let Ok(mut inner) = service.inner.lock() else {
            return;
        };
        if !inner.store.enabled {
            return;
        }
        if inner.store.expire(now) && inner.store.save().is_err() {
            inner.store.enabled = false;
            return;
        }
        let Some(index) = inner.store.queue.iter().position(|q| q.ready_at <= now) else {
            return;
        };
        let item = &mut inner.store.queue[index];
        item.attempts += 1;
        item.in_flight = true;
        item.ready_at = now + 60;
        item.stamp_attempt();
        let work = item.clone();
        if inner.store.save().is_err() {
            inner.store.enabled = false;
            return;
        }
        (work, inner.epoch)
    };
    let outcome = send(agent, &work);
    if let Ok(mut inner) = service.inner.lock() {
        if inner.epoch != epoch || !inner.store.enabled {
            return;
        }
        if let Some(index) = inner
            .store
            .queue
            .iter()
            .position(|q| q.report == work.report)
        {
            let item = inner.store.queue.remove(index);
            complete(&mut inner.store, item, now, outcome);
            if inner.store.save().is_err() {
                inner.store.enabled = false;
                inner.store.queue.clear();
            }
        }
    }
}

fn complete(store: &mut super::store::Store, mut item: Item, now: u64, outcome: Outcome) {
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
enum Outcome {
    Done,
    Retry,
    Rejected(u16),
    /// The request never reached a server: no network, no name, or no route.
    Offline,
}

fn send(agent: &ureq::Agent, item: &Item) -> Outcome {
    let Ok(body) = serde_json::to_string(&item.report) else {
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

fn classify(response: Result<ureq::Response, ureq::Error>) -> Outcome {
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

fn backoff(attempts: u8, entropy: u64) -> u64 {
    let base = (30 * 2u64.pow(u32::from(attempts.min(20)))).min(3600);
    let jitter = (entropy % 50) as f64 / 100.0 - 0.25;
    ((base as f64 * (1.0 + jitter)) as u64).max(1)
}

#[cfg(test)]
mod tests {
    #[test]
    fn contract_rejections_are_retained_with_a_bounded_dead_letter_queue() {
        let response = ureq::Response::new(400, "Bad Request", "PRIVATE-BODY-CANARY").unwrap();
        let outcome = super::classify(Err(ureq::Error::Status(400, response)));
        assert_eq!(outcome, super::Outcome::Rejected(400));
        let dir =
            std::env::temp_dir().join(format!("kalsa-contract-rejection-{}", std::process::id()));
        let mut store = super::super::store::Store::load(dir.clone());
        for _ in 0..105 {
            let item = super::Item {
                report: super::super::privacy_tests::sample(),
                attempts: 1,
                ready_at: 0,
                enqueued_at: 0,
                offline_streak: 0,
                in_flight: false,
            };
            super::complete(
                &mut store,
                item,
                super::super::now(),
                super::Outcome::Rejected(400),
            );
        }
        store.save().unwrap();
        let state = serde_json::to_value(super::super::store::Store::load(dir.clone())).unwrap();
        assert_eq!(state["dead"].as_array().unwrap().len(), 100);
        assert!(!state.to_string().contains("PRIVATE-BODY-CANARY"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn retry_bands_match_phone_and_are_bounded() {
        assert_eq!(super::backoff(1, 25), 60);
        assert_eq!(super::backoff(4, 25), 480);
        assert_eq!(super::backoff(20, 25), 3600);
    }

    fn offline() -> super::Outcome {
        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(2))
            .build();
        let error = agent.post("http://127.0.0.1:1/report").send_string("{}");
        super::classify(error)
    }

    /// A listener that accepts a connection and then says nothing.
    fn silent_listener(closes: bool) -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((stream, _)) = listener.accept() {
                if closes {
                    drop(stream);
                } else {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
            }
        });
        port
    }

    /// One drain cycle: the queued report leaves the queue, its attempt is
    /// bumped and persisted before dispatch, and the answer lands in complete.
    fn dispatch(store: &mut super::super::store::Store, now: u64, outcome: super::Outcome) {
        let mut item = store.queue.remove(0);
        item.attempts += 1;
        super::complete(store, item, now, outcome);
    }

    fn queued(name: &str, now: u64) -> super::super::store::Store {
        let dir = std::env::temp_dir().join(format!("kalsa-{name}-{}", std::process::id()));
        let mut store = super::super::store::Store::load(dir.clone());
        store.queue.push(super::Item {
            report: super::super::privacy_tests::sample(),
            attempts: 0,
            ready_at: 0,
            enqueued_at: now,
            offline_streak: 0,
            in_flight: false,
        });
        std::fs::remove_dir_all(dir).unwrap();
        store
    }

    #[test]
    fn a_refused_connection_is_an_attempt_the_server_never_answered() {
        assert_eq!(offline(), super::Outcome::Offline);
    }

    #[test]
    fn a_name_that_never_resolves_is_offline() {
        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(2))
            .resolver(|_host: &str| Err(std::io::Error::other("no resolver in the test")))
            .build();
        let error = agent.post("http://kalsa.invalid/report").send_string("{}");
        assert_eq!(super::classify(error), super::Outcome::Offline);
    }

    #[test]
    fn a_server_that_connects_then_stalls_is_a_server_answer() {
        let port = silent_listener(false);
        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_millis(300))
            .build();
        let error = agent
            .post(&format!("http://127.0.0.1:{port}/report"))
            .send_string("{}");
        assert_eq!(super::classify(error), super::Outcome::Retry);
    }

    #[test]
    fn a_tls_handshake_that_never_completes_is_a_server_answer() {
        let port = silent_listener(true);
        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(2))
            .build();
        let error = agent
            .post(&format!("https://127.0.0.1:{port}/report"))
            .send_string("{}");
        assert_eq!(super::classify(error), super::Outcome::Retry);
    }

    #[test]
    fn the_offline_streak_grows_the_backoff_to_the_hour_cap() {
        let mut store = queued("streak", super::super::now());
        let mut now = super::super::now();
        let mut delays = Vec::new();
        for _ in 0..10 {
            dispatch(&mut store, now, offline());
            delays.push(store.queue[0].ready_at - now);
            now += 4_000;
        }
        assert_eq!(store.queue[0].offline_streak, 10);
        assert_eq!(store.queue[0].attempts, 0);
        assert!(delays[9] >= 30 * 60, "the backoff must grow: {delays:?}");
        assert!(delays[9] <= super::MAX_DELAY);
        assert!(delays[9] > delays[0], "the backoff must grow: {delays:?}");
        // A server answer ends the streak: the next offline gap starts over.
        dispatch(&mut store, now, super::Outcome::Retry);
        now += 5_000;
        assert_eq!(store.queue[0].offline_streak, 0);
        dispatch(&mut store, now, offline());
        assert_eq!(store.queue[0].offline_streak, 1);
        assert_eq!(store.queue[0].attempts, 1);
        assert!(store.queue[0].ready_at - now < 30 * 60);
    }

    #[test]
    fn twenty_offline_failures_then_success_is_sent_and_never_dead_lettered() {
        let mut store = queued("offline", super::super::now());
        let mut now = super::super::now();
        for cycle in 0..20 {
            dispatch(&mut store, now, offline());
            assert_eq!(
                store.queue.len(),
                1,
                "cycle {cycle}: an offline failure requeues the report"
            );
            assert_eq!(
                store.queue[0].attempts, 0,
                "cycle {cycle}: an offline failure consumes no attempt"
            );
            assert!(store.queue[0].ready_at - now <= super::MAX_DELAY);
            now += 4_000;
        }
        dispatch(&mut store, now, super::Outcome::Done);
        assert!(store.queue.is_empty());
        let state = serde_json::to_value(&store).unwrap();
        assert!(state["dead"].as_array().unwrap().is_empty());
    }

    #[test]
    fn five_server_errors_still_dead_letter_the_report() {
        let response = ureq::Response::new(503, "Service Unavailable", "BODY").unwrap();
        assert_eq!(
            super::classify(Err(ureq::Error::Status(503, response))),
            super::Outcome::Retry
        );
        let mut store = queued("server", super::super::now());
        let mut now = super::super::now();
        for _ in 0..5 {
            dispatch(&mut store, now, super::Outcome::Retry);
            now += 5_000;
        }
        assert!(store.queue.is_empty());
        let state = serde_json::to_value(&store).unwrap();
        assert_eq!(state["dead"].as_array().unwrap().len(), 1);
    }
}
