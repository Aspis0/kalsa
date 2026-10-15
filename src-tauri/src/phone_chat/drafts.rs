//! The reply drafts the page made for a phone. The app keeps the draft and the
//! phone holds only its id: a send names that id and nothing else, so the
//! recipient is the one the stored mail names, never one the phone typed.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use kalsa_door::DeviceId;

/// How long a draft waits for the phone's confirm. Longer than that and the
/// person starts the reply again.
const LIFE: Duration = Duration::from_secs(30 * 60);

/// Drafts one phone may hold at once. A phone that runs turns back to back
/// would otherwise fill the table for the whole half hour.
const PER_OWNER: usize = 16;

/// The phone that made a draft: its id, and a digest of its credential. Ids are
/// reused once the top one is forgotten, so the id alone cannot tell the old
/// phone from the next one paired under it.
pub(super) type Owner = (DeviceId, [u8; 32]);

pub(super) struct Draft {
    owner: Owner,
    reply_to_id: u32,
    subject: String,
    body: String,
    created: Instant,
    /// A send of this draft is in flight. A second one is `busy` until the
    /// first ends; a failed one clears it so the person can retry.
    sending: bool,
}

/// What a send needs from its draft, and nothing the phone supplied except
/// the body it may have edited.
pub(super) struct Ticket {
    pub(super) reply_to_id: u32,
    pub(super) subject: String,
    pub(super) body: String,
}

#[derive(Default)]
pub(super) struct Drafts {
    entries: HashMap<String, Draft>,
}

impl Drafts {
    pub(super) fn insert(
        &mut self,
        id: String,
        owner: Owner,
        reply_to_id: u32,
        subject: String,
        body: String,
        now: Instant,
    ) {
        self.prune(now);
        let held: Vec<(String, Instant)> = self
            .entries
            .iter()
            .filter(|(_, draft)| draft.owner == owner)
            .map(|(id, draft)| (id.clone(), draft.created))
            .collect();
        if held.len() >= PER_OWNER {
            if let Some((oldest, _)) = held.iter().min_by_key(|(_, created)| *created) {
                self.entries.remove(oldest);
            }
        }
        let draft = Draft {
            owner,
            reply_to_id,
            subject,
            body,
            created: now,
            sending: false,
        };
        self.entries.insert(id, draft);
    }

    /// Starts the send of a draft `owner` made. The edited body wins only when
    /// it is not blank; otherwise the stored body goes.
    pub(super) fn begin(
        &mut self,
        owner: Owner,
        id: &str,
        edited: Option<String>,
        now: Instant,
    ) -> Result<Ticket, &'static str> {
        self.prune(now);
        let draft = self
            .entries
            .get_mut(id)
            .filter(|draft| draft.owner == owner)
            .ok_or("draft_unknown")?;
        if draft.sending {
            return Err("busy");
        }
        draft.sending = true;
        let body = edited
            .filter(|text| !text.trim().is_empty())
            .unwrap_or_else(|| draft.body.clone());
        Ok(Ticket {
            reply_to_id: draft.reply_to_id,
            subject: draft.subject.clone(),
            body,
        })
    }

    /// Ends the send `begin` started. A sent draft is spent; a failed one
    /// waits for the person to try again.
    pub(super) fn finish(&mut self, id: &str, sent: bool, now: Instant) {
        self.prune(now);
        if sent {
            self.entries.remove(id);
        } else if let Some(draft) = self.entries.get_mut(id) {
            draft.sending = false;
        }
    }

    /// Drops the drafts of every phone not in `paired`: a forgotten phone's
    /// drafts go, and so does a draft whose id is now another credential's.
    pub(super) fn keep_paired(&mut self, paired: &[Owner], now: Instant) {
        self.prune(now);
        self.entries
            .retain(|_, draft| paired.contains(&draft.owner));
    }

    /// Drops every draft past its life. Run on each access, so an expired
    /// draft's subject and body do not outlive the next touch of the table.
    fn prune(&mut self, now: Instant) {
        self.entries
            .retain(|_, draft| now.duration_since(draft.created) < LIFE);
    }

    #[cfg(test)]
    pub(super) fn count(&self) -> usize {
        self.entries.len()
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use kalsa_door::DeviceId;

    use super::{Drafts, Owner, LIFE, PER_OWNER};

    const ID: &str = "0123456789abcdef0123456789abcdef";

    fn owner(id: u32, digest: u8) -> Owner {
        (DeviceId::new(id), [digest; 32])
    }

    /// The phone that made the stored draft, paired under its first credential.
    fn mine() -> Owner {
        owner(1, 0xaa)
    }

    /// A draft made by `mine()` at `now`, replying to mail 105.
    fn stored(now: Instant) -> Drafts {
        let mut drafts = Drafts::default();
        drafts.insert(
            ID.to_string(),
            mine(),
            105,
            "Re: Fattura".to_string(),
            "Va bene, grazie.".to_string(),
            now,
        );
        drafts
    }

    #[test]
    fn a_draft_belongs_to_the_device_that_made_it() {
        let now = Instant::now();
        let mut drafts = stored(now);
        assert_eq!(
            drafts.begin(owner(2, 0xaa), ID, None, now).err(),
            Some("draft_unknown")
        );
        assert!(drafts.begin(mine(), ID, None, now).is_ok());
    }

    /// The owner check is the full owner, not the id: a reused id under a
    /// new credential is refused here, with no pairing purge in between.
    #[test]
    fn a_draft_whose_credential_digest_differs_is_unknown_without_a_purge() {
        let now = Instant::now();
        let mut drafts = stored(now);
        assert_eq!(
            drafts.begin(owner(1, 0xbb), ID, None, now).err(),
            Some("draft_unknown")
        );
        assert_eq!(drafts.count(), 1, "the refusal must not be the purge's work");
        assert!(drafts.begin(mine(), ID, None, now).is_ok());
    }

    #[test]
    fn a_draft_expires_thirty_minutes_after_it_was_made() {
        let now = Instant::now();
        let mut drafts = stored(now);
        let almost = now + LIFE - Duration::from_secs(1);
        assert!(drafts.begin(mine(), ID, None, almost).is_ok());
        drafts.finish(ID, false, almost);
        let late = now + LIFE;
        assert_eq!(
            drafts.begin(mine(), ID, None, late).err(),
            Some("draft_unknown")
        );
    }

    #[test]
    fn an_expired_draft_is_pruned_by_any_access_not_only_by_an_insert() {
        let now = Instant::now();
        let mut drafts = stored(now);
        let late = now + LIFE;
        assert_eq!(
            drafts
                .begin(mine(), "ffffffffffffffffffffffffffffffff", None, late)
                .err(),
            Some("draft_unknown")
        );
        assert_eq!(drafts.count(), 0);
    }

    #[test]
    fn a_sent_draft_is_spent() {
        let now = Instant::now();
        let mut drafts = stored(now);
        assert!(drafts.begin(mine(), ID, None, now).is_ok());
        drafts.finish(ID, true, now);
        assert_eq!(
            drafts.begin(mine(), ID, None, now).err(),
            Some("draft_unknown")
        );
    }

    #[test]
    fn a_second_send_while_the_first_is_in_flight_is_busy() {
        let now = Instant::now();
        let mut drafts = stored(now);
        assert!(drafts.begin(mine(), ID, None, now).is_ok());
        assert_eq!(drafts.begin(mine(), ID, None, now).err(), Some("busy"));
    }

    #[test]
    fn a_failed_send_frees_the_draft_for_a_retry() {
        let now = Instant::now();
        let mut drafts = stored(now);
        assert!(drafts.begin(mine(), ID, None, now).is_ok());
        drafts.finish(ID, false, now);
        assert!(drafts.begin(mine(), ID, None, now).is_ok());
    }

    #[test]
    fn the_edited_body_replaces_the_stored_one_only_when_it_is_not_blank() {
        let now = Instant::now();
        let mut drafts = stored(now);
        let edited = drafts
            .begin(mine(), ID, Some("Ci sentiamo.".to_string()), now)
            .unwrap();
        assert_eq!(edited.body, "Ci sentiamo.");
        drafts.finish(ID, false, now);
        let blank = drafts
            .begin(mine(), ID, Some("   ".to_string()), now)
            .unwrap();
        assert_eq!(blank.body, "Va bene, grazie.");
        drafts.finish(ID, false, now);
        let absent = drafts.begin(mine(), ID, None, now).unwrap();
        assert_eq!(absent.body, "Va bene, grazie.");
    }

    #[test]
    fn the_reply_and_the_subject_come_from_the_draft_whatever_the_phone_sends() {
        let now = Instant::now();
        let mut drafts = stored(now);
        let ticket = drafts
            .begin(mine(), ID, Some("altro testo".to_string()), now)
            .unwrap();
        assert_eq!(ticket.reply_to_id, 105);
        assert_eq!(ticket.subject, "Re: Fattura");
    }

    #[test]
    fn inserting_prunes_the_expired() {
        let now = Instant::now();
        let mut drafts = stored(now);
        let later = now + LIFE;
        drafts.insert(
            "fedcba9876543210fedcba9876543210".to_string(),
            owner(1, 0xbb),
            106,
            String::new(),
            String::new(),
            later,
        );
        assert!(!drafts.entries.contains_key(ID));
    }

    #[test]
    fn a_forgotten_phones_drafts_are_dropped_when_the_pairing_changes() {
        let now = Instant::now();
        let mut drafts = stored(now);
        drafts.keep_paired(&[owner(2, 0xcc)], now);
        assert_eq!(drafts.count(), 0);
        assert_eq!(
            drafts.begin(mine(), ID, None, now).err(),
            Some("draft_unknown")
        );
    }

    /// The forgotten top id is paired again to another phone before the next
    /// pairing pass sees the gap: the new credential must not spend the old draft.
    #[test]
    fn a_reused_id_under_a_new_credential_cannot_spend_the_old_draft() {
        let now = Instant::now();
        let mut drafts = stored(now);
        drafts.keep_paired(&[owner(1, 0xbb)], now);
        assert_eq!(drafts.count(), 0);
        assert_eq!(
            drafts.begin(mine(), ID, None, now).err(),
            Some("draft_unknown")
        );
    }

    #[test]
    fn a_draft_of_a_phone_still_paired_under_its_credential_is_kept() {
        let now = Instant::now();
        let mut drafts = stored(now);
        drafts.keep_paired(&[mine()], now);
        assert_eq!(drafts.count(), 1);
    }

    /// A phone past its cap loses its own oldest draft, and nobody else's.
    #[test]
    fn a_phone_holds_at_most_its_cap_and_loses_its_oldest_draft() {
        let now = Instant::now();
        let mut drafts = Drafts::default();
        let other = owner(2, 0xcc);
        drafts.insert(
            "other".to_string(),
            other,
            7,
            String::new(),
            String::new(),
            now,
        );
        let id = |index: usize| format!("{index:032x}");
        for index in 0..=PER_OWNER {
            let made = now + Duration::from_millis(index as u64 + 1);
            drafts.insert(id(index), mine(), 105, String::new(), String::new(), made);
        }
        assert_eq!(drafts.count(), PER_OWNER + 1, "the other phone's draft stays");
        assert_eq!(
            drafts.begin(mine(), &id(0), None, now).err(),
            Some("draft_unknown"),
            "the oldest of the phone's drafts is the one dropped"
        );
        assert!(drafts.begin(mine(), &id(PER_OWNER), None, now).is_ok());
        assert!(drafts.begin(other, "other", None, now).is_ok());
    }
}
