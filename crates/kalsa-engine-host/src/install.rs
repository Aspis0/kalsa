//! Install into a staging folder, then swap it into place atomically.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use kalsa_download::{download, Progress};
use kalsa_engines::{Catalog, Install};
use sha2::{Digest, Sha256};

use crate::{extract, paths};

pub type ProgressFn = dyn Fn(&str, u64, u64) + Send + Sync;
const MLX_LOCK: &str = include_str!("../../../catalog/locks/mlx-lm.txt");
const MLX_ENTRY: &str = include_str!("../assets/kalsa_mlx_serve.py");

fn stage_dir(id: &str) -> Result<PathBuf, String> {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let root = paths::safe_root()?;
    let dir = root.join(format!(".stage-{id}-{}-{nanos}", std::process::id()));
    fs::create_dir(&dir).map_err(|error| format!("stage {}: {error}", dir.display()))?;
    Ok(dir)
}

fn fetch(recipe: &Install, label: &str, dest: &Path, progress: &ProgressFn) -> Result<(), String> {
    let Install::ReleaseArchive { url, sha256, size, .. } = recipe else {
        return Err(format!("{label} is not a release archive"));
    };
    let mut report = |value: Progress| progress(label, value.bytes_done, value.bytes_total);
    download(url, dest, *size, sha256, &mut report).map_err(|error| format!("download {label}: {error}"))
}

fn unpack(recipe: &Install, archive: &Path, into: &Path) -> Result<(), String> {
    let Install::ReleaseArchive { binary, size, .. } = recipe else {
        return Err("not a release archive".to_string());
    };
    extract::extract_tar_gz(archive, into, *size).map_err(|error| format!("extract {}: {error}", archive.display()))?;
    if !into.join(binary).is_file() {
        return Err(format!("archive has no binary at {binary}"));
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn uv_command(program: &Path, args: &[&str], root: &Path) -> Result<(), String> {
    let output = Command::new(program)
        .args(args)
        .env_clear()
        .env("HOME", root)
        .env("PATH", "/usr/bin:/bin")
        .env("UV_NO_CONFIG", "1")
        .env("UV_CACHE_DIR", root.join("_cache/uv"))
        .env("UV_PYTHON_INSTALL_DIR", root.join("_python"))
        .env("UV_INDEX_URL", "https://pypi.org/simple")
        .current_dir(root)
        .output()
        .map_err(|error| format!("could not run {}: {error}", program.display()))?;
    if output.status.success() { return Ok(()); }
    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

/// Always re-extract uv from its verified archive into a temp folder, then
/// swap it in: no existing uv binary is ever trusted.
fn ensure_uv(catalog: &Catalog, progress: &ProgressFn) -> Result<PathBuf, String> {
    let tooling = catalog.tooling.as_ref().ok_or("the catalog has no uv recipe")?;
    let root = paths::safe_root()?;
    let stage = stage_dir("uv")?;
    let archive = stage.join("uv.tar.gz");
    fetch(&tooling.uv, "uv", &archive, progress)?;
    let Install::ReleaseArchive { binary, .. } = &tooling.uv else { return Err("uv is not an archive".into()) };
    unpack(&tooling.uv, &archive, &stage)?;
    let target = root.join("_tools/uv");
    if target.exists() { fs::remove_dir_all(&target).map_err(|error| error.to_string())?; }
    fs::create_dir_all(target.parent().unwrap_or(&root)).map_err(|error| error.to_string())?;
    let _ = fs::remove_file(stage.join("uv.tar.gz"));
    fs::rename(&stage, &target).map_err(|error| format!("uv swap: {error}"))?;
    Ok(target.join(binary))
}

fn build_engine(id: &str, recipe: &Install, uv: Option<&Path>, into: &Path, root: &Path, progress: &ProgressFn) -> Result<PathBuf, String> {
    match recipe {
        Install::ReleaseArchive { tag, binary, .. } => {
            let archive = into.with_extension("tar.gz");
            fetch(recipe, id, &archive, progress)?;
            unpack(recipe, &archive, into)?;
            let program = into.join(binary);
            fs::write(into.join("version"), format!("{tag}\n{}\n", sha256_file(&program)?))
                .map_err(|error| error.to_string())?;
            Ok(program)
        }
        Install::Pip { python, .. } => {
            let uv = uv.ok_or("uv is required for pip engines")?;
            let venv = into.join("venv");
            uv_command(uv, &["venv", "--python", python, "--python-preference", "only-managed", "--no-config", venv.to_str().ok_or("venv path is not UTF-8")?], root)?;
            let python_bin = venv.join("bin/python");
            let lock = into.join("lock.txt");
            fs::write(&lock, MLX_LOCK).map_err(|error| error.to_string())?;
            uv_command(uv, &["pip", "install", "--require-hashes", "--no-deps", "--only-binary", ":all:", "--no-config", "--python", python_bin.to_str().ok_or("python path is not UTF-8")?, "-r", lock.to_str().ok_or("lock path is not UTF-8")?], root)?;
            let script = into.join("kalsa_mlx_serve.py");
            fs::write(&script, MLX_ENTRY).map_err(|error| error.to_string())?;
            Ok(script)
        }
    }
}

fn fix_venv(staged: &Path, final_dir: &Path) -> Result<(), String> {
    let bin = staged.join("venv/bin");
    let Ok(entries) = fs::read_dir(&bin) else { return Ok(()) };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else { continue };
        if !meta.is_file() { continue; }
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let first = text.lines().next().unwrap_or("");
        // uv console scripts use `#!/bin/sh`; the staging path is on line 2.
        if !first.starts_with("#!") || !text.contains(staged.to_string_lossy().as_ref()) { continue; }
        let fixed = text.replace(&staged.to_string_lossy().into_owned(), &final_dir.to_string_lossy().into_owned());
        if fixed != text { fs::write(&path, fixed).map_err(|error| error.to_string())?; }
    }
    Ok(())
}

fn write_manifest(dir: &Path, program: &Path, version: &str) -> Result<(), String> {
    fs::write(dir.join("version"), format!("{version}\n{}\n", sha256_file(program)?))
        .map_err(|error| error.to_string())
}

fn swap_in(staged: &Path, final_dir: &Path) -> Result<(), String> {
    let old = final_dir.with_extension("old");
    if old.exists() { fs::remove_dir_all(&old).map_err(|error| error.to_string())?; }
    if final_dir.exists() { fs::rename(final_dir, &old).map_err(|error| error.to_string())?; }
    if let Err(error) = fs::rename(staged, final_dir) {
        if old.exists() { let _ = fs::rename(&old, final_dir); }
        return Err(error.to_string());
    }
    if old.exists() { let _ = fs::remove_dir_all(&old); }
    Ok(())
}

/// A crash between final→old and staged→final leaves the previous install
/// only in `.old`; the next install or start puts it back before doing work.
pub fn recover(id: &str) -> Result<(), String> {
    let final_dir = paths::engine_dir(id)?;
    let old = final_dir.with_extension("old");
    if !final_dir.exists() && old.exists() {
        fs::rename(&old, &final_dir).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn install(id: &str, catalog: &Catalog, progress: &ProgressFn) -> Result<(), String> {
    let engine = catalog.engine.iter().find(|engine| engine.id == id)
        .ok_or_else(|| format!("unknown engine {id}"))?;
    let recipe = engine.install.as_ref().ok_or_else(|| format!("{id} has no install recipe"))?;
    let root = paths::safe_root()?;
    let final_dir = paths::engine_dir(id)?;
    paths::assert_inside(&final_dir)?;
    let stage = stage_dir(id)?;
    let result = (|| {
        let uv = match recipe {
            Install::Pip { .. } => Some(ensure_uv(catalog, progress)?),
            _ => None,
        };
        progress("install", 0, 1);
        let program = build_engine(id, recipe, uv.as_deref(), &stage, &root, progress)?;
        fix_venv(&stage, &final_dir)?;
        if let Install::Pip { version, .. } = recipe {
            write_manifest(&stage, &program, version)?;
        }
        swap_in(&stage, &final_dir)?;
        progress("installed", 1, 1);
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_dir_all(&stage); }
    result
}
