export const DRIVER = {
  title: "Browser",
  // The driver is Kalsa's own; the person is only told what it costs and that
  // it is theirs to start. No "advanced", no file name.
  hint: "Kalsa drives the browser already on this computer. Its driver is a separate download.",
  needed: (size: string) => `Download the browser driver (${size}).`,
  download: "Download",
  downloading: (percent: number | null) =>
    percent === null ? "Downloading the browser driver…" : `Downloading the browser driver… ${percent}%`,
  ready: "Kalsa's browser driver is ready.",
  failed: "Kalsa could not download its browser driver. Try again.",
  retry: "Try again",
  // Stopping is the person's call, so the press sits on the bar itself and
  // says nothing more than what it does.
  cancel: "Stop the download",
  cancelled: "The download was stopped. Nothing was installed.",
  // Why a 40 MB download that is verified, and why it is not a silent update.
  note: "It is about 40 MB, it is checked before it is used, and Kalsa will not update it on its own.",
  clearTitle: "Browser data",
  clearHint: "The logins and pages Kalsa's browser kept.",
  clear: "Clear Kalsa's browser data",
  cleared: "Kalsa's browser data is cleared.",
  // A clear that did not happen must not read as a clear that did. It says so
  // and leaves the press, because the button is still there and still means it.
  clearFailed: "Kalsa could not clear its browser data. Nothing was changed.",
};