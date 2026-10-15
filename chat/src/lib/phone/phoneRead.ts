import { runMailRead } from "../tools/mailCall";
import type { PhoneSink } from "./phoneEvents";

/** One mail as the Mail tab reads it. The read cannot be withdrawn from the page,
    so a stop stops waiting for it, and its late answer is never sent. */
export async function runPhoneRead(id: string, sink: PhoneSink, signal: AbortSignal): Promise<void> {
  const answer = signal.aborted ? null : await untilStopped(runMailRead({ id }), signal);
  if (answer === null) return sink.fail("cancelled");
  if (!answer.ok || answer.record === null) return sink.fail(answer.code ?? "mail.call_failed");
  sink.read(answer.record, answer.body);
  sink.done();
}

/** The value, or null as soon as the signal aborts; the listener is removed either way. */
function untilStopped<T>(work: Promise<T>, signal: AbortSignal): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const stop = () => resolve(null);
    signal.addEventListener("abort", stop, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", stop);
        reject(error);
      },
    );
  });
}
