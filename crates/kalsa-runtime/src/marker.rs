//! What a build directory is: provenance, written next to the bytes.
//!
//! Everything under the per-user directory is writable by anything running
//! as the user, so nothing there is trusted because we put it there. The
//! marker records which archives (by digest) a build was extracted from and
//! what the extracted executable hashed at that moment; [`validate`]
//! re-measures both on every start and refuses anything else — a stale build
//! from a previous release, a replaced executable, a planted one, or a
//! symlink — instead of running it.
//!
//! The marker is provenance, not armour: it lives in the same writable tree,
//! so an attacker who can replace the executable can rewrite it too. The
//! anchor that cannot be rewritten is the asset table's `exe_sha256`, filled
//! by hand from the release; until it is filled, the marker's own record is
//! used, which is honest about accident and honest about its limit.

use std::io::{self, Read};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::extract;

const MAGIC: &str = "kalsa-runtime build v1";
const MARKER: &str = ".kalsa-build";

/// Lowercase hex sha256 of a file's contents, streamed.
pub(crate) fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Records, inside `dir`, what `dir` was built from: the digest of every
/// archive that went into it and the hash of the executable that came out.
/// Called only after every archive's digest has been verified and extracted.
pub(crate) fn write(dir: &Path, runtime: &[(&str, &str)], exe_sha: &str) -> io::Result<()> {
    let mut body = String::from(MAGIC);
    body.push('\n');
    for (file, sha) in runtime {
        body.push_str(&format!("runtime={file}:{sha}\n"));
    }
    body.push_str(&format!("exe={exe_sha}\n"));
    std::fs::write(dir.join(MARKER), body)
}

/// What a marker records: the archive set a build came from and the hash
/// the executable had when it was proven.
struct Provenance {
    runtime: Vec<(String, String)>,
    exe_sha: String,
}

/// The marker's own record, if it parses. None for anything else: a missing
/// marker, a foreign one, or a half-written one is not a build.
fn read(dir: &Path) -> Option<Provenance> {
    let marker = std::fs::read_to_string(dir.join(MARKER)).ok()?;
    let mut lines = marker.lines();
    if lines.next()? != MAGIC {
        return None;
    }
    let mut runtime = Vec::new();
    let mut exe_sha = None;
    for line in lines {
        match line.split_once('=') {
            Some(("runtime", pair)) => {
                let (file, sha) = pair.split_once(':')?;
                runtime.push((file.to_string(), sha.to_string()));
            }
            Some(("exe", sha)) => exe_sha = Some(sha.to_string()),
            _ => return None,
        }
    }
    Some(Provenance {
        runtime,
        exe_sha: exe_sha?,
    })
}

/// The archive set `runtime` names, normalised: order is not identity (the
/// table lists the engine first, a caller may hand the pairs over in any
/// order), so both sides sort before they are compared.
fn sorted_runtime(runtime: &[(&str, &str)]) -> Vec<(String, String)> {
    let mut pairs: Vec<(String, String)> = runtime
        .iter()
        .map(|(file, sha)| ((*file).to_string(), (*sha).to_string()))
        .collect();
    pairs.sort();
    pairs
}
/// The executable in `dir`, if `dir` is exactly the build these digests
/// describe. `table_exe`, when the table knows the release's own exe digest,
/// outranks the marker's record: a marker from any other build refuses the
/// directory outright. `None` means "re-acquire", never "close enough".
pub(crate) fn validate(
    dir: &Path,
    runtime: &[(&str, &str)],
    table_exe: Option<&str>,
) -> Option<PathBuf> {
    let proven = read(dir)?;
    let mut built = proven.runtime;
    built.sort();
    // Order is not identity: the marker records a *set* of (archive, digest)
    // pairs, so both sides are normalised — a build must validate against
    // the marker it just wrote, whatever order each side was handed over in,
    // or the build re-acquires its archives on every launch.
    if built != sorted_runtime(runtime) {
        return None;
    }
    // The table outranks the marker: a marker claiming another build's exe
    // is a marker from another build.
    if let Some(table) = table_exe {
        if !proven.exe_sha.eq_ignore_ascii_case(table) {
            return None;
        }
    }
    let exe = extract::find_server(dir)?;
    // Re-measured, never remembered: the bytes that are here now must still
    // be the bytes the build was proven with.
    if !sha256_file(&exe)
        .ok()?
        .eq_ignore_ascii_case(&proven.exe_sha)
    {
        return None;
    }
    Some(exe)
}

/// Whether `dir` claims to be exactly this build yet carries another
/// release's executable: its marker names these archives, but the recorded
/// exe digest — or the bytes on disk — is not the table's own. A stale
/// build from another release is not a contradiction (its archives differ,
/// and the re-acquire path replaces it); a missing executable is not one
/// either, only a *different* digest is. The caller refuses the directory
/// outright instead of re-acquiring over it, so tampering stays visible.
pub(crate) fn exe_contradicts_table(dir: &Path, runtime: &[(&str, &str)], table_exe: &str) -> bool {
    let Some(proven) = read(dir) else {
        return false;
    };
    let mut built = proven.runtime;
    built.sort();
    if built != sorted_runtime(runtime) {
        return false;
    }
    if !proven.exe_sha.eq_ignore_ascii_case(table_exe) {
        return true;
    }
    match extract::find_server(dir) {
        None => false,
        Some(exe) => !matches!(sha256_file(&exe), Ok(hash) if hash.eq_ignore_ascii_case(table_exe)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-runtime-marker-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    fn digest_of(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    /// A build directory the test controls: a stand-in executable plus the
    /// marker written the way extraction writes it.
    fn proven_build(name: &str, exe_bytes: &[u8]) -> (PathBuf, PathBuf, String, String) {
        let dir = scratch(name);
        let exe = dir.join(crate::extract::SERVER_NAMES[0]);
        std::fs::write(&exe, exe_bytes).expect("exe");
        let runtime_sha = "0".repeat(64);
        let runtime = [("fake.zip", runtime_sha.as_str())];
        let exe_sha = digest_of(exe_bytes);
        write(&dir, &runtime, &exe_sha).expect("marker");
        (dir, exe, exe_sha, runtime_sha)
    }

    #[test]
    fn a_build_directory_stands_for_what_it_was_built_from() {
        let (dir, exe, exe_sha, runtime_sha) = proven_build("valid", b"a proven build");
        let runtime = [("fake.zip", runtime_sha.as_str())];
        assert_eq!(
            validate(&dir, &runtime, None).as_deref(),
            Some(exe.as_path())
        );
        assert_eq!(
            validate(&dir, &runtime, Some(&exe_sha)).as_deref(),
            Some(exe.as_path()),
            "the table agreeing changes nothing"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_multi_archive_build_validates_whatever_order_each_side_came_in() {
        // Two archives, and the one-asset blind spot: a single archive
        // never sorts, so the normalisation goes untested. Write in table
        // order, validate in table order, then in sorted order — both must
        // pass, or the build re-acquires its archives on every launch.
        let dir = scratch("two-archives");
        let exe = dir.join(crate::extract::SERVER_NAMES[0]);
        std::fs::write(&exe, b"a two-archive build").expect("exe");
        let exe_sha = sha256_file(&exe).expect("hash");
        let engine_sha = "1".repeat(64);
        let second_sha = "2".repeat(64);
        // "engine.zip" leads the table, "aux.zip" leads the sorted order.
        let table_order = [
            ("engine.zip", engine_sha.as_str()),
            ("aux.zip", second_sha.as_str()),
        ];
        write(&dir, &table_order, &exe_sha).expect("marker");
        assert!(
            validate(&dir, &table_order, None).is_some(),
            "a build validates against the marker it just wrote"
        );
        let sorted_order = [
            ("aux.zip", second_sha.as_str()),
            ("engine.zip", engine_sha.as_str()),
        ];
        assert!(
            validate(&dir, &sorted_order, None).is_some(),
            "order is not identity: sorted order is the same set"
        );
        let other_sha = "9".repeat(64);
        let wrong = [
            ("engine.zip", engine_sha.as_str()),
            ("aux.zip", other_sha.as_str()),
        ];
        assert_eq!(validate(&dir, &wrong, None), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_tampered_executable_is_not_the_build_we_proved() {
        let (dir, exe, _, runtime_sha) = proven_build("tampered", b"a proven build");
        // Same length, different bytes: exactly the tamper that used to pass.
        let mut bytes = b"a proven build".to_vec();
        bytes[3] ^= 0xff;
        std::fs::write(&exe, bytes).expect("tamper");
        let runtime = [("fake.zip", runtime_sha.as_str())];
        assert_eq!(
            validate(&dir, &runtime, None),
            None,
            "re-measured, not remembered"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_build_from_another_release_is_not_this_build() {
        let (dir, _, _, _) = proven_build("stale", b"a proven build");
        // The table now describes different archives: the old build is not
        // re-probed and re-blessed as the new one.
        let other = "1".repeat(64);
        let runtime = [("fake.zip", other.as_str())];
        assert_eq!(validate(&dir, &runtime, None), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unmarked_directory_is_not_a_build() {
        let dir = scratch("unmarked");
        std::fs::write(dir.join(crate::extract::SERVER_NAMES[0]), b"who made this?").expect("exe");
        let sha = "0".repeat(64);
        let runtime = [("fake.zip", sha.as_str())];
        assert_eq!(validate(&dir, &runtime, None), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_a_different_digest_contradicts_the_table() {
        let table = "a".repeat(64);
        let runtime_sha = "0".repeat(64);
        let runtime = [("fake.zip", runtime_sha.as_str())];
        // The marker names these archives but records another build's exe.
        let dir = scratch("recorded-other");
        std::fs::write(
            dir.join(crate::extract::SERVER_NAMES[0]),
            b"whatever was here",
        )
        .expect("exe");
        write(&dir, &runtime, &"b".repeat(64)).expect("marker");
        assert!(exe_contradicts_table(&dir, &runtime, &table));
        let _ = std::fs::remove_dir_all(&dir);
        // The marker records the table's exe, but the bytes were flipped.
        let dir = scratch("measured-other");
        std::fs::write(dir.join(crate::extract::SERVER_NAMES[0]), b"a proven build").expect("exe");
        let table = digest_of(b"a proven build");
        write(&dir, &runtime, &table).expect("marker");
        assert!(!exe_contradicts_table(&dir, &runtime, &table));
        let mut bytes = b"a proven build".to_vec();
        bytes[0] ^= 0xff;
        std::fs::write(dir.join(crate::extract::SERVER_NAMES[0]), bytes).expect("tamper");
        assert!(exe_contradicts_table(&dir, &runtime, &table));
        let _ = std::fs::remove_dir_all(&dir);
        // A stale build, an unmarked directory and a missing executable are
        // not contradictions: the re-acquire path replaces them as today.
        let (dir, _, _, _) = proven_build("stale-table", b"a proven build");
        let other = "1".repeat(64);
        let wrong = [("fake.zip", other.as_str())];
        assert!(!exe_contradicts_table(&dir, &wrong, &table));
        let _ = std::fs::remove_dir_all(&dir);
        let dir = scratch("unmarked-table");
        std::fs::write(dir.join(crate::extract::SERVER_NAMES[0]), b"who made this?").expect("exe");
        assert!(!exe_contradicts_table(&dir, &runtime, &table));
        let _ = std::fs::remove_dir_all(&dir);
        let dir = scratch("missing-exe");
        write(&dir, &runtime, &table).expect("marker");
        assert!(!exe_contradicts_table(&dir, &runtime, &table));
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    fn the_table_outranks_a_marker_claiming_another_build() {
        let (dir, _, exe_sha, runtime_sha) = proven_build("outranked", b"a proven build");
        let runtime = [("fake.zip", runtime_sha.as_str())];
        let other = "f".repeat(64);
        assert_eq!(validate(&dir, &runtime, Some(&other)), None);
        assert!(validate(&dir, &runtime, Some(&exe_sha)).is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
