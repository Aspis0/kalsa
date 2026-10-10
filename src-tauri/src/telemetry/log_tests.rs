use super::privacy_tests::sample;
use super::store::Store;
use std::cell::Cell;
use std::sync::Arc;

/// A service whose queue holds `count` reports that each owe a log. The
/// reports are told apart by their osMajor, so each upload's target is its
/// own item.
fn service(name: &str, count: usize, on: bool) -> (Arc<super::Service>, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("kalsa-log-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let mut store = Store::load(dir.clone());
    for n in 0..count {
        let mut report = sample();
        report["osMajor"] = serde_json::json!(format!("{n}"));
        store.enqueue(report, true, 0);
    }
    if !on {
        // The switch went off after the reports were queued. The real OFF
        // path also clears the queue, which is the drain's business.
        store.enabled = false;
    }
    let service = Arc::new(super::Service {
        inner: std::sync::Mutex::new(super::Inner {
            store,
            epoch: 0,
            recent: Default::default(),
            breadcrumbs: Default::default(),
            base: serde_json::json!({}),
            category: "unknown",
            total_ram: 0,
            cpu: Default::default(),
            resource_snapshot: serde_json::json!({}),
            started: None,
            last_state: None,
            last_failure: None,
            engine_stage: "decode",
            reach: super::network::Reach::Through,
            crash_at: None,
            stream_error_at: None,
        }),
        send_gate: std::sync::Mutex::new(()),
    });
    (service, dir)
}

/// A clock past every item's settle and backoff wait, so each cycle's pick
/// finds its item ready.
fn now() -> u64 {
    super::now() + 3600
}

/// One dispatch cycle with standing answers: the log upload answers
/// `answer`, the report POST records what it was handed and answers
/// offline, which requeues the item for the cycle that follows. Returns what
/// the cycle sent, if it sent anything.
fn cycle(
    service: &super::Service,
    work: super::store::Item,
    epoch: u64,
    when: u64,
    uploads: &Cell<u32>,
    answer: impl Fn() -> Result<String, crate::report::SendFailure>,
) -> Option<serde_json::Value> {
    let sent = Cell::new(None);
    let out = super::network::Outbound {
        body: &|| "the redacted log\n".to_string(),
        upload: &|_| {
            uploads.set(uploads.get() + 1);
            answer()
        },
        report: &|report| {
            sent.set(Some(report.clone()));
            super::network::Outcome::Offline(super::network::Why::Refused)
        },
    };
    super::network::dispatch(service, work, epoch, when, &out);
    sent.into_inner()
}

#[test]
fn a_crash_log_is_uploaded_once_and_the_report_names_it() {
    let (service, dir) = service("once", 1, true);
    let when = now();
    let (work, epoch) = super::network::pick(&service, when).expect("the pick takes the item");
    assert!(
        service.inner.lock().unwrap().store.queue[0].in_flight,
        "the pick marks the item in flight"
    );
    let uploads = Cell::new(0);
    let sent = cycle(&service, work, epoch, when, &uploads, || {
        Ok("K7XQ2M9P".to_string())
    })
    .expect("the report goes out");
    let day = super::resources::date(when);
    assert_eq!(sent["diagnostics"]["logRef"], format!("{day}/K7XQ2M9P"));
    assert_eq!(uploads.get(), 1);
    assert_eq!(
        super::observability::mine()
            .iter()
            .filter(|line| line.contains("telemetry: log uploaded"))
            .count(),
        1,
        "the upload is said once: {:?}",
        super::observability::mine()
    );
    {
        let inner = service.inner.lock().unwrap();
        assert!(!inner.store.queue[0].log_pending);
        assert!(!inner.store.log_budget_left(&day, 1));
        assert!(inner.store.log_budget_left(&day, 2));
    }
    // The report POST answered offline, so the item waits past its backoff
    // with its reference already on it: the next cycle does not upload again.
    let later = when + 3600;
    let (again, epoch) = super::network::pick(&service, later).expect("the item is requeued");
    let resent = cycle(&service, again, epoch, later, &uploads, || {
        Ok("SECONDID".to_string())
    })
    .expect("the report goes out again");
    assert_eq!(uploads.get(), 1, "the log is uploaded exactly once");
    assert_eq!(resent["diagnostics"]["logRef"], format!("{day}/K7XQ2M9P"));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn three_uploads_a_day_and_the_report_goes_without_the_fourth() {
    let (service, dir) = service("cap", 4, true);
    let when = now();
    let day = super::resources::date(when);
    for round in 0..4u8 {
        // Each round takes the next queued item, the way the drain's cycle
        // does once the previous cycle's item is gone.
        let (item, epoch) = super::network::pick(&service, when).expect("an item is queued");
        let uploads = Cell::new(0);
        // The id alphabet has no zero, so the rounds are letters.
        let answer = || {
            Ok(["K7XQ2M9P", "K7XQ2M9Q", "K7XQ2M9R", "K7XQ2M9S"][round as usize].to_string())
        };
        let sent =
            cycle(&service, item, epoch, when, &uploads, answer).expect("the report goes out");
        if round < 3 {
            assert!(sent["diagnostics"]["logRef"].is_string(), "round {round}");
            assert_eq!(uploads.get(), 1, "round {round}");
        } else {
            // The day is spent: no upload was made, and the report names no
            // log.
            assert!(sent["diagnostics"]["logRef"].is_null(), "{sent}");
            assert_eq!(uploads.get(), 0);
        }
    }
    // The day's three are on the count: the daily budget is spent.
    assert!(
        !service
            .inner
            .lock()
            .unwrap()
            .store
            .log_budget_left(&day, 3)
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn an_off_flip_after_the_pick_stops_the_log_and_the_report() {
    let (service, dir) = service("off-mid-flight", 1, true);
    let when = now();
    let (work, epoch) = super::network::pick(&service, when).expect("the pick takes the item");
    let uploads = Cell::new(0);
    let posts = Cell::new(0);
    let out = super::network::Outbound {
        body: &|| {
            // The switch flips while the log body is read: after the pick,
            // before the upload.
            super::commands::set_preference(&service, false).expect("the flip is saved");
            "the redacted log\n".to_string()
        },
        upload: &|_| {
            uploads.set(uploads.get() + 1);
            Ok("K7XQ2M9P".to_string())
        },
        report: &|_| {
            posts.set(posts.get() + 1);
            super::network::Outcome::Done
        },
    };
    super::network::dispatch(&service, work, epoch, when, &out);
    assert_eq!(uploads.get(), 0, "no log upload after the flip");
    assert_eq!(posts.get(), 0, "no report POST after the flip");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn an_offline_upload_keeps_the_item_waiting_with_its_log() {
    let (service, dir) = service("offline", 1, true);
    let when = now();
    let (work, epoch) = super::network::pick(&service, when).expect("the pick takes the item");
    let uploads = Cell::new(0);
    let sent = cycle(&service, work, epoch, when, &uploads, || {
        Err(crate::report::SendFailure::Offline)
    });
    assert!(
        sent.is_none(),
        "nothing is sent when the log is unreachable"
    );
    assert_eq!(uploads.get(), 1);
    let inner = service.inner.lock().unwrap();
    assert!(inner.store.queue[0].log_pending);
    assert!(
        inner
            .store
            .log_budget_left(&super::resources::date(when), 1)
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_refused_upload_sends_the_report_without_the_reference() {
    for (name, answer) in [
        ("refused-tomorrow", crate::report::SendFailure::TryTomorrow),
        ("refused-rate", crate::report::SendFailure::RateLimited),
        ("refused-failed", crate::report::SendFailure::Failed),
    ] {
        let (service, dir) = service(name, 1, true);
        let when = now();
        let (work, epoch) = super::network::pick(&service, when).expect("the pick takes the item");
        let uploads = Cell::new(0);
        let sent = cycle(&service, work, epoch, when, &uploads, || Err(answer))
            .expect("the report goes out");
        assert!(sent["diagnostics"]["logRef"].is_null(), "{name}: {sent}");
        assert_eq!(uploads.get(), 1, "{name}");
        let inner = service.inner.lock().unwrap();
        assert!(!inner.store.queue[0].log_pending, "{name}");
        assert!(
            super::observability::mine()
                .iter()
                .any(|line| line.contains(&format!("log upload failed ({})", answer.code()))),
            "{name}: {:?}",
            super::observability::mine()
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn an_id_off_the_contracts_shape_carries_no_reference() {
    let (service, dir) = service("bad-id", 1, true);
    let when = now();
    let (work, epoch) = super::network::pick(&service, when).expect("the pick takes the item");
    let uploads = Cell::new(0);
    let sent = cycle(&service, work, epoch, when, &uploads, || {
        Ok("not-the-alphabet".to_string())
    })
    .expect("the report goes out");
    assert!(sent["diagnostics"]["logRef"].is_null(), "{sent}");
    assert_eq!(uploads.get(), 1);
    let inner = service.inner.lock().unwrap();
    // The upload answered but names nothing, so the day stays unbilled.
    assert!(
        inner
            .store
            .log_budget_left(&super::resources::date(when), 1)
    );
    std::fs::remove_dir_all(dir).unwrap();
}
