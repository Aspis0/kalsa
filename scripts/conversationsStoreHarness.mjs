/**
 * Harness for ConversationsStore + sessionMeta conversationId match.
 * Compile-from-disk (documentLibraryHarness / sessionMetaHarness pattern).
 * Exit 1 on fail.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/conversationsStoreHarness");

function writeStubs() {
  const nm = path.join(outDir, "node_modules");

  const efsDir = path.join(nm, "expo-file-system");
  mkdirSync(efsDir, { recursive: true });
  writeFileSync(
    path.join(efsDir, "package.json"),
    JSON.stringify({
      name: "expo-file-system",
      type: "module",
      exports: { "./legacy": "./legacy.js" },
    }),
  );
  writeFileSync(
    path.join(efsDir, "legacy.js"),
    `
export const documentDirectory = "file:///tmp/kalsa-harness/";
export async function getFreeDiskStorageAsync() { return Number.MAX_SAFE_INTEGER; }
export async function makeDirectoryAsync() {}
export async function getInfoAsync() { return { exists: false, isDirectory: false }; }
export async function deleteAsync() {}
export async function readDirectoryAsync() { return []; }
`,
  );

  const asDir = path.join(nm, "@react-native-async-storage", "async-storage");
  mkdirSync(asDir, { recursive: true });
  writeFileSync(
    path.join(asDir, "package.json"),
    JSON.stringify({
      name: "@react-native-async-storage/async-storage",
      type: "module",
      main: "index.js",
    }),
  );
  writeFileSync(
    path.join(asDir, "index.js"),
    `
const store = new Map();
export default {
  async getItem(k) { return store.has(k) ? store.get(k) : null; },
  async setItem(k, v) { store.set(k, v); },
  async removeItem(k) { store.delete(k); },
  async getAllKeys() { return [...store.keys()]; },
  async multiRemove(keys) { for (const k of keys) store.delete(k); },
};
export const __store = store;
`,
  );
}

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeStubs();
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/conversations/ConversationsStore.ts",
      "src/util/filterByTokens.ts",
      "src/engine/sessionPersistence.ts",
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
      "--esModuleInterop",
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

function resolveBuilt(relParts) {
  const candidates = [
    path.join(outDir, ...relParts),
    path.join(outDir, "src", ...relParts),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find ${relParts.join("/")}. Tried:\n`, candidates.join("\n"));
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS ${name}`);
    pass += 1;
  } else {
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    fail += 1;
  }
}

function memStorage() {
  const mem = new Map();
  return {
    mem,
    async getItem(k) {
      return mem.has(k) ? mem.get(k) : null;
    },
    async setItem(k, v) {
      mem.set(k, v);
    },
    async removeItem(k) {
      mem.delete(k);
    },
  };
}

function sampleMeta(overrides = {}) {
  return {
    id: "conv-1",
    title: "Hello world",
    updatedAt: 1_700_000_000_000,
    preview: "last line",
    searchBlob: "hello world last line",
    ...overrides,
  };
}

async function main() {
  console.log("Compiling ConversationsStore + sessionPersistence …");
  compile();

  const storePath = pathToFileURL(resolveBuilt(["conversations", "ConversationsStore.js"])).href;
  const sessPath = pathToFileURL(resolveBuilt(["engine", "sessionPersistence.js"])).href;
  const store = await import(storePath);
  const sess = await import(sessPath);

  const {
    messagesKey,
    sanitizeConversationId,
    nextConversationId,
    titleFromFirstUserText,
    previewFromMessages,
    searchBlobFromMessages,
    filterConversations,
    upsertMeta,
    setActive,
    removeConversation,
    emptyConversationsState,
    parseConversationsState,
    serializeConversationsState,
    migrateLegacyIfNeeded,
    loadConversationsState,
    conversationHasPersistedMessages,
    createEmptyConversationMeta,
    persistedMessagesAreNonEmpty,
    INDEX_KEY,
    LEGACY_MESSAGES_KEY,
    MIGRATED_KEY,
    SEARCH_BLOB_CAP,
  } = store;

  const { sessionMetaMatches, sessionMetaMismatchField, historyHash, setBootMessagesKey, resetBootHistoryHash, getBootHistoryHash } =
    sess;

  // ── messagesKey sanitizes ───────────────────────────────────────────────
  check(
    "messagesKey keeps safe id",
    messagesKey("conv-abc.1") === "kalsa.messages.conv-abc.1",
  );
  check(
    "messagesKey replaces illegal chars",
    messagesKey("foo/bar") === "kalsa.messages.foo_bar",
    messagesKey("foo/bar"),
  );
  let threwEmpty = false;
  try {
    sanitizeConversationId("");
  } catch {
    threwEmpty = true;
  }
  check("sanitizeConversationId empty throws", threwEmpty);
  let threwBlank = false;
  try {
    messagesKey("@@@");
    threwBlank = false;
  } catch {
    threwBlank = true;
  }
  // @@@ → ___ which is non-empty; covers-style replace must not throw.
  check("messagesKey @@@ → underscores (non-empty)", messagesKey("@@@") === "kalsa.messages.___" && !threwBlank);

  const nid = nextConversationId();
  check(
    "nextConversationId shape",
    /^conv-\d+-[a-z0-9]+$/.test(nid),
    nid,
  );
  check("nextConversationId unique", nextConversationId() !== nextConversationId());

  // ── title / preview / blob ──────────────────────────────────────────────
  check(
    "titleFromFirstUserText first line + trim + cap",
    titleFromFirstUserText("  Hello there\nsecond") === "Hello there",
  );
  check(
    "titleFromFirstUserText empty",
    titleFromFirstUserText("   \n") === "" && titleFromFirstUserText("") === "",
  );
  const longTitle = "x".repeat(80);
  check(
    "titleFromFirstUserText max 48",
    titleFromFirstUserText(longTitle).length === 48,
  );
  check(
    "previewFromMessages last non-empty",
    previewFromMessages([
      { text: "first" },
      { text: "   " },
      { text: "last bit" },
    ]) === "last bit",
  );
  check(
    "previewFromMessages empty",
    previewFromMessages([]) === "" && previewFromMessages(null) === "",
  );
  const longPrev = "w".repeat(120);
  check(
    "previewFromMessages max 80",
    previewFromMessages([{ text: longPrev }]).length === 80,
  );
  const blob = searchBlobFromMessages([
    { role: "user", text: "Hello WORLD" },
    { role: "assistant", text: "  Reply  " },
  ]);
  check(
    "searchBlobFromMessages lowercase join",
    blob === "hello world\nreply",
    blob,
  );
  const huge = searchBlobFromMessages([{ text: "α".repeat(SEARCH_BLOB_CAP + 50) }]);
  check(
    "searchBlobFromMessages capped",
    Array.from(huge).length === SEARCH_BLOB_CAP,
    `len=${Array.from(huge).length}`,
  );

  // ── filter AND + recency ────────────────────────────────────────────────
  const older = sampleMeta({
    id: "old",
    title: "Alpha topic",
    searchBlob: "alpha body uniqueold",
    updatedAt: 100,
  });
  const newer = sampleMeta({
    id: "new",
    title: "Beta notes",
    searchBlob: "beta body uniqueold sharedtok",
    updatedAt: 200,
  });
  const newest = sampleMeta({
    id: "newest",
    title: "Gamma",
    searchBlob: "gamma only",
    updatedAt: 300,
  });
  const mixed = [older, newest, newer];

  const emptyQ = filterConversations(mixed, "");
  check(
    "empty query returns all recency-sorted",
    emptyQ.length === 3 && emptyQ[0].id === "newest" && emptyQ[1].id === "new" && emptyQ[2].id === "old",
    emptyQ.map((x) => x.id).join(","),
  );
  check(
    "whitespace query returns all",
    filterConversations(mixed, "   ").map((x) => x.id).join(",") === "newest,new,old",
  );
  check(
    "short tokens do not show all",
    filterConversations(mixed, "ab xy").length === 0,
  );
  check(
    "short query includes title",
    filterConversations(mixed, "be").length === 1 &&
      filterConversations(mixed, "be")[0].id === "new",
  );

  const andHits = filterConversations(mixed, "uniqueold sharedtok");
  check(
    "filter AND requires every token",
    andHits.length === 1 && andHits[0].id === "new",
    andHits.map((x) => x.id).join(","),
  );
  const titleHit = filterConversations(mixed, "alpha");
  check(
    "filter matches title",
    titleHit.length === 1 && titleHit[0].id === "old",
  );
  const recencyKept = filterConversations(
    [
      sampleMeta({ id: "a", title: "zeta", searchBlob: "sharedword", updatedAt: 1 }),
      sampleMeta({ id: "b", title: "zeta", searchBlob: "sharedword", updatedAt: 9 }),
    ],
    "sharedword",
  );
  check(
    "filter keeps recency order",
    recencyKept.length === 2 && recencyKept[0].id === "b" && recencyKept[1].id === "a",
  );

  // ── upsert / setActive / remove ─────────────────────────────────────────
  {
    const s0 = emptyConversationsState();
    const s1 = upsertMeta(s0, sampleMeta({ id: "a", updatedAt: 1 }));
    check("upsertMeta inserts", s1.items.length === 1 && s1.items[0].id === "a");
    check("upsertMeta pure", s0.items.length === 0);
    const s2 = upsertMeta(s1, sampleMeta({ id: "b", updatedAt: 2 }));
    check(
      "upsertMeta recency",
      s2.items[0].id === "b" && s2.items[1].id === "a",
    );
    const s3 = setActive(s2, "a");
    check("setActive hit", s3.activeId === "a");
    check("setActive miss no-op", setActive(s2, "zzz").activeId === "");
    const s4 = removeConversation(s3, "a");
    check(
      "removeConversation drops + promotes recent",
      s4.items.length === 1 && s4.items[0].id === "b" && s4.activeId === "b",
    );
    const s5 = removeConversation(s4, "b");
    check("remove last clears active", s5.items.length === 0 && s5.activeId === "");
  }

  // ── serialize / parse ───────────────────────────────────────────────────
  {
    const s = setActive(
      upsertMeta(emptyConversationsState(), sampleMeta({ id: "keep-me" })),
      "keep-me",
    );
    const back = parseConversationsState(serializeConversationsState(s));
    check(
      "serialize/parse round-trip",
      back.items.length === 1 && back.activeId === "keep-me" && back.items[0].title === "Hello world",
    );
    check("parse corrupt → empty", parseConversationsState("{nope").items.length === 0);
    check(
      "parse rejects illegal id",
      parseConversationsState(
        JSON.stringify({
          activeId: "bad/id",
          items: [{ id: "bad/id", title: "x", updatedAt: 1, preview: "", searchBlob: "" }],
        }),
      ).items.length === 0,
    );
  }

  // ── migrate: legacy array → one conversation ────────────────────────────
  {
    const storage = memStorage();
    const legacy = [
      { id: "m1", role: "user", text: "First question about photosynthesis" },
      { id: "m2", role: "assistant", text: "Plants convert light." },
    ];
    await storage.setItem(LEGACY_MESSAGES_KEY, JSON.stringify(legacy));
    const migrated = await migrateLegacyIfNeeded(storage);
    check("migrate returns one conversation", migrated !== null && migrated.items.length === 1);
    check("migrate activeId default", migrated?.activeId === "default");
    const copied = await storage.getItem(messagesKey("default"));
    check(
      "migrate copied messages",
      copied === JSON.stringify(legacy),
    );
    check(
      "migrate left legacy key",
      (await storage.getItem(LEGACY_MESSAGES_KEY)) === JSON.stringify(legacy),
    );
    check(
      "migrate wrote index",
      Boolean(await storage.getItem(INDEX_KEY)),
    );
    check(
      "migrate wrote tombstone",
      (await storage.getItem(MIGRATED_KEY)) === "1",
    );
    check(
      "migrate title from first user",
      migrated?.items[0].title === "First question about photosynthesis",
    );

    // Second call is a no-op (index key present).
    const again = await migrateLegacyIfNeeded(storage);
    check("migrate second call no-op", again === null);

    await storage.removeItem(INDEX_KEY);
    const afterIndexDelete = await migrateLegacyIfNeeded(storage);
    check(
      "migrate after index delete still no-op (tombstone)",
      afterIndexDelete === null,
    );
    await storage.setItem(INDEX_KEY, serializeConversationsState(migrated));

    const loaded = await loadConversationsState(storage);
    check(
      "load after migrate",
      loaded.items.length === 1 && loaded.activeId === "default",
    );
  }

  {
    const storage = memStorage();
    await storage.setItem(LEGACY_MESSAGES_KEY, "[]");
    const migrated = await migrateLegacyIfNeeded(storage);
    check("migrate skips empty legacy array", migrated === null);
  }

  {
    const storage = memStorage();
    await storage.setItem(LEGACY_MESSAGES_KEY, JSON.stringify([{ foo: 1 }]));
    const migrated = await migrateLegacyIfNeeded(storage);
    check("migrate skips invalid messages", migrated === null);
  }

  {
    const storage = memStorage();
    const legacy = [{ id: "m1", role: "user", text: "Should not migrate" }];
    await storage.setItem(INDEX_KEY, JSON.stringify({ activeId: "", items: [] }));
    await storage.setItem(LEGACY_MESSAGES_KEY, JSON.stringify(legacy));
    const migrated = await migrateLegacyIfNeeded(storage);
    check("migrate skips present empty index", migrated === null);
    check(
      "empty index did not copy default",
      (await storage.getItem(messagesKey("default"))) === null,
    );
  }

  {
    const storage = memStorage();
    const legacy = [{ id: "m1", role: "user", text: "Should not migrate" }];
    await storage.setItem(INDEX_KEY, "{nope");
    await storage.setItem(LEGACY_MESSAGES_KEY, JSON.stringify(legacy));
    const migrated = await migrateLegacyIfNeeded(storage);
    check("migrate skips present corrupt index", migrated === null);
    check(
      "corrupt index did not copy default",
      (await storage.getItem(messagesKey("default"))) === null,
    );
  }

  {
    const storage = memStorage();
    const keep = [{ id: "keep", role: "user", text: "keep me" }];
    const legacy = [{ id: "m1", role: "user", text: "legacy must not overwrite" }];
    await storage.setItem(messagesKey("default"), JSON.stringify(keep));
    await storage.setItem(LEGACY_MESSAGES_KEY, JSON.stringify(legacy));
    const migrated = await migrateLegacyIfNeeded(storage);
    check("migrate with existing default still writes index", migrated !== null && migrated.items[0].id === "default");
    check(
      "migrate does not overwrite existing default",
      (await storage.getItem(messagesKey("default"))) === JSON.stringify(keep),
    );
    check(
      "migrate existing default uses dest title",
      migrated?.items[0].title === "keep me",
    );
    check(
      "migrate existing default writes tombstone",
      (await storage.getItem(MIGRATED_KEY)) === "1",
    );
  }

  {
    const storage = memStorage();
    await storage.setItem(MIGRATED_KEY, "1");
    await storage.setItem(
      LEGACY_MESSAGES_KEY,
      JSON.stringify([{ id: "m1", role: "user", text: "legacy after tombstone" }]),
    );
    const migrated = await migrateLegacyIfNeeded(storage);
    check("migrate skips when tombstone set", migrated === null);
    check(
      "tombstone did not copy default",
      (await storage.getItem(messagesKey("default"))) === null,
    );
  }

  {
    const storage = memStorage();
    check(
      "conversationHasPersistedMessages missing",
      (await conversationHasPersistedMessages(storage, "none")) === false,
    );
    await storage.setItem(messagesKey("c1"), "[]");
    check(
      "conversationHasPersistedMessages empty array",
      (await conversationHasPersistedMessages(storage, "c1")) === false,
    );
    await storage.setItem(messagesKey("c1"), JSON.stringify([{ role: "user", text: "x" }]));
    check(
      "conversationHasPersistedMessages non-empty",
      (await conversationHasPersistedMessages(storage, "c1")) === true,
    );
    check("peek empty array", persistedMessagesAreNonEmpty("[]") === false);
    check("peek null token", persistedMessagesAreNonEmpty("null") === false);
    check("peek missing", persistedMessagesAreNonEmpty(null) === false);
    check(
      "peek huge payload without parse",
      persistedMessagesAreNonEmpty(`[{"role":"user","text":"${"x".repeat(200_000)}"}]`) === true,
    );
    const emptyMeta = createEmptyConversationMeta(1);
    check("empty meta hasMessages false", emptyMeta.hasMessages === false);
    const withFlag = parseConversationsState(
      serializeConversationsState({
        activeId: "conv-1",
        items: [sampleMeta({ hasMessages: false })],
      }),
    );
    check(
      "hasMessages survives serialize/parse",
      withFlag.items[0]?.hasMessages === false,
    );
    const legacyIndex = parseConversationsState(
      JSON.stringify({
        activeId: "conv-1",
        items: [
          {
            id: "conv-1",
            title: "Hello world",
            updatedAt: 1,
            preview: "last line",
            searchBlob: "hello",
          },
        ],
      }),
    );
    check(
      "legacy index hasMessages omitted",
      legacyIndex.items[0]?.hasMessages === undefined,
    );
  }

  // ── sessionMeta conversationId ──────────────────────────────────────────
  const baseMeta = {
    formatVersion: 1,
    nCtx: 4096,
    cacheTypeK: "q8_0",
    cacheTypeV: "q4_0",
    historyHash: "abc",
  };
  check(
    "sessionMeta conversationId both missing match",
    sessionMetaMatches(baseMeta, { ...baseMeta }),
  );
  check(
    "sessionMeta conversationId one-sided mismatch",
    sessionMetaMatches(baseMeta, { ...baseMeta, conversationId: "conv-1" }) === false &&
      sessionMetaMatches({ ...baseMeta, conversationId: "conv-1" }, baseMeta) === false &&
      sessionMetaMismatchField(baseMeta, { ...baseMeta, conversationId: "conv-1" }) ===
        "conversationId",
  );
  check(
    "sessionMeta conversationId equal match",
    sessionMetaMatches(
      { ...baseMeta, conversationId: "conv-1" },
      { ...baseMeta, conversationId: "conv-1" },
    ),
  );
  check(
    "sessionMeta conversationId mismatch",
    sessionMetaMatches(
      { ...baseMeta, conversationId: "conv-1" },
      { ...baseMeta, conversationId: "conv-2" },
    ) === false &&
      sessionMetaMismatchField(
        { ...baseMeta, conversationId: "conv-1" },
        { ...baseMeta, conversationId: "conv-2" },
      ) === "conversationId",
  );
  check(
    "sessionMeta conversationId empty vs present mismatch",
    sessionMetaMatches(
      { ...baseMeta, conversationId: "" },
      { ...baseMeta, conversationId: "conv-1" },
    ) === false,
  );
  check(
    "sessionMeta conversationId both empty match",
    sessionMetaMatches({ ...baseMeta, conversationId: "" }, { ...baseMeta }),
  );

  // ── setBootMessagesKey + getBootHistoryHash ─────────────────────────────
  {
    resetBootHistoryHash();
    setBootMessagesKey(LEGACY_MESSAGES_KEY);
    resetBootHistoryHash();
    const payload = JSON.stringify([{ role: "user", text: "boot-legacy" }]);
    const asMod = await import(
      pathToFileURL(
        path.join(outDir, "node_modules/@react-native-async-storage/async-storage/index.js"),
      ).href
    );
    await asMod.default.setItem(LEGACY_MESSAGES_KEY, payload);
    const h0 = await getBootHistoryHash();
    check(
      "getBootHistoryHash default key",
      h0 === historyHash(payload),
      `got=${h0}`,
    );
    setBootMessagesKey("kalsa.messages.conv-boot");
    const other = JSON.stringify([{ role: "user", text: "other-chat" }]);
    await asMod.default.setItem("kalsa.messages.conv-boot", other);
    const h1 = await getBootHistoryHash();
    check(
      "getBootHistoryHash follows setBootMessagesKey",
      h1 === historyHash(other),
      `got=${h1}`,
    );
    check("boot hash differs across keys", h0 !== h1);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
