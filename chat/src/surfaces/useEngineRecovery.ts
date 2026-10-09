import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "../lib/tauri";

/** Whether the engine came back by itself after an unexpected exit. The
    desktop announces the automatic restart when it decides on it. The state
    that follows settles it: `running` is a recovery, and `failed` or `stopped`
    after the restart began is a restart that did not come back. `failed`
    before the restart shows is the crash itself, not an answer. */
export function useEngineRecovery(kind: string | null): { recovered: boolean; dismiss: () => void } {
  const [recovered, setRecovered] = useState(false);
  const restart = useRef({ pending: false, started: false });
  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    void listen("engine_recovering", () => {
      restart.current = { pending: true, started: false };
    }).then((stop) => {
      if (live) unlisten = stop;
      else stop();
    });
    return () => {
      live = false;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    const held = restart.current;
    if (kind === null || !held.pending) return;
    if (kind === "starting") {
      held.started = true;
    } else if (kind === "running") {
      restart.current = { pending: false, started: false };
      setRecovered(true);
    } else if ((kind === "failed" || kind === "stopped") && held.started) {
      restart.current = { pending: false, started: false };
    }
  }, [kind]);
  // Stable: the notice's timer is keyed on it, and the page re-renders on every poll.
  const dismiss = useCallback(() => setRecovered(false), []);
  return { recovered, dismiss };
}
