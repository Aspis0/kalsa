/** Whether this window runs on an Apple system, where the search shortcut is
    written with the command key. The platform string is the webview's own;
    anything that is not Apple's is written the way Windows and Linux write it. */
export function onApplePlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The search shortcut as this platform's keyboard writes it. The handler
    accepts either modifier everywhere; only the hint differs. */
export function searchShortcutLabel(platform: string): string {
  return onApplePlatform(platform) ? "⌘K" : "Ctrl+K";
}
