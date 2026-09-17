// Tiny OpenAI-compatible mock endpoint for screenshots and manual testing.
// Routes:
//   POST /ok/v1/chat/completions      -> SSE stream, scenario chosen by `model`
//   POST /denied/v1/chat/completions  -> 401
// Scenarios (model contains): "code" = code-heavy, "heavy" = markdown
// showcase, "slow" = long answer with per-token delay (streaming shots).
// Anything else = short reply.
import http from "node:http";

const CODE_MD = [
  "Here are the three snippets you asked for.",
  "",
  "```python",
  "def greet(name: str) -> str:",
  "    return f\"Hello, {name}!\"",
  "```",
  "",
  "One-liner for the shell:",
  "",
  "```bash",
  "ls -la | head -20",
  "```",
  "",
  "And the long one — a small retry helper with backoff:",
  "",
  "```typescript",
  "export async function retry<T>(",
  "  fn: () => Promise<T>,",
  "  attempts = 5,",
  "  baseMs = 200,",
  "): Promise<T> {",
  "  let last: unknown;",
  "  for (let i = 0; i < attempts; i++) {",
  "    try {",
  "      return await fn();",
  "    } catch (error) {",
  "      last = error;",
  "      const wait = baseMs * 2 ** i + Math.random() * 100;",
  "      await new Promise((resolve) => setTimeout(resolve, wait));",
  "    }",
  "  }",
  "  throw last;",
  "}",
  "```",
  "",
  "And a minified one-liner — this block must scroll sideways, never wrap:",
  "",
  "```javascript",
  "const bundle=\"" + "import_crypto_".repeat(28) + "from_cdn_then_tree_shaken_and_minified_until_nothing_readable_remains_whatsoever();\"",
  "```",
  "",
  "That last block scrolls horizontally instead of wrapping — try resizing the window.",
].join("\n");

const HEAVY_MD = [
  "# A short field guide",
  "",
  "Some **bold** claims, some *quiet* asides, and a [link to nowhere](https://example.com).",
  "",
  "## Lists, nested",
  "",
  "- First item",
  "  - Nested one",
  "  - Nested two",
  "    1. Deeply numbered",
  "    2. Still going",
  "- Second item",
  "",
  "## A table",
  "",
  "| Feature | Chat A | Chat B |",
  "| --- | --- | --- |",
  "| Line length | 72 chars | full width |",
  "| Code header | yes | no |",
  "| Stop button | yes | sometimes |",
  "",
  "> A quiet quotation, set apart with a rule instead of a bubble.",
  ">",
  "> — *someone, somewhere*",
  "",
  "Done. That was headings, lists, a table, a quote, and inline `code` in one answer.",
].join("\n");

const LONG_MD = [
  "Working through this step by step, because the details matter more than the headline.",
  "",
  "First, the shape of a good answer: it opens with the shortest true sentence, then earns",
  "the right to be longer. Each paragraph below adds one idea and nothing else, so the",
  "reader can stop anywhere and still leave with something whole.",
  "",
  "Second, pacing. A long response arriving token by token is a small performance: the",
  "first words should arrive quickly to prove the line is alive, then the text can settle",
  "into its rhythm. If you scrolled up while this was arriving, the view stayed where you",
  "left it — that is the scroll anchor doing its job, and the pill below offers the way back.",
  "",
  "Third, density. Turns are separated by air, not by boxes. Your words sit in a quiet",
  "bubble on the right; mine sit on the page itself, at a measure of seventy-odd characters,",
  "so the eye never has to run a marathon across a wide window.",
  "",
  "Fourth, the ending. Nothing here needed a summary, so there is none — the text simply",
  "stops when it has said what it came to say, like this.",
].join("\n");

function scenarioFor(model) {
  if (model.includes("code")) return { text: CODE_MD, delay: 12 };
  if (model.includes("heavy")) return { text: HEAVY_MD, delay: 8 };
  if (model.includes("slow")) return { text: LONG_MD, delay: 45 };
  return { text: "Hello! The line is open and streaming works.", delay: 10 };
}

function chunk(text) {
  // Token-ish slices so the UI visibly streams.
  const parts = [];
  for (let i = 0; i < text.length; i += 7) parts.push(text.slice(i, i + 7));
  return parts;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(404, CORS).end();
    return;
  }
  if (req.url === "/denied/v1/chat/completions") {
    req.resume();
    res.writeHead(401, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ error: { message: "Invalid API key", type: "invalid_request_error" } }));
    return;
  }
  if (req.url === "/ok/v1/chat/completions") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let model = "";
      try {
        model = JSON.parse(body).model ?? "";
      } catch { /* default scenario */ }
      const { text, delay } = scenarioFor(String(model));
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...CORS,
      });
      const parts = chunk(text);
      let i = 0;
      let finished = false;
      const timer = setInterval(() => {
        if (finished) {
          clearInterval(timer);
          return;
        }
        if (i < parts.length) {
          const payload = JSON.stringify({ choices: [{ delta: { content: parts[i] } }] });
          res.write(`data: ${payload}\n\n`);
          i++;
        } else {
          finished = true;
          clearInterval(timer);
          res.write("data: [DONE]\n\n");
          res.end();
        }
      }, delay);
      // Client went away mid-stream: stop ticking. (res 'close' also fires
      // after a normal res.end(); clearing a finished timer is harmless.)
      res.on("close", () => {
        finished = true;
        clearInterval(timer);
      });
    });
    return;
  }
  req.resume();
  res.writeHead(404, CORS).end();
});

const PORT = 18081;
server.listen(PORT, () => console.log(`mock endpoint on http://127.0.0.1:${PORT}`));
