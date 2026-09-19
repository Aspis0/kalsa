//! The tests that matter here are the ones a whole-disk browser must not
//! get wrong: a path that does not exist is refused rather than silently
//! listed, what the disk holds is what the rows show — dotfiles and links
//! included — and a folder too big for one page admits it.

use std::fs;
use std::path::{Path, PathBuf};

use crate::entry::Kind;
use crate::listing::{list_dir, MAX_ROWS};
use crate::scope::{home_dir_from, resolve, roots, roots_from, ScopeError};

/// A directory that deletes itself, so a failing assert cannot leave litter
/// in the temp folder of the machine that ran it.
pub(crate) struct TempTree(PathBuf);

impl TempTree {
    pub(crate) fn new(tag: &str) -> Self {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "kalsa-files-{tag}-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&path).expect("temp tree");
        Self(path)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }

    pub(crate) fn file(&self, name: &str, contents: &str) -> PathBuf {
        let path = self.0.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent");
        }
        fs::write(&path, contents).expect("write");
        path
    }

    pub(crate) fn dir(&self, name: &str) -> PathBuf {
        let path = self.0.join(name);
        fs::create_dir_all(&path).expect("dir");
        path
    }
}

impl Drop for TempTree {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn a_path_that_does_not_exist_is_refused() {
    let tree = TempTree::new("ghost");
    let ghost = tree.path().join("never-was.txt");

    let error = resolve(&ghost).expect_err("nothing is behind the path");
    assert_eq!(
        error.to_string(),
        "no such file",
        "a missing path is a typo the page can fix, and the error says so"
    );
}

#[test]
fn a_file_resolves_to_its_canonical_path() {
    let tree = TempTree::new("inside");
    let file = tree.file("notes.txt", "hello");

    let resolved = resolve(&file).expect("the file exists");
    assert_eq!(
        resolved,
        file.canonicalize().expect("canonical"),
        "callers must open the path the check approved, not the one they sent"
    );
}

#[test]
fn dot_dot_resolves_to_where_it_really_points() {
    // `..` is never stripped by hand: the operating system resolves it,
    // and the canonical answer is where it actually goes. There is no
    // boundary to climb out of any more, but the resolution must still be
    // the OS's, or canonical and real would drift apart.
    let tree = TempTree::new("climb");
    let root = tree.dir("root");
    let secret = tree.file("secret.txt", "not yours");

    let climbed = root.join("..").join("secret.txt");
    let resolved = resolve(&climbed).expect("the target exists");
    assert_eq!(resolved, secret.canonicalize().expect("canonical"));
}

#[cfg(unix)]
#[test]
fn a_symlink_resolves_to_its_target() {
    let tree = TempTree::new("link-resolve");
    let target = tree.file("target.txt", "real bytes");
    let link = tree.path().join("alias.txt");
    std::os::unix::fs::symlink(&target, &link).expect("symlink");

    let resolved = resolve(&link).expect("the link lands somewhere real");
    assert_eq!(resolved, target.canonicalize().expect("canonical"));
}

#[test]
fn the_error_names_the_cause_and_debug_agrees() {
    // The page can list any directory, so the cause is no oracle — it is
    // the difference between a typo and the OS saying no.
    let not_found = ScopeError::Unresolvable(std::io::Error::from(std::io::ErrorKind::NotFound));
    assert_eq!(not_found.to_string(), "no such file");
    let denied =
        ScopeError::Unresolvable(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
    assert_eq!(
        denied.to_string(),
        "the operating system refused to follow this path"
    );
    let other = ScopeError::Unresolvable(std::io::Error::other("disk said something odd"));
    assert_eq!(
        other.to_string(),
        "the path could not be followed on this disk"
    );

    // Debug is what logs and unwrap() print; it must tell the same story.
    for error in [not_found, denied, other] {
        assert_eq!(format!("{error:?}"), format!("{error}"));
    }
}

#[cfg(unix)]
#[test]
fn roots_on_this_machine_start_at_the_filesystem_root() {
    assert_eq!(
        roots(),
        vec![PathBuf::from("/")],
        "on unix there is exactly one root, and a browser starts there"
    );
}

#[test]
fn windows_roots_are_the_drive_letters_that_exist() {
    // The shape is pinned with an injected predicate, so it runs on a
    // machine with no drives at all: letters in order, each ROOTED — a
    // bare `C:` is drive-relative and would read that drive's current
    // directory.
    let drives = roots_from(|letter| letter == 'C' || letter == 'Z');
    assert_eq!(
        drives,
        vec![PathBuf::from("C:\\"), PathBuf::from("Z:\\")],
        "existing drives in letter order, each with its separator"
    );
    assert!(roots_from(|_| false).is_empty(), "no drives, no roots");
}

#[test]
fn dotfiles_are_listed() {
    let tree = TempTree::new("dotfiles");
    let root = tree.dir("root");
    tree.file("root/.env", "SECRET=1");
    tree.file("root/notes.txt", "hello");
    let listing = list_dir(&root).expect("listing");

    let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(
        names,
        vec![".env", "notes.txt"],
        "the whole disk is the scope: the list shows what search can find, dotfiles included"
    );
}

#[cfg(unix)]
#[test]
fn a_symlink_is_listed_as_what_it_points_at() {
    let tree = TempTree::new("link-listing");
    let root = tree.dir("root");
    tree.file("plain.txt", "mine");
    let target_file = tree.file("elsewhere.txt", "real bytes");
    let target_dir = tree.dir("folder");
    std::os::unix::fs::symlink(&target_file, root.join("link-file.txt")).expect("symlink");
    std::os::unix::fs::symlink(&target_dir, root.join("link-dir")).expect("symlink");
    // And a link to nowhere, which a browser must still show: the user can
    // see it in Finder, so the list cannot pretend it is not there.
    std::os::unix::fs::symlink(tree.path().join("gone.txt"), root.join("link-broken.txt"))
        .expect("symlink");

    let listing = list_dir(&root).expect("listing");
    let row = |name: &str| {
        listing
            .entries
            .iter()
            .find(|e| e.name == name)
            .unwrap_or_else(|| panic!("{name} must be listed"))
    };
    assert!(
        row("link-dir").is_dir,
        "a link to a folder is a folder: clicking it goes there"
    );
    assert!(
        !row("link-file.txt").is_dir,
        "a link to a file is a file"
    );
    assert!(
        !row("link-broken.txt").is_dir,
        "a link to nowhere is shown as a plain row, not dropped"
    );
}

#[test]
fn a_huge_folder_says_it_was_truncated() {
    let tree = TempTree::new("huge");
    let root = tree.dir("root");
    for index in 0..(MAX_ROWS + 10) {
        tree.file(&format!("root/file-{index:04}.txt"), "x");
    }

    let listing = list_dir(&root).expect("listing");
    assert_eq!(listing.entries.len(), MAX_ROWS);
    assert!(
        listing.truncated,
        "showing the first 500 of 510 without saying so is a lie about the disk"
    );
}

#[test]
fn a_folder_at_the_limit_is_not_truncated() {
    let tree = TempTree::new("exact");
    let root = tree.dir("root");
    for index in 0..MAX_ROWS {
        tree.file(&format!("root/file-{index:04}.txt"), "x");
    }

    let listing = list_dir(&root).expect("listing");
    assert_eq!(listing.entries.len(), MAX_ROWS);
    assert!(
        !listing.truncated,
        "exactly MAX_ROWS is the whole folder — calling it truncated is the other lie"
    );
}

#[test]
fn a_folder_that_does_not_exist_is_an_error_not_an_empty_list() {
    let tree = TempTree::new("missing");
    let ghost = tree.path().join("never-was");
    assert!(
        list_dir(&ghost).is_err(),
        "an empty list would read as an empty folder, which the disk never said"
    );
}

#[test]
fn home_dir_takes_the_platforms_own_variable_first() {
    // A fn item, not a closure: it is passed to the lookup twice.
    fn both_vars(name: &str) -> Option<std::ffi::OsString> {
        match name {
            "HOME" => Some(std::ffi::OsString::from("/git-bash/guess")),
            "USERPROFILE" => Some(std::ffi::OsString::from("C:\\Users\\marco")),
            _ => None,
        }
    }
    // The platform is data now, so BOTH orders are pinned on every machine.
    assert_eq!(
        home_dir_from(both_vars, ("USERPROFILE", "HOME")),
        Some(PathBuf::from("C:\\Users\\marco")),
        "the Windows order: the unix-y HOME guess loses"
    );
    assert_eq!(
        home_dir_from(both_vars, ("HOME", "USERPROFILE")),
        Some(PathBuf::from("/git-bash/guess")),
        "the unix order"
    );
}

#[test]
fn an_empty_home_variable_is_not_a_home() {
    let home_empty = |name: &str| match name {
        "HOME" => Some(std::ffi::OsString::new()),
        "USERPROFILE" => Some(std::ffi::OsString::from("C:\\Users\\from-profile")),
        _ => None,
    };
    assert_eq!(
        home_dir_from(home_empty, ("HOME", "USERPROFILE")),
        Some(PathBuf::from("C:\\Users\\from-profile")),
        "an empty own variable is skipped, not taken as a folder name"
    );

    let profile_empty = |name: &str| match name {
        "HOME" => Some(std::ffi::OsString::from("C:\\Users\\from-home")),
        "USERPROFILE" => Some(std::ffi::OsString::new()),
        _ => None,
    };
    assert_eq!(
        home_dir_from(profile_empty, ("USERPROFILE", "HOME")),
        Some(PathBuf::from("C:\\Users\\from-home"))
    );
}

#[test]
fn the_drive_survives_the_homedrive_homepath_fallback() {
    let get = |name: &str| match name {
        "HOMEDRIVE" => Some(std::ffi::OsString::from("C:")),
        "HOMEPATH" => Some(std::ffi::OsString::from("/home/marco")),
        _ => None,
    };
    assert_eq!(
        home_dir_from(get, ("HOME", "USERPROFILE")),
        Some(PathBuf::from("C:/home/marco")),
        "pushing a rooted HOMEPATH would discard the drive"
    );
}

#[test]
fn an_unrooted_homepath_gets_the_separator_inserted() {
    let get = |name: &str| match name {
        "HOMEDRIVE" => Some(std::ffi::OsString::from("C:")),
        "HOMEPATH" => Some(std::ffi::OsString::from("Users\\marco")),
        _ => None,
    };
    // No leading separator in HOMEPATH: the drive and the path would run
    // together as `C:Users\...` without the platform's own one inserted.
    let want = format!("C:{}Users\\marco", std::path::MAIN_SEPARATOR);
    assert_eq!(
        home_dir_from(get, ("HOME", "USERPROFILE")),
        Some(PathBuf::from(want))
    );
}

#[test]
fn a_windows_shaped_path_behaves_where_it_cannot_exist() {
    // Backslashes and a drive letter are data, never separators to split
    // on by hand: on macOS the shape is one odd component that no file
    // answers to, and the failure is the ordinary honest one.
    let windows_shaped = Path::new("C:\\Users\\marco\\NOTES.PDF");
    assert!(
        resolve(windows_shaped).is_err(),
        "nothing answers to that shape on this machine, and nothing panics"
    );
    // The label side of the same shape: extension case and backslashes do
    // not change the kind.
    assert_eq!(
        Kind::of(Path::new("C:\\Users\\marco\\notes.TXT")),
        Kind::Text,
        "the extension reads through backslashes, case-insensitively"
    );
    assert_eq!(Kind::of(Path::new("C:\\USERS\\X\\A.PDF")), Kind::Pdf);
    // And a POSIX shape labels the same way.
    assert_eq!(Kind::of(Path::new("/etc/hosts.json")), Kind::Text);
}
