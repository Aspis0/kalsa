/**
 * KALSA_GOVERNOR_LOAD: the payload one load publishes, and the one cardinality
 * rule — a non-governor load emits nothing.
 */
import {
  governorLoadLogLine,
  logGovernorLoad,
  type GovernorLoadFacts,
} from "./governorLoadLog";

/** An S23 one-copy load, as cpp/rn-governor-params.cpp governor_load_json
 *  builds it: the lane upgraded the V cache and the hop reads real zones. */
const ONECOPY_S23: GovernorLoadFacts = {
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

describe("governorLoadLogLine", () => {
  it("carries the legs, the KV decision, the cadence and the zone counts", () => {
    expect(governorLoadLogLine(ONECOPY_S23)).toBe(
      'KALSA_GOVERNOR_LOAD {"npu":true,"gpu":true,"cpu":true,"one":true,"soc":"SM8550",' +
        '"ck":"q8_0","cv":"q8_0","kvr":"htp-prefill-kv","hop":32,"zcpu":4,"znpu":3,"zgpu":2,' +
        '"th":true}',
    );
  });

  it("reads an unmatched row as nulls, not as blanks", () => {
    expect(governorLoadLogLine({ ...ONECOPY_S23, one_copy: false, soc: null, kv_reason: null })).toContain(
      '"one":false,"soc":null',
    );
  });
});

describe("logGovernorLoad", () => {
  let logged: string[] = [];
  const realLog = console.log;
  beforeEach(() => {
    logged = [];
    console.log = (...args: unknown[]) => {
      logged.push(args.join(" "));
    };
  });
  afterEach(() => {
    console.log = realLog;
  });

  it("emits exactly one line per governor load", () => {
    logGovernorLoad(ONECOPY_S23);
    expect(logged).toHaveLength(1);
    expect(logged[0].startsWith("KALSA_GOVERNOR_LOAD ")).toBe(true);
  });

  it("emits nothing for a load that never ran the governor", () => {
    logGovernorLoad(null);
    logGovernorLoad(undefined);
    expect(logged).toEqual([]);
  });
});