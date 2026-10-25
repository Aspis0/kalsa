import { useEffect, useRef, useState } from "react";
import type { Capability } from "./MachineCard";
import type { BrainState } from "./useBrain";
import { available, invoke } from "../lib/tauri";
import { lastKnown } from "../lib/slotGate";

/**
 * The chooser's answer (`brain_capability`), read on mount and whenever a
 * turn-on lands — the walk can change what was measured, and a first walk can
 * end having only measured. `reread` asks again on demand.
 */
export function useCapability(state: BrainState | null, busy: boolean) {
  const [capability, setCapability] = useState<Capability | null>(null);
  const [reads, setReads] = useState(0);
  const previousKind = useRef<string | null>(null);
  // The last answer that landed, as the legacy check sees it: a read that
  // fails mid-check leaves this as it was, so the polling below keeps asking.
  const migrating = useRef(false);

  useEffect(() => {
    const kind = state?.kind ?? null;
    const previous = previousKind.current;
    previousKind.current = kind;
    // Read again whenever the brain ARRIVES at running, from wherever: a start
    // fast enough to be read as stopped and then running has no `starting` to
    // key on. `null` is the first observation, which the mount read covers.
    if (previous !== null && previous !== "running" && kind === "running") {
      setReads((count) => count + 1);
    }
  }, [state]);

  useEffect(() => {
    // Outside the Tauri webview there is no chooser to ask. A walk in flight
    // would answer stale, so the read waits for it to land (`busy` falling
    // re-runs this).
    if (!available() || busy) return;
    let live = true;
    invoke<Capability>("brain_capability")
      .then((next) => {
        if (!live) return;
        migrating.current = next.kind === "migrating";
        setCapability(next);
      })
      .catch(() => {
        // A failed read is not a machine that was never measured: the answer
        // before it stands, and only a page that never had one stays blank.
        if (live) setCapability((previous) => lastKnown(previous, null));
      });
    return () => {
      live = false;
    };
  }, [reads, busy]);

  // Ask again until an answer lands: the legacy check takes about a minute,
  // and a failed read keeps the 1 s timer going. `reads` is in the
  // dependencies so a failure on an already-blank answer reschedules too.
  useEffect(() => {
    if (!available()) return;
    if (capability !== null && !migrating.current) return;
    const timer = window.setTimeout(() => setReads((count) => count + 1), 1000);
    return () => window.clearTimeout(timer);
  }, [capability, reads]);

  return { capability, reread: () => setReads((count) => count + 1) };
}
