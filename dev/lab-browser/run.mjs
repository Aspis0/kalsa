// The driver (one responsibility: parse the flags, run every task the asked
// number of times, write one json line per run, and print the summary table).
//   node run.mjs --endpoint http://127.0.0.1:8080 --model qwen3.6-35b-a3b
//                [--think false] [--tasks 1,2] [--runs 3]
//   node run.mjs --fake --tasks 1,2        # no model: proves the harness
//
// --backend rs builds dev/lab-browser-rs first and stops on its exit code, so a
// run can never be a report on a binary left over from an earlier afternoon.
import { spawnSync } from "node:child_process";
import { runTask, STEP_CAP, WALL_CAP_MS } from "./agent.mjs";
import { openBackend, RS_CRATE } from "./backends.mjs";
import { ask } from "./engine.mjs";
import { fakeModel, fakeTasks } from "./fake.mjs";
import { SYSTEM_PROMPT, tasksFor } from "./tasks.mjs";
import { TOOLS } from "./tools.mjs";


const argValue = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : process.argv[at + 1];
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

/** The table, then every run that did not pass and why. A summary that only
 *  says "1/2" leaves the reader guessing, so each FAIL carries its own detail. */
function summary(rows, runs) {
  const head = ["task", "runs", "passed", "steps", "sec", "read", "prompt", "completion", "why"];
  const body = rows.map(({ task, name, runs: n, passed, steps, seconds, prompt, completion, why, read }) => [
    `${task} ${name}`,
    n,
    `${passed}/${n}`,
    steps,
    seconds,
    read,
    prompt || "-",
    completion || "-",
    why,
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(w[i])).join("  ").trimEnd();
  const table = [line(head), line(w.map((n) => "-".repeat(n))), ...body.map(line)].join("\n");

  const bad = runs.filter((r) => r.ok !== true && r.ok !== null);
  const notes = bad.length === 0
    ? "every judged run passed"
    : bad.map((r) => {
        const how = r.endedBy ? `ended by ${r.endedBy}` : "no answer";
        const read = r.answerSeen ? "answer was on a page it read" : "answer was not on any page it read";
        return `  task ${r.task} run ${r.run}: ${r.detail ?? "no detail"}${r.failure ? ` (${r.failure})` : ""} — ${how}, ${read}`;
      }).join("\n");
  return `${table}\n\nwhy runs were not ok:\n${notes}`;
}

/**
 * Build the Rust backend, and fail loudly if it will not build.
 *
 * `PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD` is set because the crate's build script
 * refuses to download a driver and says so otherwise; the driver this lab runs
 * against is named by `PLAYWRIGHT_DRIVER_PATH` at run time, not at build time.
 */
function buildRs() {
  const built = spawnSync("cargo", ["build", "--release"], {
    cwd: RS_CRATE,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD: "1" },
  });
  if (built.error) throw new Error(`the rust backend could not be built: ${built.error.message}`);
  if (built.status !== 0) throw new Error(`the rust backend did not build: cargo exited ${built.status}`);
}

async function main() {
  const fake = hasFlag("fake");
  // node drives Playwright in process; rs drives the Rust binary over JSON lines.
  const backend = argValue("backend") ?? "node";
  // --fake-prose plays task 2 ending in plain words rather than the finish
  // tool, which is how small models usually stop. It needs --fake as well.
  const prose = hasFlag("fake-prose");
  if (prose && !fake) throw new Error("--fake-prose only makes sense with --fake");
  const fakeName = prose ? "fake-prose" : "fake";
  const endpoint = argValue("endpoint");
  const model = argValue("model");
  if (!fake && (!endpoint || !model)) {
    throw new Error("--endpoint and --model are required (or run with --fake)");
  }
  // Thinking is on unless the run turns it off: --think false is the arm the
  // chat server spells as chat_template_kwargs.enable_thinking.
  const think = (argValue("think") ?? "true") !== "false";
  const runs = Number(argValue("runs") ?? 1);
  const tasks = tasksFor(argValue("tasks"));
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a whole number of at least 1");
  // **Task 4 needs a backend that holds a submission the way the product does.**
  // The rust backend is the product's own hold and answers a confirm for real;
  // the node backend is a reading stand-in and its confirm path is not
  // equivalent, so it is refused here — by name, and before anything starts —
  // rather than left to stall on a button.
  if (backend === "node" && tasks.some((task) => task.id === 4)) {
    throw new Error(
      "task 4 (a form that sends) runs through a confirm, and --backend node does not implement \
one: use --backend rs, which is the product's own hold.",
    );
  }

  if (fake) {
    const missing = tasks.map((t) => t.id).filter((id) => !fakeTasks().includes(id));
    if (missing.length > 0) {
      throw new Error(`the fake model only plays tasks ${fakeTasks().join(",")}; ask for --tasks ${fakeTasks().join(",")}`);
    }
  }

  // The Rust backend is built here rather than left to whoever built it last.
  //
  // It is a file at a fixed path, and a run that cannot build it starts whatever
  // is already sitting there without a word — which is how "the lab passes"
  // becomes a claim about code from three hours ago, against a source tree that
  // no longer even compiles. So: build, take its exit code, and stop.
  if (backend === "rs") buildRs();

  console.log(
    JSON.stringify({ event: "start", backend, model: fake ? fakeName : model, endpoint: fake ? null : endpoint, think, runs, tasks: tasks.map((t) => t.id) }),
  );

  const rows = [];
  for (let run = 1; run <= runs; run += 1) {
    for (const task of tasks) {
      const withTask = { ...task, systemPrompt: SYSTEM_PROMPT };
      const browser = await openBackend(backend);
      let record;
      try {
        const askOnce = fake
          ? fakeModel(withTask, { prose })
          : ({ messages }) => ask({ endpoint, model, messages, tools: TOOLS, think });
        // Only the fake run plays the person. A model run has no card and no
        // answer, which is the product as it ships: a held request waits for
        // somebody who is not in a lab loop.
        record = await runTask({
          task: withTask,
          browser,
          askOnce,
          model: fake ? fakeName : model,
          think,
          autoConfirm: fake,
        });
      } catch (error) {
        record = {
          task: task.id, name: task.name, steps: 0, seconds: 0, ok: false,
          detail: `harness threw: ${String(error?.message ?? error).split("\n")[0]}`,
          failure: "harness error", endedBy: null, looped: false, answerSeen: false, answer: "", promptTokens: 0, completionTokens: 0,
          lastUrl: browser.url, calls: [],
        };
      } finally {
        await browser.close();
      }
      rows.push({ run, ...record });
      console.log(JSON.stringify({ run, backend, model: fake ? fakeName : model, think, ...record }));
    }
  }

  const byTask = tasks.map((task) => {
    const rs = rows.filter((r) => r.task === task.id);
    const judged = rs.filter((r) => r.ok !== null);
    const why = [...new Set(rs.map((r) => r.failure).filter(Boolean))].join(", ") || (task.manual ? "manual" : "-");
    return {
      task: task.id, name: task.name, runs: rs.length,
      passed: judged.filter((r) => r.ok === true).length,
      steps: Math.round(rs.reduce((n, r) => n + r.steps, 0) / rs.length),
      seconds: (rs.reduce((n, r) => n + r.seconds, 0) / rs.length).toFixed(1),
      prompt: rs.reduce((n, r) => n + (r.promptTokens ?? 0), 0) || null,
      completion: rs.reduce((n, r) => n + (r.completionTokens ?? 0), 0) || null,
      // "none" only means anything when the answer had a number to look for.
      read: rs.every((r) => !/\d/.test(r.answer ?? "")) ? "-" : rs.every((r) => r.answerSeen) ? "all read" : rs.some((r) => r.answerSeen) ? "some" : "none",
      why: task.manual ? "manual — read the answer" : why,
    };
  });
  console.log(`\ncaps: ${STEP_CAP} steps, ${WALL_CAP_MS / 1000}s per task\n`);
  console.log(summary(byTask, rows));

  // A manual task is neither passed nor failed; anything else must pass.
  const failed = rows.some((r) => r.ok !== true && r.ok !== null);
  console.log(`\n${failed ? "FAIL" : "OK"} — ${rows.filter((r) => r.ok === true).length}/${rows.filter((r) => r.ok !== null).length} judged runs passed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(`error: ${String(error?.message ?? error).split("\n")[0]}`);
  process.exit(2);
});