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
    /// The UIDNEXT the last full read saw. Equal to the mailbox's again, nothing arrived.
    next: Option<u32>,
    known: Vec<Sender>,
}

impl Senders {
    /// Every sender in the folder, read up to `wanted` and extended with whatever
    /// arrived since the last call.
    pub async fn of(&mut self, mailbox: &mut Mailbox) -> Result<&[Sender], MailError> {
        let fresh = Folder {
            uid_validity: mailbox.uid_validity,
            highest: 0,
            next: None,
            known: Vec::new(),
        };
        let folder = self.folders.entry(mailbox.folder.clone()).or_insert(fresh);
        if folder.uid_validity != mailbox.uid_validity {
            *folder = Folder {
                uid_validity: mailbox.uid_validity,
                highest: 0,
                next: None,
                known: Vec::new(),
            };
        }
        if folder.highest == u32::MAX {
            return Ok(&folder.known);
        }
        if mailbox.uid_next.is_some() && folder.next == mailbox.uid_next {
            return Ok(&folder.known);
        }

        let mut uids = mailbox.all_uids().await?;
        uids.retain(|uid| *uid > folder.highest);
        let mut headers: HashMap<u32, Vec<u8>> = mailbox.headers(&uids).await?.into_iter().collect();
        mailbox.confirm().await?;
        let mut complete = true;
        for uid in uids {
            // A UID the server left out ends the read: the mails after it are read again next time.
            let Some(header) = headers.remove(&uid) else {
                complete = false;
                break;
            };
            let (address, _) = crate::mail::sender_of(&header);
            if !address.is_empty() {
                folder.known.push(Sender { address, uid });
            }
            folder.highest = uid;
        }
        folder.known.sort_by_key(|sender| sender.uid);
        folder.next = if complete { mailbox.uid_next } else { None };
        Ok(&folder.known)
    }

    /// Whether the ids handed out by an earlier `list` still name the same messages.
    pub fn agrees_with(&self, folder: &str, uid_validity: Option<u32>) -> bool {
        self.folders
            .get(folder)
            .is_none_or(|known| known.uid_validity == uid_validity)
    }
}

#[cfg(test)]
#[path = "../tests/fake_imap/mod.rs"]
mod fake_imap;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::account;
    use crate::imap;
    use fake_imap::uid::Answers;
    use fake_imap::Login;

    /// One read of the folder from a fresh fake that answers with `answers`.
    async fn read_with(senders: &mut Senders, answers: Answers) -> Vec<Sender> {
        let line = fake_imap::serve(Login::Accept, answers).await;
        let account = account::read(line.as_bytes()).expect("the test line is well formed");
        let session = imap::connect(&account).await.expect("the fake accepts LOGIN");
        let mut mailbox = Mailbox::examine(session, "INBOX").await.expect("INBOX opens");
        senders.of(&mut mailbox).await.expect("the read answers").to_vec()
    }

    #[tokio::test]
    async fn a_header_the_server_leaves_out_is_not_paired_with_another_uid_and_the_next_read_rereads() {
        let mut senders = Senders::default();
        let partial = read_with(&mut senders, Answers::HeaderOmitsLowest).await;
        assert!(partial.is_empty(), "{partial:?}");

        let full = read_with(&mut senders, Answers::Exact).await;
        let uids: Vec<u32> = full.iter().map(|sender| sender.uid).collect();
        assert_eq!(uids, vec![105, 115]);
        assert!(full[0].address.contains("giulia"), "{full:?}");
        assert!(full[1].address.contains("banca"), "{full:?}");
    }
}
