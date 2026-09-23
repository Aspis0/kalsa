import { useCallback, useEffect, useRef, useState } from "react";
import { available, invoke } from "../lib/tauri";
import { LAUNCH_KNOBS } from "../lib/knobs/launch";
import type { LaunchKnob } from "../lib/knobs/types";
import { bytesText } from "../surfaces/MachineCard";
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
  context_automatic: number | null;
  context_automatic_f16: number | null;
  kv_bytes_per_token: number | null;
  kv_bytes_per_token_f16: number | null;
  kv_bytes_fixed: number | null;
  kv_bytes_fixed_f16: number | null;
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
  // The pairing desk's own port and whether it is the preferred one, the
  // second serve command's target. Absent desk facts are left out of the
  // note, never glossed over.
  desk_port: number | null;
  desk_port_preferred: boolean;
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
/** A number that came off the wire and is usable as one, or null. */
function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
/** The cache type the panel is showing: the owner's choice when they made one,
    the automatic otherwise. One rule, so the maximum, the automatic figure
    and the memory line cannot disagree about which cache they describe. */
function shownCache(dto: AdvancedDto, cache: CacheChoice): string {
  return cache || dto.kv_cache_automatic;
}
function contextMaximum(dto: AdvancedDto | null, cache: CacheChoice): number | null {
  if (!dto) return null;
  return finite(shownCache(dto, cache) === "f16" ? dto.context_max_f16 : dto.context_max);
}
/** What the launcher picks with no owner choice, under the cache being shown:
    the panel names this instead of leaving "Automatic" blank. */
function contextAutomatic(dto: AdvancedDto | null, cache: CacheChoice): number | null {
  if (!dto) return null;
  return finite(shownCache(dto, cache) === "f16" ? dto.context_automatic_f16 : dto.context_automatic);
}
/** The launcher's own two KV terms for the cache being shown — the per-token
    price and the per-slot term it already summed over the slots. The panel
    multiplies and adds; it never derives a cache cost of its own. */
function contextPrice(dto: AdvancedDto | null, cache: CacheChoice): { perToken: number; fixed: number } | null {
  if (!dto) return null;
  const f16 = shownCache(dto, cache) === "f16";
  const perToken = finite(f16 ? dto.kv_bytes_per_token_f16 : dto.kv_bytes_per_token);
  const fixed = finite(f16 ? dto.kv_bytes_fixed_f16 : dto.kv_bytes_fixed);
  return perToken === null || fixed === null ? null : { perToken, fixed };
}
/** The length the control is showing: what the owner typed, or the automatic
    figure while the box is empty. */
function shownContext(dto: AdvancedDto | null, cache: CacheChoice, typed: string): number | null {
  if (typed !== "") return finite(Number(typed));
  return contextAutomatic(dto, cache);
}
/** The KV cache the choice in front of the owner will use, in bytes. */
function contextCost(dto: AdvancedDto | null, cache: CacheChoice, typed: string): number | null {
  const price = contextPrice(dto, cache);
  const tokens = shownContext(dto, cache, typed);
  if (price === null || tokens === null || tokens <= 0) return null;
  return tokens * price.perToken + price.fixed;
}
/** A context length as a chat figure: 65536 is "64k", 65315 is "63.8k". */
function tokensText(tokens: number): string {
  if (tokens < 1024) return String(tokens);
  const thousands = tokens / 1024;
  return `${Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
}
/** How "Automatic" is written where a figure is expected: the launcher's own
    pick when it is known, the bare word otherwise. */
function automaticLabel(dto: AdvancedDto | null, cache: CacheChoice): string {
  const automatic = contextAutomatic(dto, cache);
  return automatic === null ? "automatic" : `Automatic — ${tokensText(automatic)}`;
}
/** The one-click context sizes. 64k is the launcher's own chat default
    (`DEFAULT_CONTEXT_TOKENS` in kalsa-launch); 32k and 128k are the step
    either side of it. Only the sizes this machine funds are offered, so a
    button can never set a value the guards would refuse. */
const CONTEXT_PRESETS: readonly number[] = [32 * 1024, 64 * 1024, 128 * 1024];
function contextHelp(dto: AdvancedDto | null, cache: CacheChoice, typed: string): string {
  const tokens = shownContext(dto, cache, typed);
  const cost = contextCost(dto, cache, typed);
  const costSentence =
    cost !== null && tokens !== null
      ? ` The KV cache for ${tokensText(tokens)} tokens uses ${bytesText(cost)}.`
      : "";
  const maximum = contextMaximum(dto, cache);
  const automatic = contextAutomatic(dto, cache);
  if (maximum === null) {
    return `The app reads the machine before choosing a context. The bigger f16 cache roughly halves it.${costSentence}`;
  }
  if (automatic === null) {
    return `Up to ${tokensText(maximum)} on this computer. A smaller value uses less memory.${costSentence}`;
  }
  return `Automatic is ${tokensText(automatic)} (${automatic} tokens). Up to ${tokensText(maximum)} on this computer.${costSentence}`;
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
  /** A preset, or Automatic, chosen with one click. Marked dirty so the next
      poll does not take the choice back off the screen before it is saved. */
  function chooseContext(value: string): void {
    dirty.current = true;
    setContext(value);
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

  // What the context control needs this render: the machine's ceiling, the
  // launcher's automatic figure, and the presets this machine funds.
  const maximum = contextMaximum(dto, cache);
  const automatic = contextAutomatic(dto, cache);
  const contextPresets = CONTEXT_PRESETS.filter((preset) => maximum === null || preset <= maximum);

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
          <AdvancedField id="advanced-context" knob={CONTEXT_KNOB} help={contextHelp(dto, cache, context)}>
            <div className="advanced-presets" role="group" aria-label="Context size">
              <button type="button" className={context === "" ? "advanced-preset advanced-preset-on" : "advanced-preset"} onClick={() => chooseContext("")}>
                {automatic === null ? "Automatic" : `Automatic — ${tokensText(automatic)}`}
              </button>
              {contextPresets.map((preset) => (
                <button key={preset} type="button" className={context !== "" && Number(context) === preset ? "advanced-preset advanced-preset-on" : "advanced-preset"} onClick={() => chooseContext(String(preset))}>
                  {tokensText(preset)}
                </button>
              ))}
              {maximum !== null ? (
                <button type="button" className={context !== "" && Number(context) === maximum ? "advanced-preset advanced-preset-on" : "advanced-preset"} onClick={() => chooseContext(String(maximum))}>
                  Maximum — {tokensText(maximum)}
                </button>
              ) : null}
            </div>
            <input id="advanced-context" type="number" min={512} max={maximum ?? undefined} step={512} placeholder={automatic === null ? "Automatic" : `Automatic — ${tokensText(automatic)}`} value={context} {...trackText(setContext)} />
          </AdvancedField>
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
              ? `${dto.running ? "In force" : "Next start"}: context ${dto.context_tokens ?? automaticLabel(dto, cache)}; batch ${dto.batch_size}; micro-batch ${dto.ubatch_size}; KV ${dto.kv_cache_type}; flash attention ${dto.flash_attention}; GPU layers ${dto.gpu_layers ?? "automatic"}; threads ${dto.threads ?? "automatic"}; idle unload ${dto.idle_unload_seconds} seconds.`
              : "The values in force will appear here when the app is open."}
          </p>
          <p className="advanced-help">
            {dto && (dto.door_port || dto.desk_port)
              ? [
                  `Local door: ${dto.door_port ?? "not up yet"}.`,
                  `Run for Tailscale: ${[
                    dto.door_port ? `tailscale serve --bg ${dto.door_port}` : null,
                    dto.desk_port ? `tailscale serve --bg --https=8443 ${dto.desk_port}` : null,
                  ]
                    .filter((command) => command !== null)
                    .join(" · ")}.`,
                  "The phone chats at this computer's tailnet name and pairs at that name with :8443.",
                  dto.desk_port && dto.desk_port_preferred === false
                    ? `The pairing desk is on ${dto.desk_port} this time — run its command again with this number.`
                    : null,
                ]
                  .filter((part) => part !== null)
                  .join(" ")
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
