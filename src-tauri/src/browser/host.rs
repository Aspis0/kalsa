//! The sidecar, and the one call at a time it is given.
//!
//! The sidecar is started the way the mailbox starts its own: through
//! `kalsa_mcp::launch::SealedStdioLauncher`, with its bytes checked against a
//! digest by `program`, its tool definitions pinned by `tool_pins`, and its
//! environment reduced to what a browser needs and nothing else (`server_env`).
//! What is new here is only the lifetime: a mailbox sidecar is opened for a
//! call and dropped at the end of it, while a browser is a thing a person looks
//! at, so it lives from the first tool call until the window closes.
//!
//! **The slot is a state, not an `Option`.** The earlier shape took the host out
//! of the slot for the length of a call, which left nothing to say "a call is
//! already running" except that the slot was empty — and an empty slot was also
//! what a session that had been ended looked like. Two calls could therefore
//! each decide they were the first. `Slot` says which of the four things is
//! true, and every move out of it is one `mem::replace`, so there is no window
//! in which two callers both believe they are alone with the browser.
//!
//! **The lock is held only for the move**, never across `host.call().await`. A
//! call owns its host while it runs, and `end()` from a window event cannot
//! wait for it.

use std::path::Path;
use std::sync::Mutex;
use tokio::sync::watch;

use kalsa_mcp::host::Host;
use kalsa_mcp::launch::SealedStdioLauncher;
use kalsa_mcp::outcome::CallOutcome;
use kalsa_mcp::record::{ServerRecord, Trust};
use kalsa_mcp::registry::Registry;
use kalsa_mcp::server_id::ServerId;
use serde_json::{Map, Value};

use super::error::BrowserError;
use super::program;
use super::{server_env, tool_pins, SERVER};

/// The conversation name every browser call runs under. A browser has no mailbox
/// to carry state in, so this is the same constant the mailbox uses.
const CONVERSATION: &str = "browser";

/// What is true of the browser right now.
///
/// Generic over the sidecar so the moves are proved without starting one: the
/// transitions are the whole of this type and none of them are I/O.
#[derive(Debug)]
struct Slot<H> {
    state: State,
    /// Which call owns the browser right now. A call takes it with the host and
    /// hands it back, so a call whose number no longer matches has been
    /// superseded and must drop what it was holding — which is the whole of a
    /// close during a call, with no window in which it could put the host back.
    taken: u64,
    host: Option<H>,
}

/// The four things that can be true of the browser.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    /// Nothing has been started, or a session was ended and nothing has started
    /// since. A call may start one.
    Idle,
    /// A call owns the sidecar and is running. A second call is refused.
    Busy,
    /// A session is open and idle.
    Open,
    /// A session was ended while a call was running. The call drops its host on
    /// the way out instead of putting it back, and the child dies with it.
    Closing,
}

/// What a call holds while it runs: the host, and the number that says it is
/// still the call the browser is waiting for.
#[derive(Debug)]
struct Lease<H> {
    host: H,
    gen: u64,
}

impl<H> Slot<H> {
    fn idle() -> Self {
        Self { state: State::Idle, taken: 0, host: None }
    }

    /// A call arrives: `Open` becomes `Busy` and hands the host over, `Idle`
    /// becomes `Busy` and asks for a new one, and anything else is refused.
    ///
    /// A browser that would not start puts the slot back to `Idle`, so a missing
    /// driver is an answer to this call and not a browser that is busy for ever.
    fn take(&mut self, open: impl FnOnce() -> Result<H, BrowserError>) -> Result<Lease<H>, BrowserError> {
        if !matches!(self.state, State::Open | State::Idle) {
            // A call already owns the browser, and one has been asked to end.
            // Both are the same answer to the person: Kalsa is busy.
            return Err(BrowserError::Busy);
        }
        let existing = self.host.take();
        self.taken += 1;
        let gen = self.taken;
        self.state = State::Busy;
        let host = match existing {
            Some(host) => host,
            None => match open() {
                Ok(host) => host,
                Err(refused) => {
                    self.state = State::Idle;
                    return Err(refused);
                }
            },
        };
        Ok(Lease { host, gen })
    }

    /// The call is finished with its host. It goes back only if it is still the
    /// call the browser is waiting for; otherwise it is dropped, which is what
    /// kills the child (`kill_on_drop` is set on it in
    /// `kalsa-mcp/src/launch.rs:101`), and the slot returns to `Idle` — a host
    /// being dropped leaves no session behind, and a slot left at `Closing` would
    /// refuse every later call for the life of the window.
    fn give_back(&mut self, lease: Lease<H>) -> bool {
        if self.state == State::Busy && self.taken == lease.gen {
            self.host = Some(lease.host);
            self.state = State::Open;
            return true;
        }
        drop(lease);
        self.state = State::Idle;
        false
    }

    /// The session ends. An open host is handed out to be dropped, which is what
    /// ends it — so the slot is **`Idle`**, not `Closing`: nothing is running,
    /// and the person may open another browser. A running call is marked instead,
    /// because its host is not reachable from here, and `Closing` refuses a call
    /// while that call is on its way out.
    fn end(&mut self) -> Option<H> {
        let running = self.state == State::Busy;
        let host = self.host.take();
        self.state = if running { State::Closing } else { State::Idle };
        host
    }

    /// Whether a session exists in any form, which is what `Clear` asks: a
    /// running call and an ended-but-not-yet-returned one are both sessions
    /// whose profile folder is still being written.
    fn is_open(&self) -> bool {
        self.state != State::Idle
    }
}

pub(crate) struct Browser {
    slot: Mutex<Slot<Host<SealedStdioLauncher>>>,
    /// **The kill handle for the call that is running.** A generation counter,
    /// raised by `end` and watched by every call in flight: a Stop on a window
    /// with a slow page in it comes back at once, and the lease that call is
    /// holding is dropped on the way out — which is what kills the sidecar child,
    /// because the launcher kills on drop.
    ///
    /// A counter rather than a flag, because the slot comes back into use: a Stop
    /// that ended the window must not cancel the next browser the person opens.
    stop: watch::Sender<u64>,
}

impl Default for Browser {
    fn default() -> Self {
        Self { slot: Mutex::new(Slot::idle()), stop: watch::Sender::new(0) }
    }
}

impl Browser {
    /// Calls one tool on the browser, starting the sidecar if this is the first
    /// call since the window opened.
    pub(crate) async fn call(
        &self,
        app_data: &Path,
        tool: &str,
        args: Map<String, Value>,
    ) -> Result<String, BrowserError> {
        // **The generation is read before the lease is taken.** Taking the lease
        // first leaves a window in which a Stop lands and this call has already
        // decided it is not the one being stopped — it reads a generation that
        // includes the Stop and carries on to wait for a later one that will
        // never come. Subscribing first means a Stop between here and the lease
        // is simply a generation this call has already seen.
        let mut stopped = self.stop.subscribe();
        let seen = *stopped.borrow_and_update();
        let mut lease = self.locked().take(|| start(app_data))?;
        let ran = tokio::select! {
            biased;
            _ = wait_for_stop(&mut stopped, seen) => None,
            outcome = lease.host.call(CONVERSATION, tool, args) => Some(outcome),
        };
        // Put it back whatever came out, so one refused page does not cost the
        // person their whole session — unless the session was ended meanwhile,
        // in which case it is dropped and the child dies with it. The Stop path
        // is exactly that case: the lease goes, the child with it, and the next
        // call opens a fresh browser.
        if !self.locked().give_back(lease) {
            log::info!("browser sidecar: dropped, the session was ended during the call");
        }
        let Some(outcome) = ran else {
            log::info!("browser sidecar: the call was cut short by a Stop");
            return Err(BrowserError::Stopped);
        };
        match outcome.map_err(|error| {
            log::warn!("browser sidecar: {error:?}");
            BrowserError::Failed
        })? {
            CallOutcome::Ran(result) => {
                if result.is_error {
                    return Err(BrowserError::Refused);
                }
                Ok(result.for_model.join("\n"))
            }
            // Nothing the chat offers in this step needs an answer from a person.
            CallOutcome::NeedsConfirmation(_) => Err(BrowserError::Busy),
        }
    }

    /// Ends the session. Called when the window closes and when the app quits;
    /// whichever gets there first ends the same browser, and a second call is
    /// not an error.
    pub(crate) fn end(&self) {
        // **Raise the kill handle first, and without waiting for the slot.** A
        // call in flight holds its lease and cannot be reached from here, so
        // this is the only thing that can interrupt it; the slot is taken after,
        // and a call that was already on its way out finds the slot not there.
        self.stop.send_modify(|generation| *generation += 1);
        drop(self.locked().end());
    }

    /// Whether a session is open, so `Clear Kalsa's browser data` can refuse
    /// rather than empty a profile folder out from under a running browser.
    pub(crate) fn is_open(&self) -> bool {
        self.locked().is_open()
    }

    /// **Interrupts the call in flight without ending the session.**
    ///
    /// A Pausa pressed while a call is running means "stop what Kalsa is doing",
    /// and the call is what it is doing. Raising the same handle a Stop raises
    /// cuts that call short and gives the slot back; the session stays open, the
    /// person has the window, and the pause that follows has a free slot to be
    /// applied in. Refusing it as "busy" instead would leave the control doing
    /// nothing, which is the one thing a pause must never be.
    pub(crate) fn interrupt(&self) {
        self.stop.send_modify(|generation| *generation += 1);
    }

    /// The slot, for the length of one move and no longer.
    fn locked(&self) -> std::sync::MutexGuard<'_, Slot<Host<SealedStdioLauncher>>> {
        self.slot.lock().expect("the session slot is not poisoned")
    }
}

/// Whether the Stop that raised the generation is this call's to answer.
///
/// The notification is created before the generation is read, so a Stop landing
/// between the two wakes this rather than being waited for by a call that has
/// already started.
async fn wait_for_stop(stopped: &mut watch::Receiver<u64>, seen: u64) {
    loop {
        if *stopped.borrow_and_update() != seen {
            return;
        }
        // A sender gone with the browser is itself an ending.
        if stopped.changed().await.is_err() {
            return;
        }
    }
}

/// Starts the host: its bytes checked against the digest they are approved
/// with, its tool definitions pinned, and the driver this host verified named in
/// its environment. The sidecar itself is started by the first `call`, which is
/// what `mail/host.rs` does too.
fn start(app_data: &Path) -> Result<Host<SealedStdioLauncher>, BrowserError> {
    let program = program::current()?;
    let driver = crate::browser::driver::installed(app_data)?;
    let launcher = SealedStdioLauncher::new(server_env::for_driver(&driver));
    let id = ServerId::new(SERVER).map_err(|_| BrowserError::Storage)?;
    let record = ServerRecord::new(id.clone(), program.path.clone(), Trust::FirstParty).map_err(|_| BrowserError::Storage)?;
    let registry = Registry::new(vec![record]).map_err(|_| BrowserError::Storage)?;
    let mut pins = tool_pins::checked_in();
    pins.seed_binary_with_digest(&id, &program.path, &program.sha256);
    Ok(Host::new(registry, launcher, pins))
}

#[cfg(test)]
mod tests {
    use super::{wait_for_stop, BrowserError, Slot, State};
    use std::time::{Duration, Instant};
    use tokio::sync::watch;

    fn open() -> Slot<String> {
        Slot { state: State::Open, taken: 0, host: Some("session".to_owned()) }
    }

    fn idle() -> Slot<String> {
        Slot::idle()
    }

    /// The states are the contract, so the tests read them rather than only the
    /// error a refusal happens to carry.
    fn state<T>(slot: &Slot<T>) -> State {
        slot.state
    }

    /// **Two calls, one browser.** The second sees `Busy` and is refused, and it
    /// is a plain sentence rather than a second host.
    #[test]
    fn a_second_call_while_one_is_running_is_refused_and_never_starts_one() {
        let mut slot = idle();
        assert!(slot.take(|| Ok("new".to_owned())).is_ok());
        assert_eq!(state(&slot), State::Busy, "the running call holds the slot");
        assert!(matches!(slot.take(|| panic!("a second host was started")), Err(BrowserError::Busy)));
        assert_eq!(state(&slot), State::Busy, "and it is still the first call's slot");
    }

    /// An open session is reused, not replaced, and comes back open.
    #[test]
    fn a_finished_call_hands_its_host_back_to_the_session() {
        let mut slot = open();
        let lease = slot.take(|| Ok("new".to_owned())).expect("the open host is reused");
        assert_eq!(lease.host, "session");
        assert_eq!(state(&slot), State::Busy);
        assert!(slot.give_back(lease), "nothing ended it meanwhile");
        assert_eq!(state(&slot), State::Open);
        assert_eq!(slot.take(|| Ok("new".to_owned())).expect("reused").host, "session");
    }

    /// **`end` on an open session leaves the browser `Idle`, not `Closing`.** The
    /// host is gone, so nothing is running and the person may open another one; a
    /// slot left at `Closing` would refuse every later call and every clear for
    /// the life of the window.
    #[test]
    fn end_on_an_open_session_drops_the_host_and_leaves_the_browser_idle() {
        let mut slot = open();
        assert_eq!(slot.end().as_deref(), Some("session"), "the host is handed out to be dropped");
        assert_eq!(state(&slot), State::Idle);
        assert!(!slot.is_open());
        assert!(slot.take(|| Ok("fresh".to_owned())).is_ok(), "and a new browser can start");
    }

    /// **A close during a call leaves no host behind, and a second call during the
    /// close changes nothing.** The call still owns its host, so `end` cannot take
    /// it; it marks the slot instead, and the call's way out drops what it holds.
    /// The generation is what makes that safe: even if the slot has moved on, the
    /// lease can tell that it is not the call the browser is waiting for.
    #[test]
    fn a_close_during_a_call_leaves_no_host_to_survive() {
        let mut slot = idle();
        let lease = slot.take(|| Ok("running".to_owned())).expect("the call took the browser");
        assert_eq!(slot.end(), None, "the call still owns it");
        assert_eq!(state(&slot), State::Closing);

        // A second call while the close is on its way out is refused, and the
        // slot stays put — it does not become Busy-owned and start someone else.
        assert!(matches!(slot.take(|| panic!("a second host was started")), Err(BrowserError::Busy)));
        assert_eq!(state(&slot), State::Closing, "a refused call must not take the slot");

        assert!(!slot.give_back(lease), "the host was put back after the session ended");
        assert_eq!(state(&slot), State::Idle);
        assert!(!slot.is_open());
        assert!(slot.take(|| Ok("fresh".to_owned())).is_ok(), "and the next call starts a new browser");
    }

    /// **The generation, on its own.** A lease whose number the slot has moved
    /// past cannot resurrect its host, even when the state happens to look like a
    /// call's own. This is what a second `take` would produce.
    #[test]
    fn a_lease_from_a_superseded_call_cannot_put_its_host_back() {
        let mut slot = idle();
        let first = slot.take(|| Ok("first".to_owned())).expect("the first call");
        let second = slot.take(|| Ok("second".to_owned()));
        assert!(matches!(second, Err(BrowserError::Busy)), "one call at a time");

        // The slot has moved to a later call than the lease believes.
        slot.taken += 1;
        slot.state = State::Busy;
        assert!(!slot.give_back(first), "a stale lease restored a host");
        assert_eq!(state(&slot), State::Idle);
        assert!(!slot.is_open(), "nothing is left open");
    }

    /// Ending an idle browser leaves it idle: the window event fires on every
    /// close, and none of them may leave a browser that can never start.
    #[test]
    fn ending_an_idle_browser_leaves_it_idle_and_startable() {
        let mut slot = idle();
        assert_eq!(slot.end(), None);
        assert_eq!(state(&slot), State::Idle);
        assert!(!slot.is_open());
        assert!(slot.take(|| Ok("fresh".to_owned())).is_ok());
    }

    /// A browser that would not start is this call's answer and not a browser
    /// that is busy for ever.
    #[test]
    fn a_browser_that_would_not_start_leaves_the_slot_idle() {
        let mut slot = idle();
        assert!(matches!(slot.take(|| Err(BrowserError::Storage)), Err(BrowserError::Storage)));
        assert_eq!(state(&slot), State::Idle);
        assert!(!slot.is_open());
    }

    /// A clear asks whether a session exists in **any** form. A running call is
    /// one, and so is one that has been ended but whose call has not returned.
    #[test]
    fn a_clear_is_refused_for_every_state_that_has_a_browser() {
        assert!(!idle().is_open(), "an idle browser is no browser");
        for one in [State::Busy, State::Open, State::Closing] {
            let slot = Slot::<()> { state: one, taken: 0, host: None };
            assert!(slot.is_open(), "{one:?} is a browser");
        }
    }

    /// **A Stop cuts a call short, and the call that was running is the one that
    /// hears it.** This is the whole of the kill handle: the generation is read
    /// when the lease is taken, so a Stop landing after that is seen, and one
    /// landing before it belongs to a call that had not started — which is the
    /// call the lease refusal already covers.
    #[tokio::test]
    async fn a_stop_ends_the_wait_for_a_call_that_is_running() {
        let (stop, mut stopped) = watch::channel(0_u64);
        let seen = *stopped.borrow_and_update();
        stop.send_modify(|generation| *generation += 1);

        let began = Instant::now();
        tokio::time::timeout(Duration::from_secs(2), wait_for_stop(&mut stopped, seen))
            .await
            .expect("the call is not left waiting on a Stop that has already happened");
        assert!(began.elapsed() < Duration::from_millis(500), "and it is not left waiting at all: {:?}", began.elapsed());
    }

    /// **A Pausa pressed while a call is running is not a refusal.** It raises the
    /// same handle a Stop raises, so the call in flight comes back at once and the
    /// slot is free for the pause to be applied in — the session itself is
    /// untouched, because the person wants the window and not the end of it.
    #[tokio::test]
    async fn a_pause_interrupts_a_running_call_and_leaves_the_session_open() {
        let (stop, mut stopped) = watch::channel(0_u64);
        let seen = *stopped.borrow_and_update();
        // What `brain_browser_pause` does: interrupt, then take the slot.
        stop.send_modify(|generation| *generation += 1);
        tokio::time::timeout(Duration::from_secs(2), wait_for_stop(&mut stopped, seen))
            .await
            .expect("the call is cut short");
        assert!(Slot::<String>::idle().take(|| Ok("session".to_owned())).is_ok(), "and the next thing can have the browser");
    }

    /// **A Stop that has not happened leaves the call alone**, and a Stop that
    /// comes later is the one that ends it: a generation from before this call
    /// is not this call's to answer.
    #[tokio::test]
    async fn a_stop_before_the_call_does_not_end_it_and_a_later_one_does() {
        let (stop, mut stopped) = watch::channel(1_u64);
        let seen = *stopped.borrow_and_update();

        let mut waiting = Box::pin(wait_for_stop(&mut stopped, seen));
        assert!(
            tokio::time::timeout(Duration::from_millis(150), &mut waiting).await.is_err(),
            "nothing has been stopped, so the call carries on"
        );
        stop.send_modify(|generation| *generation += 1);
        tokio::time::timeout(Duration::from_secs(2), waiting).await.expect("and the Stop that came later ends it");
    }

    /// **The counter, not a flag.** The slot comes back into use after an end, so
    /// a Stop that ended one window must not cancel the next browser's call —
    /// which is what a single boolean would do.
    #[tokio::test]
    async fn a_stop_from_the_window_before_does_not_cancel_the_next_one() {
        let (stop, mut stopped) = watch::channel(0_u64);
        stop.send_modify(|generation| *generation += 1);

        // The next call reads the generation **after** the Stop, so it is not
        // waiting on one it never saw.
        let mut stopped = stopped;
        let seen = *stopped.borrow_and_update();
        assert_eq!(seen, 1, "the new call reads where the counter is now");
        assert!(
            tokio::time::timeout(Duration::from_millis(150), wait_for_stop(&mut stopped, seen)).await.is_err(),
            "and nothing ends it"
        );
    }
}
