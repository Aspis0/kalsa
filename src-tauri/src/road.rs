//! The second road to the door: iroh, and the executor it lives on.
//!
//! The road follows the door's lifecycle exactly: an attempt opens when a
//! new door is started, an open road is dropped when the door is, and the
//! same door never restarts it. It is additive by contract — the door has
//! roads already (the tunnel in front of this app, Tailscale Serve) — so a
//! road that cannot open never fails anything: the outcome lands here as a
//! state the Advanced panel can say in words, while the door keeps serving.
//!
//! Why one process-wide runtime: `brain_state` is polled once a second, and
//! an attempt that built a tokio runtime per poll would spawn and abandon
//! threads every second — a consumption defect on the machines this product
//! serves. The bridge's own tasks also outlive the call that started them
//! (the accept loop runs until the door dies), so the executor must outlive
//! them too. It is created on first use, never torn down, and idles on two
//! parked worker threads when no road is open. Dropping a bridge is safe
//! from any thread: it aborts the accept loop and the endpoint finishes
//! closing on this same runtime, which lives to the end of the process.
//!
//! An attempt carries the road's generation: if the door died or was
//! replaced while the attempt was in flight, the outcome belongs to nobody
//! and is dropped unapplied — a ghost must not resurrect a closed road.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use kalsa_iroh::{AddressBook, Bridge, BridgeConfig, RelayChoice};

/// How long an attempt may take before it is declared unavailable. The
/// bridge bounds its own dials; this bounds the whole opening.
const OPEN_BUDGET: Duration = Duration::from_secs(15);

/// What the panel says when the switch has the road off — the owner's own
/// choice, not a failure, so the words name it as one.
pub(crate) const OFF_SENTENCE: &str =
    "The internet road is turned off. The phone reaches this computer the Tailscale way.";

/// Where the node's secret key lives: beside the pairing file, the same
/// neighborhood as `door.port`. The bytes in it never travel; the public id
/// they imply is what the phone dials.
pub(crate) fn key_path(pairing_file: &Path) -> PathBuf {
    pairing_file.with_file_name("iroh-node.key")
}

/// The road, as the panel may say it. Pure data: it is cloned out for
/// observation, and the bridge never rides in it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum RoadState {
    /// No door to serve: there is nothing for the road to be.
    Closed,
    /// An attempt is running on the shared runtime.
    Opening,
    /// Open: `node_id` is the public identity the phone dials.
    Open { node_id: String },
    /// This road is not available on this machine. The other roads are.
    Unavailable,
}

/// What the road is, plus the bridge it is open with. The bridge lives next
/// to the state — never inside the observable snapshot — so closing the road
/// drops it, and its Drop is what closes the endpoint.
struct LiveRoad {
    state: RoadState,
    #[allow(dead_code)] // never read; held for its Drop, which closes the endpoint
    bridge: Option<Bridge>,
}

/// How an attempt builds its bridge. Production keeps the crate's measured
/// defaults; the full-loop test opens the road offline — relays off,
/// addresses through one shared in-process book — which is the crate's own
/// seam for exactly that.
struct Shaping {
    relay: RelayChoice,
    book: Option<AddressBook>,
}

impl Shaping {
    fn production() -> Self {
        Self {
            relay: RelayChoice::N0Public,
            book: None,
        }
    }

    fn apply(&self, config: BridgeConfig) -> BridgeConfig {
        let config = config.with_relay(self.relay.clone());
        match &self.book {
            Some(book) => config.with_address_book(book.clone()),
            None => config,
        }
    }
}

pub(crate) struct Road {
    live: Mutex<LiveRoad>,
    /// How many attempts or closures this road has seen. An attempt owns the
    /// number it was given; anything that arrives under an older number is
    /// the ghost of a door already gone.
    epoch: AtomicU64,
    shaping: Shaping,
}

impl Road {
    pub(crate) fn new() -> Self {
        Self::with_shaping(Shaping::production())
    }

    /// A road whose bridges never touch a relay and resolve peers through
    /// the shared in-process book: how the full-loop test reaches the door
    /// the app actually started, without any network.
    #[cfg(test)]
    pub(crate) fn offline(book: AddressBook) -> Self {
        Self::with_shaping(Shaping {
            relay: RelayChoice::Disabled,
            book: Some(book),
        })
    }

    fn with_shaping(shaping: Shaping) -> Self {
        Self {
            live: Mutex::new(LiveRoad {
                state: RoadState::Closed,
                bridge: None,
            }),
            epoch: AtomicU64::new(0),
            shaping,
        }
    }

    pub(crate) fn snapshot(&self) -> RoadState {
        self.live
            .lock()
            .ok()
            .map(|live| live.state.clone())
            .unwrap_or(RoadState::Closed)
    }

    /// The road, in words for being human. The node id is public — it is
    /// made to be shown; no secret state of this road ever reaches a
    /// sentence, a log meant for the screen, or an event payload.
    pub(crate) fn sentence(&self) -> String {
        match self.snapshot() {
            RoadState::Closed => "The internet road is waiting for the server to run.".to_string(),
            RoadState::Opening => "The internet road is opening.".to_string(),
            RoadState::Open { node_id } => {
                format!("The internet road is open. The phone can find this computer by {node_id}.")
            }
            RoadState::Unavailable => "The internet road could not open on this computer. The other roads to it still work.".to_string(),
        }
    }

    /// Starts an attempt: the state goes to Opening and the caller's attempt
    /// is identified by the returned generation. The generation moves under
    /// the same lock as the state: a begin and a close interleaved between
    /// bump and write once left the road Opening forever against a door
    /// already closed.
    pub(crate) fn begin(&self) -> u64 {
        let Ok(mut live) = self.live.lock() else {
            // A poisoned road serves nobody; the attempt is still numbered,
            // so its outcome is a ghost wherever it lands.
            return self.epoch.fetch_add(1, Ordering::SeqCst) + 1;
        };
        let epoch = self.epoch.fetch_add(1, Ordering::SeqCst) + 1;
        *live = LiveRoad {
            state: RoadState::Opening,
            bridge: None,
        };
        epoch
    }

    /// Applies an attempt's outcome, unless the road was closed or restarted
    /// since: an outcome under an older generation belongs to a door that no
    /// longer exists and is dropped whole.
    pub(crate) fn finish(&self, epoch: u64, opened: Option<Bridge>) {
        // One check, under the lock: begin and close bump the generation
        // while holding it, so an epoch read here cannot race a state write.
        let Ok(mut live) = self.live.lock() else {
            return;
        };
        if self.epoch.load(Ordering::SeqCst) != epoch {
            return;
        }
        {
            *live = match opened {
                Some(bridge) => LiveRoad {
                    state: RoadState::Open {
                        node_id: bridge.node_id().to_string(),
                    },
                    bridge: Some(bridge),
                },
                None => LiveRoad {
                    state: RoadState::Unavailable,
                    bridge: None,
                },
            };
        }
    }

    /// The door is gone: any open bridge is dropped here (its Drop closes
    /// the endpoint) and any in-flight attempt is cancelled by its
    /// generation.
    pub(crate) fn close(&self) {
        // The generation moves under the same lock as the state: see begin.
        let Ok(mut live) = self.live.lock() else {
            return;
        };
        self.epoch.fetch_add(1, Ordering::SeqCst);
        // Assigning drops the bridge, if one was open; its Drop is what
        // stops the accept loop and closes the endpoint.
        *live = LiveRoad {
            state: RoadState::Closed,
            bridge: None,
        };
    }
}

/// Opens a road toward `door`, which must be the address the running door
/// itself reported. The attempt runs on the shared runtime: the caller — a
/// once-a-second poll — returns at once and reads the outcome when it lands.
pub(crate) fn open(road: &Arc<Road>, door: SocketAddr, key_path: PathBuf) {
    let epoch = road.begin();
    let shaping = Shaping {
        relay: road.shaping.relay.clone(),
        book: road.shaping.book.clone(),
    };
    runtime().spawn({
        let road = Arc::clone(road);
        async move {
            let config = shaping.apply(kalsa_iroh::BridgeConfig::new(door));
            let attempt = tokio::time::timeout(OPEN_BUDGET, Bridge::start(config, &key_path)).await;
            let opened = match attempt {
                Ok(Ok(bridge)) => Some(bridge),
                Ok(Err(error)) => {
                    // For the log only: errors carry no secrets, but the
                    // panel speaks human, not transport.
                    eprintln!("kalsa-brain: internet road unavailable: {error}");
                    None
                }
                Err(_) => {
                    eprintln!("kalsa-brain: internet road did not open within its budget");
                    None
                }
            };
            road.finish(epoch, opened);
        }
    });
}

pub(crate) fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("the road's runtime could not be built")
    })
}

#[cfg(test)]
mod tests {
    use std::net::{Ipv4Addr, SocketAddr};

    use super::{Road, RoadState, runtime};

    #[test]
    fn an_outcome_from_a_closed_road_is_a_ghost_and_is_dropped() {
        // The door died while the attempt was in flight: the attempt must
        // not mark a closed road unavailable — the road belongs to a door
        // that no longer exists.
        let road = Road::new();
        let epoch = road.begin();
        road.close();
        road.finish(epoch, None);
        assert!(matches!(road.snapshot(), RoadState::Closed));
    }

    #[test]
    fn an_outcome_from_a_replaced_attempt_is_dropped_too() {
        let road = Road::new();
        let ghost = road.begin();
        let current = road.begin();
        assert_ne!(ghost, current);
        road.finish(ghost, None);
        assert!(
            matches!(road.snapshot(), RoadState::Opening),
            "a ghost outcome overwrote the attempt that is current"
        );
        road.finish(current, None);
        assert!(matches!(road.snapshot(), RoadState::Unavailable));
    }

    #[test]
    fn an_open_road_reports_its_bridges_node_id_and_closes_with_the_road() {
        // A real bridge, with relays disabled: the endpoint binds locally
        // and no internet is touched — the same way the crate's own
        // round-trip test runs. This is the success path of an attempt.
        let road = std::sync::Arc::new(Road::new());
        let key = std::env::temp_dir().join(format!(
            "kalsa-brain-road-node-{}.key",
            std::process::id()
        ));
        let epoch = road.begin();
        let door = SocketAddr::from((Ipv4Addr::LOCALHOST, 8131));
        let bridge = runtime()
            .block_on(async {
                kalsa_iroh::Bridge::start(
                    kalsa_iroh::BridgeConfig::new(door)
                        .with_relay(kalsa_iroh::RelayChoice::Disabled),
                    &key,
                )
                .await
            })
            .expect("a relayless bridge binds locally");
        let node_id = bridge.node_id().to_string();
        road.finish(epoch, Some(bridge));
        assert_eq!(
            road.snapshot(),
            RoadState::Open { node_id: node_id.clone() },
        );
        assert!(
            road.sentence().contains(&node_id),
            "an open road does not name the identity the phone dials"
        );
        road.close();
        assert!(matches!(road.snapshot(), RoadState::Closed));
        let _ = std::fs::remove_file(&key);
    }

    #[test]
    fn the_road_says_itself_in_words_a_human_can_act_on() {
        let road = Road::new();
        assert_eq!(road.sentence(), "The internet road is waiting for the server to run.");
        road.begin();
        assert_eq!(road.sentence(), "The internet road is opening.");
        road.close();
        let epoch = road.begin();
        road.finish(epoch, None);
        assert_eq!(
            road.sentence(),
            "The internet road could not open on this computer. The other roads to it still work."
        );
    }
}
