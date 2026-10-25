use std::{env, fs, path::PathBuf};

const MISSING_FRONTEND: &str = r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Kalsa Brain</title>
  </head>
  <body>
    <p>Kalsa Brain's chat frontend is missing. From the repository root, run <code>npm --prefix chat ci &amp;&amp; npm --prefix chat run build</code>, then restart the app.</p>
  </body>
</html>
"#;

fn main() {
    let manifest_dir = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by Cargo"),
    );
    let frontend_index = manifest_dir.join("../chat/dist/index.html");
    println!("cargo:rerun-if-changed={}", frontend_index.display());

    if !frontend_index.exists() {
        fs::create_dir_all(
            frontend_index
                .parent()
                .expect("chat/dist has a parent directory"),
        )
        .expect("create chat/dist for the frontend placeholder");
        fs::write(&frontend_index, MISSING_FRONTEND)
            .expect("write the missing frontend placeholder");
    }

    tauri_build::build()
}
