# kalsa-browser

The browser already installed on the computer, driven through its accessibility
tree, as an MCP server over stdio. The plan is
`docs/PLAN-BROWSER-2026-10-17.md`; this crate is step 1 of it.

## The driver

We do not download the Playwright driver, at build time or at run time. The
release pipeline assembles it from pinned sources, verifies the archive by
SHA256, and serves it from our own location.

A **build** must therefore carry the skip flag, and a **run** must be told where
the verified driver is:

```sh
# build
PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD=1 cargo build -p kalsa-browser

# run, with a driver that is already on this machine
PLAYWRIGHT_DRIVER_PATH=/path/to/driver cargo run -p kalsa-browser
```

`PLAYWRIGHT_DRIVER_PATH` is a directory holding `node` (`node.exe` on Windows)
and `package/cli.js`. That is the whole contract with `playwright-rs`.

On every start the process clears every other `PLAYWRIGHT_*` variable from its
own environment (`src/driver_env.rs`) — `PLAYWRIGHT_NODE_EXE` and
`PLAYWRIGHT_CLI_JS` each replace the runtime or the CLI script outright, and
`PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD` is a build-time knob that has no meaning here.
`PLAYWRIGHT_DRIVER_PATH` is the only one that survives.

## Tests

`cargo test -p kalsa-browser` runs the browser tests, which launch the installed
browser headed and need a driver:

```sh
PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD=1 PLAYWRIGHT_DRIVER_PATH=/path/to/driver \
  cargo test -p kalsa-browser
```

They never download a browser: the context is launched with an `executablePath`
pointing at the installed Chrome, Edge or Brave (`src/find_browser.rs`), and
`~/Library/Caches/ms-playwright` is not touched. They do bind a loopback HTTP
server of their own, which the product guard refuses and which the tests
therefore override through Playwright's own routing when they need an origin.

## What step 1 does not do

Click and type are refused on a page whose request is not a GET, because the
held request and its confirm card arrive in step 4 (`src/hold.rs`).
## Known limits

These are the things this crate does not stop. They are here so nobody reads the
code and believes otherwise.

- **A GET is not free of effect.** The route refuses what would write to a site,
  but a GET can log someone in, count a click, or start a payment at the far end.
  Opening is a thing a person does on purpose.
- **A redirect is not intercepted.** In this stack a redirect followed within a
  navigation is never offered to a route handler: the first hop is judged and the
  second is not, and the browser follows it. `guard::refused_landing` refuses to
  read a page we ended up on, so the model is never shown what a redirected page
  says — but the request was made. Closing this needs something in front of the
  browser.
- **Network-specific NAT64 prefixes.** `64:ff9b::/96` and the local-use
  `64:ff9b:1::/48` are read and refused. A network that translates through a
  prefix of its own choosing is a network nothing here can recognise.
- **DNS rebinding.** A name is resolved here and Chrome resolves it again for
  itself, so a name that answered us with a public address can answer Chrome with
  a private one. The flag that would fix it — `--host-resolver-rules` — is one
  static rule string applied to every lookup, so it cannot ask a per-request
  question. This wants a local proxy on the computer, which is not built.
- **DOM mutation between a read and an action.** A page can change between the
  moment the model read an element and the moment it acts on it. The destination
  checks are done in the same task as the action, which closes the one window
  that mattered, but the element itself is still whatever the page has made it.
- **Secrets in plain-text fields.** A password field is refused by type and by
  `autocomplete`, and a field that turns into one when focused is caught by
  reading the type after the focus. A secret typed into a plain text field is a
  secret in a plain text field, and nothing here notices.
- **Prompt injection, until step 3.** Page text is returned to the model fenced
  and with the run recoverable, or it is not, and until it is a page can say
  anything it likes in the voice of a person.
