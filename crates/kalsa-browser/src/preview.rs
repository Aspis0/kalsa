//! The picture of the page this browser is showing: one JPEG, bounded, and only
//! for the conversation that owns the page.
//!
//! **Two answers, two readers.** The phone's preview is **host-only**: its tool
//! is answered here and is not in `tools/list`, so no model is offered it —
//! that picture is the person's screen, and it goes to the phone that asked for
//! it and nowhere else.
//!
//! **The model's answer is a separate one.** `browser_screenshot` *is* in
//! `tools/list`, in the turns that may see a picture, and it answers a model
//! that is driving the page. The two answers share the capture and nothing
//! else: the words a refusal carries are written for the reader, and the
//! phone's reader knows its codes without a sentence.

use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use playwright_rs::protocol::{Page, ScreenshotOptions, ScreenshotType};
use rmcp::model::CallToolResult;
use serde_json::{json, Value};

use crate::hold::Holds;
use crate::landing::Landings;
use crate::session::Sessions;
use crate::view;

/// The largest picture that crosses. 256 KiB of JPEG is 349,528 characters of
/// base64, under the half a megabyte the phone's road carries.
pub const MAX_BYTES: usize = 262_144;

/// The JPEG quality the picture is taken at: the picture crosses a phone's
/// road, and a page read on a phone's screen needs no more.
const QUALITY: u8 = 55;

/// Why there is no picture. A closed set, because these are the words the
/// phone reads.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Refusal {
    /// No browser is open, so there is nothing to show — and nothing was
    /// started to find out.
    NoPage,
    /// The page belongs to another conversation, or to nobody.
    NotYours,
    /// Another call is driving the browser, or the person has paused it.
    Busy,
    /// The picture is bigger than the road can carry.
    TooLarge,
    /// The page is somewhere we may not show, it moved while it was taken, or
    /// the driver would not give it up.
    Unavailable,
}

impl Refusal {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NoPage => "no_page",
            Self::NotYours => "not_yours",
            Self::Busy => "busy",
            Self::TooLarge => "too_large",
            Self::Unavailable => "unavailable",
        }
    }
}

/// A refusal, and the driver's own failure behind it when there was one.
#[derive(Debug)]
pub struct Failed {
    /// The code the phone reads.
    pub refusal: Refusal,
    /// The driver's failure: the caller that knows the window uses it to
    /// forget one that has gone.
    pub driver: Option<playwright_rs::Error>,
}

/// The picture, and the two facts that travel with it.
pub struct Captured {
    /// The JPEG, base64, with no prefix: the phone's reader wants the bytes.
    pub image: String,
    /// The bare host the page is on.
    pub host: String,
    /// When it was taken, in milliseconds since the epoch.
    pub taken_at: u64,
}

/// Answers the host's call: the picture, or why there is none.
///
/// **The answer is a success, not a refusal.** An MCP refusal would collapse
/// the codes into one word, so both the picture and the reason travel as the
/// text of an ordinary answer and the app reads them as JSON.
pub(crate) async fn answer(sessions: &Sessions, conversation: &str) -> CallToolResult {
    let Ok(_call) = sessions.begin().await else {
        return view::answered(refusal_json(Refusal::Busy).to_string());
    };
    let answer = match capture(sessions, conversation).await {
        Ok(captured) => json!({
            "ok": true,
            "image": captured.image,
            "media_type": "image/jpeg",
            "host": captured.host,
            "taken_at": captured.taken_at,
        }),
        Err(refusal) => refusal_json(refusal),
    };
    view::answered(answer.to_string())
}

/// The refusal, in the shape the phone reads.
fn refusal_json(refusal: Refusal) -> Value {
    json!({"ok": false, "error": refusal.as_str()})
}

/// **The model's answer: the picture, or why there is none.**
///
/// **A separate answer from the phone's, on purpose.** The phone's answer is
/// the host's and goes to a phone that asked for a preview of the person's
/// page; this one goes to a model that was offered a tool to look at the page
/// it is driving. The capture is shared — the same guards, the same bytes —
/// and the words are not: a refusal says here what it says *to a model*.
///
/// **The answer is a success, not a refusal**, for the reason the phone's is:
/// an MCP refusal would collapse the codes into one word, so the picture and
/// the reason travel as the text of an ordinary answer and the app reads them
/// as JSON.
pub(crate) async fn answer_model(sessions: &Sessions, conversation: &str) -> CallToolResult {
    let Ok(_call) = sessions.begin().await else {
        return view::answered(model_refusal_json(Refusal::Busy).to_string());
    };
    let answer = match capture(sessions, conversation).await {
        Ok(captured) => json!({
            "ok": true,
            "image": captured.image,
            "media_type": "image/jpeg",
            "host": captured.host,
            "taken_at": captured.taken_at,
        }),
        Err(refusal) => model_refusal_json(refusal),
    };
    view::answered(answer.to_string())
}

/// The refusal, in the shape a model reads: the code it knows and the sentence
/// it can act on.
fn model_refusal_json(refusal: Refusal) -> Value {
    json!({
        "ok": false,
        "error": refusal.as_str(),
        "message": refusal_words(refusal),
    })
}

/// **What a refusal says to a model. One sentence each, and fixed**: the same
/// code always says the same thing, so a model that reads two refusals reads
/// the same answer twice and does not read a difference into it.
fn refusal_words(refusal: Refusal) -> &'static str {
    match refusal {
        Refusal::NoPage => "There is no page open, so there is no picture to take.",
        Refusal::NotYours => {
            "The page on the screen is not this conversation's, so no picture was taken."
        }
        Refusal::Busy => {
            "The browser is paused, or busy with another step, so no picture was taken."
        }
        Refusal::TooLarge => "The picture of the page was too large to send.",
        Refusal::Unavailable => "The picture of the page could not be taken.",
    }
}

/// Takes the picture of the page this conversation owns.
///
/// **Nothing is started here.** A preview of a page that is not open is an
/// answer, not a reason to open a window on the person's desk.
pub(crate) async fn capture(sessions: &Sessions, conversation: &str) -> Result<Captured, Refusal> {
    let Some((page, landings, holds)) = sessions.page_if_started().await else {
        return Err(Refusal::NoPage);
    };
    match shot(&page, &landings, &holds, conversation).await {
        Ok(captured) => Ok(captured),
        Err(failed) => {
            if let Some(error) = failed.driver {
                // The rule every other call follows: a window that has gone is
                // forgotten, so the next call opens a fresh one.
                sessions.forget_if_gone(&error, &page).await;
            }
            Err(failed.refusal)
        }
    }
}

/// Takes the picture of a page this conversation owns.
///
/// The window is the caller's: the product's own browser, with its own rules
/// installed, is what this looks at.
pub async fn shot(
    page: &Page,
    landings: &Landings,
    holds: &Holds,
    conversation: &str,
) -> Result<Captured, Failed> {
    shot_then(page, landings, holds, conversation, || async {}).await
}

/// [`shot`], with a point where the window may be moved between the judgement
/// and the address: `between` runs after the ownership and the pause are judged,
/// and before the address is read. Production passes nothing there; the race
/// test passes the person's own navigation.
pub(crate) async fn shot_then<Between, Pause>(
    page: &Page,
    landings: &Landings,
    holds: &Holds,
    conversation: &str,
    between: Between,
) -> Result<Captured, Failed>
where
    Between: FnOnce() -> Pause,
    Pause: std::future::Future<Output = ()>,
{
    if !ours(holds, conversation).await {
        return Err(Failed { refusal: Refusal::NotYours, driver: None });
    }
    // A browser the person has paused is not Kalsa's to drive, and every other
    // call stops for it: a picture is a read of the screen.
    if holds.paused() {
        return Err(Failed { refusal: Refusal::Busy, driver: None });
    }
    between().await;
    let before = page.url();
    // The address and the landing are judged before the picture and again
    // after it: a page that moved while the picture was taken is a picture of a
    // document that is not on the screen any more.
    if may_not_show(landings, &before).await {
        return Err(Failed { refusal: Refusal::Unavailable, driver: None });
    }
    let navigations = landings.navigations().await;
    let bytes = match page.screenshot(picture()).await {
        Ok(bytes) => bytes,
        Err(error) => return Err(Failed { refusal: Refusal::Unavailable, driver: Some(error) }),
    };
    if !is_jpeg(&bytes) {
        return Err(Failed { refusal: Refusal::Unavailable, driver: None });
    }
    if bytes.len() > MAX_BYTES {
        return Err(Failed { refusal: Refusal::TooLarge, driver: None });
    }
    let after = page.url();
    // Ownership and the pause are judged again after the picture too: the person
    // may have taken the window between the first judgement and the address, and
    // a picture of a page that is theirs now is not the conversation's to have.
    if !ours(holds, conversation).await {
        return Err(Failed { refusal: Refusal::NotYours, driver: None });
    }
    if holds.paused() {
        return Err(Failed { refusal: Refusal::Busy, driver: None });
    }
    if may_not_show(landings, &after).await || !unmoved(&before, &after, navigations, landings.navigations().await) {
        return Err(Failed { refusal: Refusal::Unavailable, driver: None });
    }
    let Some(host) = crate::hold::destination_of(&before).map(|destination| destination.host) else {
        return Err(Failed { refusal: Refusal::Unavailable, driver: None });
    };
    Ok(Captured { image: encode(&bytes), host, taken_at: now_ms() })
}

/// Whether this conversation owns the page. Both stamps have to say it: the
/// conversation that opened the page, and the conversation acting on it. A
/// read sets neither, and a page nobody opened belongs to nobody.
async fn ours(holds: &Holds, conversation: &str) -> bool {
    let page = holds.stamp_for_the_page().await;
    let call = holds.stamp_for_our_call().await;
    !page.is_empty() && page == conversation && call == conversation
}

/// The landing guard, which is the address guard too: the rules that stop a
/// request being made are the rules that decide whether its answer may be
/// read.
async fn may_not_show(landings: &Landings, url: &str) -> bool {
    landings.refused(url).await.is_some()
}

/// Whether the page stayed where it was. Comparing addresses alone cannot see
/// a page that navigated and came back.
fn unmoved(before: &str, after: &str, navigations: u64, now: u64) -> bool {
    before == after && navigations == now
}

/// The picture, as it is taken: the viewport, JPEG, and at the quality that
/// keeps it inside the cap.
fn picture() -> ScreenshotOptions {
    ScreenshotOptions::builder()
        .screenshot_type(ScreenshotType::Jpeg)
        .quality(QUALITY)
        .full_page(false)
        .build()
}

/// Whether these bytes are a JPEG. Checked on the bytes, not on the promise:
/// the driver is a stranger's answer like any other.
fn is_jpeg(bytes: &[u8]) -> bool {
    bytes.len() > 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF
}

/// The bytes as the phone reads them: base64, with no prefix and no wrapping.
fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Now, in milliseconds since the epoch.
fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|since| since.as_millis() as u64).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{may_not_show, ours, picture, Refusal, MAX_BYTES};
    use crate::hold::Holds;
    use crate::landing::Landings;
    use playwright_rs::protocol::ScreenshotType;

    /// The page belongs to the conversation that opened it and is still acting
    /// on it: both stamps have to agree or the picture is not its own.
    #[tokio::test]
    async fn a_page_is_yours_only_when_both_stamps_are_you() {
        let holds = Holds::default();
        holds.navigated_by("phone:1").await;
        assert!(ours(&holds, "phone:1").await, "the conversation that opened the page owns it");
        assert!(!ours(&holds, "phone:2").await, "and nobody else does");
    }

    /// Reading a page does not take it, and acting on it does not make it
    /// yours: the actor is the last actor but not the opener, and the opener
    /// has been displaced.
    #[tokio::test]
    async fn reading_a_page_does_not_take_it() {
        let holds = Holds::default();
        holds.navigated_by("phone:1").await;
        assert!(ours(&holds, "phone:1").await, "the opener owns it while it is the last actor");
        holds.in_conversation("phone:2").await;
        assert!(!ours(&holds, "phone:2").await, "acting on a page is not owning it");
        assert!(!ours(&holds, "phone:1").await, "and the opener is no longer the last actor");
    }

    /// A page nobody opened belongs to nobody: it is not yours because you are
    /// the only one asking.
    #[tokio::test]
    async fn a_blank_page_is_not_granted() {
        let holds = Holds::default();
        assert!(!ours(&holds, "phone:1").await, "an empty stamp is not a stamp");
    }

    /// An address we may not show is refused, whatever the page is.
    #[tokio::test]
    async fn an_address_we_may_not_show_is_refused() {
        let landings = Landings::new();
        assert!(may_not_show(&landings, "file:///etc/passwd").await, "a file is not a page");
        assert!(may_not_show(&landings, "http://127.0.0.1:8080/").await, "our own network is not a page");
    }

    /// The picture is a viewport JPEG and nothing else: full page, PNG or a
    /// quality of our own choosing would all break the cap the road has.
    #[test]
    fn the_picture_is_a_viewport_jpeg_at_the_quality_the_cap_needs() {
        let options = picture();
        assert_eq!(options.screenshot_type, Some(ScreenshotType::Jpeg));
        assert_eq!(options.quality, Some(55));
        assert_eq!(options.full_page, Some(false));
    }

    /// The cap is the one the road can carry: a quarter of a megabyte of JPEG
    /// is 349,528 characters, and the road holds half a megabyte.
    #[test]
    fn the_cap_is_a_quarter_of_a_megabyte_of_jpeg() {
        let encoded = 4 * MAX_BYTES.div_ceil(3);
        assert_eq!(MAX_BYTES, 262_144);
        assert_eq!(encoded, 349_528);
        assert!(encoded < 512 * 1024, "the picture must fit the road with its metadata beside it");
    }

    /// Every refusal is a word the phone knows.
    #[test]
    fn the_refusals_are_a_closed_set() {
        let codes: Vec<&str> = [Refusal::NoPage, Refusal::NotYours, Refusal::Busy, Refusal::TooLarge, Refusal::Unavailable]
            .iter()
            .map(|refusal| refusal.as_str())
            .collect();
        assert_eq!(codes, ["no_page", "not_yours", "busy", "too_large", "unavailable"]);
    }
}
