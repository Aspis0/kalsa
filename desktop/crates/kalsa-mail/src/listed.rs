//! The messages this session has listed, per folder. A `read` or a `draft` names a
//! message only if a `list` of this session returned it, so an id guessed from the
//! UID range is refused before its body is fetched.

use std::collections::{HashMap, HashSet};

/// A folder's record starts over before it would grow past this.
const CAP: usize = 2_000;

#[derive(Default)]
pub struct Listed {
    folders: HashMap<String, Folder>,
}

#[derive(Default)]
struct Folder {
    uid_validity: Option<u32>,
    uids: HashSet<u32>,
}

impl Listed {
    /// Records the ids a `list` returned. A folder whose UIDVALIDITY changed starts over,
    /// because its UIDs now name other messages.
    pub fn remember(&mut self, folder: &str, uid_validity: Option<u32>, uids: &[u32]) {
        let entry = self.folders.entry(folder.to_owned()).or_default();
        if entry.uid_validity != uid_validity || entry.uids.len() + uids.len() > CAP {
            *entry = Folder { uid_validity, uids: HashSet::new() };
        }
        entry.uids.extend(uids.iter().copied());
    }

    pub fn contains(&self, folder: &str, uid_validity: Option<u32>, uid: u32) -> bool {
        self.folders
            .get(folder)
            .is_some_and(|known| known.uid_validity == uid_validity && known.uids.contains(&uid))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_uid_that_was_never_listed_is_not_contained() {
        let mut listed = Listed::default();
        assert!(!listed.contains("INBOX", Some(7), 1));
        listed.remember("INBOX", Some(7), &[10, 11]);
        assert!(!listed.contains("INBOX", Some(7), 12));
        assert!(!listed.contains("Sent", Some(7), 10));
    }

    #[test]
    fn a_listed_uid_is_contained_while_the_folder_keeps_its_validity() {
        let mut listed = Listed::default();
        listed.remember("INBOX", Some(7), &[10]);
        listed.remember("INBOX", Some(7), &[11]);
        assert!(listed.contains("INBOX", Some(7), 10));
        assert!(listed.contains("INBOX", Some(7), 11));
    }

    #[test]
    fn a_rebuilt_folder_forgets_the_ids_it_handed_out() {
        let mut listed = Listed::default();
        listed.remember("INBOX", Some(7), &[10]);
        assert!(!listed.contains("INBOX", Some(8), 10));
        listed.remember("INBOX", Some(8), &[20]);
        assert!(!listed.contains("INBOX", Some(7), 10));
        assert!(listed.contains("INBOX", Some(8), 20));
    }

    #[test]
    fn a_full_record_starts_over_before_it_grows_without_bound() {
        let mut listed = Listed::default();
        let first: Vec<u32> = (1..=CAP as u32).collect();
        listed.remember("INBOX", None, &first);
        listed.remember("INBOX", None, &[u32::MAX]);
        assert!(listed.contains("INBOX", None, u32::MAX));
        assert!(!listed.contains("INBOX", None, 1));
    }
}
