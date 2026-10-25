use kalsa_mcp::pins::Pins;

/// The approved tool definitions, as kalsa-mail declares them.
const CHECKED_IN: &str = include_str!("tool_pins.json");

pub(crate) fn checked_in() -> Pins {
    serde_json::from_str(CHECKED_IN).expect("the checked-in tool pins parse")
}

/// The pins the current tool definitions produce, through kalsa-mcp's digest.
#[cfg(test)]
fn pins_for_definitions() -> Result<Pins, kalsa_mcp::error::Error> {
    let server = kalsa_mcp::server_id::ServerId::new(super::host::MAIL_SERVER)?;
    let mut pins = Pins::default();
    for tool in &kalsa_mail::tools::tool_definitions() {
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
        assert_eq!(live, checked_in(), "the tool definitions changed: run regenerate_tool_pins and review the diff");
    }

    #[test]
    #[ignore = "rewrites src/mail/tool_pins.json; run after a deliberate tool change, then review the diff"]
    fn regenerate_tool_pins() {
        let mut text = serde_json::to_string_pretty(&pins_for_definitions().expect("pins")).expect("serializes");
        text.push('\n');
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/mail/tool_pins.json");
        std::fs::write(path, text).expect("tool_pins.json is writable");
    }
}
