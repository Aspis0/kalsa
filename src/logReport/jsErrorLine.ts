/**
 * The js_error record for an unhandled JS exception: the error's `name` when
 * it is a code-defined literal, and the FIRST stack frame reduced to
 * `basename:line:column`. NEVER reads or serializes `error.message` — the
 * message is where user text, URLs and paths live, and on Hermes release
 * builds the message IS the first stack line.
 */

/**
 * Standard Error subclasses plus every custom `.name = "…"` literal in src
 * (src/research/deepResearch.ts:78, src/memory/MemoryStore.ts:27,36,45,
 * src/pdf/pdfTextService.ts:59, src/components/PdfToImages.tsx:86,
 * src/voice/VoiceCapture.ts:47, src/voice/WhisperService.ts:222,
 * src/documents/docxToText.ts:22, src/documents/importSharedDocument.ts:32,
 * src/account/useAccount.ts:14, src/engine/ModelDownloader.ts:53,60,67,74).
 * A name outside the set (prompt-injected, host-provided) is just "Error".
 */
const SAFE_NAMES: ReadonlySet<string> = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "EvalError",
  "URIError",
  "AggregateError",
  "AbortError",
  "MemoryWriteError",
  "MemoryCapacityError",
  "MemoryDuplicateError",
  "PdfTextServiceError",
  "PdfExtractError",
  "CaptureBusyError",
  "WhisperModelMissingError",
  "DocxExtractError",
  "SharedImportError",
  "InvalidEmailError",
  "UnpublishedArtifactError",
  "Sha256VerificationUnavailableError",
  "InvalidSha256DigestError",
  "IntegrityMismatchError",
]);

/**
 * Bundle basenames a real frame can sit on: the app bundles, plus Hermes
 * release's anonymous targets. The line:col pair is the bytecode offset that
 * source maps resolve. Anything else — a dev-server URL, a source path, a
 * message line posing as a frame — is not a location we emit.
 */
const BUNDLE_BASENAMES: ReadonlySet<string> = new Set([
  "index.android.bundle",
  "main.jsbundle",
  "index.bundle",
  "unknown",
  "native",
]);

function errorName(error: unknown): string {
  try {
    const name = (error as { name?: unknown } | null)?.name;
    if (typeof name === "string" && SAFE_NAMES.has(name)) return name;
  } catch {
    // a throwing name getter is still just "Error"
  }
  return "Error";
}

/**
 * First frame of the stack, reduced to basename:line:col, else `none`. The
 * first stack line is the message, so it is skipped unconditionally; a frame
 * line must start with optional spaces + "at ", and only the FIRST such line
 * is read — its location must land on a known bundle basename or the frame is
 * `none`. The function name is never emitted.
 */
function firstFrame(error: unknown): string {
  let stack: unknown;
  try {
    stack = (error as { stack?: unknown } | null)?.stack;
  } catch {
    stack = undefined;
  }
  if (typeof stack !== "string") return "none";
  const lines = stack.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (!/^\s*at /.test(lines[i])) continue;
    const match = lines[i].match(/([^\s()]+?):(\d+):(\d+)\)?\s*$/);
    if (!match) return "none";
    const base = match[1].split(/[?#]/)[0].split("/").pop() ?? "";
    return BUNDLE_BASENAMES.has(base) ? `${base}:${match[2]}:${match[3]}` : "none";
  }
  return "none";
}

/** `js_error name=<name> frame=<basename:line:col>` — nothing else. */
export function formatJsErrorLine(error: unknown): string {
  return `js_error name=${errorName(error)} frame=${firstFrame(error)}`;
}
