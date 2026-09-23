import { isAllowedPairingUrl, pairingUrlPrefill } from "./pairingUrls";

describe("pairing URL prefill", () => {
  test("reuses the configured host as initial values, but returns separately editable URLs", () => {
    expect(pairingUrlPrefill("https://desktop.tailnet.ts.net/v1/" )).toEqual({
      doorUrl: "https://desktop.tailnet.ts.net/v1",
      deskUrl: "https://desktop.tailnet.ts.net:8443",
    });
  });

  test("an absent or unsafe saved address does not invent a host", () => {
    expect(pairingUrlPrefill("")).toEqual({ doorUrl: "", deskUrl: "" });
    expect(pairingUrlPrefill("file:///tmp/desktop")).toEqual({ doorUrl: "", deskUrl: "" });
    expect(pairingUrlPrefill("https://user:secret@desktop.tailnet.ts.net")).toEqual({ doorUrl: "", deskUrl: "" });
  });

  test("remote pairing URLs require HTTPS; plain HTTP is limited to loopback", () => {
    expect(isAllowedPairingUrl("https://desktop.tailnet.ts.net:9443")).toBe(true);
    expect(isAllowedPairingUrl("http://127.0.0.1:8443")).toBe(true);
    expect(isAllowedPairingUrl("http://desktop.tailnet.ts.net:8443")).toBe(false);
    expect(isAllowedPairingUrl("https://desktop.tailnet.ts.net/?token=secret")).toBe(false);
  });
});
