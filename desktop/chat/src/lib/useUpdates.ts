// One update state for the whole page: the Settings block and the startup
// notice read the same thing, so an install started from either one is the
// same install.

import { useCallback, useEffect, useReducer } from "react";
import { appVersion, checkForUpdate, installUpdate, onUpdateAvailable, onUpdateProgress } from "./update";
import type { UpdateErrorPayload } from "./update";
import { INITIAL_UPDATE, reduceUpdate } from "./updateState";
import type { UpdateState } from "./updateState";

export interface UpdatesApi {
  state: UpdateState;
  check: () => void;
  /** Starts the install of `version`. Refused while a reply is being written. */
  install: (version: string) => void;
  dismissNotice: () => void;
}

function asError(error: unknown, fallbackCode: string): UpdateErrorPayload {
  const shaped = error as Partial<UpdateErrorPayload> | null;
  if (shaped && typeof shaped.code === "string") return shaped as UpdateErrorPayload;
  return { code: fallbackCode, text: "" };
}

export function useUpdates(busy: boolean): UpdatesApi {
  const [state, dispatch] = useReducer(reduceUpdate, INITIAL_UPDATE);

  useEffect(() => {
    let live = true;
    const stops: Array<() => void> = [];
    const keep = (stop: () => void) => {
      if (live) stops.push(stop);
      else stop();
    };
    appVersion().then(version => { if (live) dispatch({ type: "version", version }); }, () => {});
    onUpdateProgress(progress => dispatch({ type: "progress", ...progress })).then(keep, () => {});
    onUpdateAvailable(update => dispatch({ type: "announced", update })).then(keep, () => {});
    return () => {
      live = false;
      stops.forEach(stop => stop());
    };
  }, []);

  const check = useCallback(() => {
    dispatch({ type: "checkStarted" });
    checkForUpdate().then(
      status => dispatch({ type: "checkFinished", status }),
      error => dispatch({ type: "failed", error: asError(error, "update.check_failed") }),
    );
  }, []);

  const install = useCallback((version: string) => {
    if (busy) return;
    dispatch({ type: "installStarted", version });
    installUpdate(version).catch(error => {
      const failure = asError(error, "update.install_failed");
      // `failed` first: a check is not taken while a download is shown. The
      // release rides along so a refused install can be offered again.
      dispatch({ type: "failed", error: failure, version });
      // The release moved since it was shown: check again, and let the page
      // offer what is newest now rather than show a stale failure.
      if (failure.code === "update.changed") check();
    });
  }, [busy, check]);

  const dismissNotice = useCallback(() => dispatch({ type: "noticeDismissed" }), []);

  return { state, check, install, dismissNotice };
}
