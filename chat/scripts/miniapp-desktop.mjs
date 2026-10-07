// The desktop half of create_miniapp: which tools the web switch offers, that
// the local build is not gated, that a stored miniapp survives the store or is
// dropped, and that the wire never carries one. Pure: a stub door, a memory
// localStorage, no server.
//
// Run: node scripts/miniapp-desktop.mjs   (from chat/)

import { rm } from "node:fs/promises";

/** Written before the bundle is imported: store.ts subscribes to `storage` at
    module load, and the tool registry reads `window.__TAURI__` at call time. */
class MemoryStorage {
  #map = new Map();
  get length() {
    return this.#map.size;
  }
  key(index) {
    return [...this.#map.keys()][index] ?? null;
  }
  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }
  setItem(key, value) {
    this.#map.set(String(key), String(value));
  }
  removeItem(key) {
    this.#map.delete(key);
  }
  clear() {
    this.#map.clear();
  }
}
globalThis.localStorage = new MemoryStorage();
globalThis.window = {
  __TAURI__: { core: { invoke: async () => null } },
  addEventListener: () => {},
  setTimeout,
  clearTimeout,
};

const { loadApp } = await import("./lib/app-bundle.mjs");

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
function equal(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}

const VALID = {
  schema: "miniapp_v1",
  kind: "kpi_strip",
  title: "KPIs",
  blocks: [{ type: "metric_strip", metrics: [{ label: "Revenue", value: 12000 }] }],
};

const CONV = (miniapp) => ({
  id: "c1",
  title: "T",
  createdAt: 1,
  updatedAt: 2,
  messages: [
    { id: "m1", role: "user", content: "show me the KPIs", createdAt: 1 },
    {
      id: "m2",
      role: "assistant",
      content: "Here.",
      createdAt: 2,
      toolRuns: [
        {
          id: "0-call-0",
          name: "create_miniapp",
          arguments: '{"template":"kpi_strip"}',
          result: "Miniapp created: KPIs",
          state: "ok",
          ...(miniapp === undefined ? {} : { miniapp }),
        },
      ],
    },
  ],
});

const { app, dir } = await loadApp();
try {
  const { offeredTools, executeToolCall, runCreateMiniapp, createStore, buildPinnedContext } = app;

  // ── the web switch, and nothing else, gates the web tools ─────────────────
  {
    const on = offeredTools(true).map((tool) => tool.function.name);
    const off = offeredTools(false).map((tool) => tool.function.name);
    equal("switch on offers all three, local first", on, ["create_miniapp", "web_search", "web_fetch"]);
    equal("switch off offers only the local tool", off, ["create_miniapp"]);
    const door = globalThis.window.__TAURI__;
    globalThis.window.__TAURI__ = undefined;
    equal("a page with no desktop offers nothing", offeredTools(true).map((t) => t.function.name), []);
    globalThis.window.__TAURI__ = door;
  }

  // ── the gate does not apply to a local build ──────────────────────────────
  {
    let asked = 0;
    const gate = {
      documents: () => [{ id: "d1", name: "bank.txt", kind: "txt", chars: 4, tokens: 1, text: "IBAN", attachedAt: 1, active: true }],
      confirm: async () => {
        asked++;
        return false;
      },
    };

    const built = await executeToolCall(
      "create_miniapp",
      { template: "compare_data", slots: { columns: ["Plan"], rows: [{ Plan: "Free" }] } },
      undefined,
      gate,
    );
    check("create_miniapp runs with a gate armed", built.ok === true && built.miniapp?.kind === "compare_data");
    equal("create_miniapp never asks the gate", asked, 0);

    const held = await executeToolCall("web_fetch", { url: "https://example.com/x" }, undefined, gate);
    check("web_fetch is still held by the gate", held.ok === false && held.text.startsWith("Not run:"));
    equal("web_fetch did ask the gate", asked, 1);
  }

  // ── the built envelope rides the transcript, not the wire ─────────────────
  {
    const ctx = buildPinnedContext([CONV(VALID).messages[1]], [], null);
    check("the pinned context is ok", ctx.status === "ok");
    const wire = ctx.status === "ok" ? ctx.wire : [];
    const wireText = JSON.stringify(wire);
    check("no wire message carries a miniapp field", wire.every((m) => !("miniapp" in m)));
    check("the wire never names the miniapp envelope", !wireText.includes("miniapp_v1"));
    check("the wire carries no block payload", !wireText.includes("metric_strip"));
    const toolMessage = wire.find((m) => m.role === "tool");
    equal("the tool message is the result text", toolMessage?.content, "Miniapp created: KPIs");
    const call = wire.find((m) => m.role === "assistant" && Array.isArray(m.tool_calls));
    equal("the assistant call survives as it was sent", call?.tool_calls?.[0]?.function?.arguments, '{"template":"kpi_strip"}');
  }

  // ── the store keeps a good miniapp, drops a broken one ────────────────────
  {
    const store = createStore();
    store.put(CONV(VALID));
    const loaded = store.get("c1");
    equal("a good miniapp survives a store round trip", loaded?.messages[1].toolRuns?.[0]?.miniapp, VALID);

    const key = [...Array(localStorage.length).keys()]
      .map((i) => localStorage.key(i))
      .find((k) => k?.startsWith("crescent-chat.msgs."));
    check("the payload key exists on disk", typeof key === "string");

    // The run on disk, as a bad blob: the run stays, the miniapp is dropped.
    const broken = CONV({ schema: "miniapp_v1", kind: "kpi_strip", title: "KPIs", blocks: "not a list" });
    localStorage.setItem(key, JSON.stringify(broken.messages));
    const reread = createStore().get("c1");
    check("a broken stored miniapp is dropped, not thrown on", reread?.messages[1].toolRuns?.length === 1 && reread.messages[1].toolRuns[0].miniapp === undefined);
    equal("the run's own text survives the drop", reread?.messages[1].toolRuns?.[0]?.result, "Miniapp created: KPIs");

    // A stored miniapp the renderer could not draw safely is normalized on load.
    const wild = CONV({
      schema: "miniapp_v1",
      kind: "reading_quiz",
      title: "T",
      blocks: [{ type: "quiz", question: "q".repeat(600), options: ["A", "B"], answerIndex: 9 }],
    });
    localStorage.setItem(key, JSON.stringify(wild.messages));
    const cleaned = createStore().get("c1")?.messages[1].toolRuns?.[0]?.miniapp;
    check("a stored miniapp is re-normalized on load", cleaned?.blocks[0].question.length === 500 && cleaned?.blocks[0].answerIndex === null);
    check("a miniapp that cannot be read at all never crashes the thread", runCreateMiniapp({ template: "bogus" }).ok === false);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
console.log(failures === 0 ? "ALL MINIAPP DESKTOP CHECKS PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
