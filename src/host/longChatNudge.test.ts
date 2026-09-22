/**
 * The long-chat nudge (gap 7): the controller's state + effect + row, pinned
 * as source because the stack has no render harness. Three things are
 * checked: the once-per-conversation rule's machinery (latch, reset, render
 * gate), the catalogue keys in BOTH languages, and the box the action lives
 * in — every pattern sampled against a string that must fail it.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { en } from "../i18n/en";
import { it as italian } from "../i18n/it";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const SURFACE = stripComments(read("HostChatSurface.tsx"));
// BEFORE this slice the row's JSX lived INSIDE HostChatSurface; it moved to
// its own component (a topic seam — one row, one file — cut so the attach
// sheet could land under the surface's ratchet). The GATE, the latch and the
// reset stayed in the surface; the DRAWING pins below moved with the drawing.
const ROW = stripComments(read("LongChatNudgeRow.tsx"));
const LAYOUT = stripComments(read("HostLayout.tsx"));

describe("the estimate runs on the controller's own unit", () => {
  it("calls src/chat/longChatEstimate with the transcript and the resolved n_ctx", () => {
    expect(SURFACE).toContain(
      "shouldShowLongChatNudge(view.transcript, modelHost.chatEngineCtx)",
    );
    // sample: a different helper or a hardcoded ctx must fail
    expect(SURFACE.includes("shouldShowLongChatNudge(view.transcript, 4096)")).toBe(false);
  });

  it("recomputes on length, n_ctx and the last turn's finalize — never per token (Chat:1318-1322)", () => {
    for (const dep of [
      "view.transcript.length,",
      "modelHost.chatEngineCtx,",
      "view.transcript[view.transcript.length - 1]?.caret,",
      "view.transcript[view.transcript.length - 1]?.stop,",
    ]) {
      expect([dep, SURFACE.includes(dep)]).toEqual([dep, true]);
    }
    // sample: the dep list is these four, not the mapped array identity
    expect(SURFACE).not.toContain("[longChat, view.transcript]");
  });
});

describe("once per conversation: latch, reset, gate (Chat:921-922, 1314-1327)", () => {
  it("the latch state exists and fires exactly the controller's way", () => {
    expect(SURFACE).toContain("const [longChatNudgeShown, setLongChatNudgeShown] = useState(false);");
    expect(SURFACE).toContain("if (longChat && !longChatNudgeShown) setLongChatNudgeShown(true);");
    // sample
    expect(SURFACE.includes("setLongChatNudgeShown(false);")).toBe(true);
  });

  it("the conversation change resets it — the controller's clearChat/load resets as one id change", () => {
    const reset = SURFACE.indexOf("setLongChatNudgeShown(false);");
    expect(reset).toBeGreaterThan(0);
    const effect = SURFACE.slice(reset, SURFACE.indexOf("}, [conversationId]);", reset));
    expect(effect).toContain("setLongChatNudgeShown(false);");
    // The reset effect's ONLY dependency is the id:
    expect(SURFACE).toContain("}, [conversationId]);");
    // …and the id reaches the surface from the store this host already passes:
    expect(LAYOUT).toContain(
      "conversationId={conv.conversationsReady ? conv.conversations.activeId : undefined}",
    );
    // sample: a reset keyed on messages would re-fire per append
    expect(SURFACE).toContain("}, [conversationId]);");
    expect(SURFACE.includes("}, [view.transcript.length]);")).toBe(false);
  });

  it("the row renders behind the gate (longChat && shown) with the controller's copy", () => {
    expect(SURFACE).toContain("{longChat && longChatNudgeShown ? (");
    // The copy pins moved with the JSX to `LongChatNudgeRow.tsx` (see the
    // header): the gate decides WHEN, the component says WHAT.
    expect(ROW).toContain('{t("chat.longChatNudge")}');
    expect(ROW).toContain('{t("chat.longChatNudgeAction")}');
    // sample: ungated rendering is the stuck-row bug this gate exists for
    expect(SURFACE.includes("{longChatNudgeShown ? (")).toBe(false);
  });
});

describe("the row: named node, real box, both catalogues", () => {
  it("the action is a pressable with a testID, the controller's a11y label and a 48 dp box", () => {
    // BEFORE: these pins ran against HostChatSurface's source; the row moved
    // to `LongChatNudgeRow.tsx` — same strings, new file.
    expect(ROW).toContain('testID="transcript.longChatNudge"');
    expect(ROW).toContain('testID="transcript.longChatNudge.newChat"');
    expect(ROW).toContain('accessibilityLabel={t("chat.a11yNewChat")}');
    expect(ROW).toContain("onPress={onNewChatPress}");
    expect(ROW).toContain("minHeight: MIN_TOUCH_TARGET");
    // The controller used hitSlop={8}; this build may not — in EITHER file.
    expect(ROW).not.toContain("hitSlop");
    expect(SURFACE).not.toContain("hitSlop");
    // sample
    expect("hitSlop".includes("hitSlop")).toBe(true);
  });

  it("every key resolves in BOTH catalogues with real text", () => {
    expect(en.chat.longChatNudge).toBeTruthy();
    expect(en.chat.longChatNudgeAction).toBeTruthy();
    expect(en.chat.a11yNewChat).toBeTruthy();
    expect(italian.chat.longChatNudge).toBeTruthy();
    expect(italian.chat.longChatNudgeAction).toBeTruthy();
    expect(italian.chat.a11yNewChat).toBeTruthy();
    // The keys the controller shipped, not new ones:
    expect(en.chat.longChatNudge).toContain("long");
    expect(italian.chat.longChatNudge).toContain("lunga");
    // sample: an English-only key would be caught by the it lookup above.
    expect((italian.chat as Record<string, string | undefined>).missingKey).toBeUndefined();
  });
});
