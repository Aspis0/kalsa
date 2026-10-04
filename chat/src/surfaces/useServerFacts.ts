import { useEffect, useState } from "react";
import { fetchSamplingDefaultsWithStatus, serverBase } from "../lib/chat";
import type { SamplingDefaultsStatus } from "../lib/chat";
import { rememberContextSize } from "../lib/contextSize";
import type { Modalities } from "../lib/modalities";
import { NO_MODALITIES } from "../lib/modalities";
import type { Sampling } from "../lib/sampling";
import { SAMPLING_KNOBS } from "../lib/knobs/sampling";
import { useBrainState } from "./useBrain";

/**
 * The server's own facts about the model it is serving, read once and shared:
 * the sampler values it reports, the model's chat template, and whether the
 * model can see — all from the one `/props` body, whose window is stored on
 * the way (see below).
 *
 * One road to a fact. The sampling panel reads this for the defaults, the
 * chat's thinking control for the template, and the composer for vision —
 * they mount this rather than each opening their own way to `/props`, because
 * two readers of one fact that disagree is the defect this exists to prevent.
 * The read follows the MODEL as well as the endpoint: a model switch restarts
 * the engine, and the new one's answers belong to the new read. And it follows
 * the engine's own standing (`brain_state.kind`, read here rather than passed
 * in, so no caller can forget it): a restart that keeps the model leaves and
 * comes back to `running` under the same endpoint and the same name, so
 * neither input above would ask again — the vision offer's restart is that
 * case, and the projector's arrival is exactly what `/props` then says.
 *
 * The same body's window is stored on the way, through the ONE rule
 * (`contextSize.ts`): `contextSizes` is the chat's per-endpoint cache, and the
 * endpoint written is THIS read's own, never a later render's — a restarted
 * engine that changes `n_ctx` heals the cache with its new answer, and a
 * number is never filed under an endpoint it did not come from. The sample
 * read is the one that feeds it, so a text-only chat (no attach, no panel)
 * knows its window without a second GET.
 */

export type FactsStatus = SamplingDefaultsStatus | "loading" | "not-configured";

export interface ServerFacts {
  /** The server's own sampler values, keyed by the wire names. */
  defaults: Sampling;
  status: FactsStatus;
  /** The model's chat template, empty until the server has answered. */
  chatTemplate: string;
  /** What the served model can receive, all false until the server says. */
  modalities: Modalities;
}

function blankDefaults(): Sampling {
  return Object.fromEntries(SAMPLING_KNOBS.map(({ wire }) => [wire, null]));
}

/**
 * Silence is not yet a failure. A fresh server starts answering only after it
 * has loaded the model, which on a large one is well over a minute, and the app
 * reaches this while that is still happening. So the first read is expected to
 * find nothing, and the panel keeps asking while the answer is silence: one
 * second, then doubling up to a cap, until the budget runs out — only then does
 * the line stop saying it is being read and report the silence.
 */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 16_000;
const RETRY_BUDGET_MS = 60_000;

export function useServerFacts(
  endpoint: string,
  token: string,
  model: string,
  /** When given, the window the same read reports is stored here through the
      one rule; a surface with no chat window to remember (the sampling panel)
      omits it and reads the other facts. */
  contextSizes?: { current: Map<string, number> },
): ServerFacts {
  const [defaults, setDefaults] = useState<Sampling>(() => blankDefaults());
  const [status, setStatus] = useState<FactsStatus>("not-configured");
  const [chatTemplate, setChatTemplate] = useState("");
  const [modalities, setModalities] = useState<Modalities>(() => NO_MODALITIES);
  const engine = useBrainState()?.kind ?? "";

  useEffect(() => {
    if (!endpoint) {
      setStatus("not-configured");
      setChatTemplate("");
      setModalities(NO_MODALITIES);
      return undefined;
    }
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setStatus("loading");
    // The old capability dies with the old model: until the new `/props`
    // answers, this model is one this window has no word about, and "no
    // word" is blindness — the previous answer standing through the pending
    // window is exactly how a picture reached a blind model after a switch.
    setModalities(NO_MODALITIES);
    const deadline = Date.now() + RETRY_BUDGET_MS;

    // Only silence is retried. `refused` and `invalid` are answers from a
    // server that is there, and asking it again would be hammering it.
    async function read(delay: number): Promise<void> {
      const result = await fetchSamplingDefaultsWithStatus(serverBase(endpoint), 8000, token);
      if (!alive) return;
      if (result.status !== "unavailable" || Date.now() + delay > deadline) {
        setDefaults(result.values);
        setStatus(result.status);
        setChatTemplate(result.chatTemplate);
        setModalities(result.modalities);
        if (contextSizes) rememberContextSize(contextSizes.current, endpoint, result.nctx);
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
  }, [endpoint, token, model, engine]);

  return { defaults, status, chatTemplate, modalities };
}
