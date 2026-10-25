import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  cancelDriver,
  cancelledBy,
  driverStatus,
  downloadDriver,
  onDriverProgress,
} from "../../lib/driver";
import { INITIAL_DRIVER, reduceDriver } from "../../lib/driverState";
import { refreshBrowserStatus } from "../../lib/browser/useStatus";
import type { DriverState } from "../../lib/driverState";

export interface DriverApi {
  state: DriverState;
  download: () => void;
  cancel: () => void;
}

/** The driver row's state, shared by the press and the bar above it, so a
    download started from either is the same download.

    A failure is one sentence for the person and a press to try again. Rust
    names the kind of failure in a code, but the row does not branch on it: a
    digest mismatch and a dropped connection are the same thing to someone
    deciding whether to press again, and a driver that will not install is not
    worth a paragraph about why.

    The progress listener belongs to the run that opened it and is closed when
    that run settles. A cancel stops the transfer on its own thread, so its last
    event can still be in flight when the person presses retry; the run number
    the reducer checks is the second line of defence, the listener is the first. */
export function useDriver(): DriverApi {
  const [state, dispatch] = useReducer(reduceDriver, INITIAL_DRIVER);
  // The run this hook is listening for, read inside the listener the press
  // creates. A ref and not the reducer's state: the listener closes over the
  // value at the moment it was opened, which is the whole point.
  const run = useRef(0);

  useEffect(() => {
    let live = true;
    driverStatus().then(
      status => {
        // The row shows what the app's own start-time read found; the row's is
        // for what it may have changed since.
        if (live) dispatch({ type: "checked", ...status });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  const download = useCallback(() => {
    run.current += 1;
    dispatch({ type: "downloadStarted" });
    const mine = run.current;
    let stop: (() => void) | null = null;
    // Subscribing is a promise; until it settles an event has nowhere to go.
    // Nothing is lost: the download has not reported a byte yet, and the first
    // report it does send always goes out whatever the chunk size
    // (commands.rs `worth_reporting`).
    let opening = true;
    onDriverProgress(progress => {
      if (!opening) dispatch({ type: "progress", run: mine, ...progress });
    }).then(found => {
      opening = false;
      if (found) stop = found;
    }, () => {});
    const close = () => {
      opening = false;
      if (stop) stop();
    };
    downloadDriver().then(
      status => {
        close();
        // The driver is installed now, and that is what the chat's tool list
        // turns on. Nothing else knows the answer changed.
        void refreshBrowserStatus();
        dispatch({ type: "finished", ...status });
      },
      error => {
        close();
        dispatch({ type: cancelledBy(error) ? "cancelled" : "failed" });
      },
    );
  }, []);

  const cancel = useCallback(() => {
    // Nothing is done to the bar here. The row stays on the press that was
    // pressed until the transfer has actually stopped, which is when
    // `downloadDriver` settles; a bar that vanished at the click would be a
    // claim the download had stopped, and it has not yet.
    cancelDriver().catch(() => {});
  }, []);

  return { state, download, cancel };
}