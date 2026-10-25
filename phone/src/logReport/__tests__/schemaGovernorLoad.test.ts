/**
 * KALSA_GOVERNOR_LOAD through the REAL emitter: the payload governorLoadLog
 * builds from one load's governorLoad, walked through formatRecord and
 * finalizeRecord. What is asserted is what an uploaded report actually keeps —
 * every field surviving, whole inside normalize.ts's record cap.
 */
import { governorLoadLogLine, type GovernorLoadFacts } from "../../engine/governorLoadLog";
import { finalizeRecord } from "../normalize";
import { formatRecord } from "../schema";

/** An S23 one-copy load, as cpp/rn-governor-params.cpp governor_load_json
 *  builds it: the lane upgraded the V cache and the hop reads real zones. */
const LOAD_FACTS: GovernorLoadFacts = {
  one_copy: true,
  npu_leg: true,
  gpu_leg: true,
  cpu_leg: true,
  prefill_thermal_handoff: true,
  soc: "SM8550",
  cache_type_k: "q8_0",
  cache_type_v: "q8_0",
  kv_reason: "htp-prefill-kv",
  hop_tokens: 32,
  zones_cpu: 4,
  zones_npu: 3,
  zones_gpu: 2,
};

/** The whole pipeline for one emitted line: schema projection, then the final
 *  safety pass. null means the line was dropped. */
function report(emitted: string): { line: string; fields: Record<string, unknown> } | null {
  const split = emitted.indexOf(" ");
  const record = formatRecord(emitted.slice(0, split), JSON.parse(emitted.slice(split + 1)));
  if (record === null) return null;
  const line = finalizeRecord(record);
  if (line === null) return null;
  const payload = line.slice(line.indexOf(" ") + 1);
  return { line, fields: JSON.parse(payload.slice(payload.indexOf(" ") + 1)) };
}

describe("KALSA_GOVERNOR_LOAD keeps what one load built", () => {
  it("survives the record cap whole", () => {
    const out = report(governorLoadLogLine(LOAD_FACTS));
    expect(out?.fields).toEqual({
      npu: true,
      gpu: true,
      cpu: true,
      one: true,
      soc: "SM8550",
      ck: "q8_0",
      cv: "q8_0",
      kvr: "htp-prefill-kv",
      hop: 32,
      zcpu: 4,
      znpu: 3,
      zgpu: 2,
      th: true,
    });
    expect(out?.line.length).toBeLessThanOrEqual(300);
  });

  it("keeps a dropped leg as false and an unmatched row as null", () => {
    const out = report(
      governorLoadLogLine({ ...LOAD_FACTS, gpu_leg: false, one_copy: false, soc: null, hop_tokens: 0 }),
    );
    expect(out?.fields).toMatchObject({ gpu: false, one: false, soc: null, hop: 0 });
  });

  it("drops a SoC string that is not a bounded model name", () => {
    const out = report(
      governorLoadLogLine({ ...LOAD_FACTS, soc: "SM8550 /Users/marco/secret" }),
    );
    expect(out?.fields).not.toHaveProperty("soc");
    expect(out?.fields).toMatchObject({ npu: true, hop: 32 });
  });
});