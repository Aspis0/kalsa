//! The catalog walk against the real world: a real GGUF from HuggingFace,
//! fetched by this crate's `download()`, killed mid-flight, resumed, and
//! held to the digest the catalog promises.
//!
//! Everything else in this crate is proved against fixtures: an origin we
//! wrote, bytes we chose, a range behaviour we scripted. That proves the
//! logic and says nothing about the facts only the world can settle — that
//! the `resolve/<commit>/<file>` endpoint answers, how many redirects precede
//! the CDN, whether the CDN honours `Range`, and whether a three-and-a-half
//! gigabyte file that dies halfway comes back as exactly the file the
//! manifest promised.
//!
//! Ignored by default: it moves gigabytes over the network and writes to the
//! product's real runtime directory. Run it deliberately:
//!
//! ```text
//! KALSA_BRAIN_REAL_DOWNLOAD=1 cargo test -p kalsa-download \
//!     --test real_catalog -- --ignored --nocapture
//! ```

use kalsa_download::download;
use kalsa_runtime::runtime_root;
use std::time::Instant;

/// The smallest catalog row that carries a `GgufSource` — (repo, commit,
/// file, bytes, sha256), copied from `crates/kalsa-catalog/src/manifest.rs`,
/// which is where it lives and the only place it may be corrected.
const ROW: (&str, &str, &str, u64, &str) = (
    "arcee-ai/Trinity-Nano-Preview-GGUF",
    "2aa08593b79242d224da0215fb36924dcc0f87ea",
    "Trinity-Nano-Preview-Q4_K_M.gguf",
    3_786_957_088,
    "287562a3824ce2277e2c71cfcc70248b2d90f7fa342a4779979e0bf3e37ad546",
);

/// Where the first leg is killed: far enough in that resuming is real work,
/// far enough from the end that the second leg is measurable.
const INTERRUPT_AT: u64 = 512 * 1024 * 1024;

#[test]
#[ignore = "moves ~3.6 GB over the network; set KALSA_BRAIN_REAL_DOWNLOAD=1"]
fn a_catalog_row_downloads_resumes_and_verifies_for_real() {
    if std::env::var_os("KALSA_BRAIN_REAL_DOWNLOAD").is_none() {
        eprintln!("skip: set KALSA_BRAIN_REAL_DOWNLOAD=1 to move gigabytes over the network");
        return;
    }
    let (_repo, _commit, file, bytes, sha) = ROW;
    let dir = runtime_root().join("models");
    std::fs::create_dir_all(&dir).expect("the product's models dir");
    let dest = dir.join(file);
    let part = dir.join(format!("{file}.part"));
    // A clean start, whatever a previous run left behind.
    let _ = std::fs::remove_file(&dest);
    let _ = std::fs::remove_file(&part);

    hop_report(&resolve_url());
    range_probe(&resolve_url(), bytes);

    // ── first leg: killed from the progress callback, mid-transfer ─────────
    // The honest interruption: the callback aborts the walk the way a
    // crashed process would, and whatever reached the disk stays there.
    let url = resolve_url();
    let dest_for_thread = dest.clone();
    let started = Instant::now();
    let first = std::thread::spawn(move || {
        download(&url, &dest_for_thread, bytes, sha, &mut |p| {
            if p.bytes_done >= INTERRUPT_AT {
                panic!("interrupted by the test at {} bytes", p.bytes_done);
            }
        })
    });
    // The timer lives here, not in the thread: the kill is a panic, and the
    // panic takes whatever the thread was holding with it.
    let interrupted = first.join();
    let leg1 = started.elapsed();
    assert!(
        interrupted.is_err(),
        "the first leg finished without being killed"
    );
    let part_len = std::fs::metadata(&part)
        .expect("the part file must survive the kill")
        .len();
    assert!(
        part_len >= INTERRUPT_AT && part_len < bytes,
        "the interruption did not land mid-file: {part_len} bytes"
    );
    eprintln!(
        "leg 1: killed at >={INTERRUPT_AT} bytes; the part file holds {part_len} bytes ({leg1:.1?})"
    );

    // ── second leg: resumes from the part file and finishes ────────────────
    let url = resolve_url();
    let mut resumed_from = None;
    let mut reported_total = 0;
    let started = Instant::now();
    let second = download(&url, &dest, bytes, sha, &mut |p| {
        if resumed_from.is_none() {
            resumed_from = Some(p.bytes_done);
        }
        reported_total = p.bytes_total;
    });
    let leg2 = started.elapsed();
    second.expect("the resumed download must verify and publish");
    let resumed_from = resumed_from.expect("progress must report at least once");
    assert_eq!(
        resumed_from, part_len,
        "the resume must start at the surviving prefix, not at zero"
    );
    assert_eq!(
        reported_total, bytes,
        "bytes_total must be the promised size, never zero or a server guess"
    );
    assert!(dest.is_file(), "the model is not under its final name");
    assert_eq!(
        std::fs::metadata(&dest).expect("metadata").len(),
        bytes,
        "the published file is not the promised size"
    );
    assert!(!part.exists(), "the part file outlived its rename");
    let mibs = (bytes - part_len) as f64 / leg2.as_secs_f64() / (1024.0 * 1024.0);
    eprintln!(
        "leg 2: resumed at {resumed_from}, fetched {} bytes in {:.1?} = {mibs:.1} MiB/s",
        bytes - part_len,
        leg2
    );
    eprintln!("=== digest verified by download(): {sha} ===");
    // The file stays: it is the product's model now, not test litter.
}

fn resolve_url() -> String {
    let (repo, commit, file, ..) = ROW;
    format!("https://huggingface.co/{repo}/resolve/{commit}/{file}")
}

fn host_of(url: &str) -> &str {
    url.split("://")
        .nth(1)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or(url)
}

/// The resolve endpoint and every hop to the CDN, counted for real.
fn hop_report(start: &str) {
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    let mut url = start.to_string();
    for hop in 1..=6 {
        let response = match agent.get(&url).call() {
            Ok(response) => response,
            Err(ureq::Error::Status(code, _)) => {
                eprintln!("hop {hop}: HTTP {code} at {}", host_of(&url));
                return;
            }
            Err(e) => panic!("hop {hop} to {} failed: {e}", host_of(&url)),
        };
        let status = response.status();
        eprintln!("hop {hop}: HTTP {status} at {}", host_of(&url));
        match response.header("Location") {
            Some(next) if (300..400).contains(&status) => url = next.to_string(),
            _ => return,
        }
    }
    eprintln!("the redirect chain did not end within six hops");
}

/// Does the endpoint behind the redirects honour `Range`? Quote the lines —
/// if it does not, that is a fact only the world can tell us.
fn range_probe(start: &str, bytes: u64) {
    let response = match ureq::get(start).set("Range", "bytes=0-1023").call() {
        Ok(response) => response,
        Err(ureq::Error::Status(code, _)) => panic!("the range probe answered HTTP {code}"),
        Err(e) => panic!("the range probe failed: {e}"),
    };
    eprintln!(
        "range probe: HTTP {} / Content-Length {:?} / Content-Range {:?}",
        response.status(),
        response.header("Content-Length"),
        response.header("Content-Range"),
    );
    assert_eq!(
        response.status(),
        206,
        "the endpoint did not answer 206 to Range"
    );
    let range = response
        .header("Content-Range")
        .expect("a 206 carries Content-Range");
    let total: u64 = range
        .rsplit('/')
        .next()
        .expect("a total after the slash")
        .parse()
        .expect("a numeric total");
    assert_eq!(
        total, bytes,
        "the server's total must equal the manifest's bytes"
    );
}
