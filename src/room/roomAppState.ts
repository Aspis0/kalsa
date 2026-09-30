/**
 * The app lifecycle hook for room streams, in its own module: background
 * pauses every stream (RN stops timers there anyway, so the stream's own
 * are cleared, not relied upon), active reopens each with the
 * Last-Event-ID it kept. The AppState source injects for tests; the
 * default is React Native's, required lazily so importing this module
 * never loads react-native where there is none.
 */
import { pauseRoomStreams, resumeRoomStreams } from "./roomSubscriptions";

export type AppStateSource = {
  addEventListener(
    type: "change",
    handler: (state: string) => void,
  ): { remove(): void };
};

/** Wire background/foreground to the streams; returns the unhook. */
export function bindRoomStreamsToAppState(source?: AppStateSource): () => void {
  const appState =
    source ??
    (require("react-native") as { AppState: AppStateSource }).AppState;
  const subscription = appState.addEventListener("change", (state) => {
    if (state === "background") pauseRoomStreams();
    else if (state === "active") resumeRoomStreams();
    // "inactive" is iOS's transitional state — a stream cut for it would
    // reopen moments later for no reason.
  });
  return () => subscription.remove();
}
