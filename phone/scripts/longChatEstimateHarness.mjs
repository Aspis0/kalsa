/**
 * Harness for src/chat/longChatEstimate.ts
 *
 * Pins the documented boundary from the module header:
 *   ONE attachment turn must not nudge on an 8192 model; two should.
 * ESTIMATED_TOKENS_PER_IMAGE = 800 is UNVALIDATED against a real model —
 * this harness pins current behaviour only; do not "fix" the constant.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/longChatEstimateHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/chat/longChatEstimate.ts",
      "src/engine/contextProfile.ts",
      "--outDir",
      outDir,
      "--module",
      "nodenext",
      "--target",
      "es2020",
      "--moduleResolution",
      "nodenext",
      "--skipLibCheck",
      "--ignoreConfig",
      "--types",
      "node",
    ],
    { cwd: projectRoot, encoding: "utf8", shell: true },
  );
  if (r.status !== 0) {
    console.error("tsc failed:\n", r.stdout, r.stderr);
    process.exit(1);
  }
}

function resolveBuilt(base) {
  const candidates = [
    path.join(outDir, `chat/${base}`),
    path.join(outDir, `src/chat/${base}`),
    path.join(outDir, `engine/${base}`),
    path.join(outDir, `src/engine/${base}`),
    path.join(outDir, base),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${base}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS ${name}`);
    pass++;
  } else {
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

async function main() {
  console.log("Compiling longChatEstimate …");
  compile();
  const mod = await import(
    pathToFileURL(resolveBuilt("longChatEstimate.js")).href
  );
  const {
    ESTIMATED_TOKENS_PER_IMAGE,
    MAX_IMAGE_SLOTS_PER_MESSAGE,
    imageSlotsFromAttachment,
    imageSlotsForMessage,
    countConversationImageSlots,
    estimateConversationTokens,
    shouldShowLongChatNudge,
    LONG_CHAT_MESSAGE_THRESHOLD,
  } = mod;

  // Pin unvalidated constant — do not change without a real-model measurement.
  check(
    "ESTIMATED_TOKENS_PER_IMAGE pinned at 800 (unvalidated)",
    ESTIMATED_TOKENS_PER_IMAGE === 800,
  );
  check("MAX_IMAGE_SLOTS_PER_MESSAGE is 5", MAX_IMAGE_SLOTS_PER_MESSAGE === 5);

  // Image attachment → 1 slot
  check(
    "image attachment = 1 slot",
    imageSlotsFromAttachment({ kind: "image" }) === 1,
  );

  // PDF with pageCount
  check(
    "pdf pageCount slots",
    imageSlotsFromAttachment({ kind: "pdf", pageCount: 3 }) === 3,
  );
  check(
    "pdf pages[] slots",
    imageSlotsFromAttachment({ kind: "pdf", pages: ["a", "b"] }) === 2,
  );
  check(
    "pdf unknown pages → 1",
    imageSlotsFromAttachment({ kind: "pdf" }) === 1,
  );
  check(
    "unknown kind → 0",
    imageSlotsFromAttachment({ kind: "audio" }) === 0,
  );

  // Per-message cap at MAX_IMAGE_SLOTS_PER_MESSAGE
  check(
    "message caps pdf pageCount at 5",
    imageSlotsForMessage({
      attachments: [{ kind: "pdf", pageCount: 20 }],
    }) === 5,
  );

  // No attachments
  check("no attachments → 0 slots", imageSlotsForMessage({ text: "hi" }) === 0);
  check(
    "null attachments → 0",
    imageSlotsForMessage({ text: "hi", attachments: null }) === 0,
  );

  // Documented 8192 boundary: one 5-image turn must not nudge; two should.
  // threshold = 8192 * 2/3 ≈ 5461.33
  // one turn: 5 * 800 = 4000 < 5461 → no nudge
  // two turns: 8000 > 5461 → nudge
  const oneTurn = [
    {
      text: "",
      attachments: [{ kind: "pdf", pageCount: 5 }],
    },
  ];
  const twoTurns = [
    { text: "", attachments: [{ kind: "pdf", pageCount: 5 }] },
    { text: "", attachments: [{ kind: "pdf", pageCount: 5 }] },
  ];
  check(
    "one attachment turn no nudge on 8192",
    shouldShowLongChatNudge(oneTurn, 8192) === false,
    `tokens=${estimateConversationTokens(oneTurn)}`,
  );
  check(
    "two attachment turns nudge on 8192",
    shouldShowLongChatNudge(twoTurns, 8192) === true,
    `tokens=${estimateConversationTokens(twoTurns)}`,
  );

  // Message-count independent OR
  const many = Array.from({ length: LONG_CHAT_MESSAGE_THRESHOLD + 1 }, () => ({
    text: "x",
  }));
  check(
    "message count threshold fires",
    shouldShowLongChatNudge(many, 8192) === true,
  );

  // Defensive inputs
  check(
    "empty messages no nudge",
    shouldShowLongChatNudge([], 8192) === false,
  );
  check(
    "negative engineCtx falls back",
    typeof shouldShowLongChatNudge([{ text: "hi" }], -1) === "boolean",
  );
  check(
    "NaN engineCtx falls back",
    typeof shouldShowLongChatNudge([{ text: "hi" }], Number.NaN) === "boolean",
  );
  check(
    "huge pageCount capped per message",
    imageSlotsForMessage({
      attachments: [{ kind: "pdf", pageCount: 1e9 }],
    }) === 5,
  );
  check(
    "negative pageCount ignored → 1 for pdf",
    imageSlotsFromAttachment({ kind: "pdf", pageCount: -3 }) === 1,
  );

  // Determinism
  const msgs = [
    { text: "hello world", attachments: [{ kind: "image" }] },
    { text: "more", attachments: [{ kind: "pdf", pageCount: 2 }] },
  ];
  check(
    "estimate deterministic",
    estimateConversationTokens(msgs) === estimateConversationTokens(msgs),
  );
  check(
    "count slots deterministic",
    countConversationImageSlots(msgs) === countConversationImageSlots(msgs),
  );

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
