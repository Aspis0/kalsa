use std::path::PathBuf;

use kalsa_engines::{chip_tag_for_brand, parse, Catalog, Machine};

fn catalog_text() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../catalog/engines.toml");
    std::fs::read_to_string(path).expect("catalog/engines.toml is present")
}

fn real_catalog() -> Catalog {
    parse(&catalog_text()).expect("the shipped catalog is valid")
}

fn machine(tag: &str, name: &str) -> Machine {
    Machine {
        chip_tag: tag.into(),
        chip_name: name.into(),
    }
}

#[test]
fn the_shipped_catalog_parses_and_validates() {
    let text = catalog_text();
    let blocks = text.lines().filter(|line| line.trim() == "[[engine]]").count();
    assert_eq!(real_catalog().engine.len(), blocks);
}

#[test]
fn an_m1_max_gets_the_shunya_build_first() {
    let picks = kalsa_engines::recommend(&machine("apple-m1", "Apple M1 Max"), &real_catalog());
    assert_eq!(picks[0].engine_id, "shunya-mtplx-m1");
    let best = picks[0].benchmark.as_ref().expect("a same-chip benchmark");
    assert_eq!(best.decode_tok_s, Some(128.5));
    assert!(picks[0].reason.contains("measured on this chip and machine"));
}

#[test]
fn the_view_marks_frink_as_another_chip() {
    let picks = kalsa_engines::recommend(&machine("apple-m1", "Apple M1 Max"), &real_catalog());
    assert_eq!(picks[0].engine_id, "shunya-mtplx-m1");
    let frink = picks
        .iter()
        .find(|pick| pick.engine_id == "frink")
        .expect("frink runs on Apple Silicon");
    assert!(!frink.same_chip);
    assert!(frink.gain_label.is_some());
    assert!(frink.metric == Some("decode"));
}

#[test]
fn picks_carry_the_display_labels_and_recommendable_flag() {
    let m1 = kalsa_engines::recommend(&machine("apple-m1", "Apple M1 Max"), &real_catalog());
    let frink = m1.iter().find(|pick| pick.engine_id == "frink").unwrap();
    assert_eq!(frink.chip_label.as_deref(), Some("M2 Pro"));
    assert!(frink.recommendable);

    let nvidia = kalsa_engines::recommend(&machine("nvidia", "RTX 4060 Ti"), &real_catalog());
    let slow = nvidia.iter().find(|pick| pick.engine_id == "neutronstar").unwrap();
    assert!(!slow.recommendable);
    assert_eq!(slow.chip_label.as_deref(), Some("NVIDIA GPU"));
}

#[test]
fn a_base_m1_does_not_take_an_m1_max_benchmark_as_exact() {
    let picks = kalsa_engines::recommend(&machine("apple-m1", "Apple M1"), &real_catalog());
    let shunya = picks
        .iter()
        .find(|pick| pick.engine_id == "shunya-mtplx-m1")
        .expect("shunya runs on M1");
    assert!(shunya.reason.contains("measured on this chip"));
    assert!(!shunya.reason.contains("and machine"));
}

#[test]
fn an_m3_max_never_gets_m1_only_engines() {
    let picks = kalsa_engines::recommend(&machine("apple-m3", "Apple M3 Max"), &real_catalog());
    assert!(!picks.iter().any(|pick| pick.engine_id == "shunya-mtplx-m1"));
    assert!(!picks.is_empty());
}

#[test]
fn an_m4_profile_is_supported() {
    let picks = kalsa_engines::recommend(&machine("apple-m4", "Apple M4 Max"), &real_catalog());
    assert!(!picks.is_empty());
    let catalog = real_catalog();
    for pick in &picks {
        let engine = catalog.engine.iter().find(|e| e.id == pick.engine_id).unwrap();
        assert!(engine.hardware.contains(&"apple-m4".to_string()));
    }
}

#[test]
fn prefill_never_outranks_decode() {
    let text = r#"
[[engine]]
id = "decoder"
name = "Decoder"
repo = "a/decoder"
author = "a"
license = "MIT"
kind = "engine"
hardware = ["nvidia"]
summary = "decode"
[[engine.benchmark]]
source = "https://example.invalid/d"
machine = "RTX 3060"
chip_tag = "nvidia"
model = "m"
quant = "Q4"
decode_tok_s = 10.0
baseline = "stock"
baseline_decode_tok_s = 5.0
[[engine]]
id = "prefiller"
name = "Prefiller"
repo = "a/prefiller"
author = "a"
license = "MIT"
kind = "engine"
hardware = ["nvidia"]
summary = "prefill"
[[engine.benchmark]]
source = "https://example.invalid/p"
machine = "RTX 3060"
chip_tag = "nvidia"
model = "m"
quant = "Q4"
prefill_tok_s = 5000.0
baseline = "stock"
baseline_prefill_tok_s = 1000.0
"#;
    let picks = kalsa_engines::recommend(&machine("nvidia", "RTX 3060"), &parse(text).unwrap());
    assert_eq!(picks[0].engine_id, "decoder");
    assert!(picks[1].reason.contains("prefill 5000 tok/s (no decode figure)"));
}

#[test]
fn a_non_recommendable_engine_ranks_last() {
    let picks = kalsa_engines::recommend(&machine("nvidia", "RTX 4060 Ti"), &real_catalog());
    assert_eq!(picks.last().expect("picks exist").engine_id, "neutronstar");
}

#[test]
fn brand_strings_map_to_generation_tags() {
    for (brand, tag) in [
        ("Apple M1 Max", "apple-m1"),
        ("Apple M2 Ultra", "apple-m2"),
        ("Apple M3 Ultra", "apple-m3"),
        ("Apple M4 Pro", "apple-m4"),
        ("Apple M5 Max", "apple-m5"),
    ] {
        assert_eq!(chip_tag_for_brand(brand), Some(tag), "{brand}");
    }
    assert_eq!(chip_tag_for_brand("Apple M10 Max"), None);
    assert_eq!(chip_tag_for_brand("AMD Ryzen 9 9900X"), None);
}

#[test]
fn validation_reaches_the_duplicate_id_check() {
    let engine = r#"
[[engine]]
id = "twice"
name = "A"
repo = "a/a"
author = "a"
license = "MIT"
kind = "reference"
hardware = ["cpu"]
summary = "s"
"#;
    let text = format!("{engine}{engine}");
    assert!(parse(&text).unwrap_err().contains("duplicate engine id"));
}

#[test]
fn shipped_recipes_are_valid_and_pinned() {
    let catalog = real_catalog();
    let llama = catalog.engine.iter().find(|e| e.id == "llama-cpp").unwrap();
    assert!(matches!(llama.install, Some(kalsa_engines::Install::ReleaseArchive { .. })));
    let mlx = catalog.engine.iter().find(|e| e.id == "mlx-lm").unwrap();
    assert!(matches!(mlx.install, Some(kalsa_engines::Install::Pip { .. })));
    assert!(catalog.tooling.is_some());
}

#[test]
fn the_mlx_lock_matches_the_catalog_version() {
    let catalog = real_catalog();
    let mlx = catalog.engine.iter().find(|e| e.id == "mlx-lm").unwrap();
    let kalsa_engines::Install::Pip { version, lock, .. } = mlx.install.as_ref().unwrap() else {
        panic!("mlx-lm uses pip");
    };
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../").join(lock);
    let text = std::fs::read_to_string(path).expect("lock file exists");
    assert!(text.contains(&format!("mlx-lm=={version}")), "lock pins the catalog version");
}

#[test]
fn a_bad_archive_digest_is_rejected() {
    let mut text = catalog_text();
    text = text.replacen(
        "6ebeeea8575081ff968eb1c26f6fffcafe8e3ff2a0fb5d548c0aea7f5575e038",
        "deadbeef",
        1,
    );
    let error = parse(&text).unwrap_err();
    assert!(error.contains("sha256"), "{error}");
}

#[test]
fn a_review_record_is_exposed_as_reviewed() {
    let text = r#"
[[engine]]
id = "reviewed"
name = "Reviewed"
repo = "a/reviewed"
author = "a"
license = "MIT"
kind = "fork"
upstream = "a/upstream"
hardware = ["cpu"]
summary = "s"
[[engine.benchmark]]
source = "https://example.invalid/a"
machine = "Laptop"
chip_tag = "cpu"
model = "m"
quant = "Q4"
decode_tok_s = 10.0
baseline = "b"
baseline_decode_tok_s = 5.0
[engine.review]
commit = "a1b2c3d"
date = "2026-11-18"
upstream = "a/upstream"
"#;
    let catalog = parse(text).expect("a review record is valid");
    let review = catalog.engine[0].reviewed.as_ref().expect("review parsed");
    assert_eq!(review.commit, "a1b2c3d");
    assert_eq!(review.upstream, "a/upstream");
}

#[test]
fn validation_rejects_bad_catalog_fields() {
    let valid = r#"
[[engine]]
id = "one"
name = "One"
repo = "a/one"
author = "a"
license = "MIT"
kind = "engine"
hardware = ["cpu"]
summary = "s"
[[engine.benchmark]]
source = "https://example.invalid/a"
machine = "M1 Max"
chip_tag = "cpu"
model = "m"
quant = "Q4"
decode_tok_s = 10.0
baseline = "b"
baseline_decode_tok_s = 5.0
"#;
    assert!(parse(valid).is_ok());
    for (bad, expected) in [
        (valid.replace("license = \"MIT\"", "license = \"BUSL-1.1\""), "OSI"),
        (valid.replace("quant = \"Q4\"", "quant = \"\""), "benchmark field is empty"),
        (valid.replace("decode_tok_s = 10.0", "decode_tok_s = -1.0"), "finite and positive"),
        (valid.replace("chip_tag = \"cpu\"", "chip_tag = \"nvidia\""), "not in hardware"),
        (valid.replace("name = \"One\"", "name = \"\""), "engine field is empty"),
    ] {
        let error = parse(&bad).unwrap_err();
        assert!(error.contains(expected), "{expected}: {error}");
    }
}
