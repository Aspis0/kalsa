use super::{excluded, rows, usable, CATALOG, DOWNLOADABLE};

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
fn the_apertus_row_is_offerable_only_through_its_measured_cache() {
    // Apertus 70B is deeper than the shared 96 KiB constant models: it
    // entered the download table only because its per-token cache was
    // measured from the pinned file's GGUF header (80 layers × 8 KV heads ×
    // 256 elements, one byte each at q8_0). Removing the measurement closes
    // the door again, because the flag records that the constant lies.
    let apertus = DOWNLOADABLE
        .iter()
        .find(|row| row.model.repo.starts_with("swiss-ai/"))
        .expect("apertus is in the download table");
    assert_eq!(apertus.model.kv_bytes_per_token, Some(163_840));
    assert!(apertus.model.is_usable());
    assert!(
        apertus.model.kv_assumption_undercounts,
        "the record stays: the shared constant under-counts this row"
    );
    let mut unmeasured = apertus.model;
    unmeasured.kv_bytes_per_token = None;
    assert!(
        !unmeasured.is_usable(),
        "without the measurement, the assumption is known wrong for this row"
    );
}

#[test]
fn trinitys_measured_decode_names_its_machine() {
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
    // Every other row is unmeasured, and none of them pretends otherwise.
    assert!(rows()
        .filter(|entry| entry.repo != trinity.model.repo)
        .all(|entry| entry.measured_decode.is_none()));
}

#[test]
fn refused_rows_keep_their_reason() {
    let refused: Vec<_> = excluded().collect();
    assert_eq!(refused.len(), 3, "three rows were evaluated and refused");
    assert!(refused.iter().any(|(entry, reason)| {
        entry.repo.starts_with("amd/") && reason.contains("research only")
    }));
    assert!(refused
        .iter()
        .any(|(entry, reason)| entry.repo.contains("gpt-oss") && reason.contains("2025")));
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
            ("inclusionAI/Ling-mini-2.0", "InclusionAI Ling Mini 2.0"),
            ("moonshotai/Moonlight-16B-A3B-Instruct", "Moonshot Moonlight 16B"),
            ("Qwen/Qwen3.6-35B-A3B", "Alibaba Qwen 3.6"),
            ("Qwen/Qwen3-Next-80B-A3B-Instruct", "Alibaba Qwen 3 Next 80B"),
            ("swiss-ai/Apertus-v1.5-70B", "Swiss AI Apertus 1.5"),
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
            "mradermacher/Ling-mini-2.0-GGUF",
            "mmnga/Moonlight-16B-A3B-Instruct-gguf",
            "unsloth/Qwen3.6-35B-A3B-GGUF",
            "Qwen/Qwen3-Next-80B-A3B-Instruct-GGUF",
            "katya228/Apertus-v1.5-70B-text-GGUF",
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
            ("inclusionAI/Ling-mini-2.0", 9_911_575_904),
            ("moonshotai/Moonlight-16B-A3B-Instruct", 10_537_205_632),
            ("Qwen/Qwen3.6-35B-A3B", 22_134_528_992),
            ("Qwen/Qwen3-Next-80B-A3B-Instruct", 48_410_988_384),
            ("swiss-ai/Apertus-v1.5-70B", 43_721_600_512),
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
    // comparison, and Trinity, Ling, Moonlight, Qwen 3.6, Qwen 3 Next and
    // Apertus publish nothing: None is the honest value, and it means
    // nothing was published — not that the model is weak.
    for repo in [
        "LiquidAI/LFM2.5-8B-A1B",
        "arcee-ai/Trinity-Nano-Preview",
        "inclusionAI/Ling-mini-2.0",
        "moonshotai/Moonlight-16B-A3B-Instruct",
        "Qwen/Qwen3.6-35B-A3B",
        "Qwen/Qwen3-Next-80B-A3B-Instruct",
        "swiss-ai/Apertus-v1.5-70B",
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
    assert!(mixtures.contains(&"Qwen/Qwen3-Next-80B-A3B-Instruct"));
    assert!(mixtures.contains(&"inclusionAI/Ling-mini-2.0"));
    assert!(mixtures.contains(&"moonshotai/Moonlight-16B-A3B-Instruct"));
    assert!(!mixtures.contains(&"google/gemma-4-12B-it"));
    assert!(!mixtures.contains(&"swiss-ai/Apertus-v1.5-70B"));
}
