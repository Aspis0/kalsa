//! Whether the page in front of the model is a human check (one responsibility:
//! tell a challenge page from a page that merely carries a widget).
//!
//! **A check is the page itself.** A page that asks the reader to prove they
//! are a person is essentially that request: it is short, and it says the
//! words of a check. A signup form or an article can carry a reCAPTCHA or a
//! Turnstile widget and say "verify you are human" as well — and it is long.
//! It is not a check, and refusing it would take the whole site away from the
//! model. So the words are never enough on their own.
//!
//! **A page is refused only when all of these hold.** The words of a check are
//! on the page, in one of the languages the product ships. And either the
//! provider's own interstitial address is serving it (Google's `/sorry/`, in
//! every language), or the page is short and a challenge provider's host or
//! frame says so too. A frame only confirms a short page; it never makes a long
//! one a check.
//!
//! A challenge is refused for the person's sake: they do it in the browser
//! window on their own screen, and the request is made again after that. A
//! model cannot pass one, and the product's rule forbids it to go round one.
//!
//! The browser is only asked about its frames when the words, the length and
//! the host leave the question open: a page that says nothing of a check is
//! never asked for its frames.

use playwright_rs::protocol::Page;
use url::Url;

/// **The code a human check is refused with.** It travels to the window, which
/// reads it as a word of ours and never as the sentence the model read.
pub const CODE: &str = "browser.robot_check";

/// **The words a check says**, in the five languages the product ships. An
/// interstitial says one of these, and an ordinary page does not. They are
/// read with the page's own words, so a localized Google or Cloudflare page is
/// the same check as the English one.
///
/// **The localized phrases are not yet checked against live pages** — they are
/// the wording those providers use, and BACKLOG.md carries the item to verify
/// each one on a real challenge.
const SAYS_A_CHALLENGE: &[&str] = &[
    // English
    "unusual traffic",
    "checking your browser",
    "verify you are human",
    // Italiano
    "traffico insolito",
    "verifica del browser",
    "essere umano",
    // Español
    "tráfico inusual",
    "comprobando tu navegador",
    "verifica que eres humano",
    // Français
    "trafic inhabituel",
    "vérification de votre navigateur",
    "vous êtes humain",
    // Deutsch
    "ungewöhnlichen datenverkehr",
    "browser überprüf",
    "bist ein mensch",
    // 中文
    "异常流量",
    "正在检查您的浏览器",
    "验证您是真人",
];

/// **The frames and scripts a challenge is served from.** A reCAPTCHA and a
/// Cloudflare challenge load from these, and on a short page one of them is the
/// confirmation that the page is the check.
const CHALLENGE_SOURCES: &[&str] = &["recaptcha", "challenges.cloudflare.com", "hcaptcha"];

/// **The hosts that serve a human check.** The name before the public suffix:
/// "google" for google.com and for google.co.uk alike.
const PROVIDERS: &[&str] = &["google", "recaptcha", "cloudflare", "gstatic"];

/// **The second-level labels of a country's public suffix**, so that
/// "google.com.br" is google and not com: the name is the label before them.
const SECOND_LEVEL_SUFFIXES: &[&str] = &["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go"];

/// **The longest page that can be a check.** A challenge is a few lines. A page
/// that is an article or a form and only carries a widget is far longer.
const SHORT_PAGE_CHARS: usize = 4000;

/// **Whether the page is a human check.**
///
/// **The whole page is read, and never a piece of it.** The words are read out
/// of what the page says as a whole: a read answers with one window of a long
/// page and a find answers with the lines that matched, and a challenge
/// sitting above the window or beside the match is a challenge all the same.
/// The header — the address and the title — is ours and is left out: an
/// address with the words of a challenge in it is not a page that has them.
pub async fn is_robot_check(page: &Page, whole: &str, url: &str) -> bool {
    if !says_a_challenge(whole) {
        return false;
    }
    let provider = served_by_a_provider(url);
    // **The provider's own interstitial address is the check**, in any language.
    if provider && on_the_challenge_path(url) {
        return true;
    }
    // **A long page is not a check, whatever it carries.** That is what keeps a
    // signup form with a widget, or an article about traffic, out of the refusal.
    if whole.chars().count() > SHORT_PAGE_CHARS {
        return false;
    }
    provider || frames_a_challenge(page).await
}

/// **Whether the page says the words of a check.** The words are read with the
/// white space folded, so a phrase the tree broke over two lines is still the
/// phrase.
pub(crate) fn says_a_challenge(text: &str) -> bool {
    let said = folded(text);
    SAYS_A_CHALLENGE.iter().any(|words| said.contains(words))
}

/// **The text as it is read for a signature:** lowercase, and the white space
/// folded to single spaces.
fn folded(text: &str) -> String {
    let said = text.to_lowercase();
    said.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// **Whether the provider's own address is serving its challenge page.** Google
/// serves its check at `/sorry/` in every language, so the path says it whatever
/// the words are.
pub(crate) fn on_the_challenge_path(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    parsed.path().starts_with("/sorry/")
}

/// **Whether the page loads a frame or a script a challenge is served from.**
/// Cloudflare's interstitial loads its check as a script on many pages, and a
/// reCAPTCHA as a frame, so both are read.
pub(crate) async fn frames_a_challenge(page: &Page) -> bool {
    let sources = page
        .evaluate::<(), Vec<String>>(
            "Array.from(document.querySelectorAll('iframe[src], script[src]')).map((node) => node.getAttribute('src') || '')",
            None,
        )
        .await
        .unwrap_or_default();
    sources.iter().any(|src| {
        let src = src.to_lowercase();
        CHALLENGE_SOURCES.iter().any(|mark| src.contains(mark))
    })
}

/// **Whether the host is one that serves a human check.**
pub(crate) fn served_by_a_provider(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let lowered = host.to_lowercase();
    PROVIDERS.contains(&registrable(&lowered))
}

/// **The name before the public suffix.** "google" for "google.com", for
/// "google.co.uk" and for "google.com.br", and "example" for
/// "shop.example.com" — so a host that has the name in it is not one of the
/// name.
fn registrable(host: &str) -> &str {
    let labels: Vec<&str> = host.split('.').collect();
    let n = labels.len();
    match n {
        0 | 1 => host,
        // "google.com": the last label is the suffix.
        2 => labels[0],
        // "google.co.uk" and "google.com.br": a two-letter country code after a
        // second-level suffix makes the suffix three labels long.
        _ if labels[n - 1].len() == 2 && SECOND_LEVEL_SUFFIXES.contains(&labels[n - 2]) => labels[n - 3],
        _ => labels[n - 2],
    }
}

/// **Said when the page is a human check.**
///
/// **And it says who does it, and it says it is not to be got round.** The
/// model cannot pass a check and must not try to: the person does it in the
/// window on their own screen, and the request is made again after that.
pub fn the_check() -> String {
    "This page is a human check: the site is asking the reader to prove they are a person, and you cannot do \
     that for them. Do not try to get past it another way — not by opening the address again, not by another \
     form of it, and not by another tool: the check is there on purpose. The person can do it themselves in the \
     browser window on their own screen, and once they have, the request can be made again and read."
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{on_the_challenge_path, registrable, says_a_challenge, served_by_a_provider};

    /// **The words of a check are the words of a check.** A page that merely
    /// mentions traffic or robots is not one.
    #[test]
    fn the_words_of_a_challenge_are_read_whatever_the_line_breaks_are() {
        assert!(says_a_challenge("Our systems have detected unusual traffic from your computer network."));
        assert!(says_a_challenge("Checking your browser before accessing example.com"));
        assert!(says_a_challenge("Checking your\n   browser"));
        assert!(!says_a_challenge("a page about traffic and about robots in general"));
        assert!(!says_a_challenge("the price of a new notebook"));
    }

    /// **The words of a check are read in every language the product ships**, so
    /// that a challenge in the browser's own language is the same check.
    #[test]
    fn the_words_of_a_check_are_read_in_every_language_the_product_ships() {
        assert!(says_a_challenge("Abbiamo rilevato traffico insolito dalla tua rete"));
        assert!(says_a_challenge("Hemos detectado tráfico inusual"));
        assert!(says_a_challenge("Nous avons détecté un trafic inhabituel"));
        assert!(says_a_challenge("Wir haben ungewöhnlichen Datenverkehr festgestellt"));
        assert!(says_a_challenge("我们的系统检测到异常流量"));
        assert!(!says_a_challenge("il traffico del sito è in crescita"));
    }

    /// **A widget's label is not, by itself, the words of a check.** "I'm not a
    /// robot" sits on every signup form on the web.
    #[test]
    fn the_label_of_a_recaptcha_is_not_a_check_by_itself() {
        assert!(!says_a_challenge("I'm not a robot"));
        assert!(!says_a_challenge("Please enable JavaScript and cookies to continue"));
    }

    /// **The provider's own address serves its check at `/sorry/`**, in every
    /// language: the path is the same whatever the words are.
    #[test]
    fn the_challenge_path_is_the_providers_sorry_page() {
        assert!(on_the_challenge_path("https://www.google.it/sorry/index?continue=x"));
        assert!(!on_the_challenge_path("https://www.google.it/search?q=sorry"));
        assert!(!on_the_challenge_path("https://www.google.it/"));
        assert!(!on_the_challenge_path("not an address"));
    }

    /// **The host that serves a challenge is the one that serves it.** The name
    /// before the public suffix, so a country domain is the same name and a
    /// host that has the name in it is not it.
    #[test]
    fn a_challenge_is_served_by_the_provider_and_by_nobody_else() {
        assert!(served_by_a_provider("https://www.google.com/sorry/index?continue=x"));
        assert!(served_by_a_provider("https://google.co.uk/sorry/index"));
        assert!(served_by_a_provider("https://www.google.com.br/sorry/index"));
        assert!(served_by_a_provider("https://www.recaptcha.net/recaptcha/api2/anchor"));
        assert!(served_by_a_provider("https://challenges.cloudflare.com/turnstile"));
        assert!(!served_by_a_provider("https://notgoogle.com/sorry/index"));
        assert!(!served_by_a_provider("https://google.com.evil.example/sorry/index"));
        assert!(!served_by_a_provider("https://example.com/"));
        assert!(!served_by_a_provider("not an address"));
    }

    #[test]
    fn the_name_before_the_public_suffix_is_the_name() {
        assert_eq!(registrable("google.com"), "google");
        assert_eq!(registrable("www.google.com"), "google");
        assert_eq!(registrable("google.co.uk"), "google");
        assert_eq!(registrable("google.com.br"), "google");
        assert_eq!(registrable("google.com.au"), "google");
        assert_eq!(registrable("google.it"), "google");
        assert_eq!(registrable("shop.example.com"), "example");
        assert_eq!(registrable("localhost"), "localhost");
    }
}
