// PLACEHOLDERS — every invented value in the app lives here, and nowhere else.
//
// None of it is measured, and none of it reaches the screen as a number: the
// pages render these as unknown or not-ready states, because a plausible
// value here would be a demo lying. Each export names the crate and the
// command that will replace it; when that command exists, delete the export
// and call the command — the pages already render the real shapes.
//
// The Model page's future input, kalsa-catalog's Decision, is no longer
// faked here: the page walks a real interim ladder (measure, then wait for
// the phone) and its renderDecision is the documented substitution target
// for `brain_choice`.
//
//   phone         -> the pairing handshake (no crate yet)       via `brain_phone`
//   throttled     -> kalsa-supervisor (reports no slowdown yet)  a field on `brain_state`
//   pairingSteps  -> the pairing flow (not designed yet)

/// Whether the user's phone is connected: true, false, or null for "not
/// known". Null is the only honest value until the pairing handshake exists,
/// and the Status page says so — it never guesses either way.
export const phone = null;

/// True when the machine has been asked to run slower to protect itself, so
/// the Status page can say so out loud. kalsa-supervisor does not report a
/// deliberate slowdown yet; when it learns to, this becomes a field on
/// brain_state. Null hides the notice entirely — the page must never warn
/// about a slowdown that is not happening.
export const throttled = null;

/// Numbered steps for the Pairing page, [{ title, detail }], from the pairing
/// flow once it is designed. Null keeps the page saying, honestly, that there
/// is nothing to do yet — it must not show steps the software cannot back up.
export const pairingSteps = null;
