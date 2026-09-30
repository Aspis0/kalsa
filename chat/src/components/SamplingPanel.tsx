import { useMemo, useState } from "react";
import type { SamplingDefaultsStatus } from "../lib/chat";
import { SAMPLING_KNOBS } from "../lib/knobs/sampling";
import { groupWord, samplingWords, type KnobWords } from "../lib/knobs/words";
import type { SamplingKnob } from "../lib/knobs/types";
import { loadSampling, saveSampling, samplingProblemWords } from "../lib/sampling";
import type { Sampling } from "../lib/sampling";
import { loadSettings } from "../lib/settings";
import { useBrainServer, withBrainDefaults } from "../surfaces/useBrain";
import { useServerFacts } from "../surfaces/useServerFacts";
import { useLanguage } from "../i18n/useLanguage";
import { KnobInfo, KnobInfoScope } from "./KnobInfo";
import "./SamplingPanel.css";

function finiteValue(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type DefaultsStatus = SamplingDefaultsStatus | "loading" | "not-configured";

/**
 * What the automatic read is doing, in one line, or `null` when it has an
 * answer — the row then says what that answer is.
 */
function statusLine(words: KnobWords, status: DefaultsStatus): string | null {
  return status === "unavailable"
    ? words.autoUnreadable
    : status === "refused"
      ? words.autoRefused
      : status === "invalid"
        ? words.autoInvalid
        : status === "not-configured"
          ? words.autoNotConfigured
          : status === "loading"
            ? words.autoLoading
            : null;
}

/** What one row says under its input about the value it would use by itself. */
function automaticLine(words: KnobWords, row: SamplingKnob, defaults: Sampling, status: DefaultsStatus): string {
  const line = statusLine(words, status);
  if (line) return line;
  const value = finiteValue(defaults[row.wire]);
  return value !== null && row.automaticSentinels?.includes(value)
    ? words.autoRandom
    : value === null
      ? words.autoServerDecides
      : words.autoIs(String(Number(value.toPrecision(7))));
}

export function SamplingPanel(): JSX.Element {
  const { table } = useLanguage();
  const words = table.knobs;
  const panel = table.sampling;
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
  const { defaults, status: defaultsStatus } = useServerFacts(endpoint, token);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const groups = useMemo(
    () => Array.from(new Set(SAMPLING_KNOBS.map(({ group }) => group))),
    [],
  );
  // The group names are keys into the words, so the map is per render.
  const groupNames = groups.map((group) => groupWord(words, group));

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
    const problem = samplingProblemWords(words, sampling);
    if (problem) {
      setFeedback(problem);
      return;
    }
    setFeedback(saveSampling(sampling) ? words.saveOk : words.saveFailed);
  }

  return (
    <div className="sampling-panel">
      <p className="sampling-eyebrow">{panel.eyebrow}</p>
      <p className="sampling-title">{panel.title}</p>
      <p className="sampling-note">{panel.note}</p>
      {/* Thinking is not here: it is not a sampler value, it is "answer me now
          instead of reasoning first", worth tens of seconds a message — and it
          lives on the chat's own composer, where the answer is written. */}
      <KnobInfoScope>
        <div className="sampling-groups">
          {groups.map((group, at) => {
            const groupId = `sampling-group-${group}`;
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
                  <span>{groupNames[at]}</span>
                  <span aria-hidden="true">{open ? "−" : "+"}</span>
                </button>
                {open ? (
                  <div className="sampling-group-body" id={groupId}>
                    {rows.map((row) => {
                      const value = finiteValue(sampling[row.wire]);
                      const helpId = `sampling-help-${row.wire}`;
                      const said = samplingWords(words, row);
                      return (
                        <div className="sampling-field" key={row.wire}>
                          <div className="sampling-field-heading">
                            <label htmlFor={`sampling-${row.wire}`}>{said.label}</label>
                            <KnobInfo knob={row} label={said.label} whatItIs={said.whatItIs} whatItsFor={said.whatItsFor} usualValues={said.usualValues} />
                          </div>
                          <input
                            id={`sampling-${row.wire}`}
                            type="number"
                            min={row.min}
                            max={row.max}
                            step={row.step}
                            aria-describedby={helpId}
                            placeholder={words.automaticPlaceholder}
                            value={value === null ? "" : String(value)}
                            onChange={(event) => change(row, event.currentTarget.value)}
                          />
                          <p className="sampling-automatic" id={helpId}>{automaticLine(words, row, defaults, defaultsStatus)}</p>
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
          {panel.saveButton}
        </button>
        {feedback ? <p className="sampling-feedback" role="status">{feedback}</p> : null}
      </div>
    </div>
  );
}
