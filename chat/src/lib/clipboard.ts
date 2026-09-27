// The one road to the system clipboard. Two attempts, in the order the code
// blocks have always made: the Clipboard API, then a selected textarea for
// the webviews where that API is refused. `false` means neither worked —
// the caller then shows the text to select by hand, and never logs it: what
// travels here is a code the page was never meant to render.

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    // The field exists for the length of the attempt and not a moment
    // longer: whatever this throws — no `select`, no `execCommand` — the
    // `finally` empties it and takes it out of the document, so a refused
    // copy never leaves the text sitting in the page.
    try {
      area.value = text;
      document.body.appendChild(area);
      area.select();
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.value = "";
      try {
        area.remove();
      } catch {
        // A document that refuses removal keeps an empty field, never the
        // text: the value is already gone.
      }
    }
  }
}
