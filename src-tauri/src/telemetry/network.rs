use std::sync::Arc;
use std::time::Duration;

use super::{Service, store::Item};

const ENDPOINT: &str = "https://telemetry.kalsa.io/report";

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
        let Some(index) = inner.store.queue.iter().position(|q| q.ready_at <= now) else {
            return;
        };
        let item = &mut inner.store.queue[index];
        item.attempts += 1;
        item.ready_at = now + 60;
        item.report["context"]["attempt"] = item.attempts.into();
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
    if let Outcome::Rejected(status) = outcome {
        store.dead(item, now);
        log::warn!(
            "telemetry rejected: code={status} reports=1 queued={}",
            store.queue.len()
        );
    } else if outcome == Outcome::Retry {
        if item.attempts >= 5 {
            store.dead(item, now);
        } else {
            let entropy = u64::from_str_radix(&super::sanitize::fingerprint(&item.report)[..4], 16)
                .unwrap_or(0);
            item.ready_at = now + backoff(item.attempts, entropy);
            store.queue.push(item);
        }
    }
}

#[derive(PartialEq, Debug)]
enum Outcome {
    Done,
    Retry,
    Rejected(u16),
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
}
