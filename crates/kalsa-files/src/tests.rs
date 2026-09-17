//! The tests that matter here are the ones that try to get OUT.
//!
//! A listing that sorts wrongly is a nuisance. A path that escapes the roots
//! is the page reading `~/.ssh/id_ed25519` because the model asked it to, so
//! the escapes are tested first and by attempt, not by inspection.

use std::fs;
use std::path::{Path, PathBuf};

use crate::entry::{Entry, Kind};
use crate::listing::{list_dir, recent, MAX_ROWS};
use crate::scope::{home_dir, home_dir_from, resolve_within, roots, roots_under, ScopeError};

/// A directory that deletes itself, so a failing assert cannot leave litter
/// in the temp folder of the machine that ran it.
struct TempTree(PathBuf);

impl TempTree {
    fn new(tag: &str) -> Self {
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

    fn path(&self) -> &Path {
        &self.0
    }

    fn file(&self, name: &str, contents: &str) -> PathBuf {
        let path = self.0.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent");
        }
        fs::write(&path, contents).expect("write");
        path
    }

    fn dir(&self, name: &str) -> PathBuf {
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
fn a_path_outside_the_roots_is_refused() {
    let tree = TempTree::new("outside");
    let root = tree.dir("root");
    let elsewhere = tree.dir("elsewhere");
    let roots = vec![root];

    assert!(
        resolve_within(&elsewhere, &roots).is_err(),
        "a sibling directory is not inside the root"
    );
}

#[test]
fn dot_dot_cannot_climb_out_of_a_root() {
    let tree = TempTree::new("climb");
    let root = tree.dir("root");
    tree.file("secret.txt", "not yours");
    let roots = vec![root.clone()];

    let climbed = root.join("..").join("secret.txt");
    assert!(
        resolve_within(&climbed, &roots).is_err(),
        "`..` must be resolved by the OS and then refused, not stripped"
    );

    let honest = root.join("mine.txt");
    fs::write(&honest, "mine").expect("write");
    assert!(
        resolve_within(&honest, &roots).is_ok(),
        "the boundary must refuse the climb, not the folder"
    );
}

#[cfg(unix)]
#[test]
fn a_symlink_out_of_a_root_is_refused() {
    let tree = TempTree::new("symlink");
    let root = tree.dir("root");
    let outside = tree.file("outside.txt", "not yours");
    let link = root.join("innocent.txt");
    std::os::unix::fs::symlink(&outside, &link).expect("symlink");
    let roots = vec![root];

    // The link LIVES inside the root; its target does not. Canonicalizing
    // before the comparison is the only reason this is refused.
    assert!(
        resolve_within(&link, &roots).is_err(),
        "a link inside the root pointing out of it must not open the door"
    );

    // And the other half, without which this test proves nothing: a real
    // file in the same root is still accepted. Refusing everything would
    // otherwise satisfy the assert above — which is how a check ends up
    // with a contract against itself.
    let honest = roots[0].join("real.txt");
    fs::write(&honest, "mine").expect("write");
    assert!(
        resolve_within(&honest, &roots).is_ok(),
        "the boundary must refuse the escape, not the folder"
    );
}

#[test]
fn a_string_prefix_is_not_a_path_prefix() {
    let tree = TempTree::new("prefix");
    let root = tree.dir("docs");
    let sibling = tree.dir("docs-private");
    let file = sibling.join("secret.txt");
    fs::write(&file, "not yours").expect("write");
    let roots = vec![root];

    assert!(
        resolve_within(&file, &roots).is_err(),
        "`docs` is a text prefix of `docs-private` and a path prefix of nothing"
    );
}

#[test]
fn a_file_inside_a_root_resolves_to_its_canonical_path() {
    let tree = TempTree::new("inside");
    let root = tree.dir("root");
    let file = tree.file("root/notes.txt", "hello");
    let roots = vec![root];

    let resolved = resolve_within(&file, &roots).expect("inside the root");
    assert_eq!(
        resolved,
        file.canonicalize().expect("canonical"),
        "callers must open the path the check approved, not the one they sent"
    );
}

#[cfg(unix)]
#[test]
fn a_symlink_is_not_listed_as_a_document() {
    let tree = TempTree::new("link-listing");
    let root = tree.dir("root");
    let outside = tree.file("outside.txt", "not yours");
    std::os::unix::fs::symlink(&outside, root.join("notes.txt")).expect("symlink");
    tree.file("root/real.txt", "mine");
    let roots = vec![root.clone()];

    // A text-named link to `~/.ssh/id_ed25519` must not become an approved
    // row: the listing describes files, and a link describes another place.
    let listing = list_dir(&root, &roots).expect("listing");
    let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, vec!["real.txt"], "a link is not a file in this folder");

    // The recency shelf builds its rows through the same helper; pin that
    // too, so the two listings cannot drift apart on this rule.
    let shelf = recent(&roots);
    let shelf_names: Vec<&str> = shelf.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(
        shelf_names,
        vec!["real.txt"],
        "a link is not a recent document either"
    );
}

#[test]
fn scope_error_debug_is_silent_about_the_cause() {
    // PermissionDenied is the worst case for a probing oracle: it says the
    // path EXISTS. Neither formatting route may repeat it.
    let denied =
        ScopeError::Unresolvable(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
    assert_eq!(
        format!("{denied:?}"),
        format!("{denied}"),
        "Debug and Display must tell the same story"
    );
    let said = format!("{denied:?}").to_lowercase();
    assert!(
        !said.contains("denied"),
        "the cause must not surface through Debug: got {denied:?}"
    );

    let outside = ScopeError::OutsideRoots;
    assert_eq!(format!("{outside:?}"), format!("{outside}"));
}

#[test]
fn roots_under_never_lists_the_home_directory_itself() {
    let tree = TempTree::new("roots");
    let home = tree.dir("home");
    tree.dir("home/Desktop");
    tree.dir("home/Documents");
    tree.dir("home/Downloads");
    tree.dir("home/.ssh"); // present, and never a root

    let real_home = home.canonicalize().expect("temp home exists");
    assert_eq!(
        roots_under(Some(&home)),
        vec![
            real_home.join("Desktop"),
            real_home.join("Documents"),
            real_home.join("Downloads"),
        ],
        "exactly the three document folders, in canonical form — the home directory itself holds .ssh and every token on the machine"
    );
}

#[test]
fn a_home_without_document_folders_gives_no_roots() {
    let tree = TempTree::new("bare");
    let home = tree.dir("home");
    assert!(
        roots_under(Some(&home)).is_empty(),
        "missing folders are absent, not an error"
    );
}

#[test]
fn a_home_that_cannot_be_found_gives_no_roots() {
    assert!(
        roots_under(None).is_empty(),
        "no home means no door at all — not the whole disk"
    );
}

#[cfg(unix)]
#[test]
fn a_symlinked_root_that_contains_home_is_refused() {
    let tree = TempTree::new("ancestor-root");
    let home = tree.dir("home");
    tree.dir("home/Desktop");
    // The catastrophic shape: `Documents -> /`. The canonical root then
    // contains the home, `starts_with` approves everything, and the
    // boundary says nothing at all.
    std::os::unix::fs::symlink("/", home.join("Documents")).expect("symlink");
    // The subtler shape: `Downloads -> <the folder that holds the home>` —
    // an ancestor without being the filesystem root, which a special case
    // for `/` alone would wave straight through.
    std::os::unix::fs::symlink(tree.path(), home.join("Downloads")).expect("symlink");

    let real_home = home.canonicalize().expect("temp home exists");
    let roots = roots_under(Some(&home));

    // Refusing the ancestors must not refuse the folder: the ordinary,
    // real root is still there, in the canonical form that gets returned.
    assert_eq!(
        roots,
        vec![real_home.join("Desktop")],
        "both ancestors refused, the real folder kept — got {roots:?}"
    );

    // End to end: with the links present, a file beside the home is still
    // refused by the actual boundary check.
    let outside = tree.file("secret.txt", "not yours");
    assert!(
        resolve_within(&outside, &roots).is_err(),
        "the boundary must hold with the hostile links in place"
    );
}

#[cfg(unix)]
#[test]
fn a_root_on_another_disk_is_still_accepted() {
    let tree = TempTree::new("external-root");
    let home = tree.dir("home");
    tree.dir("home/Desktop");
    // The legitimate shape: documents on another disk, linked in. The link
    // does not contain the home, so the boundary stays meaningful and the
    // root is real.
    let vault = tree.dir("vault");
    tree.file("vault/thesis.md", "real documents");
    std::os::unix::fs::symlink(&vault, home.join("Documents")).expect("symlink");
    let roots = roots_under(Some(&home));

    assert_eq!(
        roots,
        vec![
            home.canonicalize().expect("temp home exists").join("Desktop"),
            vault.canonicalize().expect("vault exists"),
        ],
        "the external-disk root is listed by its canonical target, alongside the real folders"
    );
    let inside = vault.join("thesis.md");
    assert!(
        resolve_within(&inside, &roots).is_ok(),
        "a document behind the link is readable through the front door"
    );
    let outside = tree.file("secret.txt", "not yours");
    assert!(
        resolve_within(&outside, &roots).is_err(),
        "and the door does not get wider than the roots"
    );
}

#[cfg(unix)]
#[test]
fn a_vetted_root_survives_the_name_being_repointed() {
    // The window that motivated canonical roots: the list is built while
    // `Documents` points at the vault, the list holds the TARGET's path,
    // and re-pointing the name afterwards cannot re-aim it. What remains
    // open — swapping what lives at the target path itself — is the
    // open-handle problem, on the record as unsolved.
    let tree = TempTree::new("repoint");
    let home = tree.dir("home");
    tree.dir("home/Desktop");
    let vault = tree.dir("vault");
    tree.file("vault/thesis.md", "real documents");
    std::os::unix::fs::symlink(&vault, home.join("Documents")).expect("symlink");
    let roots = roots_under(Some(&home));
    assert!(
        roots.contains(&vault.canonicalize().expect("vault exists")),
        "the linked-in root is vetted as its target — got {roots:?}"
    );

    // Re-point the name at home's ancestor, as the attack would.
    fs::remove_file(home.join("Documents")).expect("remove link");
    std::os::unix::fs::symlink(tree.path(), home.join("Documents")).expect("re-point");

    let outside = tree.file("secret.txt", "not yours");
    assert!(
        resolve_within(&outside, &roots).is_err(),
        "the list holds the vetted target path, not the name that was re-pointed"
    );
    let still_inside = vault.join("thesis.md");
    assert!(
        resolve_within(&still_inside, &roots).is_ok(),
        "the original target stays reachable through the front door"
    );
}

#[test]
fn roots_on_this_machine_are_never_home_itself() {
    // On a real machine the three document names point at ordinary folders,
    // so nothing here can see what the containment filter does — a filter
    // mutation is invisible to this loop, by nature of the fixture. The
    // boundary is pinned where the hostility is reproducible:
    // `a_symlinked_root_that_contains_home_is_refused` and
    // `a_root_on_another_disk_is_still_accepted`. What this test does pin
    // on every machine, with or without a home, is the seam: roots() and
    // its pure half agree, and no root equals the home itself — equal
    // being the degenerate case of containing it, which the filter refuses.
    let home = home_dir();
    for root in roots_under(home.as_deref()) {
        let real_home = home.as_deref().expect("roots came back, so there is a home");
        assert_ne!(
            root, real_home,
            "the picker must never look at the home directory itself"
        );
    }
    // The published entry point must agree with its seam on this machine.
    assert_eq!(roots(), roots_under(home.as_deref()), "roots() is its seam");
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
fn dotfiles_are_not_listed() {
    let tree = TempTree::new("dotfiles");
    let root = tree.dir("root");
    tree.file("root/.env", "SECRET=1");
    tree.file("root/notes.txt", "hello");
    let roots = vec![root.clone()];

    let listing = list_dir(&root, &roots).expect("listing");
    let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, vec!["notes.txt"], "dotfiles are the machine's business");
}

#[test]
fn a_huge_folder_says_it_was_truncated() {
    let tree = TempTree::new("huge");
    let root = tree.dir("root");
    for index in 0..(MAX_ROWS + 10) {
        tree.file(&format!("root/file-{index:04}.txt"), "x");
    }
    let roots = vec![root.clone()];

    let listing = list_dir(&root, &roots).expect("listing");
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
    let roots = vec![root.clone()];

    let listing = list_dir(&root, &roots).expect("listing");
    assert_eq!(listing.entries.len(), MAX_ROWS);
    assert!(
        !listing.truncated,
        "exactly MAX_ROWS is the whole folder — calling it truncated is the other lie"
    );
}

#[test]
fn an_entry_without_mtime_sorts_last_not_first() {
    // No filesystem here refuses to keep an mtime, so the promise in the
    // `modified_ms` doc — absent sorts LAST — is pinned where it lives,
    // in the comparator, with hand-built rows.
    let row = |name: &str, modified_ms: Option<u64>| Entry {
        name: name.to_owned(),
        path: format!("/nowhere/{name}"),
        is_dir: false,
        kind: Kind::Text,
        bytes: 0,
        modified_ms,
    };
    let timeless = row("unknown-age.txt", None);
    let older = row("a-older.txt", Some(1));
    let newer = row("z-newer.md", Some(2));

    let mut rows = [older, timeless, newer];
    rows.sort_by(Entry::newest_first);
    let names: Vec<&str> = rows.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(
        names,
        ["z-newer.md", "a-older.txt", "unknown-age.txt"],
        "a file whose age the disk would not say is the oldest thing on the shelf"
    );
}

#[test]
fn recent_returns_readable_documents_newest_first() {
    let tree = TempTree::new("recent");
    let root = tree.dir("root");
    // Name order and mtime order must disagree here: the alphabetically
    // earlier name is the OLDER file, so only a real mtime sort produces
    // this answer — the name tiebreak alone would reverse it.
    tree.file("root/aaa-written-first.txt", "older by mtime");
    tree.file("root/binary.dmg", "not a document");
    tree.dir("root/a-folder");
    std::thread::sleep(std::time::Duration::from_millis(20));
    tree.file("root/zzz-written-last.md", "newer by mtime");

    let found = recent(&[root]);
    let names: Vec<&str> = found.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(
        names,
        vec!["zzz-written-last.md", "aaa-written-first.txt"],
        "newest first, by mtime — not by name; folders and unreadable kinds are not recent documents"
    );
    assert_eq!(found[0].kind, Kind::Text);
}
