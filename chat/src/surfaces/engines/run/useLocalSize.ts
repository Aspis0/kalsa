import { useEffect, useState } from "react";
import { invoke } from "../../../lib/tauri";
import { isLocalPath } from "./modelWarning";

const WAIT_MS = 300;

/** The size of a typed local path, asked of Rust after the typing pauses. Null when it is not a path or cannot be read. */
export function useLocalSize(entry: string): number | null {
  const [size, setSize] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setSize(null);
    if (!isLocalPath(entry)) return undefined;
    const timer = setTimeout(() => {
      invoke<number | null>("model_size", { path: entry })
        .then((bytes) => {
          if (live) setSize(bytes);
        })
        .catch(() => {
          if (live) setSize(null);
        });
    }, WAIT_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [entry]);

  return size;
}
