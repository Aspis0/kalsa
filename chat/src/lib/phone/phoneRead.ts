import { runMailRead } from "../tools/mailCall";
import type { PhoneSink } from "./phoneEvents";

/** One mail as the Mail tab reads it. A read is one short command with no stream
    to cut, so a stop from the phone reaches turns only. */
export async function runPhoneRead(id: string, sink: PhoneSink): Promise<void> {
  const answer = await runMailRead({ id });
  if (!answer.ok || answer.record === null) return sink.fail(answer.code ?? "mail.call_failed");
  sink.read(answer.record, answer.body);
  sink.done();
}
