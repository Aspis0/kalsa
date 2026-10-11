// One command for a verify run: start the dev server and the mock endpoint
// when they are not already answering, run verify.mjs with the arguments
// passed through, and stop only the children this runner started. An
// interrupt stops the verify run too, so no browser outlives the runner.
// Run: `npm run verify -- [test ...]`
import { spawn } from "node:child_process";
import { once } from "node:events";
import { openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { reachable } from "./preflight.mjs";

const CHAT_DIR = fileURLToPath(new URL("..", import.meta.url));
// The vite bin itself, not `npx vite`: killing npx would not reliably reach
// the dev server it forks, and an orphaned Vite keeps port 5173 busy.
const VITE_BIN = join(CHAT_DIR, "node_modules/vite/bin/vite.js");
const SERVERS = [
  { url: "http://localhost:5173", args: [VITE_BIN, "--port", "5173", "--strictPort"] },
  { url: "http://127.0.0.1:18081", args: ["scripts/mock-server.mjs"] },
];

const started = [];
let verify = null;

function exited(child) {
  return child.exitCode !== null || child.signalCode !== null || child.pid === undefined;
}

function cleanup() {
  for (const child of started) child.kill();
  if (verify !== null && !exited(verify)) verify.kill();
}

// The verify run gets the signal first and a few seconds to finish its own
// cleanup, then the servers go with it.
async function stopAndExit(signal) {
  if (verify !== null && !exited(verify)) {
    verify.kill(signal);
    await Promise.race([once(verify, "exit"), new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
  cleanup();
  process.exit(130);
}

async function startServer({ url, args }) {
  const logPath = join(tmpdir(), `verify-run-${new URL(url).port}.log`);
  const log = openSync(logPath, "w");
  const child = spawn(process.execPath, args, { cwd: CHAT_DIR, stdio: ["ignore", log, log] });
  started.push(child);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !exited(child)) {
    if ((await reachable(url, { quickMs: 500, patientMs: 2000 })).ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log(`${url} did not answer after start; its output is in ${logPath}`);
  return false;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stopAndExit(signal));
}

let exitCode = 1;
try {
  let ready = true;
  for (const server of SERVERS) {
    if ((await reachable(server.url)).ok) continue;
    if (!(await startServer(server))) {
      ready = false;
      break;
    }
  }
  if (ready) {
    verify = spawn(process.execPath, ["scripts/verify.mjs", ...process.argv.slice(2)], {
      cwd: CHAT_DIR,
      stdio: "inherit",
    });
    exitCode = await new Promise((resolve) => verify.on("exit", (code) => resolve(code ?? 1)));
  }
} finally {
  cleanup();
}
process.exit(exitCode);
