// The family of presses that never left, in Rust and in the page: one list, two
// languages, and a contract that says the two are the same list.
//
// **Why the mirror exists.** The refusal that a press went nowhere — the
// browser was busy, or the request was not waiting for an answer any more — is
// named twice: in Rust, by `BrowserError::a_press_that_never_went` in
// `src-tauri/src/browser/error.rs`, and in the page, by `isPressThatNeverLeft`
// in `chat/src/lib/browser/codes.ts`. The two halves of the app are two
// languages and neither can call the other: Rust decides what the sidecar said
// and what becomes of a press, and the page decides what the window does with
// the same refusal. **The mirror cannot be removed, so the drift can be.**
//
// **What the contract guarantees.** The two lists name the same codes. Every
// refusal that leaves no outcome behind in Rust leaves none in the page, and
// every code the page treats as a press that never went is one Rust treats the
// same way. That is not a tidiness rule: the two halves decide the same thing
// about one press, and a code on one side alone is the model being told that a
// request it never sent was settled — or a card that was never answered
// coming back as if it were.
//
// **Both lists are read from the sources, not written down here.** The Rust
// list is derived from the code each failure answers with and from the
// function that names them; the page's list is the app's own function, run
// over the app's own codes. A third copy of either list, in this file, would
// be one more thing to keep in step with the other two — and the drift this
// exists to catch would then have a third place to hide in.
//
// Run: node scripts/press-family-contract.mjs   (from chat/)

import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../node_modules/esbuild/lib/main.js";

const REPO_DIR = fileURLToPath(new URL("../..", import.meta.url));
const RUST_ERROR = `${REPO_DIR}/src-tauri/src/browser/error.rs`;
const RUST_CONFIRM = `${REPO_DIR}/src-tauri/src/browser/confirm.rs`;
const RUST_PHONE = `${REPO_DIR}/src-tauri/src/phone_chat.rs`;
const TS_CODES = `${REPO_DIR}/chat/src/lib/browser/codes.ts`;
const TS_CONFIRM = `${REPO_DIR}/chat/src/lib/browser/confirm.ts`;

let fail = 0;
function check(label, condition, detail) {
  if (!condition) fail++;
  console.log(`${condition ? "ok  " : "FAIL"} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}

/** A Rust file without its comments: a name or a brace inside a comment is not
 * code, and a scan that counted one would read a shape that is not there. */
function codeOf(path) {
  return readFileSync(path, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
}

/** The body of a Rust function, braces counted: a scan that stopped at the
 * first `}` would stop at an arm of a match and not at the end of the
 * function. */
function bodyOf(source, signature) {
  const at = source.indexOf(signature);
  if (at === -1) return null;
  const open = source.indexOf("{", at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** The code each failure answers with, from the `code()` function: the arms
 * that answer with a literal of their own. The one that answers with another
 * code's own text is not one of these, and it is not in the family either. */
function rustCodesByVariant(source) {
  const body = bodyOf(source, "fn code(&self) -> &'static str");
  if (body === null) return null;
  const codes = new Map();
  for (const match of body.matchAll(/Self::(\w+)\s*=>\s*"([^"]+)"/g)) codes.set(match[1], match[2]);
  return codes;
}

/** The family, from the function that names it: the failures whose own code it
 * asks for. A failure this guard cannot name is a failure it cannot check —
 * so it is reported, not dropped. */
function rustFamily(source, codes) {
  const body = bodyOf(source, "fn a_press_that_never_went");
  if (body === null) return { family: null, unknown: null };
  const family = [];
  for (const match of body.matchAll(/Self::(\w+)\.code\(\)/g)) {
    const code = codes.get(match[1]);
    if (code === undefined) return { family: null, unknown: match[1] };
    family.push(code);
  }
  return { family, unknown: null };
}

/** The page's own list, run over the page's own codes: the app's function, not
 * a copy of it. */
async function pageFamily() {
  const dir = await mkdtemp(join(tmpdir(), "kalsa-press-family-"));
  const outfile = join(dir, "codes.mjs");
  try {
    await build({
      stdin: {
        contents: `export { BROWSER_CODES, isPressThatNeverLeft, isCardAlreadyResolved } from "../src/lib/browser/codes.ts";`,
        resolveDir: fileURLToPath(new URL(".", import.meta.url)),
        loader: "ts",
      },
      bundle: true,
      format: "esm",
      platform: "node",
      outfile,
      logLevel: "silent",
    });
    const { BROWSER_CODES, isPressThatNeverLeft, isCardAlreadyResolved } = await import(pathToFileURL(outfile).href);
    return {
      family: BROWSER_CODES.filter((code) => isPressThatNeverLeft(code)),
      closed: BROWSER_CODES.filter((code) => isCardAlreadyResolved(code)),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const rustSource = codeOf(RUST_ERROR);
const rustCodes = rustCodesByVariant(rustSource);
check("the Rust codes could be read", rustCodes !== null && rustCodes.size > 0);
const rust = rustFamily(rustSource, rustCodes ?? new Map());
check(
  "the Rust family could be read",
  rust.family !== null,
  rust.unknown === null ? "a_press_that_never_went is not in src-tauri/src/browser/error.rs" : `it names ${rust.unknown}, which this guard cannot read`,
);

const page = await pageFamily();

if (rust.family !== null) {
  const rustSet = new Set(rust.family);
  const pageSet = new Set(page.family);
  const onlyRust = [...rustSet].filter((code) => !pageSet.has(code)).sort();
  const onlyPage = [...pageSet].filter((code) => !rustSet.has(code)).sort();
  check(
    "the family of presses that never left is the same list in both languages",
    onlyRust.length === 0 && onlyPage.length === 0,
    `Rust only: ${onlyRust.join(", ") || "none"}; the page only: ${onlyPage.join(", ") || "none"}`,
  );
  console.log(`     the family: ${[...rustSet].sort().join(", ")}`);
  check("and it is a family, not an empty rule", rustSet.size > 0 && pageSet.size > 0);

  // **The closed half is inside the family.** A card the window closes is a
  // press that never went: closing a card whose request might have been sent
  // would take away a decision the person still had to make.
  const outside = page.closed.filter((code) => !rustSet.has(code)).sort();
  check(
    "every code the page closes a card with is a press that never went",
    outside.length === 0,
    outside.join(", "),
  );
}

// **The mirror has to be load-bearing on both sides.** A list both halves
// agree on and neither reads is not a rule: it would pass this contract and
// change nothing.
const rustConfirm = codeOf(RUST_CONFIRM);
const rustPhone = codeOf(RUST_PHONE);
const tsConfirm = codeOf(TS_CONFIRM);
check(
  "the Rust rule that leaves an outcome behind reads the family",
  (bodyOf(rustConfirm, "fn leaves_an_outcome") ?? "").includes("a_press_that_never_went"),
);
check(
  "the phone's rule reads the family",
  rustPhone.includes("BrowserError::a_press_that_never_went"),
);
check(
  "the page's rule reads the family",
  tsConfirm.includes("isPressThatNeverLeft"),
);

console.log(fail === 0 ? "\nall checks passed" : `\n${fail} check(s) failed`);
process.exit(fail === 0 ? 0 : 1);
