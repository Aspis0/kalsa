/** Re-kick a local static-prefix prewarm when the app returns to foreground. */
import type { AppStateStatus } from "react-native";
import type { ModelInfo } from "../engine/ModelRegistry";
import type { EngineTool } from "../engine/LlamaService";
import type { Locale } from "../i18n";

export interface ForegroundPrewarmSnapshot {
  thermalBlocked: boolean;
  remote: boolean;
  model: ModelInfo | null;
  locale: Locale;
  tools?: EngineTool[];
  engineReady: boolean;
  activeModelId: string | null;
}

export interface ForegroundPrewarmPorts {
  subscribe: (
    listener: (state: AppStateStatus) => void,
  ) => { remove: () => void };
  read: () => ForegroundPrewarmSnapshot;
  queue: (locale: Locale, tools?: EngineTool[]) => Promise<void>;
  logSkip: (reason: string) => void;
}

/** Keep the listener small; all state is read when the foreground event fires. */
export function subscribeForegroundPrewarm(ports: ForegroundPrewarmPorts): () => void {
  const subscription = ports.subscribe((state) => {
    if (state !== "active") return;
    void (async () => {
      const current = ports.read();
      if (current.remote) return;
      if (current.thermalBlocked) {
        ports.logSkip("thermal_gate");
        return;
      }
      if (!current.model) {
        ports.logSkip("no_model");
        return;
      }
      if (current.engineReady && current.activeModelId === current.model.id) {
        await ports.queue(current.locale, current.tools);
        return;
      }
      ports.logSkip(current.engineReady ? "model_changed" : "not_ready");
    })().catch(() => undefined);
  });
  return () => subscription.remove();
}
