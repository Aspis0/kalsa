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

  test("only a door saying \"no such route\" counts as an old computer", () => {
    // A revoked credential or a sick server says nothing about the route, and
    // remembering one would take the route away for the whole session.
    expect(isTurnRouteRefusal({ error: new Error("remote_brain_http_401") })).toBe(false);
    expect(isTurnRouteRefusal({ error: new Error("remote_brain_http_500") })).toBe(false);
    expect(isTurnRouteRefusal({ error: new Error("remote_brain_http_0") })).toBe(false);
    expect(isTurnRouteRefusal({ error: new Error("remote_brain_timeout") })).toBe(false);
    expect(isTurnRouteRefusal(undefined)).toBe(false);
    expect(isTurnRouteRefusal({ error: new Error("remote_brain_http_404") })).toBe(true);
    expect(isTurnRouteRefusal({ error: new Error("remote_brain_http_405") })).toBe(true);
    expect(isTurnRouteRefusal({ error: new Error("remote_brain_http_501") })).toBe(true);
  });
});