use super::privacy_tests::sample;
use super::store::{QUEUE_CAP, Store};
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
    store.enqueue(sample());
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
        report["context"]["attempt"] = ((n % 5) + 1).into();
        store.enqueue(report);
    }
    assert_eq!(store.queue.len(), QUEUE_CAP);
    store.save().unwrap();
    assert_eq!(Store::load(dir.clone()).queue.len(), QUEUE_CAP);
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
    store.enqueue(sample());
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
