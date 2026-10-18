// The checks (one responsibility: decide pass or fail from the page and the
// answer, with no human in the loop). A question is judged on the answer — the
// model may know the price without having opened the book, and that is a
// finding about the model, not about the page. A task that changes something is
// judged on the page, because there the answer could be a guess. Task 6 returns
// manual:true — it is recorded, not judged.
const fail = (detail) => ({ ok: false, detail });
const pass = (detail) => ({ ok: true, detail });

// How a number may be grouped on an Italian page: dot, comma, and the three
// spaces typographers use — NBSP, narrow NBSP and thin space — as well as a
// plain space, which is what a model writing "2 736 074" produces.
const SEP = "[.,\\u00A0\\u202F\\u2009\\u0020]";
// A separator only groups when exactly three digits follow it; anything less is
// a decimal mark, which is how 2,5 milioni stays a decimal.
const PLAIN = `\\d+(?:${SEP}\\d{3})*(?:[.,]\\d{1,2}(?!\\d))?`;
const NUM_RE = new RegExp(`(${PLAIN})(?:\\s*(milion|million|milioni|miliones)\\b)?`, "gi");
const MONEY_RE = new RegExp(`[£€$]?\\s*(${PLAIN})`, "gi");
const GROUPS = new RegExp(`${SEP}(?=\\d{3}(?!\\d))`, "g");

const toNumber = (raw) => Number.parseFloat(raw.replace(GROUPS, "").replace(",", "."));

/** Every number in the text, with grouping joined up: "2 736 074" and
 *  "2.736.074" are one number, and "2,5 milioni" is 2500000. */
export function numbersIn(text) {
  const out = [];
  for (const m of String(text).matchAll(NUM_RE)) {
    const value = toNumber(m[1]);
    if (!Number.isFinite(value)) continue;
    out.push(m[2] ? value * 1e6 : value);
  }
  return out;
}

/** Money however it was written: £51.77, €51,77, "51.77 pounds". */
const pricesIn = (text) =>
  [...String(text).matchAll(MONEY_RE)].map((m) => toNumber(m[1])).filter((n) => Number.isFinite(n));

/** True when a number the answer gave was also on a page the model was shown —
 *  the difference between having read it off the page and having known it. */
export function answerSeen(answer, texts) {
  const wanted = numbersIn(answer);
  if (wanted.length === 0) return false;
  return texts.some((text) => {
    const seen = numbersIn(text);
    return wanted.some((w) => seen.some((s) => Math.abs(s - w) < 0.5));
  });
}

/** The whole todo list, whatever filter the model left the page on. TodoMVC
 *  hides unfinished todos under "Completed", so reading the list as it stands
 *  reads the filter, not the work. Switching back to "All" goes through the
 *  same tool the model used, so it works on either backend. */
const todoState = async (browser) => {
  const shown = await browser.run("browser_snapshot", {});
  const all = /\[(f?\d*e[\da-z]+)\] link "All"/.exec(shown)?.[1];
  if (all) await browser.run("browser_click", { ref: all });
  return await browser.eval(
    () =>
      [...document.querySelectorAll(".todo-list li")].map((li) => ({
        text: li.querySelector("label")?.textContent?.trim() ?? "",
        done: li.classList.contains("completed"),
      })),
  );
};

const VERIFIERS = {
  /** Read the list back off the page: three todos, pane struck out. */
  1: async (browser) => {
    const items = await todoState(browser);
    const wanted = ["latte", "pane", "uova"];
    if (items.length === 0) return fail("no todo was added");
    const missing = wanted.filter((t) => !items.some((i) => i.text === t));
    if (missing.length > 0) {
      return fail(`missing todos: ${missing.join(", ")} — page has ${items.map((i) => i.text || "(blank)").join(", ") || "nothing"}`);
    }
    const pane = items.find((i) => i.text === "pane");
    if (!pane.done) return fail(`pane is there but not completed — page has ${items.map((i) => `${i.text}${i.done ? "✓" : ""}`).join(", ")}`);
    return pass(`3 todos on the page, pane completed (${items.map((i) => `${i.text}${i.done ? "✓" : ""}`).join(", ")})`);
  },

  /** A question, so the answer is what counts. */
  2: async (_page, answer) => {
    const given = pricesIn(answer);
    if (given.some((n) => Math.abs(n - 51.77) < 0.005)) return pass(`answer gives 51.77`);
    return fail(`answer gives no 51.77 (numbers: ${given.join(", ") || "none"})`);
  },

  3: async (_page, answer) => {
    const nineteen = numbersIn(answer).includes(19);
    return nineteen ? pass("answer gives 19") : fail(`answer gives no 19 (numbers: ${numbersIn(answer).join(", ") || "none"})`);
  },

  /** httpbin echoes what it received, so the verdict reads the echoed form. */
  4: async (browser) => {
    const raw = await browser.eval(() => document.querySelector("pre")?.textContent ?? document.body.innerText);
    let form = null;
    try {
      form = JSON.parse(raw).form;
    } catch {
      return fail(`the response page is not the posted json (starts: ${String(raw).slice(0, 80)})`);
    }
    const missing = ["custname", "size", "topping"].filter((k) => !(k in form));
    if (missing.length > 0) return fail(`form came back without: ${missing.join(", ")}`);
    const want = { custname: "marco rossi", size: "medium", topping: "bacon" };
    const wrong = Object.entries(want).filter(([k, v]) => !String(form[k] ?? "").toLowerCase().includes(v));
    if (wrong.length > 0) {
      return fail(`form came back as ${JSON.stringify(form)}, wrong: ${wrong.map(([k]) => k).join(", ")}`);
    }
    return pass(`form came back ${JSON.stringify(form)}`);
  },

  /** Brooklyn is between two and three million however it is written. */
  5: async (_page, answer) => {
    const inRange = numbersIn(answer).filter((n) => n >= 2_000_000 && n <= 3_000_000);
    if (inRange.length > 0) return pass(`population in range: ${inRange.join(", ")}`);
    return fail(`no population between 2,000,000 and 3,000,000 in the answer (numbers: ${numbersIn(answer).join(", ") || "none"})`);
  },
};

export async function verify(taskId, browser, answer) {
  const verifier = VERIFIERS[taskId];
  if (!verifier) return { ok: null, detail: "manual — no code verifier" };
  try {
    return await verifier(browser, String(answer ?? ""));
  } catch (error) {
    return fail(`verifier threw: ${String(error?.message ?? error).split("\n")[0]}`);
  }
}