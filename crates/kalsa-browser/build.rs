//! Our builds must never download the Playwright driver: the release pipeline
//! assembles it from pinned sources and verifies the result, so a build that
//! fetched it would make the pin mean nothing.
//!
//! This cannot enforce that. Cargo runs a dependency's build script before this
//! one, so by the time we are here `playwright-rs` has already had its say about
//! `PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD`. The only lever left inside the crate is to
//! say loudly, at build time, in the one place a developer will see it.

fn main() {
    println!("cargo:rerun-if-env-changed=PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD");
    if std::env::var_os("PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD").is_some() {
        return;
    }
    println!(
        "cargo:warning=kalsa-browser builds without the driver download only when \
         PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD is set. Build with \
         PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD=1 cargo build -p kalsa-browser, and point \
         PLAYWRIGHT_DRIVER_PATH at a verified driver (see crates/kalsa-browser/README.md)."
    );
}