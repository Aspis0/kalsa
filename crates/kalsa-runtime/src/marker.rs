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

/// The executable in `dir`, if `dir` is exactly the build these digests
/// describe. `table_exe`, when the table knows the release's own exe digest,
/// outranks the marker's record: a marker from any other build refuses the
/// directory outright. `None` means "re-acquire", never "close enough".
pub(crate) fn validate(
    dir: &Path,
    runtime: &[(&str, &str)],
    table_exe: Option<&str>,
) -> Option<PathBuf> {
    let marker = std::fs::read_to_string(dir.join(MARKER)).ok()?;
    let mut lines = marker.lines();
    if lines.next()? != MAGIC {
        return None;
    }
    let mut built: Vec<(String, String)> = Vec::new();
    let mut exe_line = None;
    for line in lines {
        match line.split_once('=') {
            Some(("runtime", pair)) => {
                let (file, sha) = pair.split_once(':')?;
                built.push((file.to_string(), sha.to_string()));
            }
            Some(("exe", sha)) => exe_line = Some(sha.to_string()),
            _ => return None,
        }
    }
    built.sort();
    // Order is not identity: the marker records a *set* of (archive, digest)
    // pairs. The table lists the engine first, but `cudart` sorts before
    // `llama`, so both sides are normalised — a build must validate against
    // the marker it just wrote, whatever order each side was handed over in,
    // or a CUDA machine re-acquires 645 MB on every launch.
    let mut expected: Vec<(String, String)> = runtime
        .iter()
        .map(|(file, sha)| ((*file).to_string(), (*sha).to_string()))
        .collect();
    expected.sort();
    if built != expected {
        return None;
    }
    let exe_line = exe_line?;
    // The table outranks the marker: a marker claiming another build's exe
    // is a marker from another build.
    if let Some(table) = table_exe {
        if !exe_line.eq_ignore_ascii_case(table) {
            return None;
        }
    }
    let exe = extract::find_server(dir)?;
    // Re-measured, never remembered: the bytes that are here now must still
    // be the bytes the build was proven with.
    if !sha256_file(&exe).ok()?.eq_ignore_ascii_case(&exe_line) {
        return None;
    }
    Some(exe)
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
        let exe = dir.join("llama-server");
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
        // CUDA's shape, and the one-asset blind spot that hid an order
        // comparison: the table lists the engine first, but `cudart` sorts
        // before `llama`. Write in table order, validate in table order,
        // then in sorted order — both must pass, or a CUDA machine
        // re-acquires 645 MB on every launch.
        let dir = scratch("two-archives");
        let exe = dir.join("llama-server");
        std::fs::write(&exe, b"a two-archive build").expect("exe");
        let exe_sha = sha256_file(&exe).expect("hash");
        let engine_sha = "1".repeat(64);
        let cudart_sha = "2".repeat(64);
        let table_order = [
            (
                "llama-b10950-bin-win-cuda-12.4-x64.zip",
                engine_sha.as_str(),
            ),
            (
                "cudart-llama-bin-win-cuda-12.4-x64.zip",
                cudart_sha.as_str(),
            ),
        ];
        write(&dir, &table_order, &exe_sha).expect("marker");
        assert!(
            validate(&dir, &table_order, None).is_some(),
            "a build validates against the marker it just wrote"
        );
        let sorted_order = [
            (
                "cudart-llama-bin-win-cuda-12.4-x64.zip",
                cudart_sha.as_str(),
            ),
            (
                "llama-b10950-bin-win-cuda-12.4-x64.zip",
                engine_sha.as_str(),
            ),
        ];
        assert!(
            validate(&dir, &sorted_order, None).is_some(),
            "order is not identity: sorted order is the same set"
        );
        let other_sha = "9".repeat(64);
        let wrong = [
            (
                "llama-b10950-bin-win-cuda-12.4-x64.zip",
                engine_sha.as_str(),
            ),
            ("cudart-llama-bin-win-cuda-12.4-x64.zip", other_sha.as_str()),
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
        std::fs::write(dir.join("llama-server"), b"who made this?").expect("exe");
        let sha = "0".repeat(64);
        let runtime = [("fake.zip", sha.as_str())];
        assert_eq!(validate(&dir, &runtime, None), None);
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
