//! The one rule for the two JSON contracts the screenshot harnesses read: a
//! test compares its sample against the file and fails on drift. A suite
//! that rewrites its own fixture cannot go red on drift — a stale sample
//! becomes a dirty file nobody notices at two in the morning, and CI cannot
//! notice one at all. `UPDATE_CONTRACT=1` is the one deliberate way to
//! rewrite, and only the sample is replaced: the hand-written keys beside it
//! say things one sample cannot show.

use std::path::Path;

/// Fail unless `sample` equals the `sample` key of the contract file at
/// `path`; `UPDATE_CONTRACT=1` stores it instead. `test` is the test that
/// owns the file, named in every message so the way out is copy-pasteable.
pub(crate) fn check_sample(path: &Path, test: &str, sample: &serde_json::Value) {
    let text = std::fs::read_to_string(path).unwrap_or_else(|_| {
        panic!(
            "the contract file is missing: {} — restore it first: regeneration \
             replaces only the sample and needs the hand-written keys around it",
            path.display()
        )
    });
    let mut contract: serde_json::Value =
        serde_json::from_str(&text).expect("the contract file is json");
    if contract.get("sample") == Some(sample) {
        return;
    }
    if std::env::var("UPDATE_CONTRACT").is_ok_and(|value| value == "1") {
        contract["sample"] = sample.clone();
        let written = serde_json::to_string_pretty(&contract).expect("serialise the contract");
        std::fs::write(path, format!("{written}\n")).expect("write the contract");
        return;
    }
    panic!(
        "the sample in {} no longer matches what the type produces. \
         Regenerate it with: cd src-tauri && UPDATE_CONTRACT=1 cargo test {test}",
        path.display()
    );
}
