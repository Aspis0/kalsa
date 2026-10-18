// A scripted stand-in for the model (one responsibility: play the right tool
// sequence for tasks 1 and 2, so a failure can be blamed on the model and not
// on the harness). It reads refs out of the snapshot text it is handed, exactly
// as a real model must, and returns a turn shaped like an engine turn — so the
// loop in agent.mjs runs unmodified.
//
// The harness opens the task's page and puts that page in the first user
// message, so the fake reads its opening snapshot from there, not from a
// navigate it no longer needs to make.
// Refs are `e12` on a plain page and `f1e12` once the page has a frame, so a
// lookup has to take both spellings.
const REF = "\\[(f?\\d*e[0-9a-z]+)\\]";
const refOn = (page, pattern) => page.match(new RegExp(`${REF} ${pattern}`))?.[1] ?? null;

/** The ref of the checkbox sitting immediately above `text "pane"` — how a todo
 *  is told apart when every toggle carries the same name. */
const toggleBefore = (page, text) => {
  const lines = page.split("\n");
  const at = lines.findIndex((l) => l.includes(`text "${text}"`));
  if (at < 0) return null;
  for (let i = at - 1; i >= 0; i -= 1) {
    const found = lines[i].match(new RegExp(`${REF} checkbox`));
    if (found) return found[1];
  }
  return null;
};

/** The ref of the first link below the `img "title"` line. The grid truncates
 *  the link's own name, so the image is what carries the whole title. */
const linkUnder = (page, title) => {
  const lines = page.split("\n");
  const at = lines.findIndex((l) => l.includes(`img "${title}"`));
  if (at < 0) return null;
  return lines.slice(at).find((l) => new RegExp(`^\\s*- ${REF} link`).test(l))?.match(new RegExp(REF))?.[1] ?? null;
};

const TODOS = ["latte", "pane", "uova"];
const BOOK = "A Light in the Attic";

/** The next call for a task, given the page as it stands. Task 2 has two
 *  endings: `finish` as a tool call, and — under --fake-prose — the same answer
 *  as plain words, which is how a small model often ends a run. */
const script = {
  1(state, page) {
    if (state.added.length < TODOS.length) {
      const todo = TODOS[state.added.length];
      state.added.push(todo);
      return { name: "browser_type", args: { ref: refOn(page, 'textbox "What needs to be done\\?"'), text: todo, submit: true } };
    }
    if (!state.toggled) {
      state.toggled = true;
      return { name: "browser_click", args: { ref: toggleBefore(page, "pane") } };
    }
    return { name: "finish", args: { answer: "Ho aggiunto latte, pane e uova; pane è segnato come completato." } };
  },

  2(state, page, prose) {
    if (!state.onPoetry) {
      state.onPoetry = true;
      return { name: "browser_click", args: { ref: refOn(page, 'link "Poetry"') } };
    }
    if (!state.onBook) {
      state.onBook = true;
      return { name: "browser_click", args: { ref: linkUnder(page, BOOK) } };
    }
    // The price is read off the page, and written with a comma, as an Italian
    // model would: the answer has to survive being normalised to pass.
    const price = page.match(/£\d+\.\d{2}/)?.[0] ?? "£51.77";
    const answer = `Il prezzo di "${BOOK}" è ${price.replace(".", ",")}.`;
    return prose ? { prose: answer } : { name: "finish", args: { answer } };
  },

  /** Search, then read the population off the article and write it back the way
   *  an Italian model does — grouped with spaces, not dots. */
  5(state, page, prose) {
    if (!state.searched) {
      state.searched = true;
      return { name: "browser_type", args: { ref: refOn(page, 'searchbox "Cerca in Wikipedia"'), text: "Brooklyn", submit: true } };
    }
    const found = page.match(/\d{1,3}(?:[.    ]\d{3}){1,2}/)?.[0] ?? "2.736.074";
    const digits = found.replace(/[.   ]/g, "").replace(/\s+/g, "");
    const answer = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return prose ? { prose: answer } : { name: "finish", args: { answer } };
  },

  /** Walk to Poetry and read the count the page already prints. */
  3(state, page) {
    if (!state.onPoetry) {
      state.onPoetry = true;
      return { name: "browser_click", args: { ref: refOn(page, 'link "Poetry"') } };
    }
    const count = page.match(/strong "(\d+)"/)?.[1] ?? "19";
    return { name: "finish", args: { answer: `${count}` } };
  },

  /** The form: a textbox, two radios-by-click and a checkbox, then submit.
   *  httpbin's "size" is a radio group, so this is clicks and not select. */
  4(state, page) {
    if (!state.named) {
      state.named = true;
      return { name: "browser_type", args: { ref: refOn(page, 'textbox "Customer name:"'), text: "Marco Rossi" } };
    }
    if (!state.sized) {
      state.sized = true;
      return { name: "browser_click", args: { ref: refOn(page, 'radio "Medium"') } };
    }
    if (!state.topped) {
      state.topped = true;
      return { name: "browser_click", args: { ref: refOn(page, 'checkbox "Bacon"') } };
    }
    if (!state.sent) {
      state.sent = true;
      return { name: "browser_click", args: { ref: refOn(page, 'button "Submit order"') } };
    }
    return { name: "finish", args: { answer: "Ho inviato il modulo: Marco Rossi, medium, bacon." } };
  },

  /** A page too long for one snapshot: read to the end part by part, then look
   *  for the thing that was wanted rather than typing it into a search box. */
  6(state, page) {
    if (!state.snapshotted) {
      state.snapshotted = true;
      return { name: "browser_snapshot", args: {} };
    }
    const at = page.match(/Part (\d+) of (\d+)/);
    if (at && Number(at[1]) < Number(at[2])) {
      state.parts = Number(at[2]);
      return { name: "browser_snapshot", args: { page: Number(at[1]) + 1 } };
    }
    if (!state.found) {
      state.found = true;
      return { name: "browser_find", args: { text: "weekend" } };
    }
    return { name: "finish", args: { answer: `Lette ${state.parts ?? 1} parti della pagina, poi cercato "weekend".` } };
  },
};

/** The task ids the fake can play, so run.mjs can say so before starting. */
export const fakeTasks = () => Object.keys(script).map(Number);

/** A turn that carries words and no tool call — what the loop treats as an
 *  answer, and what a real model writes when it forgets the finish tool. */
const proseTurn = (text) => ({
  status: 200,
  wallMs: 1,
  error: null,
  body: {
    choices: [{ message: { role: "assistant", content: text, tool_calls: [] } }],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  },
});

const toolTurn = (id, call) => ({
  status: 200,
  wallMs: 1,
  error: null,
  body: {
    choices: [
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{ id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) } }],
        },
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  },
});

/** The `askOnce` the loop calls. One closure per run, so the script can remember
 *  what it has already done between turns. */
export function fakeModel(task, { prose = false } = {}) {
  const play = script[task.id];
  if (!play) throw new Error(`the fake model has no script for task ${task.id}`);
  const state = { added: [], toggled: false, onPoetry: false, onBook: false, searched: false, snapshotted: false, found: false, parts: 0, named: false, sized: false, topped: false, sent: false };
  let turns = 0;

  return async ({ messages }) => {
    turns += 1;
    // The newest page is the last tool result, or the opening snapshot the
    // harness put in the first user message.
    const last = [...messages].reverse().find((m) => m.role === "tool") ?? messages.find((m) => m.role === "user");
    const call = play(state, last ? last.content : "", prose);
    return call.prose ? proseTurn(call.prose) : toolTurn(`fake_${turns}`, call);
  };
}
