// PLACEHOLDERS — every invented value in the app lives here, and nowhere else.
//
// None of it is measured, and none of it reaches the screen as a number: the
// pages render these as unknown or refused states, because a plausible value
// here would be a demo lying. Each export names the crate and the command
// that will replace it; when that command exists, delete the export and call
// the command — the pages already render the real shapes, so the swap is a
// substitution, not a rewrite.
//
//   decision      -> kalsa-catalog  src/choice.rs :: Decision   via `brain_choice`
//   phone         -> the pairing handshake (no crate yet)       via `brain_phone`
//   throttled     -> kalsa-supervisor (reports no slowdown yet)  a field on `brain_state`
//   pairingSteps  -> the pairing flow (not designed yet)

/// kalsa-catalog::Decision, as the Model page will receive it.
///
/// Today the truthful decision is a refusal: the machine has not been
/// measured, so no model may be chosen. `reason` mirrors RefusalReason:
///   phoneUnknown | machineNotMeasured | nothingFits | nothingBetter |
///   nothingFastEnough
/// A pick looks like:
///   { pick: { label, justification, rationale } }
/// where justification is "capability", "relief", or "expectedButUnmeasured"
/// (Justification) and the rest of Selection — repo, quant, weights_bytes,
/// footprint, budget, context_tokens, decode, prefill, licence,
/// dense_equivalent — stays behind the command: the page renders only the
/// plain name, the justification, and the crate's own rationale sentence.
/// The evidence a Capability carries (CapabilityBasis) is the crate's to
/// weigh, not a thing the page parses. `label` does not exist in the crate;
/// the plain-language model name has to be decided by someone (see the
/// handover notes).
export const decision = {
  refuse: {
    reason: "machineNotMeasured",
    explanation: "This computer has not been measured yet.",
  },
};

/// Whether the user's phone is connected: true, false, or null for "not
/// known". Null is the only honest value until the pairing handshake exists,
/// and the Status page says "cannot tell yet" — it never guesses either way.
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
