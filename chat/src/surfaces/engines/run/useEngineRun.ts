import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, subscribe } from "../../../lib/tauri";
import { lastModel, rememberModel } from "./lastModel";
import type { EngineStatus, InstallProgress, Phase, StatusEvent } from "./types";

const POLL_STARTING_MS = 1000;
const POLL_RUNNING_MS = 5000;

function phaseFor(status: EngineStatus, model: string | null): Phase {
  switch (status.state) {
    case "notInstalled":
      return { kind: "notInstalled" };
    case "installed":
      return { kind: "installed" };
    case "starting":
      return { kind: "starting", model };
    case "running":
      return { kind: "running", model };
    default:
      return { kind: "exited", model };
  }
}

export interface EngineRun {
  phase: Phase;
  status: EngineStatus | null;
  install: () => void;
  uninstall: () => void;
  start: (model: string) => void;
  stop: () => void;
  refresh: () => void;
}

/** One engine's run state: the backend's status, its events, and a poll while it starts or runs.
    Every async result is dropped if the page has moved on, and every listener and timer is cleaned up. */
export function useEngineRun(engineId: string): EngineRun {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const session = useRef({ live: true });

  const apply = useCallback(
    (next: EngineStatus) => {
      setStatus(next);
      setPhase((current) => (current.kind === "installing" ? current : phaseFor(next, lastModel(engineId))));
    },
    [engineId],
  );

  const fail = useCallback((what: "install" | "start" | "uninstall", error: unknown) => {
    setPhase({ kind: "failed", what, message: error instanceof Error ? error.message : String(error) });
  }, []);

  const refresh = useCallback(() => {
    const mine = session.current;
    invoke<EngineStatus>("engine_status", { id: engineId })
      .then((next) => {
        if (mine.live) apply(next);
      })
      .catch((error: unknown) => {
        if (mine.live) fail("start", error);
      });
  }, [engineId, apply, fail]);

  useEffect(() => {
    const mine = { live: true };
    session.current = mine;
    setPhase({ kind: "loading" });
    setStatus(null);
    refresh();
    const offProgress = subscribe<InstallProgress>("engine-install-progress", (progress) => {
      if (!mine.live || progress.id !== engineId) return;
      setPhase((current) => (current.kind === "installing" ? { kind: "installing", progress } : current));
    });
    const offStatus = subscribe<StatusEvent>("engine-status", (event) => {
      if (mine.live && event.id === engineId) refresh();
    });
    return () => {
      mine.live = false;
      offProgress();
      offStatus();
    };
  }, [engineId, refresh]);

  useEffect(() => {
    const every = phase.kind === "starting" ? POLL_STARTING_MS : phase.kind === "running" ? POLL_RUNNING_MS : 0;
    if (every === 0) return undefined;
    const timer = setInterval(refresh, every);
    return () => clearInterval(timer);
  }, [phase.kind, refresh]);

  const settle = useCallback(() => {
    setPhase({ kind: "loading" });
    refresh();
  }, [refresh]);

  const install = useCallback(() => {
    const mine = session.current;
    setPhase({ kind: "installing", progress: null });
    invoke("engine_install", { id: engineId })
      .then(() => mine.live && settle())
      .catch((error: unknown) => mine.live && fail("install", error));
  }, [engineId, settle, fail]);

  const uninstall = useCallback(() => {
    const mine = session.current;
    invoke("engine_uninstall", { id: engineId })
      .then(() => mine.live && settle())
      .catch((error: unknown) => mine.live && fail("uninstall", error));
  }, [engineId, settle, fail]);

  const start = useCallback(
    (model: string) => {
      const mine = session.current;
      rememberModel(engineId, model);
      setPhase({ kind: "starting", model });
      invoke<EngineStatus>("engine_start", { id: engineId, model })
        .then((next) => mine.live && apply(next))
        .catch((error: unknown) => mine.live && fail("start", error));
    },
    [engineId, apply, fail],
  );

  const stop = useCallback(() => {
    const mine = session.current;
    invoke("engine_stop", { id: engineId })
      .then(() => mine.live && refresh())
      .catch((error: unknown) => mine.live && fail("start", error));
  }, [engineId, refresh, fail]);

  return { phase, status, install, uninstall, start, stop, refresh };
}
