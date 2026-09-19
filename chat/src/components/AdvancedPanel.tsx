import { useCallback, useEffect, useRef, useState } from "react";
import { available, invoke } from "../lib/tauri";
import { LAUNCH_KNOBS } from "../lib/knobs/launch";
import type { LaunchKnob } from "../lib/knobs/types";
import { AdvancedField } from "./AdvancedField";
import { KnobInfoScope } from "./KnobInfo";
import "./AdvancedPanel.css";
const POLL_MS = 2000;
type CacheType = "q8_0" | "f16";
type CacheChoice = CacheType | "";
/** What `brain_advanced` answers: Rust's launch description, read-only here. */
export interface AdvancedDto {
  context_tokens: number | null;
  context_max: number | null;
  context_max_f16: number | null;
  context_override: number | null;
  idle_unload_seconds: number;
  idle_override: number | null;
  batch_size: number;
  batch_override: number | null;
  batch_automatic: number;
  ubatch_size: number;
  ubatch_override: number | null;
  ubatch_automatic: number;
  kv_cache_type: string;
  kv_cache_override: string | null;
  kv_cache_automatic: string;
  flash_attention: string;
  gpu_layers: string | null;
  threads: number | null;
  door_port: number | null;
  iroh_sentence: string;
  internet_road: boolean;
  running: boolean;
}
export interface AdvancedSaveInput extends Record<string, unknown> {
  contextTokens: number | null;
  idleUnloadSeconds: number | null;
  internetRoad: boolean;
  batchSize: number | null;
  ubatchSize: number | null;
  kvCache: CacheType | null;
}
export interface AdvancedSave {
  (changes: AdvancedSaveInput): Promise<AdvancedDto>;
}

function launchKnob(wire: string): LaunchKnob {
  const knob = LAUNCH_KNOBS.find((candidate) => candidate.wire === wire);
  if (!knob) throw new Error(`Missing launch knob: ${wire}`);
  return knob;
}
const CONTEXT_KNOB = launchKnob("ctx-size");
const BATCH_KNOB = launchKnob("batch-size");
const UBATCH_KNOB = launchKnob("ubatch-size");
const CACHE_KNOB = launchKnob("cache-type-k/cache-type-v");
const IDLE_KNOB = launchKnob("sleep-idle-seconds");
const ROAD_KNOB = launchKnob("internet_road");

/** The idle clock's legible choices, in the wire's own unit (seconds). The two
    ends are the range Rust enforces (`MIN_IDLE_UNLOAD_SECONDS` ..
    `MAX_IDLE_UNLOAD_SECONDS`, mirrored by the knob's min/max and by
    `validate`), the middle is the app's own default. One control over one
    value: the range used to be typed into this file a second time as the
    input's min/max, and a duration is something an owner recognizes rather
    than arithmetic to do. */
const IDLE_CHOICES: readonly { seconds: number; label: string }[] = [
  { seconds: 60, label: "1 minute" },
  { seconds: 300, label: "5 minutes" },
  { seconds: 3600, label: "1 hour" },
];

/** The three choices, plus the value already on file when it is none of them:
    an owner who typed 10 minutes in an earlier build still sees what the
    server is really using, and saving without touching it keeps their value
    rather than silently rounding it to a preset. */
function idleChoices(current: string): readonly { seconds: number; label: string }[] {
  const seconds = Number(current);
  if (current === "" || IDLE_CHOICES.some((choice) => choice.seconds === seconds)) return IDLE_CHOICES;
  const minutes = seconds / 60;
  const label = Number.isInteger(minutes)
    ? minutes === 1
      ? "1 minute"
      : `${minutes} minutes`
    : `${seconds} seconds`;
  return [...IDLE_CHOICES, { seconds, label }].sort((a, b) => a.seconds - b.seconds);
}

function numberOrNull(value: string): number | null {
  if (value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Enter a number.");
  return number;
}
function automaticNumber(value: number | null | undefined, label: string): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `Automatic is ${value}.`
    : `The app will read the machine before choosing a ${label}.`;
}
function contextHelp(dto: AdvancedDto | null, cache: CacheChoice): string {
  if (!dto) return "The app reads the machine before choosing a context. The bigger f16 cache roughly halves it.";
  const selected = cache || dto.kv_cache_automatic;
  const maximum = selected === "f16" ? dto.context_max_f16 : dto.context_max;
  return typeof maximum === "number" && Number.isFinite(maximum)
    ? `Automatic is up to ${maximum}. A smaller value uses less memory.`
    : "The app reads the machine before choosing a context. The bigger f16 cache roughly halves it.";
}
function cacheHelp(dto: AdvancedDto | null): string {
  return dto?.kv_cache_automatic
    ? `Automatic is ${dto.kv_cache_automatic}.`
    : "The app will read the machine before choosing a cache type.";
}
export function AdvancedPanel({ save }: { save: AdvancedSave }) {
  const [dto, setDto] = useState<AdvancedDto | null>(null);
  const [context, setContext] = useState("");
  const [idle, setIdle] = useState("");
  const [batch, setBatch] = useState("");
  const [ubatch, setUbatch] = useState("");
  const [cache, setCache] = useState<CacheChoice>("");
  const [road, setRoad] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const dirty = useRef(false);
  const focused = useRef(false);
  const syncInputs = useCallback((next: AdvancedDto | null): void => {
    if (dirty.current || focused.current) return;
    setContext(next ? String(next.context_override ?? "") : "");
    setIdle(next ? String(next.idle_override ?? next.idle_unload_seconds ?? "") : "");
    setBatch(next ? String(next.batch_override ?? "") : "");
    setUbatch(next ? String(next.ubatch_override ?? "") : "");
    setCache(next?.kv_cache_override === "f16" || next?.kv_cache_override === "q8_0" ? next.kv_cache_override : "");
    setRoad(next ? next.internet_road : false);
  }, []);
  const refresh = useCallback(async (): Promise<void> => {
    let next: AdvancedDto | null = null;
    if (available()) {
      try {
        next = await invoke<AdvancedDto>("brain_advanced");
      } catch {
        // A read that failed leaves what is on screen alone: the fields are
        // visible now, and blanking them for one failed poll would be a lie.
        return;
      }
    }
    setDto(next);
    syncInputs(next);
  }, [syncInputs]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  function trackText(setValue: (value: string) => void) {
    return {
      onFocus: () => {
        focused.current = true;
      },
      onBlur: () => {
        focused.current = false;
      },
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        dirty.current = true;
        setValue(event.currentTarget.value);
      },
    };
  }
  /** The same hold against the poll, for a <select>: an owner choosing a value
      while a poll lands must not have the choice taken off the screen. */
  function trackSelect(setValue: (value: string) => void) {
    return {
      onFocus: () => {
        focused.current = true;
      },
      onBlur: () => {
        focused.current = false;
      },
      onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
        dirty.current = true;
        setValue(event.currentTarget.value);
      },
    };
  }
  async function saveEdits(): Promise<void> {
    setFeedback(null);
    setSaving(true);
    try {
      const saved = await save({ contextTokens: numberOrNull(context), idleUnloadSeconds: numberOrNull(idle), internetRoad: road, batchSize: numberOrNull(batch), ubatchSize: numberOrNull(ubatch), kvCache: cache === "" ? null : cache });
      setDto(saved);
      dirty.current = false;
      syncInputs(saved);
      setFeedback("Saved for the next start.");
    } catch (error) {
      setFeedback(String(error));
    }
    setSaving(false);
  }

  return (
    <div className="advanced-panel">
      <p className="advanced-eyebrow">ADVANCED</p>
      <p className="advanced-title">Server settings</p>
      {/* The fields are this page's content. They used to sit behind "Show
          settings", which made a third nesting: a settings page, a panel called
          Server settings, and a button to reveal them. */}
      <KnobInfoScope>
        <div className="advanced-body">
          <p className="advanced-note">
            {dto
              ? dto.running
                ? "The current server stays as it is. Changes apply next time you turn on."
                : "Changes apply next time you turn on."
              : "These settings are available inside the Kalsa app."}
          </p>
          <AdvancedField id="advanced-context" knob={CONTEXT_KNOB} help={contextHelp(dto, cache)}><input id="advanced-context" type="number" min={512} max={32768} step={512} placeholder="Automatic" value={context} {...trackText(setContext)} /></AdvancedField>
          <AdvancedField id="advanced-batch" knob={BATCH_KNOB} help={automaticNumber(dto?.batch_automatic, "batch size")}><input id="advanced-batch" type="number" min={64} max={8192} step={1} placeholder="Automatic" value={batch} {...trackText(setBatch)} /></AdvancedField>
          <AdvancedField id="advanced-ubatch" knob={UBATCH_KNOB} help={automaticNumber(dto?.ubatch_automatic, "micro-batch size")}><input id="advanced-ubatch" type="number" min={64} max={1024} step={1} placeholder="Automatic" value={ubatch} {...trackText(setUbatch)} /></AdvancedField>
          <AdvancedField id="advanced-cache" knob={CACHE_KNOB} help={cacheHelp(dto)}>
            <select id="advanced-cache" value={cache} {...trackSelect((value) => setCache(value as CacheChoice))}>
              <option value="">Automatic</option>
              <option value="q8_0">q8_0 — less memory</option>
              <option value="f16">f16 — more cache precision</option>
            </select>
          </AdvancedField>
          <AdvancedField id="advanced-idle" knob={IDLE_KNOB} help="The model is released from memory after this much sitting idle, so an ordinary pause does not reload it. The running server keeps the time it started with, so this takes effect the next time you turn on.">
            <select id="advanced-idle" value={idle} {...trackSelect(setIdle)}>
              {idleChoices(idle).map((choice) => (
                <option key={choice.seconds} value={String(choice.seconds)}>
                  {choice.label}
                </option>
              ))}
            </select>
          </AdvancedField>
          <AdvancedField id="advanced-road" knob={ROAD_KNOB} check help={dto?.iroh_sentence ?? "The internet road is waiting for the server to run."}>
            <input
              id="advanced-road"
              type="checkbox"
              checked={road}
              onFocus={() => {
                focused.current = true;
              }}
              onBlur={() => {
                focused.current = false;
              }}
              onChange={(event) => {
                dirty.current = true;
                setRoad(event.currentTarget.checked);
              }}
            />
          </AdvancedField>
          <p className="advanced-values">
            {dto
              ? `${dto.running ? "In force" : "Next start"}: context ${dto.context_tokens ?? "automatic"}; batch ${dto.batch_size}; micro-batch ${dto.ubatch_size}; KV ${dto.kv_cache_type}; flash attention ${dto.flash_attention}; GPU layers ${dto.gpu_layers ?? "automatic"}; threads ${dto.threads ?? "automatic"}; idle unload ${dto.idle_unload_seconds} seconds.`
              : "The values in force will appear here when the app is open."}
          </p>
          <p className="advanced-help">
            {dto && dto.door_port
              ? `Local door: ${dto.door_port}. Run for Tailscale: tailscale serve ${dto.door_port}`
              : "The local door is waiting for the server to run."}
          </p>
          {dto ? (
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveEdits()}>
              Save settings
            </button>
          ) : null}
          {feedback ? <p className="advanced-feedback">{feedback}</p> : null}
        </div>
      </KnobInfoScope>
    </div>
  );
}
