import {
  INITIAL_KV_REPRO_STATE,
  nextKvReproState,
} from "./kvReproducibility";

describe("KV reproducibility transitions", () => {
  test("tool completion is a distinct last-exchange divergence", () => {
    const state = nextKvReproState(
      nextKvReproState(INITIAL_KV_REPRO_STATE, "turn_start"),
      "tool_calls_detected",
    );

    expect(state).toEqual({
      reproducible: false,
      turnInjected: true,
      divergesAtLastExchange: true,
    });
    expect(nextKvReproState(state, "clean_completion")).toEqual(state);
  });

  test("a clean following turn repairs the prior divergence", () => {
    let state = nextKvReproState(INITIAL_KV_REPRO_STATE, "tool_calls_detected");
    state = nextKvReproState(state, "clean_completion");
    state = nextKvReproState(state, "turn_start");

    expect(nextKvReproState(state, "clean_completion")).toEqual(
      INITIAL_KV_REPRO_STATE,
    );
  });

  test("multiple tool rounds in one turn retain the marker", () => {
    let state = nextKvReproState(INITIAL_KV_REPRO_STATE, "tool_calls_detected");
    state = nextKvReproState(state, "tool_calls_detected");

    expect(state.divergesAtLastExchange).toBe(true);
    expect(state.turnInjected).toBe(true);
  });

  test("a second tool turn without a clean turn loses the marker", () => {
    const priorToolTurn = {
      reproducible: false,
      turnInjected: false,
      divergesAtLastExchange: true,
    };
    expect(nextKvReproState(priorToolTurn, "tool_calls_detected")).toEqual({
      reproducible: false,
      turnInjected: true,
      divergesAtLastExchange: false,
    });
  });

  test("miniapp stripping clears a stale tool marker", () => {
    const state = {
      reproducible: false,
      turnInjected: true,
      divergesAtLastExchange: true,
    };
    expect(nextKvReproState(state, "miniapp_stripped")).toEqual({
      reproducible: false,
      turnInjected: true,
      divergesAtLastExchange: false,
    });
  });

  test("miniapp stripping is not eligible for the tool exception", () => {
    const state = nextKvReproState(
      INITIAL_KV_REPRO_STATE,
      "miniapp_stripped",
    );

    expect(state).toEqual({
      reproducible: false,
      turnInjected: false,
      divergesAtLastExchange: false,
    });
  });
});
