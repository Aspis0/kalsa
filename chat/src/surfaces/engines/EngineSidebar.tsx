import type { EngineMachine } from "./types";
import { chipGeneration, memoryText, VIEWS, viewCount, type ViewKey } from "./model";
import type { EnginesView } from "./types";
import { Icon } from "../../components/Icon";
import type { IconName } from "../../components/Icon";

const TOP: [ViewKey, IconName][] = [
  ["rec", "check"],
  ["runs", "cpu"],
  ["all", "layoutGrid"],
];
const HARDWARE: [ViewKey, string][] = [
  ["hw:apple", "Apple Silicon"],
  ["hw:nvidia", "NVIDIA"],
  ["hw:amd", "AMD"],
  ["hw:intel", "Intel"],
  ["hw:cpu", "CPU"],
];
const KINDS: [ViewKey, string][] = [
  ["kind:reference", "Reference"],
  ["kind:fork", "Forks"],
  ["kind:engine", "Engines"],
];
const BADGES: [ViewKey, string][] = [
  ["badge:reviewed", "Reviewed"],
  ["badge:not-reviewed", "Not reviewed"],
];

function ChipDiagram({ machine }: { machine: EngineMachine }) {
  const count = Math.min(machine.cores ?? 8, 16);
  const cores = Array.from({ length: count }, (_, index) => index);
  const graphics = Array.from({ length: Math.min(count * 2, 18) }, (_, index) => index);
  return (
    <svg viewBox="0 0 196 62" role="img" aria-label="Schematic of this Mac's chip">
      {cores.map((index) => (
        <rect key={`p${index}`} x={(index % 4) * 12} y={Math.floor(index / 4) * 12} width="10" height="10" rx="2" fill="var(--tx)" />
      ))}
      {graphics.map((index) => (
        <rect key={`g${index}`} x={62 + (index % 6) * 22} y={Math.floor(index / 6) * 9} width="19" height="7" rx="2" fill="var(--ac)" opacity={0.35 + (index % 6) * 0.12} />
      ))}
      <path d="M0 41H196" stroke="var(--line)" strokeWidth="1" />
      {Array.from({ length: 16 }, (_, index) => (
        <rect key={`l${index}`} x={index * 12.3} y="46" width="9.5" height="14" rx="2" fill="none" stroke="var(--tx3)" strokeWidth=".9" />
      ))}
    </svg>
  );
}

/** The engines page's own sidebar: machine card and the eight list views. */
export function EngineSidebar({
  view,
  current,
  onOpen,
}: {
  view: EnginesView;
  current: ViewKey;
  onOpen: (key: ViewKey) => void;
}) {
  const machine = view.machine;
  const generation = chipGeneration(machine.chipTag);
  const item = (key: ViewKey, icon: IconName | null, label: string, plain = false) => (
    <button
      key={key}
      type="button"
      className={`eg-nav${plain ? " pl" : ""}${key === "off" ? " dis" : ""}`}
      aria-current={key === current ? "true" : undefined}
      onClick={() => onOpen(key)}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      {label}
      <span className="n num">{viewCount(key, view)}</span>
    </button>
  );

  return (
    <nav className="eg-side" aria-label="Engine library">
      <div className="eg-me">
        <b>{machine.chipName}</b>
        <span className="sp">
          {machine.cores ? `${machine.cores}-core CPU` : "Apple Silicon"}
          {generation ? ` · M${generation}` : ""}
          <br />
          {memoryText(machine.ramBytes)} · macOS
        </span>
        <ChipDiagram machine={machine} />
      </div>
      {TOP.map(([key, icon]) => item(key, icon, VIEWS[key].title))}
      <div className="eg-grp">Hardware</div>
      {HARDWARE.map(([key, label]) => item(key, null, label, true))}
      <div className="eg-grp">Kind</div>
      {KINDS.map(([key, label]) => item(key, null, label, true))}
      <div className="eg-grp">Badge</div>
      {BADGES.map(([key, label]) => item(key, null, label, true))}
      <div className="eg-grp">&nbsp;</div>
      {item("off", "info", VIEWS.off.title)}
    </nav>
  );
}
