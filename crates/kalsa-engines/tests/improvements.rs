use kalsa_engines::{improvement_kinds, parse, ImprovementKind};

const HEAD: &str = "[[engine]]\nid = \"e\"\nname = \"E\"\nrepo = \"o/e\"\nauthor = \"o\"\nlicense = \"MIT\"\nkind = \"engine\"\nhardware = [\"apple-m5\", \"nvidia\"]\nsummary = \"s\"\n";

fn improvement(body: &str) -> String {
    format!("{HEAD}[[engine.improvement]]\nsummary = \"s\"\nmachine = \"m\"\nsource = \"https://example.invalid/a\"\n{body}\n")
}

fn benchmark(decode: f64, base: f64) -> String {
    format!(
        "{HEAD}[[engine.benchmark]]\nsource = \"https://example.invalid/a\"\nmachine = \"m\"\nchip_tag = \"apple-m5\"\nmodel = \"m\"\nquant = \"Q4\"\ndecode_tok_s = {decode}\nbaseline = \"b\"\nbaseline_decode_tok_s = {base}\n"
    )
}

fn error(text: &str) -> String {
    parse(text).unwrap_err()
}

#[test]
fn a_listed_entry_needs_a_gain_of_five_percent_or_an_improvement() {
    assert!(parse(&benchmark(105.0, 100.0)).is_ok());
    assert!(error(&benchmark(104.0, 100.0)).contains("needs a benchmark gain of at least 5% or an improvement"));
    assert!(error(&benchmark(90.0, 100.0)).contains("needs a benchmark gain"), "a slower figure is not a gain");
    assert!(error(HEAD).contains("needs a benchmark gain"), "a note no longer stands in for a claim");
    assert!(error(&format!("{HEAD}note = \"The author's own words\"\n")).contains("needs a benchmark gain"));
    assert!(parse(&improvement("kind = \"multi-machine\"")).is_ok());
    assert!(parse(&HEAD.replace("kind = \"engine\"", "kind = \"reference\"")).is_ok(), "a reference is the baseline and needs neither");
}

#[test]
fn speed_is_never_declared_as_an_improvement() {
    for kind in ["faster-decode", "faster-prefill"] {
        assert!(error(&improvement(&format!("kind = \"{kind}\""))).contains("comes from the benchmark rows"), "{kind}");
    }
}

#[test]
fn a_before_after_improvement_needs_both_numbers_a_unit_and_five_percent() {
    for kind in ["faster-start", "less-memory", "parallel-throughput", "longer-context", "quality", "energy"] {
        let ok = improvement(&format!("kind = \"{kind}\"\nbefore = 100.0\nafter = 105.0\nunit = \"u\""));
        assert!(parse(&ok).is_ok(), "{kind}");
        assert!(error(&improvement(&format!("kind = \"{kind}\""))).contains("needs before, after and unit"), "{kind}");
        assert!(error(&improvement(&format!("kind = \"{kind}\"\nbefore = 100.0\nafter = 104.0\nunit = \"u\""))).contains("under 5%"), "{kind}");
        assert!(error(&improvement(&format!("kind = \"{kind}\"\nbefore = 100.0\nafter = 100.0\nunit = \"u\""))).contains("under 5%"), "{kind}");
    }
    let lower = improvement("kind = \"less-memory\"\nbefore = 100.0\nafter = 90.0\nunit = \"GB\"");
    assert!(parse(&lower).is_ok(), "a drop of 10% is a difference too");
    assert!(error(&improvement("kind = \"faster-start\"\nbefore = 100.0\nafter = 50.0")).contains("positive before"), "no unit");
    assert!(error(&improvement("kind = \"energy\"\nbefore = 0.0\nafter = 5.0\nunit = \"W\"")).contains("positive before"));
    assert!(error(&improvement("kind = \"quality\"\nbefore = 1.0\nafter = 2.0\nunit = \"u\"\nmodel_gib = 3.0")).contains("not model sizes"));
}

#[test]
fn bigger_models_carry_a_model_size_a_memory_size_and_a_speed() {
    let ok = improvement("kind = \"bigger-models\"\nmodel_gib = 81.0\nmemory_gb = 128.0\ntok_s = 34.36");
    assert!(parse(&ok).is_ok());
    for missing in ["model_gib = 81.0\nmemory_gb = 128.0", "model_gib = 81.0\ntok_s = 34.36", "memory_gb = 128.0\ntok_s = 34.36", "model_gib = 0.0\nmemory_gb = 128.0\ntok_s = 1.0"] {
        assert!(error(&improvement(&format!("kind = \"bigger-models\"\n{missing}"))).contains("needs a positive model_gib"), "{missing}");
    }
    assert!(error(&improvement("kind = \"bigger-models\"\nmodel_gib = 8.0\nmemory_gb = 16.0\ntok_s = 1.0\nbefore = 1.0")).contains("not before and after"));
}

#[test]
fn kinds_without_numbers_reject_numbers_nobody_renders() {
    for kind in ["multi-machine", "new-hardware", "new-model"] {
        assert!(parse(&improvement(&format!("kind = \"{kind}\""))).is_ok(), "{kind}");
        assert!(error(&improvement(&format!("kind = \"{kind}\"\ntok_s = 1.0"))).contains("carries no numbers"), "{kind}");
        assert!(error(&improvement(&format!("kind = \"{kind}\"\nbefore = 1.0"))).contains("carries no numbers"), "{kind}");
    }
}

#[test]
fn an_improvement_has_a_valid_source_tag_and_text() {
    let bad_source = improvement("kind = \"multi-machine\"").replace("https://example.invalid/a", "http://example.invalid/a");
    assert!(error(&bad_source).contains("improvement source must be an https URL"));
    assert!(error(&improvement("kind = \"new-hardware\"\nchip_tag = \"intel\"")).contains("improvement tag intel is not in hardware"));
    assert!(parse(&improvement("kind = \"new-hardware\"\nchip_tag = \"nvidia\"\nmodel = \"m\"\ntradeoff = \"slower\"")).is_ok());
    assert!(error(&improvement("kind = \"new-hardware\"\ntradeoff = \" \"")).contains("improvement field is empty"));
    assert!(error(&improvement("kind = \"new-hardware\"").replace("summary = \"s\"\nmachine", "summary = \" \"\nmachine")).contains("needs a summary and a machine"));
    assert!(error(&improvement("kind = \"somethingelse\"")).contains("unknown variant"), "only the twelve kinds exist");
}

#[test]
fn the_kinds_an_engine_shows_are_its_speed_gains_and_its_improvements_in_catalog_order() {
    let text = format!("{}[[engine.improvement]]\nkind = \"new-hardware\"\nsummary = \"s\"\nmachine = \"m\"\nsource = \"https://example.invalid/a\"\n", benchmark(150.0, 100.0));
    let catalog = parse(&text).expect("valid");
    assert_eq!(improvement_kinds(&catalog.engine[0]), [ImprovementKind::NewHardware, ImprovementKind::FasterDecode]);
    assert_eq!(ImprovementKind::ALL.len(), 12);
    assert_eq!(ImprovementKind::ParallelThroughput.id(), "parallel-throughput");
}
