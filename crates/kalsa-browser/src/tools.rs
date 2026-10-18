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
        "Click one element of the page, by the ref a read printed. If the click \
would send something to the site, the request is held and the person is shown \
what it carries: the call answers \"awaiting confirm\" with an id, and whether \
it goes is their decision, not yours. The page stays readable while they decide. \
Never try to answer an id yourself, and never send the same request another way.",
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
afterwards only on a one-line field that is not inside a form — a search field \
keeps Enter either way — and it is not something you choose. Any other field inside \
a form is filled and left alone: the form goes when its own submit button is \
clicked, so fill its fields first and then click that. A textarea, an editable \
block, a checkbox, a radio, a date or a range field is filled and left alone \
too. A password field is never filled: ask the person to type it in the window \
themselves. If the fill or the Enter would send something to the site, the request \
is held and the person decides: the call answers \"awaiting confirm\" with an id, \
and never waits.",
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

/// Every tool a **model** may call, in the order `tools/list` returns them.
///
/// Public because the app pins these against `src/browser/tool_pins.json` and
/// the host has to reach the same definitions to compute the pins. The
/// host-only tools below are answered by this server and are deliberately not in
/// this list: they are how a person answers, and a model that could answer its
/// own confirm would be a person asked nothing.
pub fn tool_definitions() -> Vec<Tool> {
    vec![open(), read(), find(), click(), type_into()]
}

/// Everything waiting for the person, oldest first.
///
/// **Host-only.** It is answered by the server and is not in
/// [`tool_definitions`], so `tools/list` never offers it and a model has no way
/// to ask for a card it would then be able to answer. The whole list is what the
/// window draws, so it does not have to be told an id to find one — and a card
/// that has been answered or has expired is simply no longer on it.
pub(crate) fn waiting() -> Tool {
    Tool::new(
        "browser_waiting",
        "Every request waiting for the person, oldest first: what each would send, as fields, with \
any secret already masked, and each field's label where the page gave one. Host-only: a model \
is never offered this.",
        schema(json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        })),
    )
}

/// **Pausa.** Kalsa stops driving the browser until the person says otherwise.
///
/// **Host-only, like every other thing here that a person presses.** A model
/// that could pause itself could stop being answerable to the person who has to
/// decide about its writes.
///
/// While it is paused: nothing Kalsa does next is acted at all, and **the
/// person's own submissions are not held** — they are acting, not us, and a held
/// navigation freezes the page it is holding. A card already on the window is
/// still answerable: pausing is not declining.
pub(crate) fn pause() -> Tool {
    Tool::new(
        "browser_pause",
        "Stop driving the browser until the person resumes: nothing Kalsa does is acted at, and \
the person's own submissions go through untouched. Host-only.",
        schema(json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        })),
    )
    .with_annotations(read_only())
}

/// **Riprendi.** The browser is driven again, and the page is read fresh so the
/// model is not reasoning about a page it has not seen since the person had it.
pub(crate) fn resume() -> Tool {
    Tool::new(
        "browser_resume",
        "Drive the browser again, and read the page as it is now. Host-only.",
        schema(json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        })),
    )
    .with_annotations(read_only())
}

/// The person's yes: the held request is dispatched as it was written.
///
/// **Host-only**, single-use, and the id is spent before anything is sent.
pub(crate) fn confirm() -> Tool {
    Tool::new(
        "browser_confirm",
        "Allow the held request with this id: it is sent exactly as it would have been. The id is \
spent, whether it was allowed or not, and nothing is ever sent twice. Host-only.",
        schema(json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "The id the awaiting-confirm answer gave." }
            },
            "required": ["id"],
            "additionalProperties": false
        })),
    )
    .with_annotations(writes())
}

/// The person's no: the held request is dropped and the page is as it was.
///
/// **Host-only**, and spends the id in exactly the way `browser_confirm` does.
pub(crate) fn decline() -> Tool {
    Tool::new(
        "browser_decline",
        "Do not allow the held request with this id: nothing is sent and the page is left as it \
is. The id is spent. Host-only.",
        schema(json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "The id the awaiting-confirm answer gave." }
            },
            "required": ["id"],
            "additionalProperties": false
        })),
    )
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