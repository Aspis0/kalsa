import { checklistItems, isItemTicked, toggleChecklistItem } from "../../lib/miniapp/state";
import type { Miniapp } from "../../lib/miniapp/types";
import { asText } from "./values";

/**
 * A `checklist` block: one real checkbox per item — keyboard and screen
 * reader come free with the native control — ticked means struck through,
 * and there is no "STEP N". The ticks live in the envelope's `state`, keyed
 * by the item id, so they survive a reload; `onState` writes the next state
 * through to the stored message.
 */

const MAX_ITEMS = 50;

export function Checklist({
  miniapp,
  block,
  onState,
}: {
  miniapp: Miniapp;
  block: Record<string, unknown>;
  onState?: (state: Record<string, unknown>) => void;
}) {
  const items = checklistItems(block).slice(0, MAX_ITEMS);
  const title = asText(block.title);
  return (
    <div className="miniapp-block">
      {title ? <p className="miniapp-block-title">{title}</p> : null}
      <ul className="miniapp-checklist">
        {items.map((item) => {
          const ticked = isItemTicked(miniapp.state, item.id);
          return (
            <li key={item.id}>
              <label className="miniapp-check-item">
                <input
                  type="checkbox"
                  checked={ticked}
                  onChange={(event) =>
                    onState?.(toggleChecklistItem(miniapp.state ?? {}, item.id, event.target.checked))
                  }
                />
                <span className={ticked ? "miniapp-check-title miniapp-check-done" : "miniapp-check-title"}>
                  {item.title}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
