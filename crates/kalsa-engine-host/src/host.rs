//! The state behind the engine commands: installed folders and live children.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::install::{self, ProgressFn};
use crate::launch;
use crate::locks::EngineLock;
use crate::paths;
use crate::process::{self, Running};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EngineState {
    Starting,
    Running,
    Exited,
    Crashed,
    Installed,
    NotInstalled,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub state: EngineState,
    pub port: Option<u16>,
    pub log_tail: Vec<String>,
    pub message: Option<String>,
}

struct Live {
    process: Running,
    pidfile: std::path::PathBuf,
}

pub struct EngineHost {
    catalog: kalsa_engines::Catalog,
    running: Mutex<HashMap<String, Live>>,
}

impl EngineHost {
    pub fn new() -> Result<Self, String> {
        let catalog = kalsa_engines::parse(include_str!("../../../catalog/engines.toml"))?;
        let root = paths::safe_root()?;
        process::cleanup_stale(&root, &root.join(".pids"))?;
        Ok(Self { catalog, running: Mutex::new(HashMap::new()) })
    }

    pub fn install(&self, id: &str, progress: &ProgressFn) -> Result<(), String> {
        let _lock = EngineLock::acquire(id)?;
        install::recover(id)?;
        if self.running.lock().map_err(|error| error.to_string())?.contains_key(id) {
            return Err(format!("{id} is running; stop it first"));
        }
        install::install(id, &self.catalog, progress)
    }

    pub fn uninstall(&self, id: &str) -> Result<(), String> {
        let _lock = EngineLock::acquire(id)?;
        if self.running.lock().map_err(|error| error.to_string())?.contains_key(id) {
            return Err(format!("{id} is running; stop it first"));
        }
        self.stop(id)?;
        let root = paths::safe_root()?;
        process::cleanup_stale(&root, &root.join(".pids"))?;
        paths::uninstall(id)
    }

    fn verify_program(dir: &Path, program: &Path) -> Result<(), String> {
        let manifest = fs::read_to_string(dir.join("version")).map_err(|error| error.to_string())?;
        let expected = manifest.lines().nth(1).unwrap_or("");
        if expected.is_empty() {
            return Err("the installed engine has no executable digest".to_string());
        }
        let bytes = fs::read(program).map_err(|error| error.to_string())?;
        let actual = format!("{:x}", Sha256::digest(bytes));
        if actual != expected {
            return Err(format!("{} changed since install", program.display()));
        }
        Ok(())
    }

    pub fn start(&self, id: &str, model: &str, progress: &ProgressFn) -> Result<EngineStatus, String> {
        let _lock = EngineLock::acquire(id)?;
        install::recover(id)?;
        let engine = self.catalog.engine.iter().find(|engine| engine.id == id)
            .ok_or_else(|| format!("unknown engine {id}"))?;
        let recipe = engine.install.as_ref().ok_or_else(|| format!("{id} has no install recipe"))?;
        let dir = paths::engine_dir(id)?;
        let root = paths::safe_root()?;
        let template = launch::build(id, recipe, &dir, model, 0)?;
        Self::verify_program(&dir, &template.program)?;
        progress("starting", 0, 1);
        let mut last = String::new();
        for _ in 0..3 {
            let port = process::free_port()?;
            let launch = launch::build(id, recipe, &dir, model, port)?;
            match process::start(launch, port, &root) {
                Ok(process) => {
                    let pidfile = process::write_pidfile(id, process.child_pid(), &process.program)?;
                    self.running.lock().map_err(|error| error.to_string())?.insert(
                        id.to_string(),
                        Live { process, pidfile },
                    );
                    return Ok(EngineStatus {
                        state: EngineState::Starting,
                        port: Some(port),
                        log_tail: Vec::new(),
                        message: Some("Waiting for /v1/models".to_string()),
                    });
                }
                Err(error) => last = error,
            }
        }
        Err(last)
    }

    /// Called on app exit. A hard crash cannot run this; the next launch's
    /// `cleanup_stale` pass handles those orphans.
    pub fn stop_all(&self) -> Result<(), String> {
        let ids: Vec<String> = self.running.lock().map_err(|error| error.to_string())?
            .keys().cloned().collect();
        let mut last = Ok(());
        for id in ids { if let Err(error) = self.stop(&id) { last = Err(error); } }
        last
    }

    pub fn stop(&self, id: &str) -> Result<(), String> {
        let _lock = EngineLock::acquire(id)?;
        let mut running = self.running.lock().map_err(|error| error.to_string())?;
        if let Some(mut live) = running.remove(id) {
            live.process.stop(Duration::from_secs(5))?;
            process::remove_pidfile(&live.pidfile);
        }
        Ok(())
    }

    pub fn status(&self, id: &str) -> EngineStatus {
        if let Ok(mut running) = self.running.lock() {
            if let Some(live) = running.get_mut(id) {
                let tail = live.process.tail();
                return match live.process.try_wait() {
                    Ok(Some(code)) => {
                        process::remove_pidfile(&live.pidfile);
                        EngineStatus {
                            state: if code == 0 { EngineState::Exited } else { EngineState::Crashed },
                            port: Some(live.process.port),
                            log_tail: tail,
                            message: Some(format!("engine exited with code {code}")),
                        }
                    }
                    Ok(None) if process::reachable(live.process.port) => EngineStatus {
                        state: EngineState::Running,
                        port: Some(live.process.port),
                        log_tail: tail,
                        message: None,
                    },
                    Ok(None) => EngineStatus {
                        state: EngineState::Starting,
                        port: Some(live.process.port),
                        log_tail: tail,
                        message: Some("Waiting for /v1/models".to_string()),
                    },
                    Err(error) => EngineStatus {
                        state: EngineState::Crashed,
                        port: Some(live.process.port),
                        log_tail: tail,
                        message: Some(error),
                    },
                };
            }
        }
        let installed = paths::engine_dir(id)
            .map(|dir| dir.join("version").is_file())
            .unwrap_or(false);
        EngineStatus {
            state: if installed { EngineState::Installed } else { EngineState::NotInstalled },
            port: None,
            log_tail: Vec::new(),
            message: None,
        }
    }
}
