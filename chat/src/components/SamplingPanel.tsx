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
  const [sampling, setSampling] = useState<Sampling>(() => loadSampling());
  const [defaults, setDefaults] = useState<Sampling>(() => blankDefaults());
  const [defaultsStatus, setDefaultsStatus] = useState<DefaultsStatus>("not-configured");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const groups = useMemo(
    () => Array.from(new Set(SAMPLING_KNOBS.map(({ group }) => group))),
    [],
  );

  useEffect(() => {
    const settings = loadSettings();
    const endpoint = settings.endpoint.trim();
    if (!endpoint) {
      setDefaultsStatus("not-configured");
      return undefined;
    }
    let alive = true;
    setDefaultsStatus("loading");
    void fetchSamplingDefaultsWithStatus(serverBase(endpoint), 8000, settings.token).then((result) => {
      if (alive) {
        setDefaults(result.values);
        setDefaultsStatus(result.status);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

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
