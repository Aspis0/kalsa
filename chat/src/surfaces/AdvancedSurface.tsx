import { AdvancedPanel, type AdvancedDto, type AdvancedSaveInput } from "../components/AdvancedPanel";
import { SamplingPanel } from "../components/SamplingPanel";
import { invoke } from "../lib/tauri";
import "./surfaces.css";

// The Advanced surface: the same panel the Models surface owns, standing alone,
// sending all three launch controls back to the start command.
export function AdvancedSurface() {
  return (
    <div className="surface-page">
      <AdvancedPanel
        save={(changes: AdvancedSaveInput) => invoke<AdvancedDto>("brain_set_advanced", changes)}
      />
      <SamplingPanel />
    </div>
  );
}
