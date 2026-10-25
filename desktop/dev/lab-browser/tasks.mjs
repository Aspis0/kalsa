// The battery (one responsibility: the six tasks, what the model is asked, and
// how each one is checked by code). The user text is Italian for tasks 2-6
// because the product is Italian; task 1 stays English so the two languages
// share one battery. Task 6 has no verifier — that answer is for a human.
export const SYSTEM_PROMPT =
  "You drive a real web browser through five tools. " +
  "Always browser_snapshot before you click or type, and use only the refs it prints. " +
  "A snapshot shows the top of the page; snapshot again after every action if you still need it. " +
  "When you know the answer, call finish with it.";

export const TASKS = [
  {
    id: 1,
    name: "todomvc",
    url: "https://demo.playwright.dev/todomvc",
    prompt:
      'Add the todos "latte", "pane" and "uova", then mark "pane" as completed. ' +
      "When you are done, say which todos are done.",
  },
  {
    id: 2,
    name: "books-price",
    url: "https://books.toscrape.com",
    prompt: "Qual è il prezzo del libro \"A Light in the Attic\"? Rispondi solo con il prezzo.",
  },
  {
    id: 3,
    name: "books-count",
    url: "https://books.toscrape.com",
    prompt: "Quanti libri ci sono nella categoria Poetry? Rispondi solo con il numero.",
  },
  {
    id: 4,
    name: "form",
    url: "https://httpbin.org/forms/post",
    prompt:
      'Compila il modulo con nome cliente "Marco Rossi", taglia medium e topping bacon, ' +
      "poi invia. Scrivi alla fine cosa è comparso nella risposta.",
  },
  {
    id: 5,
    name: "wiki",
    url: "https://it.wikipedia.org",
    prompt:
      'Cerca "Brooklyn" e scrivi la popolazione di Brooklyn come è riportata nella pagina. ' +
      "Rispondi solo con il numero.",
  },
  {
    id: 6,
    name: "events",
    url: "https://www.bkmag.com",
    prompt: "Trova 3 cose da fare a Brooklyn questo weekend (17-18 ottobre 2026).",
    manual: true,
  },
];

/** The battery asked for by `--tasks 1,2` or by default, all six. */
export function tasksFor(spec) {
  if (!spec || spec === "all") return TASKS;
  const wanted = spec.split(",").map((s) => Number(s.trim()));
  const unknown = wanted.filter((id) => !TASKS.some((t) => t.id === id));
  if (unknown.length > 0) throw new Error(`no such task: ${unknown.join(",")}`);
  return TASKS.filter((t) => wanted.includes(t.id));
}