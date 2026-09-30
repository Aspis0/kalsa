// The sentences for Rust's own codes, one per message the app sends. The
// English here is the same sentence `text` carries on the wire; a code
// without a row here falls back to that text.

export type RustSentence = (params: Record<string, unknown>, tag: string) => string;

export const RUST: { startup: Record<string, RustSentence>; choice: Record<string, RustSentence>; app: Record<string, RustSentence> } = {
  startup: {
    cannot_run_yet: () => "Kalsa can't run on this computer yet. Check for an app update.",
    no_suitable_choice: () =>
      "Kalsa doesn't have an AI that runs well on this computer yet. Check for an app update.",
    connection_lost: () =>
      "Kalsa couldn't download what she needs. Check your connection and try again.",
    network_blocks_download: () =>
      "Kalsa couldn't download what she needs on this network. Try another network.",
    download_failed: () => "Kalsa couldn't finish downloading. Try again later.",
    needs_check: () => "Kalsa needs to check this computer before she can start. Try again.",
    choice_too_large: () => "This AI is too big for this computer. Pick a smaller one on the AI page.",
    choice_unavailable: () => "Kalsa couldn't start with this AI. Pick another one on the AI page.",
    conversation_too_long: () =>
      "This conversation length is too long for this AI. Choose a smaller one in Advanced.",
    check_failed: () => "Kalsa couldn't check this computer. Wait a moment and try again.",
    could_not_start: () => "Kalsa couldn't start. Try again.",
    awaiting_choice: () => "Kalsa isn't set up yet. Go to Home and press Start.",
    disk_full: (params, tag) =>
      typeof params.gb === "number"
        ? `Kalsa needs more space. Free up ${new Intl.NumberFormat(tag, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 1,
          }).format(params.gb)} GB and try again.`
        : "Kalsa needs more space. Free up some room and try again.",
    restart: () => "Kalsa couldn't start. Restart this computer and try again.",
    stopped: () => "Kalsa stopped by herself. Turn her on again.",
    took_too_long: () => "Kalsa took too long to get ready. Try again.",
    stop_unconfirmed: () => "Kalsa may still be running. Restart this computer to turn her off.",
    already_starting: () => "Kalsa is already starting. Wait a moment.",
  },
  choice: {
    save_failed: () => "Kalsa couldn't save this choice. Try again.",
  },
  app: {
    unexpected: () => "Kalsa couldn't do that. Try again.",
  },
};
