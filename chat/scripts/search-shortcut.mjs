// The sidebar's search hint is written the way the platform's keyboard writes
// it: ⌘K on Apple systems, Ctrl+K everywhere else.
//
// Pure. Run: node scripts/search-shortcut.mjs   (from chat/)

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../node_modules/esbuild/lib/main.js";

const dir = await mkdtemp(join(tmpdir(), "kalsa-shortcut-"));
const outfile = join(dir, "shortcut.mjs");
await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/shortcut.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  logLevel: "silent",
});
const { searchShortcutLabel } = await import(pathToFileURL(outfile).href);

let fail = 0;
function equal(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n     got ${actual}, want ${expected}`}`);
}
// The strings the webviews report: WKWebView on a Mac, WebView2 on Windows.
equal("a Mac shows the command key", searchShortcutLabel("MacIntel"), "⌘K");
equal("an Apple-silicon Mac too", searchShortcutLabel("macOS"), "⌘K");
equal("Windows shows Ctrl+K", searchShortcutLabel("Win32"), "Ctrl+K");
equal("Linux shows Ctrl+K", searchShortcutLabel("Linux x86_64"), "Ctrl+K");
equal("an unknown platform shows Ctrl+K", searchShortcutLabel(""), "Ctrl+K");

await rm(dir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
