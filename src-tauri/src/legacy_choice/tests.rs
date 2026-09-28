use super::*;
use sha2::{Digest, Sha256};

const BODY: &[u8] = b"weights an old install downloaded and tuned";
const BODY2: &[u8] = b"weights of the other model the old install tuned";
const TOKEN: &str = "00c0ffee00c0ffee";
const TOKEN2: &str = "00f00d0000f00d00";

fn scratch(name: &str) -> std::path::PathBuf {
    let dir =
        std::env::temp_dir().join(format!("kalsa-brain-legacy-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("models")).expect("mkdir");
    dir
}

fn digest() -> &'static str {
    static DIGEST: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    DIGEST.get_or_init(|| format!("{:x}", Sha256::digest(BODY)))
}

fn digest2() -> &'static str {
    static DIGEST: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    DIGEST.get_or_init(|| format!("{:x}", Sha256::digest(BODY2)))
}

fn lookup(wanted: &str) -> Option<Pinned> {
    match wanted {
        d if d == digest() => Some(Pinned {
            token: TOKEN.to_string(),
            file: "old.gguf".to_string(),
            bytes: BODY.len() as u64,
            sha256: digest(),
        }),
        d if d == digest2() => Some(Pinned {
            token: TOKEN2.to_string(),
            file: "new.gguf".to_string(),
            bytes: BODY2.len() as u64,
            sha256: digest2(),
        }),
        _ => None,
    }
}

/// A record the way the tune files one, under the model's own digest.
fn record_for(root: &Path) -> std::path::PathBuf {
    let record = kalsa_tune::record::Record {
        fingerprint: format!("kalsa-tune fp v1|model={}|ctx=1", digest()),
        winner: None,
        trials: vec![(
            kalsa_tune::Candidate {
                backend: kalsa_runtime::ServerBackend::Cpu,
                threads: Some(8),
                offload: kalsa_launch::Offload::NoGpuBuild,
            },
            kalsa_tune::record::Kept::Best(21.0),
        )],
    };
    kalsa_tune::record::save(root, digest(), &record).expect("record");
    root.join(format!("tuning-{}.txt", digest()))
}

fn other_record_for(root: &Path) -> std::path::PathBuf {
    let record = kalsa_tune::record::Record {
        fingerprint: format!("kalsa-tune fp v1|model={}|ctx=1", digest2()),
        winner: None,
        trials: vec![(
            kalsa_tune::Candidate {
                backend: kalsa_runtime::ServerBackend::Cpu,
                threads: Some(8),
                offload: kalsa_launch::Offload::NoGpuBuild,
            },
            kalsa_tune::record::Kept::Best(19.0),
        )],
    };
    kalsa_tune::record::save(root, digest2(), &record).expect("record");
    root.join(format!("tuning-{}.txt", digest2()))
}

fn stored(state_file: &Path) -> Option<String> {
    crate::options::load(state_file).model
}

#[test]
fn a_legacy_record_with_its_verified_file_becomes_the_choice() {
    let root = scratch("valid");
    let per_model = record_for(&root);
    std::fs::rename(per_model, root.join("tuning.txt")).expect("the pre-split name");
    std::fs::write(root.join("models").join("old.gguf"), BODY).expect("the file");
    let state_file = root.join("server.state");

    assert!(migrate_with(&state_file, &root, lookup));
    assert_eq!(stored(&state_file).as_deref(), Some(TOKEN));
    assert_eq!(
        std::fs::read(marker(&state_file)).expect("the marker names what it settled"),
        digest().as_bytes()
    );
    assert!(!migrate_with(&state_file, &root, lookup), "a stored choice is never overwritten");
}

#[test]
fn a_cleared_choice_does_not_restart_the_migration() {
    // A successful migration is settled once and for all: the walk or the
    // owner can clear the stored choice later, and the next launch must not
    // hash the file again to re-ask a question that was answered.
    let root = scratch("settled");
    let per_model = record_for(&root);
    std::fs::rename(per_model, root.join("tuning.txt")).expect("the pre-split name");
    std::fs::write(root.join("models").join("old.gguf"), BODY).expect("the file");
    let state_file = root.join("server.state");

    let checks = std::cell::Cell::new(0);
    let counting = |wanted: &str| {
        checks.set(checks.get() + 1);
        lookup(wanted)
    };
    assert!(migrate_with(&state_file, &root, counting));
    assert_eq!(checks.get(), 1, "the first launch hashed the file");

    let mut overrides = crate::options::load(&state_file);
    overrides.model = None;
    crate::options::save(&state_file, overrides).expect("the choice is cleared");

    assert!(settled(&state_file, digest()), "the settled check is recorded");
    assert!(!migrate_with(&state_file, &root, counting));
    assert_eq!(checks.get(), 1, "no second hash: the marker stands");
    assert_eq!(stored(&state_file), None, "and the cleared choice stays cleared");
}

#[test]
fn a_marker_that_cannot_be_written_is_not_a_settlement() {
    // The marker's home is a file, not a directory: the owner-only write
    // fails, and the migration must answer "not migrated" and leave the
    // question open — the next launch hashes again rather than trusting a
    // settlement that never reached the disk.
    let root = scratch("unwritable");
    let per_model = record_for(&root);
    std::fs::rename(per_model, root.join("tuning.txt")).expect("the pre-split name");
    let same_size = vec![b'x'; BODY.len()];
    std::fs::write(root.join("models").join("old.gguf"), same_size).expect("the wrong bytes");
    std::fs::write(root.join("blocked"), b"a file, not a directory").expect("the blocker");
    let state_file = root.join("blocked").join("server.state");

    let checks = std::cell::Cell::new(0);
    let counting = |wanted: &str| {
        checks.set(checks.get() + 1);
        lookup(wanted)
    };
    assert!(!migrate_with(&state_file, &root, counting));
    assert!(!settled(&state_file, digest()), "a failed write records nothing");
    assert!(!migrate_with(&state_file, &root, counting));
    assert_eq!(checks.get(), 2, "the check runs again: nothing was recorded");
}

#[test]
fn a_record_naming_another_model_reopens_the_check() {
    // The marker names the digest it settled on. A record that later names
    // a different legacy model is a new question: it is checked and, if its
    // file verifies, adopted.
    let root = scratch("second-record");
    let per_model = record_for(&root);
    std::fs::rename(per_model, root.join("tuning.txt")).expect("the pre-split name");
    std::fs::write(root.join("models").join("old.gguf"), BODY).expect("the file");
    let state_file = root.join("server.state");

    assert!(migrate_with(&state_file, &root, lookup));
    assert_eq!(stored(&state_file).as_deref(), Some(TOKEN));

    let other = other_record_for(&root);
    std::fs::rename(other, root.join("tuning.txt")).expect("the record names another model");
    std::fs::write(root.join("models").join("new.gguf"), BODY2).expect("the other file");
    let mut overrides = crate::options::load(&state_file);
    overrides.model = None;
    crate::options::save(&state_file, overrides).expect("the choice is cleared");

    assert!(!settled(&state_file, digest2()), "another model is another question");
    assert!(migrate_with(&state_file, &root, lookup));
    assert_eq!(stored(&state_file).as_deref(), Some(TOKEN2));
    assert_eq!(
        std::fs::read(marker(&state_file)).expect("the marker"),
        digest2().as_bytes()
    );
}

#[cfg(unix)]
#[test]
fn the_marker_is_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let root = scratch("owner-only");
    let per_model = record_for(&root);
    std::fs::rename(per_model, root.join("tuning.txt")).expect("the pre-split name");
    std::fs::write(root.join("models").join("old.gguf"), BODY).expect("the file");
    let state_file = root.join("server.state");

    assert!(migrate_with(&state_file, &root, lookup));
    let mode = std::fs::metadata(marker(&state_file))
        .expect("the marker exists")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600, "the marker is per-user state: {mode:o}");
}

#[test]
fn per_model_records_never_become_a_choice() {
    let root = scratch("per-model");
    record_for(&root);
    std::fs::write(root.join("models").join("old.gguf"), BODY).expect("the file");
    let state_file = root.join("server.state");

    assert!(!migrate_with(&state_file, &root, lookup));
    assert_eq!(stored(&state_file), None);
}

#[test]
fn a_file_with_the_wrong_bytes_is_not_migrated() {
    let root = scratch("wrong-bytes");
    let per_model = record_for(&root);
    std::fs::rename(per_model, root.join("tuning.txt")).expect("the pre-split name");
    let same_size = vec![b'x'; BODY.len()];
    std::fs::write(root.join("models").join("old.gguf"), same_size).expect("the file");
    let state_file = root.join("server.state");

    assert!(!migrate_with(&state_file, &root, lookup));
    assert_eq!(stored(&state_file), None);
}

#[test]
fn a_failed_legacy_check_is_never_repeated() {
    // The record is checked once. The file was the wrong bytes, and the
    // check hashed it whole — a digest that did not match will not match
    // next launch, so the answer is kept and the hashing never runs again.
    let root = scratch("checked-once");
    let per_model = record_for(&root);
    std::fs::rename(per_model, root.join("tuning.txt")).expect("the pre-split name");
    let file = root.join("models").join("old.gguf");
    std::fs::write(&file, vec![b'x'; BODY.len()]).expect("the wrong bytes");
    let state_file = root.join("server.state");

    let checks = std::cell::Cell::new(0);
    let counting = |wanted: &str| {
        checks.set(checks.get() + 1);
        lookup(wanted)
    };
    assert!(!migrate_with(&state_file, &root, counting));
    assert_eq!(checks.get(), 1, "the first launch checked the record");
    assert_eq!(stored(&state_file), None, "and stored nothing");

    // The file turns out to be right after all: the record was checked, and
    // a checked record is never checked again.
    std::fs::write(&file, BODY).expect("the right bytes now");
    assert!(!migrate_with(&state_file, &root, counting));
    assert_eq!(checks.get(), 1, "no second check, no re-hash");
    assert_eq!(stored(&state_file), None, "and nothing was stored");
}

#[test]
fn an_unreadable_model_leaves_no_marker() {
    // An I/O error is not an answer: the file could not be read, so the
    // question stays open for the next launch and nothing is recorded —
    // only a file read whole and found wrong ends the checking.
    let root = scratch("unreadable");
    let per_model = record_for(&root);
    std::fs::rename(per_model, root.join("tuning.txt")).expect("the pre-split name");
    // `models` becomes a file, so the model path below it cannot be opened
    // at all: opening fails with a directory error, not a digest.
    std::fs::remove_dir_all(root.join("models")).expect("drop the directory");
    std::fs::write(root.join("models"), b"not a directory").expect("a file instead");
    let state_file = root.join("server.state");

    assert!(!migrate_with(&state_file, &root, lookup));
    assert!(!settled(&state_file, digest()), "an I/O error records nothing");
    assert_eq!(stored(&state_file), None, "and nothing was stored");
}

#[test]
fn the_check_runs_off_the_calling_thread_and_lowers_its_flag() {
    let flag = Arc::new(AtomicBool::new(false));
    let (release, wait) = std::sync::mpsc::channel::<()>();
    let handle = spawn_flagged(Arc::clone(&flag), move || {
        let _ = wait.recv_timeout(std::time::Duration::from_secs(5));
    });
    assert!(flag.load(Ordering::SeqCst), "the caller returned while the work still runs");
    release.send(()).expect("the work is waiting");
    handle.join().expect("the work ends");
    assert!(!flag.load(Ordering::SeqCst), "the flag comes down when the work ends");

    let flag = Arc::new(AtomicBool::new(false));
    let panicked = spawn_flagged(Arc::clone(&flag), || panic!("the check blew up"));
    assert!(panicked.join().is_err());
    assert!(!flag.load(Ordering::SeqCst), "a panic still lowers the flag");
}
