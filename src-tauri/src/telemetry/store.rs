use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::sanitize;

pub(super) const QUEUE_CAP: usize = 50;
const DEAD_CAP: usize = 100;
const DEAD_TTL: u64 = 30 * 24 * 60 * 60;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Item {
    pub(super) report: Value,
    pub(super) attempts: u8,
    pub(super) ready_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Dead {
    item: Item,
    until: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Store {
    pub(super) enabled: bool,
    pub(super) notice_seen: bool,
    pub(super) queue: Vec<Item>,
    dead: Vec<Dead>,
    seq: u64,
    #[serde(skip)]
    dir: PathBuf,
}

fn durable_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    #[cfg(unix)]
    File::open(
        path.parent()
            .ok_or_else(|| io::Error::other("telemetry directory unavailable"))?,
    )?
    .sync_all()?;
    Ok(())
}

impl Store {
    pub(super) fn load(dir: PathBuf) -> Self {
        let mut selected: Option<Self> = None;
        let mut damaged = false;
        for name in ["state.a", "state.b"] {
            match fs::read(dir.join(name)) {
                Ok(bytes) => match serde_json::from_slice::<Self>(&bytes) {
                    Ok(store) => {
                        if selected.as_ref().is_none_or(|prior| store.seq > prior.seq) {
                            selected = Some(store);
                        }
                    }
                    Err(_) => damaged = true,
                },
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(_) => damaged = true,
            }
        }
        let fresh = selected.is_none() && !dir.join("initialized").exists() && !damaged;
        let mut store = selected.unwrap_or(Self {
            enabled: fresh,
            notice_seen: false,
            queue: Vec::new(),
            dead: Vec::new(),
            seq: 0,
            dir: PathBuf::new(),
        });
        store.dir = dir;
        if damaged || store.dir.join("off").try_exists().unwrap_or(true) {
            store.enabled = false;
        }
        store.queue = store
            .queue
            .into_iter()
            .filter_map(|mut item| {
                item.report = sanitize::report(&item.report)?;
                (item.attempts < 5).then_some(item)
            })
            .collect();
        store
            .queue
            .drain(..store.queue.len().saturating_sub(QUEUE_CAP));
        store.dead = store
            .dead
            .into_iter()
            .filter_map(|mut dead| {
                dead.item.report = sanitize::report(&dead.item.report)?;
                (dead.until > super::now()).then_some(dead)
            })
            .collect();
        store
            .dead
            .drain(..store.dead.len().saturating_sub(DEAD_CAP));
        if !store.enabled {
            store.queue.clear();
        }
        if fresh
            && (fs::create_dir_all(&store.dir)
                .and_then(|_| durable_file(&store.dir.join("initialized"), b"1"))
                .and_then(|_| store.save()))
            .is_err()
        {
            store.enabled = false;
            store.queue.clear();
        }
        store
    }

    pub(super) fn save(&mut self) -> io::Result<()> {
        fs::create_dir_all(&self.dir)?;
        self.seq += 1;
        let bytes = serde_json::to_vec(self)?;
        let target = self.dir.join(if self.seq.is_multiple_of(2) {
            "state.a"
        } else {
            "state.b"
        });
        let tmp = self.dir.join("state.tmp");
        durable_file(&tmp, &bytes)?;
        // Only replace the older slot; the current committed slot survives any interrupted rename.
        match fs::remove_file(&target) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
        fs::rename(tmp, target)?;
        #[cfg(unix)]
        File::open(&self.dir)?.sync_all()?;
        Ok(())
    }

    pub(super) fn set_enabled(&mut self, enabled: bool) -> io::Result<()> {
        self.enabled = false;
        self.queue.clear();
        self.dead.clear();
        fs::create_dir_all(&self.dir)?;
        if !enabled {
            durable_file(&self.dir.join("off"), b"1")?;
            self.save()?;
            // Erase the alternate snapshot too; OFF must leave no persisted reports.
            return self.save();
        }
        self.enabled = true;
        if let Err(error) = self.save() {
            self.enabled = false;
            return Err(error);
        }
        match fs::remove_file(self.dir.join("off")) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => {
                self.enabled = false;
                return Err(e);
            }
        }
        #[cfg(unix)]
        if let Err(error) = File::open(&self.dir).and_then(|f| f.sync_all()) {
            self.enabled = false;
            let _ = durable_file(&self.dir.join("off"), b"1");
            return Err(error);
        }
        Ok(())
    }

    pub(super) fn enqueue(&mut self, report: Value) {
        if !self.enabled {
            return;
        }
        self.queue.push(Item {
            report,
            attempts: 0,
            ready_at: 0,
        });
        self.queue
            .drain(..self.queue.len().saturating_sub(QUEUE_CAP));
    }

    pub(super) fn dead(&mut self, item: Item, now: u64) {
        self.dead.retain(|item| item.until > now);
        self.dead.push(Dead {
            item,
            until: now + DEAD_TTL,
        });
        self.dead.drain(..self.dead.len().saturating_sub(DEAD_CAP));
    }
}
