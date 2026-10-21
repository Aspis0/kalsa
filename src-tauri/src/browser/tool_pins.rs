//! The approved tool definitions, as kalsa-browser declares them.
//!
//! The host stores a digest of each tool's name, description and schema, so
//! these six definitions are a contract: a sidecar that answers a tool the
//! app has not heard of is one Kalsa will not call. The pins are checked
//! against the definitions now, so a change to a description cannot pass
//! unnoticed into a later step.

use kalsa_mcp::pins::Pins;

const CHECKED_IN: &str = include_str!("tool_pins.json");

pub(crate) fn checked_in() -> Pins {
    serde_json::from_str(CHECKED_IN).expect("the checked-in tool pins parse")
}

/// The pins the current tool definitions produce, through kalsa-mcp's digest.
#[cfg(test)]
fn pins_for_definitions() -> Result<Pins, kalsa_mcp::error::Error> {
    let server = kalsa_mcp::server_id::ServerId::new(crate::browser::SERVER)?;
    let mut pins = Pins::default();
    for tool in &kalsa_browser::tools::tool_definitions() {
        pins.seed_tool(&server, tool)?;
    }
    Ok(pins)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_checked_in_pins_survive_a_round_trip() {
        let pins = checked_in();
        let stored = serde_json::to_string(&pins).expect("serializes");
        assert_eq!(serde_json::from_str::<Pins>(&stored).expect("parses"), pins);
    }

    #[test]
    fn the_checked_in_pins_match_the_tool_definitions() {
        let live = pins_for_definitions().expect("the definitions pin");
        assert_eq!(
            live,
            checked_in(),
            "the tool definitions changed: run regenerate_tool_pins and review the diff"
        );
    }

    #[test]
    fn the_six_tools_are_the_ones_the_sidecar_declares() {
        // The host namespaces what it registers, so a tool the sidecar calls
        // `browser_open` is pinned as `browser.browser_open`. The plan's own
        // names (`open`, `read`, `find`, `click`, `type`) are a step-3 decision
        // about what the chat is offered; what is pinned here is what exists.
        let declared: Vec<String> = kalsa_browser::tools::tool_definitions()
            .iter()
            .map(|tool| format!("{}.{}", crate::browser::SERVER, tool.name))
            .collect();
        assert_eq!(
            declared,
            [
                "browser.browser_open",
                "browser.browser_read",
                "browser.browser_find",
                "browser.browser_click",
                "browser.browser_type",
                "browser.browser_screenshot",
            ]
        );
    }

    #[test]
    #[ignore = "rewrites src/browser/tool_pins.json; run after a deliberate tool change, then review the diff"]
    fn regenerate_tool_pins() {
        let mut text =
            serde_json::to_string_pretty(&pins_for_definitions().expect("pins")).expect("serializes");
        text.push('\n');
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/browser/tool_pins.json");
        std::fs::write(path, text).expect("tool_pins.json is writable");
    }
}