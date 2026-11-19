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

#[test]
fn a_baseline_that_is_a_catalog_engine_gets_its_display_name_and_any_other_stays_unnamed() {
    let catalog = shipped();
    let named = |id: &str| entry(&catalog, id).benchmark[0].baseline_engine.clone();
    assert_eq!(named("frink").as_deref(), Some("llama.cpp"), "the build note is dropped");
    assert_eq!(named("mlxcel").as_deref(), Some("mlx-lm"));
    assert_eq!(named("shunya-mtplx-m1").as_deref(), Some("MTPLX"));
    assert_eq!(named("rapid-mlx").as_deref(), Some("oMLX"));
    for unnamed in ["omlx", "dmlx", "ingenious-ds4-m3", "thecodacus-expert-cache", "architectds-strata"] {
        assert_eq!(named(unnamed), None, "{unnamed}");
    }
}

fn engine_with(id: &str, name: &str, repo: &str, extra: &str) -> String {
    format!("[[engine]]\nid = \"{id}\"\nname = \"{name}\"\nrepo = \"{repo}\"\nauthor = \"a\"\nlicense = \"MIT\"\nkind = \"reference\"\nhardware = [\"cpu\"]\nsummary = \"Runs it.\"\n{extra}")
}

const ROW: &str = "[[engine.benchmark]]\nsource = \"https://example.invalid/a\"\nmachine = \"m\"\nchip_tag = \"cpu\"\nmodel = \"m\"\nquant = \"Q4\"\ndecode_tok_s = 20.0\nbaseline = \"llama.cpp\"\nbaseline_decode_tok_s = 10.0\n";

fn user_of(baseline_line: &str) -> String {
    format!("[[engine]]\nid = \"user\"\nname = \"User\"\nrepo = \"u/user\"\nauthor = \"u\"\nlicense = \"MIT\"\nkind = \"engine\"\nhardware = [\"cpu\"]\nsummary = \"Runs it.\"\n{}", ROW.replace("baseline = \"llama.cpp\"", baseline_line))
}

#[test]
fn an_exact_catalog_id_wins_and_a_name_matching_two_entries_is_an_error() {
    let two_named = format!("{}\n{}\n{}", engine_with("first", "llama.cpp", "a/first", ""), engine_with("second", "Other", "b/llama.cpp", ""), user_of("baseline = \"llama.cpp\""));
    let error = parse(&two_named).unwrap_err();
    assert!(error.contains("could be any of first, second"), "{error}");
    let with_the_id = format!("{two_named}\n{}", "").replace("id = \"first\"", "id = \"llama-cpp\"");
    let catalog = parse(&with_the_id).expect("the entry whose id is llama-cpp is the exact match");
    let user = catalog.engine.iter().find(|engine| engine.id == "user").unwrap();
    assert_eq!(user.benchmark[0].baseline_engine.as_deref(), Some("llama.cpp"));
    let one_named = format!("{}\n{}", engine_with("first", "Solo", "a/solo", ""), user_of("baseline = \"stock solo 1.2\""));
    assert_eq!(parse(&one_named).unwrap().engine[1].benchmark[0].baseline_engine.as_deref(), Some("Solo"));
    let nobody = format!("{}\n{}", engine_with("first", "Solo", "a/solo", ""), user_of("baseline = \"something else\""));
    assert_eq!(parse(&nobody).unwrap().engine[1].benchmark[0].baseline_engine, None);
}

#[test]
fn the_shipped_catalog_has_no_ambiguous_baseline_and_no_engine_marked_as_its_own_ablation() {
    let catalog = shipped();
    for benchmark in catalog.engine.iter().flat_map(|engine| &engine.benchmark) {
        assert!(!(benchmark.feature_off && benchmark.baseline_engine.is_some()), "{}", benchmark.baseline);
    }
    let marked = format!("{}\n{}", engine_with("llama-cpp", "llama.cpp", "a/llama.cpp", ""), user_of("baseline = \"llama.cpp\"\nfeature_off = true"));
    assert!(parse(&marked).unwrap_err().contains("cannot also be a feature switched off"));
}
