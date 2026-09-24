use super::{excluded, excluded_in, rows, usable, usable_in, Standing, CATALOG, DOWNLOADABLE};
use crate::footprint::ASSUMED_KV_BYTES_PER_TOKEN;

#[test]
fn the_research_only_row_cannot_reach_the_chooser() {
    assert!(!CATALOG
        .iter()
        .find(|entry| entry.repo.starts_with("amd/"))
        .expect("instella is in the catalog")
        .is_usable());
    assert!(usable().all(|entry| entry.entry().repo != "amd/Instella-MoE-16B-A3B-Think"));
}

#[test]
fn the_chooser_menu_is_the_download_table_and_nothing_else() {
    // The structural guarantee, spelled out: every row the chooser can see
    // is a row of DOWNLOADABLE, which cannot be written without a complete
    // pinned source; and no research row — usable or not — appears in it.
    for entry in usable() {
        assert!(
            DOWNLOADABLE
                .iter()
                .any(|row| row.model.repo == entry.entry().repo),
            "{} reached the chooser from outside the download table",
            entry.entry().repo
        );
    }
    for entry in CATALOG {
        assert!(
            usable().all(|usable| usable.entry().repo != entry.repo),
            "{}: a research row reached the chooser",
            entry.repo
        );
    }
}

#[test]
fn a_row_the_assumption_undercounts_is_offerable_only_through_its_measured_cache() {
    // No shipped row carries the flag today, so the gate runs on a row this
    // test builds from the menu's first entry: with the flag set and no
    // measurement, `standing()` refuses the row — the shared 96 KiB
    // assumption is known wrong for it; the measured figure opens the door;
    // removing the measurement closes it again.
    let mut row = DOWNLOADABLE[0].model;
    assert!(row.is_usable(), "the row starts on the menu");
    row.kv_assumption_undercounts = true;
    assert!(!row.is_usable());
    match row.standing() {
        Standing::Excluded { reason } => assert!(
            reason.contains("96 KiB") && reason.contains("Measure the cache"),
            "{reason}"
        ),
        Standing::Usable => panic!("the flag must keep the row off the assumption"),
    }
    row.kv_bytes_per_token = Some(163_840);
    assert!(row.is_usable(), "the measurement reopens the door");
    row.kv_bytes_per_token = None;
    assert!(
        !row.is_usable(),
        "removing the measurement closes the door again"
    );
}

#[test]
fn a_stale_row_is_off_the_menu_with_its_reason() {
    // No shipped row is stale today, so the gates run over a table this
    // test writes: the clean row is offered and never refused, the same
    // row marked stale never reaches the menu and comes back out of the
    // refusal pass with its own words.
    let clean = DOWNLOADABLE[0];
    let mut stale = DOWNLOADABLE[0];
    stale.model.repo = "test/stale";
    stale.model.stale = Some("superseded in its tier, for the test");
    let table = [clean, stale];

    let menu: Vec<&str> = usable_in(&table).map(|row| row.entry().repo).collect();
    assert_eq!(
        menu,
        vec![clean.model.repo],
        "the stale row reached the menu"
    );

    let refused: Vec<(&str, &str)> = excluded_in(table.iter().map(|row| &row.model))
        .map(|(entry, reason)| (entry.repo, reason))
        .collect();
    assert_eq!(
        refused,
        vec![("test/stale", "superseded in its tier, for the test")],
        "the refusal pass must surface the stale row with its reason"
    );
}

#[test]
fn the_undercount_flag_travels_with_a_measurement_above_the_assumption() {
    // Flag iff the row's own measured figure sits above the shared
    // constant: above the constant is what "the assumption under-counts"
    // means, and below it there is nothing to flag. Holds trivially today
    // — the only measured row sits below the constant with the flag false
    // — and the next row added is what this pins.
    for entry in rows() {
        let measured_above_assumption = entry
            .kv_bytes_per_token
            .is_some_and(|bytes| bytes > ASSUMED_KV_BYTES_PER_TOKEN);
        assert_eq!(
            entry.kv_assumption_undercounts, measured_above_assumption,
            "{}: kv_assumption_undercounts must be set exactly when the measured figure exceeds the assumption",
            entry.repo
        );
    }
}

#[test]
fn every_measured_decode_names_its_machine_and_date() {
    // Measured tonight on the M1 Max, on the path the row will decode
    // on: the figure and the machine travel together, and the backend
    // gate means a different machine is never told this one's speed.
    let trinity = DOWNLOADABLE
        .iter()
        .find(|row| row.model.repo == "arcee-ai/Trinity-Nano-Preview")
        .expect("trinity is in the download table");
    let measured = trinity
        .model
        .measured_decode
        .expect("trinity was measured on the real engine");
    assert_eq!(measured.tokens_per_second, 62.7);
    assert_eq!(measured.backend, kalsa_probe::Backend::Metal);
    assert!(
        measured.measured_on.contains("M1 Max"),
        "{}",
        measured.measured_on
    );
    assert!(
        measured.measured_on.contains("2026-09-14"),
        "{}",
        measured.measured_on
    );
    assert!(rows().all(|entry| {
        entry.measured_decode.is_none_or(|measured| {
            let (machine, _) = measured
                .measured_on
                .split_once(" (")
                .expect("a measurement names its machine");
            let date = measured
                .measured_on
                .rsplit_once(", ")
                .map(|(_, date)| date)
                .expect("a measurement names its date");
            let mut date_parts = date.split('-');
            let year = date_parts.next().unwrap_or_default();
            let month = date_parts.next().unwrap_or_default();
            let day = date_parts.next().unwrap_or_default();
            !machine.trim().is_empty()
                && year.len() == 4
                && year.starts_with("20")
                && year.bytes().all(|byte| byte.is_ascii_digit())
                && month.len() == 2
                && month.bytes().all(|byte| byte.is_ascii_digit())
                && day.len() == 2
                && day.bytes().all(|byte| byte.is_ascii_digit())
                && date_parts.next().is_none()
        })
    }));
}

#[test]
fn refused_rows_keep_their_reason() {
    let refused: Vec<_> = excluded().collect();
    assert_eq!(
        refused.len(),
        1,
        "one row is refused: the research-only licence"
    );
    assert!(refused.iter().any(|(entry, reason)| {
        entry.repo.starts_with("amd/") && reason.contains("research only")
    }));
}

#[test]
fn every_row_has_a_name_a_person_can_say() {
    // Vendor plus family: the only model identity the user ever sees. The
    // repo path, the quantisation, the parameter suffixes and the variant
    // codes are ours, and none of them may appear in a display name.
    for entry in rows() {
        let name = entry.display_name;
        assert!(!name.is_empty(), "{} has no name", entry.repo);
        assert!(!name.contains('/'), "{name} leaks a repo path");
        assert!(!name.contains('_'), "{name} leaks a code");
        assert!(!name.contains("Q4"), "{name} leaks a quantisation");
        assert!(!name.contains("instruct"), "{name} leaks a variant code");
        assert!(
            !name.contains("A3B") && !name.contains("A4B"),
            "{name} leaks an active-parameter suffix"
        );
    }
    // The chooser's menu, as the interface shows it.
    let named: Vec<(&str, &str)> = DOWNLOADABLE
        .iter()
        .map(|row| (row.model.repo, row.model.display_name))
        .collect();
    assert_eq!(
        named,
        vec![
            ("LiquidAI/LFM2.5-8B-A1B", "Liquid LFM 2.5"),
            ("microsoft/Phi-mini-MoE-instruct", "Microsoft Phi Mini"),
            ("ibm-granite/granite-4.0-h-tiny", "IBM Granite 4 Tiny"),
            ("arcee-ai/Trinity-Nano-Preview", "Arcee Trinity Nano"),
            ("google/gemma-4-26B-A4B-it", "Google Gemma 4 26B"),
            ("google/gemma-4-E4B-it", "Google Gemma 4 E4B"),
            ("Qwen/Qwen3.6-35B-A3B", "Alibaba Qwen 3.6"),
            ("google/gemma-4-12B-it", "Google Gemma 4 12B"),
        ]
    );
}

#[test]
fn every_row_passes_the_axes_and_the_floor() {
    for entry in rows() {
        let total = entry.parameters.total().count();
        let active = entry.parameters.active().count();
        assert!(
            total >= 4_000_000_000,
            "{} is under the 4B floor",
            entry.repo
        );
        assert!(active <= total, "{} has active > total", entry.repo);
        assert!(entry.weights_bytes > 0);
        assert!(entry.mmproj_bytes.is_none_or(|bytes| bytes > 0));
    }
}

#[test]
fn only_the_download_rows_know_where_their_weights_live() {
    // A repo name written from memory is how a download 404s a week later:
    // the research rows never asked the API, so they carry no address at
    // all — and no address is exactly what keeps them out of the chooser.
    let pinned: Vec<&str> = DOWNLOADABLE
        .iter()
        .map(|row| row.source.repo)
        .collect();
    assert_eq!(
        pinned,
        [
            "liodon-ai/LFM2.5-8B-A1B-imatrix-GGUF",
            "smarttasks/Phi-mini-MoE-instruct-GGUF",
            "ibm-granite/granite-4.0-h-tiny-GGUF",
            "arcee-ai/Trinity-Nano-Preview-GGUF",
            "google/gemma-4-26B-A4B-it-qat-q4_0-gguf",
            "unsloth/gemma-4-E4B-it-GGUF",
            "unsloth/Qwen3.6-35B-A3B-GGUF",
            "bartowski/gemma-4-12B-it-GGUF",
        ]
    );
}

#[test]
fn every_source_is_pinned_and_consistent_with_its_row() {
    // The digest and the size are the download's promises. The digest must
    // be a sha256 — 64 lowercase hex characters — and the size must be the
    // file this row describes: a mismatch here is a copy-paste between
    // rows, which is exactly how an unverified download would sneak
    // through.
    for row in DOWNLOADABLE {
        let source = row.source;
        let lowercase_hex = |s: &str| {
            s.chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        };
        assert_eq!(
            source.sha256.len(),
            64,
            "{}: a sha256 is 64 characters",
            source.sha256
        );
        assert!(
            lowercase_hex(source.sha256),
            "{}: a sha256 is lowercase hex",
            source.sha256
        );
        assert_eq!(
            source.commit.len(),
            40,
            "{}: a git commit is 40 characters",
            source.commit
        );
        assert!(
            lowercase_hex(source.commit),
            "{}: a commit is lowercase hex",
            source.commit
        );
        assert!(
            source.file.ends_with(".gguf"),
            "{}: the pinned file is the gguf itself",
            source.file
        );
        assert!(!source.repo.is_empty(), "a source names its repo");
        assert_eq!(
            source.bytes, row.model.weights_bytes,
            "{}: the pinned file's size must be the row's weight size",
            row.model.repo
        );
    }
}

#[test]
fn a_source_serves_its_exact_file_at_its_commit() {
    // The URL is an address: repo, pinned commit, exact file name —
    // nothing derived from a quant string, nothing that 404s when a
    // publisher renames a file in a later commit.
    let lfm = DOWNLOADABLE
        .iter()
        .find(|row| row.model.repo == "LiquidAI/LFM2.5-8B-A1B")
        .expect("the LFM row is in the download table");
    assert_eq!(
        lfm.source.url(),
        "https://huggingface.co/liodon-ai/LFM2.5-8B-A1B-imatrix-GGUF/resolve/dc77c293fd6f9107db3c9cecfb19befe2ae49755/LFM2.5-8B-A1B-IQ4_XS.gguf"
    );
}

#[test]
fn the_download_rows_carry_their_exact_bytes() {
    // Figures verified against the Hugging Face response headers
    // (`x-linked-size`) for the pinned file of each repo, verbatim:
    // rounding a measurement would be throwing the measurement away.
    let bytes: Vec<(&str, u64)> = DOWNLOADABLE
        .iter()
        .map(|row| (row.model.repo, row.model.weights_bytes))
        .collect();
    assert_eq!(
        bytes,
        vec![
            ("LiquidAI/LFM2.5-8B-A1B", 4_588_301_888),
            ("microsoft/Phi-mini-MoE-instruct", 4_616_170_016),
            ("ibm-granite/granite-4.0-h-tiny", 4_230_976_352),
            ("arcee-ai/Trinity-Nano-Preview", 3_786_957_088),
            ("google/gemma-4-26B-A4B-it", 14_439_363_584),
            ("google/gemma-4-E4B-it", 4_977_171_584),
            ("Qwen/Qwen3.6-35B-A3B", 22_134_528_992),
            ("google/gemma-4-12B-it", 7_662_533_088),
        ]
    );
}

#[test]
fn dense_equivalents_carry_only_published_comparisons() {
    // The two rows whose publisher compared them to a same-recipe dense
    // model, with the source that makes the figure citable.
    for repo in [
        "ibm-granite/granite-4.0-h-tiny",
        "microsoft/Phi-mini-MoE-instruct",
    ] {
        let row = DOWNLOADABLE
            .iter()
            .find(|row| row.model.repo == repo)
            .expect("row is in the download table");
        let equivalent = row
            .model
            .dense_equivalent
            .unwrap_or_else(|| panic!("{repo} has a published dense equivalent"));
        assert!(equivalent.parameters > 0);
        assert!(!equivalent.note.is_empty());
        let source = equivalent.source;
        assert!(source.contains("accessed 2026-09-14"), "{source}");
    }
    // LFM publishes vendor-to-vendor tables, not a same-recipe dense LFM
    // comparison, and Trinity and Qwen 3.6 publish nothing: None is the
    // honest value, and it means nothing was published — not that the
    // model is weak.
    for repo in [
        "LiquidAI/LFM2.5-8B-A1B",
        "arcee-ai/Trinity-Nano-Preview",
        "Qwen/Qwen3.6-35B-A3B",
    ] {
        let row = DOWNLOADABLE
            .iter()
            .find(|row| row.model.repo == repo)
            .expect("row is in the download table");
        assert!(row.model.dense_equivalent.is_none(), "{repo}");
    }
}

#[test]
fn the_lfm_row_is_usable_and_carries_its_condition() {
    let lfm = DOWNLOADABLE
        .iter()
        .find(|row| row.model.repo == "LiquidAI/LFM2.5-8B-A1B")
        .expect("lfm row is in the download table");
    assert!(
        lfm.model.is_usable(),
        "a condition on the shipper is not a refusal of the row"
    );
    assert_eq!(lfm.model.licence.refusal(), None);
    assert_eq!(
        lfm.model.licence.condition(),
        Some("commercial use only for entities under $10M annual revenue"),
    );
    assert!(usable().any(|entry| entry.entry().repo == lfm.model.repo));
}

#[test]
fn the_mixture_rows_are_the_ones_with_a_gap() {
    let mixtures: Vec<_> = rows()
        .filter(|entry| entry.parameters.is_mixture())
        .map(|entry| entry.repo)
        .collect();
    assert!(mixtures.contains(&"Qwen/Qwen3.6-35B-A3B"));
    assert!(!mixtures.contains(&"google/gemma-4-12B-it"));
}

#[test]
fn every_download_row_carries_the_context_its_header_declares() {
    // A row whose file was fetched has a header, and the header says what the
    // publisher trained it for. Without that figure the budget funds a window
    // out of memory alone — 547,503 tokens for a model trained at 262,144 —
    // and the model answers worse for it. A research row has no file and so no
    // header: None is the honest value there, never a guess.
    for row in DOWNLOADABLE {
        let tokens = row
            .model
            .trained_context_tokens
            .unwrap_or_else(|| panic!("{}: read context_length from its GGUF", row.model.repo));
        assert!(tokens >= 4_096, "{}: {tokens} is not a context", row.model.repo);
    }
    for entry in CATALOG {
        assert!(
            entry.trained_context_tokens.is_none(),
            "{}: a research row has no header to have read",
            entry.repo
        );
    }
}
