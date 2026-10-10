use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::sanitize;

pub(super) const QUEUE_CAP: usize = 50;
const DEAD_CAP: usize = 100;
const DEAD_TTL: u64 = 30 * 24 * 60 * 60;
/// A queued report that never reaches a server is dropped, not dead-lettered,
/// one month after it was enqueued.
const QUEUE_TTL: u64 = 30 * 24 * 60 * 60;
/// How long a report that owes an automatic log upload waits past its
/// enqueue before the log is read. The crash lines are already in the file
/// when the report is enqueued; what the wait buys is the restart's own
/// lines, written while the walk it runs is still going.
const LOG_SETTLE: u64 = 5;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Item {
    pub(super) report: Value,
    pub(super) attempts: u8,
    pub(super) ready_at: u64,
    #[serde(default)]
    pub(super) enqueued_at: u64,
    #[serde(default)]
    pub(super) offline_streak: u8,
    #[serde(default)]
    pub(super) in_flight: bool,
    /// A serious report owes the redacted log an automatic upload before it
    /// goes out; cleared once the log is stored, refused, or sent without.
    #[serde(default)]
    pub(super) log_pending: bool,
}

impl Item {
    /// Mirrors the attempt counter into the report, keeping the field inside
    /// the wire contract's 1-5: between dispatches the counter can sit at 0,
    /// a value the contract forbids and the sanitizer strips.
    pub(super) fn stamp_attempt(&mut self) {
        let Some(context) = self
            .report
            .get_mut("context")
            .and_then(Value::as_object_mut)
        else {
            return;
        };
        if self.attempts == 0 {
            context.remove("attempt");
        } else {
            context.insert("attempt".into(), self.attempts.into());
        }
    }

    /// Whether the item may be dispatched now. A report that owes an
    /// automatic log upload waits past its enqueue, so the crash lines are
    /// in the log before the upload reads it.
    pub(super) fn ready(&self, now: u64) -> bool {
        self.ready_at <= now
            && (!self.log_pending || self.enqueued_at.saturating_add(LOG_SETTLE) <= now)
    }
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
    /// The UTC day the automatic log uploads below were counted against.
    #[serde(default)]
    log_day: String,
    #[serde(default)]
    log_uploads: u8,
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
            log_day: String::new(),
            log_uploads: 0,
            dir: PathBuf::new(),
        });
        store.dir = dir;
        if damaged || store.dir.join("off").try_exists().unwrap_or(true) {
            store.enabled = false;
        }
        let now = super::now();
        store.queue = store
            .queue
            .into_iter()
            .filter_map(|mut item| {
                // State written before the stamp existed starts its window now,
                // so an upgrade never drops a pending report outright.
                if item.enqueued_at == 0 {
                    item.enqueued_at = now;
                }
                if item.in_flight {
                    // The dispatch that persisted this marker never returned
                    // an answer, so its pre-dispatch bump is undone.
                    item.attempts = item.attempts.saturating_sub(1);
                    item.in_flight = false;
                    item.stamp_attempt();
                }
                item.report = sanitize::report(&item.report)?;
                (item.enqueued_at.saturating_add(QUEUE_TTL) > now).then_some(item)
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

    pub(super) fn enqueue(&mut self, report: Value, log_pending: bool, ready_at: u64) {
        if !self.enabled {
            return;
        }
        self.queue.push(Item {
            report,
            attempts: 0,
            ready_at,
            enqueued_at: super::now(),
            offline_streak: 0,
            in_flight: false,
            log_pending,
        });
        self.queue
            .drain(..self.queue.len().saturating_sub(QUEUE_CAP));
    }

    /// The running process's half of load's expiry filter: drops reports
    /// past their enqueue window. True when the queue changed, so the caller
    /// persists only when there is something to persist.
    pub(super) fn expire(&mut self, now: u64) -> bool {
        let kept = self.queue.len();
        self.queue
            .retain(|item| item.enqueued_at.saturating_add(QUEUE_TTL) > now);
        self.queue.len() != kept
    }

    /// Whether an automatic log upload is still inside `cap` for this UTC
    /// day. A day the store has not counted yet starts a fresh budget.
    pub(super) fn log_budget_left(&self, day: &str, cap: u8) -> bool {
        if self.log_day != day {
            return true;
        }
        self.log_uploads < cap
    }

    /// Counts one automatic log upload against its day's budget.
    pub(super) fn note_log_upload(&mut self, day: &str) {
        if self.log_day != day {
            self.log_day = day.to_string();
            self.log_uploads = 0;
        }
        self.log_uploads = self.log_uploads.saturating_add(1);
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
