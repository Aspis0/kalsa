use super::*;
use sha2::{Digest, Sha256};

const BODY: &[u8] = b"weights an old install downloaded and tuned";
const TOKEN: &str = "00c0ffee00c0ffee";

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

fn lookup(wanted: &str) -> Option<Pinned> {
    (wanted == digest()).then(|| Pinned {
        token: TOKEN.to_string(),
        file: "old.gguf".to_string(),
        bytes: BODY.len() as u64,
        sha256: digest(),
    })
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
    assert!(!migrate_with(&state_file, &root, lookup), "a stored choice is never overwritten");
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
