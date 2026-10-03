// The vision offer's three faces, where the owner talks: the ask (once), the
// download's own progress, and a refusal with the one way forward. It sits in
// the flow above the composer like the web-call ask does — the thread stays
// readable behind it — and the progress is `SetupProgress`, the same view the
// walk and the first run render, so the download reads the same everywhere.

import { SetupProgress } from "../surfaces/SetupProgress";
import type { ProgressStep } from "../surfaces/SetupProgress";
import { useLanguage } from "../i18n/useLanguage";
import { downloadBytes } from "../lib/downloadBytes";
import "./VisionOffer.css";

/** What the offer is doing on screen, or nothing (`null` at the call site). */
export type VisionOfferPhase =
  | { kind: "asking"; bytes: number }
  /** `restarting` is the engine coming back — the download has moved its
      last byte and the walk is on its own steps. */
  | { kind: "running"; bytes: number; restarting: boolean }
  | { kind: "failed"; message: string };

export function VisionOffer({
  phase,
  step,
  onDownload,
  onNotNow,
  onRetry,
}: {
  phase: VisionOfferPhase;
  /** The walk's live step, for the download's own bar. */
  step: ProgressStep | null;
  onDownload: () => void;
  onNotNow: () => void;
  onRetry: () => void;
}) {
  const { table, tag } = useLanguage();
  const t = table.vision;

  if (phase.kind === "asking") {
    return (
      <section className="vision-offer" role="alertdialog" aria-modal="false" aria-labelledby="vision-ask">
        <p id="vision-ask">{t.downloadQ(downloadBytes(phase.bytes, tag))}</p>
        <div className="vision-actions">
          <button type="button" className="vision-download" onClick={onDownload} autoFocus>
            {t.download}
          </button>
          <button type="button" className="vision-not-now" onClick={onNotNow}>
            {t.notNow}
          </button>
        </div>
      </section>
    );
  }

  if (phase.kind === "failed") {
    return (
      <section className="vision-offer vision-failed" role="alert">
        <p>{phase.message}</p>
        <div className="vision-actions">
          <button type="button" className="vision-download" onClick={onRetry}>
            {t.tryAgain}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="vision-offer vision-running" role="status" aria-live="polite">
      {phase.restarting ? (
        <p className="vision-restarting">{t.restarting}</p>
      ) : (
        // Before the first step arrives the total is the offer's own figure,
        // so the bar starts at nothing of something rather than spinning.
        <SetupProgress step={step ?? { kind: "model_bytes", done: 0, total: phase.bytes }} />
      )}
    </section>
  );
}
