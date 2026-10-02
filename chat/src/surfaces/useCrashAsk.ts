import { useCallback, useEffect, useRef, useState } from "react";
import { available, invoke } from "../lib/tauri";

/** The crash prompt's two asks, on the channels that already exist:
    whether the previous session exited uncleanly (asked once, on the
    first mount, through the command that clears the flag), and whether
    the engine died under a running app (watched on the same state poll
    every status line reads — `running` falling to `failed` is the one
    transition that is a crash and neither a stop the owner asked for nor
    a start that never came up). `dismiss` closes the card; nothing reopens
    it within the session. */
export function useCrashAsk(kind: string | null): { ask: boolean; dismiss: () => void } {
  const [ask, setAsk] = useState(false);
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (!available()) return;
    invoke<boolean>("brain_previous_session_crashed")
      .then((crashed) => {
        if (crashed) setAsk(true);
      })
      .catch(() => {
        // The question is best effort: a command that cannot answer asks
        // nothing rather than showing a crash prompt for an unknown past.
      });
  }, []);
  useEffect(() => {
    if (previous.current === "running" && kind === "failed") setAsk(true);
    previous.current = kind;
  }, [kind]);
  const dismiss = useCallback(() => setAsk(false), []);
  return { ask, dismiss };
}
