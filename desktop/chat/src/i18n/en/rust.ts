// The sentences for Rust's own codes, one per message the app sends. The
// English here is the same sentence `text` carries on the wire; a code
// without a row here falls back to that text.

export type RustSentence = (params: Record<string, unknown>, tag: string) => string;

/** The line a refused open says: the host it was asked for, what happened, and
    what the person can do about it. **The host is the app's own reading of its
    own argument** — a host, never the whole address, and never an address that
    is not public http(s). */
const refusedOpen = (params: Record<string, unknown>, said: string): string =>
  `Kalsa couldn't open ${typeof params.host === "string" && params.host !== "" ? params.host : "that page"}: ${said}`;

/** The line a refusal says: the open's lead when the call was an open, and the
    plain lead when it was not. **A click, a type, a read and a picture are not
    an open**, and a row that says "couldn't open" for one of them is a row
    about something that never happened. */
const refused = (params: Record<string, unknown>, open: string, step: string): string => {
  const action = params.action;
  if (action === "browser_open" || action === "web_fetch") return refusedOpen(params, open);
  return `Kalsa can't do that here: ${step}`;
};

export const RUST: { startup: Record<string, RustSentence>; choice: Record<string, RustSentence>; app: Record<string, RustSentence>; invite: Record<string, RustSentence>; pairing: Record<string, RustSentence>; update: Record<string, RustSentence>; road: Record<string, RustSentence>; files: Record<string, RustSentence>; vision: Record<string, RustSentence>; web: Record<string, RustSentence>; browser: Record<string, RustSentence> } = {
  startup: {
    cannot_run_yet: () => "Kalsa can't run on this computer yet. Check for an app update.",
    no_suitable_choice: () =>
      "Kalsa doesn't have an AI that runs well on this computer yet. Check for an app update.",
    connection_lost: () =>
      "Kalsa couldn't download what it needs. Check your connection and try again.",
    network_blocks_download: () =>
      "Kalsa couldn't download what it needs on this network. Try another network.",
    download_failed: () => "Kalsa couldn't finish downloading. Try again later.",
    needs_check: () => "Kalsa needs to check this computer before it can start. Try again.",
    choice_too_large: () => "This AI is too big for this computer. Pick a smaller one in Your AI.",
    choice_unavailable: () => "Kalsa couldn't start with this AI. Pick another one in Your AI.",
    conversation_too_long: () => "This AI can’t hold conversations this long. Start a new chat, or lower “Context size” in Your AI → For experts → Server settings.",
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
    stopped: () => "Kalsa stopped unexpectedly. Turn it on again.",
    took_too_long: () => "Kalsa took too long to get ready. Try again.",
    stop_unconfirmed: () => "Kalsa may still be running. Restart this computer to turn it off.",
    already_starting: () => "Kalsa is already starting. Wait a moment.",
  },
  choice: {
    save_failed: () => "Kalsa couldn't save this choice. Try again.",
  },
  app: {
    unexpected: () => "Kalsa couldn't do that. Try again.",
  },
  invite: {
    "invite.no_road": () => "Invites need a connection over the internet. Turn on “Connect over the internet” in Your AI → For experts → Server settings.",
    "invite.full": () => "You have reached the maximum number of invites. Cancel one to make a new one.",
    "invite.could_not_make": () => "Kalsa couldn't create the invite. Try again.",
    "invite.could_not_save": () => "Kalsa couldn't save the invitation. Try again.",
    "invite.expired": () => "This invite has expired. Make a new one.",
  },
  pairing: {
    "pairing.save_failed": () => "Kalsa couldn't save this change. Try again.",
    "pairing.phone_with_ai": (params) =>
      typeof params.gb === "number" && Number.isFinite(params.gb) && params.gb > 0
        ? "Phone with its own AI"
        : "Phone without its own AI",
    "pairing.phone_without_ai": () => "Phone without its own AI",
    "pairing.host_forget": () => "This computer's own connection cannot be removed.",
  },
  update: {
    check_failed: () => "Kalsa couldn't check for updates. Try again later.",
    download_failed: () => "Kalsa couldn't download the update. Try again.",
    signature_failed: () => "The update could not be verified, so Kalsa did not install it.",
    install_failed: () => "Kalsa couldn't install the update. Try again.",
    busy: () => "Kalsa is starting. Try again when it is ready.",
    up_to_date: () => "Kalsa is already up to date.",
    replying: () => "Kalsa is writing a reply. Install the update when it finishes.",
    changed: () => "The update changed since it was checked. Check again.",
  },
  road: {
    off: () => "Internet connection is off. The phone connects through Tailscale.",
    waiting: () => "Internet connection is waiting for the server to run.",
    opening: () => "Internet connection is opening.",
    open: () => "Internet connection is on.",
    unavailable: () => "Internet connection could not open on this computer.",
  },
  files: {
    list_failed: () => "Kalsa can't open this folder. Choose another.",
    not_found: () => "Kalsa can't find this file. Choose another.",
    permission_denied: () => "Kalsa isn't allowed to open this file. Choose another.",
    unsupported: () => "Kalsa can't open this file. Choose another.",
    is_folder: () => "That's a folder. Pick a file inside it.",
    too_large: (params) =>
      typeof params.limit === "string"
        ? `This file is too large (limit ${params.limit}). Try a smaller one.`
        : "This file is too large. Try a smaller one.",
  },
  vision: {
    does_not_fit: () => "This computer doesn't have enough memory for this AI to see pictures.",
    busy: () => "Kalsa is already setting up picture support. Wait a moment.",
    none: () => "Picture support isn't available for this AI.",
  },
  web: {
    page_too_long: () => "That page is too long for Kalsa to read.",
    search_failed: () => "Kalsa couldn't search the web. Try again.",
    page_failed: () => "Kalsa couldn't open that page. Try again.",
    open_failed: () => "This computer couldn't open the link.",
    link_unseen: (params) => refusedOpen(params, "that address never appeared in this chat. Give Kalsa the exact address to open it."),
    armed: (params) => refused(params, "this chat holds your mail or documents, so Kalsa doesn't open websites here. Open it yourself.", "this chat holds your mail or documents, so Kalsa does nothing in a website here. You can do it yourself."),
    switch_off: (params) => refused(params, "web access is off in Settings. Turn on “Let Kalsa search the web” and Kalsa can open pages.", "web access is off in Settings. Turn on “Let Kalsa search the web” and Kalsa can work in the browser."),
  },
  browser: {
    unsupported_platform: () => "This computer has no browser Kalsa can use.",
    busy: () => "Kalsa is already using the browser. Try again in a moment.",
    cancelled: () => "The download was stopped. Nothing was installed.",
    download_failed: () => "Kalsa couldn't download its browser driver. Try again.",
    driver_corrupt: () => "The browser driver is damaged, so Kalsa unpacked nothing.",
    driver_changed: () => "The browser driver on disk is not the one Kalsa installed.",
    unpack_failed: () => "The browser driver didn't unpack into something usable.",
    storage: () => "Kalsa couldn't read or write its own folder.",
    failed: () => "Kalsa couldn't reach the browser. Try again.",
    refused: () => "Kalsa wouldn't open that.",
    no_pending_request: () => "That request is not waiting for an answer any more.",
    read_again: () => "Kalsa had already read that part of the page.",
    robot_check: () => "The site asked for a human check. Kalsa cannot pass it; you can, in the browser window.",
  },
};
