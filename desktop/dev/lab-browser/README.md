# lab-browser

A lab harness for one question: **can a local model drive a real browser well
enough to be a Kalsa feature?**

It offers a model five browser tools plus `finish`, lets it work a real headless
Chromium against real sites, and checks the result in code — no human in the
loop except task 6, whose answer is recorded for reading.

## Running

```sh
node dev/lab-browser/run.mjs --endpoint http://127.0.0.1:PORT --model NAME \
     [--think false] [--tasks 1,2] [--runs 3]
node dev/lab-browser/run.mjs --fake --tasks 1,2     # no model; proves the harness
node dev/lab-browser/run.mjs --fake --fake-prose --tasks 2   # ends in plain words
```

`--think false` sends `chat_template_kwargs: {enable_thinking: false}`; thinking
is on otherwise. One json line per run goes to stdout, then a summary table and
a "why runs were not ok" list naming every run that did not pass. Exit code is 0
when every judged run passed (task 6 is never judged).

## How a run begins

The harness opens `task.url` **before the first step** and puts that page in the
first user message, so the model is told where it is and is never charged a step
for being there. It does not have to guess the site, and a model that invents
`https://todo.example.com` or wanders to a search engine is not being asked to do
work the harness should have done.

## How a run ends

Words with no tool call are an answer. That is how the app reads it and it is
what small models do when they forget `finish`, so the prose is credited like a
`finish` call and `endedBy` records which way the run stopped. A model that
answers with *nothing at all* — no call, no text — gets exactly one nudge
("Use one of the browser tools, or answer with finish."), which is also what
keeps the conversation well formed: two assistant messages in a row is not a
valid conversation and the server rejects it.

Nothing is installed for this lab. Playwright is imported from
`chat/node_modules/playwright-core`, the copy the chat app already has
(1.63.0, with chromium-1243 already in `~/Library/Caches/ms-playwright`).

## The tools

`browser_navigate`, `browser_snapshot`, `browser_find`, `browser_click`,
`browser_type`, `browser_select`, `finish`. Few on purpose — a small model loses
the thread when the choice list is wide, so there is no scroll, no back, no
evaluate.

## Reading a long page

A snapshot is capped at 6000 chars. Rather than cut the page and lose it, it
arrives in parts, each ending by naming the next one:

```
Part 1 of 3 — call browser_snapshot with page 2 for more.
```

So `browser_snapshot {page: 2}` continues from there, cuts fall on line
boundaries, and refs stay valid across parts — a ref read in part 2 acts on the
same element it names. The last part says so, so a model is never left unsure
whether it has seen everything.

`browser_find {text}` is the other half: it returns the lines that mention some
text, a line either side, their line numbers and their refs, so a model can look
for one thing in a page too long to read. Without it, models type the word they
want into the site's own search box — which searches the web, not the page.

A run that asks for the same call with the same arguments three times running is
recorded with `looped: true`. Nothing about the run changes; the flag is there to
tell a model stuck in a loop from one that was working.

## How refs work

A snapshot is Playwright's own AI aria tree, `page.ariaSnapshot({mode:"ai"})`.
Its `[ref=e12]` tokens are rewritten to a leading `[e12]`, and the tools resolve
them back with `page.locator("aria-ref=e12")`:

```
url: https://demo.playwright.dev/todomvc/#/
title: React • TodoMVC

- [e8] textbox "What needs to be done?"
- [e21] checkbox "Toggle Todo"
  - text "latte"
```

Three things make that text small enough to be worth a small model's context:

- `/url:` property lines are dropped; the header carries the url.
- Containers that say nothing of their own are dropped, **but text is kept** —
  a checkbox with no name is only knowable from the label beside it, so dropping
  the wrapper must not drop the label with it.
- Snapshots are capped at 6000 chars and come in parts, so a long page is read
  rather than truncated. There is no scroll tool; `browser_snapshot {page}` and
  `browser_find` are how the rest of a page is reached.

Refs are valid only until the page changes, which is why every tool answers with
a fresh snapshot. A stale ref comes back as a sentence the model can act on
("there is no element with ref e12 on this page — snapshot again"), not a stack
trace. Refs on a page with an iframe print as `f1e12`; both spellings are taken.

## The tasks

A question is judged on **the answer**; a task that changes something is judged
on **the page**. A model may know the price without having opened the book, and
that is a finding about the model. But an answer about a todo list could be a
guess, so there the list is read back off the page.

| # | task | judged on |
|---|---|---|
| 1 | todomvc — add latte/pane/uova, complete pane | the list on the page, whatever filter is showing |
| 2 | books-price — price of "A Light in the Attic" (£51.77) | the answer, with £/€/$ and , or . normalised |
| 3 | books-count — books in Poetry (19) | the answer |
| 4 | form — Marco Rossi / medium / bacon, submitted | the echoed json in httpbin's response |
| 5 | wiki — Brooklyn population | a number between 2,000,000 and 3,000,000 in the answer |
| 6 | events — 3 things in Brooklyn, 17–18 Oct 2026 | nothing; the answer is recorded for you |

Every number is read the way an Italian page writes it: grouped with a dot, a
comma, a plain space, NBSP, narrow NBSP or thin space, so "2 736 074",
"2.736.074" and "2,736,074" are one number. A separator only groups when three
digits follow it, which leaves "2,5 milioni" as a decimal.

## Reading or knowing

Each run records `answerSeen`: true when a number the answer gave was also on a
page the browser handed the model — the opening page included. It separates
having looked it up from having already known it, which a pass/fail cannot show.
Task 2 answered in one step with no page open, so it passes from memory; task 5
searches and reads, so it passes from the page.

`lastUrl` follows every tool, including a search box submitted with Enter, which
a click-based url used to miss and leave naming the page the model came from.

Task 1 reads the list after switching the filter back to "All", because
TodoMVC hides unfinished todos under "Completed" — reading the list as it stands
reads the filter, not the work. Every failure says what was actually on the
page, which is usually the whole diagnosis.

Task prompts are Italian for 2–6, since the product is; the system prompt is
short English. Caps are 15 steps and 180 s per task.

Two things the battery taught us about the sites, not about the models:

- **books.toscrape.com has no search box** — zero inputs in the DOM. Task 2 is
  reached by walking Books → Poetry → the book, not by typing a query.
- **httpbin's "size" is a radio group, not a dropdown**, so task 4 needs
  `browser_click`, and `browser_select` ends up unused by the battery.

## Proving the harness is not the thing that fails

`--fake` runs a scripted model that plays the correct sequence for tasks 1 and 2.
It reads refs out of the snapshot text it is handed exactly as a real model must,
so a green fake run means navigate, snapshot, ref lookup, click, type, submit and
verify all work end to end.

```sh
node dev/lab-browser/run.mjs --fake --tasks 1,2,5,6 > /tmp/lb.log 2>&1; echo $?
```

Task 6 is the long-page one: the fake walks bkmag in three parts, uses
`browser_find`, and finishes in five steps. `--fake-prose` replays task 2 ending
in plain words instead of a `finish` call, which covers the prose path and the
price normalisation together.

## Files

| file | one responsibility |
|---|---|
| `run.mjs` | flags, the runs, the json lines, the summary table |
| `agent.mjs` | the step/wall-clock loop and the record of one run |
| `engine.mjs` | one chat round trip to the llama-server, and reading the calls back |
| `browser.mjs` | run one tool against the live page |
| `snapshot.mjs` | the page as short ref-addressable text |
| `tools.mjs` | the six tool schemas |
| `tasks.mjs` | the six tasks and the system prompt |
| `verifiers.mjs` | pass or fail, from the page and the answer |
| `fake.mjs` | the scripted model for tasks 1 and 2 |