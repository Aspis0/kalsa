use super::privacy_tests::sample;
use super::store::{QUEUE_CAP, Store};
use serde_json::json;
use std::path::PathBuf;

fn scratch(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "kalsa-telemetry-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn fresh_install_is_on() {
    let dir = scratch("fresh");
    let store = Store::load(dir.clone());
    assert!(store.enabled);
    assert!(!store.notice_seen);
    assert!(Store::load(dir.clone()).enabled);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn explicit_off_survives_restart_and_stale_enabled_journal() {
    let dir = scratch("off");
    let mut store = Store::load(dir.clone());
    store.enqueue(sample(), false);
    store.save().unwrap();
    let stale = std::fs::read(dir.join("state.a")).unwrap();
    store.set_enabled(false).unwrap();
    let restarted = Store::load(dir.clone());
    assert!(!restarted.enabled);
    assert!(restarted.queue.is_empty());
    // A surviving ON slot cannot defeat the independently durable OFF tombstone.
    std::fs::write(dir.join("state.a"), stale).unwrap();
    std::fs::remove_file(dir.join("state.b")).unwrap();
    assert!(!Store::load(dir.clone()).enabled);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn queue_cap_keeps_newest_reports_and_persists_them() {
    let dir = scratch("cap");
    let mut store = Store::load(dir.clone());
    for n in 0..60 {
        let mut report = sample();
        report["osMajor"] = json!(format!("{n:08}"));
        report["context"]["attempt"] = ((n % 5) + 1).into();
        store.enqueue(report, false);
    }
    assert_eq!(store.queue.len(), QUEUE_CAP);
    store.save().unwrap();
    let reloaded = Store::load(dir.clone());
    assert_eq!(reloaded.queue.len(), QUEUE_CAP);
    assert_eq!(reloaded.queue[0].report["osMajor"], "00000010");
    assert_eq!(reloaded.queue[QUEUE_CAP - 1].report["osMajor"], "00000059");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn an_unsent_report_expires_thirty_days_after_enqueue_and_is_dropped() {
    let dir = scratch("expiry");
    let mut store = Store::load(dir.clone());
    store.enqueue(sample(), false);
    store.save().unwrap();
    let now = super::now();
    store.queue[0].enqueued_at = now - 31 * 24 * 60 * 60;
    store.save().unwrap();
    let reloaded = Store::load(dir.clone());
    assert!(reloaded.queue.is_empty());
    let state = serde_json::to_value(&reloaded).unwrap();
    assert_eq!(state["dead"], serde_json::json!([]));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_report_without_an_enqueue_stamp_starts_its_window_at_load() {
    let dir = scratch("expiry-legacy");
    let mut store = Store::load(dir.clone());
    store.enqueue(sample(), false);
    store.save().unwrap();
    store.save().unwrap();
    let bytes = std::fs::read(dir.join("state.b")).unwrap();
    let mut state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    state["queue"][0]
        .as_object_mut()
        .unwrap()
        .remove("enqueued_at");
    std::fs::write(dir.join("state.a"), serde_json::to_vec(&state).unwrap()).unwrap();
    std::fs::remove_file(dir.join("state.b")).unwrap();
    let reloaded = Store::load(dir.clone());
    assert_eq!(reloaded.queue.len(), 1);
    let aged = super::now().saturating_sub(30 * 24 * 60 * 60 + 1);
    assert!(reloaded.queue[0].enqueued_at > aged);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn the_running_queue_expires_reports_the_same_way_load_does() {
    let dir = scratch("expiry-live");
    let mut store = Store::load(dir.clone());
    store.enqueue(sample(), false);
    store.save().unwrap();
    let now = super::now();
    store.queue[0].enqueued_at = now - 31 * 24 * 60 * 60;
    assert!(store.expire(now));
    assert!(store.queue.is_empty());
    store.save().unwrap();
    let state = serde_json::to_value(Store::load(dir.clone())).unwrap();
    assert_eq!(state["queue"], json!([]));
    assert_eq!(state["dead"], json!([]));
    // A report inside its window survives the sweep untouched.
    store.enqueue(sample(), false);
    assert!(!store.expire(now));
    assert_eq!(store.queue.len(), 1);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_crash_mid_send_returns_the_attempt_the_server_never_charged() {
    let dir = scratch("inflight");
    let mut store = Store::load(dir.clone());
    store.enqueue(sample(), false);
    store.save().unwrap();
    store.save().unwrap();
    let bytes = std::fs::read(dir.join("state.b")).unwrap();
    let mut state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let item = state["queue"][0].as_object_mut().unwrap();
    item.insert("attempts".into(), json!(3));
    item.insert("in_flight".into(), json!(true));
    std::fs::write(dir.join("state.a"), serde_json::to_vec(&state).unwrap()).unwrap();
    std::fs::remove_file(dir.join("state.b")).unwrap();
    let mut reloaded = Store::load(dir.clone());
    assert_eq!(reloaded.queue.len(), 1);
    assert_eq!(reloaded.queue[0].attempts, 2);
    assert!(!reloaded.queue[0].in_flight);
    // The undo is durable: a second load does not take a second attempt off.
    reloaded.save().unwrap();
    let again = Store::load(dir.clone());
    assert_eq!(again.queue[0].attempts, 2);
    assert!(!again.queue[0].in_flight);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn broken_or_missing_initialized_journal_fails_closed() {
    let dir = scratch("corrupt");
    let mut store = Store::load(dir.clone());
    store.save().unwrap();
    std::fs::write(dir.join("state.a"), b"bad").unwrap();
    assert!(!Store::load(dir.clone()).enabled);
    std::fs::remove_file(dir.join("state.a")).unwrap();
    std::fs::remove_file(dir.join("state.b")).unwrap();
    assert!(!Store::load(dir.clone()).enabled);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn notice_acknowledgement_survives_restart() {
    let dir = scratch("notice");
    let mut store = Store::load(dir.clone());
    store.notice_seen = true;
    store.save().unwrap();
    assert!(Store::load(dir.clone()).notice_seen);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn off_physically_purges_both_state_slots() {
    let dir = scratch("purge");
    let mut store = Store::load(dir.clone());
    store.enqueue(sample(), false);
    store.dead(store.queue[0].clone(), super::now());
    store.save().unwrap();
    store.save().unwrap();
    store.set_enabled(false).unwrap();
    for name in ["state.a", "state.b"] {
        let bytes = std::fs::read(dir.join(name)).unwrap();
        let state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(state["enabled"], false);
        assert_eq!(state["queue"], serde_json::json!([]));
        assert_eq!(state["dead"], serde_json::json!([]));
        assert!(!String::from_utf8(bytes).unwrap().contains("GGML_ASSERT"));
    }
    std::fs::remove_dir_all(dir).unwrap();
}
