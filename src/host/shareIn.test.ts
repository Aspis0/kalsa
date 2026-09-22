/**
 * Share-in's consume gate and nonce merge (D2 row 16), pinned as the four
 * behaviours the controller recorded at `AppShell.tsx:3553-3671` and
 * `AiChatPage.tsx:1959-1969`:
 *
 * 1. CONSUME ONCE — one intent applies once (`handled` at claim time);
 * 2. HOLD — a share before the conversations are ready is parked and later
 *    applied, never dropped;
 * 3. NONCE RE-MERGE — the same passage shared twice merges twice, keeping
 *    the draft that was already there;
 * 4. invalid URLs are dropped BEFORE they are recorded (they never occupy
 *    the dedupe set or the pending slot's claim).
 *
 * The `kalsa://share` parsing and the 20k merge are the controller's own
 * functions (`src/app/shareIntent.ts`) — this file tests what the host does
 * around them.
 */
import { SHARE_TEXT_CAP, mergeSharePrefill } from "../app/shareIntent";
import {
  claimShare,
  createShareGate,
  recordSharePrefill,
  takePendingShare,
} from "./shareIn";

const shareUrl = (text: string) => `kalsa://share?text=${encodeURIComponent(text)}`;

describe("consume once (App:3561)", () => {
  test("the same URL delivered twice claims exactly once", () => {
    const gate = createShareGate();
    const url = shareUrl("hello");
    expect(claimShare(gate, url, true).outcome).toBe("apply");
    expect(claimShare(gate, url, true).outcome).toBe("duplicate");
    expect(gate.handled).toEqual(new Set([url]));
  });

  test("a claim carries the controller's parsed payload", () => {
    const gate = createShareGate();
    const claim = claimShare(gate, shareUrl("hello"), true);
    expect(claim).toEqual({ outcome: "apply", payload: { kind: "text", text: "hello" } });
  });

  test("an empty URL is ignored, not recorded", () => {
    const gate = createShareGate();
    expect(claimShare(gate, null, true).outcome).toBe("empty");
    expect(gate.handled.size).toBe(0);
  });
});

describe("hold until the conversations are ready (App:3562, 3661-3671)", () => {
  test("a share before ready is held — not applied, not lost — and the flush applies it once", () => {
    const gate = createShareGate();
    const url = shareUrl("held passage");
    expect(claimShare(gate, url, false).outcome).toBe("held");
    // Held is not claimed: the URL must still be appliable by the flush.
    expect(gate.handled.has(url)).toBe(false);

    const flushed = takePendingShare(gate);
    expect(flushed).toBe(url);
    expect(claimShare(gate, flushed, true).outcome).toBe("apply");
    // The slot emptied before the consume: a second flush finds nothing.
    expect(takePendingShare(gate)).toBeNull();
    expect(claimShare(gate, url, true).outcome).toBe("duplicate");
  });

  test("the pending slot is one deep: the newest held URL wins, as the ref did", () => {
    const gate = createShareGate();
    claimShare(gate, shareUrl("first"), false);
    claimShare(gate, shareUrl("second"), false);
    expect(takePendingShare(gate)).toBe(shareUrl("second"));
    expect(takePendingShare(gate)).toBeNull();
  });

  test("a held URL the flush cannot parse is dropped at the flush, not recorded", () => {
    const gate = createShareGate();
    claimShare(gate, "https://example.com/not-kalsa", false);
    const flushed = takePendingShare(gate);
    expect(claimShare(gate, flushed, true).outcome).toBe("invalid");
    expect(gate.handled.size).toBe(0);
  });
});

describe("invalid URLs never occupy the gate (App:3556)", () => {
  test("a foreign scheme or a non-share kalsa URL is dropped before recording", () => {
    const gate = createShareGate();
    expect(claimShare(gate, "https://example.com/x", true).outcome).toBe("invalid");
    expect(claimShare(gate, "kalsa://settings?tab=voice", true).outcome).toBe("invalid");
    expect(claimShare(gate, "kalsa://share", true).outcome).toBe("invalid");
    expect(gate.handled.size).toBe(0);
    expect(gate.pending).toBeNull();
  });
});

describe("the nonce re-merge (Chat:1959-1969)", () => {
  test("an identical payload still advances the nonce, so the merge effect re-runs", () => {
    const first = recordSharePrefill(null, "same passage");
    const second = recordSharePrefill(first, "same passage");
    expect(first.nonce).toBe(1);
    expect(second.nonce).toBe(2);
    // Two distinct states: the effect keyed on the nonce fires again even
    // though the text is byte-identical.
    expect(second).not.toBe(first);
    expect(second.text).toBe(first.text);
  });

  test("the merge keeps the draft that was already there", () => {
    expect(mergeSharePrefill("existing draft", "shared")).toBe("existing draft\n\nshared");
  });

  test("sharing the same passage twice lands it twice within the cap", () => {
    // The effect body, run over both nonce bumps: draft in, merged draft out.
    let draft = "";
    let prefill = null as ReturnType<typeof recordSharePrefill> | null;
    for (let applied = 0; applied < 2; applied += 1) {
      prefill = recordSharePrefill(prefill, "same passage");
      draft = mergeSharePrefill(draft, prefill.text);
    }
    expect(draft).toBe("same passage\n\nsame passage");
    expect(prefill!.nonce).toBe(2);
  });

  test("the merge never exceeds the controller's 20k cap", () => {
    const long = "x".repeat(SHARE_TEXT_CAP);
    const merged = mergeSharePrefill(long, "more text");
    expect(merged.length).toBe(SHARE_TEXT_CAP);
  });
});
