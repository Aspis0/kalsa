//! The two launch templates. The model is one argv element, never a shell.
//! Keys go in env, not argv: a same-user process can already read our memory
//! and files (and `ps eww` can read env); the threat here is web pages and
//! other local users, not another app of the same user.

use std::path::{Path, PathBuf};

use kalsa_engines::Install;

use crate::api_key::ApiKey;

pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub verify: PathBuf,
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
    key: &ApiKey,
) -> Result<Launch, String> {
    check_model(model)?;
    let host = ["--host", "127.0.0.1"];
    match (id, recipe) {
        ("llama-cpp", Install::ReleaseArchive { binary, .. }) => {
            let mut args: Vec<String> = host.iter().map(|part| (*part).to_string()).collect();
            args.extend(["--port".to_string(), port.to_string()]);
            args.extend(["--cors-origins".to_string(), "localhost".to_string()]);
            args.push("--no-slots".to_string());
            args.push(if local_model(model) { "-m" } else { "-hf" }.to_string());
            args.push(model.to_string());
            Ok(Launch {
                program: install_dir.join(binary),
                args,
                env: vec![("LLAMA_API_KEY".to_string(), key.as_str().to_string())],
                verify: install_dir.join(binary),
                library_path: Some(install_dir.to_path_buf()),
                venv: None,
            })
        }
        ("mlx-lm", Install::Pip { .. }) => {
            let venv = install_dir.join("venv");
            let script = install_dir.join("kalsa_mlx_serve.py");
            let mut args: Vec<String> = vec![script.to_string_lossy().into_owned()];
            args.extend(host.iter().map(|part| (*part).to_string()));
            args.extend(["--port".to_string(), port.to_string(), "--model".to_string(), model.to_string()]);
            Ok(Launch {
                program: venv.join("bin/python"),
                args,
                env: vec![("KALSA_ENGINE_KEY".to_string(), key.as_str().to_string())],
                verify: script,
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
        let launch = build("mlx-lm", &pip(), Path::new("/engines/mlx-lm"), "org/model name", 8123, &ApiKey::random().unwrap()).unwrap();
        assert_eq!(launch.args.last().unwrap(), "org/model name");
        assert!(launch.args.contains(&"--model".to_string()));
        assert!(launch.args.contains(&"127.0.0.1".to_string()));
        assert!(build("mlx-lm", &pip(), Path::new("/e"), "--evil", 8123, &ApiKey::random().unwrap()).is_err());
    }
}
