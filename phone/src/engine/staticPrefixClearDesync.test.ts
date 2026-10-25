/**
 * Regression guard for the NEW_CHAT static-prefix desync (device log, iPhone).
 *
 * Opening a new chat made chatKvSessionLoad fail `no_file`; its finally called
 * dropHoldAfterOptionalNativeClear, and engine.clearCache() emptied the native
 * KV — while prewarmPrefixHash stayed set. The next queueStaticPrefixPrewarm then
 * took the shouldSkipStaticPrefixPrewarm branch, logged `already_warm` and
 * returned BEFORE the job that restores the saved system-prefix snapshot
 * (LlamaService.ts:1356-1391): a ~2100-token re-prefill, 7.9 s, with a
 * 1989-token snapshot sitting on disk. Platform-agnostic — the KV is the KV.
 *
 * LlamaService.ts value-imports llama.rn and reads react-native AppState, so no
 * Jest test can import it (see sessionMarkerPrivacy.test.ts). The wiring is
 * therefore asserted as source text and the consequence is driven through the
 * REAL pure helpers, so the guard fails on the old wiring instead of merely
 * restating it: each test reads its verdict out of the body it is guarding.
 */

import fs from "fs";
import path from "path";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock("expo-file-system/legacy", () => ({
  __esModule: true,
  documentDirectory: "file:///kalsa/",
  getInfoAsync: jest.fn(async () => ({ exists: false, isDirectory: false })),
  getFreeDiskStorageAsync: jest.fn(async () => 1_000_000_000),
}));

import { shouldSkipStaticPrefixPrewarm } from "./prefixPrewarm";
import { nativeEmptyForHoldDrop } from "./sessionPersistence";

const serviceSource = fs.readFileSync(
  path.resolve(__dirname, "LlamaService.ts"),
  "utf8",
);
const loadSource = fs.readFileSync(
  path.resolve(__dirname, "chatKvSessionLoad.ts"),
  "utf8",
);

/** Brace-matched body of the named LlamaService function. */
function bodyOf(name: string): string {
  if (serviceSource.split(`function ${name}(`).length !== 2) {
    throw new Error(`expected exactly one ${name} declaration in LlamaService`);
  }
  const signature = serviceSource.indexOf(`function ${name}(`);
  // A top-level function ends with a `}` in column 0, and its body is matched
  // backwards from there: forward-matching from the signature would stop
  // inside an object-literal return type (`Promise<{ text: string }>`).
  const end = serviceSource.indexOf("\n}\n", signature);
  if (end < 0) throw new Error(`no end of ${name}`);
  let depth = 0;
  for (let i = end + 1; i >= 0; i -= 1) {
    const char = serviceSource[i];
    if (char === "}") depth += 1;
    else if (char === "{") {
      depth -= 1;
      if (depth === 0) return serviceSource.slice(i, end + 3);
    }
  }
  throw new Error(`unbalanced body for ${name}`);
}

/** Name of the nearest enclosing top-level function declaration. */
function enclosingFunction(at: number): string {
  const before = serviceSource.slice(0, at);
  const declarations = [
    ...before.matchAll(/^(?:export )?(?:async )?function (\w+)\(/gm),
  ];
  const name = declarations[declarations.length - 1]?.[1];
  if (!name) throw new Error(`no enclosing function for offset ${at}`);
  return name;
}

describe("the clear that takes the static prefix with it", () => {
  test("a successful clear in dropHoldAfterOptionalNativeClear nulls the warmth flag", () => {
    const body = bodyOf("dropHoldAfterOptionalNativeClear");
    expect(body).toMatch(/nativeEmptyForHoldDrop\(\{\s*clearCacheSucceeded:/);
    // The reported path: the flag dies only where the clear actually landed,
    // and in the same branch that already invalidates the chat boundary.
    expect(body).toMatch(/if \(nativeEmpty\) \{[\s\S]*?markStaticPrefixCacheGone\(\);/);
    // resetPrewarmState() would bump prewarmGeneration and cancel the very
    // prewarm this fix exists to let through. Pin the policy.
    expect(body).not.toMatch(/resetPrewarmState|prewarmGeneration/);
  });

  test("markStaticPrefixCacheGone nulls both flags, and markChatKvCleared shares it", () => {
    const body = bodyOf("markStaticPrefixCacheGone");
    expect(body).toMatch(/prewarmPrefixHash = null;/);
    expect(body).toMatch(/prewarmQueuedKey = null;/);
    // Not resetPrewarmState: a generation bump cancels the next prewarm.
    expect(body).not.toMatch(/prewarmGeneration/);
    // One helper, two rules for the same fact — no second copy to drift.
    const cleared = bodyOf("markChatKvCleared");
    expect(cleared).toMatch(/markStaticPrefixCacheGone\(\);/);
    expect(cleared).not.toMatch(/prewarmPrefixHash|prewarmQueuedKey/);
  });

  test("every native-cache clear site reaches that helper", () => {
    // Declaration excluded: tryClearNativeChatKv performs the clear, it does
    // not consume the verdict. Pinned, so a new clear site must be reasoned
    // about rather than silently added.
    const sites = [
      ...serviceSource.matchAll(
        /(?<!function )tryClearNativeChatKv\(|(?<!engine\.)context\.clearCache\(\)/g,
      ),
    ];
    expect(sites.length).toBe(6);
    for (const site of sites) {
      const at = site.index ?? 0;
      // The clear's own function must reach the helper DOWNSTREAM of the
      // clear: nulling the flag before the native clear would still leave it
      // set. completeOnce closes its clear out in a finally, so the whole
      // enclosing body is the scope, not a character window.
      const body = bodyOf(enclosingFunction(at));
      // markChatKvCleared routes through the same helper. A bare
      // `prewarmPrefixHash = null` is not enough: it leaves prewarmQueuedKey set.
      expect(body).toMatch(/markStaticPrefixCacheGone\(\)|markChatKvCleared\(\)/);
      expect(body).not.toMatch(/\bprewarmPrefixHash = null;/);
    }
  });
});

describe("what the next queueStaticPrefixPrewarm decides", () => {
  // Stand-in for the resolved system-prefix identity; only equality matters.
  const PREFIX_HASH = "prefix:it:no-tools";

  test("a failed session load that cleared the KV does not log already_warm", () => {
    // chatKvSessionLoad's no_file returns false early, and its finally is what
    // clears. If either stops routing through the helper, this fails.
    expect(loadSource).toMatch(
      /log\(false, \{ reason: "no_file" \}\);\s*return false;/,
    );
    expect(loadSource).toMatch(
      /if \(!loadOk\) \{[\s\S]*?dropHoldAfterOptionalNativeClear\(state\.context\);/,
    );

    // The clear landed...
    expect(nativeEmptyForHoldDrop({ clearCacheSucceeded: true })).toBe(true);
    // ...and the wiring above is what decides the flag's fate. Read it from
    // the guarded body instead of a local copy, so the wiring stays load-bearing.
    const clearsWarmthFlag =
      /if \(nativeEmpty\) \{[\s\S]*?markStaticPrefixCacheGone\(\);/.test(
        bodyOf("dropHoldAfterOptionalNativeClear"),
      );
    const prewarmPrefixHashAfterClear = clearsWarmthFlag ? null : PREFIX_HASH;

    expect(prewarmPrefixHashAfterClear).toBeNull();
    // Not the skip: the queue proceeds to restore the saved snapshot (or, with
    // none on disk, prefill) instead of returning before it.
    expect(
      shouldSkipStaticPrefixPrewarm(prewarmPrefixHashAfterClear, PREFIX_HASH),
    ).toBe(false);
    // The device log: with the flag left set, this is the already_warm that
    // cost 7.9 s and wasted the 1989-token snapshot.
    expect(shouldSkipStaticPrefixPrewarm(PREFIX_HASH, PREFIX_HASH)).toBe(true);
  });
});

describe("a prewarm job queued before a clear re-checks warmth when it runs", () => {
  test("the job skips when an earlier job already warmed the same prefix", () => {
    // A clear releases prewarmQueuedKey, so a second job can be queued for the
    // same hash. The check must sit inside the job, after the stale check and
    // before the finally that releases the key.
    const job = bodyOf("queueStaticPrefixPrewarm");
    expect(job).toMatch(
      /if \(gen !== prewarmGeneration\)[\s\S]*?shouldSkipStaticPrefixPrewarm\(prewarmPrefixHash, prefix\.hash\)[\s\S]*?\} finally \{/,
    );
  });

  test("the skip is a real early return, not just a log line", () => {
    const job = bodyOf("queueStaticPrefixPrewarm");
    expect(job).toMatch(
      /shouldSkipStaticPrefixPrewarm\(prewarmPrefixHash, prefix\.hash\)\) \{\s*logPrewarm\(\{ op: "skip", reason: "already_warm", hash: prefix\.hash \}\);\s*return;/,
    );
  });
});