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
    try {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
