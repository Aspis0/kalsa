import { useEffect } from "react";
import type { ReactNode } from "react";
import { Icon } from "../components/Icon";
import { useLanguage } from "../i18n/useLanguage";
import { GrowingTree } from "./GrowingTree";
import { SetupProgress } from "./SetupProgress";
import { tuneFace, tuneWait } from "./tuneProgress";
import type { WalkMemory } from "./useWalkMemory";
import { WalkBar } from "./WalkBar";
import { walkPercent } from "./walkFigures";
import { waitWord } from "./walkState";
import type { ProgressStep } from "./walkState";
import "./BrainSurface.css";
import "./FirstRun.css";

const BARE = "data-bare";

/** The whole window, as the first-run mockups draw it: no rail unless the
    owner may need to go elsewhere. The root attribute, set after mount,
    hides the rail (FirstRun.css). */
export function FullWindow({ keepsRail = false, children }: { keepsRail?: boolean; children: ReactNode }) {
  useEffect(() => {
    if (keepsRail) return undefined;
    document.documentElement.setAttribute(BARE, "");
    return () => document.documentElement.removeAttribute(BARE);
  }, [keepsRail]);
  return <div className="first-run">{children}</div>;
}

/** The walk, growing (mockups 06-growing-*, 13-first-run-tuning…). */
export function GrowingScreen({ step, reach = 0 }: { step: ProgressStep; reach?: number }) {
  return (
    <FullWindow>
      <SetupProgress step={step} growing reach={reach} />
    </FullWindow>
  );
}

/** The walk's end and one way on (06-growing-full, 13-first-run-tune-cut). A
    tune the budget stopped stays where it reached — no blossom, no full bar —
    and its line is the stop's own. */
export function ReadyScreen({ memory, onStartChat }: { memory: WalkMemory; onStartChat: () => void }) {
  const { table } = useLanguage();
  const t = table.setup;
  const face = tuneFace(memory.last);
  const stop = face !== null && face.cut ? tuneWait(face, 0, 0, 0) : null;
  const p = stop !== null ? memory.reach : 1;
  return (
    <FullWindow>
      <div className="surface-walk">
        <GrowingTree p={p} />
        <p className="surface-verdict">{t.ready}</p>
        <WalkBar pct={walkPercent(p)} label={t.ready} />
        <p className="walk-line">{stop !== null ? waitWord(stop, t) : t.readyLine}</p>
      </div>
      <div className="walk-actions">
        <button type="button" className="brain-go" onClick={onStartChat}>
          <Icon name="chat" size={22} stroke={2} />
          {table.home.startChat}
        </button>
      </div>
    </FullWindow>
  );
}

/** What the backend said about a failure, beside its sentence: its code and
    its own words, for whoever needs more than the sentence. */
export interface FailureDetail {
  code: string;
  text: string;
}

/** The walk stopped: the tree and the amber bar where it reached, the reason,
    Try again, and the backend's own detail behind Show details
    (13-first-run-failed-*). The rail stays, so Help is reachable. */
export function FailedWalkScreen({
  memory,
  reason,
  detail,
  busy,
  onRetry,
}: {
  memory: Pick<WalkMemory, "last" | "reach">;
  reason: string;
  detail: FailureDetail | null;
  busy: boolean;
  onRetry: () => void;
}) {
  const { table } = useLanguage();
  return (
    <FullWindow keepsRail>
      <SetupProgress step={memory.last} growing reach={memory.reach} failure={reason} />
      <div className="walk-actions">
        <button type="button" className="brain-go" disabled={busy} onClick={onRetry}>
          <Icon name="refresh" size={21} stroke={2.2} />
          {table.setup.tryAgain}
        </button>
      </div>
      {detail !== null ? (
        <details className="walk-details">
          <summary>
            {table.setup.showDetails}
            <Icon name="down" size={15} stroke={2.2} />
          </summary>
          <p>
            <code>{detail.code}</code>
          </p>
          <p>{detail.text}</p>
        </details>
      ) : null}
    </FullWindow>
  );
}
