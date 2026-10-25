//! The six tool definitions a host pins a hash of. They live apart from the code
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
computer's own network is opened. Build the address as a whole URL — the scheme, \
the host, the path — with the spaces written as %20 and the other characters \
percent-encoded. If you know only the name of a place or a service and not its \
address, say so and ask the person for the exact address: an address you made up \
is a page nobody asked for, and it will not open. Read-only.",
        schema(json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The address to open, with or without https://. A whole URL, with the spaces written as %20."
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
it. **A page may be longer than the answer**: the answer says which lines it \
carries and how many lines the page has, and to go on read the lines that \
follow with from — the number the answer ends at. Reading the same lines \
again is refused: the text is already yours. Use browser_find to search the \
whole page rather than reading it line by line. Read-only.",
        schema(json!({
            "type": "object",
            "properties": {
                "from": {
                    "type": "integer",
                    "minimum": 0,
                    "description": "The line to start from. Zero is the first line of the page."
                },
                "page": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Which window of a long page to return, counting from 1. The answer names the lines it carries; from is the way to go on."
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
would submit a non-GET form, the request is held and the person is shown what it \
carries: the call answers \"awaiting confirm\" with an id, and whether it goes \
is their decision, not yours. The page stays readable while they decide. \
Never try to answer an id yourself, and never send the same request another \
way. Fetch/XHR requests follow normal browser behavior, subject to the \
typed-secret checks.",
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
themselves. If the fill or the Enter submits a non-GET form, the request is held and \
the person decides: the call answers \"awaiting confirm\" with an id, and never \
waits. Fetch/XHR requests follow normal browser behavior, subject to the \
typed-secret checks.",
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

/// **The picture of the page this conversation is driving.**
///
/// **A model tool, and the sixth one.** The phone's preview stays host-only:
/// that picture is the person's screen and goes to the phone that asked for
/// it. This one is offered to a model in the turns that may see one, and it
/// is the same picture — the viewport as it is now, for the conversation that
/// owns the page.
///
/// **The description is the model's only word about it, so it says what the
/// picture is.** A photograph of the viewport is not the page's text: a model
/// that believes it is reading the page's words will say the page said
/// something it did not.
pub(crate) fn screenshot() -> Tool {
    Tool::new(
        "browser_screenshot",
        "Take one picture of the page this conversation is driving, and look at it. The \
answer is a photograph of the viewport as it is now — the window as the person would see \
it, not the page's text. Use it to get your bearings on the page, to check what the \
page's own words do not say (a price, a total, an error message, whether a form is full \
or half filled), and to see what is on the screen when reading the text is not enough. \
The picture belongs to the conversation that opened the page: a page that is not this \
conversation's is refused. Nothing is written and nothing is sent — this is a look, not \
a step.",
        schema(json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        })),
    )
    .with_annotations(read_only())
}

/// Every tool a **model** may call, in the order `tools/list` returns them.
///
/// Public because the app pins these against `src/browser/tool_pins.json` and
/// the host has to reach the same definitions to compute the pins. The
/// host-only tools below are answered by this server and are deliberately not in
/// this list: they are how a person answers, and a model that could answer its
/// own confirm would be a person asked nothing.
pub fn tool_definitions() -> Vec<Tool> {
    vec![open(), read(), find(), click(), type_into(), screenshot()]
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

/// **The phone's preview of the page.** One JPEG of the page this browser is
/// showing, for the conversation that owns it.
///
/// **Host-only, and never in `tools/list`.** The picture is the person's page:
/// it goes to the phone that asked for it and to nothing else, and a model
/// that could ask for one would be a model reading the person's screen.
///
/// The conversation is named by the host, not by the phone: the host knows
/// which device authenticated and asks for that device's page.
pub(crate) fn preview() -> Tool {
    Tool::new(
        "browser_preview",
        "Take one picture of the page this browser is showing, for the conversation that owns it. \
The answer is a JPEG, base64, with the host it was taken on and the moment it was taken; a page \
that is not this conversation's is refused. Host-only.",
        schema(json!({
            "type": "object",
            "properties": {
                "conversation": {
                    "type": "string",
                    "description": "The conversation asking for the picture."
                }
            },
            "required": ["conversation"],
            "additionalProperties": false
        })),
    )
    .with_annotations(read_only())
}

/// **The end of the turn that was driving the page.** The claim on the page
/// belongs to the turn that opened it, and it is that turn's end — however it
/// ended — that lets it go, so a page whose turn is over is open to the next
/// one.
///
/// **Host-only, and named by the host**: a model has no turn to end, and a
/// model that could release another conversation's page would take the window
/// away from the turn that holds it.
pub(crate) fn release() -> Tool {
    Tool::new(
        "browser_release",
        "Let this conversation's claim on the page go: the turn that opened it has ended, and the \
page is left belonging to nobody, open to whoever drives it next. A page that is not this \
conversation's is left exactly as it is. Host-only.",
        schema(json!({
            "type": "object",
            "properties": {
                "conversation": {
                    "type": "string",
                    "description": "The conversation whose turn has ended."
                }
            },
            "required": ["conversation"],
            "additionalProperties": false
        })),
    )
    .with_annotations(read_only())
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
    /// is a release event. The set is the plan's six.
    #[test]
    fn the_surface_is_exactly_the_six_tools_the_plan_names() {
        let tools = [
            super::open(),
            super::read(),
            super::find(),
            super::click(),
            super::type_into(),
            super::screenshot(),
        ];
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_ref()).collect();
        assert_eq!(
            names,
            [
                "browser_open",
                "browser_read",
                "browser_find",
                "browser_click",
                "browser_type",
                "browser_screenshot"
            ]
        );
    }

    /// Enter is decided in code. A `submit` tool would hand that decision back
    /// to the model, and a wrong guess is a message sent to a stranger.
    #[test]
    fn no_tool_offers_a_submit_and_no_tool_is_given_a_free_text_it_does_not_use() {
        assert_eq!(properties(&super::open()), ["url"]);
        assert_eq!(properties(&super::read()), ["from", "page"]);
        assert_eq!(properties(&super::find()), ["text"]);
        assert_eq!(properties(&super::click()), ["ref"]);
        assert_eq!(properties(&super::type_into()).len(), 2);
    }

    #[test]
    fn every_tool_takes_nothing_it_does_not_name() {
        for tool in [
            super::open(),
            super::read(),
            super::find(),
            super::click(),
            super::type_into(),
            super::screenshot(),
        ] {
            let additional = tool.input_schema.get("additionalProperties");
            assert_eq!(additional, Some(&Value::Bool(false)), "{}", tool.name);
        }
    }

    /// **A picture of the person's page is not a tool a model is offered.**
    /// The preview is answered by this server and reached only by the host, so
    /// a model cannot ask for one and cannot see one.
    #[test]
    fn the_preview_is_answered_here_and_never_offered_to_a_model() {
        let definitions = super::tool_definitions();
        let listed: Vec<&str> = definitions.iter().map(|tool| tool.name.as_ref()).collect();
        assert!(!listed.contains(&"browser_preview"), "a model was offered the picture of a page");
        assert_eq!(super::preview().name.as_ref(), "browser_preview");
        assert_eq!(properties(&super::preview()), ["conversation"]);
    }

    /// **The model's picture is a different tool from the phone's.** The phone's
    /// preview is host-only and is never listed; the screenshot is listed, is
    /// named apart from it, and takes nothing the model has to fill in — the
    /// conversation is the host's to name, as it is for every other call.
    ///
    /// **This list is the list `tools/list` answers with**: the handler hands
    /// back these definitions and nothing else, so what is proved here is what
    /// a model is offered.
    #[test]
    fn the_screenshot_is_listed_and_is_not_the_phone_s_preview() {
        let definitions = super::tool_definitions();
        let listed: Vec<&str> = definitions.iter().map(|tool| tool.name.as_ref()).collect();
        assert!(listed.contains(&"browser_screenshot"), "the model was offered no picture");
        assert_ne!(super::screenshot().name.as_ref(), super::preview().name.as_ref());
        assert!(properties(&super::screenshot()).is_empty(), "the model has nothing to name");
        // **The description is the model's only word about it**, so it has to
        // say what the picture is: a photograph of the viewport, and when to
        // take one.
        let screenshot = super::screenshot();
        let description = screenshot.description.as_deref().unwrap_or_default();
        assert!(description.contains("photograph of the viewport"), "{description}");
        assert!(description.contains("get your bearings on the page"), "{description}");
    }
}