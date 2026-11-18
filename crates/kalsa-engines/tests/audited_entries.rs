use kalsa_engines::{improvement_kinds, parse, Catalog, Engine, ImprovementKind};

fn shipped() -> Catalog {
    let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../catalog/engines.toml")).expect("catalog is present");
    parse(&text).expect("the shipped catalog is valid")
}

fn entry<'a>(catalog: &'a Catalog, id: &str) -> &'a Engine {
    catalog.engine.iter().find(|engine| engine.id == id).unwrap_or_else(|| panic!("{id} is listed"))
}

#[test]
fn memory_and_quality_entries_carry_their_before_after_and_their_cost() {
    let catalog = shipped();
    for (id, kind, before, after) in [
        ("swiftlm", ImprovementKind::LessMemory, 20.2, 5.7),
        ("vmlx", ImprovementKind::LessMemory, 17408.0, 9529.0),
        ("dmlx", ImprovementKind::FasterStart, 0.91, 0.28),
        ("buun-llama-cpp", ImprovementKind::Quality, 0.00279, 0.00163),
    ] {
        let item = entry(&catalog, id).improvement.iter().find(|item| item.kind == kind).expect(id);
        assert_eq!((item.before, item.after), (Some(before), Some(after)), "{id}");
    }
    for id in ["swiftlm", "vmlx", "buun-llama-cpp"] {
        assert!(entry(&catalog, id).improvement[0].tradeoff.is_some(), "{id} declares the cost its source states");
    }
}

#[test]
fn speed_entries_are_benchmark_rows_with_the_audited_figures() {
    let catalog = shipped();
    let figures = |id: &str| {
        let benchmark = &entry(&catalog, id).benchmark[0];
        (benchmark.decode_tok_s, benchmark.baseline_decode_tok_s, benchmark.prefill_tok_s, benchmark.baseline_prefill_tok_s)
    };
    assert_eq!(figures("dmlx"), (Some(43.2), Some(36.1), None, None));
    assert_eq!(figures("generelschwerz-llama-cpp"), (Some(146.77), Some(64.08), None, None));
    assert_eq!(figures("turbo-tan-llama-cpp-tq3"), (None, None, Some(919.63), Some(359.94)));
    assert_eq!(figures("engramhalo"), (Some(39.3), Some(24.4), None, None));
    assert!(entry(&catalog, "generelschwerz-llama-cpp").benchmark[0].note.as_deref().is_some_and(|note| note.contains("one-run observation")));
}

#[test]
fn the_splash_port_declares_new_hardware_and_is_not_called_faster() {
    let catalog = shipped();
    let port = entry(&catalog, "paperniuk-splash");
    assert_eq!(improvement_kinds(port), [ImprovementKind::NewHardware]);
    assert_eq!(port.upstream.as_deref(), Some("incoai/splash"));
    assert!(port.benchmark.is_empty());
}

#[test]
fn the_rdna_fork_is_a_format_comparison_with_its_quality_cost_and_no_readme_percentages() {
    let catalog = shipped();
    let fork = entry(&catalog, "selfref-llama-cpp-rdna");
    let row = &fork.benchmark[0];
    assert_eq!((row.decode_tok_s, row.baseline_decode_tok_s), (Some(12.56), Some(11.71)));
    assert!(row.source.contains("5e085d123eead2e89b5c19f824fccb05727da6a2/ROCMFPX-NOTES.md"));
    let note = row.note.as_deref().expect("the row carries its caveat");
    assert!(note.contains("2026-08-21") && note.contains("baseline engine is not stated") && note.contains("5.8965 to 5.9842 (+1.5%"));
    let item = &fork.improvement[0];
    assert_eq!((item.kind, item.before, item.after), (ImprovementKind::LessMemory, Some(16.69), Some(14.63)));
    assert!(item.tradeoff.as_deref().is_some_and(|text| text.contains("5.8965 to 5.9842 (+1.5%")));
    let everything = format!("{note}{}{}{}", item.summary, item.tradeoff.as_deref().unwrap_or_default(), fork.summary);
    for figure in ["33", "38 %", "2.4 GiB", "4.3"] {
        assert!(!everything.contains(figure), "{figure} comes from the README prose, not from a measured pair");
    }
}
