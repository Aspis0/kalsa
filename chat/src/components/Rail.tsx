import type { SurfaceKey } from "../app/surfaces";
import { useLanguage } from "../i18n/useLanguage";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import "./Rail.css";

interface RailItem {
  key: SurfaceKey;
  label: string;
  icon: IconName;
}

export function Rail({ current, onOpen }: { current: SurfaceKey; onOpen: (surface: SurfaceKey) => void }) {
  const { table } = useLanguage();
  const items: RailItem[] = [
    { key: "engines", label: table.chrome.pages.engines, icon: "cpu" },
    { key: "chat", label: table.chrome.chat, icon: "chat" },
    { key: "settings", label: table.chrome.settings, icon: "settings" },
  ];

  return (
    <nav className="rail" aria-label={table.chrome.navigation}>
      <span className="rail-word" aria-hidden="true">Kalsa</span>
      {items.map(({ key, label, icon }) => (
        <button
          key={key}
          type="button"
          className="rail-item"
          data-surface={key}
          aria-current={key === current ? "page" : undefined}
          onClick={() => onOpen(key)}
        >
          <span className="rail-icon">
            <Icon name={icon} size={24} />
          </span>
          {label}
        </button>
      ))}
    </nav>
  );
}
