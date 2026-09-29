use super::*;
use kalsa_catalog::rows;
use sha2::{Digest, Sha256};
use std::io::Write;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "kalsa-brain-placement-{name}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("mkdir");
    dir
}

fn digest_of(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// A loopback HTTP server answering every request with the same body:
/// what a HuggingFace resolve endpoint looks like to this walk, without
/// touching a real network.
fn serve(
    body: &'static [u8],
    file: &str,
) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    let requests = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = std::sync::Arc::clone(&requests);
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let mut buf = [0u8; 1024];
            let _ = std::io::Read::read(&mut stream, &mut buf);
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(body);
            let _ = stream.flush();
        }
    });
    (format!("http://{addr}/{file}"), requests)
}

// The loopback bodies and their digests, both constants: the plan's
// digest field is 'static because the catalog's rows are, so the test
// does the same thing a row does — pins bytes to a digest known in
// advance.
const PLAN_BODY: &[u8] = b"kalsa-brain loopback weights for the download plan test";
const PLAN_SHA256: &str = "44dff4aa25ed679690893bf2e5b6f68362763235d2b136c980b7da9c147ef626";
const DRAFTER_BODY: &[u8] = b"kalsa-brain loopback drafter for the download plan test";
const DRAFTER_SHA256: &str = "9393736b554ca60cd555c0c9ea4104988ef92531db290000d20a5bf74426cb7f";

fn requests_of(server: &std::sync::Arc<std::sync::atomic::AtomicUsize>) -> usize {
    server.load(std::sync::atomic::Ordering::SeqCst)
}

#[test]
fn the_placement_stops_when_the_model_is_not_consented() {
    // The download gate: without a stored choice a fetch is refused
    // with a distinct verdict and costs zero bytes; with it the file is
    // fetched and digest-verified as always. The gate holds before the
    // disk is consulted, so a copy already here is not consent either.
    let (url, requests) = serve(PLAN_BODY, "stories260K.gguf");
    let root = scratch("ask-placement");
    let plan = DownloadPlan {
        url: url.clone(),
        bytes: PLAN_BODY.len() as u64,
        sha256: PLAN_SHA256,
        drafter: None,
    };
    let stopped = place_model(&plan, &root, false, &mut |_| {})
        .expect_err("nothing consents here: the walk waits");
    assert!(
        matches!(stopped, StartupFailure::AwaitingChoice),
        "a distinct verdict, not a download failure: {stopped:?}"
    );
    assert_eq!(
        requests_of(&requests),
        0,
        "the gate must cost no bytes: the download was never called"
    );
    let placed = place_model(&plan, &root, true, &mut |_| {}).expect("downloaded");
    assert_eq!(std::fs::read(&placed.weights).expect("read"), PLAN_BODY);
    let again = place_model(&plan, &root, false, &mut |_| {})
        .expect_err("the file on disk is not the owner's pick");
    assert!(matches!(again, StartupFailure::AwaitingChoice), "{again:?}");
    assert_eq!(
        requests_of(&requests),
        1,
        "one fetch in the whole test: the gate held for the copy on disk too"
    );
}

#[test]
fn a_stale_choice_places_nothing_not_even_a_copy_that_is_already_here() {
    // The gate against a file that is already on disk: a row the stored
    // token does not name is not placed from a local copy either. The
    // stub behind the loopback URL counts requests, so a broken gate
    // would show up here as bytes — and the catalog is never asked.
    let (url, requests) = serve(PLAN_BODY, "stories260K.gguf");
    let root = scratch("stale-local-copy");
    let models = root.join("models");
    std::fs::create_dir_all(&models).expect("mkdir");
    let plan = DownloadPlan {
        url,
        bytes: PLAN_BODY.len() as u64,
        sha256: PLAN_SHA256,
        drafter: None,
    };
    let local = models.join(plan.url.rsplit('/').next().expect("a file name"));
    std::fs::write(&local, PLAN_BODY).expect("the copy already here");
    let row = rows().next().expect("the catalog carries rows");
    let stopped = place_model(
        &plan,
        &root,
        crate::startup::consented(Some("not-a-token"), row),
        &mut |_| {},
    )
    .expect_err("a row nobody picked is not placed, not even from disk");
    assert!(
        matches!(stopped, StartupFailure::AwaitingChoice),
        "{stopped:?}"
    );
    assert_eq!(requests_of(&requests), 0, "no request was made");
    assert_eq!(
        std::fs::read(&local).expect("the copy is still there"),
        PLAN_BODY,
        "and it is untouched"
    );
}

#[test]
fn a_plan_downloads_the_weights_and_verifies_the_digest() {
    let (url, requests) = serve(PLAN_BODY, "stories260K.gguf");
    let root = scratch("plan");
    let plan = DownloadPlan {
        url,
        bytes: PLAN_BODY.len() as u64,
        sha256: PLAN_SHA256,
        drafter: None,
    };
    let placed = place_model(&plan, &root, true, &mut |_| {}).expect("downloaded");
    assert_eq!(
        std::fs::read(&placed.weights).expect("read"),
        PLAN_BODY,
        "what landed is what the digest promised"
    );
    assert_eq!(digest_of(PLAN_BODY), PLAN_SHA256);
    // A second pass with the file already on disk downloads nothing: the
    // on-disk bytes are re-hashed, and the server must not be asked again.
    let again = place_model(&plan, &root, true, &mut |_| {}).expect("from disk");
    assert_eq!(again, placed);
    assert_eq!(
        requests_of(&requests),
        1,
        "the second pass must be served from disk, not the wire"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_weights_download_that_does_not_match_the_digest_is_thrown_away() {
    let body = &b"bytes a hostile link would serve"[..];
    let (url, _addr) = serve(body, "stories260K.gguf");
    let root = scratch("corrupt");
    let plan = DownloadPlan {
        url,
        bytes: body.len() as u64,
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        drafter: None,
    };
    let err = place_model(&plan, &root, true, &mut |_| {}).expect_err("the digest is the promise");
    assert!(matches!(err, StartupFailure::DownloadCorrupted), "{err:?}");
    assert!(
        !root.join("models").join("stories260K.gguf").exists(),
        "a corrupt download must not become the model"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_plan_address_that_is_not_a_plain_name_is_refused() {
    // The name is where the file lands: an address ending in a
    // separator-riding or parent-riding name would write outside the
    // models directory, so it is refused rather than guessed at.
    assert_eq!(
        plan_file_name("https://host/dir/weights.gguf").ok(),
        Some("weights.gguf")
    );
    assert!(plan_file_name("https://host/dir/").is_err());
    assert!(plan_file_name("https://host/dir/back\\..\\weights.gguf").is_err());
    assert!(plan_file_name("https://host/dir/..").is_err());
}

mod drafter;
mod reuse;
