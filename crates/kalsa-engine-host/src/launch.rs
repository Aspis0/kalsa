//! The two launch templates. The model is one argv element, never a shell.

use std::path::{Path, PathBuf};

use kalsa_engines::Install;

pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub library_path: Option<PathBuf>,
    pub venv: Option<PathBuf>,
}

fn check_model(model: &str) -> Result<(), String> {
    if model.trim().is_empty() || model.starts_with('-') || model.contains('\0') {
        return Err("a model must be a repo id or path, not an option".to_string());
    }
    Ok(())
}

fn local_model(model: &str) -> bool {
    model.ends_with(".gguf") || Path::new(model).exists()
}

/// Builds the exact argv for llama-server or mlx_lm.server.
pub fn build(
    id: &str,
    recipe: &Install,
    install_dir: &Path,
    model: &str,
    port: u16,
) -> Result<Launch, String> {
    check_model(model)?;
    let host = ["--host", "127.0.0.1"];
    match (id, recipe) {
        ("llama-cpp", Install::ReleaseArchive { binary, .. }) => {
            let mut args: Vec<String> = host.iter().map(|part| (*part).to_string()).collect();
            args.extend(["--port".to_string(), port.to_string()]);
            args.push(if local_model(model) { "-m" } else { "-hf" }.to_string());
            args.push(model.to_string());
            Ok(Launch {
                program: install_dir.join(binary),
                args,
                library_path: Some(install_dir.to_path_buf()),
                venv: None,
            })
        }
        ("mlx-lm", Install::Pip { .. }) => {
            let venv = install_dir.join("venv");
            let mut args: Vec<String> = host.iter().map(|part| (*part).to_string()).collect();
            args.extend(["--port".to_string(), port.to_string(), "--model".to_string(), model.to_string()]);
            Ok(Launch {
                program: venv.join("bin/mlx_lm.server"),
                args,
                library_path: None,
                venv: Some(venv),
            })
        }
        _ => Err(format!("{id} has no launch template")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pip() -> Install {
        Install::Pip { package: "mlx-lm".into(), version: "0.32.2".into(), python: "3.12.13".into(), lock: "catalog/locks/mlx-lm.txt".into() }
    }

    #[test]
    fn model_is_one_argument_and_cannot_be_a_flag() {
        let launch = build("mlx-lm", &pip(), Path::new("/engines/mlx-lm"), "org/model name", 8123).unwrap();
        assert_eq!(launch.args.last().unwrap(), "org/model name");
        assert!(launch.args.contains(&"--model".to_string()));
        assert!(launch.args.contains(&"127.0.0.1".to_string()));
        assert!(build("mlx-lm", &pip(), Path::new("/e"), "--evil", 8123).is_err());
    }
}
