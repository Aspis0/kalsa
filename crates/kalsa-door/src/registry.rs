//! The registry: every job this door has, running or kept. It decides how
//! many answers may exist at once and when a kept answer is forgotten.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::Arc;
use std::time::Instant;

use crate::jobs::Job;
use crate::token::Token;
use crate::{MAX_JOBS, TOKEN_BYTES};

pub(super) struct Registry {
    jobs: Mutex<HashMap<[u8; 16], Arc<Job>>>,
}

#[derive(Debug)]
pub(super) enum StartRefused {
    /// The machine could not produce 128 random bits.
    Entropy,
    /// Every job slot holds an answer that has not finished.
    Busy,
}

impl Registry {
    pub(super) fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
        }
    }

    pub(super) fn start(
        &self,
        owner: [u8; TOKEN_BYTES],
        head: Vec<u8>,
    ) -> Result<Arc<Job>, StartRefused> {
        let token = Token::mint().map_err(|_| StartRefused::Entropy)?;
        let job = Arc::new(Job::new(token, owner, head));
        let mut jobs = self.lock();
        if jobs.len() >= MAX_JOBS && Self::make_room(&mut jobs).is_none() {
            return Err(StartRefused::Busy);
        }
        jobs.insert(job.token().key(), Arc::clone(&job));
        Ok(job)
    }

    /// The oldest finished job leaves; a running one never does. Expired
    /// answers go first, so a full registry's dead weight never survives a
    /// new arrival.
    fn make_room(jobs: &mut HashMap<[u8; 16], Arc<Job>>) -> Option<()> {
        let now = Instant::now();
        let expired: Vec<[u8; 16]> = jobs
            .iter()
            .filter(|(_, job)| job.expired(now))
            .map(|(key, _)| *key)
            .collect();
        if !expired.is_empty() {
            for key in expired {
                jobs.remove(&key);
            }
            return Some(());
        }
        let oldest = jobs
            .iter()
            .filter_map(|(key, job)| job.finished().map(|at| (at, *key)))
            .min_by_key(|(at, _)| *at)
            .map(|(_, key)| key);
        oldest.map(|key| {
            jobs.remove(&key);
        })
    }

    pub(super) fn find(&self, token: &Token) -> Option<Arc<Job>> {
        self.lock().get(&token.key()).cloned()
    }

    /// Drops kept answers whose retention ran out. Runs on the reaper
    /// thread, so a door nobody talks to still forgets on time.
    pub(super) fn reap(&self) {
        let now = Instant::now();
        let mut jobs = self.lock();
        let expired: Vec<[u8; 16]> = jobs
            .iter()
            .filter(|(_, job)| job.expired(now))
            .map(|(key, _)| *key)
            .collect();
        for key in expired {
            jobs.remove(&key);
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<[u8; 16], Arc<Job>>> {
        self.jobs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn owner() -> [u8; TOKEN_BYTES] {
        [7u8; TOKEN_BYTES]
    }

    fn head() -> Vec<u8> {
        b"HTTP/1.1 200 OK\r\n\r\n".to_vec()
    }

    fn token_of(job: &Job) -> Token {
        Token::from_hex(job.token().hex().as_bytes()).unwrap()
    }

    #[test]
    fn the_registry_evicts_the_oldest_finished_job_first() {
        let registry = Registry::new();
        let mut jobs = Vec::new();
        for _ in 0..MAX_JOBS {
            jobs.push(registry.start(owner(), head()).unwrap());
        }
        jobs[0].close(crate::jobs::Status::Done);
        jobs[1].close(crate::jobs::Status::Done);
        std::thread::sleep(Duration::from_millis(5));
        jobs[MAX_JOBS - 1].close(crate::jobs::Status::Done);
        // Full: the oldest finished job leaves; the running ones and the
        // newer finished one stay.
        registry.start(owner(), head()).unwrap();
        assert!(registry.find(&token_of(&jobs[0])).is_none());
        assert!(registry.find(&token_of(&jobs[MAX_JOBS - 1])).is_some());
        assert!(
            registry.find(&token_of(&jobs[2])).is_some(),
            "a running job is never evicted"
        );
    }

    #[test]
    fn the_reaper_drops_only_kept_answers_past_retention() {
        // The retention is ten minutes, and the number is under guarantee,
        // anchored in absolute minutes: five minutes old is still kept,
        // fifteen minutes old is forgotten, a running job is never touched.
        let registry = Registry::new();
        let running = registry.start(owner(), head()).unwrap();
        let recent = registry.start(owner(), head()).unwrap();
        let stale = registry.start(owner(), head()).unwrap();
        recent.close(crate::jobs::Status::Done);
        stale.close(crate::jobs::Status::Done);
        recent.age_finished_to(Instant::now() - Duration::from_secs(5 * 60));
        stale.age_finished_to(Instant::now() - Duration::from_secs(15 * 60));
        registry.reap();
        assert!(
            registry.find(&token_of(&running)).is_some(),
            "a running job is never reaped"
        );
        assert!(
            registry.find(&token_of(&recent)).is_some(),
            "a five-minute-old answer is still kept"
        );
        assert!(
            registry.find(&token_of(&stale)).is_none(),
            "a fifteen-minute-old answer is dropped"
        );
    }
}
