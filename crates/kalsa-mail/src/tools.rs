//! The four tool definitions a host pins a hash of. They live apart from the code
//! that runs them: a host that found one of these changed has to see it by reading
//! this file alone, and these schemas are what it hashes.

use rmcp::model::{JsonObject, Tool, ToolAnnotations};
use serde_json::{json, Value};

/// The plan's range for `list`, stated once so the schema and the code agree.
pub const MAX_DAYS: u32 = 14;

/// `draft` is read-only too: it returns an object for the person to look at and
/// touches no folder.
fn read_only() -> ToolAnnotations {
    ToolAnnotations::from_raw(None, Some(true), Some(false), Some(true), Some(false))
}

fn schema(value: Value) -> JsonObject {
    value.as_object().cloned().unwrap_or_default()
}

pub(crate) fn list() -> Tool {
    Tool::new(
        "list",
        "List the newest mails of a folder with a short snippet and a label (bulk, \
suspicious or normal). Each mail starts with its id, shown as \"mail id N\". Read-only.",
        schema(json!({
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_DAYS,
                    "description": "How many days back to look. Defaults to 1."
                },
                "folder": {
                    "type": "string",
                    "description": "Folder to read. Defaults to INBOX."
                },
                "from": {
                    "type": "string",
                    "description": "Only mails from this address."
                },
                "query": {
                    "type": "string",
                    "description": "Free text to look for in the whole message."
                }
            },
            "additionalProperties": false
        })),
    )
    .with_annotations(read_only())
}

pub(crate) fn read() -> Tool {
    Tool::new(
        "read",
        "Read one mail as text: the body with remote content dropped, the thread ids \
and the attachment names and sizes. Attachments are never opened.",
        schema(json!({
            "type": "object",
            "properties": {
                "id": {
                    "type": "integer",
                    "description": "The number shown as \"mail id N\" in a list result."
                },
                "folder": {
                    "type": "string",
                    "description": "Folder to read. Defaults to INBOX."
                }
            },
            "required": ["id"],
            "additionalProperties": false
        })),
    )
    .with_annotations(read_only())
}

pub(crate) fn draft() -> Tool {
    Tool::new(
        "draft",
        "Build a reply to one mail and return it as an object for the person to \
review. The recipient comes from that message, never from an argument. Nothing is \
sent and nothing is saved.",
        schema(json!({
            "type": "object",
            "properties": {
                "reply_to_id": {
                    "type": "integer",
                    "description": "The number shown as \"mail id N\" in a list result, of the message being answered."
                },
                "body": {
                    "type": "string",
                    "description": "What the person wrote in the composer."
                },
                "folder": {
                    "type": "string",
                    "description": "Folder the message is in. Defaults to INBOX."
                }
            },
            "required": ["reply_to_id", "body"],
            "additionalProperties": false
        })),
    )
    .with_annotations(read_only())
}

/// The writing tool. It is the only one that is not read-only, and the host asks the
/// person before it runs.
pub(crate) fn send() -> Tool {
    Tool::new(
        "send",
        "Send a reply to one mail. It runs only after the person confirms the exact text. \
The recipient is the address that mail came from, never an argument.",
        schema(json!({
            "type": "object",
            "properties": {
                "reply_to_id": {
                    "type": "integer",
                    "description": "The number shown as \"mail id N\" in a list result, of the message being answered."
                },
                "subject": {
                    "type": "string",
                    "description": "The subject of the reply."
                },
                "body": {
                    "type": "string",
                    "description": "What the person wrote."
                },
                "folder": {
                    "type": "string",
                    "description": "Folder the message is in. Defaults to INBOX."
                }
            },
            "required": ["reply_to_id", "subject", "body"],
            "additionalProperties": false
        })),
    )
    .with_annotations(ToolAnnotations::from_raw(None, Some(false), Some(true), Some(false), Some(true)))
}

/// The four definitions exactly as they are served, in the order a host lists
/// them. The host pins a hash of these: a caller that builds its own copy is a
/// caller that can drift.
pub fn tool_definitions() -> Vec<Tool> {
    vec![list(), read(), draft(), send()]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The host stores a hash of each tool's name, description and schema, so these
    /// four definitions are the contract. A change here is a change on purpose.
    #[test]
    fn there_are_four_tools_and_only_send_writes() {
        let all = tool_definitions();
        let names: Vec<&str> = all.iter().map(|tool| tool.name.as_ref()).collect();
        assert_eq!(names, vec!["list", "read", "draft", "send"]);
        for tool in all {
            let annotations = tool.annotations.as_ref().expect("annotated");
            if tool.name == "send" {
                assert_eq!(annotations.read_only_hint, Some(false), "send is the one write");
                assert_eq!(annotations.destructive_hint, Some(true));
                continue;
            }
            assert_eq!(
                annotations.read_only_hint,
                Some(true),
                "{} must say it only reads",
                tool.name
            );
            assert_eq!(annotations.destructive_hint, Some(false));
            assert!(tool.description.as_deref().is_some_and(|d| !d.is_empty()));
        }
    }

    #[test]
    fn what_is_served_is_what_tool_definitions_returns() {
        let served = tool_definitions();
        assert_eq!(served, vec![list(), read(), draft(), send()]);
        let names: Vec<&str> = served.iter().map(|tool| tool.name.as_ref()).collect();
        assert_eq!(names, vec!["list", "read", "draft", "send"]);
    }

    #[test]
    fn the_schemas_pin_what_each_tool_accepts() {
        let list = list();
        assert!(list
            .input_schema
            .get("properties")
            .is_some_and(|p| p.get("days").is_some()));
        assert_eq!(
            list.input_schema.get("additionalProperties"),
            Some(&json!(false))
        );
        assert!(
            list.input_schema.get("required").is_none(),
            "days is optional"
        );

        let read = read();
        let required = read.input_schema.get("required").expect("id is required");
        assert_eq!(required, &json!(["id"]));

        let draft = draft();
        let required = draft
            .input_schema
            .get("required")
            .expect("both are required");
        assert_eq!(required, &json!(["reply_to_id", "body"]));
        let properties = draft.input_schema.get("properties").expect("properties");
        assert!(
            properties.get("to").is_none(),
            "there is no recipient argument: it comes from the message"
        );
        assert!(properties.get("subject").is_none());
    }

    #[test]
    fn the_days_argument_is_bounded_to_the_plan_range() {
        let days = list().input_schema["properties"]["days"].clone();
        assert_eq!(days["minimum"], json!(1));
        assert_eq!(days["maximum"], json!(MAX_DAYS));
    }

    /// T3: the schema is not the guard. The clamp is, because `days` also reaches
    /// `chrono`, and a huge value there walks out of its range.
    #[test]
    fn the_clamp_is_what_bounds_the_window() {
        for asked in [None, Some(0), Some(1), Some(14), Some(15), Some(u32::MAX)] {
            let asked = asked.unwrap_or(1);
            let days = asked.clamp(1, MAX_DAYS);
            assert!((1..=MAX_DAYS).contains(&days), "days={asked} became {days}");
            let since = chrono::Utc::now() - chrono::Duration::days(i64::from(days));
            assert!(
                since.to_rfc3339().starts_with('2'),
                "the window is a real date, not an overflow: {since}"
            );
        }
    }
}
