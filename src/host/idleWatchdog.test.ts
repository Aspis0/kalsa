/**
 * The foreground-idle clock (gap 8): the grace semantics as a pure machine,
 * plus the source pins for the wiring a node test cannot reach (the stack has
 * no render harness). Every pin names what it reads, and each pattern is
 * sampled against a string that must fail it — a vacuous grep would otherwise
 * pass this whole file while checking nothing.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { createForegroundIdleClock, type ForegroundIdleClockDeps } from "./idleWatchdog";
import { FOREGROUND_IDLE_DISPOSE_MS } from "../app/foregroundIdleDispose";
import { GENERATION_STALL_GAP_MS } from "../engine/stallWatchdog";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

interface FakeHandle {
  at: number;
  run: () => void;
}

type Outcome = "ended" | "skipped" | "reject";

function harness(startTime = 1_000_000) {
  const state = {
    now: startTime,
    read: {
      engineReady: true,
      inFlight: false,
      tokenSilenceMs: undefined as number | undefined,
    },
    foreground: true,
    outcome: "ended" as Outcome,
    hold: false,
  };
  let pending: FakeHandle | null = null;
  let releaseHold: (() => void) | null = null;
  const h = {
    clock: null as unknown as ReturnType<typeof createForegroundIdleClock>,
    pending: () => pending,
    fireNow: () => {
      const handle = pending;
      pending = null;
      if (handle) handle.run();
    },
    advance: (ms: number) => {
      state.now += ms;
    },
    /** Resolve the discard chain, then run any fire it scheduled. */
    drain: async () => {
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
        await Promise.resolve();
        const handle = pending;
        if (handle && handle.at <= state.now) {
          pending = null;
          handle.run();
        }
      }
    },
    discards: 0,
    stalls: [] as Array<{ idleMs: number; tokenSilenceMs: number | undefined }>,
    ages: [] as number[],
    schedules: 0,
    setRead: (next: Partial<(typeof state)["read"]>) => {
      state.read = { ...state.read, ...next };
    },
    setForeground: (next: boolean) => {
      state.foreground = next;
    },
    setOutcome: (next: Outcome) => {
      state.outcome = next;
    },
    holdDiscard: () => {
      state.hold = true;
    },
    releaseDiscard: () => {
      state.hold = false;
      releaseHold?.();
      releaseHold = null;
    },
  };
  const deps: ForegroundIdleClockDeps<FakeHandle> = {
    now: () => state.now,
    schedule: (run, delayMs) => {
      h.schedules += 1;
      pending = { at: state.now + delayMs, run };
      return pending;
    },
    cancel: (handle) => {
      if (pending === handle) pending = null;
    },
    isForeground: () => state.foreground,
    read: () => state.read,
    discard: async (ageNow) => {
      h.discards += 1;
      h.ages.push(ageNow());
      if (state.hold) {
        await new Promise<void>((resolve) => {
          releaseHold = resolve;
        });
      }
      if (state.outcome === "reject") throw new Error("discard failed");
      return state.outcome;
    },
    onStallAttempt: (idleMs, tokenSilenceMs) => {
      h.stalls.push({ idleMs, tokenSilenceMs });
    },
  };
  h.clock = createForegroundIdleClock(deps);
  return h;
}

describe("createForegroundIdleClock — arm, re-arm, and the skip doors", () => {
  it("bump arms the FULL window once; a later bump does not restart the pending fire", () => {
    const h = harness();
    h.clock.bump();
    expect(h.schedules).toBe(1);
    expect(h.pending()!.at - 1_000_000).toBe(FOREGROUND_IDLE_DISPOSE_MS);
    h.advance(60_000);
    h.clock.bump(); // activity recorded, timer NOT restarted (App:3311-3314)
    expect(h.schedules).toBe(1);
    // The pending fire, when it comes, sees the NEW activity time.
    h.advance(120_000); // idle at fire = 120 s < 180 s
    h.fireNow();
    expect(h.discards).toBe(0);
    expect(h.schedules).toBe(2); // re-armed
  });

  it("an at-limit fire disposes; 'ended' leaves the clock unarmed until the next bump", async () => {
    const h = harness();
    h.clock.bump();
    h.advance(FOREGROUND_IDLE_DISPOSE_MS);
    h.fireNow();
    expect(h.discards).toBe(1);
    await h.drain();
    // Controller parity: after a completed dispose NOTHING re-arms
    // (requestDeferredDispose has no idleClock.arm() on success).
    expect(h.pending()).toBeNull();
    h.clock.bump(); // activity restarts it
    expect(h.pending()).not.toBeNull();
  });

  it("a 'skipped' discard re-arms (skipDisposeWhileInFlight, newer_gen, plan)", async () => {
    const h = harness();
    h.setOutcome("skipped");
    h.clock.bump();
    h.advance(FOREGROUND_IDLE_DISPOSE_MS);
    h.fireNow();
    expect(h.discards).toBe(1);
    await h.drain();
    expect(h.pending()).not.toBeNull();
  });

  it("a rejected discard ends the clock without throwing (the controller's catch {})", async () => {
    const h = harness();
    h.setOutcome("reject");
    h.clock.bump();
    h.advance(FOREGROUND_IDLE_DISPOSE_MS);
    h.fireNow();
    await h.drain();
    expect(h.discards).toBe(1);
    expect(h.pending()).toBeNull();
  });

  it("a fire outside the foreground never disposes — only re-arms (no ungraced background unload)", () => {
    const h = harness();
    h.setForeground(false);
    h.clock.bump();
    h.advance(FOREGROUND_IDLE_DISPOSE_MS);
    h.fireNow();
    expect(h.discards).toBe(0);
    expect(h.pending()).not.toBeNull();
  });

  it("engine not ready → re-arm, no discard", () => {
    const h = harness();
    h.setRead({ engineReady: false });
    h.clock.bump();
    h.advance(FOREGROUND_IDLE_DISPOSE_MS);
    h.fireNow();
    expect(h.discards).toBe(0);
    expect(h.pending()).not.toBeNull();
  });

  it("a live turn with no decoded token yet is never app-disposed (token silence undefined)", () => {
    const h = harness();
    h.setRead({ inFlight: true, tokenSilenceMs: undefined });
    h.clock.bump();
    h.advance(FOREGROUND_IDLE_DISPOSE_MS);
    h.fireNow();
    expect(h.discards).toBe(0);
    expect(h.pending()).not.toBeNull();
  });

  it("a live turn past 3× the raw-token gap disposes AND reports the stall attempt", async () => {
    const h = harness();
    h.setRead({ inFlight: true, tokenSilenceMs: 3 * GENERATION_STALL_GAP_MS });
    h.clock.bump();
    h.advance(FOREGROUND_IDLE_DISPOSE_MS);
    h.fireNow();
    expect(h.discards).toBe(1);
    expect(h.stalls).toEqual([
      { idleMs: FOREGROUND_IDLE_DISPOSE_MS, tokenSilenceMs: 3 * GENERATION_STALL_GAP_MS },
    ]);
    await h.drain();
  });

  it("a discard still pending swallows a second fire into a plain re-arm (discardRunning guard)", async () => {
    const h = harness();
    h.holdDiscard();
    h.clock.bump();
    h.advance(FOREGROUND_IDLE_DISPOSE_MS);
    h.fireNow(); // discard 1 starts and stays pending
    expect(h.discards).toBe(1);
    h.clock.bump(); // user activity arms a fresh timer while it runs
    expect(h.pending()).not.toBeNull();
    h.fireNow(); // forced second fire mid-discard
    expect(h.discards).toBe(1); // guarded — no second discard
    expect(h.pending()).not.toBeNull(); // and the clock re-armed anyway
    h.releaseDiscard();
    await h.drain();
  });

  it("clear cancels the pending fire", () => {
    const h = harness();
    h.clock.bump();
    expect(h.pending()).not.toBeNull();
    h.clock.clear();
    expect(h.pending()).toBeNull();
    h.advance(FOREGROUND_IDLE_DISPOSE_MS * 3);
    h.fireNow(); // nothing to run
    expect(h.discards).toBe(0);
  });

  it("ageNow reports the LIVE idle age at discard time — what the controller's log writes", async () => {
    const h = harness();
    h.clock.bump(); // activity at t0
    h.advance(60_000);
    h.clock.bump(); // activity at t0+60 s
    h.advance(FOREGROUND_IDLE_DISPOSE_MS);
    h.fireNow();
    await h.drain();
    expect(h.discards).toBe(1);
    expect(h.ages).toEqual([FOREGROUND_IDLE_DISPOSE_MS]);
  });
});

describe("the wiring a node test can read (source pins, comments stripped)", () => {
  const IDLE = stripComments(read("foregroundIdle.ts"));
  const WATCHDOG = stripComments(read("idleWatchdog.ts"));
  const ENGINE = stripComments(read("useHostEngine.ts"));
  const EFFECTS = stripComments(read("useHostEffects.ts"));
  const SURFACE = stripComments(read("HostChatSurface.tsx"));
  const SEND = stripComments(read("engineTurn.ts"));
  const RESEND = stripComments(read("truncateAndResend.ts"));
  const ACTIONS = stripComments(read("messageActions.ts"));
  const DEPS = read("hostDeps.ts"); // comment truthfulness needs the comments

  it("the governor mounts from the engine chain with the turn refs and the gate gen", () => {
    expect(ENGINE).toContain("useForegroundIdleDispose({");
    const start = ENGINE.indexOf("useForegroundIdleDispose({");
    const block = ENGINE.slice(start, ENGINE.indexOf("});", start));
    const needles = [
      "streamInFlightRef",
      "nativeTurnStartAtRef",
      "chatGateGenRef: modelHost.scanRefs.chatGateGenRef",
    ];
    for (const needle of needles) {
      expect([needle, block.includes(needle)]).toEqual([needle, true]);
    }
    // sample: a mount that forgot an input must fail the predicate
    expect("useForegroundIdleDispose({ chatGateGenRef })".includes("streamInFlightRef")).toBe(false);
  });

  it("the abort bridge is installed AND cleared by the send owner's lifecycle effect", () => {
    expect(EFFECTS).toContain("idleDiscardAbortRef.current = () => abortRef.current?.abort();");
    expect(EFFECTS).toContain("idleDiscardAbortRef.current = null;");
    expect(IDLE).toContain("idleDiscardAbortRef.current?.();");
    // sample
    expect("idleDiscardAbortRef.current = null;".includes("= () =>")).toBe(false);
  });

  it("arm/disarm: mount assigns the real clock; keyboard and foreground bump it; unmount restores the no-op", () => {
    expect(IDLE).toContain("bumpForegroundIdleRef.current = clock.bump;");
    expect(IDLE).toContain('Keyboard.addListener("keyboardDidShow"');
    expect(IDLE).toContain('if (next === "active") clock.bump();');
    expect(IDLE).toContain("clock.clear();");
    expect(IDLE).toContain("bumpForegroundIdleRef.current = () => {};");
    // The controller's native paused-activity timer, not a bare setTimeout:
    expect(IDLE).toContain("createBackgroundTimer(");
    // sample
    expect('bumpForegroundIdleRef.current = clock.bump;'.includes("= () => {}")).toBe(false);
  });

  it("the disposal body keeps the controller's gates and its greppable log lines", () => {
    expect(IDLE).toContain("skipDisposeWhileInFlight({");
    expect(IDLE).toContain('kind: "idle"');
    expect(IDLE).toContain('state: "idle_expired"');
    expect(IDLE).toContain("saveEngineSession(");
    expect(IDLE).toContain("resetBootHistoryHash();");
    expect(IDLE).toContain("markChatReleased(genAtEntry);");
    expect(WATCHDOG).toContain("shouldRunForegroundIdleDispose({");
    // The two lines campaign scripts parse:
    expect(IDLE).toContain('"KALSA_IDLE_STALL"');
    expect(IDLE).toContain('"model.unload"');
    expect(IDLE).toContain('reason: "idle"');
    // sample: the wrong skip kind would flip the rule
    expect(IDLE.includes('kind: "background"')).toBe(false);
  });

  it("every bump site the controller shipped that this host can have", () => {
    // Turn start — controller `App:5417`, pre-existing here:
    expect(SEND).toContain("bumpForegroundIdleRef.current();");
    // Composer keystrokes — controller `Chat:4335`:
    expect(SURFACE).toContain("bumpForegroundIdleRef.current();");
    expect(SURFACE).toContain("onDraftChange={bumpDraftOnType}");
    // The edit modal's keystrokes — controller `Chat:4526`:
    expect(ACTIONS).toContain("setEditDraft(draft);");
    expect(ACTIONS).toContain("bumpForegroundIdleRef.current();");
    // The edit/regenerate acquire — controller `Chat:3353`:
    expect(RESEND).toContain("bumpForegroundIdleRef.current();");
    // sample: a site without the bump fails
    expect("setEditDraft(draft);".includes("bumpForegroundIdleRef.current()")).toBe(false);
  });

  it("hostDeps no longer claims the idle system is unmounted — its comment tells the truth", () => {
    expect(DEPS).not.toContain("(unmounted)");
    expect(DEPS).toContain("foregroundIdle.ts");
    // sample
    expect("the (unmounted) system".includes("(unmounted)")).toBe(true);
  });
});
