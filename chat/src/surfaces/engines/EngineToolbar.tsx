import { Icon } from "../../components/Icon";
import type { FilterState } from "./model";
import type { EnginesView } from "./types";

/** Search, licence and display order live above the results, as in the mock. */
export function EngineToolbar({
  detail,
  detailTitle,
  filter,
  view,
  licenses,
  onFilter,
  onBack,
}: {
  detail: boolean;
  detailTitle: string;
  filter: FilterState;
  view: EnginesView;
  licenses: string[];
  onFilter: (next: FilterState) => void;
  onBack: () => void;
}) {
  return (
    <header className={`eg-toolbar${detail ? " det" : ""}`}>
      <button type="button" className="eg-back back" onClick={onBack} aria-label="Back to Engines">
        <Icon name="left" size={16} />
        Engines
      </button>
      <span className="eg-title">{detail ? detailTitle : ""}</span>
      <label className="eg-search" aria-label="Search engines">
        <Icon name="search" size={14} />
        <input
          type="search"
          value={filter.query}
          aria-label="Search engines"
          placeholder="Search"
          autoComplete="off"
          onChange={(event) => onFilter({ ...filter, query: event.target.value })}
        />
      </label>
      <select
        className="eg-select"
        aria-label="Licence"
        value={filter.license}
        onChange={(event) => onFilter({ ...filter, license: event.target.value })}
      >
        <option value="all">Any licence</option>
        {licenses.map((license) => <option key={license}>{license}</option>)}
      </select>
      <select
        className="eg-select"
        aria-label="Sort"
        value={filter.sort}
        onChange={(event) => onFilter({ ...filter, sort: event.target.value as FilterState["sort"] })}
      >
        <option value="rank">Best for this Mac</option>
        <option value="gain">Biggest gain</option>
        <option value="name">Name</option>
      </select>
      <span className="visually-hidden">{view.engines.length} engines in the catalog</span>
    </header>
  );
}
