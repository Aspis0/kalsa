//! The suspected-orphan record: `<state file>.orphan`, the file a stop
//! leaves behind when it could NOT prove absence with positive evidence
//! (§9: "plus a suspected-orphan record the next start recovers or
//! replaces"). The measures it carries are the same ones the failed-to-stop
//! state reports — what was walked, what the pid said, what the port said —
//! because the record is the half of the proof this stop could not finish,
//! handed to the NEXT one.
//!
//! Its own file, never the state file: an adopted blind stop leaves the
//! state file locked by the heir that is still running, and this record must
//! be writable and clearable regardless of who holds that lock. Nothing in
//! this module ever writes the state file.
//!
//! The two sentences the start side reads off it:
//! - port SILENT -> RECOVERED: there was nothing; the record is deleted
//!   before the start goes on, whatever that start then does.
//! - port ANSWERING -> the start's own adoption decides (it adopts by port
//!   and health as it already does): the record is deleted once an instance
//!   of ours is alive, and KEPT when the start fails with something else
//!   still holding the port — the suspicion is still open.

use std::io;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::presence::{self, Presence};

pub(crate) struct Suspect {
    path: PathBuf,
}

impl Suspect {
    /// The record that belongs to this state file: `<state file>.orphan`.
    pub(crate) fn of(state_file: &Path) -> Self {
        let mut path = state_file.as_os_str().to_owned();
        path.push(".orphan");
        Self { path: PathBuf::from(path) }
    }

    /// Writes (overwrites) the suspicion with this stop's measures. Failure
    /// to record is not a reason to fail the stop — the state above it is
    /// already carrying the same measures — so the caller ignores it.
    pub(crate) fn write(&self, measures: &str) -> io::Result<()> {
        std::fs::write(&self.path, format!("{measures}\n"))
    }

    /// Drops the record: recovered (there was nothing) or replaced (an
    /// instance of ours is alive again).
    pub(crate) fn clear(&self) {
        let _ = std::fs::remove_file(&self.path);
    }

    pub(crate) fn exists(&self) -> bool {
        self.path.exists()
    }

    /// The start side, before anything else the start does: a port that
    /// REFUSES means the suspected engine is not there — the record is
    /// recovered (deleted) and the start proceeds with nothing owed. A port
    /// that answers (or cannot be decided) keeps the record standing for the
    /// adoption that follows to replace. Returns whether it recovered.
    pub(crate) fn settle_before_start(&self, addr: SocketAddr, timeout: Duration) -> bool {
        if !self.exists() {
            return false;
        }
        if presence::probe(addr, timeout) == Presence::Gone {
            self.clear();
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn temp_state(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("kalsa-suspect-test-{name}.state"))
    }

    #[test]
    fn the_record_lives_beside_the_state_file_and_round_trips() {
        let state = temp_state("roundtrip");
        let _ = std::fs::remove_file(&state);
        let suspect = Suspect::of(&state);
        let _ = std::fs::remove_file(&suspect.path);
        assert!(
            suspect.path.ends_with("kalsa-suspect-test-roundtrip.state.orphan"),
            "the record is not beside its state file: {:?}",
            suspect.path
        );
        assert!(!suspect.exists(), "a record appeared from nowhere");
        suspect.write("walk: adopted blind; port — There").expect("write the suspicion");
        assert!(suspect.exists());
        assert!(
            std::fs::read_to_string(&suspect.path)
                .expect("read it back")
                .contains("adopted blind"),
            "the measures did not survive the round trip"
        );
        suspect.clear();
        assert!(!suspect.exists(), "clear left the record behind");
        let _ = std::fs::remove_file(&state);
    }

    #[test]
    fn a_silent_port_recovers_the_record_and_an_answering_port_keeps_it() {
        // Silent: bind, note the port, close it — the probe is refused.
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("address");
        let state = temp_state("silent");
        let suspect = Suspect::of(&state);
        suspect.write("walk: ...").expect("write");
        drop(listener);
        assert!(
            suspect.settle_before_start(addr, presence::PROBE_TIMEOUT),
            "a refusing port did not recover the record"
        );
        assert!(!suspect.exists(), "the recovered record is still standing");

        // Answering: a listener holds the port — the suspicion stands for
        // the adoption to replace.
        let listener = TcpListener::bind(addr).expect("rebind");
        suspect.write("walk: ...").expect("write again");
        assert!(
            !suspect.settle_before_start(addr, presence::PROBE_TIMEOUT),
            "an answering port was read as recovery"
        );
        assert!(suspect.exists(), "the record vanished before an adoption could replace it");
        suspect.clear();
        let _ = std::fs::remove_file(&state);
        drop(listener);
    }
}
