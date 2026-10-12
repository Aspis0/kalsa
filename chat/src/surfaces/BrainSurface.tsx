import { useEffect } from "react";
import type { ReactNode } from "react";
import type { SurfaceKey } from "../app/surfaces";
import type { Capability } from "./MachineCard";
import { FirstRun } from "./FirstRun";
import { PowerButton } from "./PowerButton";
import { FailedWalkScreen, GrowingScreen, ReadyScreen } from "./WalkScreens";
import { drawsTree, useWalkMemory } from "./useWalkMemory";
import type { UpdatesApi } from "../lib/useUpdates";
import { brainWords, useBrain } from "./useBrain";
import type { BrainTone } from "./useBrain";
import { useCapability } from "./useCapability";
import { Icon } from "../components/Icon";
import { modelOnly } from "../lib/modelName";
import { useLanguage } from "../i18n/useLanguage";
import "./surfaces.css";
import "./BrainSurface.css";

// The opening's one automatic attempt to bring the brain up, as a fact of
// this open of the app: it stays pending until the capability read can act
// on it. Module scope, not component state — the brain page unmounts whenever
// the user opens a settings page, and the legacy check can outlive a mount —
// so leaving the page must neither lose the attempt nor spend it twice: a
// second automatic try would override a deliberate turn-off made on the
// Server page.
let automaticStartPending = true;

interface BrainSurfaceProps {
  onNavigate: (surface: SurfaceKey) => void;
  onOpenChat: () => void;
  updates: UpdatesApi;
}

// A first run is a machine with no stored choice. An install from before
// the choice has its model checked first (`migrating`) and may become one.
function firstRun(capability: Capability | null): boolean {
  return capability !== null && capability.kind !== "migrating" && !capability.chosen;
}

// The app's home: the round button and what it says (RULES.md "Power button").
// It also owns the first walk: a machine that reads "stopped" is started here,
// on the spot, so getting ready never waits behind a page. The walk's failures
// are not retried by themselves — they are spoken, and they wait for Try again.
export function BrainSurface({ onNavigate, onOpenChat, updates }: BrainSurfaceProps) {
  const { table } = useLanguage();
  const power = table.power;
  const home = table.home;
  const { state, liveStep, walking, heldFailure, stopFailure, busy, act, chooseModel } = useBrain();
  const { capability, reread } = useCapability(state, busy);
  const { memory: walk, forget: forgetWalk, claim: claimWalk } = useWalkMemory(liveStep);

  useEffect(() => {
    if (!automaticStartPending || !state || capability === null) return;
    if (capability.kind === "migrating") return;
    automaticStartPending = false;
    if (state.kind === "stopped" && !firstRun(capability)) void act();
  }, [state, act, capability]);

  // The read in flight is a blank: nothing on this page is true yet, and
  // "Off" with a button to press would promise a start the first run must
  // not make.
  if (capability === null) {
    return <div className="brain-home" />;
  }

  if (capability.kind === "migrating") {
    return (
      <HomeLayout>
        <PowerButton tone="busy" checking label={table.setup.checkingModel} disabled onPress={() => {}} />
        <h1 className="brain-headline">{table.setup.checkingModel}</h1>
        <p className="brain-sentence">{home.checkingOnce}</p>
      </HomeLayout>
    );
  }

  // The OFF face never shows over a start in flight: busy here is this page's
  // own press, walking is what survives a remount.
  const words = brainWords(state, heldFailure, busy || walking, table);
  const failureDetail = state?.kind === "failed" && state.reason_code ? { code: state.reason_code, text: state.reason ?? "" } : null;

  // A walk that grew the tree, or the first run's, ends on its own screen,
  // ahead of the first run's: a running brain has its choice stored, and the
  // first run hands over here. A failure whose choice was never stored stays
  // the first run's own, whose Try again goes back to the pick.
  if (walk?.ownsEnd && !liveStep && state) {
    if (state.kind === "running") {
      return (
        <ReadyScreen
          memory={walk}
          onStartChat={() => {
            forgetWalk();
            onOpenChat();
          }}
        />
      );
    }
    if ((state.kind === "failed" || heldFailure !== null) && !firstRun(capability)) {
      return (
        <FailedWalkScreen
          memory={walk}
          reason={words.sentence}
          detail={failureDetail}
          busy={busy}
          onRetry={() => void act()}
        />
      );
    }
  }

  // The first run owns the page until a model is picked.
  if (firstRun(capability)) {
    return (
      <FirstRun
        capability={capability}
        liveStep={liveStep}
        walk={walk}
        failureDetail={failureDetail}
        starting={state?.kind === "starting"}
        updates={updates}
        onChoose={(token) => {
          // chooseModel forgets the previous walk as it begins, so the claim
          // for this one is taken after that.
          const started = chooseModel(token);
          claimWalk();
          return started;
        }}
        onChecked={reread}
      />
    );
  }

  // A walk that downloaded or tuned keeps the tree to its end; a start
  // that only decides and loads stays on Home.
  if (liveStep && (walk?.ownsEnd || drawsTree(liveStep))) {
    return <GrowingScreen step={liveStep} reach={walk?.reach ?? 0} />;
  }

  // A refused turn-off takes the words, on the page the button was pressed on:
  // the server is still running, and only closing the window stops it.
  const tone: BrainTone = stopFailure ? "problem" : words.tone;
  const press = (): void => void act();
  const hints: Record<BrainTone, string | null> = {
    on: power.pressToTurnOff,
    rest: power.pressToTurnOff,
    off: power.pressToTurnOn,
    problem: power.pressToTryAgain,
    busy: null,
    unknown: null,
  };
  const hint = stopFailure ? null : hints[tone];
  const running = state?.kind === "running" ? state : null;
  // What runs now, or what will run at the next start while Kalsa is off.
  const usingModel = running?.model || capability.chosen_model;

  let action: ReactNode = null;
  if (!stopFailure && (tone === "on" || tone === "rest")) {
    action = (
      <button type="button" className="brain-go" onClick={onOpenChat}>
        <Icon name="chat" size={22} stroke={2} />
        {home.startChat}
      </button>
    );
  } else if (!stopFailure && (tone === "problem" || tone === "unknown")) {
    action = (
      <button type="button" className="brain-go" disabled={busy} onClick={press}>
        <Icon name="refresh" size={21} stroke={2.2} />
        {words.button}
      </button>
    );
  }

  return (
    <HomeLayout>
      <PowerButton tone={tone} label={words.button} disabled={!words.enabled || busy} onPress={press} />
      {hint ? <p className="brain-hint">{hint}</p> : null}
      <h1 className="brain-headline">{stopFailure ? power.stopFailed : words.headline}</h1>
      <p className="brain-sentence">{stopFailure ? power.stopFailure : words.sentence}</p>
      {running?.metrics?.throttled === true && !stopFailure ? (
        <p className="brain-note">
          <Icon name="alert" size={20} />
          <span>{power.throttled}</span>
        </p>
      ) : null}
      {action}
      {tone !== "unknown" ? (
        <p className="brain-using">
          {usingModel ? home.using(modelOnly(usingModel)) : null}
          <button type="button" className="brain-details" onClick={() => onNavigate("models")}>
            {home.details} <span aria-hidden="true">›</span>
          </button>
        </p>
      ) : null}
    </HomeLayout>
  );
}

function HomeLayout({ children }: { children: ReactNode }) {
  const { table } = useLanguage();
  return (
    <div className="brain-home">
      <div className="brain-center">{children}</div>
      <p className="brain-foot">
        <Icon name="lock" size={16} />
        {table.settings.lede}
      </p>
    </div>
  );
}
