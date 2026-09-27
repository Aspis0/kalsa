use super::{
    excluded, excluded_in, rows, usable, usable_in, DenseEquivalent, Licence, Standing,
    CATALOG, DOWNLOADABLE,
};
use crate::footprint::ASSUMED_KV_BYTES_PER_TOKEN;

#[test]
fn a_research_only_licence_never_reaches_the_chooser_and_keeps_its_reason() {
    // The gate, on a row this test writes: no shipped row carries a
    // research-only licence today, so the refusal itself is pinned with a
    // fixture — refused rows stay off the menu, and the reason survives the
    // filter for the page that shows it.
    let clean = DOWNLOADABLE[0];
    let mut refused = DOWNLOADABLE[0];
    refused.model.repo = "test/research-only";
    refused.model.licence = Licence::Blocked {
        id: "researchrail",
        reason: "research only: a paid fine-tune of this base would not be licit",
    };
    assert!(!refused.model.is_usable(), "a research-only licence refuses");

    let menu: Vec<&str> = usable_in(&[clean, refused])
        .map(|row| row.entry().repo)
        .collect();
    assert_eq!(
        menu,
        vec![clean.model.repo],
        "the refused row reached the chooser"
    );
    let reasons: Vec<(&str, &str)> = excluded_in([clean.model, refused.model].iter())
        .map(|(entry, reason)| (entry.repo, reason))
        .collect();
    assert_eq!(
        reasons,
        vec![( "test/research-only", "research only: a paid fine-tune of this base would not be licit")],
        "the refusal carries its reason"
    );
    assert_eq!(
        excluded().count(),
        0,
        "no shipped row is refused today"
    );
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
    // Every shipped row carries its own per-token figure today, so the
    // fixture takes it away — the gate is about a row with no measurement.
    row.kv_bytes_per_token = None;
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
    assert!(
        clean.model.is_usable(),
        "the template row itself must be usable, or this test diagnoses the wrong row"
    );
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
fn the_undercount_flag_agrees_with_a_carried_measurement() {
    // Measured rows only: a measurement above the constant is what "the
    // assumption under-counts" means, so the flag must be set; below it,
    // there is nothing to flag. Rows carrying no measurement are
    // unconstrained — flagged and unmeasured is the gate's own
    // excluded-until-measured state (`standing()`, exercised by the gate
    // test above). Holds trivially today — the only measurement sits below
    // the constant with the flag false — and the next measured row added
    // is what this pins.
    for entry in rows() {
        let Some(bytes) = entry.kv_bytes_per_token else {
            continue;
        };
        assert_eq!(
            entry.kv_assumption_undercounts,
            bytes > ASSUMED_KV_BYTES_PER_TOKEN,
            "{}: kv_assumption_undercounts must be set exactly when the carried measurement exceeds the assumption",
            entry.repo
        );
    }
}

#[test]
fn every_measured_decode_names_its_machine_and_date() {
    // Measured on the M1 Max, on the path the row will decode
    // on: the figure and the machine travel together, and the backend
    // gate means a different machine is never told this one's speed.
    let measured: Vec<_> = DOWNLOADABLE
        .iter()
        .filter_map(|row| row.model.measured_decode.map(|measured| (row.model.repo, measured)))
        .collect();
    assert!(
        !measured.is_empty(),
        "the catalog still carries a measurement taken on the real engine"
    );
    for (repo, measured) in measured {
        assert!(measured.tokens_per_second > 0.0, "{repo}");
        assert_eq!(measured.backend, kalsa_probe::Backend::Metal, "{repo}");
        assert!(
            measured.bandwidth_bytes_per_second >= 100.0e9,
            "{repo}: the rate must record the bandwidth it was measured at, or it \
             cannot be judged against this machine"
        );
        assert!(measured.measured_on.contains("M1 Max"), "{repo}: {}", measured.measured_on);
        assert!(
            measured.measured_on.contains("2026-"),
            "{repo}: {}",
            measured.measured_on
        );
    }
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
            ("google/gemma-4-26B-A4B-it", "Google Gemma 4 26B"),
            ("google/gemma-4-E4B-it", "Google Gemma 4 E4B"),
            ("Qwen/Qwen3.6-35B-A3B", "Alibaba Qwen 3.6"),
            ("google/gemma-4-12B-it", "Google Gemma 4 12B"),
            // One name for the two compressions of one model: the name rule
            // above bans the quantisation from it, and the card tells the
            // two apart by the file's size.
            ("LiquidAI/LFM2.5-2.6B", "Liquid LFM 2.5"),
            ("LiquidAI/LFM2.5-2.6B", "Liquid LFM 2.5"),
            ("Qwen/Qwen3.8-27B", "Alibaba Qwen 3.8"),
        ]
    );
}

#[test]
fn every_row_passes_the_axes_and_the_floor() {
    for entry in rows() {
        let total = entry.parameters.total().count();
        let active = entry.parameters.active().count();
        assert!(
            total >= 2_500_000_000,
            "{} is under the 2.5B floor — the smallest row the catalog ships \
             is LFM2.5-2.6B at 2.69B dense",
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
            "google/gemma-4-26B-A4B-it-qat-q4_0-gguf",
            "unsloth/gemma-4-E4B-it-GGUF",
            "unsloth/Qwen3.6-35B-A3B-GGUF",
            "bartowski/gemma-4-12B-it-GGUF",
            "LiquidAI/LFM2.5-2.6B-GGUF",
            "LiquidAI/LFM2.5-2.6B-GGUF",
            "unsloth/Qwen3.8-27B-GGUF",
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
    let urls: Vec<String> = DOWNLOADABLE
        .iter()
        .filter(|row| row.model.repo == "LiquidAI/LFM2.5-2.6B")
        .map(|row| row.source.url())
        .collect();
    assert_eq!(urls.len(), 2, "the row's two files are pinned");
    assert_eq!(
        urls[0],
        "https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF/resolve/e7caca5d835a3901a8e0d63e94009429bafafdfc/LFM2.5-2.6B-Q8_0.gguf"
    );
    assert_eq!(
        urls[1],
        "https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF/resolve/e7caca5d835a3901a8e0d63e94009429bafafdfc/LFM2.5-2.6B-F16.gguf"
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
            ("google/gemma-4-26B-A4B-it", 14_439_363_584),
            ("google/gemma-4-E4B-it", 4_977_171_584),
            ("Qwen/Qwen3.6-35B-A3B", 22_134_528_992),
            ("google/gemma-4-12B-it", 7_662_533_088),
            ("LiquidAI/LFM2.5-2.6B", 2_874_779_648),
            ("LiquidAI/LFM2.5-2.6B", 5_403_158_528),
            ("Qwen/Qwen3.8-27B", 16_464_440_224),
        ]
    );
}

#[test]
fn dense_equivalents_carry_only_published_comparisons() {
    // No shipped row publishes a same-recipe dense comparison today, so the
    // shape runs on a fixture: the note and the citable source are what make
    // the figure evidence rather than a claim, and every shipped row records
    // the honest None — nothing published, not a weak model.
    let mut row = DOWNLOADABLE[0].model;
    assert!(
        row.dense_equivalent.is_none(),
        "the template row publishes nothing"
    );
    row.dense_equivalent = Some(DenseEquivalent {
        parameters: 3_000_000_000,
        note: "close to it: above on GSM8K, below on BBH",
        source: "the publisher's model card, accessed 2026-09-14",
    });
    let equivalent = row.dense_equivalent.expect("set above");
    assert!(equivalent.parameters > 0);
    assert!(!equivalent.note.is_empty());
    assert!(
        equivalent.source.contains("accessed 2026-09-14"),
        "{}",
        equivalent.source
    );
    for entry in rows() {
        assert!(
            entry.dense_equivalent.is_none(),
            "{}: nothing published a dense comparison for it",
            entry.repo
        );
    }
}

#[test]
fn the_lfm_row_is_usable_and_carries_its_condition() {
    let lfm = DOWNLOADABLE
        .iter()
        .find(|row| row.model.repo == "LiquidAI/LFM2.5-2.6B")
        .expect("the LFM row is pinned");
    assert!(
        lfm.model.is_usable(),
        "a condition on the shipper is not a refusal of the row"
    );
    assert_eq!(lfm.model.licence.refusal(), None);
    assert_eq!(lfm.model.licence.id(), "lfm1.0");
    assert_eq!(
        lfm.model.licence.condition(),
        Some("commercial use only for entities under $10M annual revenue"),
    );
    assert!(usable().any(|entry| entry.entry().repo == "LiquidAI/LFM2.5-2.6B"));
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
