//! The words a page puts beside a field, for a person to read next to its value
//! (one responsibility: find a field's label, clean it, and attach it).
//!
//! **Display only.** A label is the page's own text, so it is cleaned here before
//! anything else sees it, and nothing decides on it: the value, the request and the
//! secret flag are the same with or without one. A field with no label is drawn with
//! its name, which is what the card did before labels existed.
//!
//! **A label is dropped, never guessed at, whenever it could mislead.** A name that
//! more than one control carries has no label, because no one control's words are
//! the field's. A label that carries something the person typed into a secret field
//! is dropped, because the card must never show a typed secret twice.

use std::collections::HashMap;
use std::time::Duration;

use playwright_rs::protocol::Page;

use crate::body::Field;

/// The most of a label a card draws. A label is usually a few words; a page that
/// writes a paragraph into one does not get a paragraph on the person's screen.
pub(crate) const MAX_LABEL: usize = 60;

/// Reads the labels of the named controls under `root` — a form, or the document —
/// as a person reads them: the **rendered** text of each `<label>` the control has,
/// and then the control's `placeholder` when the control itself is rendered. Text the
/// person cannot see (a `display:none` span, a hidden label, an `aria-label`) is not a
/// label. A name carried by more than one control gets none.
///
/// Written as declarations so it can sit inside the submit catcher's script and be
/// evaluated in a frame for a route-held write, with the same answers from both.
pub(crate) const LABELS_JS: &str = r"
  function labelsIn(root, names) {
    const CONTROL = /^(INPUT|SELECT|TEXTAREA|BUTTON|OPTION)$/;
    const wanted = names ? new Set(names) : null;
    const shown = Object.create(null);
    const controls = root.elements ? Array.from(root.elements) : Array.from(root.querySelectorAll('input, select, textarea'));
    // A name on more than one control has no label: which control's words would be the field's?
    const count = Object.create(null);
    for (const control of controls) if (control.name) count[control.name] = (count[control.name] || 0) + 1;
    for (const control of controls) {
      const name = control.name;
      if (!name || (wanted && !wanted.has(name)) || count[name] > 1 || shown[name] !== undefined) continue;
      shown[name] = labelOf(control);
    }
    return shown;
    function rendered(el) {
      if (el.hidden || el.getClientRects().length === 0) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }
    // The text a person reads: text nodes, and the rendered text of each element beside
    // them. A form control inside a label contributes no words of its own.
    function shownText(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
      if (node.nodeType !== Node.ELEMENT_NODE || CONTROL.test(node.tagName) || !rendered(node)) return '';
      return Array.from(node.childNodes).map((child) => (child.nodeType === Node.ELEMENT_NODE ? ' ' + shownText(child) + ' ' : shownText(child))).join('');
    }
    function labelOf(control) {
      const words = control.labels ? Array.from(control.labels).filter((label) => label.getClientRects().length > 0).map(shownText).join(' ') : '';
      if (words.trim()) return words;
      if (control.type !== 'hidden' && control.getClientRects().length > 0) return control.getAttribute('placeholder') || '';
      return '';
    }
  }
";

/// The expression a frame evaluates to get the labels of a request's named fields
/// from the document the request came from.
pub(crate) fn document_expression() -> String {
    format!("(names) => {{ {LABELS_JS} return labelsIn(document, names); }}")
}

/// How long the page is given to say what its fields are called before a call acts.
/// A page that does not answer in this long has no labels for this call.
const READ_WAIT: Duration = Duration::from_millis(500);

/// What the page calls each of its named controls, read **before** a call acts. A
/// write the page makes by itself during that call is labelled from this by name, so
/// the card is never waiting on the page at the moment it is drawn.
pub(crate) async fn read_page(page: &Page) -> HashMap<String, String> {
    let expression = document_expression();
    let read = page.evaluate::<(), HashMap<String, String>>(&expression, None);
    match tokio::time::timeout(READ_WAIT, read).await {
        Ok(Ok(labels)) => labels,
        _ => HashMap::new(),
    }
}

/// What a label may be drawn as, or nothing. Control characters and **every Unicode
/// format character** (general category Cf: bidirectional marks, zero-width joiners,
/// the Arabic letter mark and the rest) become spaces, because a format character
/// changes how text reads and shows nothing itself. Runs of space collapse, and the
/// result is capped at [`MAX_LABEL`] characters.
///
/// What remains is still the page's text: a homoglyph can make a label read like a
/// different word, and that is a stated residual. The values and the host are the
/// real ones and are what the person is asked to check.
pub(crate) fn clean(raw: &str) -> Option<String> {
    let spaced: String = raw.chars().map(|character| if hidden(character) { ' ' } else { character }).collect();
    let words = spaced.split_whitespace().collect::<Vec<&str>>().join(" ");
    let capped: String = words.chars().take(MAX_LABEL).collect();
    let trimmed = capped.trim_end();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

/// Control characters and the Unicode general category Cf. `std` does not expose the
/// category, so the ranges are listed here from the Unicode 15 table.
fn hidden(character: char) -> bool {
    character.is_control()
        || matches!(
            character as u32,
            0x00AD
                | 0x0600..=0x0605
                | 0x061C
                | 0x06DD
                | 0x070F
                | 0x0890..=0x0891
                | 0x08E2
                | 0x180E
                | 0x200B..=0x200F
                | 0x202A..=0x202E
                | 0x2060..=0x206F
                | 0xFEFF
                | 0xFFF9..=0xFFFB
                | 0x110BD
                | 0x110CD
                | 0x13430..=0x13438
                | 0x1BCA0..=0x1BCA3
                | 0x1D173..=0x1D17A
                | 0xE0001
                | 0xE0020..=0xE007F
        )
}

/// Whether a label carries anything the person typed into a secret field. A label is
/// page text, and a password the page echoes into one must not be drawn twice.
fn carries_typed(label: &str, typed: &[String]) -> bool {
    typed.iter().any(|secret| !secret.is_empty() && label.contains(secret.as_str()))
}

/// Attaches each field's label, cleaned, from the labels the page gave by name. A
/// name the page did not label keeps none, and so does a label that carries a typed
/// secret: the field is then drawn with its name.
pub(crate) fn apply(fields: &mut [Field], labels: &HashMap<String, String>, typed: &[String]) {
    for field in fields {
        // Checked on the raw label **and** on the cleaned one. Cleaning collapses runs of
        // space and removes format characters, so a secret with a double space or a
        // zero-width character inside is only found in the raw text; the cleaned text is
        // checked too, because cleaning can also bring two halves of a secret together.
        field.label = labels
            .get(&field.name)
            .filter(|raw| !carries_typed(raw, typed))
            .and_then(|raw| clean(raw))
            .filter(|label| !carries_typed(label, typed));
    }
}

#[cfg(test)]
mod tests {
    use super::{apply, carries_typed, clean, Field, MAX_LABEL};
    use std::collections::HashMap;

    fn field(name: &str) -> Field {
        Field { name: name.to_owned(), value: "x".to_owned(), secret: false, label: None }
    }

    /// **Every format character is stripped, not only the bidirectional ones.** The
    /// Arabic letter mark and the zero-width space change how words read, and the
    /// bidirectional isolates are the ones a hostile label reorders text with.
    #[test]
    fn every_format_character_is_stripped_and_what_is_left_is_the_words() {
        assert_eq!(clean("Via\u{061C}Roma").as_deref(), Some("Via Roma"), "U+061C");
        assert_eq!(clean("Via\u{200B}Roma").as_deref(), Some("Via Roma"), "U+200B");
        for mark in ['\u{2066}', '\u{2067}', '\u{2068}', '\u{2069}'] {
            assert_eq!(clean(&format!("Via{mark}Roma")).as_deref(), Some("Via Roma"), "U+{:04X}", mark as u32);
        }
        assert_eq!(clean("Indirizzo\u{0}\n\u{202E}evil\u{FEFF}").as_deref(), Some("Indirizzo evil"));
    }

    /// A label that is only format characters and space is no label, so the card draws
    /// the name.
    #[test]
    fn nothing_but_space_and_hidden_characters_is_no_label() {
        assert_eq!(clean(" \t\n "), None);
        assert_eq!(clean("\u{200B}\u{061C}\u{FEFF}"), None);
        assert_eq!(clean(""), None);
    }

    /// A label is capped by characters, not bytes, so an accented label is not cut
    /// short and nothing is cut mid-character.
    #[test]
    fn a_long_label_is_capped_at_sixty_characters() {
        let shown = clean(&"è".repeat(200)).expect("a label");
        assert_eq!(shown.chars().count(), MAX_LABEL);
    }

    /// The labels attach by name, and a field the page did not label keeps none.
    #[test]
    fn labels_attach_by_name_and_an_unlabelled_field_keeps_none() {
        let mut fields = vec![field("custname"), field("csrf")];
        let labels = HashMap::from([("custname".to_owned(), "Nome e cognome".to_owned())]);
        apply(&mut fields, &labels, &[]);
        assert_eq!(fields[0].label.as_deref(), Some("Nome e cognome"));
        assert_eq!(fields[1].label, None, "no label is drawn as the name, not invented");
    }

    /// **A label that carries a typed secret is dropped.** The card shows the typed value
    /// as dots in its field, and must not show it again in plain text in a label the page
    /// wrote around it.
    #[test]
    fn a_label_carrying_a_typed_secret_is_dropped() {
        let mut fields = vec![field("city")];
        let labels = HashMap::from([("city".to_owned(), "Conferma hunter2".to_owned())]);
        apply(&mut fields, &labels, &["hunter2".to_owned()]);
        assert_eq!(fields[0].label, None, "the typed value is not drawn as a label");
        assert!(carries_typed("Conferma hunter2", &["hunter2".to_owned()]));
        assert!(!carries_typed("Città", &["hunter2".to_owned()]), "an ordinary label is kept");
        assert!(!carries_typed("Città", &[String::new()]), "an empty typed value carries nothing");
    }

    /// **A typed secret is found in the raw label, where cleaning cannot change it.** A
    /// double space inside the secret is collapsed by cleaning, so only the raw text
    /// carries it, and a zero-width character inside the secret is removed the same way.
    #[test]
    fn a_typed_secret_with_a_double_space_or_a_zero_width_character_is_still_found() {
        let typed = |secret: &str| vec![secret.to_owned()];
        let spaced = HashMap::from([("city".to_owned(), "Codice a  b".to_owned())]);
        let mut fields = vec![field("city")];
        apply(&mut fields, &spaced, &typed("a  b"));
        assert_eq!(fields[0].label, None, "the raw label carries the typed double space");

        let hidden = HashMap::from([("city".to_owned(), "Conferma hun\u{200B}ter2".to_owned())]);
        let mut fields = vec![field("city")];
        apply(&mut fields, &hidden, &typed("hun\u{200B}ter2"));
        assert_eq!(fields[0].label, None, "the raw label carries the typed zero-width character");
    }

    /// **A typed secret is also found in the cleaned label.** Cleaning turns the zero-width
    /// space into a space, so the raw label does not contain the typed "a b" but the
    /// cleaned one does.
    #[test]
    fn a_typed_secret_that_cleaning_brings_together_is_found_in_the_cleaned_label() {
        let raw = HashMap::from([("city".to_owned(), "Codice a\u{200B}b".to_owned())]);
        let mut fields = vec![field("city")];
        apply(&mut fields, &raw, &["a b".to_owned()]);
        assert_eq!(fields[0].label, None, "the cleaned label carries the typed secret");
    }

    /// **A label is display only.** Applying one changes what is drawn and nothing else
    /// about the field.
    #[test]
    fn a_label_changes_the_drawing_and_nothing_else() {
        let mut fields = vec![Field { name: "pw".to_owned(), value: "hunter2".to_owned(), secret: true, label: None }];
        apply(&mut fields, &HashMap::from([("pw".to_owned(), "Password".to_owned())]), &[]);
        assert_eq!(fields[0].value, "hunter2");
        assert!(fields[0].secret);
        assert_eq!(fields[0].name, "pw");
    }
}
