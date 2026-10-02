import { useCallback, useEffect, useRef, useState } from "react";
import { available, invoke } from "../lib/tauri";
import { LAUNCH_KNOBS } from "../lib/knobs/launch";
import type { LaunchKnob } from "../lib/knobs/types";
import { bytesText } from "../surfaces/MachineCard";
import { loadSettings, saveSettings } from "../lib/settings";
import { launchWords } from "../lib/knobs/words";
import { useLanguage } from "../i18n/useLanguage";
import type { English } from "../i18n/en/all";
import { AdvancedField } from "./AdvancedField";
import { KnobInfoScope } from "./KnobInfo";
import "./AdvancedPanel.css";
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
  /** The tune's own line, when a launch was tuned: see `tune_step`. */
  tune?: string | null;
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
const IDLE_CHOICES: readonly number[] = [60, 300, 3600];

/** The three choices, plus the value already on file when it is none of them:
    an owner who typed 10 minutes in an earlier build still sees what the
    server is really using, and saving without touching it keeps their value
    rather than silently rounding it to a preset. */
/** The idle clock's legible choices, plus the value already on file when it
    is none of them — an owner's earlier choice is kept, never rounded to a
    preset. The words are the table's; the numbers are the range Rust
    enforces and the app's own default. */
function idleChoices(current: string, t: English["advanced"]): readonly { seconds: number; label: string }[] {
  const seconds = Number(current);
  const named = IDLE_CHOICES.map((value) => ({
    seconds: value,
    label: value === 60 ? t.idleOneMinute : t.idleMinutes(String(value / 60)),
  }));
  if (current === "" || IDLE_CHOICES.includes(seconds)) return named;
  const minutes = seconds / 60;
  const label = Number.isInteger(minutes)
    ? minutes === 1
      ? t.idleOneMinute
      : t.idleMinutes(String(minutes))
    : t.idleSeconds(String(seconds));
  return [...named, { seconds, label }].sort((a, b) => a.seconds - b.seconds);
}

/** A typed value as a number, or null for the empty box. A box holding
    something that is not a number throws the code the save words itself. */
function numberOrNull(value: string): number | null {
  if (value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("not-a-number");
  return number;
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
function automaticLabel(t: English["advanced"], dto: AdvancedDto | null, cache: CacheChoice): string {
  const automatic = contextAutomatic(dto, cache);
  return automatic === null ? t.automaticBare : t.automaticWith(tokensText(automatic));
}
/** The one-click context sizes. 64k is the launcher's own chat default
    (`DEFAULT_CONTEXT_TOKENS` in kalsa-launch); 32k and 128k are the step
    either side of it. Only the sizes this machine funds are offered, so a
    button can never set a value the guards would refuse. */
const CONTEXT_PRESETS: readonly number[] = [32 * 1024, 64 * 1024, 128 * 1024];
function contextHelp(t: English["advanced"], tag: string, dto: AdvancedDto | null, cache: CacheChoice, typed: string): string {
  const tokens = shownContext(dto, cache, typed);
  const cost = contextCost(dto, cache, typed);
  const costSentence =
    cost !== null && tokens !== null ? t.contextCost(tokensText(tokens), bytesText(cost)) : "";
  const maximum = contextMaximum(dto, cache);
  const automatic = contextAutomatic(dto, cache);
  if (maximum === null) {
    return t.contextNoMaximum + costSentence;
  }
  if (automatic === null) {
    return t.contextNoAutomatic(tokensText(maximum)) + costSentence;
  }
  return t.contextFull(tokensText(automatic), new Intl.NumberFormat(tag).format(automatic), tokensText(maximum)) + costSentence;
}
function cacheHelp(t: English["advanced"], dto: AdvancedDto | null): string {
  return dto?.kv_cache_automatic ? t.cacheAutomatic(dto.kv_cache_automatic) : t.cacheReadLater;
}
interface AdvancedPanelProps {
  save: AdvancedSave;
  /** The stored model name and where its edits go: the same settings field
      the Settings page kept, so the dev path's typed name reaches the chat
      without a reload. */
  model: string;
  onModelChange?: (model: string) => void;
}

export function AdvancedPanel({ save, model: modelProp, onModelChange }: AdvancedPanelProps) {
  const { table, tag } = useLanguage();
  const t = table.advanced;
  const knobs = table.knobs;
  const said = (knob: LaunchKnob) => launchWords(knobs, knob);
  // Figures follow the language, the "k" abbreviation follows them.
  const num = (value: number | string): string => new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(Number(value));
  // The name arrives as the stored value and is written on blur — the same
  // commit a knob's typed value makes. The one writer of the record is that
  // blur; onModelChange only carries the name to the app's memory.
  const [model, setModel] = useState(modelProp);
  const [modelError, setModelError] = useState<string | null>(null);
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
  // Read once: the launch record this shows changes only through this
  // panel's own save, which hands the answer straight to the fields — a
  // timer re-asking every 2 s was reading a fact that cannot move behind
  // the owner's back, and wiping the fields' dirty state with it.
  useEffect(() => {
    void refresh();
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
      setFeedback(t.saveOk);
    } catch (error) {
      setFeedback(error instanceof Error && error.message === "not-a-number" ? t.enterNumber : String(error));
    }
    setSaving(false);
  }

  /** The one write of the record, and the only road to onModelChange: the
      app's memory learns the name only when the write really landed, so it
      never holds a name storage cannot give back. */
  function commitName(): void {
    const name = model.trim();
    if (!name) {
      setModelError(t.modelNameError);
      return;
    }
    if (saveSettings({ ...loadSettings(), model: name })) onModelChange?.(name);
  }

  // What the context control needs this render: the machine's ceiling, the
  // launcher's automatic figure, and the presets this machine funds.
  const maximum = contextMaximum(dto, cache);
  const automatic = contextAutomatic(dto, cache);
  const contextPresets = CONTEXT_PRESETS.filter((preset) => maximum === null || preset <= maximum);

  return (
    <div className="advanced-panel">
      <p className="advanced-eyebrow">{t.eyebrow}</p>
      <p className="advanced-title">{t.title}</p>
      <KnobInfoScope>
        <div className="advanced-body">
          <label className="settings-field">
            <span>{t.modelName}</span>
            <input
              type="text"
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                setModelError(null);
              }}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitName();
              }}
              placeholder={t.modelNamePlaceholder}
              autoComplete="off"
              spellCheck={false}
            />
            {modelError ? (
              <p className="settings-error" role="alert">
                {modelError}
              </p>
            ) : null}
          </label>
          <p className="advanced-note">
            {dto ? (dto.running ? t.noteRunning : t.noteStopped) : t.noteNoApp}
          </p>
          <AdvancedField id="advanced-context" knob={CONTEXT_KNOB} said={said(CONTEXT_KNOB)} help={contextHelp(t, tag, dto, cache, context)}>
            <div className="advanced-presets" role="group" aria-label={t.presetsAria}>
              <button type="button" className={context === "" ? "advanced-preset advanced-preset-on" : "advanced-preset"} onClick={() => chooseContext("")}>
                {automatic === null ? t.automatic : t.automaticWith(tokensText(automatic))}
              </button>
              {contextPresets.map((preset) => (
                <button key={preset} type="button" className={context !== "" && Number(context) === preset ? "advanced-preset advanced-preset-on" : "advanced-preset"} onClick={() => chooseContext(String(preset))}>
                  {tokensText(preset)}
                </button>
              ))}
              {maximum !== null ? (
                <button type="button" className={context !== "" && Number(context) === maximum ? "advanced-preset advanced-preset-on" : "advanced-preset"} onClick={() => chooseContext(String(maximum))}>
                  {t.maximumWith(tokensText(maximum))}
                </button>
              ) : null}
            </div>
            <input id="advanced-context" type="number" min={512} max={maximum ?? undefined} step={512} placeholder={automatic === null ? t.automatic : t.automaticWith(tokensText(automatic))} value={context} {...trackText(setContext)} />
          </AdvancedField>
          <AdvancedField id="advanced-batch" knob={BATCH_KNOB} said={said(BATCH_KNOB)} help={dto?.batch_automatic != null ? t.automaticNumber(num(dto.batch_automatic)) : t.automaticReadLater(t.batchSizeName)}><input id="advanced-batch" type="number" min={64} max={8192} step={1} placeholder={t.automatic} value={batch} {...trackText(setBatch)} /></AdvancedField>
          <AdvancedField id="advanced-ubatch" knob={UBATCH_KNOB} said={said(UBATCH_KNOB)} help={dto?.ubatch_automatic != null ? t.automaticNumber(num(dto.ubatch_automatic)) : t.automaticReadLater(t.ubatchSizeName)}><input id="advanced-ubatch" type="number" min={64} max={1024} step={1} placeholder={t.automatic} value={ubatch} {...trackText(setUbatch)} /></AdvancedField>
          <AdvancedField id="advanced-cache" knob={CACHE_KNOB} said={said(CACHE_KNOB)} help={cacheHelp(t, dto)}>
            <select id="advanced-cache" value={cache} {...trackSelect((value) => setCache(value as CacheChoice))}>
              <option value="">{t.automatic}</option>
              <option value="q8_0">{t.cacheLessMemory}</option>
              <option value="f16">{t.cacheMorePrecision}</option>
            </select>
          </AdvancedField>
          <AdvancedField id="advanced-idle" knob={IDLE_KNOB} said={said(IDLE_KNOB)} help={t.idleHelp}>
            <select id="advanced-idle" value={idle} {...trackSelect(setIdle)}>
              {idleChoices(idle, t).map((choice) => (
                <option key={choice.seconds} value={String(choice.seconds)}>
                  {choice.label}
                </option>
              ))}
            </select>
          </AdvancedField>
          <AdvancedField id="advanced-road" knob={ROAD_KNOB} said={said(ROAD_KNOB)} check help={dto?.iroh_sentence ?? t.roadWaiting}>
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
          {dto?.internet_road ? (
            <p className="advanced-note">{t.roadPermissionNote}</p>
          ) : null}
          <p className="advanced-values">
            {dto
              ? t.valuesInForce({
                  lead: dto.running ? t.inForce : t.nextStart,
                  context: dto.context_tokens != null ? num(dto.context_tokens) : automaticLabel(t, dto, cache),
                  batch: num(dto.batch_size),
                  ubatch: num(dto.ubatch_size),
                  kv: dto.kv_cache_type,
                  flash: dto.flash_attention,
                  gpu: dto.gpu_layers ?? t.automaticWord,
                  threads: dto.threads != null ? num(dto.threads) : t.automaticWord,
                  idle: `${num(dto.idle_unload_seconds)} ${t.secondsWord}`,
                  tune: dto.tune ? ` ${t.tuneWord}: ${dto.tune}.` : "",
                })
              : t.valuesWaiting}
          </p>
          <p className="advanced-help">
            {dto && (dto.door_port || dto.desk_port)
              ? [
                  t.doorLocal(dto.door_port != null ? num(dto.door_port) : t.doorNotUp),
                  t.runForTailscale([
                    dto.door_port ? `tailscale serve --bg ${dto.door_port}` : null,
                    dto.desk_port ? `tailscale serve --bg --https=8443 ${dto.desk_port}` : null,
                  ]
                    .filter((command) => command !== null)
                    .join(" · ")),
                  dto.door_port && dto.desk_port
                    ? t.chatsAndPairs
                    : dto.door_port
                      ? t.chatsAt
                      : t.pairsAt,
                  dto.desk_port && dto.desk_port_preferred === false ? t.deskMoved(dto.desk_port) : null,
                ]
                  .filter((part) => part !== null)
                  .join(" ")
              : t.doorWaiting}
          </p>
          {dto ? (
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveEdits()}>
              {t.saveButton}
            </button>
          ) : null}
          {feedback ? <p className="advanced-feedback">{feedback}</p> : null}
        </div>
      </KnobInfoScope>
    </div>
  );
}
