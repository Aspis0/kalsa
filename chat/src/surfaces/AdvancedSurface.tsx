import { useState } from "react";
import { AdvancedPanel, type AdvancedDto, type AdvancedSaveInput } from "../components/AdvancedPanel";
import { SamplingPanel } from "../components/SamplingPanel";
import { available, invoke } from "../lib/tauri";
import { useLanguage } from "../i18n/useLanguage";
import "./surfaces.css";

// The Advanced surface: the same panel the Models surface owns, standing alone,
// sending all three launch controls back to the start command.
export function AdvancedSurface({
  model,
  onModelChange,
}: {
  model: string;
  onModelChange: (model: string) => void;
}) {
  return (
    <div className="surface-page">
      <AdvancedPanel
        save={(changes: AdvancedSaveInput) => invoke<AdvancedDto>("brain_set_advanced", changes)}
        model={model}
        onModelChange={onModelChange}
      />
      <SamplingPanel />
      <LogFolderSection />
    </div>
  );
}

/** The log folder, for the tester far from us: one button opens it, one line
    says which files to send. */
function LogFolderSection() {
  const { table } = useLanguage();
  const t = table.advanced;
  const [failed, setFailed] = useState(false);
  if (!available()) return null;
  async function open(): Promise<void> {
    try {
      await invoke("brain_open_log_folder");
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  return (
    <div className="log-folder">
      <div className="surface-actions">
        <button type="button" className="btn-primary" onClick={() => void open()}>
          {t.openLogFolder}
        </button>
      </div>
      {failed ? (
        <p className="surface-note">{t.openFailed}</p>
      ) : null}
      <p className="surface-quiet">{t.logFolderHelp}</p>
    </div>
  );
}
