//! The reply drafts the page made for a phone. The app keeps the draft and the
//! phone holds only its id: a send names that id and nothing else, so the
//! recipient is the one the stored mail names, never one the phone typed.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use kalsa_door::DeviceId;

/// How long a draft waits for the phone's confirm. Longer than that and the
/// person starts the reply again.
const LIFE: Duration = Duration::from_secs(30 * 60);

pub(super) struct Draft {
    device: DeviceId,
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
    /// Stores a draft under `id`, dropping the ones that have expired.
    pub(super) fn insert(
        &mut self,
        id: String,
        device: DeviceId,
        reply_to_id: u32,
        subject: String,
        body: String,
        now: Instant,
    ) {
        self.entries.retain(|_, draft| now.duration_since(draft.created) < LIFE);
        let draft = Draft {
            device,
            reply_to_id,
            subject,
            body,
            created: now,
            sending: false,
        };
        self.entries.insert(id, draft);
    }

    /// Starts the send of a draft the device made. The edited body wins only
    /// when it is not blank; otherwise the stored body goes.
    pub(super) fn begin(
        &mut self,
        device: DeviceId,
        id: &str,
        edited: Option<String>,
        now: Instant,
    ) -> Result<Ticket, &'static str> {
        let draft = self
            .entries
            .get_mut(id)
            .filter(|draft| draft.device == device && now.duration_since(draft.created) < LIFE)
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
    pub(super) fn finish(&mut self, id: &str, sent: bool) {
        if sent {
            self.entries.remove(id);
        } else if let Some(draft) = self.entries.get_mut(id) {
            draft.sending = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "0123456789abcdef0123456789abcdef";

    fn phone(id: u32) -> DeviceId {
        DeviceId::new(id)
    }

    /// A draft made by device 1 at `now`, replying to mail 105.
    fn stored(now: Instant) -> Drafts {
        let mut drafts = Drafts::default();
        drafts.insert(
            ID.to_string(),
            phone(1),
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
        assert_eq!(drafts.begin(phone(2), ID, None, now).err(), Some("draft_unknown"));
        assert!(drafts.begin(phone(1), ID, None, now).is_ok());
    }

    #[test]
    fn a_draft_expires_thirty_minutes_after_it_was_made() {
        let now = Instant::now();
        let mut drafts = stored(now);
        let almost = now + LIFE - Duration::from_secs(1);
        assert!(drafts.begin(phone(1), ID, None, almost).is_ok());
        drafts.finish(ID, false);
        let late = now + LIFE;
        assert_eq!(drafts.begin(phone(1), ID, None, late).err(), Some("draft_unknown"));
    }

    #[test]
    fn a_sent_draft_is_spent() {
        let now = Instant::now();
        let mut drafts = stored(now);
        assert!(drafts.begin(phone(1), ID, None, now).is_ok());
        drafts.finish(ID, true);
        assert_eq!(drafts.begin(phone(1), ID, None, now).err(), Some("draft_unknown"));
    }

    #[test]
    fn a_second_send_while_the_first_is_in_flight_is_busy() {
        let now = Instant::now();
        let mut drafts = stored(now);
        assert!(drafts.begin(phone(1), ID, None, now).is_ok());
        assert_eq!(drafts.begin(phone(1), ID, None, now).err(), Some("busy"));
    }

    #[test]
    fn a_failed_send_frees_the_draft_for_a_retry() {
        let now = Instant::now();
        let mut drafts = stored(now);
        assert!(drafts.begin(phone(1), ID, None, now).is_ok());
        drafts.finish(ID, false);
        assert!(drafts.begin(phone(1), ID, None, now).is_ok());
    }

    #[test]
    fn the_edited_body_replaces_the_stored_one_only_when_it_is_not_blank() {
        let now = Instant::now();
        let mut drafts = stored(now);
        let edited = drafts.begin(phone(1), ID, Some("Ci sentiamo.".to_string()), now).unwrap();
        assert_eq!(edited.body, "Ci sentiamo.");
        drafts.finish(ID, false);
        let blank = drafts.begin(phone(1), ID, Some("   ".to_string()), now).unwrap();
        assert_eq!(blank.body, "Va bene, grazie.");
        drafts.finish(ID, false);
        let absent = drafts.begin(phone(1), ID, None, now).unwrap();
        assert_eq!(absent.body, "Va bene, grazie.");
    }

    #[test]
    fn the_reply_and_the_subject_come_from_the_draft_whatever_the_phone_sends() {
        let now = Instant::now();
        let mut drafts = stored(now);
        let ticket = drafts
            .begin(phone(1), ID, Some("altro testo".to_string()), now)
            .unwrap();
        assert_eq!(ticket.reply_to_id, 105);
        assert_eq!(ticket.subject, "Re: Fattura");
    }

    #[test]
    fn an_unknown_id_is_unknown_and_inserting_prunes_the_expired() {
        let now = Instant::now();
        let mut drafts = stored(now);
        assert_eq!(drafts.begin(phone(1), "ffffffffffffffffffffffffffffffff", None, now).err(), Some("draft_unknown"));
        let later = now + LIFE;
        drafts.insert(
            "fedcba9876543210fedcba9876543210".to_string(),
            phone(1),
            106,
            String::new(),
            String::new(),
            later,
        );
        assert!(!drafts.entries.contains_key(ID));
    }
}
