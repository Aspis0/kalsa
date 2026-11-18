use std::fs;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let catalog = kalsa_site::catalog();
    let out = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../site/dist");
    for (relative, body) in kalsa_site::render(&catalog) {
        let path = out.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, body)?;
    }
    println!("wrote {} files to {}", kalsa_site::render(&catalog).len(), out.display());
    Ok(())
}
