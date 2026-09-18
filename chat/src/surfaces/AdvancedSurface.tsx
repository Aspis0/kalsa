import { AdvancedPanel, type AdvancedDto } from "../components/AdvancedPanel";
import { invoke } from "../lib/tauri";
import "./surfaces.css";

// The Advanced surface: the same panel the Model page owns, standing alone,
// sending all three launch controls back to the start command.
export function AdvancedSurface() {
  return (
    <div className="surface-page">
      <AdvancedPanel
        save={(contextTokens, idleUnloadSeconds, internetRoad) =>
          invoke<AdvancedDto>("brain_set_advanced", { contextTokens, idleUnloadSeconds, internetRoad })}
      />
    </div>
  );
}
