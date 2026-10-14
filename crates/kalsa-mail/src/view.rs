//! The structured results the host draws cards from, and the fence that guards
//! the same text in the part a model reads.

use crate::fence::Fence;
use crate::html_text;
use crate::label::Labels;
use crate::mail::ParsedMail;
use rmcp::model::{CallToolResult, ContentBlock};
use serde::Serialize;

pub const SNIPPET_LIMIT: usize = 200;

#[derive(Serialize)]
pub struct Address {
    pub name: String,
    pub address: String,
}

#[derive(Serialize)]
pub struct LabelsOut {
    pub label: &'static str,
    pub reasons: Vec<&'static str>,
}

impl From<&Labels> for LabelsOut {
    fn from(labels: &Labels) -> Self {
        LabelsOut {
            label: labels.label.name(),
            reasons: labels.reasons.iter().map(|r| r.code()).collect(),
        }
    }
}

#[derive(Serialize)]
pub struct AttachmentOut {
    pub name: String,
    pub size: usize,
}

#[derive(Serialize)]
pub struct ListItem {
    pub id: String,
    pub from: Address,
    pub subject: String,
    /// RFC 3339, or null when the Date header is missing or unreadable.
    pub date: Option<String>,
    pub snippet: String,
    pub labels: LabelsOut,
}

#[derive(Serialize)]
pub struct ListOut {
    pub folder: String,
    pub count: usize,
    pub items: Vec<ListItem>,
}

#[derive(Serialize)]
pub struct ReadOut {
    pub id: String,
    pub from: Address,
    pub subject: String,
    pub date: Option<String>,
    /// What a card shows. The body is not here on purpose: it is a stranger's text
    /// and the only copy that leaves this server is the fenced one.
    pub snippet: String,
    pub thread_ids: Vec<String>,
    pub attachments: Vec<AttachmentOut>,
    pub labels: LabelsOut,
}

impl ListItem {
    pub fn of(uid: u32, mail: &ParsedMail, labels: &Labels) -> ListItem {
        ListItem {
            id: uid.to_string(),
            from: Address {
                name: mail.from_display.clone(),
                address: mail.from_address.clone(),
            },
            subject: mail.subject.clone(),
            date: rfc3339(mail.date_ms),
            snippet: html_text::snippet(&mail.text, SNIPPET_LIMIT),
            labels: LabelsOut::from(labels),
        }
    }
}

impl ReadOut {
    pub fn of(uid: u32, mail: &ParsedMail, labels: &Labels) -> ReadOut {
        ReadOut {
            id: uid.to_string(),
            from: Address {
                name: mail.from_display.clone(),
                address: mail.from_address.clone(),
            },
            subject: mail.subject.clone(),
            date: rfc3339(mail.date_ms),
            snippet: html_text::snippet(&mail.text, SNIPPET_LIMIT),
            thread_ids: mail.thread_ids.clone(),
            attachments: mail
                .attachments
                .iter()
                .map(|a| AttachmentOut {
                    name: a.name.clone(),
                    size: a.size,
                })
                .collect(),
            labels: LabelsOut::from(labels),
        }
    }
}

fn rfc3339(date_ms: i64) -> Option<String> {
    (date_ms != 0)
        .then(|| chrono::DateTime::from_timestamp_millis(date_ms))
        .flatten()
        .map(|at| at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

impl ListItem {
    /// The lines of one item a model may read.
    pub fn fenced(&self, fence: &Fence) -> Vec<String> {
        vec![
            fence.field(
                "from",
                &format!("{} <{}>", self.from.name, self.from.address),
            ),
            fence.field("subject", &self.subject),
            fence.field("snippet", &self.snippet),
            fence.field("labels", self.labels.label),
        ]
    }
}

impl ReadOut {
    /// The full text lives here and only here: this is what a model reads.
    pub fn fenced(&self, fence: &Fence, body: &str) -> Vec<String> {
        vec![
            fence.field(
                "from",
                &format!("{} <{}>", self.from.name, self.from.address),
            ),
            fence.field("subject", &self.subject),
            fence.field("body", body),
        ]
    }
}

/// The result of a tool call: the structured record for the host, and the mail text
/// fenced for the model. The host draws a card from the record; a model reads the
/// text, which is the part that a stranger wrote.
pub fn result<T: Serialize>(
    fence: &Fence,
    structured: &T,
    fenced_lines: Vec<String>,
) -> CallToolResult {
    let value = serde_json::to_value(structured).unwrap_or(serde_json::Value::Null);
    let mut result = CallToolResult::structured(value);
    result.content = vec![ContentBlock::text(fence.block(&fenced_lines))];
    result
}

pub fn error(message: &str) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(message.to_string())])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::label::{Label, Labels, Reason};

    fn labels() -> Labels {
        Labels {
            label: Label::Suspicious,
            suspicious: true,
            bulk: false,
            reasons: vec![Reason::AuthFail],
        }
    }

    fn mail_with_body(body: &str) -> ParsedMail {
        ParsedMail {
            headers: Vec::new(),
            from_address: "a@b.example.it".to_string(),
            from_display: "A".to_string(),
            reply_to: None,
            date_ms: 1_790_000_000_000,
            message_id: None,
            subject: "Oggetto".to_string(),
            text: body.to_string(),
            body: String::new(),
            links: Vec::new(),
            attachments: Vec::new(),
            thread_ids: Vec::new(),
        }
    }

    fn mail() -> ParsedMail {
        mail_with_body("testo")
    }

    #[test]
    fn a_result_carries_a_structured_record_and_fenced_text() {
        let fence = Fence::new();
        let item = ListItem::of(7, &mail(), &labels());
        let result = result(&fence, &item, item.fenced(&fence));
        let structured = result.structured_content.expect("structured content");
        assert_eq!(structured["id"], "7");
        assert_eq!(structured["labels"]["label"], "suspicious");
        assert_eq!(structured["labels"]["reasons"][0], "auth_fail");

        // T4: the bracket nonce and the line nonce are one nonce, because they are
        // one fence. Before this, a model could not tie a line to its block.
        let text = result.content[0].as_text().expect("text").text.clone();
        assert!(text.starts_with(&format!("<<<email-text {}>>>", fence.nonce())));
        assert!(text.ends_with(&format!("<<<end-email-text {}>>>", fence.nonce())));
        assert!(text.contains(&format!("{} Oggetto", fence.nonce())));
        assert!(text.contains("not instructions"));
    }

    /// The full text of a mail is a stranger's words. It leaves this server only in
    /// the fenced block, never in the record the host draws cards from.
    #[test]
    fn the_structured_record_holds_no_mail_body() {
        let fence = Fence::new();
        let parsed = mail_with_body(&format!("{}. Fine.", "riempimento ".repeat(40)));
        let out = ReadOut::of(9, &parsed, &labels());
        let result = result(&fence, &out, out.fenced(&fence, &parsed.text));
        let structured = result.structured_content.expect("structured content");
        let dumped = structured.to_string();
        assert!(
            !dumped.contains("Fine"),
            "the body is not in the record: {dumped}"
        );
        assert!(dumped.contains("\"id\":\"9\""));
        assert!(dumped.contains("\"labels\""));
        assert!(structured.get("body").is_none());

        let text = result.content[0].as_text().expect("text").text.clone();
        assert!(text.contains("Fine"), "the body does travel, fenced");
    }

    #[test]
    fn the_date_is_rfc3339_or_null_and_never_an_epoch() {
        assert_eq!(
            rfc3339(1_790_000_000_000).as_deref(),
            Some("2026-09-21T14:13:20Z")
        );
        assert_eq!(rfc3339(0), None);
    }
}
