import { useCallback, useEffect, useRef, useState } from "react";
import { available, invoke } from "../lib/tauri";

/** Which crash the prompt is asking about: the previous session not
    closing normally, or the engine dying under a running app. The two ask
    with different words but the same card. */
export type CrashAsk = "unclean" | "engine";

/** The stable code a Stop the owner asked for leaves behind when it could
    not be confirmed: that failure follows the owner's own gesture, its
    sentence is already on screen, and it must not raise the crash prompt.
    Every other code reaching `failed` out of `running` is a death nobody
    asked for. */
const UNCONFIRMED_STOP = "startup.stop_unconfirmed";

/** The crash prompt's two asks, on the channels that already exist:
    whether the previous session closed normally (asked once, on the first
    mount, through the command that clears the flag), and whether the
    engine died under a running app (watched on the same state poll every
    status line reads — `running` falling to `failed`, and not to the
    unconfirmed-stop code that follows an owner's own Stop). "Not now"
    dismisses for the rest of the session: a second death does not re-ask
    someone who already said no. */
export function useCrashAsk(
  kind: string | null,
  reasonCode: string | null,
): { ask: CrashAsk | null; dismiss: () => void } {
  const [ask, setAsk] = useState<CrashAsk | null>(null);
  const previous = useRef<string | null>(null);
  const dismissed = useRef(false);
  useEffect(() => {
    if (!available() || dismissed.current) return;
    invoke<boolean>("brain_previous_session_crashed")
      .then((crashed) => {
        if (crashed && !dismissed.current) setAsk("unclean");
      })
      .catch(() => {
        // The question is best effort: a command that cannot answer asks
        // nothing rather than showing a crash prompt for an unknown past.
      });
  }, []);
  useEffect(() => {
    const died =
      previous.current === "running" &&
      kind === "failed" &&
      reasonCode !== UNCONFIRMED_STOP;
    if (died && !dismissed.current) setAsk("engine");
    previous.current = kind;
  }, [kind, reasonCode]);
  const dismiss = useCallback(() => {
    dismissed.current = true;
    setAsk(null);
  }, []);
  return { ask, dismiss };
}
