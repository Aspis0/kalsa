//! The tests that matter here are the ones that try to get OUT.
//!
//! A listing that sorts wrongly is a nuisance. A path that escapes the roots
//! is the page reading `~/.ssh/id_ed25519` because the model asked it to, so
//! the escapes are tested first and by attempt, not by inspection.

use std::fs;
use std::path::{Path, PathBuf};

use crate::entry::Kind;
use crate::listing::{list_dir, recent, MAX_ROWS};
use crate::scope::resolve_within;

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
fn recent_returns_readable_documents_newest_first() {
    let tree = TempTree::new("recent");
    let root = tree.dir("root");
    tree.file("root/old.txt", "old");
    tree.file("root/binary.dmg", "not a document");
    tree.dir("root/a-folder");
    std::thread::sleep(std::time::Duration::from_millis(20));
    tree.file("root/new.md", "new");

    let found = recent(&[root]);
    let names: Vec<&str> = found.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(
        names,
        vec!["new.md", "old.txt"],
        "folders and unreadable kinds are not recent documents"
    );
    assert_eq!(found[0].kind, Kind::Text);
}
