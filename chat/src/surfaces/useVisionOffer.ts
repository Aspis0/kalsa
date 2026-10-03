// The "let Kalsa see images" offer's own state: the projector the launch has
// on the shelf, the ask, the download's progress, and the refusal that
// follows a failure. The chat wires it to the composer and to the image road
// (`useChat`); the card and the walk view it drives are components
// (`components/VisionOffer.tsx`).

import { useEffect, useRef, useState } from "react";
import { invoke } from "../lib/tauri";
import { rustSentence } from "../lib/rustText";
import { offeredBytes, parseVision } from "../lib/vision";
import { useLanguage } from "../i18n/useLanguage";
import { clearWalkStep, useBrainState, useBrainStep } from "./useBrain";
import type { ProgressStep } from "./SetupProgress";
import type { VisionOfferPhase } from "../components/VisionOffer";

export interface VisionOffer {
  /** The size the offer names while it is on the shelf and nothing of the
      flow is on screen: the composer's one quiet affordance. */
  offerBytes: number | null;
  /** What the offer is doing on screen, or null when nothing of it is. */
  flow: VisionOfferPhase | null;
  /** The walk's live step, for the running face's bar. */
  step: ProgressStep | null;
  ask: () => void;
  dismiss: () => void;
  enable: () => Promise<void>;
}

export function useVisionOffer(): VisionOffer {
  const { table, tag } = useLanguage();
  // The launch's own answer, from the one shared poll — never a stored flag,
  // and never a guess from `/props` alone.
  const state = useBrainState();
  const offered = offeredBytes(parseVision(state?.vision));
  const [flow, setFlow] = useState<VisionOfferPhase | null>(null);
  const step = useBrainStep();
  // One download at a time: React batches, so the state that swaps the ask
  // away is not a guard against a double press — and a second run would be
  // refused as a walk already in progress, a refusal for a download nobody
  // asked for twice. The ref is the guard.
  const busy = useRef(false);

  // The restart is the engine leaving `running` and coming back. From that
  // moment the card says so until the command answers.
  useEffect(() => {
    if (state?.kind === "running") return;
    setFlow((current) => (current?.kind === "running" ? { ...current, restarting: true } : current));
  }, [state?.kind]);

  // The offer can leave the shelf under a card that is not downloading — the
  // launch record changed, or another window accepted it. The card goes with
  // it, rather than leaving a retry that can no longer do anything.
  useEffect(() => {
    if (offered !== null) return;
    setFlow((current) => (current === null || current.kind === "running" ? current : null));
  }, [offered]);

  function ask(): void {
    if (offered === null || busy.current) return;
    setFlow((current) => (current?.kind === "asking" ? current : { kind: "asking", bytes: offered }));
  }

  function dismiss(): void {
    setFlow(null);
  }

  /** This command's own refusals in the owner's words: memory that cannot
      hold the projector is this feature's sentence, and everything else the
      command can answer — a download that failed, a disk that filled, a walk
      already claimed — is the rust table's, one row per code; a code newer
      than this build shows Rust's own sentence beside the retry. */
  function sentence(error: unknown): string {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "vision.does_not_fit") return table.vision.doesNotFit;
    return rustSentence(table.rust, error, tag);
  }

  async function enable(): Promise<void> {
    if (busy.current) return;
    const bytes = flow !== null && flow.kind !== "failed" ? flow.bytes : offered;
    if (bytes === null) return;
    busy.current = true;
    // The walk's last step belongs to whatever walked before this download.
    clearWalkStep();
    setFlow({ kind: "running", bytes, restarting: false });
    try {
      await invoke("brain_vision_enable");
      setFlow(null);
    } catch (error) {
      setFlow({ kind: "failed", message: sentence(error) });
    } finally {
      busy.current = false;
    }
  }

  return {
    offerBytes: flow === null ? offered : null,
    flow,
    step,
    ask,
    dismiss,
    enable,
  };
}
