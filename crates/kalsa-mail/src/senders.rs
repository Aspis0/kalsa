//! Who has written to this person before, remembered between calls.
//!
//! Reading the headers of a whole folder on every `list` is what made the unseen-sender
//! rule expensive: on a large mailbox it is a hundred thousand header blocks per tool
//! call. The cache holds the answer per folder and is dropped when the folder's
//! UIDVALIDITY changes, because then the UIDs in it name different messages.

use crate::imap::MailError;
use crate::label::Sender;
use crate::mailbox::Mailbox;
use std::collections::HashMap;

/// One entry per folder. `highest` is the largest UID already read.
#[derive(Default)]
pub struct Senders {
    folders: HashMap<String, Folder>,
}

struct Folder {
    uid_validity: Option<u32>,
    highest: u32,
    known: Vec<Sender>,
}

impl Senders {
    /// Every sender in the folder, read up to `wanted` and extended with whatever
    /// arrived since the last call.
    pub async fn of(&mut self, mailbox: &mut Mailbox) -> Result<&[Sender], MailError> {
        let fresh = Folder {
            uid_validity: mailbox.uid_validity,
            highest: 0,
            known: Vec::new(),
        };
        let folder = self.folders.entry(mailbox.folder.clone()).or_insert(fresh);
        if folder.uid_validity != mailbox.uid_validity {
            *folder = Folder {
                uid_validity: mailbox.uid_validity,
                highest: 0,
                known: Vec::new(),
            };
        }
        if folder.highest == u32::MAX {
            return Ok(&folder.known);
        }

        let mut uids = mailbox.all_uids().await?;
        uids.retain(|uid| *uid > folder.highest);
        let headers = mailbox.headers(&uids).await?;
        for (uid, header) in uids.iter().zip(headers) {
            let (address, _) = crate::mail::sender_of(&header);
            if !address.is_empty() {
                folder.known.push(Sender { address, uid: *uid });
            }
            folder.highest = folder.highest.max(*uid);
        }
        folder.known.sort_by_key(|sender| sender.uid);
        Ok(&folder.known)
    }

    /// Whether the ids handed out by an earlier `list` still name the same messages.
    pub fn agrees_with(&self, folder: &str, uid_validity: Option<u32>) -> bool {
        self.folders
            .get(folder)
            .is_none_or(|known| known.uid_validity == uid_validity)
    }
}
