/** The backend's shapes, as engine_commands.rs sends them. */

export type BackendState = "notInstalled" | "installed" | "starting" | "running" | "exited" | "crashed";

export interface EngineStatus {
  state: BackendState;
  port: number | null;
  logTail: string[];
  message: string | null;
}

/** The `engine-install-progress` event. `stage` is the engine id for its own download, "uv", "install" or "installed". */
export interface InstallProgress {
  id: string;
  stage: string;
  done: number;
  total: number;
}

/** The `engine-status` event, sent on start and on stop. */
export interface StatusEvent {
  id: string;
  state: BackendState;
  port: number | null;
  message: string | null;
}

/** What the page shows. The backend has no "installing" state: this side tracks it while the install call runs. */
export type Phase =
  | { kind: "loading" }
  | { kind: "notInstalled" }
  | { kind: "installing"; progress: InstallProgress | null }
  | { kind: "installed" }
  | { kind: "starting"; model: string | null }
  | { kind: "running"; model: string | null }
  | { kind: "exited"; model: string | null }
  | { kind: "failed"; what: "install" | "start" | "uninstall"; message: string };
