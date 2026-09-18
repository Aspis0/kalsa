// The probe's numbers are only as good as the code that takes them: at
// opt-level 0 an M1 Max reads 5.8 GB/s where it really reads 110, and the
// reliability checks then refuse the reading and blame the machine for being
// busy. Cargo tells a build script which level it is compiling at, and nothing
// else does, so the level is carried into the crate here and checked with the
// rest of the evidence.
fn main() {
    let level = std::env::var("OPT_LEVEL").unwrap_or_default();
    println!("cargo:rustc-env=KALSA_PROBE_OPT_LEVEL={level}");
    println!("cargo:rerun-if-changed=build.rs");
}
