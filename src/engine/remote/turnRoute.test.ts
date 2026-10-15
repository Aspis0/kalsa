import {
  forgetTurnRouteVerdict,
  isTurnRouteAbsent,
  isTurnRouteRefusal,
  streamTurnWithFallback,
} from "./turnRoute";

const refusal = () => ({ error: new Error("remote_brain_http_404") });

describe("the turn route and its silent fallback", () => {
  beforeEach(() => forgetTurnRouteVerdict());

  test("a turn with pictures never asks a route that cannot take them", async () => {
    const routes: string[] = [];
    await streamTurnWithFallback({
      wantsTurnRoute: false,
      attempt: async (route) => {
        routes.push(route);
        return "settled";
      },
    });
    expect(routes).toEqual(["completions"]);
  });

  test("a computer that knows the route answers on it", async () => {
    const routes: string[] = [];
    await streamTurnWithFallback({
      wantsTurnRoute: true,
      attempt: async (route) => {
        routes.push(route);
        return "settled";
      },
    });
    expect(routes).toEqual(["turn"]);
    expect(isTurnRouteAbsent()).toBe(false);
  });

  test("a refusal before any byte sends the same turn the old way", async () => {
    const routes: string[] = [];
    await streamTurnWithFallback({
      wantsTurnRoute: true,
      attempt: async (route) => {
        routes.push(route);
        return route === "turn" ? "absent" : "settled";
      },
    });
    expect(routes).toEqual(["turn", "completions"]);
    expect(isTurnRouteAbsent()).toBe(true);
  });

  test("the verdict is one per pairing: the next turn asks once", async () => {
    const routes: string[] = [];
    const attempt = async (route: string) => {
      routes.push(route);
      return "absent" as const;
    };
    await streamTurnWithFallback({ wantsTurnRoute: true, attempt });
    await streamTurnWithFallback({ wantsTurnRoute: true, attempt });
    expect(routes).toEqual(["turn", "completions", "completions"]);
  });

  test("a mid-turn failure is a failure, and a dead door is not a refusal", () => {
    expect(isTurnRouteRefusal({ error: new Error("remote_brain_timeout") })).toBe(false);
    expect(isTurnRouteRefusal(undefined)).toBe(false);
    // Status 0 is no answer at all, and remembering it would take the route
    // away from a computer that has it.
    expect(isTurnRouteRefusal({ error: new Error("remote_brain_http_0") })).toBe(false);
    // A 401 IS a refusal by the letter of the rule, and the old route will say
    // the same: nothing is remembered that the fallback would not honour.
    expect(isTurnRouteRefusal({ error: new Error("remote_brain_http_401") })).toBe(true);
    expect(isTurnRouteRefusal({ error: new Error("remote_brain_http_404") })).toBe(true);
  });
});