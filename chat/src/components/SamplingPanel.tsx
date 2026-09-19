import { useEffect, useMemo, useState } from "react";
import {
  fetchSamplingDefaultsWithStatus,
  serverBase,
  type SamplingDefaultsStatus,
} from "../lib/chat";
import { SAMPLING_KNOBS } from "../lib/knobs/sampling";
import type { SamplingKnob } from "../lib/knobs/types";
import { loadSampling, samplingProblem, saveSampling } from "../lib/sampling";
import type { Sampling } from "../lib/sampling";
import { loadSettings } from "../lib/settings";
import { loadThinking, saveThinking, thinkingSupport } from "../lib/thinking";
import type { ThinkingSupport } from "../lib/thinking";
import { useBrainServer, withBrainDefaults } from "../surfaces/useBrain";
import { KnobInfo, KnobInfoScope } from "./KnobInfo";
import "./SamplingPanel.css";

function blankDefaults(): Sampling {
  return Object.fromEntries(SAMPLING_KNOBS.map(({ wire }) => [wire, null]));
}

function finiteValue(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function displayNumber(value: number): string {
  return String(Number(value.toPrecision(7)));
}

type DefaultsStatus = SamplingDefaultsStatus | "loading" | "not-configured";

/**
 * Silence is not yet a failure. A fresh server starts answering only after it
 * has loaded the model, which on a large one is well over a minute, and the
 * app reaches this page while that is still happening. So the first read is
 * expected to find nothing, and the panel keeps asking while the answer is
 * silence: one second, then doubling up to a cap, until the budget runs out —
 * only then does the line stop saying it is being read and report the silence.
 */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 16_000;
const RETRY_BUDGET_MS = 60_000;

function statusLine(status: DefaultsStatus): string | null {
  if (status === "unavailable") return "Automatic could not be read because the server did not answer.";
  if (status === "refused") return "Automatic could not be read because the server refused the request.";
  if (status === "invalid") return "Automatic could not be read because the server returned an unexpected response.";
  if (status === "not-configured") return "Automatic will appear after a server is configured.";
  if (status === "loading") return "Automatic is being read from the server.";
  return null;
}

function automaticLine(row: SamplingKnob, defaults: Sampling, status: DefaultsStatus): string {
  const unavailable = statusLine(status);
  if (unavailable) return unavailable;
  const value = finiteValue(defaults[row.wire]);
  if (value !== null && row.automaticSentinels?.includes(value)) {
    return row.automaticDescription ?? "Automatic uses the server's random setting.";
  }
  return value === null
    ? "Automatic leaves it to the server, which has not said which value it uses."
    : `Automatic is ${displayNumber(value)} — the server's own value.`;
}

export function SamplingPanel(): JSX.Element {
  // The owner's typed endpoint wins; the running brain's own endpoint fills the
  // blank. On a normal install nothing is typed while the machine is serving,
  // so reading only the typed field left every row saying no server existed.
  // Read before the state below, because one of those states starts from the
  // model the request will name.
  const brainServer = useBrainServer();
  const settings = withBrainDefaults(loadSettings(), brainServer);
  const endpoint = settings.endpoint.trim();
  const token = settings.token;

  const [sampling, setSampling] = useState<Sampling>(() => loadSampling());
  const [defaults, setDefaults] = useState<Sampling>(() => blankDefaults());
  const [defaultsStatus, setDefaultsStatus] = useState<DefaultsStatus>("not-configured");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  // What this model's own chat template can read. Null until `/props` has
  // answered: no control before the model has said it has one.
  const [support, setSupport] = useState<ThinkingSupport | null>(null);
  const [thinking, setThinking] = useState<boolean>(() => loadThinking(settings.model));
  const groups = useMemo(
    () => Array.from(new Set(SAMPLING_KNOBS.map(({ group }) => group))),
    [],
  );

  useEffect(() => {
    if (!endpoint) {
      setDefaultsStatus("not-configured");
      return undefined;
    }
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setDefaultsStatus("loading");
    const deadline = Date.now() + RETRY_BUDGET_MS;

    // Only silence is retried. `refused` and `invalid` are answers from a
    // server that is there, and asking it again would be hammering it.
    async function read(delay: number): Promise<void> {
      const result = await fetchSamplingDefaultsWithStatus(serverBase(endpoint), 8000, token);
      if (!alive) return;
      if (result.status !== "unavailable" || Date.now() + delay > deadline) {
        setDefaults(result.values);
        setDefaultsStatus(result.status);
        setSupport(thinkingSupport(result.chatTemplate));
        return;
      }
      retry = setTimeout(() => void read(Math.min(delay * 2, RETRY_MAX_MS)), delay);
    }

    void read(RETRY_FIRST_MS);
    return () => {
      // `alive` is false once this run is unmounted or superseded by a newer
      // endpoint, so a late answer cannot overwrite a newer read and the retry
      // timer cannot outlive the run that started it.
      alive = false;
      clearTimeout(retry);
    };
  }, [endpoint, token]);

  /**
   * The template decides whether there is anything to offer, and the choice
   * lands immediately: it is a per-message setting like the knobs, not
   * something behind a Save that could refuse it for an unrelated reason.
   */
  function chooseThinking(enabled: boolean): void {
    setThinking(enabled);
    setFeedback(
      saveThinking(settings.model, enabled)
        ? "Saved. Your next message uses it."
        : "Could not save. Your next message still uses the previous choice.",
    );
  }

  function change(row: SamplingKnob, raw: string): void {
    const value = raw === "" ? null : Number(raw);
    const automaticSentinel = value !== null && row.automaticSentinels?.includes(value);
    setSampling((current) => ({
      ...current,
      [row.wire]: automaticSentinel || value === null || !Number.isFinite(value) ? null : value,
    }));
    setFeedback(null);
  }

  function save(): void {
    const problem = samplingProblem(sampling);
    if (problem) {
      setFeedback(problem);
      return;
    }
    setFeedback(
      saveSampling(sampling)
        ? "Saved. Your next message uses it."
        : "Could not save. Your next message still uses the previously saved values.",
    );
  }

  return (
    <div className="sampling-panel">
      <p className="sampling-eyebrow">MESSAGE SETTINGS</p>
      <p className="sampling-title">Sampling</p>
      <p className="sampling-note">
        Saved choices change the next message you send. Nothing restarts, and the assistant keeps running.
      </p>
      {/* Only what this model's template can read. No template read: no control
          — a switch that moves while nothing changes is worse than none. */}
      {support === null ? null : support.enableThinking ? (
        <label className="sampling-thinking">
          <input
            type="checkbox"
            checked={thinking}
            onChange={(event) => chooseThinking(event.target.checked)}
          />
          <span>Thinking</span>
          <span className="sampling-thinking-note">
            Off asks this model's own template not to think before answering: faster, and it spends no
            tokens on reasoning.
          </span>
        </label>
      ) : support.reasoningEffort ? (
        <p className="sampling-thinking-note">
          This model's template takes a reasoning effort. This app does not set one yet.
        </p>
      ) : null}
      <KnobInfoScope>
        <div className="sampling-groups">
          {groups.map((group) => {
            const groupId = `sampling-group-${group.toLowerCase().replaceAll(" ", "-")}`;
            const rows = SAMPLING_KNOBS.filter((row) => row.group === group);
            const open = openGroup === group;
            return (
              <section className="sampling-group" key={group}>
                <button
                  type="button"
                  className="sampling-group-toggle"
                  aria-expanded={open}
                  aria-controls={groupId}
                  onClick={() => setOpenGroup(open ? null : group)}
                >
                  <span>{group}</span>
                  <span aria-hidden="true">{open ? "−" : "+"}</span>
                </button>
                {open ? (
                  <div className="sampling-group-body" id={groupId}>
                    {rows.map((row) => {
                      const value = finiteValue(sampling[row.wire]);
                      const helpId = `sampling-help-${row.wire}`;
                      return (
                        <div className="sampling-field" key={row.wire}>
                          <div className="sampling-field-heading">
                            <label htmlFor={`sampling-${row.wire}`}>{row.label}</label>
                            <KnobInfo knob={row} />
                          </div>
                          <input
                            id={`sampling-${row.wire}`}
                            type="number"
                            min={row.min}
                            max={row.max}
                            step={row.step}
                            aria-describedby={helpId}
                            placeholder="Automatic"
                            value={value === null ? "" : String(value)}
                            onChange={(event) => change(row, event.currentTarget.value)}
                          />
                          <p className="sampling-automatic" id={helpId}>{automaticLine(row, defaults, defaultsStatus)}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </KnobInfoScope>
      <div className="sampling-actions">
        <button type="button" className="btn-primary" onClick={save}>
          Save sampling
        </button>
        {feedback ? <p className="sampling-feedback" role="status">{feedback}</p> : null}
      </div>
    </div>
  );
}
