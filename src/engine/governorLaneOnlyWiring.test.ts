/**
 * Shape-only guard: LlamaService imports llama.rn, so Jest cannot reach its
 * load path. The lane-only claim must come from the native outcome, and the
 * plan must price with the same gate inputs the params were judged by.
 */
import fs from "fs";
import path from "path";

const source = fs.readFileSync(path.resolve(__dirname, "LlamaService.ts"), "utf8");

describe("lane-only claim wiring in LlamaService", () => {
  test("the load latch is the native outcome, not the governor's intent", () => {
    expect(source).toMatch(
      /activeGovernorLaneOnly =\s*governorUsed &&[\s\S]*?npu_lane_enabled === true &&\s*\(await readNpuLaneResolved\(context\)\)/,
    );
  });

  test("a turn's stats can only take the lane-only claim away", () => {
    expect(source).toMatch(
      /if \(activeGovernorLaneOnly && !npuLaneResolved\(stats\)\) activeGovernorLaneOnly = false;/,
    );
  });

  test("the plan log prices with the gate inputs buildGovernorParams used", () => {
    expect(source).toMatch(/\{ laneModel, npu: npuLaneInputs, availableSrc \}/);
    expect(source).toMatch(/buildGovernorParams\(pricedModel, deviceProfile, \{[\s\S]*?\},\s*benchGovernorForce,\s*benchNoRepack,\s*npuLaneInputs,/);
  });
});
