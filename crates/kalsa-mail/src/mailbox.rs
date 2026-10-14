//! What this server asks a mailbox for: a read-only session, a day window, the
//! bytes of a mail, and the senders already in the folder.
//!
//! `EXAMINE` and `BODY.PEEK` only, so nothing is marked seen and no flag can change
//! by accident. There is no write command in this file, and no way to reach one from
//! a tool call.

use crate::imap::{MailError, Transport, READ_DEADLINE};
use async_imap::Session;
use chrono::Datelike;
use futures_util::StreamExt;
use tokio::time::timeout;

/// How many bytes of one mail this server will hold. A mail larger than this is read
/// to that point and no further: a 10 MB newsletter must not become 500 MB of RAM
/// because a list asked for fifty items.
pub const MESSAGE_LIMIT: usize = 256 * 1024;

/// A mail cut at `MESSAGE_LIMIT` still has to reach past the point where `mail`
/// stops reading, or every large mail would come back with an empty body.
const _: () = assert!(MESSAGE_LIMIT > crate::mail::BODY_LIMIT);

/// One message: its headers and as much of its source as we agreed to read.
pub struct Source {
    pub uid: u32,
    pub bytes: Vec<u8>,
}

pub struct Mailbox {
    session: Session<Transport>,
    pub folder: String,
    /// A folder that is rebuilt gets a new value, and every id we handed out before
    /// it now names a different message.
    pub uid_validity: Option<u32>,
}

impl Mailbox {
    pub async fn examine(
        mut session: Session<Transport>,
        folder: &str,
    ) -> Result<Mailbox, MailError> {
        let opened = timeout(READ_DEADLINE, session.examine(quoted(folder)))
            .await
            .map_err(|_| MailError::Timeout)?
            .map_err(|_| MailError::Mailbox)?;
        Ok(Mailbox {
            session,
            folder: folder.to_string(),
            uid_validity: opened.uid_validity,
        })
    }

    /// UIDs newest first, capped. `days`, `from` and `query` become SEARCH keys, and
    /// both strings arrive from a tool call, so they are escaped before they are
    /// concatenated into a command.
    pub async fn uids(
        &mut self,
        days: u32,
        from: Option<&str>,
        query: Option<&str>,
        cap: usize,
    ) -> Result<Vec<u32>, MailError> {
        let mut criteria = format!("SINCE {}", imap_date(days));
        if let Some(from) = from {
            criteria.push_str(&format!(" FROM {}", quoted(from)));
        }
        if let Some(query) = query {
            criteria.push_str(&format!(" TEXT {}", quoted(query)));
        }
        let found = bounded(self.session.uid_search(criteria)).await?;
        let mut uids: Vec<u32> = found.into_iter().collect();
        uids.sort_unstable();
        uids.drain(..uids.len().saturating_sub(cap));
        uids.reverse();
        Ok(uids)
    }

    pub async fn all_uids(&mut self) -> Result<Vec<u32>, MailError> {
        let mut uids: Vec<u32> = bounded(self.session.uid_search("ALL"))
            .await?
            .into_iter()
            .collect();
        uids.sort_unstable();
        Ok(uids)
    }

    /// Sender and date headers of these UIDs, newest last.
    pub async fn headers(&mut self, uids: &[u32]) -> Result<Vec<Vec<u8>>, MailError> {
        if uids.is_empty() {
            return Ok(Vec::new());
        }
        let set = set_of(uids);
        let mut stream = bounded(self.session.uid_fetch(set, "BODY.PEEK[HEADER]")).await?;
        let mut out = Vec::with_capacity(uids.len());
        while let Some(fetch) = stream.next().await {
            let fetch = fetch.map_err(|_| MailError::Protocol)?;
            out.push(fetch.header().map(<[u8]>::to_vec).unwrap_or_default());
        }
        Ok(out)
    }

    /// The source of each UID, whole or cut at [`MESSAGE_LIMIT`]. The size comes
    /// from the server before anything is read, so a huge mail is never downloaded
    /// whole to be thrown away.
    pub async fn sources(&mut self, uids: &[u32]) -> Result<Vec<Source>, MailError> {
        if uids.is_empty() {
            return Ok(Vec::new());
        }
        let sizes = self.sizes(uids).await?;
        let (small, large): (Vec<u32>, Vec<u32>) = uids
            .iter()
            .partition(|uid| sizes.get(uid).is_none_or(|size| *size <= MESSAGE_LIMIT));
        let mut out = Vec::with_capacity(uids.len());
        for group in [
            (small, full_body_query()),
            (large, partial_body_query(MESSAGE_LIMIT)),
        ] {
            if group.0.is_empty() {
                continue;
            }
            let mut stream = bounded(self.session.uid_fetch(set_of(&group.0), &group.1)).await?;
            while let Some(fetch) = stream.next().await {
                let fetch = fetch.map_err(|_| MailError::Protocol)?;
                let uid = fetch.uid.unwrap_or_default();
                out.push(Source {
                    uid,
                    bytes: fetch.body().map(<[u8]>::to_vec).unwrap_or_default(),
                });
            }
        }
        // A server answers a UID set in its own order, ascending by convention. The
        // tools want the newest mail first, so the order is set here.
        out.sort_by_key(|source| std::cmp::Reverse(source.uid));
        Ok(out)
    }

    async fn sizes(
        &mut self,
        uids: &[u32],
    ) -> Result<std::collections::HashMap<u32, usize>, MailError> {
        let mut stream = bounded(self.session.uid_fetch(set_of(uids), "RFC822.SIZE")).await?;
        let mut sizes = std::collections::HashMap::new();
        while let Some(fetch) = stream.next().await {
            let fetch = fetch.map_err(|_| MailError::Protocol)?;
            if let (Some(uid), Some(size)) = (fetch.uid, fetch.size) {
                sizes.insert(uid, size as usize);
            }
        }
        Ok(sizes)
    }

    pub async fn logout(&mut self) {
        let _ = self.session.logout().await;
    }
}

/// Every command goes through here, so no await in this file is unbounded.
async fn bounded<T, F>(command: F) -> Result<T, MailError>
where
    F: std::future::Future<Output = Result<T, async_imap::error::Error>>,
{
    timeout(READ_DEADLINE, command)
        .await
        .map_err(|_| MailError::Timeout)?
        .map_err(|_| MailError::Command)
}

fn set_of(uids: &[u32]) -> String {
    uids.iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

fn full_body_query() -> String {
    "BODY.PEEK[]".to_string()
}

/// A partial fetch, which can cut a MIME structure in half: the parser has to be happy
/// with a message that stops mid-part.
fn partial_body_query(limit: usize) -> String {
    format!("BODY.PEEK[]<0.{limit}>")
}

/// `17-Oct-2026`, the form IMAP SEARCH takes. A search key carries no time zone, so
/// this is Utc: a day computed in local time would drop mail the person asked for.
fn imap_date(days: u32) -> String {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let since = chrono::Utc::now() - chrono::Duration::days(i64::from(days));
    format!(
        "{:02}-{}-{}",
        since.day(),
        MONTHS[(since.month() - 1) as usize],
        since.year()
    )
}

/// Wraps a value as an IMAP quoted string. Backslashes and quotes go in first: a raw
/// value would end its own argument, and the rest of it would be read as commands.
fn quoted(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        if matches!(c, '"' | '\\') {
            out.push('\\');
        }
        if c != '\r' && c != '\n' {
            out.push(c);
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tool_argument_cannot_end_its_own_argument() {
        assert_eq!(quoted("a b"), "\"a b\"");
        assert_eq!(quoted("x\" DELETED \"y"), "\"x\\\" DELETED \\\"y\"");
        assert_eq!(quoted("a\r\nb"), "\"ab\"");
    }

    #[test]
    fn a_folder_name_is_quoted_the_same_way() {
        assert_eq!(quoted("INBOX"), "\"INBOX\"");
        assert_eq!(quoted("Sent Items"), "\"Sent Items\"");
    }

    #[test]
    fn a_big_mail_is_never_asked_for_whole() {
        assert_eq!(full_body_query(), "BODY.PEEK[]");
        assert_eq!(partial_body_query(MESSAGE_LIMIT), "BODY.PEEK[]<0.262144>");
    }

    #[test]
    fn a_uid_set_is_comma_separated() {
        assert_eq!(set_of(&[3, 1, 2]), "3,1,2");
        assert_eq!(set_of(&[]), "");
    }
}
