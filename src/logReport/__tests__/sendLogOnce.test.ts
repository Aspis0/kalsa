/**
 * The session holder's one-upload discipline: a second call while a send is in
 * flight gets that same promise instead of a new request, a successful send is
 * answered from its remembered id, and a failed send re-arms the next call.
 * Each test loads a fresh module instance: the id lives for the app session,
 * so one shared instance would make the tests order-dependent.
 */
jest.mock("../sendLog", () => ({
  sendLog: jest.fn(),
}));

type Holder = typeof import("../sendLogOnce");

function loadFresh(): { holder: Holder; sendLog: jest.Mock } {
  jest.resetModules();
  return {
    holder: require("../sendLogOnce") as Holder,
    sendLog: require("../sendLog").sendLog as jest.Mock,
  };
}

describe("the send-once holder", () => {
  it("shares one in-flight send and answers the rest of the session from its id", async () => {
    const { holder, sendLog } = loadFresh();
    let release!: (result: { ok: true; id: string }) => void;
    const pending = new Promise<{ ok: true; id: string }>((resolve) => {
      release = resolve;
    });
    sendLog.mockReturnValue(pending);

    const first = holder.sendLogOnce();
    const second = holder.sendLogOnce();

    expect(second).toBe(first);
    expect(sendLog).toHaveBeenCalledTimes(1);
    expect(holder.reportSession().id).toBeNull();
    expect(holder.reportSession().inFlight).toBe(first);

    release({ ok: true, id: "ABCD2345" });
    await expect(first).resolves.toEqual({ ok: true, id: "ABCD2345" });
    expect(sendLog).toHaveBeenCalledTimes(1);

    // The id survives the settled send: a later press uploads nothing.
    expect(holder.reportSession()).toEqual({ id: "ABCD2345", inFlight: null });
    await expect(holder.sendLogOnce()).resolves.toEqual({ ok: true, id: "ABCD2345" });
    expect(sendLog).toHaveBeenCalledTimes(1);
  });

  it("clears the in-flight slot on failure so the next press sends again", async () => {
    const { holder, sendLog } = loadFresh();
    sendLog.mockResolvedValue({ ok: false, reason: "failed" });

    await expect(holder.sendLogOnce()).resolves.toEqual({ ok: false, reason: "failed" });
    expect(holder.reportSession()).toEqual({ id: null, inFlight: null });

    sendLog.mockResolvedValue({ ok: true, id: "ABCD2345" });
    await expect(holder.sendLogOnce()).resolves.toEqual({ ok: true, id: "ABCD2345" });
    expect(sendLog).toHaveBeenCalledTimes(2);
  });

  it("clears the in-flight slot when the send rejects", async () => {
    const { holder, sendLog } = loadFresh();
    sendLog.mockRejectedValue(new Error("reader threw"));

    await expect(holder.sendLogOnce()).rejects.toThrow("reader threw");
    expect(holder.reportSession()).toEqual({ id: null, inFlight: null });
  });
});
