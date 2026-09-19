import { useEffect, useState } from "react";
import { fetchSamplingDefaultsWithStatus, serverBase } from "../lib/chat";
import type { SamplingDefaultsStatus } from "../lib/chat";
import type { Sampling } from "../lib/sampling";
import { SAMPLING_KNOBS } from "../lib/knobs/sampling";

/**
 * The server's own facts about the model it is serving, read once and shared:
 * the sampler values it reports and the model's chat template, which `/props`
 * answers in the same breath.
 *
 * One road to a fact. The sampling panel reads this for the defaults, and the
 * chat's thinking control reads it for the template — they mount this rather
 * than each opening their own way to `/props`, because two readers of one fact
 * that disagree is the defect this exists to prevent.
 */

export type FactsStatus = SamplingDefaultsStatus | "loading" | "not-configured";

export interface ServerFacts {
  /** The server's own sampler values, keyed by the wire names. */
  defaults: Sampling;
  status: FactsStatus;
  /** The model's chat template, empty until the server has answered. */
  chatTemplate: string;
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

export function useServerFacts(endpoint: string, token: string): ServerFacts {
  const [defaults, setDefaults] = useState<Sampling>(() => blankDefaults());
  const [status, setStatus] = useState<FactsStatus>("not-configured");
  const [chatTemplate, setChatTemplate] = useState("");

  useEffect(() => {
    if (!endpoint) {
      setStatus("not-configured");
      return undefined;
    }
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setStatus("loading");
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

  return { defaults, status, chatTemplate };
}
