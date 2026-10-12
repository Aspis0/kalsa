import { useLanguage } from "../i18n/useLanguage";
import type { SurfaceKey } from "../app/surfaces";
import { Icon } from "../components/Icon";
import type { IconName } from "../components/Icon";
// ONE declaration of `brain_state`'s answer, shared with the poll every other
// surface reads. A local copy of `kind` here is how "stopping" was read as
// "could not tell": the DTO moved and this page's second declaration did not.
import { useBrain } from "./useBrain";
import { useCapability } from "./useCapability";
import { reasonSentence, refusalSentence } from "./MachineCard";
import { AiChoices, inUseOption, rankOptions } from "./AiChoices";
import { AiDetails } from "./AiDetails";
import type { AdvancedDto } from "../components/AdvancedPanel";
import { available, invoke } from "../lib/tauri";
import { modelOnly } from "../lib/modelName";
import { useEffect, useState } from "react";
import "../components/NoticeBanner.css";
import "./surfaces.css";
import "./AiPage.css";

/** What the page says about Kalsa's state when it is not simply on. */
interface StateNotice {
  icon: IconName;
  sentence: string;
  turnOn: boolean;
}

// Your AI (mockup 07-ai-page): which of the two choices Kalsa uses, the switch
// between them, the figures behind Details, and the way into For experts. The
// chooser remains in Rust; this page reads its answer.
export function ModelsSurface({ onNavigate }: { onNavigate: (surface: SurfaceKey) => void }) {
  const { table } = useLanguage();
  const t = table.machine;
  // The one shared poll answers this page too: a second interval here was a
  // second brain_state every 2 s beside the shell's own, and the two could
  // disagree for a tick.
  const { state, busy, heldFailure, chooseModel } = useBrain();
  const { capability } = useCapability(state, busy);
  const running = state?.kind === "running" ? state : null;

  // The launch's own context split, read from the same answer For experts
  // shows, so the two pages can never quote a different chat length. Reread
  // when the machine turns on or off: the running engine's seats and window
  // are not the next start's.
  const [contextSplit, setContextSplit] = useState<{ perSlot: number; slots: number } | null>(null);
  useEffect(() => {
    if (!available()) return;
    let live = true;
    invoke<AdvancedDto>("brain_advanced")
      .then((dto) => {
        if (live && dto.context_tokens != null && dto.parallel >= 1) {
          setContextSplit({ perSlot: Math.floor(dto.context_tokens / dto.parallel), slots: dto.parallel });
        }
      })
      .catch(() => {
        // No answer yet: Details simply keeps the rows it already has.
      });
    return () => {
      live = false;
    };
  }, [state?.kind]);

  let notice: StateNotice | null = null;
  if (!state) {
    notice = { icon: "alert", sentence: t.couldNotCheck, turnOn: false };
  } else {
    switch (state.kind) {
      case "running":
        break;
      case "stopping":
        // The drain, in this page's own subject — NOT the "could not tell"
        // sentence: the poll has just said exactly what is happening.
        notice = { icon: "power", sentence: table.power.puttingAway, turnOn: false };
        break;
      case "starting":
        notice = { icon: "power", sentence: t.startingSentence, turnOn: false };
        break;
      case "failed":
      case "stopped":
        notice = { icon: "power", sentence: t.offSentence, turnOn: true };
        break;
      default: {
        // Exhaustive over the shared `kind`: a state the wire grows without
        // this page is a COMPILE error here, never a sentence this page invents.
        const unreachable: never = state.kind;
        notice = unreachable;
      }
    }
  }

  const measured = capability?.kind === "measured" ? capability : null;
  const options = measured?.model ? rankOptions(measured.model, measured.quicker) : [];
  const inUse = inUseOption(options, running?.model || null, measured?.chosen_id ?? null);
  // The name to say when no card is the one in use.
  const inUseName = running?.model || (capability && capability.kind !== "migrating" ? capability.chosen_model : null);
  const metrics = running?.metrics;
  const tokensPerSecond = typeof metrics?.decode_tokens_per_second === "number" ? metrics.decode_tokens_per_second : null;
  // A phone, not this computer: the host's own chat runs through the same
  // door. No list is "no door to ask", which is not "nobody".
  const phones = metrics?.active_devices ? metrics.active_devices.filter((device) => device.kind !== "host").length : null;

  return (
    <div className="surface-page ai-page">
      <button type="button" className="surface-back" onClick={() => onNavigate("brain")}>
        <Icon name="left" size={16} stroke={2.2} />
        {table.chrome.home}
      </button>
      <h2>{t.howItThinks}</h2>
      {inUse ? (
        <p className="ai-lead">{inUse.kind ? t.lead[inUse.kind] : t.running(modelOnly(inUse.option.name))}</p>
      ) : inUseName ? (
        <p className="ai-lead">{t.running(inUseName)}</p>
      ) : null}
      {notice ? (
        <div className="notice-banner ai-notice">
          <span className="notice-banner-icon">
            <Icon name={notice.icon} size={20} />
          </span>
          <div className="notice-banner-text">
            <span className="surface-sentence">{notice.sentence}</span>
          </div>
          {notice.turnOn ? (
            <button type="button" className="ai-turn-on" onClick={() => onNavigate("brain")}>
              <Icon name="power" size={18} />
              {t.turnKalsaOn}
            </button>
          ) : null}
        </div>
      ) : null}
      {options.length > 0 ? (
        <AiChoices
          options={options}
          inUse={inUse}
          running={running !== null}
          busy={busy}
          onChoose={(token) => {
            // The walk shows on Home: brain_start answers only when the walk ends.
            onNavigate("brain");
            void chooseModel(token);
          }}
        />
      ) : capability?.kind === "measured" ? (
        <p className="surface-quiet">{refusalSentence(t, capability.refusal_code, capability.refusal)}</p>
      ) : capability ? (
        <p className="surface-quiet">{t.notMeasured}</p>
      ) : null}
      {/* A switch that failed says why here, where it was asked for. */}
      {heldFailure ? (
        <p className="surface-note" role="alert">
          {heldFailure}
        </p>
      ) : null}
      <AiDetails
        option={inUse?.option ?? null}
        tokensPerSecond={tokensPerSecond}
        phones={phones}
        contextSplit={contextSplit}
        reason={running ? (running.reason ? reasonSentence(t, running.reason_code, running.reason) : t.fallbackReason) : null}
      />
      <button type="button" className="ai-experts" onClick={() => onNavigate("experts")}>
        <span>
          <Icon name="settings" size={17} />
          {t.forExperts}
        </span>
        <em>{t.forExpertsLink} ›</em>
      </button>
    </div>
  );
}
