//! The five tool definitions a host pins a hash of. They live apart from the code
//! that runs them: a host that found one of these changed has to see it by reading
//! this file alone, and these schemas are what it hashes.
//!
//! There is no `submit` tool and there will not be one. Enter is decided in
//! code, so a model is never asked whether to send something.

use rmcp::model::{JsonObject, Tool, ToolAnnotations};
use serde_json::{json, Value};

fn schema(value: Value) -> JsonObject {
    value.as_object().cloned().unwrap_or_default()
}

/// `open`, `read`, `find` and `click` change nothing on the site as far as the
/// person can tell; `type` fills a field and may, when the field says so, press
/// Enter — which in slice 1 never reaches the network.
fn read_only() -> ToolAnnotations {
    ToolAnnotations::from_raw(None, Some(true), Some(false), Some(true), Some(false))
}

fn writes() -> ToolAnnotations {
    ToolAnnotations::from_raw(None, Some(true), Some(true), Some(true), Some(false))
}

pub(crate) fn open() -> Tool {
    Tool::new(
        "browser_open",
        "Open a web address in the browser window and return the page as text. The \
address must be http or https: no other scheme is opened, and nothing on this \
computer's own network is opened. Read-only.",
        schema(json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The address to open, with or without https://."
                }
            },
            "required": ["url"],
            "additionalProperties": false
        })),
    )
    .with_annotations(read_only())
}

pub(crate) fn read() -> Tool {
    Tool::new(
        "browser_read",
        "Read the page as text: one line per element, each with the ref to act on \
it. A long page arrives in parts — pass the next part's number to carry on. \
Read-only.",
        schema(json!({
            "type": "object",
            "properties": {
                "page": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Which part of a long page to return. Defaults to 1."
                }
            },
            "additionalProperties": false
        })),
    )
    .with_annotations(read_only())
}

pub(crate) fn find() -> Tool {
    Tool::new(
        "browser_find",
        "Find text on the current page and return the lines that mention it, with \
a little around them and their refs. Reach for this when the page is too long \
to read whole. Read-only.",
        schema(json!({
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "The text to look for. Not case sensitive."
                }
            },
            "required": ["text"],
            "additionalProperties": false
        })),
    )
    .with_annotations(read_only())
}

pub(crate) fn click() -> Tool {
    Tool::new(
        "browser_click",
        "Click one element of the page, by the ref a read printed. A click that \
would send something to the site does not go out: Kalsa does not write to sites \
yet, so tell the person what you meant to do.",
        schema(json!({
            "type": "object",
            "properties": {
                "ref": {
                    "type": "string",
                    "description": "The element ref, as the read printed it, e.g. \"e12\"."
                }
            },
            "required": ["ref"],
            "additionalProperties": false
        })),
    )
    .with_annotations(writes())
}

pub(crate) fn type_into() -> Tool {
    Tool::new(
        "browser_type",
        "Fill a field on the page, by the ref a read printed. Enter is pressed \
afterwards only when the field is a one-line field inside a form; a textarea, \
an editable block and a field with no form are filled and left alone. A \
password field is never filled: ask the person to type it in the window.",
        schema(json!({
            "type": "object",
            "properties": {
                "ref": {
                    "type": "string",
                    "description": "The element ref, as the read printed it, e.g. \"e12\"."
                },
                "text": {
                    "type": "string",
                    "description": "What to type into the field."
                }
            },
            "required": ["ref", "text"],
            "additionalProperties": false
        })),
    )
    .with_annotations(writes())
}

/// Every tool this server answers, in the order `tools/list` returns them.
///
/// Public because the app pins these against `src/browser/tool_pins.json` and
/// the host has to reach the same definitions to compute the pins.
pub fn tool_definitions() -> Vec<Tool> {
    vec![open(), read(), find(), click(), type_into()]
}

#[cfg(test)]
mod tests {
    use rmcp::model::Tool;
    use serde_json::Value;

    fn properties(tool: &Tool) -> Vec<String> {
        tool.input_schema
            .get("properties")
            .and_then(Value::as_object)
            .expect("every tool has properties")
            .keys()
            .cloned()
            .collect()
    }

    /// A host hashes these definitions, so a tool that appears or changes name
    /// is a release event. The set is exactly the plan's five.
    #[test]
    fn the_surface_is_exactly_the_five_tools_the_plan_names() {
        let tools = [
            super::open(),
            super::read(),
            super::find(),
            super::click(),
            super::type_into(),
        ];
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_ref()).collect();
        assert_eq!(
            names,
            ["browser_open", "browser_read", "browser_find", "browser_click", "browser_type"]
        );
    }

    /// Enter is decided in code. A `submit` tool would hand that decision back
    /// to the model, and a wrong guess is a message sent to a stranger.
    #[test]
    fn no_tool_offers_a_submit_and_no_tool_is_given_a_free_text_it_does_not_use() {
        assert_eq!(properties(&super::open()), ["url"]);
        assert_eq!(properties(&super::read()), ["page"]);
        assert_eq!(properties(&super::find()), ["text"]);
        assert_eq!(properties(&super::click()), ["ref"]);
        assert_eq!(properties(&super::type_into()).len(), 2);
    }

    #[test]
    fn every_tool_takes_nothing_it_does_not_name() {
        for tool in [super::open(), super::read(), super::find(), super::click(), super::type_into()] {
            let additional = tool.input_schema.get("additionalProperties");
            assert_eq!(additional, Some(&Value::Bool(false)), "{}", tool.name);
        }
    }
}