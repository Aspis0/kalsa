// Shared plumbing for the offline scripts that exercise the app's own
// TypeScript: compile the real modules with esbuild, and refuse to skip when
// a server is needed but none answers.
//
// The sampling round trip (do the knobs arrive?) and behaviour test (do they
// change what the model writes?) must run the real `samplingWire`,
// `completionBody` and `completionsUrl`, and the tool-call scripts the real
// loop and repairs — a JavaScript re-implementation would test the
// re-implementation. This module is the one place that compiles the app's
// modules, and the one place that turns a dead endpoint into a loud failure
// with the command that fixes it.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../../node_modules/esbuild/lib/main.js";

const CHAT_DIR = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPTS_DIR = fileURLToPath(new URL("..", import.meta.url));

/// Compiles the real TypeScript and re-exports the functions under test. A
/// virtual entry (esbuild `stdin`) keeps this to one file: nothing is copied
/// into JavaScript, and nothing new is written beside the app. The caller owns
/// the returned temp directory and must remove it.
export async function loadApp() {
  const dir = await mkdtemp(join(tmpdir(), "kalsa-app-bundle-"));
  const outfile = join(dir, "app.mjs");
  await build({
    stdin: {
      contents: `
        export { samplingWire } from "../src/lib/sampling.ts";
        export { completionBody, completionsUrl, activateChat, eraseChat, DOOR_SILENT } from "../src/lib/chat.ts";
        export { createSlotGate, standingOf, lastKnown } from "../src/lib/slotGate.ts";
        export { parseContextSize, ensureContextSize, rememberContextSize, forgetContextSize, hasContextSize } from "../src/lib/contextSize.ts";
        export { SAMPLING_KNOBS } from "../src/lib/knobs/sampling.ts";
        export { accumulate, readArguments, wireArguments, MAX_ARGUMENTS } from "../src/lib/toolCalls.ts";
        export { canonicalToolName, repairToolCall } from "../src/lib/repairToolCall.ts";
        export { recoverToolCall } from "../src/lib/recoverToolCall.ts";
        export { phoneTools, phoneConversation, runPhoneTurn } from "../src/lib/phone/phoneTurn.ts";
        export { fences, browserOpen, browserClose } from "../src/lib/tools/browserCall.ts";
        export { noteBrowserStatus, browserUsable } from "../src/lib/browser/usable.ts";
        export { refreshBrowserStatus } from "../src/lib/browser/useStatus.ts";
        export { isBrowserRun } from "../src/lib/browser/runs.ts";
        export { guideCut, guideNotValidJson, guideProblem } from "../src/lib/guideRetry.ts";
        export { TOOL_DEFINITIONS, WEB_TOOLS } from "../src/lib/tools/definitions.ts";
        export { BROWSER_TOOLS } from "../src/lib/tools/browserTools.ts";
        export { browserAnswer } from "../src/lib/tools/browserCall.ts";
        export {
          answer as browserAnswerNow,
          currentCards as currentBrowserCards,
          destinationLabel as browserDestinationLabel,
          noteAnswered as noteBrowserAnswered,
          noteCards as noteBrowserCards,
          settledFor as settledBrowserCards,
          DOTS as browserDots,
          pressPause as browserPressPause,
          takeOutcomes as takeBrowserOutcomes,
        } from "../src/lib/browser/confirm.ts";
        export {
          isOpen as isBrowserWindowOpen,
          isPaused as isBrowserPaused,
          startWindowBus as startBrowserWindowBus,
        } from "../src/lib/browser/window.ts";
        export { publicHttpUrl } from "../src/lib/publicUrl.ts";
        export { actionKey, decide, filed, newLedger, BROWSER_CALLS_PER_TURN } from "../src/lib/callLedger.ts";
        export { recapLine, recapOf } from "../src/lib/browser/recap.ts";
        export { closeRecap, sayRuns, takeNote } from "../src/lib/browser/note.ts";
        export { BROWSER_CODES, browserCode, browserCodeWords, isDeterministic } from "../src/lib/browser/codes.ts";
        export { streamChatCompletion } from "../src/lib/toolLoop.ts";
        export { offeredTools, executeToolCall } from "../src/lib/tools/registry.ts";
        export { thinkingSupport } from "../src/lib/thinking.ts";
        export { createToolMarkupStripper } from "../src/lib/toolMarkup.ts";
        export { getBrainRead, subscribeBrainRead } from "../src/surfaces/useBrain.ts";
        export { heldStepAfter, progressTaken, walkArmedAfter, walkStepShown } from "../src/surfaces/walkStep.ts";
        export { buildMiniappV1 } from "../src/lib/miniapp/build.ts";
        export { evaluateCalculatorFormula } from "../src/lib/miniapp/calculator.ts";
        export { MINIAPP_TEMPLATE_IDS } from "../src/lib/miniapp/templates.ts";
        export { TABLES } from "../src/i18n/index.ts";
        export { normalizeMiniapp } from "../src/lib/miniapp/normalize.ts";
        export { checklistItems, isItemTicked, toggleChecklistItem, quizAnswer, recordQuizAnswer, calculatorValues, calculatorResult, recordCalculatorValues } from "../src/lib/miniapp/state.ts";
        export { miniappStateLines } from "../src/lib/miniapp/stateText.ts";
        export { parseLocaleNumber } from "../src/components/miniapp/values.ts";
        export { displayTitle } from "../src/components/miniapp/title.ts";
        export { MINIAPP as ITALIAN_MINIAPP } from "../src/i18n/it/miniapp.ts";
        export { runCreateMiniapp } from "../src/lib/tools/createMiniapp.ts";
        export { createStore, forDisk } from "../src/lib/store.ts";
        export { createAttachGate, NEW_CHAT } from "../src/lib/attachGate.ts";
        export { buildPinnedContext, estTokens, turnDocBlock } from "../src/lib/attachments.ts";
        export { sentDatePhrase } from "../src/lib/sentDate.ts";
        export { newUserTurn } from "../src/lib/userTurn.ts";
        export { mailRecord, mailRecords } from "../src/lib/mail/records.ts";
        export { normalizeMail, mailCount } from "../src/lib/mail/normalize.ts";
        export { fencedBody } from "../src/lib/mail/fence.ts";
        export { guessServer } from "../src/lib/mail/providers.ts";
        export { appPasswordProvider, APP_PASSWORD_PAGE } from "../src/lib/mail/appPassword.ts";
        export { prepareCredentials } from "../src/lib/mail/credentials.ts";
        export { accountErrorKey } from "../src/lib/mail/accountError.ts";
        export { runMailShow } from "../src/lib/tools/mailShow.ts";
        export { sendReply } from "../src/lib/mail/send.ts";
        export { accountEmail, rememberAccount } from "../src/lib/mail/account.ts";
        export { mailFailure, UNKNOWN_FAILURE } from "../src/lib/mail/failure.ts";
        export { fencedField } from "../src/lib/mail/fence.ts";
        export { cardsFrom, cardIds } from "../src/lib/mail/cards.ts";
        export { mailId } from "../src/lib/mail/mailId.ts";
        export { runMailList, runMailRead, runMailDraft } from "../src/lib/tools/mailCall.ts";
        export { draftFor, withDraft, sentToFor, withSent } from "../src/lib/mail/drafts.ts";
        export { pendingFor, withBody } from "../src/lib/mail/drafts.ts";
        export { mailAllowed } from "../src/lib/mail/allowlist.ts";
        export { isMailRun } from "../src/lib/mail/runs.ts";
        export { pendingSend, replySubject } from "../src/lib/mail/pending.ts";
        export { MAIL_TOOLS, mailShowTool } from "../src/lib/tools/definitions.ts";
        export { MAIL as ITALIAN_MAIL } from "../src/i18n/it/mail.ts";
        export { MAIL as ENGLISH_MAIL } from "../src/i18n/en/mail.ts";
      `,
      resolveDir: SCRIPTS_DIR,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    outfile,
    nodePaths: [join(CHAT_DIR, "node_modules")],
    loader: { ".css": "empty" },
    logLevel: "silent",
    // `chat.ts` decides whether a test may reach `window.__kalsaTimings__` by
    // reading `import.meta.env.DEV`. Vite folds that to a literal at build time;
    // Node has no `import.meta.env` at all, so the property read throws the
    // moment a turn starts. These scripts are dev harnesses, so the flag is
    // supplied here exactly as a dev server would supply it.
    define: { "import.meta.env.DEV": "true" },
    plugins: [
      {
        // attachments.ts imports the pdf.js worker as a vite `?url` asset; the
        // worker only matters when a PDF is extracted, which these tests never do.
        name: "vite-url-asset",
        setup(build) {
          build.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: "url-asset" }));
          build.onLoad({ filter: /.*/, namespace: "url-asset" }, () => ({
            contents: 'export default "";',
            loader: "js",
          }));
        },
      },
    ],
  });
  const app = await import(`${pathToFileURL(outfile).href}?cache=${Date.now()}`);
  return { dir, app };
}

/// The exact command that would put a server behind this endpoint, so a failed
/// health check is actionable instead of a silent skip.
export function startCommand(endpoint) {
  const url = new URL(endpoint);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return [
    `"$HOME/Library/Application Support/kalsa-brain/runtime/builds/metal/llama-b10950/llama-server"`,
    "--host 127.0.0.1",
    `--port ${port}`,
    `--model "$HOME/Library/Application Support/kalsa-brain/runtime/models/gemma-4-E4B-it-Q4_K_M.gguf"`,
    "--n-gpu-layers all",
    "--flash-attn on",
    "--cache-type-k q8_0",
    "--cache-type-v q8_0",
    "--ctx-size 4096",
    "--no-webui",
  ].join(" ");
}

/// Never skips silently: a test that passes because it did nothing is worse
/// than no test.
export async function requireServer(endpoint) {
  try {
    const response = await fetch(new URL("/health", endpoint), {
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) return;
  } catch {
    // fall through to the loud failure
  }
  console.error(`No llama-server answers /health at ${endpoint}.`);
  console.error("Start one, then run this again:");
  console.error(`  ${startCommand(endpoint)}`);
  process.exit(1);
}
