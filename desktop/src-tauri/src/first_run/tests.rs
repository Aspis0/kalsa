use super::*;

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "kalsa-brain-first-run-{name}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("mkdir");
    dir
}

#[test]
fn a_turn_on_with_nothing_chosen_is_refused_before_it_walks() {
    let dir = scratch("require-choice");
    let state_file = dir.join("server.state");
    assert!(
        matches!(
            require_choice(&state_file, false),
            Err(StartupFailure::AwaitingChoice)
        ),
        "no stored choice and no override: refused"
    );
    assert!(
        require_choice(&state_file, true).is_ok(),
        "a dev override owns its bytes"
    );
    let chosen = crate::options::LaunchOverrides {
        model: Some(crate::startup::model_token(
            kalsa_catalog::rows()
                .next()
                .expect("the catalog carries rows"),
        )),
        ..Default::default()
    };
    crate::options::save(&state_file, chosen).expect("save");
    assert!(
        require_choice(&state_file, false).is_ok(),
        "a stored choice walks"
    );
}

#[test]
fn the_choice_that_left_the_catalog_reads_as_no_choice() {
    // A user who picked Arcee Trinity Nano before it left the catalog holds
    // exactly this token — `startup::model_token`'s answer for
    // `arcee-ai/Trinity-Nano-Preview` / "Arcee Trinity Nano" / Q4_K_M /
    // 3_786_957_088 bytes. No row answers to it now, so the stored choice is
    // no choice: the turn-on waits for a pick, and the home page owes that
    // user the first run again.
    let dir = scratch("removed-row");
    let state_file = dir.join("server.state");
    let chosen = crate::options::LaunchOverrides {
        model: Some("625b43dfded00c02".to_string()),
        ..Default::default()
    };
    crate::options::save(&state_file, chosen).expect("save");
    assert!(stored_choice(&state_file).is_none(), "no row answers to it");
    assert!(
        matches!(
            require_choice(&state_file, false),
            Err(StartupFailure::AwaitingChoice)
        ),
        "the turn-on waits for a pick"
    );
    assert!(
        require_choice(&state_file, true).is_ok(),
        "a dev override owns its bytes"
    );
}

#[test]
fn a_token_no_row_answers_to_is_no_choice() {
    // A choice that has gone stale reads as the first run again: the walk
    // must not start on a token nothing resolves, or the home page would
    // show a choice the walk would refuse.
    let dir = scratch("stale-token");
    let state_file = dir.join("server.state");
    let stale = crate::options::LaunchOverrides {
        model: Some("not-a-token".to_string()),
        ..Default::default()
    };
    crate::options::save(&state_file, stale).expect("save");
    assert!(
        matches!(
            require_choice(&state_file, false),
            Err(StartupFailure::AwaitingChoice)
        ),
        "a token nothing answers to is refused like no choice at all"
    );
    assert!(
        require_choice(&state_file, true).is_ok(),
        "a dev override owns its bytes"
    );
}

#[test]
fn the_suggestions_carry_each_options_own_comparison_code() {
    // The page names the cards from the second option's code, so each code
    // must ride its own row to the wire, in order — and a refusal its own.
    let dir = scratch("suggest-codes");
    let mut rows = kalsa_catalog::rows();
    let first = rows.next().expect("the catalog has rows");
    let second = rows
        .find(|row| startup::model_token(row) != startup::model_token(first))
        .expect("a second row");
    let answer = suggest(
        vec![(first, Some("model.reason.pick".into())), (second, Some("model.reason.quicker".into()))],
        None,
        None,
        &dir,
    );
    let json = serde_json::to_value(&answer).expect("serialise");
    assert_eq!(json["options"][0]["id"], startup::model_token(first));
    assert_eq!(json["options"][0]["reason_code"], "model.reason.pick");
    assert_eq!(json["options"][1]["id"], startup::model_token(second));
    assert_eq!(json["options"][1]["reason_code"], "model.reason.quicker");
    assert!(json.get("refusal_code").is_none(), "no refusal, no code");

    let refused = suggest(vec![], Some("Nothing fits.".into()), Some("catalog.nothing_fits".into()), &dir);
    let json = serde_json::to_value(&refused).expect("serialise");
    assert_eq!(json["options"], serde_json::json!([]));
    assert_eq!(json["refusal_code"], "catalog.nothing_fits");
}
