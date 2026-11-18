//! Small interactive pieces that need a backend later: share bars and the claim line.
//! Accounts are S3, so every sign-in button here is disabled and says "coming soon".

use crate::html::{encode_component, escape, safe_href, HELP};
use crate::paths;

/// The shareable address and a copy button.
pub fn url_bar(path: &str) -> String {
    let url = paths::canonical(path);
    format!(
        "<div class=\"urlbar\"><span class=\"u\">{shown}</span><button class=\"cp\" data-copy=\"{url}\">Copy link</button></div>",
        shown = escape(url.trim_start_matches("https://")),
        url = escape(&url),
    )
}

const HUGGING_FACE: &str = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 18 18\" aria-hidden=\"true\"><rect x=\"1\" y=\"1\" width=\"16\" height=\"16\" rx=\"5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\"/><text x=\"9\" y=\"12.4\" text-anchor=\"middle\" font-size=\"8.5\" font-weight=\"700\" fill=\"currentColor\">HF</text></svg>";
const GITHUB: &str = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 16 16\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z\"/></svg>";
const GITLAB: &str = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 16 16\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"m15.7 9-.9-2.8-1.8-5.5a.3.3 0 0 0-.6 0L10.6 6.2H5.4L3.6.7a.3.3 0 0 0-.6 0L1.2 6.2.3 9a.6.6 0 0 0 .2.7L8 15.2l7.5-5.5a.6.6 0 0 0 .2-.7Z\"/></svg>";

/// Hugging Face first, then GitHub and GitLab. No Google and no password.
pub fn sign_in_buttons(note: &str) -> String {
    format!(
        "<div class=\"signin\"><a class=\"btn two\" aria-disabled=\"true\">{HUGGING_FACE}Continue with Hugging Face</a>\
         <a class=\"btn two\" aria-disabled=\"true\">{GITHUB}Continue with GitHub</a><a class=\"btn two\" aria-disabled=\"true\">{GITLAB}Continue with GitLab</a></div>\
         <p class=\"sm note1\">{note}</p><p class=\"sm note2\">There is no Google sign-in and no password.</p>"
    )
}

/// One quiet line at the bottom of a page, and the (coming soon) dialog its Claim link opens.
/// A change or removal can be asked for by email or through a prefilled GitHub issue.
pub fn claim_line(root: &str, who: &str) -> String {
    let issue = format!("https://github.com/Aspis0/kalsa/issues/new?title={}", encode_component(&format!("Removal request: {who}")));
    format!(
        "<p class=\"quiet\">Is this your project? <button class=\"qlink\" data-claim>Claim this page</button> or \
         <a class=\"qlink\" href=\"{removal}\">request a change or removal</a>: write to <a class=\"qlink\" href=\"{mail}\">{HELP}</a> or \
         <a class=\"qlink\" href=\"{issue}\">open a GitHub issue</a>.</p>\
         <dialog id=\"claim\" aria-label=\"Claim this page\"><h3>Claim this page <span class=\"soon\">coming soon</span></h3>\
         <p class=\"sm\">Claiming {who} needs the GitHub or GitLab account that owns the repository. A Hugging Face login can not claim a page.</p>{buttons}\
         <p><button class=\"btn two small\" data-close>Close</button></p></dialog>",
        removal = safe_href(&format!("{root}{}#listing-and-removal", paths::section("how-we-choose"))),
        mail = safe_href(&format!("mailto:{HELP}")),
        issue = safe_href(&issue),
        who = escape(who),
        buttons = sign_in_buttons(""),
    )
}
