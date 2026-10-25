use super::*;

/// Writes `bytes` under `rel` below `root`, creating directories — the
/// test-side twin of what ollama, LM Studio or a hub cache has on disk.
fn planted(root: &std::path::Path, rel: &[&str], bytes: &[u8]) -> PathBuf {
    let mut path = root.to_path_buf();
    for part in rel {
        path = path.join(part);
    }
    std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdirs");
    std::fs::write(&path, bytes).expect("write");
    path
}

/// The cheap pass over digest-named stores answers BEFORE the generic
/// scan can reach an equally valid, friendly-named copy in an earlier
/// root. Both copies hold the exact pinned bytes, so every byte of the
/// answer is correct either way — this pins WHO answers: a store that
/// names its blob by the digest is settled by a stat and one confirming
/// read, and removing the reuse pass (falling back to find_local alone)
/// turns this red, because the generic engine would return the
/// friendly-named copy it meets first.
#[test]
fn a_digest_named_store_is_reused_before_the_generic_scan_answers() {
    let digest = digest_of(PLAN_BODY);
    let friendly_root = scratch("reuse-friendly");
    let blob_root = scratch("reuse-blobs");
    let friendly = planted(
        &friendly_root,
        &["pub", "unsloth", "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf"],
        PLAN_BODY,
    );
    let blob = planted(
        &blob_root,
        &["models", "blobs", &format!("sha256-{digest}")],
        PLAN_BODY,
    );
    let root = scratch("reuse-plan");
    let plan = DownloadPlan {
        mmproj: None,
        url: "https://huggingface.co/example/resolve/0123/weights.gguf".to_string(),
        bytes: PLAN_BODY.len() as u64,
        sha256: PLAN_SHA256,
        drafter: None,
    };
    let found = acquire_model(
        &plan,
        &root.join("models"),
        &[friendly_root.clone(), blob_root.clone()],
        true,
        &mut |_| {},
    )
    .expect("the pinned copy in the digest store is on this disk");
    assert_eq!(
        found.weights, blob,
        "the cheap pass must answer first, not {:?}",
        found.weights
    );
    assert_ne!(found.weights, friendly);
    assert!(found.drafter.is_none());
    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_dir_all(&friendly_root);
    let _ = std::fs::remove_dir_all(&blob_root);
}

/// The reuse pass's own promise, kept at the call site: a blob whose
/// right name lies about its bytes (a torn pull) is refused by the cheap
/// pass, and that "no" is an optimization failing, not a verdict — the
/// generic engine underneath still finds the honest copy, named like a
/// file, in another store. No download is attempted: the plan's URL
/// points nowhere, so an attempted fetch would fail loudly here.
#[test]
fn a_failed_fast_pass_falls_through_to_the_generic_scan() {
    let digest = digest_of(PLAN_BODY);
    let mut torn = PLAN_BODY.to_vec();
    let last = torn.len() - 1;
    torn[last] ^= 0xff;
    let blob_root = scratch("reuse-torn");
    let friendly_root = scratch("reuse-honest");
    planted(
        &blob_root,
        &["models", "blobs", &format!("sha256-{digest}")],
        &torn,
    );
    let friendly = planted(
        &friendly_root,
        &["models", "publisher", "weights.gguf"],
        PLAN_BODY,
    );
    let root = scratch("reuse-fallthrough");
    let plan = DownloadPlan {
        mmproj: None,
        url: "https://huggingface.co/example/resolve/0123/weights.gguf".to_string(),
        bytes: PLAN_BODY.len() as u64,
        sha256: PLAN_SHA256,
        drafter: None,
    };
    let found = acquire_model(
        &plan,
        &root.join("models"),
        &[blob_root.clone(), friendly_root.clone()],
        true,
        &mut |_| {},
    )
    .expect("the honest copy is still found");
    assert_eq!(found.weights, friendly);
    assert!(
        !root.join("models").join("weights.gguf").exists(),
        "nothing was downloaded: reuse answered"
    );
    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_dir_all(&friendly_root);
    let _ = std::fs::remove_dir_all(&blob_root);
}
