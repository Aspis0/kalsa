use kalsa_engines::parse;

fn entry(extra: &str) -> String {
    format!(
        "[[engine]]\nid = \"base\"\nname = \"Base\"\nrepo = \"o/base\"\nauthor = \"o\"\nlicense = \"MIT\"\nkind = \"reference\"\nhardware = [\"cpu\"]\nsummary = \"s\"\n{extra}\n"
    )
}

fn fork(upstream: &str) -> String {
    format!("[[engine]]\nid = \"child\"\nname = \"Child\"\nrepo = \"p/child\"\nauthor = \"p\"\nlicense = \"MIT\"\nkind = \"fork\"\nupstream = \"{upstream}\"\nhardware = [\"cpu\"]\nsummary = \"s\"\n[[engine.improvement]]\nkind = \"multi-machine\"\nsummary = \"s\"\nmachine = \"m\"\nsource = \"https://example.invalid/a\"\n")
}

#[test]
fn an_upstream_must_be_a_catalog_entry() {
    let error = parse(&fork("o/missing")).unwrap_err();
    assert!(error.contains("upstream o/missing is not a catalog entry"), "{error}");
    assert!(parse(&format!("{}\n{}", entry(""), fork("o/base"))).is_ok());
    assert!(parse(&format!("{}\n{}", entry(""), fork("O/Base"))).is_ok(), "repo names compare without case");
}

#[test]
fn the_shipped_catalog_lists_every_upstream_it_names() {
    let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../catalog/engines.toml")).expect("catalog is present");
    let catalog = parse(&text).expect("the shipped catalog is valid");
    for upstream in catalog.engine.iter().filter_map(|engine| engine.upstream.as_deref()) {
        assert!(catalog.engine.iter().any(|other| other.repo.eq_ignore_ascii_case(upstream)), "{upstream} is not listed");
    }
}

#[test]
fn a_website_is_a_plain_https_url_and_a_label_needs_one() {
    assert!(parse(&entry("website = \"https://example.org/post/\"\nwebsite_label = \"Announcement\"")).is_ok());
    for bad in ["http://example.org", "javascript:alert(1)", "https://user:pw@example.org", "//example.org", "example.org", "mailto:a@b.c", "kalsa://x"] {
        let error = parse(&entry(&format!("website = \"{bad}\""))).unwrap_err();
        assert!(error.contains("website must be an https URL"), "{bad}: {error}");
    }
    assert!(parse(&entry("website_label = \"Website\"")).unwrap_err().contains("website_label needs a website"));
    assert!(parse(&entry("website = \"https://example.org\"\nwebsite_label = \" \"")).unwrap_err().contains("website_label is empty"));
}
