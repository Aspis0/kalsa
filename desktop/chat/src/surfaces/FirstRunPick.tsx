import { useState } from "react";
import { AiChoiceCard } from "../components/AiChoiceCard";
import { useLanguage } from "../i18n/useLanguage";
import { modelByMaker, modelOnly } from "../lib/modelName";
import { rankOptions } from "./AiChoices";
import "./BrainSurface.css";
import "./FirstRun.css";

/** One of `brain_test`'s answers: the chooser's pick first, the second option after it. */
export interface Suggestion {
  id: string;
  name: string;
  // What downloading this model costs, as one number: its file plus the
  // drafter its row ships beside it. `drafter` says whether a second file
  // comes with the first.
  download_bytes: number;
  drafter: boolean;
  on_disk: boolean;
  /** The second option's comparison with the first (capability.rs `reason_message`). */
  reason_code?: string | null;
}

const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Step 1 of 2 (mockups 04-first-run-pick, 13-first-run-pick-on-disk): the
    cards as one radio group, the chooser's pick selected and recommended. */
export function FirstRunPick({ options, onContinue }: { options: Suggestion[]; onContinue: (option: Suggestion) => void }) {
  const { table } = useLanguage();
  const t = table.setup;
  const [selected, setSelected] = useState(options[0].id);
  const ranked = rankOptions(options[0], options[1] ?? null);
  const chosen = options.find((option) => option.id === selected) ?? options[0];
  return (
    <>
      <p className="first-run-step">{t.stepOf(1, 2)}</p>
      <h1>{t.pickModel}</h1>
      <p className="first-run-sub">{t.pickLine}</p>
      <div
        className="first-run-cards"
        role="radiogroup"
        aria-label={t.pickModel}
        onKeyDown={(event) => {
          // A radio group moves with the arrows, as native radios do.
          const step = ARROWS[event.key];
          if (step === undefined) return;
          event.preventDefault();
          const at = ranked.findIndex(({ option }) => option.id === selected);
          const next = ranked[(at + step + ranked.length) % ranked.length].option;
          setSelected(next.id);
          const cards = event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]');
          cards[ranked.findIndex(({ option }) => option.id === next.id)]?.focus();
        }}
      >
        {ranked.map(({ kind, option }) => (
          <AiChoiceCard
            key={option.id}
            kind={kind}
            name={modelOnly(option.name)}
            model={modelByMaker(table.machine, option.name)}
            needsBytes={option.download_bytes}
            onDisk={option.on_disk}
            chosen={option.id === selected}
            chip={option.id === options[0].id ? t.recommended : undefined}
            onSelect={() => setSelected(option.id)}
          />
        ))}
      </div>
      <button type="button" className="brain-go first-run-continue" onClick={() => onContinue(chosen)}>
        {t.continue}
      </button>
    </>
  );
}
