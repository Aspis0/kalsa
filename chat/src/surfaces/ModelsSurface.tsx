import { useEffect, useState } from "react";
import type { SurfaceKey } from "../app/surfaces";
import { Icon } from "../components/Icon";
import { useLanguage } from "../i18n/useLanguage";
import { available, invoke } from "../lib/tauri";
import { MachineCard } from "./MachineCard";
import type { MachineInfo } from "./MachineCard";
import "./surfaces.css";
import "./AiPage.css";

/** The engines page's shell. M0 reads the machine through the one Rust
    command; the catalog and engine cards arrive in M1 and M2. */
export function ModelsSurface({ onNavigate }: { onNavigate: (surface: SurfaceKey) => void }) {
  const { table } = useLanguage();
  const [machine, setMachine] = useState<MachineInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!available()) {
      setFailed(true);
      return;
    }
    let live = true;
    invoke<MachineInfo>("brain_machine")
      .then((answer) => {
        if (live) setMachine(answer);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="surface-page ai-page">
      <button type="button" className="surface-back" onClick={() => onNavigate("chat")}>
        <Icon name="left" size={16} stroke={2.2} />
        {table.chrome.chat}
      </button>
      <h2>{table.machine.howItThinks}</h2>
      {machine ? <MachineCard machine={machine} /> : null}
      {failed ? <p className="surface-quiet">{table.machine.couldNotCheck}</p> : null}
      <p className="surface-quiet">{table.machine.noEngines}</p>
    </div>
  );
}
