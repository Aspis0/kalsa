import { useEffect, useState } from "react";

/** Seconds since `key` last changed: the walk's clock for whatever the key
    names — one candidate inside the tune, one phase outside it. A tick a
    second while the reader is mounted, and nothing after it leaves: the
    interval is cleared in the cleanup, never left running. */
export function useElapsed(key: unknown): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [key]);
  return seconds;
}
