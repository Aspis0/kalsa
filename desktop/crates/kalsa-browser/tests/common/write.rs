//! The helpers a proof about a write needs: the ref a read printed, the cards
//! the person is asked about, and two sites one window can hold.

use kalsa_browser::hold;
use kalsa_browser::snapshot;
use playwright_rs::protocol::Page;
use std::time::Duration;

use super::{Arrived, File};

/// The ref a read printed for an element, found the way a model finds it.
pub async fn ref_of(page: &Page, name: &str) -> String {
    let read = snapshot::snapshot(page, 1).await.expect("the page reads");
    let line = read.lines().find(|line| line.contains(name) && line.contains('[')).unwrap_or_else(|| {
        panic!("no read line names {name} with a ref:\n{read}")
    });
    let open = line.find('[').expect("a ref");
    let close = line[open..].find(']').expect("a ref") + open;
    line[open + 1..close].to_string()
}

/// The path of an address, which is the only part of it a test may name.
pub fn path_of(url: &str) -> String {
    url::Url::parse(url).map(|parsed| parsed.path().to_string()).unwrap_or_default()
}

/// The request lines, once a POST to a path has arrived and a second one has
/// had its chance to arrive too.
pub async fn wait_for_post(arrived: &Arrived, path: &str) -> Vec<String> {
    wait_for_posts(arrived, path, 1).await
}

/// The request lines, once that many POSTs to a path have arrived and a last
/// one has had its chance to arrive too.
pub async fn wait_for_posts(arrived: &Arrived, path: &str, how_many: usize) -> Vec<String> {
    for _ in 0..100 {
        let lines = arrived.except_icons();
        if lines.iter().filter(|line| line.starts_with(&format!("POST {path}"))).count() >= how_many {
            tokio::time::sleep(Duration::from_millis(200)).await;
            return arrived.except_icons();
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    arrived.except_icons()
}

/// The card the person is asked about, once it is there.
pub async fn wait_for_card(holds: &hold::Holds) -> hold::Card {
    let cards = wait_for_cards(holds, 1).await;
    cards.into_iter().next().expect("a card")
}

/// The cards the person is asked about, once there are that many of them.
pub async fn wait_for_cards(holds: &hold::Holds, how_many: usize) -> Vec<hold::Card> {
    for _ in 0..100 {
        let cards = holds.cards().await;
        if cards.len() >= how_many {
            return cards;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("{how_many} cards were not raised");
}

/// **Two sites, one server.** The same process answers on two host names, and
/// two host names are two different sites to anything that decides by site.
/// `127.0.0.2` is the second name the fixture reaches for, and this machine
/// does not route to it, so the second name is `localhost`.
pub struct Sites {
    /// The site the person is on.
    pub base: String,
    /// The other site, on the same server and the same port.
    pub other: String,
    /// What the server received.
    pub arrived: Arrived,
}

/// The two sites, serving these files.
pub async fn two_sites(files: &[File]) -> Sites {
    let (bound, arrived) = super::serve_on("0.0.0.0", files).await;
    Sites {
        base: bound.replace("0.0.0.0", "127.0.0.1"),
        other: bound.replace("0.0.0.0", "localhost"),
        arrived,
    }
}
