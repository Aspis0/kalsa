import type { SurfaceKey } from "../app/surfaces";
import { useLanguage } from "../i18n/useLanguage";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { KalsaMark } from "./KalsaMark";
import "./Rail.css";

interface RailItem {
  key: SurfaceKey;
  label: string;
  icon: IconName;
}

// The page each surface lights in the rail: Your AI and For experts are
// reached from Home, so Home stays lit on them.
function railKey(surface: SurfaceKey): SurfaceKey {
  return surface === "models" || surface === "experts" ? "brain" : surface;
}

/** The app's one navigation: the same six places on every page. */
export function Rail({ current, onOpen }: { current: SurfaceKey; onOpen: (surface: SurfaceKey) => void }) {
  const { table } = useLanguage();
  const chrome = table.chrome;
  const top: RailItem[] = [
    { key: "brain", label: chrome.home, icon: "power" },
    { key: "chat", label: chrome.chat, icon: "chat" },
    { key: "room", label: chrome.room, icon: "users" },
    { key: "settings", label: chrome.settings, icon: "settings" },
  ];
  const bottom: RailItem[] = [
    { key: "help", label: chrome.pages.help, icon: "help" },
    { key: "devices", label: chrome.pages.devices, icon: "phone" },
  ];
  const lit = railKey(current);

  const item = ({ key, label, icon }: RailItem) => (
    <button
      type="button"
      key={key}
      className="rail-item"
      data-surface={key}
      aria-current={key === lit ? "page" : undefined}
      onClick={() => onOpen(key)}
    >
      <span className="rail-icon">
        <Icon name={icon} size={24} />
      </span>
      {label}
    </button>
  );

  return (
    <nav className="rail" aria-label={chrome.navigation}>
      <span className="rail-mark" aria-hidden="true">
        <KalsaMark size={22} />
      </span>
      {top.map(item)}
      <div className="rail-low">{bottom.map(item)}</div>
    </nav>
  );
}
