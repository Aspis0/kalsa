use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let site = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../site");
    let catalog = kalsa_site::catalog();
    let facts = kalsa_site::Facts::load(&site.join("data/github.json"))?;
    let files = kalsa_site::render(&catalog, &facts);
    let out = site.join("dist");
    let written = kalsa_site::write_site(&files, &out)?;
    println!("wrote {written} files to {}", out.display());
    Ok(())
}
